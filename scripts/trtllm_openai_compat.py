#!/usr/bin/env python3
"""OpenAI-compat front door for TensorRT-LLM on :8000.

trtllm-serve speaks /v1/chat/completions and /health but has no vLLM-style
POST /tokenize. Kavach's RAG budgeter (tokenizer.service.ts) posts
{model, prompt} to :8000/tokenize and expects {count}. This process:

  * binds 0.0.0.0:8000 (LiteLLM + backend keep their existing URLs)
  * serves /tokenize from the engine's Hugging Face tokenizer
  * reverse-proxies everything else — including SSE streams — to trtllm-serve

Started by scripts/runpod-start-trtllm.sh; not a public API.
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from typing import AsyncIterator

import httpx
from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse
from transformers import AutoTokenizer

log = logging.getLogger("trtllm-compat")

HOP_BY_HOP = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
    "host",
    "content-length",
}


def load_tokenizer(path: str):
    log.info("loading tokenizer from %s", path)
    tok = AutoTokenizer.from_pretrained(path, trust_remote_code=True, use_fast=True)
    # Never add a BOS here — vLLM's /tokenize counts the raw prompt the RAG
    # layer already assembled. Extra special tokens would under-budget context.
    if tok.pad_token is None and tok.eos_token is not None:
        tok.pad_token = tok.eos_token
    return tok


def build_app(upstream: str, tokenizer, served_name: str, max_model_len: int) -> FastAPI:
    app = FastAPI(title="Kavach TRT-LLM compat", docs_url=None, redoc_url=None)
    client = httpx.AsyncClient(
        base_url=upstream.rstrip("/"),
        timeout=httpx.Timeout(None),
        follow_redirects=True,
    )

    @app.on_event("shutdown")
    async def _close() -> None:
        await client.aclose()

    @app.get("/health")
    async def health() -> Response:
        try:
            r = await client.get("/health")
            if r.status_code < 400:
                return JSONResponse({"status": "ok", "backend": "tensorrt-llm"})
            return JSONResponse(
                {"status": "unhealthy", "upstream_status": r.status_code},
                status_code=503,
            )
        except httpx.RequestError as exc:
            return JSONResponse({"status": "unhealthy", "error": str(exc)}, status_code=503)

    @app.post("/tokenize")
    async def tokenize(request: Request) -> JSONResponse:
        """vLLM-compatible token count used by backend RAG budgeting.

        Request:  {"model": "<served name>", "prompt": "<text>"}
        Response: {"count": <int>, "max_model_len": <int>}
        """
        try:
            body = await request.json()
        except Exception:
            return JSONResponse({"error": "invalid JSON"}, status_code=400)
        prompt = body.get("prompt")
        if not isinstance(prompt, str):
            return JSONResponse({"error": "'prompt' must be a string"}, status_code=400)
        ids = tokenizer.encode(prompt, add_special_tokens=False)
        return JSONResponse(
            {
                "count": len(ids),
                "max_model_len": max_model_len,
                "model": body.get("model") or served_name,
            }
        )

    async def _proxy(request: Request) -> Response:
        path = request.url.path
        if request.url.query:
            path = f"{path}?{request.url.query}"
        headers = {
            k: v
            for k, v in request.headers.items()
            if k.lower() not in HOP_BY_HOP
        }
        body = await request.body()
        client_wants_stream = request.query_params.get("stream") == "true"
        if not client_wants_stream and body:
            try:
                client_wants_stream = bool(json.loads(body).get("stream"))
            except Exception:
                client_wants_stream = False
        req = client.build_request(
            request.method, path, headers=headers, content=body or None
        )
        try:
            upstream_resp = await client.send(req, stream=True)
        except httpx.RequestError as exc:
            log.error("upstream error %s %s: %s", request.method, path, exc)
            return JSONResponse(
                {"error": {"message": f"tensorrt-llm upstream unreachable: {exc}", "type": "proxy_error"}},
                status_code=502,
            )

        out_headers = {
            k: v
            for k, v in upstream_resp.headers.items()
            if k.lower() not in HOP_BY_HOP
        }
        content_type = upstream_resp.headers.get("content-type", "")
        if "text/event-stream" in content_type or client_wants_stream:
            async def stream() -> AsyncIterator[bytes]:
                try:
                    async for chunk in upstream_resp.aiter_raw():
                        yield chunk
                finally:
                    await upstream_resp.aclose()

            return StreamingResponse(
                stream(),
                status_code=upstream_resp.status_code,
                headers=out_headers,
                media_type=content_type or "text/event-stream",
            )

        content = await upstream_resp.aread()
        await upstream_resp.aclose()
        return Response(
            content=content,
            status_code=upstream_resp.status_code,
            headers=out_headers,
            media_type=content_type or None,
        )

    @app.api_route("/{full_path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])
    async def catch_all(full_path: str, request: Request) -> Response:  # noqa: ARG001
        return await _proxy(request)

    return app


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--host", default="0.0.0.0")
    p.add_argument("--port", type=int, default=8000)
    p.add_argument("--upstream", default="http://127.0.0.1:8001")
    p.add_argument("--tokenizer", required=True, help="HF id or local tokenizer dir")
    p.add_argument("--served-model-name", default="qwen3-30b-a3b")
    p.add_argument("--max-model-len", type=int, default=8192)
    return p.parse_args()


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="[trtllm-compat] %(asctime)s %(levelname)s %(message)s",
        datefmt="%H:%M:%S",
    )
    args = parse_args()
    tokenizer = load_tokenizer(args.tokenizer)
    app = build_app(args.upstream, tokenizer, args.served_model_name, args.max_model_len)
    import uvicorn

    log.info(
        "listening on %s:%s → %s (tokenize=%s)",
        args.host,
        args.port,
        args.upstream,
        args.tokenizer,
    )
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(0)
    except Exception as exc:  # noqa: BLE001
        log.exception("fatal: %s", exc)
        sys.exit(1)
