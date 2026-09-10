@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
cd /d "%~dp0"
title Vietflexmap - So hoa Atlas Viet Nam 1996

cls
echo ===============================================================
echo          VIETFLEXMAP - SO HOA ATLAS VIET NAM 1996
echo ===============================================================
echo.
echo Cong cu nay se:
echo   1. Tai 172 trang tu bandovn.vn tren CHINH MAY WINDOWS NAY
echo   2. Kiem tra anh
echo   3. Tao Atlas_Vietnam_1996.pdf
echo   4. Dua pages/ + PDF vao git va push len Vietflexmap/atlas
echo.
echo Nguon hien thi: Vietflexmap so hoa
echo.

where py >nul 2>&1
if %errorlevel%==0 (
  set "PY=py"
) else (
  where python >nul 2>&1
  if %errorlevel%==0 (
    set "PY=python"
  ) else (
    echo [LOI] Chua tim thay Python.
    echo Cai Python 3 tu https://www.python.org/downloads/ va chon Add Python to PATH.
    pause
    exit /b 1
  )
)

echo [1/4] Cai/kiem tra thu vien Python...
%PY% -m pip install --upgrade requests pillow img2pdf
if errorlevel 1 goto :fail

echo.
echo [2/4] Tai 172 trang va tao PDF...
%PY% scripts\build_atlas_assets.py
if errorlevel 1 goto :fail

echo.
echo [3/4] Kiem tra ket qua...
if not exist "pages\1.jpg" goto :fail
if not exist "pages\172.jpg" goto :fail
if not exist "pages\manifest.json" goto :fail
if not exist "Atlas_Vietnam_1996.pdf" goto :fail

echo     OK pages\1.jpg
echo     OK pages\172.jpg
echo     OK pages\manifest.json
echo     OK Atlas_Vietnam_1996.pdf
echo.

where git >nul 2>&1
if errorlevel 1 (
  echo [CANH BAO] Khong tim thay Git. File da tao xong nhung chua push len GitHub.
  echo Hay cai Git, sau do chay lai file nay hoac upload pages/ va PDF vao repository.
  goto :success_local
)

echo [4/4] Commit va push len GitHub...
git add pages Atlas_Vietnam_1996.pdf

git diff --cached --quiet
if not errorlevel 1 (
  echo Khong co thay doi moi de commit.
  goto :success
)

git commit -m "Add Vietflexmap digitized Atlas 172 pages and PDF"
if errorlevel 1 goto :fail

git pull --rebase origin main
if errorlevel 1 goto :fail

git push origin HEAD:main
if errorlevel 1 goto :fail

goto :success

:success_local
echo.
echo ===============================================================
echo HOAN TAT SO HOA TREN MAY NAY
echo ===============================================================
echo PDF: %CD%\Atlas_Vietnam_1996.pdf
echo Anh: %CD%\pages\1.jpg ... 172.jpg
echo.
pause
exit /b 0

:success
echo.
echo ===============================================================
echo HOAN TAT 172/172 + PDF + PUSH GITHUB
echo ===============================================================
echo Website se tu deploy qua GitHub Pages.
echo https://vietflexmap.github.io/atlas/
echo.
pause
exit /b 0

:fail
echo.
echo ===============================================================
echo [LOI] Qua trinh bi dung.
echo ===============================================================
echo Neu trang bandovn.vn mo duoc tren Chrome nhung Python khong tai duoc,
echo hay gui cho ChatGPT phan loi hien tren man hinh de chuyen sang Selenium.
echo.
pause
exit /b 1
