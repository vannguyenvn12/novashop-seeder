# NovaShop Seeder

Postgres data generator cho khóa Query Design — 18 bảng, 3 phase tăng trưởng.

## Yêu cầu
- Node.js >= 18
- PostgreSQL (native 14+ hoặc Docker)
- Đã cài dependencies: `npm install`

## Cấu hình
Sửa `.env`:
```
DATABASE_URL=postgres://user:pass@host:port/novashop
BASE_SEED=novashop-course-2026
MANIFEST_DIR=.seed-manifest
```
> Máy dev dùng PostgreSQL 14 native (service `postgresql-x64-14`, data dir `E:\pgdata`), pg_hba trust localhost → không cần password.

## Lệnh chính
```bash
npm run db:schema                 # áp schema.sql (idempotent)

# Seed 1 phase (tự TRUNCATE + seed + ghi manifest)
npm run db:reset -- --phase=1     # nhỏ, ~15s
npm run db:reset -- --phase=2     # 18M rows, ~20 phút
npm run db:reset -- --phase=3     # 93M rows, ~80 phút

# Verify data khớp manifest (row count + checksum)
npm run db:verify -- --phase=1

# Restore từ backup SQL (drop + recreate DB theo DATABASE_URL, import, verify)
npm run db:restore                        # phase2.sql (~4 phút)
npm run db:restore -- -f phase3.sql       # phase3.sql (~33 phút)
npm run db:restore -- -y -f <file.sql>    # không hỏi xác nhận
```

## Backup
```powershell
# pg_dump ra E:\novashop-backups\ với timestamp
powershell -File scripts/backup-phase2.ps1
```
File backup sẵn có trong dự án: `phase2.sql` (1.18 GB), `phase3.sql` (5.95 GB).

## Scale data
Row counts + messiness nằm trong `src/scenarios/phase{1,2,3}.json`.
- Phase 2: demo "công ty tăng trưởng, query có adapt không" (gấp ~30x phase 1)
- Phase 3: đo performance (gấp ~5x phase 2)

## Tăng tốc seed (native)
Trước khi seed phase lớn, bật tối ưu (áp qua `ALTER SYSTEM` + reload, không restart):
```sql
ALTER SYSTEM SET full_page_writes = off;
ALTER SYSTEM SET fsync = off;
ALTER SYSTEM SET max_wal_size = '16GB';
ALTER SYSTEM SET checkpoint_timeout = '30min';
SELECT pg_reload_conf();
```
**Sau khi seed xong phải bật lại** (nếu crash khi để off → hỏng data):
```sql
ALTER SYSTEM SET full_page_writes = on;
ALTER SYSTEM SET fsync = on;
ALTER SYSTEM SET max_wal_size = '1GB';
ALTER SYSTEM SET checkpoint_timeout = '5min';
SELECT pg_reload_conf();
```

## Lưu ý
- `categories` id là hash theo seed (không phải SERIAL) — id cao là bình thường.
- Trên máy này, cổng 5432 có thể bị Docker container `postgres-dev` chiếm — kiểm tra `netstat -ano | findstr :5432`, dừng container nếu cần.
- Chi tiết kỹ thuật + lịch sử: xem `BUILD_PROGRESS.md`.
