# coding=utf-8
"""
novel_tts — 소설용 TTS 텍스트 청킹 엔진.

Qwen3-TTS 모델의 max_new_tokens 제한을 우회하여
긴 소설 텍스트를 자연스러운 음성으로 변환한다.
"""

from .text_chunker import ChunkResult, NovelTextChunker
from .novel_tts_engine import NovelTTSEngine, ProgressEvent

__all__ = [
    "ChunkResult",
    "NovelTextChunker",
    "NovelTTSEngine",
    "ProgressEvent",
]
