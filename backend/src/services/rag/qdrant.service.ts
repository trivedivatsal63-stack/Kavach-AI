import { ragConfig } from "../../config/rag";
import type { QdrantClient } from "@qdrant/js-client-rest" with {
  "resolution-mode": "import",
};

// Thin wrapper around the Qdrant REST client with per-user isolation baked
// in: every point carries user_id + document_id payload fields (keyword
// indexed), and every query filters on the caller's user_id so users can
// never see each other's documents — including via the public RAG API.
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

export async function ensureCollection(): Promise<void> {
  const client = await getClient();
  const existing = await client.getCollections();
  const found = existing.collections.find(
    (c) => c.name === ragConfig.qdrantCollection
  );

  if (!found) {
    await client.createCollection(ragConfig.qdrantCollection, {
      vectors: { size: ragConfig.embeddingDim, distance: "Cosine" },
    });
    await client.createPayloadIndex(ragConfig.qdrantCollection, {
      field_name: "user_id",
      field_schema: "keyword",
    });
    await client.createPayloadIndex(ragConfig.qdrantCollection, {
      field_name: "document_id",
      field_schema: "keyword",
    });
    return;
  }

  const info = await client.getCollection(ragConfig.qdrantCollection);
  const vectors = info.config.params.vectors;
  const size =
    vectors && !Array.isArray(vectors) && "size" in vectors
      ? vectors.size
      : undefined;
  if (size !== undefined && size !== ragConfig.embeddingDim) {
    throw new Error(
      `Qdrant collection "${ragConfig.qdrantCollection}" has vector size ${size}, ` +
        `but EMBEDDING_DIM is ${ragConfig.embeddingDim} (embedding model changed?). ` +
        `Drop the collection to reindex all documents.`
    );
  }
}

export interface VectorPoint {
  id: string;
  vector: number[];
  userId: string;
  documentId: string;
}

export async function upsertPoints(points: VectorPoint[]): Promise<void> {
  if (points.length === 0) return;
  const client = await getClient();
  await client.upsert(ragConfig.qdrantCollection, {
    points: points.map((p) => ({
      id: p.id,
      vector: p.vector,
      payload: { user_id: p.userId, document_id: p.documentId },
    })),
  });
}

export interface SearchHit {
  chunkId: string;
  score: number;
}

export async function searchChunks(params: {
  userId: string;
  vector: number[];
  limit: number;
  documentIds?: string[];
}): Promise<SearchHit[]> {
  const client = await getClient();
  const must: Record<string, unknown>[] = [
    { key: "user_id", match: { value: params.userId } },
  ];
  if (params.documentIds && params.documentIds.length > 0) {
    must.push({ key: "document_id", match: { any: params.documentIds } });
  }

  const result = await client.query(ragConfig.qdrantCollection, {
    query: params.vector,
    limit: params.limit,
    filter: { must },
    with_payload: false,
  });

  return result.points.map((point) => ({
    chunkId: String(point.id),
    score: point.score ?? 0,
  }));
}

export async function deleteDocumentPoints(documentId: string): Promise<void> {
  const client = await getClient();
  await client.delete(ragConfig.qdrantCollection, {
    filter: {
      must: [{ key: "document_id", match: { value: documentId } }],
    },
  });
}
