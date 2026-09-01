# NOVASHOP_DATA_REFERENCE.md

> Tài liệu này được **sinh tự động** bằng cách query trực tiếp vào DB NovaShop đã seed 
> (phase 3 ). Mọi số liệu, enum, sample row đều là dữ liệu thật. Không viết tay.

## 1. Cách chạy

```bash
# 1. Postgres (native 14+ hoặc docker) — DB phải có data đã seed,
#    DATABASE_URL trong .env trỏ đúng DB

# 2. Seed 1 phase (tự TRUNCATE + seed + ghi manifest)
npm run db:reset -- --phase=3

# 3. Verify checksum với manifest lúc seed
npm run db:verify -- --phase=3

# 4. Restore từ backup (nhanh hơn seed, không cần generate)
npm run db:restore -- -y -f phase2.sql   # hoặc phase3.sql
```

Biến môi trường: `DATABASE_URL`, `BASE_SEED` (đổi seed = bộ data khác hẳn), `MANIFEST_DIR`.

> Tài liệu này sinh bởi `node scripts/generate-reference-doc.js` — query DB thật, phase lấy từ `REF_PHASE`.

## 2. Schema đầy đủ

> Ghi chú cột "chỉ lưu giá trị hiện tại" (lịch sử nằm ở bảng khác):
> - `orders.status` → lịch sử ở `order_status_history` (Module 12)
> - `customers.current_tier` → lịch sử ở `customer_tier_history` (Module 16 Case 1)
> - `orders.total_amount` → mọi điều chỉnh ở `order_price_history` (Module 16 Case 2), KHÔNG ghi đè trực tiếp
> - `order_items.unit_price` → snapshot giá lúc đặt, không tra ngược catalog (Module 16)
> - `orders.shipping_address` → snapshot địa chỉ lúc đặt; địa chỉ lưu của khách ở `customer_addresses`
> - `orders → shipments` là 1:N (1 đơn tách nhiều kiện, Module 13)
> - `refunds` (tài chính) và `returns` (logistics) là 2 luồng độc lập

```sql
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

```

## 3. Bảng checkpoint (phase 3 )

| Bảng | Row count |
|---|---|
| customers | 1,000,000 |
| orders | 5,000,000 |
| order_items | 9,997,727 |
| products | 200 |
| categories | 49 |
| coupons | 30 |
| reviews | 2,500,000 |
| refunds | 190,290 |
| returns | 190,290 |
| payments | 2,644,042 |
| user_events | 25,000,000 |
| order_status_history | 24,927,186 |
| customer_tier_history | 24,981 |
| order_price_history | 800,000 |
| shipments | 6,067,642 |
| delivery_attempts | 6,100,000 |
| cod_remittances | 2,000,000 |
| customer_addresses | 15,000 |

- Khoảng ngày đơn hàng: **2023-12-31 → 2025-12-29**
- Khoảng ngày tạo khách: **2026-08-31 → 2026-08-31**
- Khoảng ngày thanh toán: **2023-12-31 → 2025-12-29**
- Khoảng ngày user_events: **2023-12-31 → 2025-12-29**
- Khoảng ngày status_history: **2023-12-31 → 2026-01-02**
- Tỷ lệ trung bình:
  - item/đơn: **2.00**
  - đơn/khách: **500.00**
  - % COD: **47.12%**
  - % đơn tách nhiều shipment: **14.24%**

## 4. Danh mục enum/status thật (đo trực tiếp từ DB)

### orders.status

| Giá trị | Số dòng | Tỷ lệ |
|---|---|---|
| delivered | 4,559,497 | 91.2% |
| cancelled | 250,213 | 5.0% |
| returned | 190,290 | 3.8% |

### orders.payment_method

| Giá trị | Số dòng | Tỷ lệ |
|---|---|---|
| COD | 2,355,958 | 47.1% |
| ewallet | 882,000 | 17.6% |
| bank_transfer | 881,259 | 17.6% |
| card | 880,783 | 17.6% |

### orders.payment_status

| Giá trị | Số dòng | Tỷ lệ |
|---|---|---|
| paid | 4,559,497 | 91.2% |
| refunded | 250,213 | 5.0% |
| unpaid | 190,290 | 3.8% |

### shipments.status

| Giá trị | Số dòng | Tỷ lệ |
|---|---|---|
| delivered | 5,817,429 | 95.9% |
| failed | 250,213 | 4.1% |

### shipments.carrier

| Giá trị | Số dòng | Tỷ lệ |
|---|---|---|
| GHN | 1,214,493 | 20.0% |
| J&T Express | 1,214,035 | 20.0% |
| Viettel Post | 1,213,499 | 20.0% |
| Ninja Van | 1,213,040 | 20.0% |
| GrabExpress | 1,212,575 | 20.0% |

### delivery_attempts.result

| Giá trị | Số dòng | Tỷ lệ |
|---|---|---|
| success | 5,446,886 | 89.3% |
| refused | 227,406 | 3.7% |
| no_answer | 213,030 | 3.5% |
| wrong_address | 212,678 | 3.5% |

### refunds.status

| Giá trị | Số dòng | Tỷ lệ |
|---|---|---|
| processed | 152,049 | 79.9% |
| requested | 38,241 | 20.1% |

### refunds.refund_reason

| Giá trị | Số dòng | Tỷ lệ |
|---|---|---|
| khách trả hàng | 190,290 | 100.0% |

### payments.status

| Giá trị | Số dòng | Tỷ lệ |
|---|---|---|
| success | 2,591,286 | 98.0% |
| failed | 52,756 | 2.0% |

### payments.payment_gateway

| Giá trị | Số dòng | Tỷ lệ |
|---|---|---|
| ShopeePay | 529,888 | 20.0% |
| ZaloPay | 528,961 | 20.0% |
| VNPay | 528,687 | 20.0% |
| VietQR | 528,528 | 20.0% |
| MoMo | 527,978 | 20.0% |

### reviews.rating

| Giá trị | Số dòng | Tỷ lệ |
|---|---|---|
| 4 | 875,890 | 35.0% |
| 5 | 874,391 | 35.0% |
| 3 | 499,626 | 20.0% |
| 1 | 125,318 | 5.0% |
| 2 | 124,775 | 5.0% |

### user_events.event_type

| Giá trị | Số dòng | Tỷ lệ |
|---|---|---|
| view | 12,136,894 | 48.5% |
| paid | 4,611,306 | 18.4% |
| checkout | 4,369,533 | 17.5% |
| cart | 3,882,267 | 15.5% |

### customers.current_tier

| Giá trị | Số dòng | Tỷ lệ |
|---|---|---|
| standard | 594,110 | 59.4% |
| silver | 405,890 | 40.6% |

### customer_tier_history.tier

| Giá trị | Số dòng | Tỷ lệ |
|---|---|---|
| standard | 10,000 | 40.0% |
| silver | 7,527 | 30.1% |
| gold | 4,985 | 20.0% |
| platinum | 2,469 | 9.9% |

### order_price_history.adjustment_type

| Giá trị | Số dòng | Tỷ lệ |
|---|---|---|
| tax_correction | 160,415 | 20.1% |
| price_match | 160,149 | 20.0% |
| coupon_retroactive | 160,132 | 20.0% |
| goodwill | 159,951 | 20.0% |
| other | 159,353 | 19.9% |

### order_price_history.adjusted_by

| Giá trị | Số dòng | Tỷ lệ |
|---|---|---|
| CS | 479,436 | 59.9% |
| Finance | 160,415 | 20.1% |
| Sales | 160,149 | 20.0% |

### coupons.type

| Giá trị | Số dòng | Tỷ lệ |
|---|---|---|
| fixed | 12 | 40.0% |
| percent | 12 | 40.0% |
| free_ship | 6 | 20.0% |

### returns.return_reason

| Giá trị | Số dòng | Tỷ lệ |
|---|---|---|
| không ưng | 38,395 | 20.2% |
| hàng lỗi | 38,217 | 20.1% |
| đổi ý | 38,004 | 20.0% |
| sai size | 37,964 | 20.0% |
| giao chậm | 37,710 | 19.8% |

## 5. Sample rows thật (ưu tiên dòng sạch + messy)

### Sample: customers

```sql
SELECT * FROM customers ORDER BY id LIMIT 5
```

| id | full_name | email | phone | current_tier | created_at |
|---|---|---|---|---|---|
| 1 | Tường Minh Tăng | tuongminhtang@outlook.com | 023 0038 5608 | silver | 2026-09-01 04:03:01 |
| 2 | Hồng Nhuận Bùi | hongnhuanbui66@gmail.com | 022 6855 6288 | standard | 2026-09-01 04:03:01 |
| 3 | Hiểu Vân Vũ | hieuvanvu@gmail.com | 0272 4574 6771 | silver | 2026-09-01 04:03:01 |
| 4 | Đức Siêu Hoàng | ucsieuhoang.hoang@yahoo.com | 0283 2689 7947 | standard | 2026-09-01 04:03:01 |
| 5 | Đăng Khương Đỗ | angkhuongo.o@yahoo.com |  | standard | 2026-09-01 04:03:01 |

### Sample: orders_messy

```sql
SELECT * FROM orders WHERE status='returned' ORDER BY id LIMIT 3
```

| id | customer_id | coupon_id | order_date | status | payment_method | payment_status | shipping_fee_charged | total_amount | coupon_discount | shipping_address | created_at | updated_at |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 4 | 4 | 1295742986 | 2025-06-14 07:00:00 | returned | COD | unpaid | 57176.00 | 1204176.00 | 50000.00 | 264 Nguyễn Thái Sơn, Phường 9, Quận 11, Hồ Chí Minh | 2025-06-14 07:00:00 | 2025-06-15 07:00:00 |
| 15 | 15 | 704798750 | 2025-08-23 04:00:00 | returned | COD | unpaid | 40446.00 | 946446.00 | 100000.00 | 137 Phạm Phú Thứ, Tân Tạo, Bình Tân, Hồ Chí Minh | 2025-08-23 04:00:00 | 2025-08-24 01:00:00 |
| 50 | 50 | 1769772016 | 2025-01-28 11:00:00 | returned | COD | unpaid | 34472.00 | 25914472.00 | 100000.00 | 14 Võ Văn Tần, Phường 12, Quận 5, Hồ Chí Minh | 2025-01-28 11:00:00 | 2025-01-29 04:00:00 |

### Sample: orders_clean

```sql
SELECT * FROM orders WHERE status='delivered' ORDER BY id LIMIT 3
```

| id | customer_id | coupon_id | order_date | status | payment_method | payment_status | shipping_fee_charged | total_amount | coupon_discount | shipping_address | created_at | updated_at |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 1 | 499036568 | 2025-05-22 04:00:00 | delivered | bank_transfer | paid | 27699.00 | 358349.00 | 58350.00 | 1 An Dương Vương, Phường 2, Quận 4, Hồ Chí Minh | 2025-05-22 04:00:00 | 2025-05-23 03:00:00 |
| 2 | 2 | 2049124185 | 2024-04-21 13:00:00 | delivered | COD | paid | 45298.00 | 1492298.00 | 50000.00 | 162 Phạm Ngọc Thạch, Hòa Long, Thành phố Bà Rịa, Bà Rịa - Vũng Tàu | 2024-04-21 13:00:00 | 2024-04-23 10:00:00 |
| 3 | 3 | 755594638 | 2024-01-02 06:00:00 | delivered | bank_transfer | paid | 34431.00 | 29506431.00 | 150000.00 | 12 Võ Văn Kiệt, Phước Kiển, Nhà Bè, Hồ Chí Minh | 2024-01-02 06:00:00 | 2024-01-04 06:00:00 |

### Sample: order_items

```sql
SELECT * FROM order_items ORDER BY id LIMIT 5
```

| id | order_id | product_id | quantity | unit_price | amount |
|---|---|---|---|---|---|
| 1 | 1 | 67990776 | 1 | 389000.00 | 389000.00 |
| 2 | 2 | 569753143 | 3 | 499000.00 | 1497000.00 |
| 3 | 3 | 1617313336 | 2 | 1299000.00 | 2598000.00 |
| 4 | 3 | 1462272470 | 3 | 699000.00 | 2097000.00 |
| 5 | 3 | 210068223 | 2 | 1299000.00 | 2598000.00 |

### Sample: shipments_multi

```sql
SELECT * FROM shipments WHERE order_id IN (SELECT order_id FROM shipments GROUP BY order_id HAVING COUNT(*)>1) LIMIT 4
```

| id | order_id | warehouse_id | carrier | tracking_number | shipping_cost_actual | status | shipped_at | delivered_at | estimated_delivery |
|---|---|---|---|---|---|---|---|---|---|
| 77835 | 64002 | 5 | GHN | VT0000077835 | 17150.00 | delivered | 2025-02-08 04:00:00 | 2025-02-11 04:00:00 | 2025-02-10 04:00:00 |
| 77836 | 64002 | 1 | Viettel Post | VT0000077836 | 17497.00 | delivered | 2025-02-08 04:00:00 | 2025-02-11 04:00:00 | 2025-02-10 04:00:00 |
| 77837 | 64002 | 4 | GHN | VT0000077837 | 17497.00 | delivered | 2025-02-06 04:00:00 | 2025-02-09 04:00:00 | 2025-02-10 04:00:00 |
| 77902 | 64053 | 4 | Viettel Post | VT0000077902 | 25356.00 | delivered | 2024-09-22 13:00:00 | 2024-09-25 13:00:00 | 2024-09-24 13:00:00 |

### Sample: refunds

```sql
SELECT * FROM refunds LIMIT 3
```

| refund_id | order_item_id | refund_amount | refund_reason | status | requested_at | processed_at |
|---|---|---|---|---|---|---|
| 1 | 8 | 1197000.00 | khách trả hàng | processed | 2025-07-08 07:00:00 | 2025-07-09 07:00:00 |
| 2 | 37 | 198000.00 | khách trả hàng | processed | 2025-09-10 04:00:00 | 2025-09-13 04:00:00 |
| 3 | 95 | 25980000.00 | khách trả hàng | requested | 2025-02-24 11:00:00 |  |

### Sample: returns

```sql
SELECT * FROM returns LIMIT 3
```

| return_id | order_item_id | quantity_returned | return_reason | restocking_fee | received_at |
|---|---|---|---|---|---|
| 1 | 8 | 2 | đổi ý | 0.00 | 2025-07-04 07:00:00 |
| 2 | 35 | 1 | sai size | 0.00 | 2025-09-11 04:00:00 |
| 3 | 95 | 2 | hàng lỗi | 0.00 | 2025-02-21 11:00:00 |

### Sample: reviews_null

```sql
SELECT * FROM reviews WHERE customer_id IS NULL LIMIT 3
```

| id | customer_id | product_id | rating | title | content | created_at |
|---|---|---|---|---|---|---|
| 4 |  | 401014317 | 5 | Chất lượng kém |  | 2024-03-13 15:00:00 |
| 6 |  | 690791003 | 3 | Chất lượng kém |  | 2024-03-12 06:00:00 |
| 20 |  | 2039890199 | 4 | Tốt |  | 2025-02-17 09:00:00 |

### Sample: reviews_clean

```sql
SELECT * FROM reviews WHERE customer_id IS NOT NULL LIMIT 3
```

| id | customer_id | product_id | rating | title | content | created_at |
|---|---|---|---|---|---|---|
| 1 | 1 | 67990776 | 4 |  |  | 2025-05-29 04:00:00 |
| 2 | 2 | 569753143 | 5 |  |  | 2024-05-06 13:00:00 |
| 3 | 3 | 1617313336 | 4 | Đáng mua |  | 2024-01-16 06:00:00 |

### Sample: order_price_history

```sql
SELECT * FROM order_price_history LIMIT 3
```

| id | order_id | adjustment_type | amount | reason | adjusted_by | adjusted_at |
|---|---|---|---|---|---|---|
| 1 | 4 | price_match | -70000.00 | Price-match với đối thủ | Sales | 2025-06-16 07:00:00 |
| 2 | 25 | price_match | -110000.00 | Price-match với đối thủ | Sales | 2024-12-20 15:00:00 |
| 3 | 34 | price_match | -40000.00 | Price-match với đối thủ | Sales | 2024-02-14 03:00:00 |

### Sample: order_status_history_dup

```sql
SELECT * FROM order_status_history WHERE status='shipped' AND note='webhook retry' LIMIT 3
```

| id | order_id | status | changed_at | note |
|---|---|---|---|---|
| 31 | 6 | shipped | 2024-07-14 04:00:05 | webhook retry |
| 86 | 17 | shipped | 2024-03-10 09:00:05 | webhook retry |
| 97 | 19 | shipped | 2024-10-24 03:00:05 | webhook retry |

### Sample: delivery_attempts_refused

```sql
SELECT * FROM delivery_attempts WHERE result='refused' LIMIT 3
```

| id | shipment_id | attempt_number | attempted_at | result |
|---|---|---|---|---|
| 5739874 | 5568595 | 1 | 2025-07-13 03:00:00 | refused |
| 5739881 | 5568602 | 1 | 2024-10-25 05:00:00 | refused |
| 5739882 | 5568603 | 1 | 2024-10-25 05:00:00 | refused |

### Sample: cod_remittances_unremitted

```sql
SELECT * FROM cod_remittances WHERE remitted_at IS NULL LIMIT 3
```

| remittance_id | shipment_id | amount_collected | remitted_at | shipper_batch_id |
|---|---|---|---|---|
| 2 | 7 | 1204176.00 |  |  |
| 4 | 11 | 797560.00 |  |  |
| 14 | 32 | 2632226.00 |  |  |

### Sample: payments

```sql
SELECT * FROM payments LIMIT 3
```

| id | order_id | payment_gateway | gateway_txn_id | amount | status | paid_at |
|---|---|---|---|---|---|---|
| 1 | 1 | ShopeePay | GW000000000001 | 358349.00 | success | 2025-05-22 04:00:00 |
| 2 | 3 | VietQR | GW000000000002 | 29506431.00 | success | 2024-01-02 06:00:00 |
| 3 | 5 | VNPay | GW000000000003 | 18460000.00 | success | 2024-03-03 15:00:00 |

### Sample: user_events

```sql
SELECT * FROM user_events ORDER BY id LIMIT 5
```

| id | customer_id | session_id | event_type | event_time | product_id | payload |
|---|---|---|---|---|---|---|
| 1 | 1 | SESS-220431 | view | 2025-05-22 02:00:00 | 619664483 | [object Object] |
| 2 | 1 | SESS-220431 | cart | 2025-05-22 02:01:00 | 721262555 | [object Object] |
| 3 | 1 | SESS-220431 | paid | 2025-05-22 04:00:00 |  | [object Object] |
| 4 | 2 | SESS-401911 | view | 2024-04-21 13:00:00 | 87564542 | [object Object] |
| 5 | 2 | SESS-401911 | cart | 2024-04-21 13:01:00 | 557404052 | [object Object] |

### Sample: customer_addresses

```sql
SELECT * FROM customer_addresses LIMIT 3
```

| id | customer_id | label | full_address | province | district | ward | phone | is_default |
|---|---|---|---|---|---|---|---|---|
| 1 | 1 | Nhà riêng | 1 An Dương Vương, Phường 2, Quận 4, Hồ Chí Minh | Hồ Chí Minh | Quận 4 | Phường 2 |  | true |
| 2 | 2 | Nhà riêng | 12 Võ Văn Kiệt, Phước Kiển, Nhà Bè, Hồ Chí Minh | Hồ Chí Minh | Nhà Bè | Phước Kiển |  | true |
| 3 | 2 | Công ty | 243 Cách Mạng Tháng Tám, Phường 9, Gò Vấp, Hồ Chí Minh | Hồ Chí Minh | Quận 11 | Phường 9 |  | false |

### Sample: customer_tier_history

```sql
SELECT * FROM customer_tier_history LIMIT 3
```

| id | customer_id | tier | effective_from |
|---|---|---|---|
| 1 | 1 | standard | 2024-01-01 11:00:00 |
| 2 | 1 | silver | 2024-02-11 11:00:00 |
| 3 | 2 | standard | 2024-01-02 06:00:00 |

## 6. Messiness catalog thật đã seed

| Bảng | Hiện tượng | Số dòng | Tỷ lệ | Phục vụ module |
|---|---|---|---|---|
| customers | Email trùng (case-insensitive) | 180,749 | 18.07% | Module 1 — Dedup |
| customers | NULL phone | 99,938 | 9.99% | Module 1 — Dedup |
| reviews | customer_id NULL | 300,107 | 12.00% | Module 6 — NOT IN trap |
| orders/shipments | 1 đơn nhiều shipment | 712,188 | 14.24% | Module 13 — JOIN fan-out |
| order_status_history | Shipped bị retry (duplicate) | 237,322 | 0.95% | Module 12 — SLA |
| delivery_attempts | Bùng hàng (refused) | 227,406 | 3.73% | Module 13 BT2 — COD |
| cod_remittances | Chưa remit (thu tiền chưa chuyển về) | 200,018 | 10.00% | Module 18 Case COD |
| refunds | Refund còn pending (chưa processed) | 38,241 | 20.10% | Module 17 — accrual |

## 7. Cách reset nếu lỡ update/xoá

```bash
npm run db:reset -- --phase=3 
```

Determinism: mỗi bản ghi được sinh từ `hash(BASE_SEED, entity_type, index)` — reset sinh lại y hệt, khách #5000 giống nhau ở mọi checkpoint.