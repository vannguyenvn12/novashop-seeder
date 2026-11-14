// account-sharing.js — nhóm tài khoản dùng chung địa chỉ / SĐT / thiết bị (Module 14 Case 2), phase B.
//
// Ba loại nhóm, cố ý để "trùng địa chỉ" không đồng nghĩa với gian lận:
//   * hộ gia đình: 2–3 tài khoản liền nhau cùng nhà (3% khách),
//   * ký túc xá / văn phòng: 25 tòa nhà, mỗi tòa vài chục tài khoản (0.2% khách),
//   * nhóm lạm dụng coupon: 4–7 tài khoản mà đơn ĐẦU TIÊN đều dùng coupon khách mới,
//     chung địa chỉ; một nửa nhóm chung cả SĐT, phần lớn chung thiết bị.
// Thành viên nhóm lạm dụng được CHỌN từ data đơn có sẵn, không đổi đơn nào.

import { hashIntSync } from '../seededFaker.js';
import { orderMeta, makeAddress } from './order-core.js';

const BUILDINGS = [
  'Ký túc xá khu A', 'Ký túc xá khu B', 'Ký túc xá Đại học Bách khoa', 'Ký túc xá Đại học Kinh tế',
  'Tòa nhà Bitexco', 'Tòa nhà Saigon Centre', 'Tòa nhà Viettel Complex', 'Tòa nhà Etown Cộng Hòa',
  'Tòa nhà Pearl Plaza', 'Tòa nhà Landmark 81', 'Tòa nhà Vincom Center', 'Tòa nhà Capital Place',
  'Tòa nhà Keangnam', 'Tòa nhà Lotte Center', 'Tòa nhà Sun Grand', 'Tòa nhà Diamond Plaza',
  'Ký túc xá Đại học Sư phạm', 'Ký túc xá Đại học Y Dược', 'Tòa nhà Melinh Point', 'Tòa nhà Times Square',
  'Tòa nhà Lim Tower', 'Tòa nhà Waseco', 'Tòa nhà Pico Plaza', 'Tòa nhà E.Town 2', 'Tòa nhà CMC Tower',
];

let groupOf = null; // Map<cid, { kind, gid, addr, phone|null, device|null }>

export function configureAccountSharing(baseSeed, cfg, nCustomers, nOrders, products, coupons, leafIds) {
  groupOf = null;
  if (!cfg.phaseBRealism) return;
  groupOf = new Map();
  const welcome = new Set(coupons.filter((c) => c.applies_to_new_customer).map((c) => c.id));

  // đơn đầu tiên của mỗi khách
  const first = new Map();
  for (let o = 0; o < nOrders; o++) {
    const m = orderMeta(baseSeed, o, cfg, products, coupons, leafIds);
    const f = first.get(m.customerId);
    if (!f || m.orderDateMs < f.t) first.set(m.customerId, { t: m.orderDateMs, welcome: welcome.has(m.couponId) && m.couponDiscount > 0 });
  }

  let gid = 0;
  // nhóm lạm dụng coupon khách mới
  const pool = [];
  for (let cid = 1; cid <= nCustomers; cid++) {
    if (first.get(cid)?.welcome && hashIntSync(`${baseSeed}:rb_ring_pick:${cid}`) % 1000 < 10) pool.push(cid);
  }
  for (let i = 0; i < pool.length;) {
    gid++;
    const size = 4 + (hashIntSync(`${baseSeed}:rb_ring_size:${gid}`) % 4);
    const members = pool.slice(i, i + size);
    i += size;
    if (members.length < 4) break;
    const a = makeAddress(baseSeed, 900000 + gid);
    const phone = gid % 2 === 0 ? phoneFor(baseSeed, `ring${gid}`) : null;
    const device = hashIntSync(`${baseSeed}:rb_ring_dev:${gid}`) % 10 < 7 ? deviceCode(baseSeed, `ring${gid}`) : null;
    for (const cid of members) groupOf.set(cid, { kind: 'ring', gid, addr: a, phone, device });
  }

  // ký túc xá / văn phòng
  const bAddr = BUILDINGS.map((name, b) => {
    const base = makeAddress(baseSeed, 800000 + b);
    return { ...base, full: `${name}, ${base.ward}, ${base.district}, ${base.province}` };
  });
  for (let cid = 1; cid <= nCustomers; cid++) {
    if (groupOf.has(cid)) continue;
    if (hashIntSync(`${baseSeed}:rb_dorm:${cid}`) % 1000 < 2) {
      const b = hashIntSync(`${baseSeed}:rb_dorm_b:${cid}`) % BUILDINGS.length;
      groupOf.set(cid, { kind: 'building', gid: 100000 + b, addr: bAddr[b], phone: null, device: null });
    }
  }

  // hộ gia đình: khách cid và cid+1 (đôi khi cid+2)
  for (let cid = 1; cid < nCustomers; cid++) {
    if (groupOf.has(cid) || groupOf.has(cid + 1)) continue;
    if (hashIntSync(`${baseSeed}:rb_house:${cid}`) % 100 >= 3) continue;
    gid++;
    const a = makeAddress(baseSeed, 900000 + gid);
    const device = hashIntSync(`${baseSeed}:rb_house_dev:${gid}`) % 10 < 3 ? deviceCode(baseSeed, `house${gid}`) : null;
    const members = [cid, cid + 1];
    if (cid + 2 <= nCustomers && !groupOf.has(cid + 2) && hashIntSync(`${baseSeed}:rb_house3:${gid}`) % 3 === 0) members.push(cid + 2);
    for (const m of members) groupOf.set(m, { kind: 'household', gid, addr: a, phone: null, device });
  }
}

export function sharingGroup(cid) {
  return groupOf ? groupOf.get(cid) : undefined;
}

export function phoneFor(baseSeed, key) {
  const prefix = ['090', '091', '093', '097', '098', '086', '070', '079'][hashIntSync(`${baseSeed}:rb_phone_p:${key}`) % 8];
  return prefix + String(hashIntSync(`${baseSeed}:rb_phone:${key}`) % 10000000).padStart(7, '0');
}

export function deviceCode(baseSeed, key) {
  return `DV-${hashIntSync(`${baseSeed}:rb_device:${key}`).toString(36).toUpperCase().padStart(7, '0')}`;
}

// Thiết bị khách dùng cho một lần ghé web: nhóm chung thiết bị thì dùng máy chung,
// 30% khách có 2 máy (điện thoại + laptop).
export function deviceIndexFor(baseSeed, cid, visitKey) {
  if (hashIntSync(`${baseSeed}:rb_two_dev:${cid}`) % 100 >= 30) return 0;
  return hashIntSync(`${baseSeed}:rb_dev_pick:${visitKey}`) % 2;
}
