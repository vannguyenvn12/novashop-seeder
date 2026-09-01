// generate-reference-doc.js — QUERY DB THẬT (đã seed) để sinh NOVASHOP_DATA_REFERENCE.md
// Không viết tay: mọi số liệu, enum, sample row đều lấy trực tiếp từ DB.
import { pool, query } from '../src/db.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'NOVASHOP_DATA_REFERENCE.md');
const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

const ALL_TABLES = [
  'customers', 'orders', 'order_items', 'products', 'categories', 'coupons',
  'reviews', 'refunds', 'returns', 'payments', 'user_events', 'order_status_history',
  'customer_tier_history', 'order_price_history', 'shipments', 'delivery_attempts',
  'cod_remittances', 'customer_addresses',
];

const STATUS_COLS = [
  ['orders', 'status'], ['orders', 'payment_method'], ['orders', 'payment_status'],
  ['shipments', 'status'], ['shipments', 'carrier'], ['delivery_attempts', 'result'],
  ['refunds', 'status'], ['refunds', 'refund_reason'], ['payments', 'status'],
  ['payments', 'payment_gateway'], ['reviews', 'rating'], ['user_events', 'event_type'],
  ['customers', 'current_tier'], ['customer_tier_history', 'tier'],
  ['order_price_history', 'adjustment_type'], ['order_price_history', 'adjusted_by'],
  ['coupons', 'type'], ['returns', 'return_reason'],
];

async function q(text, params) {
  const r = await query(text, params);
  return r;
}

function esc(s) {
  if (s instanceof Date) return s.toISOString().slice(0, 19).replace('T', ' ');
  return String(s ?? '').replace(/[|]/g, '\\|').replace(/\n/g, ' ');
}

// Format Date object (pg trả timestamptz thành Date) hoặc string -> YYYY-MM-DD
function fmtDate(v) {
  if (v == null) return '';
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const phase = process.env.REF_PHASE || '1';
  const lines = [];
  lines.push('# NOVASHOP_DATA_REFERENCE.md');
  lines.push('');
  lines.push('> Tài liệu này được **sinh tự động** bằng cách query trực tiếp vào DB NovaShop đã seed ');
  lines.push(`> (phase ${phase}). Mọi số liệu, enum, sample row đều là dữ liệu thật. Không viết tay.`);
  lines.push('');
  lines.push('## 1. Cách chạy');
  lines.push('');
  lines.push('```bash');
  lines.push('# 1. Postgres (native 14+ hoặc docker) — DB phải có data đã seed,');
  lines.push('#    DATABASE_URL trong .env trỏ đúng DB');
  lines.push('');
  lines.push('# 2. Seed 1 phase (tự TRUNCATE + seed + ghi manifest)');
  lines.push('npm run db:reset -- --phase=3');
  lines.push('');
  lines.push('# 3. Verify checksum với manifest lúc seed');
  lines.push('npm run db:verify -- --phase=3');
  lines.push('');
  lines.push('# 4. Restore từ backup (nhanh hơn seed, không cần generate)');
  lines.push('npm run db:restore -- -y -f phase2.sql   # hoặc phase3.sql');
  lines.push('```');
  lines.push('');
  lines.push('Biến môi trường: `DATABASE_URL`, `BASE_SEED` (đổi seed = bộ data khác hẳn), `MANIFEST_DIR`.');
  lines.push('');
  lines.push('> Tài liệu này sinh bởi `node scripts/generate-reference-doc.js` — query DB thật, phase lấy từ `REF_PHASE`.');
  lines.push('');

  // 2. Schema
  lines.push('## 2. Schema đầy đủ');
  lines.push('');
  lines.push('> Ghi chú cột "chỉ lưu giá trị hiện tại" (lịch sử nằm ở bảng khác):');
  lines.push('> - `orders.status` → lịch sử ở `order_status_history` (Module 12)');
  lines.push('> - `customers.current_tier` → lịch sử ở `customer_tier_history` (Module 16 Case 1)');
  lines.push('> - `orders.total_amount` → mọi điều chỉnh ở `order_price_history` (Module 16 Case 2), KHÔNG ghi đè trực tiếp');
  lines.push('> - `order_items.unit_price` → snapshot giá lúc đặt, không tra ngược catalog (Module 16)');
  lines.push('> - `orders.shipping_address` → snapshot địa chỉ lúc đặt; địa chỉ lưu của khách ở `customer_addresses`');
  lines.push('> - `orders → shipments` là 1:N (1 đơn tách nhiều kiện, Module 13)');
  lines.push('> - `refunds` (tài chính) và `returns` (logistics) là 2 luồng độc lập');
  lines.push('');
  lines.push('```sql');
  lines.push(SCHEMA);
  lines.push('```');
  lines.push('');

  // 3. Checkpoint table
  lines.push('## 3. Bảng checkpoint (phase ' + phase + ')');
  lines.push('');
  lines.push('| Bảng | Row count |');
  lines.push('|---|---|');
  for (const t of ALL_TABLES) {
    const r = await q(`SELECT COUNT(*)::bigint AS n FROM ${t}`);
    lines.push(`| ${t} | ${Number(r[0].n).toLocaleString()} |`);
  }
  // ngày chính
  const d1 = await q('SELECT MIN(order_date)::date AS mn, MAX(order_date)::date AS mx FROM orders');
  const d2 = await q('SELECT MIN(created_at)::date AS mn, MAX(created_at)::date AS mx FROM customers');
  const d3 = await q('SELECT MIN(paid_at)::date AS mn, MAX(paid_at)::date AS mx FROM payments');
  const d4 = await q('SELECT MIN(event_time)::date AS mn, MAX(event_time)::date AS mx FROM user_events');
  const d5 = await q('SELECT MIN(changed_at)::date AS mn, MAX(changed_at)::date AS mx FROM order_status_history');
  lines.push('');
  lines.push(`- Khoảng ngày đơn hàng: **${fmtDate(d1[0].mn)} → ${fmtDate(d1[0].mx)}**`);
  lines.push(`- Khoảng ngày tạo khách: **${fmtDate(d2[0].mn)} → ${fmtDate(d2[0].mx)}**`);
  lines.push(`- Khoảng ngày thanh toán: **${fmtDate(d3[0].mn)} → ${fmtDate(d3[0].mx)}**`);
  lines.push(`- Khoảng ngày user_events: **${fmtDate(d4[0].mn)} → ${fmtDate(d4[0].mx)}**`);
  lines.push(`- Khoảng ngày status_history: **${fmtDate(d5[0].mn)} → ${fmtDate(d5[0].mx)}**`);
  lines.push('- Tỷ lệ trung bình:');
  const itemsPerOrder = await q('SELECT ROUND(AVG(n),2) AS v FROM (SELECT COUNT(*) AS n FROM order_items GROUP BY order_id) s');
  const ordersPerCust = await q('SELECT ROUND(AVG(n),2) AS v FROM (SELECT COUNT(*) AS n FROM orders GROUP BY customer_id) s');
  const codPct = await q(`SELECT ROUND(100.0*COUNT(*)/NULLIF((SELECT COUNT(*) FROM orders),0),2) AS v FROM orders WHERE payment_method='COD'`);
  const multiShip = await q(`SELECT ROUND(100.0*COUNT(*)/NULLIF((SELECT COUNT(*) FROM orders),0),2) AS v FROM orders WHERE id IN (SELECT DISTINCT order_id FROM shipments GROUP BY order_id HAVING COUNT(*)>1)`);
  lines.push(`  - item/đơn: **${itemsPerOrder[0].v}**`);
  lines.push(`  - đơn/khách: **${ordersPerCust[0].v}**`);
  lines.push(`  - % COD: **${codPct[0].v}%**`);
  lines.push(`  - % đơn tách nhiều shipment: **${multiShip[0].v}%**`);
  lines.push('');

  // 4. Enum/status thật
  lines.push('## 4. Danh mục enum/status thật (đo trực tiếp từ DB)');
  lines.push('');
  for (const [t, c] of STATUS_COLS) {
    lines.push(`### ${t}.${c}`);
    lines.push('');
    lines.push('| Giá trị | Số dòng | Tỷ lệ |');
    lines.push('|---|---|---|');
    const rows = await q(`SELECT ${c} AS v, COUNT(*)::bigint AS n FROM ${t} GROUP BY ${c} ORDER BY n DESC`);
    const total = rows.reduce((s, r) => s + Number(r.n), 0);
    for (const r of rows) {
      lines.push(`| ${esc(r.v)} | ${Number(r.n).toLocaleString()} | ${((100 * Number(r.n)) / total).toFixed(1)}% |`);
    }
    lines.push('');
  }

  // 5. Sample rows
  lines.push('## 5. Sample rows thật (ưu tiên dòng sạch + messy)');
  lines.push('');
  const samples = {
    customers: 'SELECT * FROM customers ORDER BY id LIMIT 5',
    orders_messy: `SELECT * FROM orders WHERE status='returned' ORDER BY id LIMIT 3`,
    orders_clean: 'SELECT * FROM orders WHERE status=\'delivered\' ORDER BY id LIMIT 3',
    order_items: 'SELECT * FROM order_items ORDER BY id LIMIT 5',
    shipments_multi: `SELECT * FROM shipments WHERE order_id IN (SELECT order_id FROM shipments GROUP BY order_id HAVING COUNT(*)>1) LIMIT 4`,
    refunds: 'SELECT * FROM refunds LIMIT 3',
    returns: 'SELECT * FROM returns LIMIT 3',
    reviews_null: 'SELECT * FROM reviews WHERE customer_id IS NULL LIMIT 3',
    reviews_clean: 'SELECT * FROM reviews WHERE customer_id IS NOT NULL LIMIT 3',
    order_price_history: 'SELECT * FROM order_price_history LIMIT 3',
    order_status_history_dup: `SELECT * FROM order_status_history WHERE status='shipped' AND note='webhook retry' LIMIT 3`,
    delivery_attempts_refused: `SELECT * FROM delivery_attempts WHERE result='refused' LIMIT 3`,
    cod_remittances_unremitted: 'SELECT * FROM cod_remittances WHERE remitted_at IS NULL LIMIT 3',
    payments: 'SELECT * FROM payments LIMIT 3',
    user_events: 'SELECT * FROM user_events ORDER BY id LIMIT 5',
    customer_addresses: 'SELECT * FROM customer_addresses LIMIT 3',
    customer_tier_history: 'SELECT * FROM customer_tier_history LIMIT 3',
  };
  for (const [name, sql] of Object.entries(samples)) {
    lines.push(`### Sample: ${name}`);
    lines.push('');
    lines.push('```sql');
    lines.push(sql);
    lines.push('```');
    lines.push('');
    // Lấy tên cột: parse bảng từ SQL sample (tránh nối 'LIMIT 0' vì sample đã có LIMIT)
    const tblMatch = sql.match(/FROM\s+(\w+)/i);
    let cols = [];
    if (tblMatch) {
      const res = await pool.query(`SELECT * FROM ${tblMatch[1]} LIMIT 0`);
      cols = res.fields.map((f) => f.name);
    }
    lines.push('| ' + cols.map(esc).join(' | ') + ' |');
    lines.push('|' + cols.map(() => '---').join('|') + '|');
    const rows = await q(sql);
    for (const r of rows) {
      lines.push('| ' + cols.map((c) => esc(r[c])).join(' | ') + ' |');
    }
    lines.push('');
  }

  // 6. Messiness catalog
  lines.push('## 6. Messiness catalog thật đã seed');
  lines.push('');
  lines.push('| Bảng | Hiện tượng | Số dòng | Tỷ lệ | Phục vụ module |');
  lines.push('|---|---|---|---|---|');
  const mess = [];
  const dupEmails = await q(`SELECT COUNT(*)::bigint AS n FROM (SELECT LOWER(email) AS e FROM customers GROUP BY LOWER(email) HAVING COUNT(*)>1) s`);
  mess.push(['customers', 'Email trùng (case-insensitive)', Number(dupEmails[0].n), (100 * Number(dupEmails[0].n)) / (await q('SELECT COUNT(*)::bigint AS n FROM customers'))[0].n, 'Module 1 — Dedup']);
  const nullPhone = await q('SELECT COUNT(*)::bigint AS n FROM customers WHERE phone IS NULL OR phone=\'\'');
  mess.push(['customers', 'NULL phone', Number(nullPhone[0].n), (100 * Number(nullPhone[0].n)) / (await q('SELECT COUNT(*)::bigint AS n FROM customers'))[0].n, 'Module 1 — Dedup']);
  const nullReview = await q('SELECT COUNT(*)::bigint AS n FROM reviews WHERE customer_id IS NULL');
  mess.push(['reviews', 'customer_id NULL', Number(nullReview[0].n), (100 * Number(nullReview[0].n)) / (await q('SELECT COUNT(*)::bigint AS n FROM reviews'))[0].n, 'Module 6 — NOT IN trap']);
  const multiShipCount = await q(`SELECT COUNT(*)::bigint AS n FROM (SELECT order_id FROM shipments GROUP BY order_id HAVING COUNT(*)>1) s`);
  mess.push(['orders/shipments', '1 đơn nhiều shipment', Number(multiShipCount[0].n), (100 * Number(multiShipCount[0].n)) / (await q('SELECT COUNT(*)::bigint AS n FROM orders'))[0].n, 'Module 13 — JOIN fan-out']);
  const dupShipped = await q(`SELECT COUNT(*)::bigint AS n FROM order_status_history WHERE status='shipped' AND note='webhook retry'`);
  mess.push(['order_status_history', 'Shipped bị retry (duplicate)', Number(dupShipped[0].n), (100 * Number(dupShipped[0].n)) / (await q('SELECT COUNT(*)::bigint AS n FROM order_status_history'))[0].n, 'Module 12 — SLA']);
  const refused = await q(`SELECT COUNT(*)::bigint AS n FROM delivery_attempts WHERE result='refused'`);
  mess.push(['delivery_attempts', 'Bùng hàng (refused)', Number(refused[0].n), (100 * Number(refused[0].n)) / (await q('SELECT COUNT(*)::bigint AS n FROM delivery_attempts'))[0].n, 'Module 13 BT2 — COD']);
  const unremitted = await q('SELECT COUNT(*)::bigint AS n FROM cod_remittances WHERE remitted_at IS NULL');
  mess.push(['cod_remittances', 'Chưa remit (thu tiền chưa chuyển về)', Number(unremitted[0].n), (100 * Number(unremitted[0].n)) / (await q('SELECT COUNT(*)::bigint AS n FROM cod_remittances'))[0].n, 'Module 18 Case COD']);
  const pendingRefund = await q(`SELECT COUNT(*)::bigint AS n FROM refunds WHERE status='requested'`);
  mess.push(['refunds', 'Refund còn pending (chưa processed)', Number(pendingRefund[0].n), (100 * Number(pendingRefund[0].n)) / (await q('SELECT COUNT(*)::bigint AS n FROM refunds'))[0].n, 'Module 17 — accrual']);
  for (const [t, p, n, pct, mod] of mess) {
    lines.push(`| ${t} | ${p} | ${Number(n).toLocaleString()} | ${pct.toFixed(2)}% | ${mod} |`);
  }
  lines.push('');

  // 7. Reset
  lines.push('## 7. Cách reset nếu lỡ update/xoá');
  lines.push('');
  lines.push('```bash');
  lines.push(`npm run db:reset -- --phase=${phase}`);
  lines.push('```');
  lines.push('');
  lines.push('Determinism: mỗi bản ghi được sinh từ `hash(BASE_SEED, entity_type, index)` — reset sinh lại y hệt, khách #5000 giống nhau ở mọi checkpoint.');

  fs.writeFileSync(OUT, lines.join('\n'), 'utf8');
  console.log(`[doc] wrote ${OUT}`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
