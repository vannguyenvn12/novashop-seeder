// Nạp lại riêng bảng order_price_history cho một phase, không seed lại cả DB.
// Dùng khi chỉ sửa generator của bảng này: node scripts/reload-order-price-history.js 2
import fs from 'node:fs';
import { pool, copyTable } from '../src/db.js';
import { initHash } from '../src/seededFaker.js';
import { getProducts, getCoupons, getCategoryTree } from '../src/generators/index.js';
import { configureCustomerLifecycle } from '../src/generators/customer-lifecycle.js';
import { orderPriceHistory } from '../src/generators/order_price_history.js';
import { orderPriceHistoryB } from '../src/generators/phase-b-tables.js';

const phase = Number(process.argv[2] || 2);
const cfg = JSON.parse(fs.readFileSync(new URL(`../src/scenarios/phase${phase}.json`, import.meta.url), 'utf8'));
const baseSeed = process.env.BASE_SEED || 'novashop-course-2026';

await initHash();
const tree = await getCategoryTree(baseSeed);
const products = await getProducts(baseSeed, Math.max(200, cfg.rowCounts.products ?? 200));
const coupons = await getCoupons(baseSeed, 30);
const nOrders = cfg.rowCounts.orders;
configureCustomerLifecycle(baseSeed, cfg, cfg.rowCounts.customers, nOrders);
const leafIds = tree.filter((c) => c.parent_id !== null).map((c) => c.id);

await pool.query('TRUNCATE order_price_history RESTART IDENTITY');
const gen = cfg.phaseBRealism ? orderPriceHistoryB : orderPriceHistory;
await copyTable('order_price_history', 'id,order_id,adjustment_type,amount,reason,adjusted_by,adjusted_at',
  gen(baseSeed, nOrders, cfg, products, coupons, leafIds));
await pool.query('VACUUM (ANALYZE, PARALLEL 0) order_price_history');
const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM order_price_history');
console.log(`[reload] order_price_history: ${rows[0].n} dòng`);
await pool.end();
