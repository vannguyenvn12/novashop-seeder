// db.js — connection pool + COPY helper + verify helpers
import pg from 'pg';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { from as copyFrom } from 'pg-copy-streams';
import dotenv from 'dotenv';

dotenv.config();

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://novashop:novashop@localhost:5433/novashop',
  max: 8,
});

// COPY 1 bảng từ generator lazy (async generator ra mảng các cột → CSV string)
// Dùng pipeline() chuẩn — xử lý backpressure + error đúng cách, chờ đến khi
// PG xác nhận COPY hoàn tất (copy stream 'end').
export async function copyTable(table, columns, rowGenerator) {
  const client = await pool.connect();
  try {
    // Tăng tốc COPY trên CHÍNH connection này (session-level, an toàn)
    await client.query(`SET synchronous_commit = off`);
    await client.query(`SET maintenance_work_mem = '1GB'`);
    const copy = client.query(
      copyFrom(`COPY ${table} (${columns}) FROM STDIN WITH (FORMAT csv, HEADER false)`)
    );
    const input = Readable.from(
      (async function* () {
        for await (const row of rowGenerator) {
          const cols = row.map((v) => {
            if (v === null || v === undefined) return '';
            const s = String(v);
            if (s.includes(',') || s.includes('"') || s.includes('\n')) {
              return '"' + s.replace(/"/g, '""') + '"';
            }
            return s;
          });
          yield cols.join(',') + '\n';
        }
      })(),
      { highWaterMark: 64 * 1024 } // 64KB — backpressure sớm, buffer nhỏ, không phình heap
    );
    await pipeline(input, copy);
  } catch (e) {
    console.error(`[copy] LỖI bảng ${table}:`, e.message);
    throw e;
  } finally {
    client.release();
  }
}

export async function query(text, params) {
  const res = await pool.query(text, params);
  return res.rows;
}

// Đếm nhanh dòng (chấp nhận ước lượng; manifest dùng COUNT(*) thật khi verify)
export async function countTable(table) {
  const res = await pool.query(`SELECT COUNT(*)::bigint AS n FROM ${table}`);
  return Number(res.rows[0].n);
}

// Hỗ trợ đặt biến cho TZ khi chạy seed để timestamp nhất quán
export async function setTimeZone(tz = 'Asia/Ho_Chi_Minh') {
  await pool.query(`SET TIME ZONE '${tz}'`);
}

// Tăng tốc bulk COPY: vô hiệu fsync từng dòng + tăng bộ nhớ maintenance.
// Chỉ áp cho SESSION seed — không đổi config server, an toàn khi seed xong.
export async function speedUpCopy() {
  await pool.query(`SET synchronous_commit = off`);
  await pool.query(`SET maintenance_work_mem = '1GB'`);
}
