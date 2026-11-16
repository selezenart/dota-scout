@echo off
rem Captain's Draft Board local helper (Windows).
rem One-time setup: npm ci --ignore-scripts, then npm run bot-login (see README.md).
rem Optional: a Steam Web API key on one line in steam-key.txt next to this file.
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
if exist bot-login-token.txt if not exist node_modules\steam-user (
  echo Installing the helper's one dependency ^(steam-user^)...
  call npm ci --ignore-scripts
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
node server.mjs
pause
