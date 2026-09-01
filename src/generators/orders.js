// generators/orders.js — CSV cho bảng orders
import { seededIntSync } from '../seededFaker.js';
import { orderMeta } from './order-core.js';

export async function* orders(baseSeed, n, cfg, products, coupons, leafIds) {
  for (let i = 0; i < n; i++) {
    const m = orderMeta(baseSeed, i, cfg, products, coupons, leafIds);
    const created = new Date(m.orderDateMs);
    const updated = new Date(created.getTime() + 3600000 * seededIntSync(baseSeed, 'od_updated', i, 1, 48));
    yield [
      m.orderId,
      m.customerId,
      m.couponId ?? '',
      created.toISOString(),
      m.status,
      m.paymentMethod,
      m.paymentStatus,
      m.shippingFee,
      m.total,
      m.couponDiscount,
      m.addressFull,
      created.toISOString(),
      updated.toISOString(),
    ];
  }
}
