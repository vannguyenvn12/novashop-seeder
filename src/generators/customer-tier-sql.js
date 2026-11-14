// customer-tier-sql.js — hạng thành viên tính từ chính bảng orders (phase B, Module 16 Case 1).
//
// Luật NovaShop: đầu mỗi tháng (00:00 giờ VN) tính lại hạng theo tổng tiền các đơn không hủy
// trong 12 tháng trước đó: >= 100tr platinum, >= 40tr gold, >= 10tr silver, còn lại standard.
// Khách vào hạng standard từ ngày đặt đơn đầu tiên. Chỉ ghi một dòng khi hạng đổi
// (lên hạng khi mua nhiều, xuống hạng khi ngừng mua). customers.current_tier = hạng tại 01/01/2026.
// Chạy bằng SQL sau khi orders đã nạp: chính xác tuyệt đối và nhanh hơn tính trong JS.

export const TIER_HISTORY_SQL = `
INSERT INTO customer_tier_history (customer_id, tier, effective_from)
WITH monthly AS (
  SELECT customer_id,
         date_trunc('month', order_date AT TIME ZONE 'Asia/Ho_Chi_Minh') AS m,
         SUM(total_amount) AS amt
  FROM orders
  WHERE status <> 'cancelled'
  GROUP BY 1, 2
),
firsts AS (
  SELECT customer_id, MIN(order_date) AS first_at
  FROM orders
  GROUP BY 1
),
grid AS (
  SELECT f.customer_id, g.m
  FROM firsts f
  CROSS JOIN LATERAL generate_series(
    date_trunc('month', f.first_at AT TIME ZONE 'Asia/Ho_Chi_Minh'),
    timestamp '2026-01-01', interval '1 month') AS g(m)
),
rolling AS (
  SELECT g.customer_id, g.m,
         COALESCE(SUM(mo.amt) OVER (PARTITION BY g.customer_id ORDER BY g.m
                                    ROWS BETWEEN 12 PRECEDING AND 1 PRECEDING), 0) AS spend
  FROM grid g
  LEFT JOIN monthly mo ON mo.customer_id = g.customer_id AND mo.m = g.m
),
monthly_tier AS (
  SELECT r.customer_id,
         (r.m AT TIME ZONE 'Asia/Ho_Chi_Minh') AS effective_from,
         CASE WHEN r.spend >= 100000000 THEN 'platinum'
              WHEN r.spend >= 40000000 THEN 'gold'
              WHEN r.spend >= 10000000 THEN 'silver'
              ELSE 'standard' END AS tier
  FROM rolling r
  JOIN firsts f ON f.customer_id = r.customer_id
  WHERE r.m > date_trunc('month', f.first_at AT TIME ZONE 'Asia/Ho_Chi_Minh')
  UNION ALL
  SELECT customer_id,
         date_trunc('day', first_at AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh',
         'standard'
  FROM firsts
),
changes AS (
  SELECT customer_id, tier, effective_from,
         LAG(tier) OVER (PARTITION BY customer_id ORDER BY effective_from) AS prev_tier
  FROM monthly_tier
)
SELECT customer_id, tier, effective_from
FROM changes
WHERE prev_tier IS NULL OR prev_tier <> tier
ORDER BY customer_id, effective_from;

UPDATE customers c
SET current_tier = 'standard';

UPDATE customers c
SET current_tier = t.tier
FROM (
  SELECT DISTINCT ON (customer_id) customer_id, tier
  FROM customer_tier_history
  ORDER BY customer_id, effective_from DESC
) t
WHERE t.customer_id = c.id;
`;

// Hai danh mục trỏ cha vào nhau (gán nhầm cha khi nhập liệu) — Module 15 dạy chặn vòng lặp
// trong recursive CTE. Không có sản phẩm, is_active = false, không ảnh hưởng bài khác.
export const CATEGORY_CYCLE_SQL = `
WITH base AS (SELECT MAX(id) AS mx FROM categories)
INSERT INTO categories (id, name, parent_id, is_active)
SELECT mx + 1, 'Hàng Tết', NULL, false FROM base
UNION ALL
SELECT mx + 2, 'Khuyến mãi Tết', mx + 1, false FROM base;

UPDATE categories
SET parent_id = (SELECT id FROM categories WHERE name = 'Khuyến mãi Tết')
WHERE name = 'Hàng Tết';
`;
