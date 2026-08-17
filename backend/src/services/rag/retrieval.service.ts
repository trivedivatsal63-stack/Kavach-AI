import { pool } from "../../models/rag/pool";
import {
  DOCUMENT_STATUS,
  MAX_CHUNK_CHARS,
  MIN_RETRIEVAL_SCORE,
  MODEL_MAX_CONTEXT_TOKENS,
  OUTPUT_TOKEN_RESERVE,
} from "../../utils/rag.constants";
import { embedQueries } from "./embedding.service";
import {
  collectionNameForUser,
  deleteDocumentPoints,
  searchChunks,
} from "./qdrant.service";
import { getChunksByIds, softDeleteDocument } from "./documents.service";
import { countTokens } from "./tokenizer.service";
import { formatCitation } from "./citationFormat";
import { rerankChunks } from "./reranker.service";
import type { Citation, RagDocumentRow } from "../../models/rag/types";

// Hybrid retrieval: dense vector search (Qdrant, per-user collection) fused
// with Postgres full-text keyword search via Reciprocal Rank Fusion. Dense
// embeddings alone under-rank exact defined terms and section numbers in
// statutory text — verified: the correct "Tribunal" definition (Section 408)
// never made vector's shallow top-k, while a similar-sounding wrong section
// (410, "Appellate Tribunal") did. Keyword search is what actually surfaces
// a literal-term match like that.
//
// Both legs are scoped to the caller's own documents. The vector leg's
// isolation is structural (collectionNameForUser — a separate Qdrant
// collection per user). rag_chunks has no user_id column, so the keyword leg
// mirrors that guarantee via a join to rag_documents.user_id instead —
// same isolation outcome, different mechanism per storage engine.
//
// How many fused chunks make the final cut is NOT a fixed count — it's a
// real token-budget walk (see retrieve() below). A fixed count either wastes
// budget on small chunks or overflows the model's context on large ones;
// confirmed the latter directly (limit=12 overflowed vLLM's 2048-token
// window on every test query, 100% failure, not occasional).

const RRF_K = 60; // standard RRF constant (Cormack et al.) — sidesteps normalizing cosine similarity against ts_rank_cd, which live on incomparable scales
const CANDIDATE_POOL_SIZE = 24; // fixed and generous — deep enough that a chunk ranked outside vector's shallow top-k but strong in keyword still gets a chance to be fused in
const MAX_RRF_SCORE = 2 / (RRF_K + 1); // best case: rank 1 in both legs — used to normalize the fused score back into a [0,1] "match" display, same contract citation.score had pre-hybrid

interface KeywordHit {
  chunkId: string;
}

// Full-text leg of hybrid retrieval. Deliberately NOT websearch_to_tsquery
// (or plainto_tsquery): both AND every non-stopword term together, which is
// right for a short precise search box query but wrong for a full
// natural-language question against ~800-char chunks — a real question here
// stems to 12-16 terms, and no single chunk contains all of them, so the
// AND-mode query matches literally nothing (confirmed: zero rows on every
// test query before this fix). Instead, take plainto_tsquery's stemmed/
// stopword-filtered term list and OR them together — a chunk matches if it
// contains ANY meaningful query term, and ts_rank_cd (cover density; better
// than plain ts_rank for passage-length text where term clustering matters)
// ranks chunks with more/denser matching terms higher, which is what
// actually surfaces an exact defined-term match buried in a long question.
// english config (stemming) is a first pass — a "simple" config may suit
// citation-heavy legal text better; flagged as a future tuning knob.
async function keywordSearchChunks(params: {
  userId: string;
  query: string;
  limit: number;
  documentIds?: string[];
}): Promise<KeywordHit[]> {
  const values: unknown[] = [params.userId, params.query];
  let documentFilter = "";
  if (params.documentIds && params.documentIds.length > 0) {
    values.push(params.documentIds);
    documentFilter = `AND c.document_id = ANY($${values.length}::text[])`;
  }
  values.push(params.limit);

  const result = await pool.query(
    `SELECT c.id
     FROM rag_chunks c
     JOIN rag_documents d ON d.id = c.document_id,
       to_tsquery('english', replace(plainto_tsquery('english', $2)::text, ' & ', ' | ')) query
     WHERE d.user_id = $1 AND d.deleted_at IS NULL
       AND c.content_tsv @@ query
       ${documentFilter}
     ORDER BY ts_rank_cd(c.content_tsv, query) DESC
     LIMIT $${values.length}`,
    values
  );

  return result.rows.map((row) => ({ chunkId: row.id as string }));
}

interface FusedHit {
  chunkId: string;
  rrfScore: number;
  vectorScore?: number;
  keywordRank?: number;
}

function fuseRankings(
  vectorHits: { chunkId: string; score: number }[],
  keywordHits: KeywordHit[]
): FusedHit[] {
  const fused = new Map<string, FusedHit>();

  vectorHits.forEach((hit, i) => {
    const rank = i + 1; // Qdrant returns hits best-first
    const entry = fused.get(hit.chunkId) ?? { chunkId: hit.chunkId, rrfScore: 0 };
    entry.rrfScore += 1 / (RRF_K + rank);
    entry.vectorScore = hit.score;
    fused.set(hit.chunkId, entry);
  });

  keywordHits.forEach((hit, i) => {
    const rank = i + 1; // query orders by ts_rank_cd DESC, so also best-first
    const entry = fused.get(hit.chunkId) ?? { chunkId: hit.chunkId, rrfScore: 0 };
    entry.rrfScore += 1 / (RRF_K + rank);
    entry.keywordRank = rank;
    fused.set(hit.chunkId, entry);
  });

  return Array.from(fused.values()).sort((a, b) => b.rrfScore - a.rrfScore);
}

export async function retrieve(params: {
  userId: string;
  query: string;
  documentIds?: string[];
  /**
   * Tokens the caller's prompt scaffolding already commits — system prompt +
   * wrapper template + the question itself (see chat.service.ts). Owned by
   * the caller, not measured here, so retrieval stays agnostic to prompt
   * wording; only the caller knows what it's actually going to send.
   */
  reservedTokens: number;
}): Promise<Citation[]> {
  const [queryVector] = await embedQueries([params.query]);

  const [vectorHits, keywordHits] = await Promise.all([
    searchChunks({
      collectionName: collectionNameForUser(params.userId),
      vector: queryVector,
      limit: CANDIDATE_POOL_SIZE,
      documentIds: params.documentIds,
    }),
    keywordSearchChunks({
      userId: params.userId,
      query: params.query,
      limit: CANDIDATE_POOL_SIZE,
      documentIds: params.documentIds,
    }),
  ]);

  const fused = fuseRankings(vectorHits, keywordHits);

  // A chunk is dropped only if it came exclusively from the vector leg AND
  // its raw cosine score is weak. A keyword match is its own strong
  // relevance signal (a literal term/phrase match) and is never filtered by
  // this cosine-scale threshold — this is exactly the case hybrid search
  // exists to rescue, so the old blind spot must not reappear here.
  const strongHits = fused.filter((hit) => {
    if (hit.keywordRank !== undefined) return true;
    return (hit.vectorScore ?? 0) >= MIN_RETRIEVAL_SCORE;
  });
  if (strongHits.length === 0) return [];

  // Hydrate every surviving candidate's content up front — one indexed
  // query regardless of how many, and we need real content to measure real
  // token cost per candidate below (and to rerank, which needs actual text).
  const chunksById = await getChunksByIds(strongHits.map((h) => h.chunkId));

  // Cross-encoder reranking: RRF is a coarse first-stage signal that never
  // actually reads chunk text against the query — verified directly that
  // this lets a chunk containing the complete, literal correct answer rank
  // behind chunks that just mention the query terms more densely without
  // answering anything (LLP Act's real "Tribunal" definition, diluted by
  // unrelated definitions packed into the same chunk, never surfaced in the
  // fused top ranks). This re-scores every surviving candidate by reading
  // (query, chunk) together. Best-effort: falls back to the untouched fused
  // order if the reranker service is unreachable.
  const rerankCandidates = strongHits
    .map((hit) => {
      const chunk = chunksById.get(hit.chunkId);
      return chunk ? { chunkId: hit.chunkId, content: chunk.content } : null;
    })
    .filter((c): c is { chunkId: string; content: string } => c !== null);
  const rerankScores = await rerankChunks(params.query, rerankCandidates);
  const orderedHits = rerankScores
    ? [...strongHits].sort(
        (a, b) => (rerankScores.get(b.chunkId) ?? 0) - (rerankScores.get(a.chunkId) ?? 0)
      )
    : strongHits;

  const chunkTokenBudget =
    MODEL_MAX_CONTEXT_TOKENS - params.reservedTokens - OUTPUT_TOKEN_RESERVE;

  // Walk the (reranked, when available) ranking best-first, adding chunks
  // until the next one would exceed the real token budget, then stop —
  // never skip an oversized chunk to grab a smaller one further down (that
  // would break rank order for no good reason). Only calls the tokenizer
  // for chunks actually considered, which in practice is far fewer than the
  // full candidate pool (typically single digits) since the walk stops at
  // the first overflow — no need for batching a pool vLLM's /tokenize
  // endpoint can't batch anyway (confirmed: TokenizeCompletionRequest.prompt
  // is a single string, not an array).
  const citations: Citation[] = [];
  let usedTokens = 0;
  for (const hit of orderedHits) {
    const chunk = chunksById.get(hit.chunkId);
    if (!chunk) continue;

    const candidate: Citation = {
      chunkId: chunk.id,
      documentId: chunk.documentId,
      source: chunk.source,
      page: chunk.page,
      headingPath: chunk.headingPath,
      // MAX_CHUNK_CHARS, not an arbitrary smaller cap — chunks are already
      // bounded to this length at ingestion time, so this should never
      // actually truncate real content. Was 500: verified directly (LLP
      // Act's "minimum number of partners" answer) that a smaller cap can
      // cut a chunk off mid-sentence right before the actual answer, even
      // when retrieval correctly found the exact right chunk — the model
      // then honestly (and wrongly) said the documents didn't contain it,
      // because the excerpt it was actually given didn't.
      excerpt: truncate(chunk.content, MAX_CHUNK_CHARS),
      score: rerankScores?.get(hit.chunkId) ?? Math.min(1, hit.rrfScore / MAX_RRF_SCORE),
    };

    const candidateTokens = await countTokens(formatCitation(citations.length, candidate));

    // Always include at least one chunk, even if it alone is close to (or
    // technically over) budget — a pathological single-huge-chunk document
    // should still get a best-effort answer, not zero context.
    if (citations.length > 0 && usedTokens + candidateTokens > chunkTokenBudget) {
      break;
    }

    citations.push(candidate);
    usedTokens += candidateTokens;
  }

  return citations;
}

export async function deleteDocument(
  userId: string,
  id: string
): Promise<RagDocumentRow | null> {
  const document = await softDeleteDocument(userId, id);
  if (!document) return null;
  // Best-effort cleanup of the vectors; the Postgres row is already soft
  // deleted so a failure here only leaves orphaned vectors.
  await Promise.allSettled([
    deleteDocumentPoints(collectionNameForUser(userId), id),
    pool.query(`DELETE FROM rag_chunks WHERE document_id = $1`, [id]),
  ]);
  return document;
}

// Documents a user actually has — used to reject documentIds in a query that
// reference someone else's (or nonexistent) documents.
export async function listOwnedDocumentIds(userId: string): Promise<string[]> {
  const result = await pool.query(
    `SELECT id FROM rag_documents
     WHERE user_id = $1 AND deleted_at IS NULL AND status = $2`,
    [userId, DOCUMENT_STATUS.INDEXED]
  );
  return result.rows.map((row) => row.id as string);
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 3).trimEnd()}…`;
}
