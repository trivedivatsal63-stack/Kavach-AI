import { useCallback, useEffect, useRef, useState } from "react";
import { Layout } from "../components/Layout";
import { Badge } from "../components/Badge";
import { Spinner } from "../components/Spinner";
import { useAuth } from "../context/AuthContext";
import {
  ApiError,
  ragChat,
  ragCreateKey,
  ragDeleteDocument,
  ragFileError,
  ragListDocuments,
  ragListKeys,
  ragRevokeKey,
  ragUploadWithProgress,
  RAG_MAX_UPLOAD_BYTES,
  type RagCitation,
  type RagDocument,
  type RagKeySummary,
} from "../lib/api";

const MAX_CONCURRENT_UPLOADS = 3;

type UploadStatus = "pending" | "uploading" | "done" | "error";

interface UploadItem {
  id: string;
  file: File;
  status: UploadStatus;
  progress: number;
  error?: string;
  documentId?: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: RagCitation[];
  error?: boolean;
}

const ACCEPT = ".pdf,.docx,.txt,.md,.markdown";

export function RagPage() {
  const { token } = useAuth();

  const [documents, setDocuments] = useState<RagDocument[]>([]);
  const [docError, setDocError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const uploadsRef = useRef<UploadItem[]>([]);
  const runningRef = useRef(0);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [keys, setKeys] = useState<RagKeySummary[]>([]);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [creatingKey, setCreatingKey] = useState(false);
  const [keyName, setKeyName] = useState("");

  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatting, setChatting] = useState(false);
  const [scopeDocId, setScopeDocId] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    if (!token) return;
    const [docResult, keyResult] = await Promise.all([
      ragListDocuments(token),
      ragListKeys(token),
    ]);
    setDocuments(docResult.documents);
    setKeys(keyResult.keys);
  }, [token]);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  const hasActive = documents.some(
    (d) => d.status === "queued" || d.status === "processing"
  );
  useEffect(() => {
    if (!hasActive) return;
    const id = setInterval(() => {
      refresh().catch(() => {});
    }, 2500);
    return () => clearInterval(id);
  }, [hasActive, refresh]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, chatting]);

  // ── Upload queue ───────────────────────────────────────────────────────
  function updateItem(id: string, patch: Partial<UploadItem>) {
    uploadsRef.current = uploadsRef.current.map((u) =>
      u.id === id ? { ...u, ...patch } : u
    );
    setUploads([...uploadsRef.current]);
  }

  function queueFiles(files: FileList | File[]) {
    const items: UploadItem[] = Array.from(files).map((file) => {
      const validationError = ragFileError(file);
      return {
        id: crypto.randomUUID(),
        file,
        status: validationError ? "error" : "pending",
        progress: 0,
        error: validationError ?? undefined,
      };
    });
    uploadsRef.current = [...uploadsRef.current, ...items];
    setUploads([...uploadsRef.current]);
    pump();
  }

  function pump() {
    while (runningRef.current < MAX_CONCURRENT_UPLOADS) {
      const next = uploadsRef.current.find((u) => u.status === "pending");
      if (!next) break;
      runningRef.current += 1;
      void startUpload(next);
    }
  }

  async function startUpload(item: UploadItem) {
    updateItem(item.id, { status: "uploading" });
    try {
      const { document } = await ragUploadWithProgress(
        token!,
        item.file,
        (p) => {
          const pct =
            p.total > 0 ? Math.round((p.loaded / p.total) * 100) : 100;
          updateItem(item.id, { progress: Math.min(pct, 99) });
        }
      );
      updateItem(item.id, {
        status: "done",
        progress: 100,
        documentId: document.id,
      });
      await refresh();
    } catch (err) {
      updateItem(item.id, {
        status: "error",
        error:
          err instanceof ApiError ? err.message : "Upload failed.",
      });
    } finally {
      runningRef.current -= 1;
      pump();
    }
  }

  function retryUpload(id: string) {
    const item = uploadsRef.current.find((u) => u.id === id);
    if (!item) return;
    updateItem(id, { status: "pending", error: undefined, progress: 0 });
    pump();
  }

  function removeUpload(id: string) {
    uploadsRef.current = uploadsRef.current.filter((u) => u.id !== id);
    setUploads([...uploadsRef.current]);
  }

  function clearCompleted() {
    uploadsRef.current = uploadsRef.current.filter(
      (u) => u.status !== "done"
    );
    setUploads([...uploadsRef.current]);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files?.length) queueFiles(e.dataTransfer.files);
  }

  // ── Documents ──────────────────────────────────────────────────────────
  async function handleDelete(id: string) {
    if (!token) return;
    setDeletingId(id);
    setDocError(null);
    try {
      await ragDeleteDocument(token, id);
      if (scopeDocId === id) setScopeDocId("");
      await refresh();
    } catch (err) {
      setDocError(
        err instanceof ApiError ? err.message : "Failed to delete document."
      );
    } finally {
      setDeletingId(null);
    }
  }

  // ── Chat ───────────────────────────────────────────────────────────────
  async function handleChat(e: React.FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!token || !q || chatting) return;
    setQuestion("");
    setMessages((m) => [
      ...m,
      { id: crypto.randomUUID(), role: "user", content: q },
    ]);
    setChatting(true);
    try {
      const result = await ragChat(token, q, scopeDocId ? [scopeDocId] : undefined);
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: result.answer,
          citations: result.citations,
        },
      ]);
    } catch (err) {
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content:
            err instanceof ApiError ? err.message : "Chat failed. Try again.",
          error: true,
        },
      ]);
    } finally {
      setChatting(false);
    }
  }

  // ── RAG API keys ───────────────────────────────────────────────────────
  async function handleCreateKey(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !keyName.trim()) return;
    setKeyError(null);
    setCreatingKey(true);
    setRevealedKey(null);
    setCopied(false);
    try {
      const created = await ragCreateKey(token, keyName.trim());
      setRevealedKey(created.key);
      setKeyName("");
      await refresh();
    } catch (err) {
      setKeyError(
        err instanceof ApiError ? err.message : "Failed to create key."
      );
    } finally {
      setCreatingKey(false);
    }
  }

  async function handleRevoke(id: string) {
    if (!token) return;
    try {
      await ragRevokeKey(token, id);
      await refresh();
    } catch (err) {
      setKeyError(
        err instanceof ApiError ? err.message : "Failed to revoke key."
      );
    }
  }

  async function handleCopy() {
    if (!revealedKey) return;
    await navigator.clipboard.writeText(revealedKey);
    setCopied(true);
  }

  const indexedDocs = documents.filter((d) => d.status === "indexed");
  const totalChunks = documents.reduce((sum, d) => sum + d.chunkCount, 0);
  const hasUploads = uploads.length > 0;

  return (
    <Layout>
      <div className="mx-auto w-full max-w-7xl flex-1 px-4 py-10 sm:px-6">
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight">RAG Studio</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-500 dark:text-gray-400">
            Upload documents — they&apos;re parsed, structure-chunked and
            embedded into your private vector store. Ask questions in natural
            language or query from your own app via a RAG API key.
          </p>
          {documents.length > 0 && (
            <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
              {documents.length} document{documents.length === 1 ? "" : "s"} ·{" "}
              {totalChunks} chunk{totalChunks === 1 ? "" : "s"} indexed
            </p>
          )}
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          {/* ── Left: upload + documents ── */}
          <div className="space-y-6">
            {docError && (
              <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-400">
                {docError}
              </p>
            )}

            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
              className={`cursor-pointer rounded-2xl border-2 border-dashed p-6 text-center transition-colors ${
                dragActive
                  ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40"
                  : "border-gray-300 bg-white hover:border-indigo-400 dark:border-gray-700 dark:bg-gray-900"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={ACCEPT}
                className="sr-only"
                onChange={(e) => {
                  if (e.target.files?.length) queueFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <p className="text-sm font-medium">
                Drop files here or{" "}
                <span className="text-indigo-600 dark:text-indigo-400">
                  browse
                </span>
              </p>
              <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                PDF, DOCX, TXT, Markdown · up to{" "}
                {Math.round(RAG_MAX_UPLOAD_BYTES / 1024 / 1024)} MB each ·
                multiple at once
              </p>
            </div>

            {hasUploads && (
              <div className="card overflow-hidden">
                <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-800">
                  <p className="text-sm font-semibold">Uploading</p>
                  {uploads.some((u) => u.status === "done") && (
                    <button
                      onClick={clearCompleted}
                      className="btn-ghost"
                    >
                      Clear completed
                    </button>
                  )}
                </div>
                <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                  {uploads.map((u) => (
                    <li key={u.id} className="px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="min-w-0 flex-1 truncate text-sm font-medium">
                          {u.file.name}
                        </p>
                        <div className="flex shrink-0 items-center gap-2">
                          {u.status === "uploading" && (
                            <span className="text-xs text-gray-400">
                              {u.progress}%
                            </span>
                          )}
                          {u.status === "done" && (
                            <Badge variant="success">Uploaded</Badge>
                          )}
                          {u.status === "error" && (
                            <button
                              onClick={() => retryUpload(u.id)}
                              className="btn-secondary px-2 py-1 text-xs"
                            >
                              Retry
                            </button>
                          )}
                          {(u.status === "pending" ||
                            u.status === "error") && (
                            <button
                              onClick={() => removeUpload(u.id)}
                              className="btn-ghost"
                              aria-label={`Remove ${u.file.name}`}
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </div>
                      {u.status === "uploading" && (
                        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                          <div
                            className="h-full rounded-full bg-indigo-500 transition-all"
                            style={{ width: `${u.progress}%` }}
                          />
                        </div>
                      )}
                      {u.status === "error" && u.error && (
                        <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                          {u.error}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="card">
              <div className="border-b border-gray-100 px-4 py-3 dark:border-gray-800">
                <p className="text-sm font-semibold">Your documents</p>
              </div>
              <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                {documents.length === 0 && (
                  <li className="px-4 py-8 text-center text-sm text-gray-400 dark:text-gray-500">
                    No documents yet. Upload one above.
                  </li>
                )}
                {documents.map((doc) => (
                  <li
                    key={doc.id}
                    className="flex items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{doc.name}</p>
                      <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
                        {formatBytes(doc.sizeBytes)} ·{" "}
                        {new Date(doc.createdAt).toLocaleDateString()}
                        {doc.status === "indexed" &&
                          ` · ${doc.chunkCount} chunk${
                            doc.chunkCount === 1 ? "" : "s"
                          }`}
                      </p>
                      {doc.status === "failed" && doc.error && (
                        <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                          {doc.error}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <StatusBadge status={doc.status} />
                      {(doc.status === "indexed" || doc.status === "failed") && (
                        <button
                          onClick={() => void handleDelete(doc.id)}
                          disabled={deletingId === doc.id}
                          className="btn-danger"
                        >
                          {deletingId === doc.id ? "Deleting…" : "Delete"}
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* ── Right: chat + keys ── */}
          <div className="space-y-6">
            <div className="card flex flex-col">
              <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-5 py-3 dark:border-gray-800">
                <p className="text-sm font-semibold">Ask your documents</p>
                <label className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                  Scope
                  <select
                    value={scopeDocId}
                    onChange={(e) => setScopeDocId(e.target.value)}
                    className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-950"
                  >
                    <option value="">All documents</option>
                    {indexedDocs.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="flex max-h-[26rem] min-h-[16rem] flex-col gap-4 overflow-y-auto p-5">
                {messages.length === 0 && (
                  <div className="flex flex-1 flex-col items-center justify-center gap-1 text-center">
                    <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
                      Ask anything about your documents
                    </p>
                    <p className="max-w-xs text-xs text-gray-400 dark:text-gray-500">
                      Answers are grounded in your indexed chunks and come with
                      citations back to the source.
                    </p>
                  </div>
                )}
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={`flex ${
                      m.role === "user" ? "justify-end" : "justify-start"
                    }`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
                        m.role === "user"
                          ? "bg-indigo-600 text-white"
                          : m.error
                            ? "border border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-400"
                            : "border border-gray-200 bg-gray-50 text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                      }`}
                    >
                      <p className="whitespace-pre-wrap">{m.content}</p>
                      {m.citations && m.citations.length > 0 && (
                        <div className="mt-3 space-y-2 border-t border-current/10 pt-2.5">
                          <p className="text-[10px] font-medium uppercase tracking-wider opacity-70">
                            Sources
                          </p>
                          {m.citations.map((c, i) => (
                            <div
                              key={c.chunkId}
                              className="text-xs leading-relaxed opacity-90"
                            >
                              <p className="font-medium">
                                [{i + 1}] {c.source}
                                {c.headingPath && c.headingPath.length > 0 && (
                                  <span className="opacity-70">
                                    {" · "}
                                    {c.headingPath.join(" > ")}
                                  </span>
                                )}
                                <span className="opacity-70">
                                  {" · "}
                                  {Math.round(c.score * 1000) / 10}% match
                                </span>
                              </p>
                              <p className="mt-0.5 opacity-75">{c.excerpt}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {chatting && (
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <Spinner />
                    Thinking…
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              <form
                onSubmit={(e) => void handleChat(e)}
                className="flex items-center gap-2 border-t border-gray-100 p-4 dark:border-gray-800"
              >
                <input
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="e.g. What does the doc say about pricing?"
                  className="input flex-1"
                />
                <button
                  type="submit"
                  disabled={chatting || !question.trim()}
                  className="btn-primary"
                >
                  {chatting ? "Working…" : "Ask"}
                </button>
              </form>
            </div>

            <div className="card">
              <div className="border-b border-gray-100 px-5 py-4 dark:border-gray-800">
                <p className="text-sm font-semibold">RAG API keys</p>
                <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                  Use with{" "}
                  <code className="rounded bg-gray-100 px-1 py-0.5 text-[11px] dark:bg-gray-800">
                    POST /v1/rag/query
                  </code>{" "}
                  — spend comes out of your credits.
                </p>
              </div>

              <div className="space-y-4 p-5">
                {keyError && (
                  <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-400">
                    {keyError}
                  </p>
                )}

                <form
                  onSubmit={(e) => void handleCreateKey(e)}
                  className="flex gap-2"
                >
                  <input
                    value={keyName}
                    onChange={(e) => setKeyName(e.target.value)}
                    placeholder="Key name (e.g. my-app)"
                    className="input flex-1"
                  />
                  <button
                    type="submit"
                    disabled={creatingKey || !keyName.trim()}
                    className="btn-primary"
                  >
                    {creatingKey ? "Creating…" : "Create key"}
                  </button>
                </form>

                {revealedKey && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/40 dark:bg-amber-950/20">
                    <p className="text-sm font-medium">
                      Copy this key now — it&apos;s only shown once.
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <code className="flex-1 overflow-x-auto rounded-lg bg-white px-3 py-2 font-mono text-xs dark:bg-gray-950">
                        {revealedKey}
                      </code>
                      <button onClick={handleCopy} className="btn-secondary">
                        {copied ? "Copied" : "Copy"}
                      </button>
                    </div>
                  </div>
                )}

                <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                  {keys.length === 0 && (
                    <li className="py-3 text-center text-sm text-gray-400 dark:text-gray-500">
                      No RAG keys yet.
                    </li>
                  )}
                  {keys.map((k) => (
                    <li
                      key={k.id}
                      className="flex items-center justify-between py-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{k.name}</p>
                        <p className="text-xs text-gray-400 dark:text-gray-500">
                          ${k.spend.toFixed(4)} spent ·{" "}
                          {new Date(k.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      {!k.revokedAt ? (
                        <button
                          onClick={() => void handleRevoke(k.id)}
                          className="btn-danger"
                        >
                          Revoke
                        </button>
                      ) : (
                        <Badge variant="danger">Revoked</Badge>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}

function StatusBadge({ status }: { status: RagDocument["status"] }) {
  switch (status) {
    case "queued":
      return (
        <Badge variant="neutral">
          <Spinner className="h-3 w-3" />
          Queued
        </Badge>
      );
    case "processing":
      return (
        <Badge variant="info">
          <Spinner className="h-3 w-3" />
          Processing
        </Badge>
      );
    case "indexed":
      return <Badge variant="success">Indexed</Badge>;
    case "failed":
      return <Badge variant="danger">Failed</Badge>;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
