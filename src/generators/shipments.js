// generators/shipments.js — 1 order : N shipments (Module 13)
import { hashIntSync, seededBoolSync } from '../seededFaker.js';
import { orderMeta } from './order-core.js';

const CARRIERS = ['Viettel Post', 'GHN', 'GrabExpress', 'J&T Express', 'Ninja Van'];
const WAREHOUSES = [1, 2, 3, 4, 5]; // 5 kho (outline nhắc "2 kho" khi tách kiện)

export async function* shipments(baseSeed, nOrders, cfg, products, coupons, leafIds) {
  let rowId = 0;
  let globalTracking = 0;
  for (let o = 0; o < nOrders; o++) {
    const m = orderMeta(baseSeed, o, cfg, products, coupons, leafIds);
    // multi-shipment: % đơn (mặc định 8%) bị tách 2-3 kiện từ các kho khác nhau
    const multiP = (cfg.messiness?.orders?.multiShipmentPercent ?? 8) / 100;
    const isMulti = seededBoolSync(baseSeed, 'ship_multi', o, multiP) && !m.isCancelled;
    const nShip = isMulti ? 2 + (hashIntSync(`${baseSeed}:ship_n:${o}`) % 2) : 1; // 2-3

    for (let s = 0; s < nShip; s++) {
      rowId++;
      globalTracking++;
      const carrier = CARRIERS[hashIntSync(`${baseSeed}:ship_car:${o}:${s}`) % CARRIERS.length];
      const warehouse = WAREHOUSES[hashIntSync(`${baseSeed}:ship_wh:${o}:${s}`) % WAREHOUSES.length];
      const cost = (m.shippingFee / nShip) * (0.9 + (hashIntSync(`${baseSeed}:ship_cost:${o}:${s}`) % 20) / 100);

      let status, shippedAt = '', deliveredAt = '', estimated = '';
      if (m.isCancelled) {
        status = 'failed';
      } else {
        status = 'shipped';
        shippedAt = new Date(m.orderDateMs + 24 * 3600000 * (1 + (hashIntSync(`${baseSeed}:ship_sh:${o}:${s}`) % 3))).toISOString();
        estimated = new Date(m.orderDateMs + 5 * 86400000).toISOString();
        if (m.status === 'delivered' || m.status === 'returned') {
          status = 'delivered';
          deliveredAt = new Date(Date.parse(shippedAt) + 3 * 86400000).toISOString();
        } else if (m.status === 'returned') {
          status = 'returned';
        } else if (m.status === 'pending') {
          status = 'pending';
          shippedAt = '';
        }
      }

      yield [
        rowId, m.orderId, warehouse, carrier,
        `VT${String(globalTracking).padStart(10, '0')}`,
        Math.round(cost), status, shippedAt || '', deliveredAt || '', estimated,
      ];
    }
  }
}
