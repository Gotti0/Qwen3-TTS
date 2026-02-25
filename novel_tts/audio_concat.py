# coding=utf-8
"""
오디오 연결 유틸리티.

TTS 청크별로 생성된 WAV 오디오를 자연스럽게 연결한다.
- 청크 간 무음(pause) 삽입
- 장면 전환 시 긴 pause 적용
- 크로스페이드 (선택)
- 볼륨 정규화
"""

from typing import List, Optional

import numpy as np


def concatenate_chunks(
    wavs: List[np.ndarray],
    sr: int,
    pause_ms: int = 500,
    scene_pause_ms: int = 1500,
    is_scene_breaks: Optional[List[bool]] = None,
    crossfade_ms: int = 0,
) -> np.ndarray:
    """
    청크별 WAV를 하나로 연결.

    Args:
        wavs: 각 청크의 음성 파형 (1D float32 ndarray).
        sr: 샘플링 레이트.
        pause_ms: 일반 청크 간 무음 길이 (ms).
        scene_pause_ms: 장면 전환 시 무음 길이 (ms).
        is_scene_breaks: 각 청크 앞에 장면 전환이 있는지 여부.
                         len == len(wavs). 첫 번째는 무시됨.
        crossfade_ms: 크로스페이드 길이 (ms). 0이면 비활성화.

    Returns:
        연결된 전체 음성 파형.
    """
    if not wavs:
        return np.array([], dtype=np.float32)

    if len(wavs) == 1:
        return wavs[0]

    if is_scene_breaks is None:
        is_scene_breaks = [False] * len(wavs)

    result: List[np.ndarray] = []

    for i, wav in enumerate(wavs):
        if i > 0:
            # 이전 청크와 현재 청크 사이에 pause 또는 crossfade 삽입
            is_scene = is_scene_breaks[i] if i < len(is_scene_breaks) else False
            p_ms = scene_pause_ms if is_scene else pause_ms

            if crossfade_ms > 0 and len(result) > 0:
                # 크로스페이드 적용
                prev_wav = result[-1]
                result[-1], wav = apply_crossfade(prev_wav, wav, sr, crossfade_ms)

                # 크로스페이드 후에도 pause가 있으면 삽입
                remaining_pause = max(0, p_ms - crossfade_ms)
                if remaining_pause > 0:
                    pause_samples = int(sr * remaining_pause / 1000)
                    result.append(np.zeros(pause_samples, dtype=np.float32))
            else:
                # 단순 무음 삽입
                pause_samples = int(sr * p_ms / 1000)
                result.append(np.zeros(pause_samples, dtype=np.float32))

        result.append(wav.astype(np.float32))

    return np.concatenate(result)


def apply_crossfade(
    wav1: np.ndarray,
    wav2: np.ndarray,
    sr: int,
    crossfade_ms: int = 100,
) -> tuple:
    """
    두 WAV 파형의 경계에서 크로스페이드를 적용.

    Args:
        wav1: 앞쪽 파형.
        wav2: 뒤쪽 파형.
        sr: 샘플링 레이트.
        crossfade_ms: 크로스페이드 구간 길이 (ms).

    Returns:
        (수정된 wav1, 수정된 wav2) 튜플.
    """
    fade_samples = int(sr * crossfade_ms / 1000)
    fade_samples = min(fade_samples, len(wav1), len(wav2))

    if fade_samples <= 0:
        return wav1, wav2

    wav1 = wav1.astype(np.float32).copy()
    wav2 = wav2.astype(np.float32).copy()

    # 선형 페이드 커브
    fade_out = np.linspace(1.0, 0.0, fade_samples, dtype=np.float32)
    fade_in = np.linspace(0.0, 1.0, fade_samples, dtype=np.float32)

    wav1[-fade_samples:] *= fade_out
    wav2[:fade_samples] *= fade_in

    return wav1, wav2


def normalize_volume(
    wav: np.ndarray,
    target_peak: float = 0.95,
) -> np.ndarray:
    """
    Peak normalization: 최대 절대값이 target_peak가 되도록 스케일링.

    Args:
        wav: 음성 파형.
        target_peak: 목표 피크 (0.0~1.0).

    Returns:
        정규화된 파형.
    """
    if wav.size == 0:
        return wav

    peak = np.max(np.abs(wav))
    if peak < 1e-8:
        return wav

    return (wav / peak * target_peak).astype(np.float32)
