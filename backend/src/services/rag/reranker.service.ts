import { ragConfig } from "../../config/rag";

// HTTP client for the embedding service's cross-encoder reranker (same
// service as embedding.service.ts, different endpoint — see embedding/app/
// reranker.py). RRF fusion never actually reads chunk text against the
// query, only precomputed vector/keyword ranks — verified directly that
// this lets a chunk containing the literal correct answer rank behind
// chunks that just mention the query terms more densely without answering
// anything (LLP Act's real "Tribunal" definition never surfaced in the
// fused top ranks despite being a complete, correct answer). Reranking
// re-scores every surviving candidate by reading (query, chunk) together.

export interface RerankCandidate {
  chunkId: string;
  content: string;
}

// Best-effort: returns null on any failure so retrieval.service.ts falls
// back to its existing fused ranking untouched, rather than failing the
// whole request over a precision-only enhancement.
export async function rerankChunks(
  query: string,
  candidates: RerankCandidate[]
): Promise<Map<string, number> | null> {
  if (candidates.length === 0) return new Map();

  try {
    const res = await fetch(`${ragConfig.embeddingBaseUrl}/rerank`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        documents: candidates.map((c) => c.content),
      }),
    });
    if (!res.ok) {
      throw new Error(`Reranker service failed: ${res.status} ${await res.text()}`);
    }

    const data = (await res.json()) as { scores: number[] };
    if (data.scores.length !== candidates.length) {
      throw new Error(
        `Reranker returned ${data.scores.length} scores for ${candidates.length} candidates`
      );
    }

    const scores = new Map<string, number>();
    candidates.forEach((c, i) => scores.set(c.chunkId, data.scores[i]));
    return scores;
  } catch (err) {
    console.error("Reranking failed, falling back to fused ranking:", err);
    return null;
  }
}
