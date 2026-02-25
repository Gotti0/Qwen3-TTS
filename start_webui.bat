@echo off
chcp 65001 >nul
title Qwen3-TTS WebUI

echo ============================================
echo   Qwen3-TTS WebUI - Starting...
echo ============================================
echo.
echo  모델은 WebUI에서 선택할 수 있습니다.
echo.

:: ── 백엔드 서버 (FastAPI) ──
echo [1/2] Starting backend server (port 8100)...
start "Qwen3-TTS Backend" cmd /k "cd /d %~dp0 && .venv\Scripts\activate && pip install -e . -q && pip install fastapi uvicorn python-multipart soundfile -q && python webui_server.py"

:: 백엔드가 먼저 뜰 수 있도록 잠시 대기
timeout /t 3 /nobreak >nul

:: ── 프론트엔드 (Vite dev server) ──
echo [2/2] Starting frontend dev server (port 5173)...
start "Qwen3-TTS Frontend" cmd /k "cd /d %~dp0webui && npm run dev"

:: 프론트엔드가 준비될 때까지 대기 후 브라우저 열기
timeout /t 4 /nobreak >nul
echo.
echo ============================================
echo   Frontend: http://localhost:5173
echo   Backend:  http://localhost:8100
echo ============================================
echo.
echo Opening browser...
start http://localhost:5173

echo.
echo Press any key to close this window (servers will keep running)...
pause >nul
