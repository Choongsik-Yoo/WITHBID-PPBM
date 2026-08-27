@echo off
setlocal
chcp 65001 >nul
title WITHBID-PPBM 온라인 설치
set "SETUP_DIR=%TEMP%\WITHBID-PPBM-Setup-%RANDOM%%RANDOM%"
set "RELEASE_URL=https://github.com/Choongsik-Yoo/WITHBID-PPBM/releases/download/v0.3.6"
mkdir "%SETUP_DIR%" 2>nul

echo.
echo [1/3] WITHBID-PPBM 앱 파일을 다운로드하고 있습니다. 약 40MB입니다.
curl.exe -L --fail --retry 3 --progress-bar "%RELEASE_URL%/WITHBID-PPBM-app.zip" -o "%SETUP_DIR%\WITHBID-PPBM-app.zip"
if errorlevel 1 goto DOWNLOAD_ERROR

echo.
echo [2/3] 설치 프로그램을 다운로드하고 있습니다.
curl.exe -L --fail --retry 3 --progress-bar "%RELEASE_URL%/Install-WITHBID-PPBM.ps1" -o "%SETUP_DIR%\Install-WITHBID-PPBM.ps1"
if errorlevel 1 goto DOWNLOAD_ERROR

echo.
echo [3/3] 설치를 진행합니다. 화면 중앙의 설치 진행 창을 확인해 주세요.
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%SETUP_DIR%\Install-WITHBID-PPBM.ps1"
if errorlevel 1 goto INSTALL_ERROR

rmdir /s /q "%SETUP_DIR%" 2>nul
echo.
echo 설치가 완료되었습니다. 바탕화면의 WITHBID-PPBM 아이콘을 실행하세요.
timeout /t 4 /nobreak >nul
exit /b 0

:DOWNLOAD_ERROR
echo.
echo 다운로드에 실패했습니다. 인터넷 연결 또는 GitHub 접속 상태를 확인하세요.
echo 임시 폴더: %SETUP_DIR%
pause
exit /b 1

:INSTALL_ERROR
echo.
echo 설치에 실패했습니다. 화면에 표시된 오류 내용을 확인하세요.
echo 임시 폴더: %SETUP_DIR%
pause
exit /b 1
