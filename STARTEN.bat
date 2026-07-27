@echo off
title Projekt Mittelberg Regelwerk
cd /d "%~dp0"

if not exist ".env" (
  echo.
  echo FEHLER: Die Datei .env fehlt.
  echo Kopiere zuerst .env.example und benenne die Kopie in .env um.
  echo Danach Client ID, Client Secret und deine Discord-Benutzer-ID eintragen.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Abhaengigkeiten werden installiert...
  call npm install
  if errorlevel 1 (
    echo Installation fehlgeschlagen.
    pause
    exit /b 1
  )
)

echo Server wird gestartet...
call npm start
pause
