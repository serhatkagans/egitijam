@echo off
title EgitiJAM ornek veri
cd /d "%~dp0"
REM Vitrini denemek icin ornek takimlar, oyunlar ve gecmis yillar ekler. Sunucu acik olmali (baslat.bat).
if not exist .env (
  echo .env dosyasi yok. Once baslat.bat ile kurulumu yapin.
  pause
  exit /b 1
)
node --no-warnings --env-file=.env ornek\ornek-yukle.js
pause
