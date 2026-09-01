# Backup phase 2 (DB novashop) ra file SQL — portable sang máy khác
# Cách dùng:  powershell -File scripts/backup-phase2.ps1
$ErrorActionPreference = 'Stop'

$PG_BIN = 'C:\Program Files\PostgreSQL\14\bin'
$BACKUP_DIR = 'E:\novashop-backups'
$OUT = Join-Path $BACKUP_DIR ('novashop-phase2-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.sql')

if (-not (Test-Path $BACKUP_DIR)) { New-Item -ItemType Directory -Path $BACKUP_DIR -Force | Out-Null }

Write-Host "Dumping DB novashop -> $OUT ..."
& "$PG_BIN\pg_dump.exe" -U postgres -h localhost -p 5432 -d novashop `
  --format=plain --no-owner --no-privileges `
  --file=$OUT 2>&1

if ($LASTEXITCODE -ne 0) { Write-Error "pg_dump failed (exit $LASTEXITCODE)"; exit 1 }
$size = [math]::Round((Get-Item $OUT).Length / 1MB, 1)
Write-Host "DONE: $OUT ($size MB)"
