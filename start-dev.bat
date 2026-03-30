@echo off
title Phonbot Dev — API + Web
cd /d "%~dp0"

echo.
echo  ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
echo   Phonbot Dev Server startet...
echo   API:  http://localhost:3001
echo   Web:  http://localhost:3000
echo  ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
echo.

:: Start API in background
start "Phonbot API" cmd /c "cd apps\api && npx tsx src/index.ts"

:: Wait for API to boot
timeout /t 3 /nobreak >nul

:: Start Vite (foreground)
cd apps\web
npx vite --host
pause
