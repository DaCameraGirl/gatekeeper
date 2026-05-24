@echo off
title GateKeeper — DevOps AI Engineer
color 0B
cd /d "%~dp0"
echo.
echo  =====================================
echo   GateKeeper is waking up...
echo  =====================================
echo.

:: Check for .env file
if not exist .env (
  echo  ERROR: No .env file found.
  echo  Copy .env.example to .env and add your ANTHROPIC_API_KEY
  echo.
  pause
  exit /b 1
)

:: Load .env
for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
  if not "%%A"=="" if not "%%A:~0,1%"=="#" set "%%A=%%B"
)

echo  Starting server...
echo  Opening browser at http://localhost:3000
echo.
timeout /t 2 /nobreak >nul
start "" http://localhost:3000
node server.js
pause
