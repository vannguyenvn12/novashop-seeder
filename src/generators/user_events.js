// generators/user_events.js — log sự kiện hành vi (Module 3 funnel, Module 11 sessionization)
// Cấu trúc phiên: mỗi (customer, session) có chuỗi event view→cart→checkout→paid (có thể thiếu bước)
import { hashIntSync } from '../seededFaker.js';
import { orderMeta } from './order-core.js';

export async function* userEvents(baseSeed, nOrders, cfg, products, leafIds) {
  const target = Math.round((cfg.rowCounts?.user_events ?? 120000) || 0);
  let rowId = 0;
  let emitted = 0;

  for (let o = 0; o < nOrders && emitted < target; o++) {
    const m = orderMeta(baseSeed, o, cfg, products, [], leafIds);
    const cid = m.customerId;
    const sessionId = `SESS-${hashIntSync(`${baseSeed}:ue_sess:${o}`) % 1000000}`;
    const baseTime = m.orderDateMs - 3600000 * (hashIntSync(`${baseSeed}:ue_before:${o}`) % 6);

    // chuỗi sự kiện trước khi đặt: view → (cart) → (checkout) → paid
    const events = [];
    const nViews = 1 + (hashIntSync(`${baseSeed}:ue_nview:${o}`) % 4);
    for (let v = 0; v < nViews; v++) events.push(['view', baseTime + v * 60000, products[hashIntSync(`${baseSeed}:ue_pv:${o}:${v}`) % products.length].id]);
    if (hashIntSync(`${baseSeed}:ue_cart:${o}`) % 100 < 80) events.push(['cart', baseTime + nViews * 60000, products[hashIntSync(`${baseSeed}:ue_pc:${o}`) % products.length].id]);
    if (hashIntSync(`${baseSeed}:ue_checkout:${o}`) % 100 < 90) events.push(['checkout', baseTime + (nViews + 1) * 60000, null]);
    if (m.status !== 'cancelled') events.push(['paid', m.orderDateMs, null]);

    for (const [type, t, pid] of events) {
      if (emitted >= target) break;
      rowId++;
      yield [rowId, cid, sessionId, type, new Date(t).toISOString(), pid ?? '', '{}'];
      emitted++;
    }
  }
}
