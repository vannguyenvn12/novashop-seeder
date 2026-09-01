// generators/categories.js — cây category 3 cấp, tĩnh theo seed (độc lập phase)
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { uniqueHashId } from '../seededFaker.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const productFile = path.join(__dirname, '..', '..', 'data', 'products-vn.json');

// Cache cây category — đọc 1 lần
let catTreeCache = null;
export async function getCategoryTree(baseSeed) {
  if (catTreeCache) return catTreeCache;
  const products = JSON.parse(await readFile(productFile, 'utf8'));

  // (1) Gom tất cả category theo path
  const pathMap = new Map(); // path.join('|') -> {name, path}
  for (const p of products) {
    let cur = '';
    for (const seg of p.categoryPath) {
      cur = cur ? `${cur}|${seg}` : seg;
      if (!pathMap.has(cur)) pathMap.set(cur, { name: seg, path: cur.split('|') });
    }
  }

  // (2) Xếp order theo chiều sâu để id cha < id con
  const nodes = [...pathMap.values()].sort((a, b) => a.path.length - b.path.length || a.name.localeCompare(b.name, 'vi'));

  // (3) Gán id ổn định theo hash(seed:categories:index) — index theo thứ tự đã sort.
  //     uniqueHashId: linear probing khi 31-bit collision.
  const ids = new Map();
  const used = new Set();
  for (let i = 0; i < nodes.length; i++) {
    const id = await uniqueHashId(baseSeed, 'categories', i, used);
    ids.set(nodes[i].path.join('|'), id);
  }

  const rows = [];
  for (const n of nodes) {
    const parentPath = n.path.slice(0, -1).join('|');
    rows.push({
      id: ids.get(n.path.join('|')),
      name: n.name,
      parent_id: parentPath ? ids.get(parentPath) : null,
    });
  }
  catTreeCache = rows;
  return rows;
}

// Lấy danh sách category lá (sản phẩm gắn vào lá)
export async function getLeafCategoryIds(baseSeed) {
  const tree = await getCategoryTree(baseSeed);
  const hasChild = new Set(tree.filter((c) => c.parent_id !== null).map((c) => c.parent_id));
  return tree.filter((c) => !hasChild.has(c.id)).map((c) => c.id);
}

export function categoryIdAt(baseSeed, index, arr) {
  return arr[index % arr.length];
}
