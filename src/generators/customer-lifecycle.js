// customer-lifecycle.js — gán customer_id cho từng đơn theo "vòng đời khách".
//
// Vì sao cần: công thức cũ `1 + idx % 10000` dồn mọi đơn vào 10.000 khách đầu.
// Ở phase 2/3 (5 đơn/khách) điều đó làm gần như mọi khách mua đủ 24/24 tháng,
// không có churn, nên bài Gap & Island (chuỗi tháng mua liên tục) vô nghĩa.
//
// Mô hình (bật bằng cfg.customerLifecycle = true):
//   * mỗi khách có tháng bắt đầu, số tháng gắn bó (đa số ngắn, một ít trung thành lâu),
//     trong khoảng đó mỗi tháng có xác suất nghỉ ⇒ có chuỗi bị gãy 1–2 tháng;
//     hết khoảng đó là ngừng mua (churn), trừ khi khoảng kéo tới tháng cuối của data.
//   * đơn thuộc tháng m chỉ gán cho khách đang "active" tháng m; mỗi khách active
//     nhận ít nhất 1 đơn của tháng đó (nếu tháng đủ đơn), đơn dư rải ngẫu nhiên.
//
// KHÔNG đổi ngày, sản phẩm, tiền của đơn: những thứ đó vẫn derive từ idx như cũ.
// Phase không bật cờ (phase 1) giữ nguyên công thức cũ, data y hệt trước.

import { hashIntSync } from '../seededFaker.js';

const ORDER_DAYS = 730; // khớp `% 730` của od_day trong order-core.js
const DATE_START_UTC = Date.UTC(2024, 0, 1);
const DAY_MS = 86400000;

let state = null; // { months: Int32Array[], rank: Int32Array, monthOfDay: Int8Array }

// Tháng (0 = 01/2024) của từng ngày lệch so với 01/01/2024.
function buildMonthOfDay() {
  const out = new Int8Array(ORDER_DAYS);
  for (let d = 0; d < ORDER_DAYS; d++) {
    const dt = new Date(DATE_START_UTC + d * DAY_MS);
    out[d] = (dt.getUTCFullYear() - 2024) * 12 + dt.getUTCMonth();
  }
  return out;
}

// Số tháng gắn bó: 65% khách ngắn (1–3), 27% trung bình (4–9), 8% trung thành (10–24).
function lifetimeMonths(baseSeed, cid) {
  const seg = hashIntSync(`${baseSeed}:lc_seg:${cid}`) % 100;
  const h = hashIntSync(`${baseSeed}:lc_len:${cid}`);
  if (seg < 65) return 1 + (h % 3);
  if (seg < 92) return 4 + (h % 6);
  return 10 + (h % 15);
}

// Danh sách khách active theo tháng, mỗi tháng xáo trộn ổn định theo hash.
function buildActiveByMonth(baseSeed, nCustomers, nMonths) {
  const lists = Array.from({ length: nMonths }, () => []);
  for (let cid = 1; cid <= nCustomers; cid++) {
    const start = hashIntSync(`${baseSeed}:lc_start:${cid}`) % nMonths;
    const end = Math.min(nMonths - 1, start + lifetimeMonths(baseSeed, cid) - 1);
    for (let m = start; m <= end; m++) {
      // tháng đầu và tháng cuối luôn mua; tháng giữa nghỉ với xác suất 15%
      const skip = m !== start && m !== end && hashIntSync(`${baseSeed}:lc_skip:${cid}:${m}`) % 100 < 15;
      if (!skip) lists[m].push(cid);
    }
  }
  return lists.map((list, m) => {
    const keyed = list.map((cid) => [hashIntSync(`${baseSeed}:lc_shuffle:${cid}:${m}`), cid]);
    keyed.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return Int32Array.from(keyed, (k) => k[1]);
  });
}

/**
 * Gọi một lần mỗi phase, trước khi sinh đơn. Phase không bật cờ thì tắt mô hình.
 * @param {number} nCustomers số khách thật sự seed (đã tính sample)
 * @param {number} nOrders số đơn thật sự seed (đã tính sample)
 */
export function configureCustomerLifecycle(baseSeed, cfg, nCustomers, nOrders) {
  if (!cfg.customerLifecycle) {
    state = null;
    return;
  }
  const monthOfDay = buildMonthOfDay();
  const nMonths = monthOfDay[ORDER_DAYS - 1] + 1;
  const months = buildActiveByMonth(baseSeed, nCustomers, nMonths);

  // Thứ hạng của đơn trong tháng của nó (theo idx tăng dần): đơn thứ k của tháng m
  // gán cho khách active thứ k, nên khách active nào cũng có ít nhất 1 đơn.
  const rank = new Int32Array(nOrders);
  const seen = new Int32Array(nMonths);
  for (let idx = 0; idx < nOrders; idx++) {
    const m = monthOfDay[hashIntSync(`${baseSeed}:od_day:${idx}`) % ORDER_DAYS];
    rank[idx] = seen[m]++;
  }
  const short = months.filter((list, m) => list.length > seen[m]).length;
  if (short > 0) console.warn(`[lifecycle] ${short} tháng có nhiều khách active hơn số đơn`);
  state = { months, rank, monthOfDay };
}

// customer_id của đơn idx. dayOffset là `od_day % 730` đã tính trong order-core.
export function customerIdFor(baseSeed, idx, dayOffset) {
  if (!state) return 1 + (idx % 10000); // công thức gốc, giữ nguyên data phase 1
  const list = state.months[state.monthOfDay[dayOffset]];
  const k = state.rank[idx];
  if (list.length === 0) throw new Error(`[lifecycle] tháng của đơn ${idx} không có khách active`);
  return k < list.length ? list[k] : list[hashIntSync(`${baseSeed}:lc_pick:${idx}`) % list.length];
}
