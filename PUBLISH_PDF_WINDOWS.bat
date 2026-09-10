@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"
title Vietflexmap - Publish Atlas PDF 172 pages

if "%~1"=="" (
  echo ==============================================================
  echo       VIETFLEXMAP - PUBLISH ATLAS VIET NAM 1996
  echo ==============================================================
  echo.
  echo Keo file PDF 172 trang va THA vao file PUBLISH_PDF_WINDOWS.bat
  echo hoac chay:
  echo.
  echo   PUBLISH_PDF_WINDOWS.bat "C:\duong-dan\Atlas.pdf"
  echo.
  pause
  exit /b 1
)

where py >nul 2>&1
if %errorlevel%==0 (
  set "PY=py"
) else (
  where python >nul 2>&1
  if %errorlevel%==0 (
    set "PY=python"
  ) else (
    echo [LOI] Chua co Python 3 trong PATH.
    pause
    exit /b 1
  )
)

echo [1/3] Cai/kiem tra pypdf...
%PY% -m pip install --upgrade pypdf
if errorlevel 1 goto :fail

echo.
echo [2/3] Kiem tra PDF 172 trang va dua vao repository...
%PY% scripts\publish_local_pdf.py "%~1"
if errorlevel 1 goto :fail

echo.
where git >nul 2>&1
if errorlevel 1 (
  echo [CANH BAO] Da tao Atlas_Vietnam_1996.pdf nhung may chua co Git.
  echo Cai Git roi chay: git add Atlas_Vietnam_1996.pdf ^&^& git commit ^&^& git push
  pause
  exit /b 0
)

echo [3/3] Commit + push GitHub...
%PY% scripts\publish_local_pdf.py "Atlas_Vietnam_1996.pdf" --push
if errorlevel 1 goto :fail

echo.
echo ==============================================================
echo HOAN TAT - FLIPBOOK 172 TRANG SE TU DEPLOY
necho https://vietflexmap.github.io/atlas/
echo ==============================================================
pause
exit /b 0

:fail
echo.
echo [LOI] Qua trinh bi dung. Xem thong bao phia tren.
pause
exit /b 1
