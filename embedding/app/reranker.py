"""Cross-encoder reranker — same GPU-first / CPU-fallback strategy as
Embedder (embedder.py), same ONNX runtime, just a different fastembed model
class (TextCrossEncoder instead of TextEmbedding). See embedder.py's module
docstring for the full decision-flow rationale; this mirrors it deliberately
rather than sharing code, since the two probe free VRAM independently and at
different times (the reranker loads after the embedder has already claimed
its share, so it needs its own fresh read, not a cached decision).
"""

import logging
import math
from typing import List

log = logging.getLogger("reranker")


class Reranker:
    def __init__(
        self,
        model_name: str,
        provider: str,
        gpu_min_free_mb: int,
    ) -> None:
        self.model_name = model_name
        self.provider_mode = provider
        self.gpu_min_free_mb = gpu_min_free_mb
        self._model = None
        self.provider_used = "unknown"
        self._load()

    # ── public API ────────────────────────────────────────────────────────
    def rerank(self, query: str, documents: List[str]) -> List[float]:
        try:
            return self._run(query, documents)
        except Exception as exc:  # noqa: BLE001 - any CUDA/EP failure
            if self.provider_used == "cuda":
                log.warning(
                    "GPU rerank failed (%s); downgrading to CPU and retrying",
                    exc,
                )
                self.provider_used = "cpu"
                self._model = self._build(["CPUExecutionProvider"])
                return self._run(query, documents)
            raise

    # ── internals ─────────────────────────────────────────────────────────
    def _load(self) -> None:
        providers = self._select_providers()
        log.info(
            "Loading reranker model %s with providers %s",
            self.model_name,
            providers,
        )
        succeeded = providers
        try:
            self._model = self._build(providers)
        except Exception as exc:  # noqa: BLE001
            if "CUDAExecutionProvider" in providers:
                log.warning("GPU reranker load failed (%s); falling back to CPU", exc)
                self._model = self._build(["CPUExecutionProvider"])
                succeeded = ["CPUExecutionProvider"]
            else:
                raise
        self.provider_used = (
            "cuda" if "CUDAExecutionProvider" in succeeded else "cpu"
        )
        log.info("Reranker provider in use: %s", self.provider_used)

    def _select_providers(self) -> List[str]:
        if self.provider_mode == "cpu":
            return ["CPUExecutionProvider"]

        try:
            import onnxruntime as ort

            available = set(ort.get_available_providers())
        except Exception as exc:  # noqa: BLE001
            log.warning("onnxruntime unavailable (%s); using CPU", exc)
            return ["CPUExecutionProvider"]

        has_cuda = "CUDAExecutionProvider" in available
        if self.provider_mode == "cuda":
            if has_cuda:
                return ["CUDAExecutionProvider", "CPUExecutionProvider"]
            raise RuntimeError("EMBEDDING_PROVIDER=cuda but CUDA is unavailable")

        # auto — fresh probe, independent of whatever the embedder decided.
        if has_cuda and self._free_vram_mb() >= self.gpu_min_free_mb:
            log.info(
                "CUDA available and free VRAM (%d MB) >= threshold (%d MB): using GPU",
                self._free_vram_mb(),
                self.gpu_min_free_mb,
            )
            return ["CUDAExecutionProvider", "CPUExecutionProvider"]

        log.info(
            "GPU busy/absent or free VRAM below threshold (%d MB): using CPU",
            self.gpu_min_free_mb,
        )
        return ["CPUExecutionProvider"]

    def _build(self, providers: List[str]):
        from fastembed.rerank.cross_encoder import TextCrossEncoder

        return TextCrossEncoder(model_name=self.model_name, providers=providers)

    def _free_vram_mb(self) -> int:
        try:
            import pynvml

            pynvml.nvmlInit()
            handle = pynvml.nvmlDeviceGetHandleByIndex(0)
            info = pynvml.nvmlDeviceGetMemoryInfo(handle)
            return int(info.free // (1024 * 1024))
        except Exception as exc:  # noqa: BLE001
            log.warning("VRAM probe failed (%s); treating as no GPU", exc)
            return 0

    def _run(self, query: str, documents: List[str]) -> List[float]:
        if self._model is None:
            raise RuntimeError("Reranker model not loaded")
        # Raw cross-encoder logits are unbounded — sigmoid maps them to a
        # [0,1] relevance probability, matching the existing Citation.score
        # contract (used for the UI's "match %" display).
        raw_scores = list(self._model.rerank(query, documents))
        return [1 / (1 + math.exp(-s)) for s in raw_scores]
