@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"
title 쿠팡 상세페이지 수집 도구

rem ─────────────────────────────────────────────────────────────
rem  더블클릭으로 실행하는 메뉴. 명령어를 외우거나 타이핑할 필요가 없다.
rem  창이 바로 닫히면 원인을 볼 수 없으므로, 모든 경로에서 pause 를 건다.
rem ─────────────────────────────────────────────────────────────

echo.
echo ============================================================
echo   쿠팡 상세페이지 수집 도구
echo ============================================================
echo.

rem ── 파이썬 찾기 (py 런처 우선, 없으면 python) ──────────────
set PY=
py -3 --version >nul 2>&1 && set PY=py -3
if "!PY!"=="" (
  python --version >nul 2>&1 && set PY=python
)
if "!PY!"=="" (
  echo [!] 파이썬이 설치되어 있지 않습니다.
  echo.
  echo     1. https://www.python.org/downloads/  에서 내려받아 설치하세요.
  echo     2. 설치 화면 맨 아래 "Add python.exe to PATH" 를 꼭 체크하세요.
  echo        ^(이걸 빼먹으면 설치해도 여기서 못 찾습니다^)
  echo     3. 설치가 끝나면 이 파일을 다시 더블클릭하세요.
  echo.
  pause
  exit /b 1
)
for /f "delims=" %%v in ('!PY! --version 2^>^&1') do set PYVER=%%v
echo   파이썬: !PYVER!

rem ── playwright 준비 ────────────────────────────────────────
!PY! -c "import playwright" >nul 2>&1
if errorlevel 1 (
  echo   playwright 가 없어 설치합니다. 1~3분 걸립니다...
  !PY! -m pip install --quiet playwright
  if errorlevel 1 (
    echo   [!] 설치 실패. 인터넷 연결을 확인하세요.
    pause & exit /b 1
  )
  echo   브라우저를 내려받습니다. 2~5분 걸립니다...
  !PY! -m playwright install chromium
)
echo   준비 완료
echo.

:MENU
echo ============================================================
echo   무엇을 할까요?  번호를 누르고 Enter
echo ============================================================
echo.
echo   1. 점검      쿠팡 접속 없이, 저장 기능이 되는지만 확인
echo   2. 로그인    브라우저를 열어 쿠팡에 직접 로그인 ^(한 번만^)
echo   3. 시험      상품 1개로 시험 ^<- 먼저 이것부터 하세요
echo   4. 수집      실제 수집 ^(5개만^)
echo   5. 수집      실제 수집 ^(남은 것 전부^)
echo   6. 진행확인  어디까지 받았는지 보기
echo   7. 주소저장  받아온 상품 주소를 자료에 채우기
echo.
echo   0. 끝내기
echo.
set /p SEL=번호:

if "%SEL%"=="1" goto SELFTEST
if "%SEL%"=="2" goto LOGIN
if "%SEL%"=="3" goto PROBE
if "%SEL%"=="4" goto RUN5
if "%SEL%"=="5" goto RUNALL
if "%SEL%"=="6" goto STATUS
if "%SEL%"=="7" goto URLS
if "%SEL%"=="0" exit /b 0
echo   그런 번호는 없습니다.
echo.
goto MENU

:SELFTEST
echo.
echo --- 점검 시작 ---
!PY! capture_coupang.py selftest
echo.
echo   위에 "PDF 성공" 이 보이면 저장 기능은 정상입니다.
echo   이제 3번(시험)으로 넘어가세요.
echo.
pause
goto MENU

:LOGIN
echo.
echo --- 브라우저를 엽니다 ---
echo   쿠팡 창이 뜨면 로그인하세요.
echo   끝나면 이 검은 창으로 돌아와 Enter 를 누르세요.
echo.
!PY! capture_coupang.py login
echo.
pause
goto MENU

:PROBE
echo.
set /p Q=검색할 제품명을 붙여넣으세요 (그냥 Enter 누르면 기본 제품):
if "%Q%"=="" set Q=허니맘 캡슐세제 캡슐세탁세제 라벤더향 캡슐 세제
echo.
echo --- 시험 시작: %Q% ---
echo   브라우저가 뜨고 알아서 움직입니다. 건드리지 말고 지켜보세요.
echo.
!PY! capture_coupang.py probe --query "%Q%" > probe결과.txt 2>&1
type probe결과.txt
echo.
echo ============================================================
echo   위 내용이 probe결과.txt 파일로도 저장됐습니다.
echo   이 폴더에 있습니다:
echo   %cd%
echo.
echo   그 파일을 통째로 Claude 에게 보내주세요.
echo ============================================================
echo.
pause
goto MENU

:RUN5
echo.
echo --- 수집 시작 (5개) ---
echo   상품 하나당 20~40초씩 쉬면서 진행합니다. 3~5분 걸립니다.
echo   브라우저를 건드리지 마세요.
echo.
!PY! capture_coupang.py run --limit 5
echo.
pause
goto MENU

:RUNALL
echo.
echo   전체 150개를 받습니다. 1시간 20분 정도 걸립니다.
echo   중간에 꺼도 됩니다. 다시 돌리면 이어서 받습니다.
echo.
set /p OK=정말 시작할까요? (y 입력):
if /i not "%OK%"=="y" goto MENU
echo.
!PY! capture_coupang.py run
echo.
pause
goto MENU

:STATUS
echo.
!PY! capture_coupang.py status
echo.
pause
goto MENU

:URLS
echo.
!PY! capture_coupang.py export-urls --dry-run
echo.
set /p OK=위와 같이 채울까요? (y 입력):
if /i not "%OK%"=="y" goto MENU
!PY! capture_coupang.py export-urls
echo.
pause
goto MENU
