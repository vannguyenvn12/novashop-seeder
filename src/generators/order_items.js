// generators/order_items.js — CSV cho bảng order_items
import { itemCountFor, itemMeta } from './order-core.js';

export async function* orderItems(baseSeed, nOrders, cfg, products, leafIds) {
  let globalIdx = 0;
  for (let o = 0; o < nOrders; o++) {
    const n = itemCountFor(baseSeed, o, cfg);
    const usedInOrder = new Set(); // đảm bảo (order_id, product_id) unique
    for (let j = 0; j < n; j++) {
      let meta = itemMeta(baseSeed, o, j, products, leafIds);
      // nếu product đã dùng trong đơn này, dịch tới product chưa dùng
      let guard = 0;
      while (usedInOrder.has(meta.product.id) && guard < products.length) {
        meta = { ...meta, product: products[(products.indexOf(meta.product) + 1) % products.length] };
        guard++;
      }
      usedInOrder.add(meta.product.id);
      globalIdx++;
      yield [globalIdx, o + 1, meta.product.id, meta.qty, meta.unitPrice, meta.amount];
    }
  }
}
