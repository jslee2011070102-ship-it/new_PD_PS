@echo off
rem ============================================================
rem  ASCII ONLY. Do not put Korean text in this file.
rem  cmd.exe reads .bat with the OEM codepage (949 on Korean
rem  Windows). A UTF-8 .bat containing Korean breaks at the
rem  first Korean byte and the window closes instantly.
rem  All Korean output lives in menu.py, where Python handles
rem  the encoding properly.
rem ============================================================
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Coupang Detail Page Collector
set LOG=%~dp0start_log.txt
echo ==== %date% %time% ==== > "%LOG%"

echo.
echo ============================================================
echo   Coupang Detail Page Collector
echo ============================================================
echo.
echo   Folder: %cd%
echo   Folder: %cd% >> "%LOG%"
echo.

rem ---- locate python -----------------------------------------
call :FINDPY
if "!PY!"=="" (
  echo   Python not found. Trying automatic install...
  echo   Python not found >> "%LOG%"
  echo.
  winget --version >nul 2>&1
  if errorlevel 1 (
    echo   [!] Automatic install not available on this Windows.
    echo.
    echo       1^) Open  https://www.python.org/downloads/
    echo       2^) Run the installer
    echo       3^) IMPORTANT: check "Add python.exe to PATH"
    echo       4^) Then run this file again
    echo.
    goto :END
  )
  echo   Installing Python. This takes 3-5 minutes. Do not close.
  echo.
  winget install -e --id Python.Python.3.12 --accept-source-agreements --accept-package-agreements >> "%LOG%" 2>&1
  echo.
  call :FINDPY
  if "!PY!"=="" (
    echo ============================================================
    echo   Python was installed, but this window cannot see it yet.
    echo   That is normal right after an install.
    echo.
    echo   CLOSE this window and double-click START.bat again.
    echo ============================================================
    goto :END
  )
)
for /f "delims=" %%v in ('!PY! --version 2^>^&1') do set PYVER=%%v
echo   Python: !PYVER!
echo   Python: !PYVER! ^(!PY!^) >> "%LOG%"

rem ---- ensure playwright -------------------------------------
!PY! -c "import playwright" >nul 2>&1
if errorlevel 1 (
  echo   Installing playwright. 1-3 minutes...
  !PY! -m pip install --quiet playwright >> "%LOG%" 2>&1
  if errorlevel 1 (
    echo   [!] pip install failed. Check your internet connection.
    echo       Details are in start_log.txt
    goto :END
  )
  echo   Downloading browser. 2-5 minutes...
  !PY! -m playwright install chromium >> "%LOG%" 2>&1
)
echo   Ready.
echo.

rem ---- run the Korean menu -----------------------------------
if not exist "menu.py" (
  echo   [!] menu.py not found in this folder.
  echo       Make sure you unzipped everything, not just one file.
  goto :END
)
!PY! menu.py
echo.
echo   Menu closed. Exit code: %errorlevel%
echo   menu.py exit %errorlevel% >> "%LOG%"

:END
echo.
echo ------------------------------------------------------------
echo   Press any key to close this window.
echo   If something went wrong, send start_log.txt to Claude.
echo ------------------------------------------------------------
pause >nul
exit /b 0

rem ---- subroutine: find a working python ---------------------
rem  Prefer the py launcher. The Windows Store creates a fake
rem  "python" alias that opens the Store instead of running, so
rem  verify that a real version string comes back.
:FINDPY
set PY=
py -3 --version >nul 2>&1 && (set PY=py -3 & exit /b 0)
for /f "tokens=1" %%a in ('python --version 2^>^&1') do (
  if /i "%%a"=="Python" (set PY=python & exit /b 0)
)
for /f "tokens=1" %%a in ('python3 --version 2^>^&1') do (
  if /i "%%a"=="Python" (set PY=python3 & exit /b 0)
)
exit /b 0
