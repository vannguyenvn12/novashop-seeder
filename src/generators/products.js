// generators/products.js — catalog curate từ data/products-vn.json.
// Trọng số: category "phổ biến" lặp nhiều lần trong list → product phổ biến hơn.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { uniqueHashId, seededBool } from '../seededFaker.js';
import { getCategoryTree } from './categories.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const productFile = path.join(__dirname, '..', '..', 'data', 'products-vn.json');

let cache = null;
export async function getProducts(baseSeed, nProducts) {
  if (cache && cache.n === nProducts) return cache.rows;
  const catalog = JSON.parse(await readFile(productFile, 'utf8'));
  // Product nằm đúng category lá theo categoryPath của chính nó (Module 8 top-N theo category).
  const categoryIdByPath = new Map((await getCategoryTree(baseSeed)).map((c) => [c.path, c.id]));
  const rows = [];
  const used = new Set();
  for (let i = 0; i < nProducts; i++) {
    const src = catalog[i % catalog.length];
    const id = await uniqueHashId(baseSeed, 'products', i, used);
    // Catalog lặp lại khi nProducts > số mẫu: bản lặp thêm hậu tố để tên không trùng.
    const copy = Math.floor(i / catalog.length);
    const name = copy === 0 ? src.name : `${src.name} (mẫu ${copy + 1})`;
    const categoryId = categoryIdByPath.get(src.categoryPath.join('|'));
    if (!categoryId) throw new Error(`Không tìm thấy category cho product "${src.name}"`);
    const slug = `sp-${String(i + 1).padStart(4, '0')}-${name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')}`;
    rows.push({
      id,
      category_id: categoryId,
      name,
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
