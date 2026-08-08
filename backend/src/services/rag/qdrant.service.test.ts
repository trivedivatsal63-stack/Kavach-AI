import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import {
  collectionNameForUser,
  ensureUserCollection,
  searchChunks,
  upsertPoints,
} from "./qdrant.service";
import { ragConfig } from "../../config/rag";

// Requires a local Qdrant reachable at QDRANT_URL (run qdrant/qdrant.exe).
// This is an integration test against real Qdrant collections on purpose —
// cross-tenant isolation is a property of the collection boundary itself,
// not something a mock can prove.

const userA = randomUUID();
const userB = randomUUID();
const userC = randomUUID(); // intentionally never gets a collection created

const FAKE_VECTOR = Array.from(
  { length: ragConfig.embeddingDim },
  (_, i) => (i % 7) / 7
);

let pointId: string;

describe("Qdrant per-user collection isolation", () => {
  beforeAll(async () => {
    await ensureUserCollection(userA);
    await ensureUserCollection(userB);
    pointId = randomUUID();
    await upsertPoints(collectionNameForUser(userA), [
      { id: pointId, vector: FAKE_VECTOR, documentId: "doc-a" },
    ]);
  });

  afterAll(async () => {
    for (const userId of [userA, userB]) {
      await fetch(
        `${ragConfig.qdrantUrl}/collections/${collectionNameForUser(userId)}`,
        { method: "DELETE" }
      ).catch(() => {});
    }
  });

  it("never returns another user's points, even querying with the exact same vector", async () => {
    const hits = await searchChunks({
      collectionName: collectionNameForUser(userB),
      vector: FAKE_VECTOR,
      limit: 10,
    });
    expect(hits).toHaveLength(0);
  });

  it("returns the owner's own point for that vector", async () => {
    const hits = await searchChunks({
      collectionName: collectionNameForUser(userA),
      vector: FAKE_VECTOR,
      limit: 10,
    });
    expect(hits.map((h) => h.chunkId)).toContain(pointId);
  });

  it("returns an empty result, not an error, for a user who never uploaded anything", async () => {
    const hits = await searchChunks({
      collectionName: collectionNameForUser(userC),
      vector: FAKE_VECTOR,
      limit: 10,
    });
    expect(hits).toEqual([]);
  });
});
