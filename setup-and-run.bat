@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Mercify - setup and launch
cd /d "%~dp0"

rem ============================================================================
rem  Mercify: all-in-one setup + launch
rem
rem    setup-and-run.bat            install anything missing, then launch
rem    setup-and-run.bat demo       launch against a fake Spotify (no SpotX/Spicetify needed)
rem    setup-and-run.bat reapply    force "spicetify apply" (use after a Spotify update)
rem    setup-and-run.bat spotx      (re)install SpotX first, then everything else
rem
rem  Safe to run every time: steps that are already done are skipped.
rem ============================================================================

set "ROOT=%~dp0"
set "OVERLAY=%ROOT%overlay"
set "EXT_SRC=%ROOT%spicetify\overlay-bridge.js"
set "SPOTIFY_DIR=%APPDATA%\Spotify"
set "SPOTIFY_EXE=%APPDATA%\Spotify\Spotify.exe"
set "ELECTRON_EXE=%OVERLAY%\node_modules\electron\dist\electron.exe"
set "SPOTX_MARK=%ROOT%.spotx-installed"
set "MODE=%~1"
set "STEPS=5"
if /i "%MODE%"=="demo" set "STEPS=2"

echo.
echo  Mercify setup
echo  =============
echo.

rem Spicetify refuses to run as administrator, so this script must not be elevated either.
net session >nul 2>&1
if not errorlevel 1 (
    set "FAILMSG=Please run this file normally, not "Run as administrator". Spicetify refuses to run elevated. Installers that need admin will ask for it themselves."
    goto :fail
)

if not exist "%EXT_SRC%" (
    set "FAILMSG=Can't find spicetify\overlay-bridge.js. Run this file from inside the spotify-overlay folder."
    goto :fail
)

rem ---------------------------------------------------------------------------
echo [1/%STEPS%] Node.js
rem ---------------------------------------------------------------------------
call :check_node
if defined NODE_OK (
    echo       found Node !NODE_VER!
    goto :node_done
)
where winget >nul 2>&1
if errorlevel 1 (
    echo       winget isn't available, so Node.js can't be installed automatically.
    echo       Opening nodejs.org: install the LTS version, then run this file again.
    start "" "https://nodejs.org/"
    set "FAILMSG=Node.js 22.12 or newer is required."
    goto :fail
)
if defined NODE_VER (
    echo       Node !NODE_VER! is too old, upgrading to the current LTS...
    winget upgrade -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    if errorlevel 1 winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
) else (
    echo       installing Node.js LTS with winget ^(approve the admin prompt if one appears^)...
    winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
)
rem The installer updates PATH for new windows only; add it to this one too.
set "PATH=%ProgramFiles%\nodejs;%PATH%"
call :check_node
if not defined NODE_OK (
    set "FAILMSG=Node.js still isn't available. Close this window, open a new one and run this file again, or install Node LTS from nodejs.org."
    goto :fail
)
echo       installed Node !NODE_VER!
:node_done

rem ---------------------------------------------------------------------------
echo [2/%STEPS%] Overlay app dependencies
rem ---------------------------------------------------------------------------
set "NEED_NPM="
if not exist "%OVERLAY%\node_modules\electron\install.js" set "NEED_NPM=1"
if not exist "%OVERLAY%\node_modules\ws\package.json" set "NEED_NPM=1"
if defined NEED_NPM (
    echo       running npm install...
    pushd "%OVERLAY%"
    call npm install --no-audit --no-fund
    set "NPM_ERR=!errorlevel!"
    popd
    title Mercify - setup and launch
    if not "!NPM_ERR!"=="0" (
        set "FAILMSG=npm install failed. Check your internet connection and run this file again."
        goto :fail
    )
)
rem Electron 44+ doesn't download its binary during npm install; it has its own installer.
if exist "%ELECTRON_EXE%" (
    echo       already installed
    goto :deps_done
)
echo       downloading the Electron runtime ^(about 120 MB^)...
call :download_electron
if not exist "%ELECTRON_EXE%" (
    echo       download didn't finish, retrying once...
    call :download_electron
)
if not exist "%ELECTRON_EXE%" (
    set "FAILMSG=Electron didn't download. Check your connection, and that antivirus isn't blocking electron.exe, then run this file again."
    goto :fail
)
echo       done
:deps_done

if /i "%MODE%"=="demo" goto :launch_demo

rem ---------------------------------------------------------------------------
echo [3/%STEPS%] Spotify + SpotX
rem ---------------------------------------------------------------------------
call :find_spicetify
set "RUN_SPOTX="
if /i "%MODE%"=="spotx" set "RUN_SPOTX=1"
if not exist "%SPOTIFY_EXE%" (
    echo       Spotify desktop isn't installed. SpotX installs it for you.
    set "RUN_SPOTX=1"
)
rem First-time setup: SpotX has to go on before Spicetify, so ask once.
if not defined RUN_SPOTX if not defined SPICE if not exist "%SPOTX_MARK%" (
    echo.
    choice /c YN /n /m "      Is SpotX already installed on this Spotify? [Y/N] "
    if errorlevel 2 set "RUN_SPOTX=1"
    if not defined RUN_SPOTX echo SpotX installed before this script> "%SPOTX_MARK%"
)
if not defined RUN_SPOTX (
    echo       Spotify found, skipping SpotX
    goto :spotx_done
)
echo       running the SpotX installer ^(blocks Spotify auto-updates^)...
echo       Follow any prompts in the SpotX window, then come back here.
powershell -NoProfile -ExecutionPolicy Bypass -Command "& ([scriptblock]::Create((Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/SpotX-Official/SpotX/refs/heads/main/run.ps1').Content)) -confirm_uninstall_ms_spoti -confirm_spoti_recomended_over -block_update_on -new_theme"
if not exist "%SPOTIFY_EXE%" (
    set "FAILMSG=Spotify still isn't installed after SpotX ran. Check the SpotX output above."
    goto :fail
)
echo SpotX installed by setup-and-run.bat> "%SPOTX_MARK%"
rem A fresh SpotX install means Spicetify has to re-apply on top of it.
set "FORCE_APPLY=1"
:spotx_done

rem ---------------------------------------------------------------------------
echo [4/%STEPS%] Spicetify + Overlay Bridge extension
rem ---------------------------------------------------------------------------
if defined SPICE (
    echo       found Spicetify
    goto :spice_installed
)
echo       installing Spicetify...
echo       It will ask whether to install the Spicetify Marketplace. Either answer is fine.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/spicetify/cli/main/install.ps1' | Invoke-Expression"
call :find_spicetify
if not defined SPICE (
    set "FAILMSG=Spicetify didn't install. Check the output above, or install it from spicetify.app and run this file again."
    goto :fail
)
set "FORCE_APPLY=1"
:spice_installed

rem Spicetify reads Spotify's prefs file, which only exists after Spotify has run once.
if not exist "%SPOTIFY_DIR%\prefs" (
    echo       starting Spotify once so it creates its settings ^(log in if asked^)...
    start "" "%SPOTIFY_EXE%"
    call :wait_for_prefs
)

rem Find Spicetify's Extensions folder.
set "SPICE_USER="
for /f "delims=" %%P in ('call "%SPICE%" path userdata 2^>nul') do set "SPICE_USER=%%P"
if not defined SPICE_USER set "SPICE_USER=%APPDATA%\spicetify"
if not exist "%SPICE_USER%" set "SPICE_USER=%APPDATA%\spicetify"
if not exist "%SPICE_USER%\Extensions" mkdir "%SPICE_USER%\Extensions"
copy /y "%EXT_SRC%" "%SPICE_USER%\Extensions\overlay-bridge.js" >nul
if errorlevel 1 (
    set "FAILMSG=Couldn't copy the extension into %SPICE_USER%\Extensions."
    goto :fail
)
"%SPICE%" config extensions overlay-bridge.js >nul 2>&1

rem Only re-apply when Spotify doesn't already have this exact extension,
rem because "spicetify apply" restarts Spotify.
set "APPLIED=%SPOTIFY_DIR%\Apps\xpui\extensions\overlay-bridge.js"
set "NEED_APPLY="
if defined FORCE_APPLY set "NEED_APPLY=1"
if /i "%MODE%"=="reapply" set "NEED_APPLY=1"
if not exist "%APPLIED%" set "NEED_APPLY=1"
if not defined NEED_APPLY (
    fc /b "%EXT_SRC%" "%APPLIED%" >nul 2>&1
    if errorlevel 1 set "NEED_APPLY=1"
)
if not defined NEED_APPLY (
    echo       extension already applied to Spotify
    goto :spice_done
)
echo       applying Spicetify to Spotify ^(Spotify will restart^)...
"%SPICE%" apply
if errorlevel 1 (
    echo       no usable backup yet, creating one and applying...
    "%SPICE%" backup apply
)
if errorlevel 1 (
    echo       backup is out of date, restoring and applying again...
    "%SPICE%" restore backup apply
)
if errorlevel 1 (
    set "FAILMSG=Spicetify couldn't apply to Spotify. Try reinstalling Spotify with SpotX: run "setup-and-run.bat spotx"."
    goto :fail
)
echo       applied
:spice_done

rem ---------------------------------------------------------------------------
echo [5/%STEPS%] Launching
rem ---------------------------------------------------------------------------
tasklist /fi "imagename eq Spotify.exe" 2>nul | find /i "Spotify.exe" >nul
if errorlevel 1 (
    echo       starting Spotify
    start "" "%SPOTIFY_EXE%"
) else (
    echo       Spotify is already running
)
call :start_overlay
echo.
echo  Mercify is running. Look for its icon in the system tray.
echo    Ctrl+`          show / hide the overlay
echo    Ctrl+Shift+`    Edit Mode ^(drag panels, per-panel opacity^)
echo    Ctrl+Shift+Space  search
echo.
echo  If the overlay says "Waiting for Spotify" after a Spotify update,
echo  run:  setup-and-run.bat reapply
echo.
timeout /t 8 >nul
exit /b 0

rem ===========================================================================
:launch_demo
echo.
echo  Demo mode: a fake Spotify with a made-up library.
echo  Close the "Mercify demo" window to stop it.
start "Mercify demo" /min cmd /c "node "%OVERLAY%\tools\mock-bridge.js""
call :start_overlay
timeout /t 5 >nul
exit /b 0

rem ===========================================================================
:start_overlay
start "" "%ELECTRON_EXE%" "%OVERLAY%"
exit /b 0

:download_electron
rem Remove a half-finished download so the installer starts clean.
if exist "%OVERLAY%\node_modules\electron\dist" rmdir /s /q "%OVERLAY%\node_modules\electron\dist"
if exist "%OVERLAY%\node_modules\electron\path.txt" del /q "%OVERLAY%\node_modules\electron\path.txt"
pushd "%OVERLAY%"
node "%OVERLAY%\node_modules\electron\install.js"
popd
title Mercify - setup and launch
exit /b 0

:check_node
set "NODE_OK="
set "NODE_VER="
set "NODE_MAJOR=0"
for /f "delims=" %%V in ('node -v 2^>nul') do set "NODE_VER=%%V"
if not defined NODE_VER exit /b 0
set "NODE_MINOR=0"
for /f "tokens=1,2 delims=." %%M in ("!NODE_VER:v=!") do (
    set "NODE_MAJOR=%%M"
    set "NODE_MINOR=%%N"
)
rem Electron 44 needs Node 22.12 or newer.
if !NODE_MAJOR! GEQ 23 set "NODE_OK=1"
if !NODE_MAJOR! EQU 22 if !NODE_MINOR! GEQ 12 set "NODE_OK=1"
exit /b 0

:find_spicetify
set "SPICE="
if exist "%LOCALAPPDATA%\spicetify\spicetify.exe" (
    set "SPICE=%LOCALAPPDATA%\spicetify\spicetify.exe"
    exit /b 0
)
for /f "delims=" %%S in ('where spicetify 2^>nul') do if not defined SPICE set "SPICE=%%S"
exit /b 0

:wait_for_prefs
for /l %%I in (1,1,60) do (
    if exist "%SPOTIFY_DIR%\prefs" (
        timeout /t 3 >nul
        exit /b 0
    )
    timeout /t 2 >nul
)
echo       Spotify hasn't created its settings yet. Log in to Spotify, then run this file again.
exit /b 0

:fail
echo.
echo  ERROR: !FAILMSG!
echo.
pause
exit /b 1
