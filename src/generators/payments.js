// generators/payments.js — thanh toán & đối soát gateway (Module 18)
import { hashIntSync, seededBoolSync } from '../seededFaker.js';
import { orderMeta } from './order-core.js';

const GATEWAYS = ['VNPay', 'MoMo', 'ZaloPay', 'ShopeePay', 'VietQR'];

export async function* payments(baseSeed, nOrders, cfg, products, coupons, leafIds) {
  const target = Math.round((cfg.rowCounts?.payments ?? 27000) || 0);
  let rowId = 0;
  let emitted = 0;
  let txnCounter = 0;
  for (let o = 0; o < nOrders; o++) {
    if (emitted >= target) break;
    const m = orderMeta(baseSeed, o, cfg, products, coupons, leafIds);
    if (m.isCod) continue; // COD không qua gateway
    txnCounter++;
    rowId++;
    const gateway = GATEWAYS[hashIntSync(`${baseSeed}:pay_gw:${o}`) % GATEWAYS.length];
    const amount = m.total + (hashIntSync(`${baseSeed}:pay_amt:${o}`) % 5 === 0 ? 3000 : 0); // lẻ phí
    // mismatch: 1-2% đơn có gateway txn nhưng orders không thấy (hoặc ngược lại) → Module 18
    const mismatch = seededBoolSync(baseSeed, 'pay_mismatch', o, (cfg.messiness?.payments?.gatewayMismatchPercent ?? 1) / 100);
    const status = mismatch ? 'failed' : 'success';
    yield [
      rowId, m.orderId, gateway,
      `GW${String(txnCounter).padStart(12, '0')}`,
      amount, status,
      m.orderDateMs ? new Date(m.orderDateMs).toISOString() : '',
    ];
    emitted++;
  }
}
