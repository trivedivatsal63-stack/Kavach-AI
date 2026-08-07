import { ragConfig } from "../../config/rag";

// HTTP client for the dedicated embedding service (embedding/ in the repo
// root). The service handles its own GPU->CPU fallback; this client just
// talks to it. Keeping this a plain HTTP boundary means the vector backend
// can be swapped (or pointed at any OpenAI-embeddings-style API) without
// touching the ingestion/retrieval code.

interface EmbedResponse {
  embeddings: number[][];
  dim: number;
}

export async function embedDocuments(texts: string[]): Promise<number[][]> {
  return embed(texts, false);
}

export async function embedQueries(queries: string[]): Promise<number[][]> {
  return embed(queries, true);
}

async function embed(texts: string[], isQuery: boolean): Promise<number[][]> {
  if (texts.length === 0) return [];
  const res = await fetch(
    `${ragConfig.embeddingBaseUrl}/${isQuery ? "embed/query" : "embed"}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts }),
    }
  );
  if (!res.ok) {
    throw new Error(
      `Embedding service failed: ${res.status} ${await res.text()}`
    );
  }
  const data = (await res.json()) as EmbedResponse;
  if (data.embeddings.length !== texts.length) {
    throw new Error(
      `Embedding service returned ${data.embeddings.length} vectors for ${texts.length} texts`
    );
  }
  return data.embeddings;
}
