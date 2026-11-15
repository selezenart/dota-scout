@echo off
rem Captain's Draft Board local helper (Windows).
rem Put your Steam Web API key on one line in steam-key.txt next to this file.
rem Optional overrides (remove "rem" to use):
rem set DOTA_CONSOLE_LOG=D:\SteamLibrary\steamapps\common\dota 2 beta\game\dota\console.log
rem set DOTA_ACCOUNT_ID=123456789
title Captain's Draft Board helper
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20 or newer is required. Install the LTS version from https://nodejs.org and run this file again.
  pause
  exit /b 1
)
node server.mjs
pause
