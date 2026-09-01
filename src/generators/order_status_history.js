// generators/order_status_history.js — lịch sử trạng thái (Module 12)
// TỐI ƯU: yield epoch ms thay vì toISOString() — PG timestamptz nhận epoch ms,
// tránh tạo 22M string object gây GC thrashing.
import { hashIntSync, seededBoolSync } from '../seededFaker.js';
import { orderMeta } from './order-core.js';

const HOUR = 3600000;

function timelineFor(status) {
  switch (status) {
    case 'pending': return ['pending'];
    case 'cancelled': return ['pending', 'confirmed', 'cancelled'];
    case 'returned': return ['pending', 'confirmed', 'packed', 'shipped', 'delivered', 'returned'];
    case 'delivered': return ['pending', 'confirmed', 'packed', 'shipped', 'delivered'];
    case 'shipped': return ['pending', 'confirmed', 'packed', 'shipped'];
    default: return ['pending', 'confirmed'];
  }
}

export async function* orderStatusHistory(baseSeed, nOrders, cfg, products, coupons, leafIds) {
  let rowId = 0;
  const dupP = (cfg.messiness?.shipments?.duplicateShippedEventPercent ?? 3) / 100;
  for (let o = 0; o < nOrders; o++) {
    const m = orderMeta(baseSeed, o, cfg, products, coupons, leafIds);
    const timeline = timelineFor(m.status);
    let t = m.orderDateMs;
    let prevStatus = null;
    for (let s = 0; s < timeline.length; s++) {
      const status = timeline[s];
      if (s > 0) t += HOUR * (1 + (hashIntSync(`${baseSeed}:osh_delay:${o}:${s}`) % 24));
      rowId++;
      if (status === 'shipped' && seededBoolSync(baseSeed, 'osh_dup', o, dupP)) {
        yield [rowId, m.orderId, status, new Date(t).toISOString(), prevStatus ? `từ ${prevStatus}` : ''];
        rowId++;
        t += 5000;
        yield [rowId, m.orderId, status, new Date(t).toISOString(), 'webhook retry'];
      } else {
        yield [rowId, m.orderId, status, new Date(t).toISOString(), prevStatus ? `từ ${prevStatus}` : ''];
      }
      prevStatus = status;
    }
  }
}
