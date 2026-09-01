// generators/customer_addresses.js — địa chỉ đã lưu của khách (Module 14 Case 2)
// Messiness: ~6% khách dùng chung 1 địa chỉ với 1 khách khác (nhiều tài khoản, cùng địa chỉ)
import { hashIntSync, seededBoolSync } from '../seededFaker.js';
import { makeAddress } from './order-core.js';

export async function* customerAddresses(baseSeed, nCustomers, cfg) {
  const target = Math.round((cfg.rowCounts?.customer_addresses ?? 15000) || 0);
  let rowId = 0;
  let emitted = 0;
  for (let c = 0; c < nCustomers && emitted < target; c++) {
    const nAddr = 1 + (hashIntSync(`${baseSeed}:cad_n:${c}`) % 2); // 1-2 địa chỉ
    for (let a = 0; a < nAddr && emitted < target; a++) {
      rowId++;
      const addr = makeAddress(baseSeed, c * 2 + a);
      // share địa chỉ: 6% địa chỉ giống hệt địa chỉ của khách khác (chung 1 địa chỉ vật lý)
      const shared = seededBoolSync(baseSeed, 'cad_share', rowId, 0.06);
      const full = shared ? makeAddress(baseSeed, (c + 500) * 2 + a).full : addr.full;
      yield [
        rowId, c + 1,
        a === 0 ? 'Nhà riêng' : 'Công ty',
        full, addr.province, addr.district, addr.ward,
        '', a === 0 ? 't' : 'f',
      ];
      emitted++;
    }
  }
}
