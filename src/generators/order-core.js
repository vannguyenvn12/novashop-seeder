// order-core.js — "hợp đồng" giữa orders và mọi bảng con.
//
// Nguyên tắc: MỌI quyết định cấu trúc của 1 đơn (status, ngày, itemCount, giá,
// COD, coupon...) được derive từ hash(baseSeed, key, index) — KHÔNG từ faker stream.
// Nhờ vậy:
//   * order_items / shipments / payments / status_history... tính lại y hệt orderMeta(idx)
//     mà không cần cache RAM (quan trọng ở phase 3: 50M đơn).
//   * thứ tự tiêu thụ RNG không bao giờ làm lệch data giữa các phase.
//
// HIỆU NĂNG: toàn bộ hàm dùng SYNC hash (hashIntSync) — chỉ hợp lệ sau initHash()
// (seed.js đảm bảo). Sync giúp 5M/50M đơn không bị nghẽn bởi hàng trăm triệu microtask.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initHash, hashIntSync, seededBoolSync, seededIntSync } from '../seededFaker.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ORDER_DATE_START = Date.parse('2024-01-01T00:00:00+07:00');
const DAY_MS = 86400000;

// ---------- địa chỉ curate (TP.HCM gốc) ----------
let _addrData = null;
export function addrData() {
  if (!_addrData) {
    const provinces = JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'data', 'vn-provinces.json'), 'utf8'));
    const streets = JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'data', 'vn-street-names.json'), 'utf8'));
    _addrData = { provinces, streets };
  }
  return _addrData;
}

// chọn tỉnh theo trọng số (TP.HCM ~70%)
export function pickProvince(baseSeed, idx) {
  const { provinces } = addrData();
  const total = provinces.reduce((s, p) => s + p.weight, 0);
  const r = hashIntSync(`${baseSeed}:addr_prov:${idx}`) % total;
  let acc = 0;
  for (const p of provinces) {
    acc += p.weight;
    if (r < acc) return p;
  }
  return provinces[0];
}

export function makeAddress(baseSeed, idx) {
  const { streets } = addrData();
  const prov = pickProvince(baseSeed, idx);
  const dist = prov.districts[hashIntSync(`${baseSeed}:addr_dist:${idx}`) % prov.districts.length];
  const ward = dist.wards[hashIntSync(`${baseSeed}:addr_ward:${idx}`) % dist.wards.length];
  const street = streets[hashIntSync(`${baseSeed}:addr_street:${idx}`) % streets.length];
  const num = (hashIntSync(`${baseSeed}:addr_num:${idx}`) % 300) + 1;
  const full = `${num} ${street}, ${ward}, ${dist.district}, ${prov.province}`;
  return { full, province: prov.province, district: dist.district, ward };
}

// ---------- items của 1 đơn (order_items dùng chung công thức) ----------
export function itemCountFor(baseSeed, orderIdx, cfg) {
  const multiP = (cfg.messiness?.order_items?.multiItemOrderPercent ?? 30) / 100;
  const r = hashIntSync(`${baseSeed}:order_nitem:${orderIdx}`) % 10000;
  if (r < multiP * 10000) {
    return 2 + (hashIntSync(`${baseSeed}:order_nitem2:${orderIdx}`) % 4); // 2..5
  }
  return 1;
}

export function itemMeta(baseSeed, orderIdx, j, products, leafIds) {
  const k = orderIdx * 100 + j; // key tổng hợp ổn định
  const baseIdx = hashIntSync(`${baseSeed}:oi_prod:${k}`) % products.length;
  // j=0 lấy baseIdx; j>0 dịch thêm j → product khác nhau trong cùng đơn
  const product = products[(baseIdx + j) % products.length];
  const qty = 1 + (hashIntSync(`${baseSeed}:oi_qty:${k}`) % 3);
  const hasDiscount = hashIntSync(`${baseSeed}:oi_disc:${k}`) % 100 < 15;
  const pct = hasDiscount ? (hashIntSync(`${baseSeed}:oi_discpct:${k}`) % 26) + 5 : 0; // 5..30%
  const unitPrice = Math.round((product.base_price * (1 - pct / 100)) / 1000) * 1000;
  return { product, qty, unitPrice, amount: unitPrice * qty, leafId: leafIds ? leafIds[orderIdx % leafIds.length] : null };
}

export function subtotalFor(baseSeed, orderIdx, cfg, products, leafIds) {
  const n = itemCountFor(baseSeed, orderIdx, cfg);
  let s = 0;
  for (let j = 0; j < n; j++) s += itemMeta(baseSeed, orderIdx, j, products, leafIds).amount;
  return s;
}

// ---------- metadata 1 đơn — mọi bảng con gọi lại y hệt ----------
// CACHE dạng ARRAY (index → entry): lookup O(1) không tạo string key → không GC
// overhead như Map. GIỚI HẠN 1M: cache lớn hơn (5M+) làm heap đầy → GC dừng thế giới
// → event loop đứng → COPY treo (deadlock). 1M entries ≈ 300MB, phần còn lại tính lại
// (mỗi lần ~30s cho 5M) — chấp nhận được.
const META_CACHE_LIMIT = 1000000;
const metaCache = [];

export function orderMeta(baseSeed, idx, cfg, products, coupons, leafIds) {
  const hit = metaCache[idx];
  if (hit) return hit;
  const m = computeOrderMeta(baseSeed, idx, cfg, products, coupons, leafIds);
  if (idx < META_CACHE_LIMIT) metaCache[idx] = m;
  return m;
}

function computeOrderMeta(baseSeed, idx, cfg, products, coupons, leafIds) {
  const orderId = idx + 1;
  const customerId = 1 + (idx % 10000); // ~10k khách, 30k đơn → khách lặp lại

  const dayOffset = hashIntSync(`${baseSeed}:od_day:${idx}`) % 730;
  const hour = 8 + (hashIntSync(`${baseSeed}:od_hour:${idx}`) % 15);
  const orderDateMs = ORDER_DATE_START + dayOffset * DAY_MS + hour * 3600000;

  const ageDays = (Date.now() - orderDateMs) / DAY_MS;
  const cancelledP = (cfg.messiness?.orders?.cancelledPercent ?? 3) / 100;
  const returnedP = (cfg.messiness?.orders?.returnedPercent ?? 2) / 100;
  const isCancelled = ageDays > 2 && seededBoolSync(baseSeed, 'od_cancelled', idx, cancelledP);
  const isReturned = !isCancelled && ageDays > 30 && seededBoolSync(baseSeed, 'od_returned', idx, returnedP);
  const isPending = ageDays < 1 && !isCancelled;
  const isDelivered = !isCancelled && !isReturned && !isPending && (ageDays > 5 || seededBoolSync(baseSeed, 'od_deliv', idx, 0.9));
  const status = isCancelled ? 'cancelled' : isReturned ? 'returned' : isPending ? 'pending' : isDelivered ? 'delivered' : 'shipped';

  const codP = (cfg.messiness?.orders?.codPercent ?? 55) / 100;
  const isCod = isReturned ? true : seededBoolSync(baseSeed, 'od_cod', idx, codP);
  const paymentMethod = isCod ? 'COD' : ['card', 'bank_transfer', 'ewallet'][hashIntSync(`${baseSeed}:od_pm:${idx}`) % 3];
  const paymentStatus = isCancelled ? 'refunded' : paymentMethod !== 'COD' ? 'paid' : isDelivered ? 'paid' : 'unpaid';

  const subtotal = subtotalFor(baseSeed, idx, cfg, products, leafIds);
  const shippingFee = 15000 + (hashIntSync(`${baseSeed}:od_ship:${idx}`) % 45000); // 15k..60k
  const coupon = coupons[hashIntSync(`${baseSeed}:od_coupon:${idx}`) % coupons.length];
  const couponDiscount = couponDiscountFor(coupon, subtotal, shippingFee);
  const total = Math.max(0, subtotal + shippingFee - couponDiscount);

  const addressFull = makeAddress(baseSeed, idx).full;

  // Entry NHẸ: số + status + string — tránh object lớn gây GC thrashing khi cache 5M+
  return {
    orderId, customerId, orderDateMs, status, paymentMethod, paymentStatus,
    subtotal, shippingFee, couponId: coupon ? coupon.id : null, couponDiscount,
    total, addressFull, isCod, isDelivered, isCancelled,
  };
}

// Xoá cache khi chuyển phase (tránh OOM chồng nhiều phase trong 1 process)
export function clearMetaCache() {
  metaCache.length = 0;
}

export function couponDiscountFor(coupon, subtotal, shippingFee) {
  if (!coupon) return 0;
  if (coupon.min_order_amount && subtotal < coupon.min_order_amount) return 0;
  let d = 0;
  if (coupon.type === 'percent') d = (subtotal * coupon.value) / 100;
  else if (coupon.type === 'fixed') d = coupon.value;
  else if (coupon.type === 'free_ship') d = shippingFee;
  if (coupon.max_discount && d > coupon.max_discount) d = coupon.max_discount;
  return Math.round(Math.min(d, subtotal));
}

export { initHash };
