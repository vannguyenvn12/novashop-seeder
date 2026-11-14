// realism.js — quy tắc dùng chung cho data "Phase B" (Module 11–18), bật bằng cfg.phaseBRealism.
//
// Vì sao cần: bản cũ sinh các bảng con (shipments, payments, user_events...) đủ cho phase 1
// nhưng thiếu những tình huống mà Module 11–18 dạy: đơn đang giao dở, kiện hoàn, COD bùng hàng,
// shipper remit thiếu, giao dịch gateway lệch, phiên duyệt web có quãng nghỉ 5–60 phút,
// nhiều tài khoản chung địa chỉ/thiết bị.
//
// Nguyên tắc: KHÔNG đổi ngày, tiền, sản phẩm, khách, trạng thái hủy của đơn. Chỉ đổi:
//   * trạng thái của đơn trong 30 ngày cuối data (đang giao dở / chưa kịp trả hàng),
//   * nội dung các bảng con.
// Phase không bật cờ (phase 1) giữ y hệt trước.

import { hashIntSync, seededBoolSync } from '../seededFaker.js';
import { itemCountFor } from './order-core.js'; // vòng import an toàn: chỉ gọi trong hàm

// "Hôm nay" của data: mọi trạng thái được chụp tại 00:00 ngày 01/01/2026 (giờ VN).
export const DATA_NOW_MS = Date.parse('2026-01-01T00:00:00+07:00');
export const HOUR_MS = 3600000;
export const DAY_MS = 86400000;

// Trạng thái đơn trong 5 ngày cuối data: đơn càng mới càng dễ đang dở dang.
export function inFlightStatus(baseSeed, idx, dataAgeDays) {
  const pDelivered = dataAgeDays < 1 ? 0 : dataAgeDays < 2 ? 0.3 : dataAgeDays < 3 ? 0.7 : 0.9;
  if (seededBoolSync(baseSeed, 'rb_deliv', idx, pDelivered)) return 'delivered';
  if (dataAgeDays < 0.25) return 'pending';
  if (dataAgeDays < 1) return hashIntSync(`${baseSeed}:rb_conf:${idx}`) % 100 < 30 ? 'pending' : 'confirmed';
  if (dataAgeDays < 1.5) return 'packed';
  return 'shipped';
}

// COD bùng hàng: đơn COD bị hủy sau khi đã giao cho shipper, vì khách từ chối nhận.
// Một nhóm nhỏ khách hay bùng hàng (2%) thì gần như đơn COD hủy nào cũng là bùng.
export function isRefusedCod(baseSeed, idx, m) {
  if (!m.isCancelled || !m.isCod) return false;
  const serial = seededBoolSync(baseSeed, 'rb_serial_refuser', m.customerId, 0.02);
  return seededBoolSync(baseSeed, 'rb_refused', idx, serial ? 0.95 : 0.4);
}

// Số kiện của đơn: chỉ đơn nhiều sản phẩm mới bị tách, tối đa bằng số sản phẩm (2–3 kiện).
export function shipmentCountRealistic(baseSeed, idx, cfg, m) {
  if (m.isCancelled && !isRefusedCod(baseSeed, idx, m)) return 1;
  const nItems = itemCountFor(baseSeed, idx, cfg);
  if (nItems < 2) return 1;
  if (!seededBoolSync(baseSeed, 'rb_ship_multi', idx, 0.3)) return 1;
  return Math.min(nItems, 2 + (hashIntSync(`${baseSeed}:rb_ship_n:${idx}`) % 2));
}

// Khoảng cách giữa hai sự kiện liên tiếp trong một lần ghé web (giây).
// Phần lớn vài giây tới vài phút; một ít dừng lâu (đi pha cà phê) 16–55 phút
// để ngưỡng session 15/30/60 phút cho ra số phiên khác nhau.
export function eventGapSeconds(baseSeed, key) {
  const r = hashIntSync(`${baseSeed}:rb_gap:${key}`) % 100;
  const h = hashIntSync(`${baseSeed}:rb_gapv:${key}`);
  if (r < 70) return 10 + (h % 230); // 10s – 4 phút
  if (r < 90) return 240 + (h % 600); // 4 – 14 phút
  if (r < 96) return 960 + (h % 720); // 16 – 28 phút
  return 1860 + (h % 1440); // 31 – 55 phút
}

// Chuỗi trả hàng của một đơn (mốc tính từ order_date): khách yêu cầu → kho nhận hàng → hoàn tiền.
// Đơn chỉ thành 'returned' khi kho đã nhận hàng trước DATA_NOW, nên tỷ lệ trả hàng của
// mấy tuần cuối data thấp giả tạo (đơn chưa kịp trả), đúng bẫy "chưa đủ return window".
export function returnPlan(baseSeed, idx) {
  const h = (k) => hashIntSync(`${baseSeed}:rb_ret_${k}:${idx}`);
  const requestedOff = (8 + (h('req') % 10)) * DAY_MS + (h('reqh') % 12) * HOUR_MS; // 8–17 ngày sau khi đặt
  const receivedOff = requestedOff + (2 + (h('recv') % 5)) * DAY_MS; // kho nhận sau 2–6 ngày
  const late = h('late') % 100 < 15; // 15% xử lý chậm, vượt SLA 5 ngày
  const processedOff = receivedOff + (late ? 5 + (h('proc') % 6) : h('proc') % 4) * DAY_MS + (h('proch') % 8) * HOUR_MS;
  const r = h('fate') % 100;
  return { requestedOff, receivedOff, processedOff, rejected: r < 5, stuck: r >= 5 && r < 9 };
}

// Co giãn các mốc (ms, tăng dần, tính từ start) để mốc cuối không vượt endMs.
export function fitBefore(startMs, offsets, endMs) {
  const last = offsets[offsets.length - 1] || 0;
  const room = endMs - startMs;
  if (last <= room || last === 0) return offsets.map((x) => startMs + x);
  const k = Math.max(0, room * 0.95) / last;
  return offsets.map((x) => startMs + Math.floor(x * k));
}
