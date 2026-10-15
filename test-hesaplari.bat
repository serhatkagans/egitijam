@echo off
cd /d "%~dp0"
REM Her rol icin birer deneme hesabi acar (takim, mentor, juri). Sunucu acik olmali.
REM Giris bilgileri test-hesaplari.txt dosyasina yazilir.
if not exist .env ( echo .env dosyasi yok. Once baslat.bat ile kurulumu yapin. & pause & exit /b 1 )
node --no-warnings --env-file=.env ornek	est-hesaplari.js
if exist test-hesaplari.txt start "" notepad test-hesaplari.txt
pause
