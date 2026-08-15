@echo off
title meow-notify installer
setlocal

echo.
echo  ============================================
echo    meow-notify - DSH push notification plugin
echo    One-click install for Windows
echo    Requires: Node.js 18+ and DSH installed
echo  ============================================
echo.

rem ---------- switch to script directory ----------
cd /d "%~dp0"

rem ---------- check Node.js ----------
where node >nul 2>nul
if errorlevel 1 (
    echo  [ERROR] Node.js not found.
    echo          Please install Node.js 18+ from https://nodejs.org
    echo          and run this program again.
    goto :end
)

rem ---------- check source files ----------
if not exist "install.mjs" (
    echo  [ERROR] install.mjs missing - source package is incomplete.
    goto :end
)
if not exist "index.js" (
    echo  [ERROR] index.js missing - source package is incomplete.
    goto :end
)
if not exist "client.js" (
    echo  [ERROR] client.js missing - source package is incomplete.
    goto :end
)

rem ---------- direct arguments: install.bat install / uninstall ----------
if /i "%~1"=="install"   goto :install
if /i "%~1"=="uninstall" goto :uninstall
if "%~1" neq "" (
    echo  [ERROR] Unknown argument: %~1
    goto :end
)

rem ---------- menu ----------
:menu
echo.
echo  Choose an action:
echo    [1] Install
echo    [2] Uninstall
echo    [3] Exit
echo.
set /p choice=  Enter a number:
if "%choice%"=="1" goto :install
if "%choice%"=="2" goto :uninstall
if "%choice%"=="3" goto :end
echo  Invalid input, please try again.
goto :menu

rem ---------- install ----------
:install
echo.
echo  ===== Installing =====
node "%~dp0install.mjs" install %2 %3 %4 %5 %6 %7 %8 %9
if errorlevel 1 (
    echo.
    echo  [FAILED] See the error message above.
    echo           If DSH was not found: make sure you have run "dsh web"
    echo           at least once, or set the DSH_HOME environment variable.
    echo           If a file write was denied: right-click this program
    echo           and choose "Run as administrator".
) else (
    echo.
    echo  ===== INSTALL COMPLETE =====
    echo    1. Restart DSH: run  dsh web  in a terminal
    echo    2. Your phone should receive a "plugin loaded v9" push
    echo    3. Open browser - Settings - Plugins - Plugin config
    echo       you should see the "MeoW push" card; edit and save
)
goto :end

rem ---------- uninstall ----------
:uninstall
echo.
echo  ===== Uninstalling =====
node "%~dp0install.mjs" uninstall %2 %3 %4 %5 %6 %7 %8 %9
if errorlevel 1 (
    echo.
    echo  [FAILED] See the error message above.
)
goto :end

:end
echo.
pause
endlocal