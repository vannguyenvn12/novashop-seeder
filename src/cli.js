#!/usr/bin/env node
// cli.js — NovaShop Seeder CLI
//   db:schema            — áp schema.sql (idempotent)
//   db:seed --phase=N    — seed 1 phase
//   db:reset --phase=N   — TRUNCATE + seed lại
//   db:verify --phase=N  — so manifest (row count + checksum)
//   db:restore [-f file] — restore phase2.sql (drop + recreate DB theo DATABASE_URL)
import { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import dotenv from 'dotenv';
import pg from 'pg';
import { pool } from './db.js';
import { seedPhase, verifyPhase } from './seed.js';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_FILE = path.join(__dirname, '..', 'schema.sql');

// Parse connection string postgres://user:pass@host:port/db -> {user,password,host,port,database}
function parseDbUrl(url) {
  const m = url.match(/^postgres(ql)?:\/\/([^:]*)(?::([^@]*))?@([^:/]+)(?::(\d+))?\/(.+)$/);
  if (!m) throw new Error(`Không parse được DATABASE_URL: ${url}`);
  return {
    user: m[2] ? decodeURIComponent(m[2]) : '',
    password: m[3] ? decodeURIComponent(m[3]) : '',
    host: m[4],
    port: m[5] ? Number(m[5]) : 5432,
    database: m[6],
  };
}

// Tìm psql: ưu tiên PATH, rồi đường dẫn cài đặt PostgreSQL chuẩn
function findPsql() {
  const candidates = [
    'psql',
    'C:\\Program Files\\PostgreSQL\\14\\bin\\psql.exe',
    'C:\\Program Files\\PostgreSQL\\15\\bin\\psql.exe',
    'C:\\Program Files\\PostgreSQL\\16\\bin\\psql.exe',
    'C:\\Program Files\\PostgreSQL\\17\\bin\\psql.exe',
  ];
  for (const c of candidates) {
    const r = spawnSync(c, ['--version'], { stdio: 'ignore' });
    if (!r.error && r.status === 0) return c;
  }
  return null;
}

// Restore phase2.sql: drop + create DB (đọc từ DATABASE_URL), rồi psql -f import
async function restorePhase2(sqlFile) {
  const url = process.env.DATABASE_URL;
  const conn = parseDbUrl(url);
  const psql = findPsql();
  if (!psql) {
    throw new Error('Không tìm thấy psql. Cài PostgreSQL hoặc thêm bin vào PATH.');
  }

  console.log(`[restore] target: ${conn.host}:${conn.port}/${conn.database}`);
  console.log(`[restore] file: ${sqlFile}`);

  // Drop + recreate database qua connection tới 'postgres'
  const admin = new pg.Client({ host: conn.host, port: conn.port, user: conn.user, password: conn.password, database: 'postgres' });
  await admin.connect();
  console.log('[restore] dropping + recreating database...');
  await admin.query(`DROP DATABASE IF EXISTS "${conn.database}"`);
  await admin.query(`CREATE DATABASE "${conn.database}"`);
  await admin.end();

  // Import file qua psql (stream — không load hết vào RAM)
  console.log('[restore] importing (có thể mất vài phút)...');
  const env = { ...process.env, PGPASSWORD: conn.password || '' };
  const r = spawnSync(psql, ['-h', conn.host, '-p', String(conn.port), '-U', conn.user, '-d', conn.database, '-f', sqlFile, '-v', 'ON_ERROR_STOP=1'], {
    stdio: 'inherit',
    env,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error || r.status !== 0) {
    throw new Error(`psql import thất bại (exit ${r.status ?? r.error?.code})`);
  }

  // Verify nhanh
  const check = new pg.Client({ host: conn.host, port: conn.port, user: conn.user, password: conn.password, database: conn.database });
  await check.connect();
  const counts = await check.query(`SELECT (SELECT count(*) FROM customers) AS customers, (SELECT count(*) FROM orders) AS orders, (SELECT count(*) FROM order_items) AS order_items`);
  console.log('[restore] OK —', JSON.stringify(counts.rows[0]));
  await check.end();
  return counts.rows[0];
}

const program = new Command();
program.name('novashop-seeder').description('NovaShop checkpoint seeder — Query Design từ Business').version('1.0.0');

program
  .command('db:schema')
  .description('Áp schema.sql (idempotent — chạy lại không lỗi)')
  .action(async () => {
    const sql = fs.readFileSync(SCHEMA_FILE, 'utf8');
    console.log('[schema] applying schema.sql...');
    await pool.query(sql);
    console.log('[schema] OK');
    await pool.end();
  });

function loadPhase(phase) {
  const file = path.join(__dirname, 'scenarios', `phase${phase}.json`);
  if (!fs.existsSync(file)) throw new Error(`Không có phase ${phase}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function addSeedOptions(cmd) {
  return cmd
    .option('-p, --phase <n>', 'Phase (1|2|3)', '1')
    .option('-s, --sample <ratio>', 'Sample ratio (vd 0.01 = 1%)', parseFloat);
}

program
  .command('db:seed')
  .description('Seed 1 phase')
  .option('-p, --phase <n>', 'Phase (1|2|3)', '1')
  .option('-s, --sample <ratio>', 'Sample ratio (vd 0.01 = 1%)', parseFloat)
  .action(async (opts) => {
    const cfg = loadPhase(opts.phase);
    const sample = opts.sample ?? 1;
    await seedPhase(opts.phase, cfg, { sample, reset: false });
    await pool.end();
    process.exit(0);
  });

program
  .command('db:reset')
  .description('TRUNCATE + seed lại 1 phase')
  .option('-p, --phase <n>', 'Phase (1|2|3)', '1')
  .option('-s, --sample <ratio>', 'Sample ratio (vd 0.01 = 1%)', parseFloat)
  .action(async (opts) => {
    const cfg = loadPhase(opts.phase);
    const sample = opts.sample ?? 1;
    await seedPhase(opts.phase, cfg, { sample, reset: true });
    await pool.end();
    process.exit(0);
  });

program
  .command('db:verify')
  .description('So manifest (row count + checksum) với DB hiện tại')
  .option('-p, --phase <n>', 'Phase (1|2|3)', '1')
  .action(async (opts) => {
    await verifyPhase(opts.phase);
    await pool.end();
  });

program
  .command('db:restore')
  .description('Restore phase2.sql (drop + recreate DB theo DATABASE_URL, import)')
  .option('-f, --file <path>', 'File SQL backup (mặc định phase2.sql trong dự án)', 'phase2.sql')
  .option('-y, --yes', 'Bỏ qua xác nhận', false)
  .action(async (opts) => {
    const sqlFile = path.resolve(opts.file);
    if (!fs.existsSync(sqlFile)) {
      console.error(`[restore] Không thấy file: ${sqlFile}`);
      process.exit(1);
    }
    if (!opts.yes) {
      console.log(`[restore] Sắp DROP + tạo lại DB theo DATABASE_URL và import ${sqlFile}`);
      console.log('[restore] Toàn bộ data hiện tại sẽ bị XÓA. Gõ "y" để tiếp tục:');
      // đọc 1 ký tự từ stdin (không dùng readline để đơn giản)
      const buf = Buffer.alloc(1);
      fs.readSync(0, buf, 0, 1);
      const ans = String.fromCharCode(buf[0]).toLowerCase();
      if (ans !== 'y') { console.log('[restore] Hủy.'); process.exit(0); }
    }
    try {
      await restorePhase2(sqlFile);
    } catch (e) {
      console.error('[restore] LỖI:', e.message);
      process.exit(1);
    }
    process.exit(0);
  });

program.parse(process.argv);
