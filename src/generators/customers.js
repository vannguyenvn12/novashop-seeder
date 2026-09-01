// generators/customers.js — khách hàng NovaShop
import { hashInt, seededBool, seededInt, getFaker } from '../seededFaker.js';

// --- helpers derive email từ tên thật (không sequential, không fake placeholder) ---
function normalizeForEmail(s) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

// cố định: mỗi email được gắn seed riêng để khi trùng thì trùng ĐÚNG cùng 1 email
async function emailFor(baseSeed, customerId, fullName) {
  const base = normalizeForEmail(fullName);
  const h = await hashInt(`${baseSeed}:customer_email:${customerId}`);
  const lastName = fullName.split(' ').pop() || '';
  const variants = [
    `${base}@gmail.com`,
    `${base}${h % 99 + 1}@gmail.com`,
    `${base}.${normalizeForEmail(lastName)}@yahoo.com`,
    `${base}@outlook.com`,
  ];
  return variants[h % variants.length];
}

export async function* customers(baseSeed, n, cfg) {
  const nullPhone = (cfg.messiness?.customers?.nullPhonePercent ?? 6) / 100;
  const dupEmail = (cfg.messiness?.customers?.dupEmailPercent ?? 4) / 100;
  const upperEmail = (cfg.messiness?.customers?.uppercaseEmailPercent ?? 2) / 100;

  for (let i = 0; i < n; i++) {
    const id = i + 1;
    const f = await getFaker(baseSeed, 'customers', i);
    const fullName = f.person.fullName();

    // Email: ~dupEmail% số khách dùng lại email của 1 khách trước (bước lấy theo hash
    // để determinism; nếu i nhỏ hơn bước thì tự sinh).
    let email;
    const isDup = i > 0 && (await seededBool(baseSeed, 'customers_dup', i, dupEmail));
    if (isDup) {
      const step = Math.max(2, Math.floor(n * 0.01));
      const src = i - step;
      const srcName = (await getFaker(baseSeed, 'customers', src)).person.fullName();
      email = await emailFor(baseSeed, src + 1, srcName);
      if (await seededBool(baseSeed, 'customers_case', i, 0.5)) {
        // viết hoa lẫn lộn → GROUP BY LOWER(email) mới bắt được trùng (Module 1)
        const at = email.indexOf('@');
        email = email.slice(0, at).replace(/^./, (c) => c.toUpperCase()) + email.slice(at);
      }
      // reseed về i trước khi lấy phone (shared faker đã bị đổi bởi getFaker(src))
      const f2 = await getFaker(baseSeed, 'customers', i);
      const phone = (await seededBool(baseSeed, 'customers_phone', i, nullPhone)) ? '' : f2.phone.number();
      const tier = (await seededInt(baseSeed, 'customers_tier', i, 0, 100)) < 60 ? 'standard' : 'silver';
      yield [id, fullName, email, phone, tier];
    } else {
      email = await emailFor(baseSeed, id, fullName);
      const phone = (await seededBool(baseSeed, 'customers_phone', i, nullPhone)) ? '' : f.phone.number();
      const tier = (await seededInt(baseSeed, 'customers_tier', i, 0, 100)) < 60 ? 'standard' : 'silver';
      yield [id, fullName, email, phone, tier];
    }
  }
}
