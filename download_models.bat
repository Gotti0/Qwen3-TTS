@echo off
chcp 65001 >nul
title Qwen3-TTS Model Downloader

echo ============================================
echo   Qwen3-TTS — 모델 전체 다운로드
echo ============================================
echo.

cd /d %~dp0
call .venv\Scripts\activate

pip install -e . -q
pip install huggingface_hub -q

echo.
echo [1/5] Downloading Qwen3-TTS-Tokenizer-12Hz ...
python -c "from huggingface_hub import snapshot_download; snapshot_download('Qwen/Qwen3-TTS-Tokenizer-12Hz')"
echo      Done.

echo [2/5] Downloading Qwen3-TTS-12Hz-1.7B-CustomVoice ...
python -c "from huggingface_hub import snapshot_download; snapshot_download('Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice')"
echo      Done.

echo [3/5] Downloading Qwen3-TTS-12Hz-0.6B-CustomVoice ...
python -c "from huggingface_hub import snapshot_download; snapshot_download('Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice')"
echo      Done.

echo [4/5] Downloading Qwen3-TTS-12Hz-1.7B-VoiceDesign ...
python -c "from huggingface_hub import snapshot_download; snapshot_download('Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign')"
echo      Done.

echo [5/5] Downloading Qwen3-TTS-12Hz-1.7B-Base ...
python -c "from huggingface_hub import snapshot_download; snapshot_download('Qwen/Qwen3-TTS-12Hz-1.7B-Base')"
echo      Done.

echo [+]  Downloading Qwen3-TTS-12Hz-0.6B-Base ...
python -c "from huggingface_hub import snapshot_download; snapshot_download('Qwen/Qwen3-TTS-12Hz-0.6B-Base')"
echo      Done.

echo.
echo ============================================
echo   모든 모델 다운로드 완료!
echo ============================================
echo.
pause
