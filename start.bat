@echo off
chcp 65001 >nul
title Audio Stream Server

echo ========================================
echo    Audio Stream Server v1.0.0
echo ========================================
echo.

cd /d "%~dp0"

if not exist "node_modules" (
    echo [1/2] Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo.
        echo ERROR: Failed to install dependencies
        pause
        exit /b 1
    )
    echo.
)

if not exist "dist" (
    echo [2/2] Building project...
    call npm run build
    if errorlevel 1 (
        echo.
        echo ERROR: Failed to build project
        pause
        exit /b 1
    )
    echo.
)

echo Starting server...
echo.

for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3001 ^| findstr LISTENING 2^>nul') do (
    echo Killing process on port 3001 ^(PID: %%a^)...
    taskkill /F /PID %%a >nul 2>&1
)

timeout /t 1 /nobreak >nul

call npm start

pause
