// generators/coupons.js — coupon chào mừng khách mới + coupon thường
import { uniqueHashId, seededBool } from '../seededFaker.js';

const COUPON_TYPES = [
  { type: 'percent', value: 10, min: 200000, max: 100000, new: true },
  { type: 'percent', value: 15, min: 300000, max: 150000, new: false },
  { type: 'fixed', value: 50000, min: 300000, max: null, new: false },
  { type: 'fixed', value: 100000, min: 500000, max: null, new: false },
  { type: 'free_ship', value: 0, min: 150000, max: 50000, new: false },
];

export async function getCoupons(baseSeed, nCoupons) {
  const rows = [];
  const used = new Set();
  for (let i = 0; i < nCoupons; i++) {
    const t = COUPON_TYPES[i % COUPON_TYPES.length];
    rows.push({
      id: await uniqueHashId(baseSeed, 'coupons', i, used),
      code: `NOVASHOP${String(i + 1).padStart(3, '0')}`,
      type: t.type,
      value: t.value,
      min_order_amount: t.min,
      max_discount: t.max,
      applies_to_new_customer: t.new,
      valid_from: '2024-01-01 00:00:00+07',
      valid_to: '2027-12-31 23:59:59+07',
      is_active: await seededBool(baseSeed, 'coupons', i, 0.95),
    });
  }
  return rows;
}

export function couponAt(rows, index) {
  return rows[index % rows.length];
}
