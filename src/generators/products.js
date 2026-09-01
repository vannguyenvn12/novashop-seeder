// generators/products.js — catalog curate từ data/products-vn.json.
// Trọng số: category "phổ biến" lặp nhiều lần trong list → product phổ biến hơn.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { uniqueHashId, seededBool } from '../seededFaker.js';
import { getLeafCategoryIds } from './categories.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const productFile = path.join(__dirname, '..', '..', 'data', 'products-vn.json');

let cache = null;
export async function getProducts(baseSeed, nProducts) {
  if (cache && cache.n === nProducts) return cache;
  const catalog = JSON.parse(await readFile(productFile, 'utf8'));
  const leafIds = await getLeafCategoryIds(baseSeed);
  const rows = [];
  const used = new Set();
  for (let i = 0; i < nProducts; i++) {
    const src = catalog[i % catalog.length];
    const id = await uniqueHashId(baseSeed, 'products', i, used);
    const slug = `sp-${String(i + 1).padStart(4, '0')}-${src.name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')}`;
    rows.push({
      id,
      category_id: leafIds[i % leafIds.length],
      name: src.name,
      slug,
      base_price: src.price,
      is_active: await seededBool(baseSeed, 'products', i, 0.92),
    });
  }
  cache = { n: nProducts, rows };
  return rows;
}

export function productAt(rows, index) {
  return rows[index % rows.length];
}
