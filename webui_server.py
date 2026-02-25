# coding=utf-8
"""
FastAPI backend for Qwen3-TTS React WebUI.
Supports dynamic model loading/unloading via API.

Usage:
    cd Qwen3-TTS
    python webui_server.py
"""

import gc
import io
import os
import traceback
from typing import Any, Dict, List, Optional

import numpy as np
import soundfile as sf
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

app = FastAPI(title="Qwen3-TTS API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Available models registry
# ---------------------------------------------------------------------------
AVAILABLE_MODELS = [
    {
        "id": "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice",
        "name": "CustomVoice 1.7B",
        "kind": "custom_voice",
        "size": "1.7B",
        "description": "내장 9종 스피커 + 감정/톤 제어",
    },
    {
        "id": "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
        "name": "CustomVoice 0.6B",
        "kind": "custom_voice",
        "size": "0.6B",
        "description": "내장 9종 스피커 (가벼운 버전)",
    },
    {
        "id": "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign",
        "name": "VoiceDesign 1.7B",
        "kind": "voice_design",
        "size": "1.7B",
        "description": "자연어로 음성 디자인",
    },
    {
        "id": "Qwen/Qwen3-TTS-12Hz-1.7B-Base",
        "name": "Base 1.7B",
        "kind": "base",
        "size": "1.7B",
        "description": "음성 복제 (Voice Clone)",
    },
    {
        "id": "Qwen/Qwen3-TTS-12Hz-0.6B-Base",
        "name": "Base 0.6B",
        "kind": "base",
        "size": "0.6B",
        "description": "음성 복제 (가벼운 버전)",
    },
]

# ---------------------------------------------------------------------------
# Global model state
# ---------------------------------------------------------------------------
_tts_model = None
_model_kind: Optional[str] = None
_model_id: Optional[str] = None
_supported_languages: List[str] = []
_supported_speakers: List[str] = []
_loading: bool = False


def _do_load_model(checkpoint: str):
    """Load a specific model checkpoint."""
    global _tts_model, _model_kind, _model_id, _supported_languages, _supported_speakers

    import torch
    from qwen_tts import Qwen3TTSModel

    device = os.environ.get("DEVICE", "cuda:0")
    dtype_str = os.environ.get("DTYPE", "bfloat16").lower()
    dtype_map = {
        "bfloat16": torch.bfloat16, "bf16": torch.bfloat16,
        "float16": torch.float16, "fp16": torch.float16,
        "float32": torch.float32, "fp32": torch.float32,
    }
    dtype = dtype_map.get(dtype_str, torch.bfloat16)

    # FlashAttention: 설치되어 있을 때만 사용
    attn_impl = None
    try:
        import flash_attn  # noqa: F401
        if os.environ.get("FLASH_ATTN", "1") == "1":
            attn_impl = "flash_attention_2"
            print("[server] FlashAttention 2 enabled.")
    except ImportError:
        print("[server] flash_attn not installed — using default attention.")

    print(f"[server] Loading model: {checkpoint} on {device} ({dtype_str})")
    _tts_model = Qwen3TTSModel.from_pretrained(
        checkpoint, device_map=device, dtype=dtype, attn_implementation=attn_impl,
    )
    _model_id = checkpoint

    mt = getattr(_tts_model.model, "tts_model_type", None)
    _model_kind = mt if mt in ("custom_voice", "voice_design", "base") else "unknown"

    _supported_languages = []
    _supported_speakers = []
    if callable(getattr(_tts_model.model, "get_supported_languages", None)):
        _supported_languages = list(_tts_model.model.get_supported_languages())
    if callable(getattr(_tts_model.model, "get_supported_speakers", None)):
        _supported_speakers = list(_tts_model.model.get_supported_speakers())

    print(f"[server] Loaded: kind={_model_kind}, langs={_supported_languages}, speakers={_supported_speakers}")


def _do_unload_model():
    """Unload the current model and free GPU memory."""
    global _tts_model, _model_kind, _model_id, _supported_languages, _supported_speakers

    if _tts_model is not None:
        import torch
        del _tts_model
        _tts_model = None
        _model_kind = None
        _model_id = None
        _supported_languages = []
        _supported_speakers = []
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        print("[server] Model unloaded, GPU memory freed.")


@app.on_event("startup")
async def startup():
    checkpoint = os.environ.get("MODEL", "")
    if checkpoint:
        _do_load_model(checkpoint)
    else:
        print("[server] No MODEL env set — start in UI-only mode. Load a model via the WebUI.")


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------
def _wav_response(wav: np.ndarray, sr: int) -> StreamingResponse:
    buf = io.BytesIO()
    sf.write(buf, wav, sr, format="WAV")
    buf.seek(0)
    return StreamingResponse(
        buf, media_type="audio/wav",
        headers={"Content-Disposition": "attachment; filename=output.wav"},
    )


# ---------------------------------------------------------------------------
# Model management routes
# ---------------------------------------------------------------------------
@app.get("/api/info")
async def info():
    return {
        "model_loaded": _tts_model is not None,
        "model_kind": _model_kind,
        "model_id": _model_id,
        "supported_languages": _supported_languages,
        "supported_speakers": _supported_speakers,
        "available_models": AVAILABLE_MODELS,
        "loading": _loading,
    }


class LoadModelRequest(BaseModel):
    model_id: str


@app.post("/api/model/load")
async def load_model(req: LoadModelRequest):
    global _loading
    if _loading:
        return JSONResponse(status_code=409, content={"error": "다른 모델을 로딩 중입니다. 잠시 후 다시 시도하세요."})
    try:
        _loading = True
        # Unload current model first
        _do_unload_model()
        # Load new model
        _do_load_model(req.model_id)
        _loading = False
        return {
            "success": True,
            "model_id": _model_id,
            "model_kind": _model_kind,
            "supported_languages": _supported_languages,
            "supported_speakers": _supported_speakers,
        }
    except Exception as e:
        _loading = False
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"error": f"{type(e).__name__}: {e}"})


@app.post("/api/model/unload")
async def unload_model():
    _do_unload_model()
    return {"success": True, "message": "모델이 언로드되었습니다."}


# ---------------------------------------------------------------------------
# Generation routes
# ---------------------------------------------------------------------------
@app.post("/api/generate/custom-voice")
async def generate_custom_voice(
    text: str = Form(...),
    language: str = Form("Auto"),
    speaker: str = Form("Vivian"),
    instruct: str = Form(""),
):
    if _tts_model is None:
        return JSONResponse(status_code=503, content={"error": "모델이 로드되지 않았습니다. WebUI에서 모델을 선택하세요."})
    try:
        wavs, sr = _tts_model.generate_custom_voice(
            text=text.strip(), language=language, speaker=speaker,
            instruct=instruct.strip() or None,
        )
        return _wav_response(wavs[0], sr)
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"error": f"{type(e).__name__}: {e}"})


@app.post("/api/generate/voice-design")
async def generate_voice_design(
    text: str = Form(...),
    language: str = Form("Auto"),
    instruct: str = Form(...),
):
    if _tts_model is None:
        return JSONResponse(status_code=503, content={"error": "모델이 로드되지 않았습니다. WebUI에서 모델을 선택하세요."})
    try:
        wavs, sr = _tts_model.generate_voice_design(
            text=text.strip(), language=language, instruct=instruct.strip(),
        )
        return _wav_response(wavs[0], sr)
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"error": f"{type(e).__name__}: {e}"})


@app.post("/api/generate/voice-clone")
async def generate_voice_clone(
    text: str = Form(...),
    language: str = Form("Auto"),
    ref_text: str = Form(""),
    x_vector_only: bool = Form(False),
    ref_audio: UploadFile = File(...),
):
    if _tts_model is None:
        return JSONResponse(status_code=503, content={"error": "모델이 로드되지 않았습니다. WebUI에서 모델을 선택하세요."})
    try:
        audio_bytes = await ref_audio.read()
        wav_data, audio_sr = sf.read(io.BytesIO(audio_bytes))
        wav_data = wav_data.astype(np.float32)
        if wav_data.ndim > 1:
            wav_data = np.mean(wav_data, axis=-1)

        wavs, sr = _tts_model.generate_voice_clone(
            text=text.strip(), language=language,
            ref_audio=(wav_data, audio_sr),
            ref_text=ref_text.strip() if ref_text.strip() else None,
            x_vector_only_mode=x_vector_only,
        )
        return _wav_response(wavs[0], sr)
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"error": f"{type(e).__name__}: {e}"})


# ---------------------------------------------------------------------------
# Novel TTS (long text) generation
# ---------------------------------------------------------------------------
@app.post("/api/generate/novel")
async def generate_novel(
    text: str = Form(...),
    language: str = Form("Auto"),
    speaker: str = Form("Vivian"),
    instruct: str = Form(""),
    max_chars: int = Form(200),
    pause_ms: int = Form(500),
    scene_pause_ms: int = Form(1500),
    use_semantic_split: bool = Form(True),
):
    if _tts_model is None:
        return JSONResponse(status_code=503, content={"error": "모델이 로드되지 않았습니다. WebUI에서 모델을 선택하세요."})
    try:
        from novel_tts import NovelTTSEngine
        engine = NovelTTSEngine(_tts_model)
        wav, sr = engine.generate(
            text=text.strip(),
            language=language,
            speaker=speaker,
            instruct=instruct.strip() or "",
            max_chars=max_chars,
            pause_ms=pause_ms,
            scene_pause_ms=scene_pause_ms,
            use_semantic_split=use_semantic_split,
        )
        return _wav_response(wav, sr)
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"error": f"{type(e).__name__}: {e}"})
# ---------------------------------------------------------------------------
# Novel TTS — SSE streaming with progress
# ---------------------------------------------------------------------------
import json
import tempfile
import threading
import uuid

_audio_store: Dict[str, str] = {}  # file_id → filepath


@app.post("/api/generate/novel/stream")
async def generate_novel_stream(
    text: str = Form(...),
    language: str = Form("Auto"),
    speaker: str = Form("Vivian"),
    instruct: str = Form(""),
    max_chars: int = Form(200),
    pause_ms: int = Form(500),
    scene_pause_ms: int = Form(1500),
    use_semantic_split: bool = Form(True),
):
    if _tts_model is None:
        return JSONResponse(status_code=503, content={"error": "모델이 로드되지 않았습니다."})

    import asyncio
    import queue

    progress_queue: queue.Queue = queue.Queue()

    def _run_generation():
        """동기 TTS 생성을 별도 스레드에서 실행, progress를 queue로 전달."""
        try:
            from novel_tts import NovelTTSEngine
            engine = NovelTTSEngine(_tts_model)

            def on_progress(evt):
                progress_queue.put(("progress", {
                    "current": evt.current,
                    "total": evt.total,
                    "chunk_text": evt.chunk_text,
                    "elapsed_s": evt.elapsed_s,
                    "audio_duration_s": evt.audio_duration_s,
                }))

            wav, sr = engine.generate(
                text=text.strip(),
                language=language,
                speaker=speaker,
                instruct=instruct.strip() or "",
                max_chars=max_chars,
                pause_ms=pause_ms,
                scene_pause_ms=scene_pause_ms,
                use_semantic_split=use_semantic_split,
                use_tqdm=True,
                progress_callback=on_progress,
            )

            # 임시 WAV 파일 저장
            file_id = uuid.uuid4().hex[:12]
            tmp_dir = os.path.join(tempfile.gettempdir(), "novel_tts_audio")
            os.makedirs(tmp_dir, exist_ok=True)
            filepath = os.path.join(tmp_dir, f"{file_id}.wav")

            import soundfile as sf
            sf.write(filepath, wav, sr)
            _audio_store[file_id] = filepath

            total_duration = len(wav) / sr
            progress_queue.put(("complete", {
                "audio_url": f"/api/audio/{file_id}.wav",
                "duration_s": round(total_duration, 2),
            }))

        except Exception as e:
            traceback.print_exc()
            progress_queue.put(("error", {"message": f"{type(e).__name__}: {e}"}))

    async def event_generator():
        loop = asyncio.get_event_loop()
        thread = threading.Thread(target=_run_generation, daemon=True)
        thread.start()

        while True:
            # 비동기적으로 queue를 확인
            while True:
                try:
                    event_type, data = progress_queue.get_nowait()
                    yield f"data: {json.dumps({'type': event_type, **data}, ensure_ascii=False)}\n\n"
                    if event_type in ("complete", "error"):
                        return
                except queue.Empty:
                    break
            await asyncio.sleep(0.2)

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.get("/api/audio/{file_id}.wav")
async def serve_audio(file_id: str):
    filepath = _audio_store.get(file_id)
    if not filepath or not os.path.exists(filepath):
        return JSONResponse(status_code=404, content={"error": "Audio not found"})

    from fastapi.responses import FileResponse
    return FileResponse(filepath, media_type="audio/wav", filename=f"novel_{file_id}.wav")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8100)

