@echo off
rem ============================================================
rem  ASCII ONLY. Do not put Korean text in this file.
rem  cmd.exe reads .bat with the OEM codepage (949 on Korean
rem  Windows). A UTF-8 .bat containing Korean breaks at the
rem  first Korean byte and the window closes instantly.
rem  All Korean output lives in menu.py.
rem ============================================================
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Coupang Detail Page Collector
set LOG=%~dp0start_log.txt
echo ==== %date% %time% ==== > "%LOG%"
echo Folder: %cd% >> "%LOG%"

echo.
echo ============================================================
echo   Coupang Detail Page Collector
echo ============================================================
echo.
echo   Folder: %cd%
echo.

rem ---- locate a REAL python ----------------------------------
rem  Do not trust "python --version" text. The Microsoft Store
rem  installs a fake "python" alias whose message also starts
rem  with the word Python, so text matching accepts a stub that
rem  cannot actually run anything. Instead we make it execute
rem  real code: if that works, it is a real interpreter.
call :FINDPY
if "!PY!"=="" (
  echo   Python not found. Trying automatic install...
  echo   Python not found >> "%LOG%"
  echo.
  winget --version >nul 2>&1
  if errorlevel 1 (
    call :NOPYTHON
    goto :END
  )
  echo   Installing Python. This takes 3-5 minutes. Do not close.
  echo.
  winget install -e --id Python.Python.3.12 --scope user --accept-source-agreements --accept-package-agreements
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
echo   Python found: !PY!
echo   Python found: !PY! >> "%LOG%"
!PY! -c "import sys;print('  Version:',sys.version.split()[0]);print('  Path:   ',sys.executable)"
!PY! -c "import sys;print(sys.version);print(sys.executable)" >> "%LOG%" 2>&1
echo.

rem ---- ensure pip --------------------------------------------
!PY! -m pip --version >nul 2>&1
if errorlevel 1 (
  echo   pip is missing. Setting it up...
  !PY! -m ensurepip --upgrade
  echo.
)

rem ---- ensure playwright -------------------------------------
rem  Output is shown ON SCREEN, not hidden in the log. Hiding the
rem  error was the reason the previous version was undiagnosable.
!PY! -c "import playwright" >nul 2>&1
if errorlevel 1 (
  echo   Installing playwright. 1-3 minutes. Messages below are normal.
  echo   ------------------------------------------------------------
  !PY! -m pip install playwright
  echo   ------------------------------------------------------------
  !PY! -c "import playwright" >nul 2>&1
  if errorlevel 1 (
    echo.
    echo   First attempt did not work. Trying a user-level install...
    echo   ------------------------------------------------------------
    !PY! -m pip install --user playwright
    echo   ------------------------------------------------------------
    !PY! -c "import playwright" >nul 2>&1
    if errorlevel 1 (
      echo.
      echo   [X] Could not install playwright.
      echo.
      echo   Please send Claude a screenshot of THIS WHOLE WINDOW.
      echo   The lines between the dashes say why it failed.
      echo.
      echo   Common causes:
      echo     - company network blocks pypi.org
      echo     - antivirus blocking the download
      echo     - no internet connection
      echo.
      !PY! -m pip install playwright >> "%LOG%" 2>&1
      goto :END
    )
  )
  echo   playwright installed.
  echo.
  echo   Downloading browser. 2-5 minutes. Please wait.
  echo   ------------------------------------------------------------
  !PY! -m playwright install chromium
  echo   ------------------------------------------------------------
)
echo   Ready.
echo.

rem ---- run the Korean menu -----------------------------------
if not exist "menu.py" (
  echo   [X] menu.py not found in this folder.
  echo       Unzip the WHOLE folder, not just one file.
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
echo   If something went wrong, send Claude:
echo     1^) a screenshot of this window
echo     2^) the file start_log.txt in this folder
echo ------------------------------------------------------------
pause >nul
exit /b 0

rem ============================================================
rem  subroutines
rem ============================================================

rem  Find a python that can actually execute code.
rem  "py -3" is tried first because the launcher is not affected
rem  by the Microsoft Store alias.
:FINDPY
set PY=
py -3 -c "import sys" >nul 2>&1 && (set "PY=py -3" & exit /b 0)
python -c "import sys" >nul 2>&1 && (set "PY=python" & exit /b 0)
python3 -c "import sys" >nul 2>&1 && (set "PY=python3" & exit /b 0)
py -c "import sys" >nul 2>&1 && (set "PY=py" & exit /b 0)
exit /b 0

:NOPYTHON
echo   [X] Automatic install is not available on this Windows.
echo.
echo       1^) Open  https://www.python.org/downloads/
echo       2^) Click the big yellow Download button
echo       3^) Run the installer
echo       4^) IMPORTANT: tick "Add python.exe to PATH" at the bottom
echo       5^) Install, then run START.bat again
echo.
exit /b 0
