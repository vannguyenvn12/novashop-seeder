# Move PostgreSQL 14 data dir to E:\pgdata  (run elevated)
$ErrorActionPreference = 'Stop'

$LOG = 'E:\vdev_youtube\query-design-v2\novashop-seeder\scripts\move-pgdata.log'
Start-Transcript -Path $LOG -Force | Out-Null

$SRC = 'C:\Program Files\PostgreSQL\14\data'
$DST = 'E:\pgdata'
$SVC = 'postgresql-x64-14'
$PG_BIN = 'C:\Program Files\PostgreSQL\14\bin'

# 0) admin check
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { Write-Error 'Need Administrator!'; exit 1 }
if (-not (Test-Path $SRC)) { Write-Error "Source data dir not found: $SRC"; exit 1 }

$dstHasData = (Test-Path "$DST\PG_VERSION") -and (Test-Path "$DST\base")
if ($dstHasData) {
  Write-Host '[2/6] DST already has PG data - skip copy.'
}
elseif (Test-Path $DST) {
  Write-Error "$DST exists but not a PG data dir - abort."; exit 1
}
else {
  Write-Host '[1/6] Stopping service...'
  Stop-Service -Name $SVC -Force
  Start-Sleep -Seconds 3
  if ((Get-Service -Name $SVC).Status -ne 'Stopped') { Write-Error 'Could not stop service'; exit 1 }

  Write-Host '[2/6] Copying data -> E:\pgdata (may take a while)...'
  robocopy $SRC $DST /E /COPY:DAT /DCOPY:T /R:1 /W:1 /NFL /NDL /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { Write-Error "robocopy failed (code $LASTEXITCODE)"; exit 1 }
}

Write-Host '[3/6] Granting permission to NetworkService...'
$acl = Get-Acl $DST
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule('NT AUTHORITY\NetworkService','FullControl','ContainerInherit,ObjectInherit','None','Allow')
$acl.SetAccessRule($rule)
Set-Acl -Path $DST -AclObject $acl
icacls $DST /grant "NT AUTHORITY\NetworkService:(OI)(CI)F" /T /Q | Out-Null

Write-Host '[4/6] Updating registry ImagePath -> E:\pgdata...'
$reg = 'HKLM:\SYSTEM\CurrentControlSet\Services\postgresql-x64-14'
$old = (Get-ItemProperty $reg).ImagePath
$new = $old -replace [regex]::Escape('"C:\Program Files\PostgreSQL\14\data"'), '"E:\pgdata"'
if ($new -eq $old) { Write-Error 'Could not find old -D path in ImagePath'; exit 1 }
Set-ItemProperty -Path $reg -Name ImagePath -Value $new
Write-Host "  New ImagePath: $new"

Write-Host '[5/6] Starting service...'
Start-Service -Name $SVC
Start-Sleep -Seconds 4
if ((Get-Service -Name $SVC).Status -ne 'Running') { Write-Error 'Service did not start - check log'; exit 1 }

Write-Host '[6/6] Verifying connection...'
$env:PGPASSWORD = ''
$out = & "$PG_BIN\psql.exe" -U postgres -h localhost -p 5432 -d novashop -c "SELECT count(*) AS orders FROM orders;" 2>&1
Write-Host $out

Write-Host ''
Write-Host '==> DONE! Data is now at E:\pgdata. Original C:\...\data kept as rollback.'
Write-Host '    After confirming OK, remove original with:'
Write-Host '    Remove-Item -Recurse -Force "C:\Program Files\PostgreSQL\14\data"'
Stop-Transcript | Out-Null
