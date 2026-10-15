@echo off
title EgitiJAM ornek veri
cd /d "%~dp0"
REM ornek-yukle.bat ile eklenen ornek takimlari (kullanici adi ornek1, ornek2 ...) siler. Gercek takimlara dokunmaz.
if not exist .env (
  echo .env dosyasi yok. Once baslat.bat ile kurulumu yapin.
  pause
  exit /b 1
)
node --no-warnings --env-file=.env ornek\ornek-yukle.js --sil
pause
