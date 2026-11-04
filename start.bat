@echo off
setlocal
cd /d "%~dp0"
title Caricature Photobooth

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install it from https://nodejs.org and run again.
  pause
  exit /b 1
)

if not exist ".env" (
  if exist ".env.example" (
    copy ".env.example" ".env" >nul
    echo Created .env from .env.example - add your OPENAI_API_KEY for AI mode.
  )
)

if not exist "node_modules" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

echo.
echo Starting at https://localhost:5173  (add ?mode=ai or ?mode=test)
start "" "https://localhost:5173"
call npm run dev
pause
