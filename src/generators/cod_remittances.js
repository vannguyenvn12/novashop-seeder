// generators/cod_remittances.js — đối soát tiền thu hộ COD (Module 17 Case COD, 18 Case COD)
import { hashIntSync, seededBoolSync } from '../seededFaker.js';
import { orderMeta } from './order-core.js';

export async function* codRemittances(baseSeed, nOrders, cfg, products, coupons, leafIds) {
  const target = Math.round((cfg.rowCounts?.cod_remittances ?? 12000) || 0);
  let rowId = 0;
  let emitted = 0;
  let shipmentId = 0;
  for (let o = 0; o < nOrders; o++) {
    const m = orderMeta(baseSeed, o, cfg, products, coupons, leafIds);
    const multiP = (cfg.messiness?.orders?.multiShipmentPercent ?? 8) / 100;
    const isMulti = seededBoolSync(baseSeed, 'ship_multi', o, multiP) && !m.isCancelled;
    const nShip = isMulti ? 2 + (hashIntSync(`${baseSeed}:ship_n:${o}`) % 2) : 1;
    for (let s = 0; s < nShip; s++) {
      shipmentId++;
      if (!m.isCod || m.status === 'cancelled' || m.status === 'pending') continue;
      if (emitted >= target) break;
      rowId++;
      // giao thành công nhưng chưa remit (10%) → Module 18 Case COD
      const notYetRemitted = seededBoolSync(baseSeed, 'cr_unremitted', shipmentId, 0.1);
      const remittedAt = notYetRemitted
        ? ''
        : new Date(m.orderDateMs + (3 + (hashIntSync(`${baseSeed}:cr_day:${shipmentId}`) % 10)) * 86400000).toISOString();
      yield [
        rowId, shipmentId, m.total,
        remittedAt,
        notYetRemitted ? '' : `BATCH${(hashIntSync(`${baseSeed}:cr_batch:${shipmentId}`) % 5000) + 1}`,
      ];
      emitted++;
    }
    if (emitted >= target) break;
  }
}
