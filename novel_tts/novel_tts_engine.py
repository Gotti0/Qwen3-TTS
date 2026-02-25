# coding=utf-8
"""
소설 TTS 파이프라인 엔진.

텍스트 청킹 → Qwen3-TTS 생성 → 오디오 연결을 하나로 통합.

사용법::

    from qwen_tts import Qwen3TTSModel
    from novel_tts import NovelTTSEngine

    tts = Qwen3TTSModel.from_pretrained("Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice", ...)
    engine = NovelTTSEngine(tts)

    wav, sr = engine.generate(
        text=long_novel_text,
        language="Korean",
        speaker="Sohee",
        max_chars=200,
    )
    import soundfile as sf
    sf.write("novel_output.wav", wav, sr)
"""

import logging
import time
from dataclasses import dataclass
from typing import Callable, List, Optional, Tuple

import numpy as np

from .audio_concat import concatenate_chunks, normalize_volume
from .text_chunker import ChunkResult, NovelTextChunker

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Progress DTO
# ---------------------------------------------------------------------------
@dataclass
class ProgressEvent:
    """청크 생성 진행 상황 데이터 전송 객체."""

    current: int          # 현재 완료된 청크 (1-based)
    total: int            # 전체 청크 수
    chunk_text: str       # 현재 청크 텍스트 미리보기 (최대 50자)
    elapsed_s: float      # 이 청크 생성 소요 시간 (초)
    audio_duration_s: float  # 이 청크 생성된 오디오 길이 (초)
    is_complete: bool = False  # 전체 완료 여부


class NovelTTSEngine:
    """
    소설 텍스트를 TTS로 변환하는 파이프라인 엔진.

    1. NovelTextChunker로 텍스트를 청크 분할
    2. 각 청크를 Qwen3TTSModel로 음성 생성
    3. 생성된 오디오를 하나로 연결
    """

    def __init__(
        self,
        tts_model,
        chunker: Optional[NovelTextChunker] = None,
    ):
        """
        Args:
            tts_model: Qwen3TTSModel 인스턴스 (이미 로드된 상태).
            chunker: NovelTextChunker 인스턴스. None이면 기본 설정으로 생성.
        """
        self.tts_model = tts_model
        self.chunker = chunker or NovelTextChunker()

    def generate(
        self,
        text: str,
        language: str = "Auto",
        speaker: str = "Vivian",
        instruct: str = "",
        max_chars: int = 200,
        min_chars: int = 50,
        pause_ms: int = 500,
        scene_pause_ms: int = 1500,
        crossfade_ms: int = 0,
        normalize: bool = True,
        use_semantic_split: bool = True,
        use_tqdm: bool = True,
        progress_callback: Optional[Callable[[ProgressEvent], None]] = None,
        **gen_kwargs,
    ) -> Tuple[np.ndarray, int]:
        """
        소설 텍스트를 음성으로 변환.

        Args:
            text: 변환할 소설 텍스트 (긴 텍스트 가능).
            language: 언어 설정 ("Auto", "Korean", "English", ...).
            speaker: 스피커 이름 (CustomVoice 모델용).
            instruct: 감정/톤 지시문 (CustomVoice 1.7B 전용).
            max_chars: 청크 최대 글자 수.
            min_chars: 청크 최소 글자 수.
            pause_ms: 일반 청크 간 무음 길이 (ms).
            scene_pause_ms: 장면 전환 시 무음 길이 (ms).
            crossfade_ms: 크로스페이드 길이 (ms). 0이면 비활성화.
            normalize: 볼륨 정규화 여부.
            use_semantic_split: 의미 기반 장면 분할 활성화.
            use_tqdm: 터미널 tqdm 진행률 바 표시 여부.
            progress_callback: 진행 상황 콜백. ProgressEvent 전달.
            **gen_kwargs: Qwen3-TTS generate()에 전달할 추가 키워드 인수
                          (max_new_tokens, top_p, temperature 등).

        Returns:
            (wav, sample_rate) 튜플. wav는 float32 1D ndarray.
        """
        total_start = time.time()

        # ---- 1. 텍스트 청킹 ----
        self.chunker.use_semantic_split = use_semantic_split
        chunks: List[ChunkResult] = self.chunker.chunk(
            text, max_chars=max_chars, min_chars=min_chars,
        )

        if not chunks:
            logger.warning("텍스트에서 청크를 생성할 수 없습니다.")
            return np.array([], dtype=np.float32), 24000

        total = len(chunks)
        logger.info("총 %d개 청크로 분할 완료", total)

        # ---- 2. 청크별 TTS 생성 ----
        wav_list: List[np.ndarray] = []
        is_scene_breaks: List[bool] = []
        sample_rate = 24000  # 기본값; 첫 생성 후 갱신

        model_kind = getattr(
            getattr(self.tts_model, "model", None), "tts_model_type", "custom_voice"
        )

        # tqdm 설정 (CLI 터미널용)
        pbar = None
        try:
            from tqdm import tqdm
            pbar = tqdm(total=total, desc="TTS 생성", unit="chunk", disable=not use_tqdm)
        except ImportError:
            pass

        for i, chunk in enumerate(chunks):
            logger.info(
                "[%d/%d] 생성 중 (scene_break=%s, %d자): %s...",
                i + 1, total, chunk.is_scene_break, len(chunk.text),
                chunk.text[:50],
            )

            chunk_start = time.time()
            audio_duration = 0.0

            try:
                if model_kind == "custom_voice":
                    wavs, sr = self.tts_model.generate_custom_voice(
                        text=chunk.text,
                        language=language,
                        speaker=speaker,
                        instruct=instruct or None,
                        **gen_kwargs,
                    )
                elif model_kind == "voice_design":
                    wavs, sr = self.tts_model.generate_voice_design(
                        text=chunk.text,
                        language=language,
                        instruct=instruct,
                        **gen_kwargs,
                    )
                else:
                    wavs, sr = self.tts_model.generate_custom_voice(
                        text=chunk.text,
                        language=language,
                        speaker=speaker,
                        instruct=instruct or None,
                        **gen_kwargs,
                    )

                wav_list.append(wavs[0])
                sample_rate = sr
                is_scene_breaks.append(chunk.is_scene_break)
                audio_duration = len(wavs[0]) / sr

                chunk_elapsed = time.time() - chunk_start
                logger.info(
                    "  → %.1fs 소요, 오디오 %.1fs 생성 (RTF=%.2f)",
                    chunk_elapsed, audio_duration,
                    chunk_elapsed / audio_duration if audio_duration > 0 else 0,
                )

            except Exception as exc:
                logger.error("[%d/%d] 생성 실패: %s", i + 1, total, exc)
                silence_duration = max(1.0, len(chunk.text) * 0.1)
                wav_list.append(np.zeros(int(sample_rate * silence_duration), dtype=np.float32))
                is_scene_breaks.append(chunk.is_scene_break)
                audio_duration = silence_duration
                chunk_elapsed = time.time() - chunk_start

            # tqdm 업데이트
            if pbar is not None:
                pbar.update(1)
                pbar.set_postfix(audio=f"{audio_duration:.1f}s", refresh=True)

            # progress callback
            if progress_callback:
                evt = ProgressEvent(
                    current=i + 1,
                    total=total,
                    chunk_text=chunk.text[:50],
                    elapsed_s=round(chunk_elapsed, 2),
                    audio_duration_s=round(audio_duration, 2),
                )
                progress_callback(evt)

        if pbar is not None:
            pbar.close()

        # ---- 3. 오디오 연결 ----
        combined = concatenate_chunks(
            wavs=wav_list,
            sr=sample_rate,
            pause_ms=pause_ms,
            scene_pause_ms=scene_pause_ms,
            is_scene_breaks=is_scene_breaks,
            crossfade_ms=crossfade_ms,
        )

        # ---- 4. 볼륨 정규화 ----
        if normalize:
            combined = normalize_volume(combined)

        total_elapsed = time.time() - total_start
        total_audio = len(combined) / sample_rate
        logger.info(
            "전체 완료: %d청크, 총 %.1fs 소요, 오디오 %.1fs (%.1f분)",
            total, total_elapsed, total_audio, total_audio / 60,
        )

        return combined, sample_rate
