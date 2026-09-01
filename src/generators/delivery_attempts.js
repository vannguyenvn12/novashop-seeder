// generators/delivery_attempts.js — Module 13 BT2: COD bị từ chối, bùng hàng
import { hashIntSync, seededBoolSync } from '../seededFaker.js';
import { orderMeta } from './order-core.js';

export async function* deliveryAttempts(baseSeed, nOrders, cfg, products, coupons, leafIds) {
  const target = Math.round((cfg.rowCounts?.delivery_attempts ?? 35000) || 0);
  let rowId = 0;
  let shipmentId = 0;
  let emitted = 0;
  for (let o = 0; o < nOrders; o++) {
    const m = orderMeta(baseSeed, o, cfg, products, coupons, leafIds);
    const multiP = (cfg.messiness?.orders?.multiShipmentPercent ?? 8) / 100;
    const isMulti = seededBoolSync(baseSeed, 'ship_multi', o, multiP) && !m.isCancelled;
    const nShip = isMulti ? 2 + (hashIntSync(`${baseSeed}:ship_n:${o}`) % 2) : 1;
    for (let s = 0; s < nShip; s++) {
      shipmentId++;
      if (m.isCancelled || m.status === 'pending') continue; // chưa giao
      // số lần thử: 1 lần là phổ biến, 5% đơn 2-3 lần (no_answer, refused)
      const nAttempt = seededBoolSync(baseSeed, 'da_multi', shipmentId, 0.05) ? 2 + (hashIntSync(`${baseSeed}:da_n:${shipmentId}`) % 2) : 1;
      let t = m.orderDateMs + 24 * 3600000;
      for (let a = 0; a < nAttempt; a++) {
        const refused = m.status === 'returned' && a === nAttempt - 1;
        const result = refused ? 'refused' : a < nAttempt - 1 ? (['no_answer', 'wrong_address'][hashIntSync(`${baseSeed}:da_r:${shipmentId}:${a}`) % 2]) : 'success';
        rowId++;
        yield [rowId, shipmentId, a + 1, new Date(t).toISOString(), result];
        t += 24 * 3600000;
        emitted++;
      }
    }
    if (emitted >= target) break;
  }
}
