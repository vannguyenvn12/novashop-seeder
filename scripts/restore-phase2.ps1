# Restore phase 2 (DB novashop) từ file SQL backup — chạy trên máy khác
# Yêu cầu: PostgreSQL đã cài, DB 'novashop' đã tồn tại (rỗng là tốt nhất)
# Cách dùng:  powershell -File scripts/restore-phase2.ps1 <path-to-sql>
# Ví dụ:      powershell -File scripts/restore-phase2.ps1 E:\novashop-backups\novashop-phase2-20260901-033000.sql
param([Parameter(Mandatory=$true)][string]$SqlFile)

$ErrorActionPreference = 'Stop'

$PG_BIN = 'C:\Program Files\PostgreSQL\14\bin'
$HOST = 'localhost'
$PORT = '5432'
$DB = 'novashop'
$USER = 'postgres'

if (-not (Test-Path $SqlFile)) { Write-Error "Không thấy file: $SqlFile"; exit 1 }

Write-Host "Restoring $SqlFile -> $DB (db này sẽ bị ghi đè)..."
Write-Host "DANGER: dữ liệu hiện tại trong $DB sẽ bị thay. Tiếp tục? (y/N)"
$ans = Read-Host
if ($ans -notin @('y','Y')) { Write-Host 'Hủy.'; exit 0 }

# Drop + recreate DB để restore sạch (file SQL có CREATE TABLE, không có CREATE DATABASE)
& "$PG_BIN\psql.exe" -U $USER -h $HOST -p $PORT -d postgres -c "DROP DATABASE IF EXISTS $DB;" 2>&1
& "$PG_BIN\psql.exe" -U $USER -h $HOST -p $PORT -d postgres -c "CREATE DATABASE $DB;" 2>&1

Write-Host 'Importing data (có thể mất vài phút)...'
& "$PG_BIN\psql.exe" -U $USER -h $HOST -p $PORT -d $DB -f $SqlFile 2>&1
if ($LASTEXITCODE -ne 0) { Write-Error "psql restore failed (exit $LASTEXITCODE)"; exit 1 }

# Verify nhanh
& "$PG_BIN\psql.exe" -U $USER -h $HOST -p $PORT -d $DB -c "SELECT (SELECT count(*) FROM customers) AS customers, (SELECT count(*) FROM orders) AS orders, (SELECT count(*) FROM order_items) AS order_items;" 2>&1
Write-Host 'DONE!'
