// phase-b-behavior.js — user_events và customer_addresses cho phase B (cfg.phaseBRealism).
//
// user_events (Module 11 sessionization, Module 14 BT):
//   * mỗi đơn có một lần ghé web trước khi mua: xem vài sản phẩm, bỏ giỏ từng món, checkout, paid
//     (paid trùng giây với order_date). Khoảng cách giữa hai sự kiện phần lớn vài phút, đôi khi
//     dừng 16–55 phút (eventGapSeconds) nên ngưỡng 15/30/60 phút cho số phiên khác nhau.
//   * 30% đơn có thêm một lần ghé chỉ xem, 2–20 giờ trước khi mua: nhiều lần ghé trong cùng một ngày.
//   * session_id là mã đăng nhập app trên từng thiết bị, sống tới khi đăng xuất (APP-<khách>-<máy>),
//     KHÔNG phải một phiên duyệt web; payload.device_id là mã thiết bị.
// customer_addresses (Module 14 Case 2): mọi khách 1–2 địa chỉ; nhóm dùng chung lấy từ account-sharing.js,
//   chuỗi địa chỉ của từng thành viên lệch nhau kiểu gõ tay (hoa/thường, thừa khoảng trắng).

import { hashIntSync } from '../seededFaker.js';
import { orderMeta, itemCountFor, itemMeta, makeAddress } from './order-core.js';
import { eventGapSeconds, DATA_NOW_MS } from './realism.js';
import { sharingGroup, deviceCode, deviceIndexFor, phoneFor } from './account-sharing.js';

function deviceFor(baseSeed, cid, visitKey) {
  const g = sharingGroup(cid);
  const d = deviceIndexFor(baseSeed, cid, visitKey);
  if (g?.device && d === 0) return { device: g.device, session: `APP-${g.device}-${cid}` };
  return { device: deviceCode(baseSeed, `${cid}:${d}`), session: `APP-${cid}-${d + 1}` };
}

export async function* userEventsB(baseSeed, nOrders, cfg, products, coupons, leafIds) {
  let rowId = 0;
  for (let o = 0; o < nOrders; o++) {
    const m = orderMeta(baseSeed, o, cfg, products, coupons, leafIds);
    const cid = m.customerId;

    // --- lần ghé có mua ---
    const nItems = itemCountFor(baseSeed, o, cfg);
    const seq = [];
    const extra = hashIntSync(`${baseSeed}:rb_ue_extra:${o}`) % 3;
    for (let v = 0; v < extra; v++) seq.push(['view', products[hashIntSync(`${baseSeed}:rb_ue_pv:${o}:${v}`) % products.length].id]);
    for (let j = 0; j < nItems; j++) {
      const pid = itemMeta(baseSeed, o, j, products, leafIds).product.id;
      seq.push(['view', pid], ['cart', pid]);
    }
    seq.push(['checkout', null]);
    if (!m.isCancelled) seq.push(['paid', null]);
    // lùi từ order_date về trước
    const times = new Array(seq.length);
    times[seq.length - 1] = m.orderDateMs;
    for (let e = seq.length - 2; e >= 0; e--) times[e] = times[e + 1] - eventGapSeconds(baseSeed, `${o}:${e}`) * 1000;
    const buy = deviceFor(baseSeed, cid, `${o}:buy`);
    const payload = (dev) => JSON.stringify({ device_id: dev });
    for (let e = 0; e < seq.length; e++) {
      yield [++rowId, cid, buy.session, seq[e][0], new Date(times[e]).toISOString(), seq[e][1] ?? '', payload(buy.device)];
    }

    // --- lần ghé chỉ xem, cùng ngày hoặc tối hôm trước ---
    if (hashIntSync(`${baseSeed}:rb_ue_browse:${o}`) % 100 < 30) {
      const before = (2 + (hashIntSync(`${baseSeed}:rb_ue_bh:${o}`) % 19)) * 3600000 + (hashIntSync(`${baseSeed}:rb_ue_bm:${o}`) % 60) * 60000;
      let t = m.orderDateMs - before;
      const nView = 2 + (hashIntSync(`${baseSeed}:rb_ue_bn:${o}`) % 5);
      const br = deviceFor(baseSeed, cid, `${o}:browse`);
      for (let v = 0; v < nView && t < DATA_NOW_MS; v++) {
        if (v > 0) t += eventGapSeconds(baseSeed, `${o}:b${v}`) * 1000;
        const pid = products[hashIntSync(`${baseSeed}:rb_ue_bp:${o}:${v}`) % products.length].id;
        yield [++rowId, cid, br.session, 'view', new Date(t).toISOString(), pid, payload(br.device)];
      }
    }
  }
}

function typoVariant(baseSeed, cid, full) {
  switch (hashIntSync(`${baseSeed}:rb_addr_var:${cid}`) % 4) {
    case 1: return full.toUpperCase();
    case 2: return full.replace(/, /g, ',  ');
    case 3: return ` ${full.toLowerCase()} `;
    default: return full;
  }
}

export async function* customerAddressesB(baseSeed, nCustomers) {
  let rowId = 0;
  for (let cid = 1; cid <= nCustomers; cid++) {
    const g = sharingGroup(cid);
    const nAddr = 1 + (hashIntSync(`${baseSeed}:rb_cad_n:${cid}`) % 2);
    for (let a = 0; a < nAddr; a++) {
      const own = makeAddress(baseSeed, 1000000 + cid * 2 + a);
      const shared = a === 0 && g;
      const addr = shared ? g.addr : own;
      const full = shared ? typoVariant(baseSeed, cid, addr.full) : addr.full;
      const phone = shared && g.phone ? g.phone : phoneFor(baseSeed, `c${cid}`);
      yield [++rowId, cid, a === 0 ? 'Nhà riêng' : 'Công ty', full, addr.province, addr.district, addr.ward, phone, a === 0 ? 't' : 'f'];
    }
  }
}
