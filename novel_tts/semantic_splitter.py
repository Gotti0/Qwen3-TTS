# coding=utf-8
"""
Voyage API (voyage-4-large) 임베딩 기반 의미적 장면 분할 모듈.

마커(*** / ---) 없는 소설 텍스트에서 문맥의 의미적 단절을
수학적으로 추론하여 장면(Scene)을 분할한다.

구성 요소:
  - SemanticSplitConfig : 하이퍼파라미터 및 환경변수 관리
  - SemanticMathUtils   : 코사인 유사도, 동적 임계값, Valley 탐색
  - AsyncVoyageClient   : Voyage API 비동기 통신 + Rate Limit 대응
  - SemanticSceneSplitter : 전체 파이프라인 오케스트레이터
"""

import asyncio
import logging
import math
import os
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

logger = logging.getLogger(__name__)


def _load_env_file() -> None:
    """프로젝트 루트의 .env 파일을 탐색하여 환경변수로 로드."""
    # 이 모듈 기준 상위 디렉터리에서 .env 탐색
    search = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    env_path = os.path.join(search, ".env")
    if os.path.exists(env_path):
        with open(env_path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if "=" in line and not line.startswith("#"):
                    key, val = line.split("=", 1)
                    k, v = key.strip(), val.strip()
                    if k not in os.environ:
                        os.environ[k] = v

_load_env_file()


def _resolve_api_key() -> str:
    """VOYAGE_API_KEY 또는 KEY 환경변수에서 API 키를 가져온다."""
    return os.getenv("VOYAGE_API_KEY") or os.getenv("KEY") or ""


@dataclass
class SemanticSplitConfig:
    """의미 기반 장면 분할을 위한 하이퍼파라미터 및 환경변수 관리."""

    # Voyage API
    api_key: str = field(default_factory=_resolve_api_key)
    model_name: str = field(default_factory=lambda: os.getenv("RequstModel", "voyage-4-large"))
    api_url: str = field(default_factory=lambda: os.getenv("URL", "https://api.voyageai.com/v1/embeddings"))

    # 슬라이딩 윈도우 (웹소설 특화)
    window_size: int = 4          # 블록당 문장 수
    overlap_size: int = 1         # 블록 간 겹침 문장 수

    # 동적 임계값 & Valley 탐지
    alpha: float = 0.75           # T_dynamic = μ - α·σ
    depth_threshold: float = 0.05 # Valley 깊이 점수 최소값

    # 네트워크 & 동시성
    max_batch_size: int = 128     # API 1회 Payload 최대 블록 수
    max_retries: int = 3          # 429/500 재시도 횟수
    base_backoff: float = 1.0     # 지수적 백오프 기본 대기(초)
    max_concurrency: int = 5      # 동시 API 호출 수 (Semaphore)
    request_timeout: float = 30.0 # HTTP 요청 타임아웃(초)


# ---------------------------------------------------------------------------
# 2. Math Utilities
# ---------------------------------------------------------------------------
class SemanticMathUtils:
    """코사인 유사도 계산, 동적 임계값 산출, Valley/Peak 탐색 알고리즘."""

    @staticmethod
    def calculate_cosine_similarities(embeddings: List[List[float]]) -> np.ndarray:
        """
        인접 블록 임베딩 간 코사인 유사도를 NumPy 행렬 연산으로 고속 산출.

        Voyage API 벡터는 L2 정규화되어 있으나 수치 안정성을 위해
        명시적 norm 처리를 포함한다.

        Returns:
            shape (M-1,) 배열. similarities[i] = sim(block_i, block_{i+1})
        """
        if len(embeddings) < 2:
            return np.array([])

        vectors = np.array(embeddings, dtype=np.float64)

        # 인접 벡터 내적
        dot_products = np.sum(vectors[:-1] * vectors[1:], axis=1)

        # L2 norm
        norms = np.linalg.norm(vectors, axis=1)
        norm_products = norms[:-1] * norms[1:]

        # 0-division 방지
        similarities = np.divide(
            dot_products,
            norm_products,
            out=np.zeros_like(dot_products),
            where=norm_products != 0,
        )
        return similarities

    @staticmethod
    def find_scene_boundaries(
        similarities: np.ndarray,
        config: SemanticSplitConfig,
    ) -> List[int]:
        """
        동적 임계값 + TextTiling Depth Score 기반 장면 분할점 탐색.

        알고리즘:
          1) 글로벌 동적 임계값: T = μ - α·σ
          2) Local Minima (Valley) 필터링: sim[i] < sim[i-1] AND sim[i] < sim[i+1]
          3) Depth Score: (left_peak - sim[i]) + (right_peak - sim[i]) >= depth_threshold

        Returns:
            분할점 인덱스 리스트. index i → block_i 와 block_{i+1} 사이 단절.
        """
        if len(similarities) < 3:
            return []

        mean_sim = float(np.mean(similarities))
        std_sim = float(np.std(similarities))
        threshold = mean_sim - (config.alpha * std_sim)

        boundaries: List[int] = []
        n = len(similarities)

        for i in range(1, n - 1):
            # Valley 조건
            if not (similarities[i] < similarities[i - 1] and similarities[i] < similarities[i + 1]):
                continue

            # 동적 임계값 조건
            if similarities[i] >= threshold:
                continue

            # 좌측 Peak 탐색
            left_peak = similarities[i]
            for l_idx in range(i - 1, -1, -1):
                if similarities[l_idx] > left_peak:
                    left_peak = similarities[l_idx]
                else:
                    break

            # 우측 Peak 탐색
            right_peak = similarities[i]
            for r_idx in range(i + 1, n):
                if similarities[r_idx] > right_peak:
                    right_peak = similarities[r_idx]
                else:
                    break

            # Depth Score
            depth_score = (left_peak - similarities[i]) + (right_peak - similarities[i])
            if depth_score >= config.depth_threshold:
                boundaries.append(i)

        return boundaries


# ---------------------------------------------------------------------------
# 3. Async Voyage API Client
# ---------------------------------------------------------------------------
class AsyncVoyageClient:
    """
    Voyage API 비동기 HTTP 어댑터.

    - asyncio.Semaphore 동시성 제한
    - 지수적 백오프 + Jitter (429/500 대응)
    - aiohttp 커넥션 풀 재사용
    """

    def __init__(self, config: SemanticSplitConfig):
        self.config = config
        self.semaphore = asyncio.Semaphore(config.max_concurrency)
        self.headers = {
            "Authorization": f"Bearer {config.api_key}",
            "Content-Type": "application/json",
        }

    async def _embed_batch_with_retry(
        self,
        session: Any,   # aiohttp.ClientSession
        texts: List[str],
        attempt: int = 0,
    ) -> List[List[float]]:
        """단일 배치를 API에 전송하고 필요 시 재시도."""
        import aiohttp  # lazy import — aiohttp 미설치 시 폴백으로 우회

        payload = {
            "model": self.config.model_name,
            "input": texts,
            "input_type": "document",
        }

        async with self.semaphore:
            try:
                timeout = aiohttp.ClientTimeout(total=self.config.request_timeout)
                async with session.post(
                    self.config.api_url,
                    headers=self.headers,
                    json=payload,
                    timeout=timeout,
                ) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        return [item["embedding"] for item in data["data"]]

                    elif resp.status == 429:
                        logger.warning("Rate Limit (HTTP 429). batch=%d", len(texts))
                        raise RuntimeError("Rate Limit Exceeded")

                    elif resp.status >= 500:
                        logger.warning("Voyage server error: %d", resp.status)
                        raise RuntimeError(f"Server Error {resp.status}")

                    else:
                        # 400, 401 등 → 재시도 불가
                        error_text = await resp.text()
                        logger.error("Fatal API error %d: %s", resp.status, error_text)
                        raise ValueError(f"Fatal API Error {resp.status}: {error_text}")

            except ValueError:
                raise  # Fatal → 즉시 상향

            except Exception as exc:
                if attempt < self.config.max_retries:
                    wait = (self.config.base_backoff * (2 ** attempt)) + np.random.uniform(0, 0.5)
                    logger.info(
                        "Retrying in %.2fs (attempt %d/%d): %s",
                        wait, attempt + 1, self.config.max_retries, exc,
                    )
                    await asyncio.sleep(wait)
                    return await self._embed_batch_with_retry(session, texts, attempt + 1)
                else:
                    logger.error("Max retries exceeded: %s", exc)
                    raise

    async def get_embeddings_async(self, text_blocks: List[str]) -> List[List[float]]:
        """전체 블록 리스트를 배치 분할하여 병렬 임베딩 추출."""
        import aiohttp

        if not self.config.api_key:
            raise ValueError("VOYAGE_API_KEY 환경 변수가 설정되지 않았습니다.")

        bs = self.config.max_batch_size
        batches = [text_blocks[i : i + bs] for i in range(0, len(text_blocks), bs)]

        async with aiohttp.ClientSession() as session:
            tasks = [self._embed_batch_with_retry(session, batch) for batch in batches]
            batch_results = await asyncio.gather(*tasks)

        all_embeddings: List[List[float]] = []
        for res in batch_results:
            all_embeddings.extend(res)

        return all_embeddings


# ---------------------------------------------------------------------------
# 4. Semantic Scene Splitter (Orchestrator)
# ---------------------------------------------------------------------------
class SemanticSceneSplitter:
    """
    KSS 문장 분리 → 슬라이딩 윈도우 → Voyage 임베딩 → 유사도 → 분할점 결정.

    외부에서는 `split(text) -> List[str]` 또는 `split_async(text)` 를 호출한다.
    """

    def __init__(self, config: Optional[SemanticSplitConfig] = None):
        self.config = config or SemanticSplitConfig()
        self.client = AsyncVoyageClient(self.config)
        self.math = SemanticMathUtils()

    # ---- 문장 분리 --------------------------------------------------------
    def _split_into_sentences(self, text: str) -> List[str]:
        """
        한국어/영어 혼합 소설 텍스트를 문장 단위로 분리.

        kss(Korean Sentence Splitter)가 설치되어 있으면 우선 사용하고,
        없으면 정규식 기반 폴백을 사용한다.
        """
        try:
            import kss
            sentences = kss.split_sentences(text, use_heuristic=True)
        except ImportError:
            logger.info("kss 미설치 — 정규식 기반 문장 분리 사용")
            sentences = re.split(r'(?<=[.!?。！？])\s+', text.strip())

        return [s.strip() for s in sentences if s.strip()]

    # ---- 슬라이딩 윈도우 --------------------------------------------------
    def _create_sliding_windows(
        self, sentences: List[str],
    ) -> Tuple[List[str], List[Tuple[int, int]]]:
        """
        문장 리스트 → 슬라이딩 윈도우 블록.

        Returns:
            (block_texts, block_ranges)
            block_ranges[i] = (start_sentence_idx, end_sentence_idx)  # inclusive
        """
        blocks: List[str] = []
        block_ranges: List[Tuple[int, int]] = []
        n = len(sentences)
        w = self.config.window_size
        o = self.config.overlap_size
        step = max(w - o, 1)

        idx = 0
        while idx < n:
            end_idx = min(idx + w, n)
            block_text = " ".join(sentences[idx:end_idx])
            blocks.append(block_text)
            block_ranges.append((idx, end_idx - 1))

            if end_idx >= n:
                break
            idx += step

        return blocks, block_ranges

    # ---- 분할점 → 장면 텍스트 재구성 ------------------------------------
    def _reconstruct_scenes(
        self,
        sentences: List[str],
        block_ranges: List[Tuple[int, int]],
        boundary_indices: List[int],
    ) -> List[str]:
        """블록 분할점 인덱스를 문장 인덱스로 변환하여 장면 텍스트를 재구성."""
        if not boundary_indices:
            return [" ".join(sentences)]

        # 분할점 블록의 끝 문장 인덱스를 기준으로 장면을 나눔
        cut_sentence_indices: List[int] = []
        for bi in boundary_indices:
            _, end_sent_idx = block_ranges[bi]
            cut_sentence_indices.append(end_sent_idx + 1)  # exclusive

        # 중복 제거 & 정렬
        cut_sentence_indices = sorted(set(cut_sentence_indices))

        scenes: List[str] = []
        prev = 0
        for cut in cut_sentence_indices:
            if cut > prev:
                scene_text = " ".join(sentences[prev:cut])
                if scene_text.strip():
                    scenes.append(scene_text.strip())
                prev = cut

        # 잔여 문장
        if prev < len(sentences):
            remainder = " ".join(sentences[prev:])
            if remainder.strip():
                scenes.append(remainder.strip())

        return scenes if scenes else [" ".join(sentences)]

    # ---- 비동기 메인 파이프라인 -------------------------------------------
    async def split_async(self, text: str) -> List[str]:
        """비동기 의미 기반 장면 분할 파이프라인 실행."""
        sentences = self._split_into_sentences(text)

        if len(sentences) <= self.config.window_size:
            return [text.strip()]

        # 1. 슬라이딩 윈도우 블록 구성
        blocks, block_ranges = self._create_sliding_windows(sentences)

        if len(blocks) < 3:
            return [text.strip()]

        # 2. Voyage API 임베딩 추출
        embeddings = await self.client.get_embeddings_async(blocks)

        # 3. 인접 블록 간 코사인 유사도
        similarities = self.math.calculate_cosine_similarities(embeddings)

        # 4. 동적 임계값 + Depth Score → 분할점
        boundary_indices = self.math.find_scene_boundaries(similarities, self.config)

        # 5. 분할점 → 장면 텍스트 재구성
        scenes = self._reconstruct_scenes(sentences, block_ranges, boundary_indices)

        logger.info(
            "Semantic split: %d sentences → %d blocks → %d boundaries → %d scenes",
            len(sentences), len(blocks), len(boundary_indices), len(scenes),
        )
        return scenes

    # ---- 동기 래퍼 --------------------------------------------------------
    def split(self, text: str) -> List[str]:
        """동기 환경에서 호출 가능한 래퍼."""
        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)

        if loop.is_closed():
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)

        if loop.is_running():
            # 이미 이벤트 루프가 돌고 있는 환경 (FastAPI 등)
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as pool:
                future = pool.submit(asyncio.run, self.split_async(text))
                return future.result()
        else:
            return loop.run_until_complete(self.split_async(text))
