"""Model loader with the GPU-first / CPU-fallback strategy.

Decision flow:
1. If EMBEDDING_PROVIDER=cpu -> always CPU.
2. If EMBEDDING_PROVIDER=cuda -> use CUDA if available, else raise.
3. auto (default):
   a. Ask onnxruntime for available providers; if CUDA is not present,
      use CPU.
   b. Probe the GPU with pynvml; only use CUDA if free VRAM >=
      EMBEDDING_GPU_MIN_FREE_MB. This is what protects the shared 4GB
      laptop GPU here: the chat model holds ~3GB, so embeddings run on CPU
      and the stack stays stable.
4. Runtime: if a CUDA inference raises (e.g. VRAM was reclaimed by another
   process), downgrade to CPU permanently and retry the batch.

The model file is identical for both providers (ONNX), so a GPU->CPU switch
never changes vector dimensions or results in a different embedding space.
"""

import logging
from typing import List

import numpy as np

log = logging.getLogger("embedder")


class Embedder:
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
    def embed(self, texts: List[str], is_query: bool) -> List[List[float]]:
        try:
            return self._run(texts, is_query)
        except Exception as exc:  # noqa: BLE001 - any CUDA/EP failure
            if self.provider_used == "cuda":
                log.warning(
                    "GPU inference failed (%s); downgrading to CPU and retrying",
                    exc,
                )
                self.provider_used = "cpu"
                self._model = self._build(["CPUExecutionProvider"])
                return self._run(texts, is_query)
            raise

    # ── internals ─────────────────────────────────────────────────────────
    def _load(self) -> None:
        providers = self._select_providers()
        log.info(
            "Loading embedding model %s with providers %s",
            self.model_name,
            providers,
        )
        succeeded = providers
        try:
            self._model = self._build(providers)
        except Exception as exc:  # noqa: BLE001
            if "CUDAExecutionProvider" in providers:
                log.warning("GPU model load failed (%s); falling back to CPU", exc)
                self._model = self._build(["CPUExecutionProvider"])
                succeeded = ["CPUExecutionProvider"]
            else:
                raise
        self.provider_used = (
            "cuda" if "CUDAExecutionProvider" in succeeded else "cpu"
        )
        log.info("Embedding provider in use: %s", self.provider_used)

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

        # auto
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
        from fastembed import TextEmbedding

        return TextEmbedding(self.model_name, providers=providers)

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

    def _run(self, texts: List[str], is_query: bool) -> List[List[float]]:
        if self._model is None:
            raise RuntimeError("Embedding model not loaded")
        # query_embed applies the model's query prompt (e.g. "s2p_query" for
        # paraphrase-multilingual-MiniLM-L12-v2); embed() handles passages.
        if is_query and hasattr(self._model, "query_embed"):
            iterator = self._model.query_embed(texts, batch_size=32)
        else:
            iterator = self._model.embed(texts, batch_size=32)
        return [np.asarray(vector, dtype="float32").tolist() for vector in iterator]
