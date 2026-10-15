@echo off
title EgitiJAM yuk testi
cd /d "%~dp0"
REM Gecici, ayri bir test sunucusu acar; gercek veriniz kullanilmaz. Yaklasik 4 dakika surer.
REM Farkli kullanici sayisi icin: yuk-testi.bat 1000
set KULLANICI=%1
if "%KULLANICI%"=="" set KULLANICI=500
node --no-warnings yuk-testi\yuk-testi.js --kullanici %KULLANICI%
pause
