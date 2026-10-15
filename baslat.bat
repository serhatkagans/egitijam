@echo off
title EgitiJAM sunucusu
cd /d "%~dp0"

REM Ilk calistirma: .env yoksa .env.example'dan olusturulur ve yonetici sifresi sorulur
if exist .env goto calistir
echo Ilk kurulum: yonetim paneli (/yonetim) icin bir sifre belirleyin, en az 6 karakter.
set DENEME=0

:sor
set /a DENEME+=1
if %DENEME% gtr 5 (
  echo Sifre belirlenemedi. .env.example dosyasini .env olarak kopyalayip ADMIN_SIFRE degerini elle yazin.
  pause
  exit /b 1
)
set "SIFRE="
set /p "SIFRE=Yonetici sifresi: "
if not defined SIFRE goto sor
REM <nul: PowerShell klavye girdisini okumasin
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$s = $env:SIFRE; if ($s.Length -lt 6) { exit 1 };" ^
  "$satirlar = (Get-Content .env.example -Encoding UTF8) -replace '^ADMIN_SIFRE=.*', ('ADMIN_SIFRE=' + $s);" ^
  "[IO.File]::WriteAllLines((Join-Path (Get-Location) '.env'), $satirlar, (New-Object Text.UTF8Encoding $false))" <nul
if errorlevel 1 (
  echo Sifre en az 6 karakter olmali.
  goto sor
)
set "SIFRE="
echo Sifre .env dosyasina yazildi. Sonradan yonetim panelinden degistirebilirsiniz.
echo.

:calistir
node --no-warnings --env-file=.env server.js
pause
