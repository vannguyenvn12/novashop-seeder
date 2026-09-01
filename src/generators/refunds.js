// generators/refunds.js — sự kiện tài chính (Module 17)
// return window 15-30 ngày → refund thường rơi vào tháng sau đơn hàng
import { hashIntSync, seededBoolSync } from '../seededFaker.js';
import { orderMeta, itemCountFor, itemMeta } from './order-core.js';

// Prefix sum item count — tránh O(n²) khi tính global id của order_item
// (với 5M đơn, vòng lặp từng đơn mỗi lần gọi là chết).
let itemPrefix = null;
export function buildItemPrefix(baseSeed, nOrders, cfg) {
  itemPrefix = [0];
  for (let k = 0; k < nOrders; k++) itemPrefix.push(itemPrefix[k] + itemCountFor(baseSeed, k, cfg));
}

// global id của order_item thứ j trong đơn o (khớp với generator order_items) — O(1)
export function globalOrderItemId(o, j) {
  return itemPrefix[o] + j + 1;
}

export async function* refunds(baseSeed, nOrders, cfg, products, coupons, leafIds) {
  const target = Math.round((cfg.rowCounts?.refunds ?? 2500) || 0);
  let rowId = 0;
  let emitted = 0;
  for (let o = 0; o < nOrders; o++) {
    if (emitted >= target) break;
    const m = orderMeta(baseSeed, o, cfg, products, coupons, leafIds);
    if (m.status !== 'returned') continue;
    const nItems = itemCountFor(baseSeed, o, cfg);
    const j = hashIntSync(`${baseSeed}:ref_item:${o}`) % nItems;
    const meta = itemMeta(baseSeed, o, j, products, leafIds);
    const oiId = globalOrderItemId(o, j);
    const requestedAt = new Date(m.orderDateMs + (15 + (hashIntSync(`${baseSeed}:ref_reqday:${o}`) % 16)) * 86400000); // 15-30 ngày
    const pending = seededBoolSync(baseSeed, 'ref_pending', o, (cfg.messiness?.refunds?.pendingPercent ?? 30) / 100);
    const processedAt = pending ? null : new Date(requestedAt.getTime() + (1 + (hashIntSync(`${baseSeed}:ref_proc:${o}`) % 5)) * 86400000);
    rowId++;
    yield [
      rowId, oiId, meta.amount,
      'khách trả hàng',
      pending ? 'requested' : 'processed',
      requestedAt.toISOString(),
      processedAt ? processedAt.toISOString() : '',
    ];
    emitted++;
  }
}
