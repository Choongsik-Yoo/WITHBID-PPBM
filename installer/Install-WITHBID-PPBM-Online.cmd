@echo off
setlocal
title WITHBID-PPBM Online Setup
set "SETUP_DIR=%TEMP%\WITHBID-PPBM-Setup-%RANDOM%%RANDOM%"
set "RELEASE_URL=https://github.com/Choongsik-Yoo/WITHBID-PPBM/releases/download/v0.3.7"
mkdir "%SETUP_DIR%" 2>nul

echo.
echo [1/3] Downloading WITHBID-PPBM application files (about 40 MB)...
curl.exe -L --fail --retry 3 --progress-bar "%RELEASE_URL%/WITHBID-PPBM-app.zip" -o "%SETUP_DIR%\WITHBID-PPBM-app.zip"
if errorlevel 1 goto DOWNLOAD_ERROR

echo.
echo [2/3] Downloading the installer...
curl.exe -L --fail --retry 3 --progress-bar "%RELEASE_URL%/Install-WITHBID-PPBM.ps1" -o "%SETUP_DIR%\Install-WITHBID-PPBM.ps1"
if errorlevel 1 goto DOWNLOAD_ERROR

echo.
echo [3/3] Installing. Check the installation progress window...
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%SETUP_DIR%\Install-WITHBID-PPBM.ps1"
if errorlevel 1 goto INSTALL_ERROR

rmdir /s /q "%SETUP_DIR%" 2>nul
echo.
echo Installation completed. Run WITHBID-PPBM from the desktop shortcut.
timeout /t 4 /nobreak >nul
exit /b 0

:DOWNLOAD_ERROR
echo.
echo Download failed. Check the Internet connection and GitHub access.
echo Temporary folder: %SETUP_DIR%
pause
exit /b 1

:INSTALL_ERROR
echo.
echo Installation failed. Check the error message shown on the screen.
echo Temporary folder: %SETUP_DIR%
pause
exit /b 1
