// seededFaker.js — hàm recordFaker() theo đúng công thức ở mục 2.1 của plan.
//
//   recordFaker(baseSeed, entityType, index) =>
//     f = new Faker({ locale: [vi, base] })
//     f.seed(h32(`${baseSeed}:${entityType}:${index}`))
//
// Nhờ seed theo (entity, index) — độc lập với tổng số dòng — nên:
//  * khách hàng #5000 giống hệt nhau ở cả 3 checkpoint,
//  * reset 1 bảng không làm lệch các bảng khác.

import xxhash from 'xxhash-wasm';
import { Faker, vi, base } from '@faker-js/faker';

let _xx = null;

// init WASM 1 lần; sau đó mọi hash nhanh (không await lại)
export async function initHash() {
  if (!_xx) _xx = await xxhash();
  return _xx;
}

// h32 theo đúng ký hiệu trong plan: hash 32-bit.
// Giới hạn về 31-bit (0..2^31-1) để id luôn nằm trong INT của Postgres.
// GIỮ async (tương thích với mọi generator), nhưng sau initHash() thì resolve
// gần như tức thì — không await WASM mỗi lần.
export async function hashInt(input, seed = 0) {
  await initHash();
  return _xx.h32(String(input), seed) & 0x7fffffff;
}

// Bản sync — CHỈ gọi sau khi initHash() đã hoàn tất (được đảm bảo bởi getFaker/hashInt).
export function hashIntSync(input, seed = 0) {
  if (!_xx) throw new Error('initHash() phải chạy trước hashIntSync()');
  return _xx.h32(String(input), seed) & 0x7fffffff;
}

export function seededBoolSync(baseSeed, entityType, index, pTrue) {
  const h = hashIntSync(`${baseSeed}:${entityType}:${index}:bool`);
  return (h % 10000) / 10000 < pTrue;
}

export function seededIntSync(baseSeed, entityType, index, min, max) {
  const h = hashIntSync(`${baseSeed}:${entityType}:${index}:int`);
  return min + (h % (max - min + 1));
}

export async function recordFaker(baseSeed, entityType, index) {
  const f = new Faker({ locale: [vi, base] });
  f.seed(await hashInt(`${baseSeed}:${entityType}:${index}`));
  return f;
}

// getFaker — 1 instance Faker dùng chung, `f.seed(hash)` mỗi lần gọi.
// f.seed(n) reset RNG state → với cùng (entity, index) và cùng thứ tự gọi hàm,
// kết quả giống hệt recordFaker (instance mới mỗi dòng) nhưng nhanh hơn rất nhiều
// (không phải merge locale mỗi dòng). Quan trọng ở 10M rows.
let sharedFaker = null;
export async function getFaker(baseSeed, entityType, index) {
  await initHash();
  if (!sharedFaker) sharedFaker = new Faker({ locale: [vi, base] });
  sharedFaker.seed(hashIntSync(`${baseSeed}:${entityType}:${index}`));
  return sharedFaker;
}

// Một số giá trị cố định theo seed — dùng cho các quyết định determinism
// không cần cả 1 instance Faker.
export async function seededPick(baseSeed, entityType, index, arr) {
  const h = await hashInt(`${baseSeed}:${entityType}:${index}:pick`);
  return arr[h % arr.length];
}

export async function seededBool(baseSeed, entityType, index, pTrue) {
  const h = await hashInt(`${baseSeed}:${entityType}:${index}:bool`);
  return (h % 10000) / 10000 < pTrue;
}

export async function seededInt(baseSeed, entityType, index, min, max) {
  const h = await hashInt(`${baseSeed}:${entityType}:${index}:int`);
  return min + (h % (max - min + 1));
}

// Id ổn định theo hash nhưng LUÔN unique trong 1 lô — linear probing khi 31-bit collision.
// Dùng cho cột PRIMARY KEY (categories/products/coupons) để COPY không lỗi duplicate key.
export async function uniqueHashId(baseSeed, entityType, index, usedSet) {
  let id = await hashInt(`${baseSeed}:${entityType}:${index}`);
  while (usedSet.has(id)) id = (id + 1) & 0x7fffffff;
  usedSet.add(id);
  return id;
}
