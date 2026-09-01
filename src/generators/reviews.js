// generators/reviews.js — đánh giá sản phẩm (Module 6: NULL customer_id trap)
import { hashIntSync, seededBoolSync } from '../seededFaker.js';
import { orderMeta, itemCountFor, itemMeta } from './order-core.js';

export async function* reviews(baseSeed, nOrders, cfg, products, coupons, leafIds) {
  const target = Math.round((cfg.rowCounts?.reviews ?? 15000) || 0);
  let rowId = 0;
  let emitted = 0;
  const nullP = (cfg.messiness?.reviews?.nullCustomerPercent ?? 8) / 100;
  for (let o = 0; o < nOrders; o++) {
    if (emitted >= target) break;
    const m = orderMeta(baseSeed, o, cfg, products, coupons, leafIds);
    if (m.status !== 'delivered') continue;
    const nItems = itemCountFor(baseSeed, o, cfg);
    const j = hashIntSync(`${baseSeed}:rev_item:${o}`) % nItems;
    const meta = itemMeta(baseSeed, o, j, products, leafIds);
    // rating: 70% 4-5 sao, 20% 3, 10% 1-2 (phân phối thiên về hài lòng, vẫn có chê)
    const r = hashIntSync(`${baseSeed}:rev_rating:${o}`) % 100;
    const rating = r < 70 ? 4 + (r % 2) : r < 90 ? 3 : 1 + (r % 2);
    const customerId = seededBoolSync(baseSeed, 'rev_null', o, nullP) ? '' : m.customerId;
    const created = new Date(m.orderDateMs + (3 + (hashIntSync(`${baseSeed}:rev_day:${o}`) % 20)) * 86400000);
    rowId++;
    yield [
      rowId, customerId, meta.product.id, rating,
      ['Tốt', 'Đáng mua', 'Sản phẩm ổn', 'Giao nhanh', 'Chất lượng kém', ''][hashIntSync(`${baseSeed}:rev_title:${o}`) % 6],
      '',
      created.toISOString(),
    ];
    emitted++;
  }
}
