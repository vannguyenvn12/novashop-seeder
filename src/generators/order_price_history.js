// generators/order_price_history.js — mọi điều chỉnh giá trị đơn sau khi tạo (Module 16 Case 2)
import { hashIntSync, seededBoolSync } from '../seededFaker.js';
import { orderMeta } from './order-core.js';

const ADJUSTMENTS = [
  { type: 'goodwill', pct: 35, reason: 'Goodwill discount cho khách phàn nàn', by: 'CS' },
  { type: 'price_match', pct: 25, reason: 'Price-match với đối thủ', by: 'Sales' },
  { type: 'tax_correction', pct: 15, reason: 'Sửa lỗi tính thuế', by: 'Finance' },
  { type: 'coupon_retroactive', pct: 15, reason: 'Áp coupon retroactive khi khách quên nhập mã', by: 'CS' },
  { type: 'other', pct: 10, reason: 'Điều chỉnh khác', by: 'CS' },
];

export async function* orderPriceHistory(baseSeed, nOrders, cfg, products, coupons, leafIds) {
  const target = Math.round((cfg.rowCounts?.order_price_history ?? 6000) || 0);
  const pct = cfg.messiness?.orders?.priceAdjustPercent ?? 12;
  let rowId = 0;
  let emitted = 0;
  for (let o = 0; o < nOrders; o++) {
    if (emitted >= target) break;
    const m = orderMeta(baseSeed, o, cfg, products, coupons, leafIds);
    if (m.status === 'cancelled') continue;
    if (!seededBoolSync(baseSeed, 'oph_adjust', o, pct / 100)) continue;
    // amount âm (giảm giá trị đơn) 80%, có thể dương (sửa lỗi tăng)
    const negative = hashIntSync(`${baseSeed}:oph_sign:${o}`) % 100 < 80;
    const absVal = ((hashIntSync(`${baseSeed}:oph_amt:${o}`) % 20) + 1) * 10000; // 10k..200k
    const adj = ADJUSTMENTS[hashIntSync(`${baseSeed}:oph_type:${o}`) % ADJUSTMENTS.length];
    const daysAfter = 1 + (hashIntSync(`${baseSeed}:oph_day:${o}`) % 30);
    const adjustedAt = new Date(m.orderDateMs + daysAfter * 86400000);
    rowId++;
    yield [rowId, m.orderId, adj.type, negative ? -absVal : absVal, adj.reason, adj.by, adjustedAt.toISOString()];
    emitted++;
  }
}
