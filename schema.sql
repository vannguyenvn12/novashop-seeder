-- ============================================================================
-- NovaShop — Schema đầy đủ (1 schema duy nhất cho mọi checkpoint)
-- Nguồn: query-design-tu-business-outline.md (Module 0, 12, 13, 14, 16, 17, 18)
-- ----------------------------------------------------------------------------
-- Quy ước quan trọng (theo outline):
--  * orders.status                 — CHỈ là trạng thái hiện tại; lịch sử nằm ở order_status_history
--  * customers.current_tier        — CHỈ là hạng hiện tại; lịch sử nằm ở customer_tier_history
--  * orders.total_amount           — CHỈ là giá trị hiện tại; điều chỉnh nằm ở order_price_history
--  * order_items.unit_price        — snapshot giá tại lúc đặt hàng (không tra catalog)
--  * customer_addresses            — địa chỉ đã lưu của khách; địa chỉ 1 đơn cụ thể snapshot ở orders
--  * orders -> shipments           — quan hệ 1:N (1 đơn tách nhiều kiện)
--  * refunds (sự kiện tài chính) và returns (sự kiện logistics) là 2 luồng độc lập
-- ============================================================================

DROP TABLE IF EXISTS
  delivery_attempts,
  cod_remittances,
  shipments,
  order_price_history,
  order_status_history,
  customer_tier_history,
  user_events,
  payments,
  returns,
  refunds,
  reviews,
  coupons,
  order_items,
  orders,
  customer_addresses,
  customers,
  products,
  categories
CASCADE;

-- ---------------------------------------------------------------------------
-- Danh mục
-- ---------------------------------------------------------------------------

CREATE TABLE categories (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  parent_id    INT REFERENCES categories(id),          -- cây tự tham chiếu (Module 15)
  is_active    BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE products (
  id            SERIAL PRIMARY KEY,
  category_id   INT NOT NULL REFERENCES categories(id),
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL UNIQUE,
  description   TEXT,
  base_price    NUMERIC(12,2) NOT NULL CHECK (base_price >= 0),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE coupons (
  id             SERIAL PRIMARY KEY,
  code           TEXT NOT NULL UNIQUE,
  type           TEXT NOT NULL CHECK (type IN ('percent','fixed','free_ship')),  -- TODO: confirm với outline — Module 5/14 nói "coupon %", "coupon khách mới"
  value          NUMERIC(12,2) NOT NULL DEFAULT 0,
  min_order_amount NUMERIC(12,2),
  max_discount   NUMERIC(12,2),
  applies_to_new_customer BOOLEAN NOT NULL DEFAULT FALSE,  -- coupon "chào mừng khách mới" (Module 14 Case 2)
  valid_from     TIMESTAMPTZ NOT NULL,
  valid_to       TIMESTAMPTZ NOT NULL,
  usage_limit    INT,
  used_count     INT NOT NULL DEFAULT 0,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE
);

-- ---------------------------------------------------------------------------
-- Khách hàng
-- ---------------------------------------------------------------------------

CREATE TABLE customers (
  id            SERIAL PRIMARY KEY,
  full_name     TEXT NOT NULL,
  email         TEXT NOT NULL,
  phone         TEXT,
  current_tier  TEXT NOT NULL DEFAULT 'standard'
                CHECK (current_tier IN ('standard','silver','gold','platinum')),
                -- CHỈ là hạng hiện tại; toàn bộ lịch sử nằm ở customer_tier_history
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE customer_addresses (
  id            SERIAL PRIMARY KEY,
  customer_id   INT NOT NULL REFERENCES customers(id),
  label         TEXT,                                  -- "Nhà riêng" / "Công ty" / ...
  full_address  TEXT NOT NULL,
  province      TEXT,
  district      TEXT,
  ward          TEXT,
  phone         TEXT,
  is_default    BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE customer_tier_history (
  id             SERIAL PRIMARY KEY,
  customer_id    INT NOT NULL REFERENCES customers(id),
  tier           TEXT NOT NULL CHECK (tier IN ('standard','silver','gold','platinum')),
  effective_from TIMESTAMPTZ NOT NULL,                 -- áp dụng từ lúc nào (Module 16 Case 1)
  UNIQUE (customer_id, tier, effective_from)
);

-- ---------------------------------------------------------------------------
-- Đơn hàng & dòng đơn
-- ---------------------------------------------------------------------------

CREATE TABLE orders (
  id                   BIGSERIAL PRIMARY KEY,
  customer_id          INT NOT NULL REFERENCES customers(id),
  coupon_id            INT REFERENCES coupons(id),
  order_date           TIMESTAMPTZ NOT NULL,
  status               TEXT NOT NULL
                       CHECK (status IN ('pending','confirmed','packed','shipped','delivered','cancelled','returned')),
                       -- CHỈ là trạng thái hiện tại; lịch sử nằm ở order_status_history (Module 12)
  payment_method       TEXT NOT NULL CHECK (payment_method IN ('COD','card','bank_transfer','ewallet')),
  payment_status       TEXT NOT NULL DEFAULT 'unpaid'
                       CHECK (payment_status IN ('unpaid','paid','refunded','partially_refunded')),
  shipping_fee_charged NUMERIC(12,2) NOT NULL DEFAULT 0,   -- phí ship THU của khách (Module 13 BT1)
  total_amount         NUMERIC(12,2) NOT NULL DEFAULT 0,
                       -- CHỈ là giá trị hiện tại; mọi điều chỉnh (goodwill, price-match, sửa thuế...)
                       -- nằm ở order_price_history (Module 16 Case 2), KHÔNG ghi đè trực tiếp
  coupon_discount      NUMERIC(12,2) NOT NULL DEFAULT 0,
  shipping_address     TEXT NOT NULL,                   -- snapshot địa chỉ giao lúc đặt hàng
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE order_items (
  id            BIGSERIAL PRIMARY KEY,
  order_id      BIGINT NOT NULL REFERENCES orders(id),
  product_id    INT NOT NULL REFERENCES products(id),
  quantity      INT NOT NULL CHECK (quantity > 0),
  unit_price    NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
                -- snapshot giá tại lúc đặt hàng (Module 16) — KHÔNG tra ngược catalog
  amount        NUMERIC(12,2) NOT NULL CHECK (amount >= 0),  -- quantity * unit_price
  UNIQUE (order_id, product_id)
);

CREATE TABLE order_status_history (
  id          BIGSERIAL PRIMARY KEY,
  order_id    BIGINT NOT NULL REFERENCES orders(id),
  status      TEXT NOT NULL CHECK (status IN ('pending','confirmed','packed','shipped','delivered','cancelled','returned')),
  changed_at  TIMESTAMPTZ NOT NULL,
  note        TEXT
);
CREATE INDEX idx_order_status_history_order ON order_status_history (order_id, changed_at);

CREATE TABLE order_price_history (
  id              BIGSERIAL PRIMARY KEY,
  order_id        BIGINT NOT NULL REFERENCES orders(id),
  adjustment_type TEXT NOT NULL
                  CHECK (adjustment_type IN ('goodwill','price_match','tax_correction','coupon_retroactive','other')),
  amount          NUMERIC(12,2) NOT NULL,               -- âm = giảm giá trị đơn
  reason          TEXT,
  adjusted_by     TEXT NOT NULL,                        -- ai điều chỉnh (CS/Sales/System)
  adjusted_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_order_price_history_order ON order_price_history (order_id, adjusted_at);

-- ---------------------------------------------------------------------------
-- Giao vận (1 order : N shipments)
-- ---------------------------------------------------------------------------

CREATE TABLE shipments (
  id                   BIGSERIAL PRIMARY KEY,
  order_id             BIGINT NOT NULL REFERENCES orders(id),
  warehouse_id         INT NOT NULL,                    -- kho xuất; không có bảng warehouses riêng (TODO: confirm — outline chỉ nhắc "2 kho")
  carrier              TEXT NOT NULL,
  tracking_number      TEXT NOT NULL UNIQUE,
  shipping_cost_actual NUMERIC(12,2) NOT NULL DEFAULT 0, -- chi phí TRẢ cho hãng vận chuyển (Module 13 BT1)
  status               TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','shipped','in_transit','out_for_delivery','delivered','returned','failed')),
  shipped_at           TIMESTAMPTZ,
  delivered_at         TIMESTAMPTZ,
  estimated_delivery   TIMESTAMPTZ
);

CREATE TABLE delivery_attempts (
  id            BIGSERIAL PRIMARY KEY,
  shipment_id   BIGINT NOT NULL REFERENCES shipments(id),
  attempt_number INT NOT NULL DEFAULT 1,
  attempted_at  TIMESTAMPTZ NOT NULL,
  result        TEXT NOT NULL CHECK (result IN ('success','refused','no_answer','wrong_address','other'))
);
CREATE INDEX idx_delivery_attempts_shipment ON delivery_attempts (shipment_id, attempt_number);

CREATE TABLE cod_remittances (
  remittance_id     BIGSERIAL PRIMARY KEY,
  shipment_id       BIGINT NOT NULL REFERENCES shipments(id),
  amount_collected  NUMERIC(12,2) NOT NULL,
  remitted_at       TIMESTAMPTZ,
  shipper_batch_id  TEXT
);
CREATE INDEX idx_cod_remittances_shipment ON cod_remittances (shipment_id);

-- ---------------------------------------------------------------------------
-- Thanh toán, hoàn tiền, trả hàng
-- ---------------------------------------------------------------------------

CREATE TABLE payments (
  id             BIGSERIAL PRIMARY KEY,
  order_id       BIGINT NOT NULL REFERENCES orders(id),
  payment_gateway TEXT NOT NULL,                        -- tên gateway (Module 18 đối soát 2 nguồn)
  gateway_txn_id TEXT NOT NULL UNIQUE,
  amount         NUMERIC(12,2) NOT NULL,
  status         TEXT NOT NULL DEFAULT 'success'
                 CHECK (status IN ('success','failed','pending','refunded')),
  paid_at        TIMESTAMPTZ NOT NULL
);

CREATE TABLE refunds (
  refund_id     BIGSERIAL PRIMARY KEY,
  order_item_id BIGINT NOT NULL REFERENCES order_items(id),
  refund_amount NUMERIC(12,2) NOT NULL,
  refund_reason TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'requested'
                CHECK (status IN ('requested','processed','rejected')),
                -- 'requested' = chưa hoàn tất, chưa trừ vào doanh thu (Module 17 BT1)
  requested_at  TIMESTAMPTZ NOT NULL,
  processed_at  TIMESTAMPTZ
);

CREATE TABLE returns (
  return_id       BIGSERIAL PRIMARY KEY,
  order_item_id   BIGINT NOT NULL REFERENCES order_items(id),
  quantity_returned INT NOT NULL CHECK (quantity_returned > 0),
  return_reason   TEXT NOT NULL,
  restocking_fee  NUMERIC(12,2) NOT NULL DEFAULT 0,
  received_at     TIMESTAMPTZ NOT NULL
);

-- ---------------------------------------------------------------------------
-- Đánh giá & sự kiện hành vi
-- ---------------------------------------------------------------------------

CREATE TABLE reviews (
  id             BIGSERIAL PRIMARY KEY,
  customer_id    INT REFERENCES customers(id),          -- NULL được phép: review không gắn tài khoản (Module 6 NOT IN trap)
  product_id     INT NOT NULL REFERENCES products(id),
  rating         INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title          TEXT,
  content        TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_events (
  id            BIGSERIAL PRIMARY KEY,
  customer_id   INT REFERENCES customers(id),           -- NULL được phép: khách chưa đăng nhập
  session_id    TEXT NOT NULL,
  event_type    TEXT NOT NULL CHECK (event_type IN ('view','cart','checkout','paid','coupon_applied')),
  event_time    TIMESTAMPTZ NOT NULL,
  product_id    INT REFERENCES products(id),
  payload       JSONB
);
CREATE INDEX idx_user_events_session ON user_events (session_id, event_time);
CREATE INDEX idx_user_events_customer ON user_events (customer_id, event_time);
CREATE INDEX idx_user_events_type ON user_events (event_type);
