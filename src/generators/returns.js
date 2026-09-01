// generators/returns.js — sự kiện logistics/tồn kho (Module 17)
// Mỗi đơn 'returned' có 1 return; đôi khi 2 item trả (quantity_returned)
import { hashIntSync, seededBoolSync } from '../seededFaker.js';
import { orderMeta, itemCountFor, itemMeta } from './order-core.js';
import { globalOrderItemId } from './refunds.js';

export async function* returns(baseSeed, nOrders, cfg, products, coupons, leafIds) {
  const target = Math.round((cfg.rowCounts?.returns ?? 2200) || 0);
  let rowId = 0;
  let emitted = 0;
  for (let o = 0; o < nOrders; o++) {
    if (emitted >= target) break;
    const m = orderMeta(baseSeed, o, cfg, products, coupons, leafIds);
    if (m.status !== 'returned') continue;
    const nItems = itemCountFor(baseSeed, o, cfg);
    const j = hashIntSync(`${baseSeed}:ret_item:${o}`) % nItems;
    const meta = itemMeta(baseSeed, o, j, products, leafIds);
    const oiId = globalOrderItemId(o, j);
    const restockFee = seededBoolSync(baseSeed, 'ret_fee', o, 0.2) ? Math.round(meta.amount * 0.1) : 0;
    const receivedAt = new Date(m.orderDateMs + (15 + (hashIntSync(`${baseSeed}:ret_recv:${o}`) % 16)) * 86400000);
    rowId++;
    yield [
      rowId, oiId,
      Math.min(meta.qty, (hashIntSync(`${baseSeed}:ret_qty:${o}`) % meta.qty) + 1),
      ['sai size', 'không ưng', 'hàng lỗi', 'đổi ý', 'giao chậm'][hashIntSync(`${baseSeed}:ret_reason:${o}`) % 5],
      restockFee,
      receivedAt.toISOString(),
    ];
    emitted++;
  }
}
