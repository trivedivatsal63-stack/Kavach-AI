import { ragConfig } from "../../config/rag";
import type { QdrantClient } from "@qdrant/js-client-rest" with {
  "resolution-mode": "import",
};

// One Qdrant collection per user — isolation is structural, not filter-based.
// A query against user B's collection cannot return user A's points, full
// stop, regardless of app-code correctness. Every point still carries
// document_id as payload (keyword indexed) for per-document delete within a
// user's own collection.
//
// The client is loaded lazily via dynamic import: @qdrant/js-client-rest is
// ESM-only (its package.json exports map points `require` at a .js file
// under a `"type": "module"` package, which Node/TS treat as ESM), so a
// top-level `import` would be a `require()` of an ESM module.

let clientPromise: Promise<QdrantClient> | null = null;

function getClient(): Promise<QdrantClient> {
  if (!clientPromise) {
    clientPromise = import("@qdrant/js-client-rest").then(
      (mod) =>
        new mod.QdrantClient({
          url: ragConfig.qdrantUrl,
          // Local Qdrant may be down at boot; skip version probe noise.
          checkCompatibility: false,
        })
    );
  }
  return clientPromise;
}

// userId is always server-resolved (req.userId from JWT, or ragKey.userId
// looked up from a key hash) — never taken from request body/params — so
// this can never be pointed at an attacker-chosen collection name.
export function collectionNameForUser(userId: string): string {
  return `rag_user_${userId}`;
}

function isNotFoundError(err: unknown): boolean {
  const status =
    (err as { status?: number })?.status ??
    (err as { response?: { status?: number } })?.response?.status;
  return status === 404;
}

// Cheap boot-time reachability check. Boot no longer owns any specific
// collection — collections are created lazily, per user, on first upload.
export async function pingQdrant(): Promise<void> {
  const client = await getClient();
  await client.getCollections();
}

// Lazy, per-user collection creation. Called on first RAG action for a user
// (first upload) — see ingestion.service.ts.
export async function ensureUserCollection(userId: string): Promise<string> {
  const name = collectionNameForUser(userId);
  const client = await getClient();
  const existing = await client.getCollections();
  const found = existing.collections.find((c) => c.name === name);

  if (!found) {
    await client.createCollection(name, {
      vectors: { size: ragConfig.embeddingDim, distance: "Cosine" },
    });
    await client.createPayloadIndex(name, {
      field_name: "document_id",
      field_schema: "keyword",
    });
    return name;
  }

  const info = await client.getCollection(name);
  const vectors = info.config.params.vectors;
  const size =
    vectors && !Array.isArray(vectors) && "size" in vectors
      ? vectors.size
      : undefined;
  if (size !== undefined && size !== ragConfig.embeddingDim) {
    throw new Error(
      `Qdrant collection "${name}" has vector size ${size}, ` +
        `but EMBEDDING_DIM is ${ragConfig.embeddingDim} (embedding model changed?). ` +
        `Drop the collection to reindex all documents.`
    );
  }
  return name;
}

export interface VectorPoint {
  id: string;
  vector: number[];
  documentId: string;
  /** Tags tabular (spreadsheet-row) chunks so retrieval/reranking can treat them distinctly later. */
  documentType?: string;
}

export async function upsertPoints(
  collectionName: string,
  points: VectorPoint[]
): Promise<void> {
  if (points.length === 0) return;
  const client = await getClient();
  await client.upsert(collectionName, {
    points: points.map((p) => ({
      id: p.id,
      vector: p.vector,
      payload: {
        document_id: p.documentId,
        ...(p.documentType ? { document_type: p.documentType } : {}),
      },
    })),
  });
}

export interface SearchHit {
  chunkId: string;
  score: number;
}

export async function searchChunks(params: {
  collectionName: string;
  vector: number[];
  limit: number;
  documentIds?: string[];
}): Promise<SearchHit[]> {
  const client = await getClient();
  const must: Record<string, unknown>[] = [];
  if (params.documentIds && params.documentIds.length > 0) {
    must.push({ key: "document_id", match: { any: params.documentIds } });
  }

  try {
    const result = await client.query(params.collectionName, {
      query: params.vector,
      limit: params.limit,
      filter: must.length > 0 ? { must } : undefined,
      with_payload: false,
    });

    return result.points.map((point) => ({
      chunkId: String(point.id),
      score: point.score ?? 0,
    }));
  } catch (err) {
    // A user who has never uploaded anything has no collection yet — that's
    // not an error, it's just zero results.
    if (isNotFoundError(err)) return [];
    throw err;
  }
}

export async function deleteDocumentPoints(
  collectionName: string,
  documentId: string
): Promise<void> {
  const client = await getClient();
  try {
    await client.delete(collectionName, {
      filter: {
        must: [{ key: "document_id", match: { value: documentId } }],
      },
    });
  } catch (err) {
    if (isNotFoundError(err)) return;
    throw err;
  }
}
