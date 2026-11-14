// phase-b-tables.js — các bảng con theo quy tắc realism.js (cfg.phaseBRealism), dùng cho Module 11–18.
//
// Mỗi đơn có một "kịch bản" tính lại được từ idx: dòng thời gian trạng thái, danh sách kiện,
// lần giao, tiền thu hộ. Mọi bảng đọc cùng kịch bản nên khớp nhau:
//   order_status_history.shipped ≈ shipments.shipped_at, delivery_attempts cuối = delivered_at, ...
// Không giới hạn số dòng theo rowCounts: cắt giữa chừng làm đơn cuối danh sách thiếu dữ liệu con.

import { hashIntSync, seededBoolSync } from '../seededFaker.js';
import { orderMeta, itemCountFor, itemMeta } from './order-core.js';
import { globalOrderItemId } from './refunds.js';
import {
  DATA_NOW_MS, HOUR_MS, DAY_MS,
  isRefusedCod, shipmentCountRealistic, returnPlan, fitBefore,
} from './realism.js';

const CARRIERS = ['Viettel Post', 'GHN', 'GrabExpress', 'J&T Express', 'Ninja Van'];
const CARRIER_CODES = { 'Viettel Post': 'VTP', GHN: 'GHN', GrabExpress: 'GRAB', 'J&T Express': 'JNT', 'Ninja Van': 'NJV' };
const GATEWAYS = ['VNPay', 'MoMo', 'ZaloPay', 'ShopeePay', 'VietQR'];
const RETURN_REASONS = ['sai size', 'không ưng', 'hàng lỗi', 'đổi ý', 'giao chậm'];

// Khoảng chờ (giờ) trước khi chuyển sang trạng thái này.
const STEP_HOURS = {
  confirmed: [0.2, 6], packed: [2, 24], shipped: [4, 30], delivered: [24, 96], cancelled: [1, 48],
};

function hoursIn(baseSeed, key, [a, b]) {
  return (a + ((hashIntSync(`${baseSeed}:${key}`) % 1000) / 1000) * (b - a)) * HOUR_MS;
}

function statusesFor(m, refused, baseSeed, idx) {
  switch (m.status) {
    case 'pending': return ['pending'];
    case 'confirmed': return ['pending', 'confirmed'];
    case 'packed': return ['pending', 'confirmed', 'packed'];
    case 'shipped': return ['pending', 'confirmed', 'packed', 'shipped'];
    case 'delivered': return ['pending', 'confirmed', 'packed', 'shipped', 'delivered'];
    case 'returned': return ['pending', 'confirmed', 'packed', 'shipped', 'delivered', 'returned'];
    case 'cancelled':
      if (refused) return ['pending', 'confirmed', 'packed', 'shipped', 'cancelled'];
      return hashIntSync(`${baseSeed}:rb_cancel_early:${idx}`) % 100 < 30 ? ['pending', 'cancelled'] : ['pending', 'confirmed', 'cancelled'];
    default: return ['pending'];
  }
}

// Dòng thời gian trạng thái: [{ status, t }]. 4% đơn (không trả hàng) bị treo thêm 2–6 ngày ở một khâu.
export function orderTimeline(baseSeed, idx, m) {
  const refused = isRefusedCod(baseSeed, idx, m);
  const statuses = statusesFor(m, refused, baseSeed, idx);
  const stuck = !m.isReturnCandidate && seededBoolSync(baseSeed, 'rb_stuck', idx, 0.04);
  const stuckStep = 1 + (hashIntSync(`${baseSeed}:rb_stuck_step:${idx}`) % 3); // confirmed / packed / shipped
  const offsets = [0];
  let acc = 0;
  for (let s = 1; s < statuses.length; s++) {
    const st = statuses[s];
    if (st === 'returned') {
      acc = Math.max(acc + HOUR_MS, returnPlan(baseSeed, idx).receivedOff);
    } else {
      const range = st === 'cancelled' && refused ? [48, 120] : STEP_HOURS[st];
      acc += hoursIn(baseSeed, `rb_step:${idx}:${s}`, range);
      if (stuck && s === stuckStep) acc += (48 + (hashIntSync(`${baseSeed}:rb_stuck_h:${idx}`) % 102)) * HOUR_MS;
    }
    offsets.push(acc);
  }
  const times = fitBefore(m.orderDateMs, offsets, DATA_NOW_MS - 60000);
  return { refused, steps: statuses.map((status, i) => ({ status, t: times[i] })) };
}

function stepTime(tl, status) {
  const s = tl.steps.find((x) => x.status === status);
  return s ? s.t : null;
}

// Danh sách kiện của đơn, kèm lần giao và mốc giao.
export function shipmentPlan(baseSeed, idx, cfg, m) {
  const tl = orderTimeline(baseSeed, idx, m);
  const n = shipmentCountRealistic(baseSeed, idx, cfg, m);
  const tShipped = stepTime(tl, 'shipped');
  const tDelivered = stepTime(tl, 'delivered');
  const tCancelled = stepTime(tl, 'cancelled');
  const returnedKien = hashIntSync(`${baseSeed}:rb_ret_kien:${idx}`) % n;
  const whBase = hashIntSync(`${baseSeed}:rb_wh:${idx}`) % 5;
  const out = [];
  for (let k = 0; k < n; k++) {
    const h = (key) => hashIntSync(`${baseSeed}:rb_${key}:${idx}:${k}`);
    const carrier = CARRIERS[h('car') % CARRIERS.length];
    const warehouse = 1 + ((whBase + k) % 5); // mỗi kiện một kho khác nhau
    const costRatio = n === 1 ? 0.55 + (h('cost') % 46) / 100 : 0.4 + (h('cost') % 36) / 100;
    const cost = Math.round((m.shippingFee * costRatio) / 1000) * 1000;
    const kien = { carrier, warehouse, cost, status: 'pending', shippedAt: null, deliveredAt: null, estimated: null, attempts: [] };
    out.push(kien);

    if (m.isCancelled && !tl.refused) { kien.status = 'failed'; continue; }
    if (tShipped === null) { kien.estimated = m.orderDateMs + 5 * DAY_MS; continue; } // chưa xuất kho

    kien.shippedAt = Math.min(tShipped + (k === 0 ? 0 : (h('shoff') % 20) * HOUR_MS), DATA_NOW_MS - HOUR_MS);
    kien.estimated = kien.shippedAt + 3 * DAY_MS;

    if (tl.refused) {
      // khách từ chối nhận: shipper thử 1–3 lần rồi hoàn kiện về kho
      kien.status = 'returned';
      const nAtt = 1 + (h('natt') % 3);
      const span = (tCancelled ?? kien.shippedAt + 2 * DAY_MS) - kien.shippedAt;
      for (let a = 0; a < nAtt; a++) {
        kien.attempts.push({ t: kien.shippedAt + Math.floor((span * (a + 1)) / (nAtt + 1)), result: a === nAtt - 1 ? 'refused' : 'no_answer' });
      }
      continue;
    }

    if (m.status === 'shipped') {
      // đơn đang giao dở: kiện đầu chắc chắn chưa tới, kiện sau có thể đã tới
      const pick = k === 0 ? h('st') % 3 : h('st') % 6;
      const st = ['shipped', 'in_transit', 'out_for_delivery', 'delivered', 'delivered', 'delivered'][pick];
      kien.status = st;
      if (st === 'delivered') {
        kien.deliveredAt = Math.min(kien.shippedAt + (12 + (h('dl') % 36)) * HOUR_MS, DATA_NOW_MS - 60000);
        kien.attempts.push({ t: kien.deliveredAt, result: 'success' });
      } else if (st === 'out_for_delivery' && h('ofd') % 100 < 30) {
        kien.attempts.push({ t: Math.min(kien.shippedAt + 20 * HOUR_MS, DATA_NOW_MS - 60000), result: 'no_answer' });
      }
      continue;
    }

    // delivered / returned: kiện cuối tới đúng lúc đơn 'delivered', kiện khác tới sớm hơn
    kien.status = m.status === 'returned' && k === returnedKien ? 'returned' : 'delivered';
    const early = k === n - 1 ? 0 : (h('early') % 30) * HOUR_MS;
    kien.deliveredAt = Math.max(tDelivered - early, kien.shippedAt + 6 * HOUR_MS);
    const nAtt = h('natt') % 100 < 92 ? 1 : 2 + (h('natt2') % 2);
    for (let a = 0; a < nAtt; a++) {
      const back = (nAtt - 1 - a) * DAY_MS;
      kien.attempts.push({
        t: Math.max(kien.deliveredAt - back, kien.shippedAt + (a + 1) * HOUR_MS),
        result: a === nAtt - 1 ? 'success' : ['no_answer', 'wrong_address'][h(`res${a}`) % 2],
      });
    }
  }
  return out;
}

const iso = (ms) => (ms === null || ms === undefined ? '' : new Date(ms).toISOString());

export async function* orderStatusHistoryB(baseSeed, nOrders, cfg, products, coupons, leafIds) {
  const dupP = (cfg.messiness?.shipments?.duplicateShippedEventPercent ?? 3) / 100;
  let rowId = 0;
  for (let o = 0; o < nOrders; o++) {
    const m = orderMeta(baseSeed, o, cfg, products, coupons, leafIds);
    const tl = orderTimeline(baseSeed, o, m);
    let prev = null;
    for (const { status, t } of tl.steps) {
      const note = status === 'cancelled' && tl.refused ? 'khách từ chối nhận hàng' : prev ? `từ ${prev}` : '';
      yield [++rowId, m.orderId, status, iso(t), note];
      if (status === 'shipped' && seededBoolSync(baseSeed, 'osh_dup', o, dupP)) {
        // webhook hãng vận chuyển gọi lại, cách vài giây
        yield [++rowId, m.orderId, status, iso(t + (2 + (hashIntSync(`${baseSeed}:rb_dup_s:${o}`) % 29)) * 1000), 'webhook retry'];
      }
      prev = status;
    }
  }
}

// shipments, delivery_attempts, cod_remittances duyệt cùng thứ tự đơn → shipment id khớp nhau.
function* eachShipment(baseSeed, nOrders, cfg, products, coupons, leafIds) {
  let shipmentId = 0;
  for (let o = 0; o < nOrders; o++) {
    const m = orderMeta(baseSeed, o, cfg, products, coupons, leafIds);
    const plan = shipmentPlan(baseSeed, o, cfg, m);
    for (let k = 0; k < plan.length; k++) yield { o, m, k, n: plan.length, kien: plan[k], shipmentId: ++shipmentId };
  }
}

export async function* shipmentsB(baseSeed, nOrders, cfg, products, coupons, leafIds) {
  for (const { m, kien, shipmentId } of eachShipment(baseSeed, nOrders, cfg, products, coupons, leafIds)) {
    yield [
      shipmentId, m.orderId, kien.warehouse, kien.carrier, `VT${String(shipmentId).padStart(10, '0')}`,
      kien.cost, kien.status, iso(kien.shippedAt), iso(kien.deliveredAt), iso(kien.estimated),
    ];
  }
}

export async function* deliveryAttemptsB(baseSeed, nOrders, cfg, products, coupons, leafIds) {
  let id = 0;
  for (const { kien, shipmentId } of eachShipment(baseSeed, nOrders, cfg, products, coupons, leafIds)) {
    for (let i = 0; i < kien.attempts.length; i++) {
      yield [++id, shipmentId, i + 1, iso(kien.attempts[i].t), kien.attempts[i].result];
    }
  }
}

// Tiền thu hộ: chia tổng đơn cho các kiện; shipper remit theo đợt (batch = hãng + ngày).
// 3% kiện giao rồi mà không có dòng remit, 3% có dòng nhưng chưa remit, 2% remit thiếu.
export async function* codRemittancesB(baseSeed, nOrders, cfg, products, coupons, leafIds) {
  let rowId = 0;
  for (const { m, k, n, kien, shipmentId } of eachShipment(baseSeed, nOrders, cfg, products, coupons, leafIds)) {
    if (!m.isCod || kien.deliveredAt === null) continue;
    const share = Math.round(m.total / n / 1000) * 1000;
    const due = k < n - 1 ? share : m.total - share * (n - 1);
    const r = hashIntSync(`${baseSeed}:rb_cod_fate:${shipmentId}`) % 100;
    if (r < 3) continue; // shipper không khai báo kiện này
    const remitMs = kien.deliveredAt + (1 + (hashIntSync(`${baseSeed}:rb_cod_day:${shipmentId}`) % 7)) * DAY_MS;
    const notYet = r < 6 || remitMs > DATA_NOW_MS;
    const short = !notYet && r < 8;
    const amount = short ? Math.max(0, due - (1 + (hashIntSync(`${baseSeed}:rb_cod_short:${shipmentId}`) % 10)) * 10000) : due;
    const day = new Date(remitMs + 7 * HOUR_MS).toISOString().slice(0, 10).replace(/-/g, '');
    yield [++rowId, shipmentId, amount, notYet ? '' : iso(remitMs), notYet ? '' : `${CARRIER_CODES[kien.carrier]}-${day}`];
  }
}

// Giao dịch gateway của đơn trả trước. Lệch có chủ đích:
//   1.5% đơn đã thanh toán không có giao dịch nào (webhook mất),
//   1% số tiền lệch, 2% có một lần thất bại trước khi thành công,
//   5% đơn hủy vẫn 'success' ở gateway (chưa hoàn tiền cho khách).
export async function* paymentsB(baseSeed, nOrders, cfg, products, coupons, leafIds) {
  let rowId = 0;
  for (let o = 0; o < nOrders; o++) {
    const m = orderMeta(baseSeed, o, cfg, products, coupons, leafIds);
    if (m.isCod) continue;
    const h = (k) => hashIntSync(`${baseSeed}:rb_pay_${k}:${o}`);
    const gateway = GATEWAYS[h('gw') % GATEWAYS.length];
    const paidAt = m.orderDateMs - (5 + (h('sec') % 85)) * 1000;
    const r = h('fate') % 1000;
    if (m.isCancelled) {
      rowId++;
      yield [rowId, m.orderId, gateway, `GW${String(rowId).padStart(12, '0')}`, m.total, r < 50 ? 'success' : 'refunded', iso(paidAt)];
      continue;
    }
    if (r < 15) continue;
    if (r < 35) {
      rowId++;
      yield [rowId, m.orderId, gateway, `GW${String(rowId).padStart(12, '0')}`, m.total, 'failed', iso(paidAt - (1 + (h('retry') % 5)) * 60000)];
    }
    const amount = r >= 35 && r < 45 ? m.total + ((h('diff') % 2 ? 1 : -1) * (1 + (h('diffv') % 20)) * 1000) : m.total;
    rowId++;
    yield [rowId, m.orderId, gateway, `GW${String(rowId).padStart(12, '0')}`, amount, 'success', iso(paidAt)];
  }
}

// Hoàn tiền + trả hàng cùng một dòng sản phẩm. Hoàn tiền = giá × số lượng trả − phí nhập kho lại.
function returnLine(baseSeed, o, cfg, products, leafIds) {
  const nItems = itemCountFor(baseSeed, o, cfg);
  const j = hashIntSync(`${baseSeed}:rb_ret_item:${o}`) % nItems;
  const it = itemMeta(baseSeed, o, j, products, leafIds);
  const qty = 1 + (hashIntSync(`${baseSeed}:rb_ret_qty:${o}`) % it.qty);
  const goods = it.unitPrice * qty;
  const fee = seededBoolSync(baseSeed, 'rb_ret_fee', o, 0.2) ? Math.round((goods * 0.1) / 1000) * 1000 : 0;
  return { oiId: globalOrderItemId(o, j), qty, goods, fee };
}

export async function* refundsB(baseSeed, nOrders, cfg, products, coupons, leafIds) {
  let rowId = 0;
  for (let o = 0; o < nOrders; o++) {
    const m = orderMeta(baseSeed, o, cfg, products, coupons, leafIds);
    if (!m.isReturnCandidate) continue;
    const p = returnPlan(baseSeed, o);
    const requested = m.orderDateMs + p.requestedOff;
    if (requested > DATA_NOW_MS) continue; // khách chưa yêu cầu tại thời điểm chụp data
    const received = m.orderDateMs + p.receivedOff;
    const processed = m.orderDateMs + p.processedOff;
    const line = returnLine(baseSeed, o, cfg, products, leafIds);
    let status = 'processed';
    let processedAt = processed;
    if (received > DATA_NOW_MS || p.stuck || processed > DATA_NOW_MS) { status = 'requested'; processedAt = null; }
    else if (p.rejected) status = 'rejected';
    const reason = RETURN_REASONS[hashIntSync(`${baseSeed}:rb_ret_reason:${o}`) % RETURN_REASONS.length];
    yield [++rowId, line.oiId, line.goods - line.fee, reason, status, iso(requested), iso(processedAt)];
  }
}

export async function* returnsB(baseSeed, nOrders, cfg, products, coupons, leafIds) {
  let rowId = 0;
  for (let o = 0; o < nOrders; o++) {
    const m = orderMeta(baseSeed, o, cfg, products, coupons, leafIds);
    if (m.status !== 'returned') continue;
    const p = returnPlan(baseSeed, o);
    const line = returnLine(baseSeed, o, cfg, products, leafIds);
    const reason = RETURN_REASONS[hashIntSync(`${baseSeed}:rb_ret_reason:${o}`) % RETURN_REASONS.length];
    yield [++rowId, line.oiId, line.qty, reason, line.fee, iso(m.orderDateMs + p.receivedOff)];
  }
}

// Điều chỉnh giá trị đơn sau khi đặt (Module 16 Case 2). Khoảng 15% đơn không hủy bị điều chỉnh;
// 30% trong số đó bị chỉnh 2–3 lần ở các ngày khác nhau, nên invoice, số chốt sổ và số hôm nay
// có thể là 3 con số khác nhau của cùng một đơn.
// Dấu theo loại: goodwill / price_match / coupon_retroactive luôn giảm; tax_correction, other có thể tăng.
// Không có điều chỉnh nào sau DATA_NOW.
const PRICE_ADJ = [
  { type: 'goodwill', reason: 'Goodwill discount cho khách phàn nàn', by: 'CS', sign: -1 },
  { type: 'price_match', reason: 'Price-match với đối thủ', by: 'Sales', sign: -1 },
  { type: 'tax_correction', reason: 'Sửa lỗi tính thuế', by: 'Finance', sign: 0 },
  { type: 'coupon_retroactive', reason: 'Áp coupon retroactive khi khách quên nhập mã', by: 'CS', sign: -1 },
  { type: 'other', reason: 'Điều chỉnh khác', by: 'CS', sign: 0 },
];

export async function* orderPriceHistoryB(baseSeed, nOrders, cfg, products, coupons, leafIds) {
  const pct = (cfg.messiness?.orders?.priceAdjustPercent ?? 12) / 100;
  let rowId = 0;
  for (let o = 0; o < nOrders; o++) {
    const m = orderMeta(baseSeed, o, cfg, products, coupons, leafIds);
    if (m.isCancelled || !seededBoolSync(baseSeed, 'oph_adjust', o, pct)) continue;
    const r = hashIntSync(`${baseSeed}:rb_oph_n:${o}`) % 100;
    const n = r < 70 ? 1 : r < 92 ? 2 : 3;
    let t = m.orderDateMs;
    for (let a = 0; a < n; a++) {
      const h = (k) => hashIntSync(`${baseSeed}:rb_oph_${k}:${o}:${a}`);
      t += (1 + (h('day') % 15)) * DAY_MS + (h('hour') % 10) * HOUR_MS;
      if (t > DATA_NOW_MS) break;
      const adj = PRICE_ADJ[h('type') % PRICE_ADJ.length];
      const sign = adj.sign || (h('sign') % 100 < 60 ? -1 : 1);
      const amount = sign * (1 + (h('amt') % 20)) * 10000; // 10k..200k
      yield [++rowId, m.orderId, adj.type, amount, adj.reason, adj.by, iso(t)];
    }
  }
}
