# Start postgresql-x64-14 service and report status (run elevated)
$ErrorActionPreference = 'Continue'
$LOG = 'E:\vdev_youtube\query-design-v2\novashop-seeder\scripts\start-pg.log'
Start-Transcript -Path $LOG -Force | Out-Null
Write-Host 'Starting service...'
try {
  Start-Service -Name 'postgresql-x64-14' -ErrorAction Stop
} catch {
  Write-Host ("START_ERROR: " + $_.Exception.Message)
}
Start-Sleep -Seconds 6
$svc = Get-Service -Name 'postgresql-x64-14'
Write-Host ("STATUS=" + $svc.Status)
$env:PGPASSWORD = ''
$conn = & 'C:\Program Files\PostgreSQL\14\bin\psql.exe' -U postgres -h localhost -p 5432 -d novashop -c "SELECT count(*) AS orders FROM orders;" 2>&1
Write-Host ("PSQL_OUT: " + ($conn -join ' '))
Stop-Transcript | Out-Null
