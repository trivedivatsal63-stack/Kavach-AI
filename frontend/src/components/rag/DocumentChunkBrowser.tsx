import { useState } from "react";
import { ChatShell } from "../chat/ChatShell";
import {
  ApiError,
  ragListChunks,
  type RagChunkDetail,
  type RagDocument,
} from "../../lib/api";

interface ChunkGroup {
  section: string;
  chunks: RagChunkDetail[];
}

// The "Visual view" — a structured browser over what's actually indexed,
// not a graph/embedding visualization. Documents expand to their chunks,
// grouped by heading path, with a per-document search and a detail pane for
// the selected chunk's full content.
export function DocumentChunkBrowser({
  token,
  documents,
}: {
  token: string;
  documents: RagDocument[];
}) {
  const [expandedDocId, setExpandedDocId] = useState<string | null>(null);
  const [chunksByDoc, setChunksByDoc] = useState<Record<string, RagChunkDetail[]>>({});
  const [loadingDocId, setLoadingDocId] = useState<string | null>(null);
  const [chunkError, setChunkError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedChunk, setSelectedChunk] = useState<RagChunkDetail | null>(null);

  async function toggleDocument(doc: RagDocument) {
    if (expandedDocId === doc.id) {
      setExpandedDocId(null);
      return;
    }
    setExpandedDocId(doc.id);
    setSearch("");
    setChunkError(null);
    if (chunksByDoc[doc.id]) return;
    setLoadingDocId(doc.id);
    try {
      const { chunks } = await ragListChunks(token, doc.id);
      setChunksByDoc((prev) => ({ ...prev, [doc.id]: chunks }));
    } catch (err) {
      setChunkError(
        err instanceof ApiError ? err.message : "Failed to load chunks."
      );
    } finally {
      setLoadingDocId(null);
    }
  }

  const indexedDocs = documents.filter((d) => d.status === "indexed");
  const expandedChunks = expandedDocId ? (chunksByDoc[expandedDocId] ?? []) : [];
  const filteredChunks = search.trim()
    ? expandedChunks.filter((c) =>
        c.content.toLowerCase().includes(search.trim().toLowerCase())
      )
    : expandedChunks;

  const groups: ChunkGroup[] = [];
  for (const chunk of filteredChunks) {
    const section =
      chunk.headingPath && chunk.headingPath.length > 0
        ? chunk.headingPath[chunk.headingPath.length - 1]
        : "Untitled section";
    const existing = groups.find((g) => g.section === section);
    if (existing) existing.chunks.push(chunk);
    else groups.push({ section, chunks: [chunk] });
  }

  return (
    <ChatShell
      sidebar={
        <div className="card flex h-full flex-col overflow-hidden">
          <div className="border-b border-gray-100 p-3 dark:border-gray-800">
            <p className="px-2 py-1 text-sm font-semibold">Knowledge base</p>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto p-2">
            {indexedDocs.length === 0 && (
              <li className="px-3 py-6 text-center text-xs text-gray-400 dark:text-gray-500">
                No indexed documents yet.
              </li>
            )}
            {indexedDocs.map((doc) => (
              <li key={doc.id}>
                <button
                  onClick={() => void toggleDocument(doc)}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                    expandedDocId === doc.id
                      ? "bg-gray-100 dark:bg-gray-800"
                      : "hover:bg-gray-50 dark:hover:bg-gray-800/60"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">{doc.name}</span>
                  <span className="shrink-0 text-xs text-gray-400 dark:text-gray-500">
                    {doc.chunkCount}
                  </span>
                </button>

                {expandedDocId === doc.id && (
                  <div className="mt-1 pl-2">
                    {loadingDocId === doc.id && (
                      <p className="px-3 py-2 text-xs text-gray-400 dark:text-gray-500">
                        Loading chunks…
                      </p>
                    )}
                    {chunkError && (
                      <p className="px-3 py-2 text-xs text-red-600 dark:text-red-400">
                        {chunkError}
                      </p>
                    )}
                    {loadingDocId !== doc.id && chunksByDoc[doc.id] && (
                      <>
                        <input
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                          placeholder="Search this document…"
                          className="input mb-2 text-xs"
                        />
                        {groups.length === 0 && (
                          <p className="px-3 py-2 text-xs text-gray-400 dark:text-gray-500">
                            No matching chunks.
                          </p>
                        )}
                        {groups.map((g) => (
                          <div key={g.section} className="mb-2">
                            <p className="px-3 py-1 text-[10px] font-semibold tracking-wide text-gray-400 uppercase dark:text-gray-500">
                              {g.section}
                            </p>
                            {g.chunks.map((c) => (
                              <button
                                key={c.id}
                                onClick={() => setSelectedChunk(c)}
                                className={`block w-full truncate rounded-lg px-3 py-1.5 text-left text-xs transition-colors ${
                                  selectedChunk?.id === c.id
                                    ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-400"
                                    : "text-gray-600 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800/60"
                                }`}
                              >
                                {c.content.replace(/\s+/g, " ").slice(0, 60)}
                              </button>
                            ))}
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      }
      main={
        <div className="card h-full flex-1 overflow-y-auto p-6">
          {!selectedChunk ? (
            <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
                Select a chunk
              </p>
              <p className="max-w-xs text-xs text-gray-400 dark:text-gray-500">
                Expand a document on the left and pick a chunk to see its full
                content.
              </p>
            </div>
          ) : (
            <div>
              <p className="text-xs text-gray-400 dark:text-gray-500">
                {selectedChunk.source}
                {selectedChunk.headingPath && selectedChunk.headingPath.length > 0 && (
                  <> · {selectedChunk.headingPath.join(" > ")}</>
                )}
              </p>
              <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                Chunk {selectedChunk.chunkIndex + 1} · {selectedChunk.tokenCount}{" "}
                tokens
                {selectedChunk.page !== null && <> · page {selectedChunk.page}</>}
              </p>
              <p className="mt-4 text-sm whitespace-pre-wrap">
                {selectedChunk.content}
              </p>
            </div>
          )}
        </div>
      }
    />
  );
}
