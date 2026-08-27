@echo off
chcp 65001 >nul
title WITHBID-PPBM 설치
echo WITHBID-PPBM 설치를 시작합니다. 설치 진행 창을 확인해 주세요.
start "" /wait powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0Install-WITHBID-PPBM.ps1"
if errorlevel 1 (
  echo 설치에 실패했습니다. 화면의 오류 메시지를 확인해 주세요.
  pause
  exit /b 1
)
echo 설치가 완료되었습니다. 이 창은 자동으로 닫힙니다.
timeout /t 2 /nobreak >nul
