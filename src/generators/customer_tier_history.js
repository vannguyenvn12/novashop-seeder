// generators/customer_tier_history.js — lịch sử đổi hạng thành viên (Module 16 Case 1)
import { hashIntSync } from '../seededFaker.js';
import { orderMeta } from './order-core.js';

const TIER_ORDER = ['standard', 'silver', 'gold', 'platinum'];

export async function* customerTierHistory(baseSeed, nOrders, cfg, products, coupons, leafIds) {
  const target = Math.round((cfg.rowCounts?.customer_tier_history ?? 22000) || 0);
  let rowId = 0;
  let emitted = 0;

  // customerId -> ngày đơn ĐẦU TIÊN (ms) (để hạng bắt đầu hợp lý)
  const firstOrder = new Map();
  for (let o = 0; o < nOrders; o++) {
    const m = orderMeta(baseSeed, o, cfg, products, coupons, leafIds);
    const cid = m.customerId;
    if (!firstOrder.has(cid) || m.orderDateMs < firstOrder.get(cid)) firstOrder.set(cid, m.orderDateMs);
  }

  for (let cid = 1; cid <= 10000 && emitted < target; cid++) {
    if (!firstOrder.has(cid)) continue;
    const start = new Date(firstOrder.get(cid));
    // số lần thăng hạng: 0-3 (khách siêng mua thì lên cao)
    const nUp = hashIntSync(`${baseSeed}:cth_up:${cid}`) % 4;
    let tier = 'standard';
    let eff = new Date(start);
    for (let e = 0; e <= nUp; e++) {
      if (e > 0) {
        tier = TIER_ORDER[Math.min(TIER_ORDER.indexOf(tier) + 1, TIER_ORDER.length - 1)];
        eff = new Date(eff.getTime() + (30 + (hashIntSync(`${baseSeed}:cth_step:${cid}:${e}`) % 90)) * 86400000);
        // không vượt quá hôm nay
        if (eff.getTime() > Date.now()) break;
      }
      rowId++;
      yield [rowId, cid, tier, eff.toISOString()];
      emitted++;
    }
  }
}
