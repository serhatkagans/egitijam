@echo off
chcp 65001 >nul
title EgitiJAM durdurucu
cd /d "%~dp0"
REM .env'deki PORT (yoksa 3100) uzerinde dinleyen node surecini kapatir. Baska programa dokunmaz.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$port = 3100;" ^
  "if (Test-Path .env) { $m = Select-String -Path .env -Pattern '^\s*PORT\s*=\s*(\d+)' | Select-Object -First 1; if ($m) { $port = [int]$m.Matches[0].Groups[1].Value } };" ^
  "$c = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue;" ^
  "if (-not $c) { Write-Host ('Port ' + $port + ' uzerinde calisan EgitiJAM sunucusu yok.'); exit };" ^
  "foreach ($id in ($c.OwningProcess | Sort-Object -Unique)) {" ^
  "  $p = Get-Process -Id $id -ErrorAction SilentlyContinue;" ^
  "  if ($p -and $p.ProcessName -eq 'node') { Stop-Process -Id $id -Force; Write-Host ('EgitiJAM sunucusu durduruldu (port ' + $port + ', PID ' + $id + ').') }" ^
  "  else { Write-Host ('Port ' + $port + ' baska bir program tarafindan kullaniliyor (' + $p.ProcessName + '); dokunulmadi.') }" ^
  "}"
pause
