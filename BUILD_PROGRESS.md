# BUILD PROGRESS — NovaShop Seeder

> File này ghi lại tiến độ build để tiếp tục khi hết token/session mới.
> Cập nhật: 2026-08-31 (session 1)

## ✅ ĐÃ HOÀN THÀNH

### 1. Toàn bộ source code trong `novashop-seeder/`
- `schema.sql` — 18 bảng, comment rõ cột "chỉ lưu giá trị hiện tại" (`orders.status`, `customers.current_tier`, `orders.total_amount`)
- `docker-compose.yml` — Postgres 16 trên **cổng 5434** (5433 bị container khác chiếm)
- `.env` / `.env.example` — `DATABASE_URL=postgres://novashop:novashop@localhost:5434/novashop`, `BASE_SEED=novashop-course-2026`
- `package.json` — `@faker-js/faker@9.6.0` (pin cứng), pg, pg-copy-streams@^7, xxhash-wasm@^1.1, commander, dotenv
- `src/seededFaker.js` — `recordFaker()`, `hashInt`/`hashIntSync` (31-bit, tránh tràn INT Postgres), `getFaker` (shared instance + f.seed), `seededBool/Sync`, `seededInt/Sync`, `uniqueHashId` (linear probing chống collision PK)
- `src/db.js` — pool, `copyTable` (dùng `pipeline()` + `Readable.from` highWaterMark 1MB), `speedUpCopy` (SET synchronous_commit=off, maintenance_work_mem=1GB — session-level)
- `src/generators/` — 14 generator + `order-core.js` (orderMeta sync, cache giới hạn 200k entries, `setMetaCacheEnabled`/`clearMetaCache`)
- `src/scenarios/phase{1,2,3}.json` — row counts + messiness
- `src/cli.js` — `db:schema` / `db:seed` / `db:reset` / `db:verify` (+ `--sample`)
- `scripts/generate-reference-doc.js` — sinh NOVASHOP_DATA_REFERENCE.md bằng query DB thật
- `data/` — `products-vn.json` (97 SP), `vn-provinces.json` (TP.HCM ~70% + 5 tỉnh lân cận), `vn-street-names.json`

### 2. Test đã PASS
- [x] `db:schema` chạy 2 lần liên tiếp không lỗi (idempotent)
- [x] **Phase1 (10k)**: seed OK, `db:verify` khớp manifest
- [x] **Determinism**: UPDATE 3 orders + DELETE 3 reviews → verify báo LỆCH → `db:reset --phase=1` → verify khớp **y hệt**
- [x] Phase2 (1M): seed chạy tới hết (lần chạy cuối ~40 phút trước khi tối ưu; sau tối ưu đang chạy lại)

## 🔧 TỐI ƯU HIỆU NĂNG (đã áp dụng)

1. **Cache orderMeta dạng ARRAY** giới hạn 1M entries (entry nhẹ: số + status + string `orderDateMs`/`addressFull`/`couponId`). Cache >1M làm heap đầy → GC dừng thế giới → COPY treo.
2. **`--max-old-space-size=4096`** trong npm scripts (heap 8GB quá lớn → full GC lâu)
3. **`SET synchronous_commit=off` + `maintenance_work_mem=1GB`** trên mỗi connection COPY
4. **Drop index phụ + UNIQUE constraint order_items trước COPY, tạo lại sau** (nOrders > 200k)
5. **`pipeline()` chuẩn** + `Readable.from` highWaterMark **64KB** (buffer nhỏ, không phình heap khi backpressure)
6. **docker-compose**: `max_wal_size=4GB`, `checkpoint_timeout=15min`, `synchronous_commit=off` (server-level, qua command flags)

### ⚠️ PHÁT HIỆN QUAN TRỌNG NHẤT (đọc kỹ)
- **KHÔNG có deadlock nào** — bottleneck duy nhất là **Docker volume I/O trên Windows: ~10-20k rows/s** cho mọi COPY. Đo thực tế: user_events 2.58M rows = 268s (9.6k/s), osh 5M rows = 275s. user_events 25M rows cần ~40-45 phút. Phase2 tổng ~2 giờ.
- **"0 dòng sau N phút" ≠ deadlock** — chỉ là COPY đang chạy chậm (dữ liệu chỉ visible sau khi PG flush; count(*) thấy 0 tới khi bảng xong vì COPY single statement). Kiểm tra `pg_stat_activity` thấy `COPY ... active` = đang chạy, chỉ cần đợi.
- **BUG O(n²) ĐÃ FIX**: `globalOrderItemId` cũ vòng lặp O(o) mỗi lần gọi → refunds/returns treo vô hạn ở 5M đơn. Sửa bằng **prefix sum** (`buildItemPrefix` trước refunds, lookup O(1)). Đây là bug duy nhất thực sự gây "treo vô hạn" (CPU 0, COPY active mãi).
- **heap 4GB + cache 1M entries array** là điểm cân bằng đúng (heap 8GB + cache 5M → GC freeze).
- Phase2 (1M khách, ~45M rows): **~2 giờ** trên máy này. Phase3 (10M, ~450M rows): **~20 giờ** — KHÔNG khả thi full, chỉ test `--sample`, hoặc tối ưu hạ tầng (đổi volume Docker sang bind mount, hoặc chạy Postgres native trên Windows không qua Docker).
- **Nếu muốn phase3 nhanh**: chạy Postgres native (không Docker volume) sẽ tăng I/O 5-10x. Đây là hướng tối ưu duy nhất còn lại.

### Những cạm bẫy khác đã gặp
- `xxhash-wasm` v1.1.0 dùng **default export** `xxhash()` → `.h32(str, seed)`
- **cmd.exe nuốt `node -e` escape phức tạp** → luôn chạy qua file script
- `new URL(...)` đọc file treo trên Windows → dùng `path.join(__dirname, ...)`
- stdout redirect file bị node buffer → kiểm tra tiến độ qua `psql count(*)` + `pg_stat_activity`
- `cwd` param shell_command không đáng tin → luôn `cd "E:\...\novashop-seeder" &&` tiền tố
- PG COPY **không parse epoch ms** cho timestamptz → phải `new Date(ms).toISOString()`
- `checkpoint_timeout`/`full_page_writes` là server-level — không SET session (lỗi 55P02)
- row count thực order_items phase2 = 9.37M (config 15M là target ước lượng; generator ra 1.87 items/đơn)

## ⏳ ĐANG LÀM (session tiếp theo bắt đầu từ đây)

1. **Phase2 đang chạy** (task `smzuvcbm` started 02:06, ~2 giờ). Khi xong:
   - `npm run db:verify -- --phase=2` phải OK (manifest mới được ghi đè)
   - Kiểm tra nhanh: `SELECT count(*) FROM customers/orders/order_items/...`
2. **Test phase3 với `--sample=0.01`**: `node --max-old-space-size=4096 src/cli.js db:reset --phase=3 --sample=0.01` → verify
3. **So 20 dòng đầu customers giữa phase1 và phase3** — phải giống hệt (tính liên tục theo entity)
4. **Sinh NOVASHOP_DATA_REFERENCE.md**: `node scripts/generate-reference-doc.js` → đưa file + schema.sql vào Project Knowledge
5. **Full phase3 (10M)** — ~20 giờ qua Docker; nếu muốn nhanh, chuyển Postgres native (không Docker volume)

## 📊 SỐ LIỆU THAM KHẢO
- Generator orders: ~55k/s; osh cache-hit: 283k/s (generator thuần)
- COPY qua Docker volume: **~15-20k rows/s** (bottleneck I/O)
- Phase1 (10k): ~15s; Phase2 (1M): ~70-80 phút (đang chạy lần cuối)

## 🐳 LỆNH HAY DÙNG
```bash
cd "E:\vdev_youtube\query-design-v2\novashop-seeder"
docker compose up -d          # Postgres cổng 5434
npm run db:schema             # idempotent
npm run db:reset -- --phase=1 # truncate + seed + manifest
npm run db:verify -- --phase=1
docker exec novashop-seeder-postgres-1 psql -U novashop -d novashop -c "SELECT count(*) FROM customers;"
```

---

# SESSION 2 (2026-09-01) — Chuyển native + giảm data + backup/restore

> Cập nhật từ phiên làm việc thực tế. Toàn bộ thay đổi code/config bên dưới đã áp dụng.

## ✅ ĐÃ LÀM

### 1. Giảm rowCounts phase 2 & 3 (giữ nguyên messiness)
- **phase2.json**: orders 5M → **1M**, customers 1M → **200k**, user_events 25M → 5M, osh 22M → 4.4M, các bảng con giảm theo tỷ lệ. Tổng ~18.5M rows.
- **phase3.json**: orders 50M → **5M**, customers 10M → **1M**, user_events 250M → 25M, osh 220M → 22M. Tổng ~92.6M rows.
- Lý do: phase 2 chỉ cần đủ để demo "công ty tăng trưởng có adapt không" (~30x phase 1 là đủ), phase 3 để đo performance. Messiness giữ nguyên 100% (data vẫn "bẩn").

### 2. Chuyển sang PostgreSQL native (bỏ Docker)
- Máy có sẵn **PostgreSQL 14.4 native** (service `postgresql-x64-14`), database `novashop` tạo trong pgAdmin.
- `.env`: `DATABASE_URL=postgres://postgres@localhost:5432/novashop` (pg_hba trust localhost → không cần password).
- **Di chuyển data dir C: → E:** (ổ C chỉ còn 12GB, E: còn 97GB):
  - Service dùng `pg_ctl runservice -D <path>` — đường dẫn ở **registry** `HKLM\SYSTEM\CurrentControlSet\Services\postgresql-x64-14\ImagePath`, KHÔNG đọc từ postgresql.conf.
  - Script: `scripts/move-pgdata-to-E.ps1` (chạy elevated qua UAC) — dừng service → robocopy `C:\Program Files\PostgreSQL\14\data` → `E:\pgdata` → cấp quyền NetworkService → đổi registry → start → verify.
  - **Lưu ý**: script phải **ASCII thuần** (không dấu tiếng Việt) — PowerShell 5.1 đọc file UTF-8 không BOM theo ANSI → vỡ ký tự → lỗi cú pháp.
  - **Cạm bẫy cổng 5432**: Docker container `postgres-dev` chiếm 5432 (com.docker.backend giữ port) → Postgres native không bind được ("Permission denied"). Phải `docker stop postgres-dev`.

### 3. Tối ưu tốc độ seed (kết quả đo thực)
- **Nút thắt thật sự KHÔNG phải Docker volume** (BUILD_PROGRESS cũ nói sai): benchmark COPY native cũng chỉ ~14-19k rows/s, y hệt Docker. Lý do: cả 2 đều `fsync=on` + `full_page_writes=on` trên cùng ổ C:.
- Generator JS nhanh (orders 89k/s, osh 444k/s, order_items 630k/s) — **bottleneck là COPY vào Postgres** (WAL + page writes).
- **Fix đã áp dụng** (chỉ khi seed, qua `ALTER SYSTEM` + `pg_reload_conf()`, không restart):
  ```sql
  ALTER SYSTEM SET full_page_writes = off;  -- quan trọng nhất
  ALTER SYSTEM SET fsync = off;
  ALTER SYSTEM SET max_wal_size = '16GB';
  ALTER SYSTEM SET checkpoint_timeout = '30min';
  SELECT pg_reload_conf();
  ```
- **Kết quả thực tế**:
  | Phase | Trước (native mặc định) | Sau (tối ưu) |
  |---|---|---|
  | Phase 2 (18M rows) | ~25 phút | **~19 phút** |
  | Phase 3 (93M rows) | ước ~2h+ | **~81 phút** |
- **LUÔN bật lại sau seed**: `full_page_writes=on`, `fsync=on`, `max_wal_size='1GB'`, `checkpoint_timeout='5min'` (để off mà crash → hỏng data).

### 4. Backup + Restore phase 2 & 3 (đã test thành công)
- **File backup trong dự án**: `phase2.sql` (1.18 GB), `phase3.sql` (5.95 GB) — pg_dump plain format, `--no-owner --no-privileges`, portable.
- **Lệnh backup**: `scripts/backup-phase2.ps1` (pg_dump ra `E:\novashop-backups\`, timestamp).
- **CLI restore mới** trong `src/cli.js` + `package.json` (`db:restore`):
  ```bash
  npm run db:restore                        # restore phase2.sql, hỏi xác nhận
  npm run db:restore -- -y                  # không hỏi
  npm run db:restore -- -f phase3.sql       # file khác
  ```
  - Đọc `DATABASE_URL` từ `.env`, **DROP + CREATE DATABASE** rồi import qua `psql -f` (stream, không load vào RAM).
  - Tự tìm psql (PATH hoặc `C:\Program Files\PostgreSQL\{14-17}\bin`).
  - Verify row counts sau restore.
- **Kết quả test**:
  - Restore phase2: ~4 phút, verify OK.
  - Restore phase3: ~33 phút, verify OK.

## 📊 SỐ LIỆU THỰC TẾ (đã đo)

| Bảng | Phase 2 | Phase 3 |
|---|---|---|
| customers | 200,000 | 1,000,000 |
| orders | 1,000,000 | 5,000,000 |
| order_items | 1,875,938 | ~9,997,727 |
| order_status_history | 4,986,536 | ~22M |
| user_events | 5,000,000 | 25,000,000 |
| shipments | 1,172,982 | ~5.4M |
| delivery_attempts | 1,200,000 | ~6.1M |
| payments | 485,774 | ~4.5M |
| reviews | 500,000 | 2.5M |
| cod_remittances | 400,000 | 2M |
| refunds / returns | 28,719 | 350k / 330k |
| order_price_history | 144,020 | 800k |
| customer_tier_history | 24,981 | 2.6M |
| customer_addresses | 15,000 | — |

## ⚠️ LƯU Ý QUAN TRỌNG (kinh nghiệm mới)

1. **categories id cao là bình thường** — id = hash(seed) (`uniqueHashId`), không phải SERIAL. TRUNCATE không reset được.
2. **PowerShell 5.1 + UTF-8**: file .ps1 có tiếng Việt có dấu → lỗi parse. Viết ASCII.
3. **Nâng quyền admin**: shell thường không dừng/start được service Postgres — dùng `Start-Process -Verb RunAs` (bật UAC), script ghi log qua `Start-Transcript` để đọc kết quả.
4. **psql không trong PATH** — dùng đường dẫn đầy đủ `C:\Program Files\PostgreSQL\14\bin\psql.exe` hoặc để CLI tự tìm.
5. **Cổng 5432 có thể bị Docker chiếm** (`com.docker.backend`) — kiểm tra `netstat -ano | findstr :5432` trước khi start Postgres native.
6. **File 1-6GB không đọc bằng Get-Content -Raw** (OOM) — dùng findstr hoặc stream.
7. **count(*) trên bảng 22M+ đang COPY bị timeout** — theo dõi tiến độ qua `pg_stat_activity` (query LIKE 'COPY%') thay vì count.

## ⏳ CÒN LẠI (nếu cần)
- Phase 1 vẫn dùng Docker? (chưa đụng) — data phase 1 có thể seed nhanh qua native luôn.
- `generate-reference-doc.js` — sinh NOVASHOP_DATA_REFERENCE.md từ DB phase 3 (nếu muốn).
- Nếu muốn phase 3 nhanh hơn nữa: chạy song song các COPY độc lập (pool max 8 sẵn có), hoặc tăng cache orderMeta (hiện 1M entries, phase 3 5M orders nên 4M tính lại).
