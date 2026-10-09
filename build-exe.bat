@echo off
setlocal EnableExtensions
title Mercify - build exe
cd /d "%~dp0overlay"

rem Builds the Windows installer and portable exe into overlay\dist.
rem Needs Node.js 22.12+ (setup-and-run.bat installs it if you don't have it).

where node >nul 2>&1
if errorlevel 1 (
    echo.
    echo  Node.js isn't installed. Run setup-and-run.bat once first, or install Node LTS from nodejs.org.
    echo.
    pause
    exit /b 1
)

echo.
echo  [1/2] Installing build tools ^(npm install^)...
call npm install --no-audit --no-fund
if errorlevel 1 goto :failed

echo.
echo  [2/2] Building the installer and portable exe ^(takes a minute or two^)...
call npm run dist
if errorlevel 1 goto :failed

title Mercify - build exe
echo.
echo  Done. Opening the dist folder:
echo    Mercify-Setup.exe                    installer ^(recommended^)
echo    Mercify-portable.exe                 single file, no install
echo.
start "" "%~dp0overlay\dist"
pause
exit /b 0

:failed
title Mercify - build exe
echo.
echo  ERROR: the build failed. The messages above say why; send me a screenshot.
echo.
pause
exit /b 1
