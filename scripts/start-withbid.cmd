@echo off
setlocal
cd /d "%~dp0.."
set "DATA_ROOT=\\WITHUSNAS1\입찰관리"
if not exist node_modules call npm install
start "WITHBID-PPBM" cmd /k "npm start"
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:4317"
