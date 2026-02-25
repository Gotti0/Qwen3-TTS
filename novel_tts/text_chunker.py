# coding=utf-8
"""
소설 텍스트 청킹 모듈.

계층적 텍스트 분할(장면 → 문단 → 문장 → 절) 후
목표 크기로 재병합하여 TTS 엔진에 전달할 청크를 생성한다.

장면(Scene) 분할은 2단계:
  1차: 명시적 마커(*** / --- / ===) 기반
  2차: Voyage 임베딩 기반 의미적 분할 (마커 없는 텍스트 대응)
"""

import logging
import re
from dataclasses import dataclass
from typing import Callable, List, Optional

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------
@dataclass
class ChunkResult:
    """청킹 결과 단위."""

    text: str              # 청크 텍스트
    index: int             # 전체에서의 순번 (0-based)
    is_scene_break: bool   # 이 청크 앞에 장면 전환이 있는지
    char_offset: int       # 원본 텍스트에서의 대략적 문자 위치


# ---------------------------------------------------------------------------
# Novel Text Chunker
# ---------------------------------------------------------------------------
class NovelTextChunker:
    """
    소설 텍스트를 TTS 모델에 적합한 크기의 청크로 분할.

    분할 계층:
      Level 0 — 장면 (Scene):  마커 or 의미 기반
      Level 1 — 문단 (Paragraph): 빈 줄
      Level 2 — 문장 (Sentence):  종결 부호, 대화문+지문 보존
      Level 3 — 절 (Clause):    긴 문장 재분리

    사용법::

        chunker = NovelTextChunker()
        chunks = chunker.chunk(novel_text, max_chars=200)
        for c in chunks:
            print(c.index, c.is_scene_break, c.text[:40])
    """

    # 장면 전환 마커 패턴
    SCENE_MARKER_RE = re.compile(
        r'\n\s*(?:\*{3,}|-{3,}|={3,}|#{1,3}\s)\s*\n'
    )

    # 대화문 + 지문 패턴 (한국어/일본어/영어)
    # "대사" 지문.  /  「대사」 지문.  /  『대사』 지문.
    DIALOGUE_RE = re.compile(
        r'([「『""\u201c](.*?)[」』""\u201d][\s]*[^\n「『""\u201c]*?[.!?。！？\n])',
        re.DOTALL,
    )

    # 문장 종결 부호 뒤 공백에서 분리 (대화문 시작이 아닌 경우)
    SENTENCE_SPLIT_RE = re.compile(
        r'(?<=[.!?。！？])\s+(?=[^""\u201c「『])'
    )

    # 절(clause) 분리: 쉼표, 세미콜론
    CLAUSE_SPLIT_RE = re.compile(
        r'(?<=[,;，；])\s+'
    )

    # 한국어 접속사 뒤에서 분리 (look-behind 불가 → split 별도 처리)
    _KOREAN_CONJUNCTIONS = re.compile(
        r'\s+(그리고|하지만|그러나|그래서|또한|그런데|그렇지만)\s+'
    )

    def __init__(
        self,
        use_semantic_split: bool = True,
        semantic_min_length: int = 300,
    ):
        """
        Args:
            use_semantic_split: 의미 기반 장면 분할 활성화 여부.
            semantic_min_length: 텍스트가 이 글자 수 이상이어야 의미 분할 시도.
        """
        self.use_semantic_split = use_semantic_split
        self.semantic_min_length = semantic_min_length

        self._semantic_splitter = None  # lazy init

    @property
    def semantic_splitter(self):
        """SemanticSceneSplitter 지연 초기화."""
        if self._semantic_splitter is None:
            try:
                from .semantic_splitter import SemanticSceneSplitter
                self._semantic_splitter = SemanticSceneSplitter()
            except Exception as exc:
                logger.warning("SemanticSceneSplitter 초기화 실패: %s", exc)
                self._semantic_splitter = False  # 초기화 실패 표시
        return self._semantic_splitter

    # ---- Level 0: 장면 분할 -----------------------------------------------
    def split_scenes_by_marker(self, text: str) -> List[str]:
        """명시적 마커(*** / --- / ===) 기반 장면 분리."""
        scenes = self.SCENE_MARKER_RE.split(text)
        return [s.strip() for s in scenes if s.strip()]

    def split_scenes_semantic(self, text: str) -> List[str]:
        """Voyage 임베딩 기반 의미적 장면 분리."""
        splitter = self.semantic_splitter
        if splitter is False or splitter is None:
            raise RuntimeError("SemanticSceneSplitter 사용 불가")
        return splitter.split(text)

    def split_scenes(self, text: str) -> List[str]:
        """
        2단계 장면 분할:
          1차 — 마커 기반 시도
          2차 — 마커 결과가 1덩이리이고 텍스트가 충분히 길면 의미 기반
        """
        # 1차: 마커 기반
        scenes = self.split_scenes_by_marker(text)

        # 마커로 분할이 안 됐고, 의미 분할이 활성화되어 있으며, 텍스트가 충분히 길면
        if (
            len(scenes) <= 1
            and self.use_semantic_split
            and len(text) >= self.semantic_min_length
        ):
            try:
                semantic_scenes = self.split_scenes_semantic(text)
                if len(semantic_scenes) > 1:
                    logger.info(
                        "의미 기반 장면 분할: %d개 장면 탐지", len(semantic_scenes)
                    )
                    return semantic_scenes
            except Exception as exc:
                logger.warning("의미 기반 분할 실패 → 마커 결과 유지: %s", exc)

        return scenes if scenes else [text.strip()]

    # ---- Level 1: 문단 분할 -----------------------------------------------
    def split_paragraphs(self, scene: str) -> List[str]:
        """빈 줄 기준 문단 분리."""
        paragraphs = re.split(r'\n\s*\n', scene)
        return [p.strip() for p in paragraphs if p.strip()]

    # ---- Level 2: 문장 분할 -----------------------------------------------
    def split_sentences(self, paragraph: str) -> List[str]:
        """
        문장 종결 부호 기준 분리.

        대화문 + 지문 패턴을 하나의 단위로 보존한다.
        예: "가지 마!" 그녀가 소리쳤다.  →  한 덩어리
        """
        # kss 사용 시도
        try:
            import kss
            return kss.split_sentences(paragraph, use_heuristic=True)
        except ImportError:
            pass

        # 정규식 폴백: 대화문+지문 블록을 먼저 마킹
        result: List[str] = []
        remaining = paragraph

        for match in self.DIALOGUE_RE.finditer(paragraph):
            span_start = remaining.find(match.group())
            if span_start < 0:
                continue

            # 대화문 이전 텍스트 → 문장 분리
            before = remaining[:span_start].strip()
            if before:
                for sent in self.SENTENCE_SPLIT_RE.split(before):
                    sent = sent.strip()
                    if sent:
                        result.append(sent)

            # 대화문+지문 블록은 통째로
            result.append(match.group().strip())
            remaining = remaining[span_start + len(match.group()):]

        # 남은 텍스트
        if remaining.strip():
            for sent in self.SENTENCE_SPLIT_RE.split(remaining.strip()):
                sent = sent.strip()
                if sent:
                    result.append(sent)

        return result if result else [paragraph.strip()]

    # ---- Level 3: 절 분할 -------------------------------------------------
    def split_clause(self, sentence: str, max_chars: int = 80) -> List[str]:
        """긴 문장을 절(clause) 단위로 재분리."""
        if len(sentence) <= max_chars:
            return [sentence]

        # 1차: 쉼표/세미콜론에서 분리
        parts = self.CLAUSE_SPLIT_RE.split(sentence)
        parts = [p.strip() for p in parts if p.strip()]

        # 2차: 여전히 긴 부분은 한국어 접속사에서 분리
        result: List[str] = []
        for part in parts:
            if len(part) > max_chars:
                sub_parts = self._KOREAN_CONJUNCTIONS.split(part)
                result.extend(p.strip() for p in sub_parts if p.strip())
            else:
                result.append(part)

        return result if result else [sentence]

    # ---- 청크 병합 ---------------------------------------------------------
    def merge_into_chunks(
        self,
        sentences: List[str],
        max_chars: int = 200,
        min_chars: int = 50,
    ) -> List[str]:
        """
        문장 리스트를 목표 글자 수 범위로 병합.

        - 한 청크가 max_chars를 넘지 않도록 문장을 순차 적재
        - 마지막 청크가 min_chars 미만이면 이전 청크에 합침
        """
        if not sentences:
            return []

        chunks: List[str] = []
        current_parts: List[str] = []
        current_len = 0

        for sent in sentences:
            sent_len = len(sent)

            # 현재 청크에 추가하면 한도 초과 → 확정
            if current_len + sent_len > max_chars and current_len >= min_chars:
                chunks.append(" ".join(current_parts))
                current_parts = []
                current_len = 0

            current_parts.append(sent)
            current_len += sent_len

        # 잔여 처리
        if current_parts:
            tail = " ".join(current_parts)
            if current_len < min_chars and chunks:
                # 너무 짧으면 이전 청크에 합침
                chunks[-1] = chunks[-1] + " " + tail
            else:
                chunks.append(tail)

        return chunks

    # ---- 전체 파이프라인 ---------------------------------------------------
    def chunk(
        self,
        text: str,
        max_chars: int = 200,
        min_chars: int = 50,
        clause_max: int = 80,
    ) -> List[ChunkResult]:
        """
        소설 텍스트 → ChunkResult 리스트.

        계층: 장면 → 문단 → 문장 → (긴 문장 절 분리) → 청크 병합
        """
        if not text or not text.strip():
            return []

        results: List[ChunkResult] = []
        chunk_index = 0
        char_offset = 0

        scenes = self.split_scenes(text)

        for scene_idx, scene in enumerate(scenes):
            is_scene_break = scene_idx > 0
            paragraphs = self.split_paragraphs(scene)

            # 장면 내 전체 문장 수집
            all_sentences: List[str] = []
            for para in paragraphs:
                sentences = self.split_sentences(para)
                for sent in sentences:
                    clauses = self.split_clause(sent, clause_max)
                    all_sentences.extend(clauses)

            # 문장들을 청크로 병합
            chunks = self.merge_into_chunks(all_sentences, max_chars, min_chars)

            for i, chunk_text in enumerate(chunks):
                results.append(
                    ChunkResult(
                        text=chunk_text,
                        index=chunk_index,
                        is_scene_break=(is_scene_break and i == 0),
                        char_offset=char_offset,
                    )
                )
                chunk_index += 1
                char_offset += len(chunk_text)

        return results
