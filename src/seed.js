// seed.js — orchestrator: TRUNCATE → COPY từng bảng theo thứ tự FK
import { pool, copyTable, query } from './db.js';
import { hashInt } from './seededFaker.js';
import { getProducts, getCoupons, getCategoryTree } from './generators/index.js';
import { customers } from './generators/customers.js';
import { orders } from './generators/orders.js';
import { orderItems } from './generators/order_items.js';
import { orderStatusHistory } from './generators/order_status_history.js';
import { shipments } from './generators/shipments.js';
import { deliveryAttempts } from './generators/delivery_attempts.js';
import { payments } from './generators/payments.js';
import { codRemittances } from './generators/cod_remittances.js';
import { customerTierHistory } from './generators/customer_tier_history.js';
import { orderPriceHistory } from './generators/order_price_history.js';
import { refunds, buildItemPrefix } from './generators/refunds.js';
import { returns } from './generators/returns.js';
import { reviews } from './generators/reviews.js';
import { customerAddresses } from './generators/customer_addresses.js';
import { userEvents } from './generators/user_events.js';
import fs from 'node:fs';
import path from 'node:path';
import { initHash } from './seededFaker.js';
import { clearMetaCache } from './generators/order-core.js';
import { speedUpCopy } from './db.js';

const ALL_TABLES = [
  'customers', 'orders', 'order_items', 'products', 'categories', 'coupons',
  'reviews', 'refunds', 'returns', 'payments', 'user_events', 'order_status_history',
  'customer_tier_history', 'order_price_history', 'shipments', 'delivery_attempts',
  'cod_remittances', 'customer_addresses',
];

// Index phụ drop trước COPY (phase lớn) — tạo lại sau. Plan mục 2.3.
// Lưu ý: order_items_order_id_product_id_key là UNIQUE CONSTRAINT (bắt buộc giữ),
// nhưng drop tạm để COPY nhanh rồi tạo lại — generator đã đảm bảo unique.
const DROP_INDEXES_SQL = `
  DROP INDEX IF EXISTS idx_order_status_history_order;
  DROP INDEX IF EXISTS idx_order_price_history_order;
  DROP INDEX IF EXISTS idx_delivery_attempts_shipment;
  DROP INDEX IF EXISTS idx_cod_remittances_shipment;
  DROP INDEX IF EXISTS idx_user_events_session;
  DROP INDEX IF EXISTS idx_user_events_customer;
  DROP INDEX IF EXISTS idx_user_events_type;
`;
const CREATE_INDEXES_SQL = `
  CREATE INDEX idx_order_status_history_order ON order_status_history (order_id, changed_at);
  CREATE INDEX idx_order_price_history_order ON order_price_history (order_id, adjusted_at);
  CREATE INDEX idx_delivery_attempts_shipment ON delivery_attempts (shipment_id, attempt_number);
  CREATE INDEX idx_cod_remittances_shipment ON cod_remittances (shipment_id);
  CREATE INDEX idx_user_events_session ON user_events (session_id, event_time);
  CREATE INDEX idx_user_events_customer ON user_events (customer_id, event_time);
  CREATE INDEX idx_user_events_type ON user_events (event_type);
`;

export async function seedPhase(phase, cfg, { sample = 1, reset = true } = {}) {
  await initHash();
  clearMetaCache();
  await speedUpCopy();
  const scale = sample > 0 && sample < 1 ? Math.max(1, Math.floor(sample * 1000)) : 1;
  const R = (n) => Math.round(n / scale);
  const nOrdersTotal = Math.round(cfg.rowCounts.orders / scale);

  const baseSeed = process.env.BASE_SEED || 'novashop-course-2026';
  console.log(`[seed] phase=${phase} sample=${sample} reset=${reset} baseSeed=${baseSeed}`);

  if (reset) {
    console.log('[seed] TRUNCATE ... RESTART IDENTITY CASCADE');
    await pool.query(`TRUNCATE TABLE ${ALL_TABLES.join(', ')} RESTART IDENTITY CASCADE`);
  }

  // Phase lớn: drop index phụ + UNIQUE constraint order_items để COPY nhanh (plan 2.3)
  const bigPhase = nOrdersTotal > 200000;
  if (bigPhase) {
    console.log('[seed] dropping secondary indexes + order_items unique constraint...');
    await pool.query(`ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_order_id_product_id_key`);
    await pool.query(DROP_INDEXES_SQL);
  }

  // ---- static tables ----
  const tree = await getCategoryTree(baseSeed);
  console.log(`[seed] categories: ${tree.length}`);
  await copyTable('categories', 'id,name,parent_id', (async function* () {
    for (const c of tree) yield [c.id, c.name, c.parent_id ?? ''];
  })());
  console.log('[seed] categories OK');

  const nProducts = Math.max(200, Math.round((cfg.rowCounts.products ?? 200) * sample));
  const products = await getProducts(baseSeed, nProducts);
  console.log(`[seed] products: ${products.length}`);
  await copyTable('products', 'id,category_id,name,slug,base_price,is_active', (async function* () {
    for (const p of products) yield [p.id, p.category_id, p.name, p.slug, p.base_price, p.is_active ? 't' : 'f'];
  })());
  console.log('[seed] products OK');

  const coupons = await getCoupons(baseSeed, 30);
  console.log(`[seed] coupons: ${coupons.length}`);
  await copyTable('coupons', 'id,code,type,value,min_order_amount,max_discount,applies_to_new_customer,valid_from,valid_to,is_active', (async function* () {
    for (const c of coupons) yield [c.id, c.code, c.type, c.value, c.min_order_amount ?? '', c.max_discount ?? '', c.applies_to_new_customer ? 't' : 'f', c.valid_from, c.valid_to, c.is_active ? 't' : 'f'];
  })());
  console.log('[seed] coupons OK');

  // ---- customers ----
  const nCustomers = R(cfg.rowCounts.customers);
  console.log(`[seed] customers: ${nCustomers}`);
  await copyTable('customers', 'id,full_name,email,phone,current_tier', customers(baseSeed, nCustomers, cfg));

  // ---- orders + con ----
  const nOrders = R(cfg.rowCounts.orders);
  const leafIds = tree.filter((c) => c.parent_id !== null).map((c) => c.id);

  console.log(`[seed] orders: ${nOrders}`);
  await copyTable('orders', 'id,customer_id,coupon_id,order_date,status,payment_method,payment_status,shipping_fee_charged,total_amount,coupon_discount,shipping_address,created_at,updated_at',
    orders(baseSeed, nOrders, cfg, products, coupons, leafIds));

  console.log(`[seed] order_items: ~${nOrders * 2}`);
  await copyTable('order_items', 'id,order_id,product_id,quantity,unit_price,amount',
    orderItems(baseSeed, nOrders, cfg, products, leafIds));

  console.log(`[seed] order_status_history`);
  await copyTable('order_status_history', 'id,order_id,status,changed_at,note',
    orderStatusHistory(baseSeed, nOrders, cfg, products, coupons, leafIds));

  console.log(`[seed] shipments`);
  await copyTable('shipments', 'id,order_id,warehouse_id,carrier,tracking_number,shipping_cost_actual,status,shipped_at,delivered_at,estimated_delivery',
    shipments(baseSeed, nOrders, cfg, products, coupons, leafIds));

  console.log(`[seed] delivery_attempts`);
  await copyTable('delivery_attempts', 'id,shipment_id,attempt_number,attempted_at,result',
    deliveryAttempts(baseSeed, nOrders, cfg, products, coupons, leafIds));

  console.log(`[seed] payments`);
  await copyTable('payments', 'id,order_id,payment_gateway,gateway_txn_id,amount,status,paid_at',
    payments(baseSeed, nOrders, cfg, products, coupons, leafIds));

  console.log(`[seed] cod_remittances`);
  await copyTable('cod_remittances', 'remittance_id,shipment_id,amount_collected,remitted_at,shipper_batch_id',
    codRemittances(baseSeed, nOrders, cfg, products, coupons, leafIds));

  console.log(`[seed] customer_tier_history`);
  await copyTable('customer_tier_history', 'id,customer_id,tier,effective_from',
    customerTierHistory(baseSeed, nOrders, cfg, products, coupons, leafIds));

  console.log(`[seed] order_price_history`);
  await copyTable('order_price_history', 'id,order_id,adjustment_type,amount,reason,adjusted_by,adjusted_at',
    orderPriceHistory(baseSeed, nOrders, cfg, products, coupons, leafIds));

  console.log(`[seed] refunds`);
  buildItemPrefix(baseSeed, nOrders, cfg);
  await copyTable('refunds', 'refund_id,order_item_id,refund_amount,refund_reason,status,requested_at,processed_at',
    refunds(baseSeed, nOrders, cfg, products, coupons, leafIds));

  console.log(`[seed] returns`);
  await copyTable('returns', 'return_id,order_item_id,quantity_returned,return_reason,restocking_fee,received_at',
    returns(baseSeed, nOrders, cfg, products, coupons, leafIds));

  console.log(`[seed] reviews`);
  await copyTable('reviews', 'id,customer_id,product_id,rating,title,content,created_at',
    reviews(baseSeed, nOrders, cfg, products, coupons, leafIds));

  console.log(`[seed] customer_addresses`);
  await copyTable('customer_addresses', 'id,customer_id,label,full_address,province,district,ward,phone,is_default',
    customerAddresses(baseSeed, nCustomers, cfg));

  console.log(`[seed] user_events`);
  await copyTable('user_events', 'id,customer_id,session_id,event_type,event_time,product_id,payload',
    userEvents(baseSeed, nOrders, cfg, products, leafIds));

  // Tạo lại index + constraint sau khi COPY xong (phase lớn)
  if (bigPhase) {
    console.log('[seed] recreating indexes + unique constraint...');
    await pool.query(`ALTER TABLE order_items ADD CONSTRAINT order_items_order_id_product_id_key UNIQUE (order_id, product_id)`);
    await pool.query(CREATE_INDEXES_SQL);
    console.log('[seed] indexes recreated');
  }

  // ---- manifest ----
  const manifest = await buildManifest(phase);
  await writeManifest(phase, manifest);
  console.log('[seed] done, manifest written');
  return manifest;
}

// row count + checksum cơ bản cho verify
const CHECKSUM_COLS = {
  customers: 'COALESCE(SUM(id),0)',
  orders: 'COALESCE(SUM(total_amount),0)',
  order_items: 'COALESCE(SUM(amount),0)',
  reviews: 'COALESCE(SUM(rating),0)',
  payments: 'COALESCE(SUM(amount),0)',
  shipments: 'COALESCE(SUM(shipping_cost_actual),0)',
  refunds: 'COALESCE(SUM(refund_amount),0)',
};

export async function buildManifest(phase) {
  const m = { phase, baseSeed: process.env.BASE_SEED || 'novashop-course-2026', generatedAt: new Date().toISOString(), tables: {} };
  for (const t of ALL_TABLES) {
    const rows = await query(`SELECT COUNT(*)::bigint AS n FROM ${t}`);
    m.tables[t] = { rows: Number(rows[0].n) };
    if (CHECKSUM_COLS[t]) {
      const chk = await query(`SELECT ${CHECKSUM_COLS[t]} AS s FROM ${t}`);
      m.tables[t].checksum = Number(chk[0].s);
    }
  }
  return m;
}

export async function writeManifest(phase, manifest) {
  const dir = process.env.MANIFEST_DIR || '.seed-manifest';
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `manifest-${phase}.json`);
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2));
  console.log(`[manifest] ${file}`);
}

export async function verifyPhase(phase) {
  const dir = process.env.MANIFEST_DIR || '.seed-manifest';
  const file = path.join(dir, `manifest-${phase}.json`);
  if (!fs.existsSync(file)) throw new Error(`Không tìm thấy manifest: ${file}. Chạy db:seed --phase=${phase} trước.`);
  const expected = JSON.parse(fs.readFileSync(file, 'utf8'));
  const actual = await buildManifest(phase);
  const diffs = [];
  for (const t of ALL_TABLES) {
    if (actual.tables[t].rows !== expected.tables[t].rows) diffs.push(`${t}: rows ${expected.tables[t].rows} != ${actual.tables[t].rows}`);
    if (expected.tables[t].checksum !== undefined && actual.tables[t].checksum !== expected.tables[t].checksum) {
      diffs.push(`${t}: checksum ${expected.tables[t].checksum} != ${actual.tables[t].checksum}`);
    }
  }
  if (diffs.length) {
    console.error('[verify] LỆCH:');
    for (const d of diffs) console.error('  - ' + d);
    process.exitCode = 1;
    return false;
  }
  console.log('[verify] OK — khớp manifest y hệt');
  return true;
}

export { ALL_TABLES };
