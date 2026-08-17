"""FastAPI surface for the embedding service.

Endpoints:
  GET  /health          -> provider in use, model, dim (used by docker healthcheck)
  POST /embed           -> document embeddings (passage-prompted per model)
  POST /embed/query     -> query embeddings (query-prompted per model)
  POST /rerank           -> cross-encoder relevance scores for (query, chunk) pairs

The GPU->CPU decision is made inside Embedder/Reranker at startup and
per-request on runtime CUDA failure; this module just exposes it over HTTP.
"""

import logging
import os

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from .embedder import Embedder
from .reranker import Reranker

logging.basicConfig(level=logging.INFO)

MODEL = os.getenv("EMBEDDING_MODEL", "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2")
DIM = int(os.getenv("EMBEDDING_DIM", "384"))
PROVIDER = os.getenv("EMBEDDING_PROVIDER", "auto")
GPU_MIN_FREE_MB = int(os.getenv("EMBEDDING_GPU_MIN_FREE_MB", "1536"))
# Small, CPU-fast, well-established cross-encoder (fastembed's built-in
# rerank support) — reuses the exact same ONNX runtime/provider selection as
# the embedder, just a different model class.
RERANKER_MODEL = os.getenv("RERANKER_MODEL", "Xenova/ms-marco-MiniLM-L-6-v2")

embedder = Embedder(MODEL, PROVIDER, GPU_MIN_FREE_MB)
# Loaded after the embedder — its own free-VRAM probe (see reranker.py) runs
# fresh at this point, so it correctly sees whatever VRAM the embedder above
# already claimed rather than a stale/shared decision.
reranker = Reranker(RERANKER_MODEL, PROVIDER, GPU_MIN_FREE_MB)

app = FastAPI(title="Kavach RAG embedding service", version="1.0.0")


class EmbedRequest(BaseModel):
    texts: list[str] = Field(min_length=1, max_length=512)


class EmbedResponse(BaseModel):
    embeddings: list[list[float]]
    dim: int


class RerankRequest(BaseModel):
    query: str
    documents: list[str] = Field(min_length=1, max_length=128)


class RerankResponse(BaseModel):
    scores: list[float]


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "provider": embedder.provider_used,
        "model": MODEL,
        "dim": DIM,
        "reranker_provider": reranker.provider_used,
        "reranker_model": RERANKER_MODEL,
    }


@app.post("/rerank", response_model=RerankResponse)
def rerank(req: RerankRequest) -> RerankResponse:
    try:
        return RerankResponse(scores=reranker.rerank(req.query, req.documents))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/embed", response_model=EmbedResponse)
def embed_documents(req: EmbedRequest) -> EmbedResponse:
    try:
        return EmbedResponse(embeddings=embedder.embed(req.texts, is_query=False), dim=DIM)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/embed/query", response_model=EmbedResponse)
def embed_queries(req: EmbedRequest) -> EmbedResponse:
    try:
        return EmbedResponse(embeddings=embedder.embed(req.texts, is_query=True), dim=DIM)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc
