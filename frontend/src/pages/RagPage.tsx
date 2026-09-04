import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AppShell } from "../components/appshell/AppShell";
import { AppSidebar } from "../components/appshell/AppSidebar";
import { AppRightPanel } from "../components/appshell/AppRightPanel";
import { WelcomeScreen } from "../components/appshell/WelcomeScreen";
import { Badge } from "../components/Badge";
import { Spinner } from "../components/Spinner";
import { MessageThread } from "../components/chat/MessageThread";
import { Composer } from "../components/chat/Composer";
import { ChatIcon, DocIcon, KeyIcon, LayersIcon, XIcon } from "../components/icons";
import { DocumentChunkBrowser } from "../components/rag/DocumentChunkBrowser";
import { useAuth } from "../context/AuthContext";
import { useConversation } from "../hooks/useConversation";
import {
  ApiError,
  KEY_EXPIRY_PRESETS,
  expiryIsoFromDays,
  ragCreateKey,
  ragDeleteDocument,
  ragFileError,
  ragListDocuments,
  ragListKeys,
  ragRevokeKey,
  ragUploadWithProgress,
  RAG_MAX_UPLOAD_BYTES,
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

const ACCEPT = ".pdf,.docx,.txt,.md,.markdown";

type View = "chat" | "documents" | "browse";

export function RagPage() {
  const { token } = useAuth();
  const [searchParams] = useSearchParams();

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
  const [revealedMeta, setRevealedMeta] = useState<{
    name: string;
    expiresAt: string | null;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [creatingKey, setCreatingKey] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [keyExpiryDays, setKeyExpiryDays] = useState<number | null>(30);
  const [revokeTarget, setRevokeTarget] = useState<RagKeySummary | null>(null);

  const [view, setView] = useState<View>("chat");
  const [pendingScopeDocId, setPendingScopeDocId] = useState("");
  const [draft, setDraft] = useState("");
  const [webSearch, setWebSearch] = useState(false);
  const [search, setSearch] = useState("");

  // Entry points from AppSidebar's "Documents" nav item and ChatPage's
  // welcome screen link here with ?view=documents / ?view=keys — both land
  // on the "documents" view since the keys card already lives there.
  useEffect(() => {
    const v = searchParams.get("view");
    if (v === "documents" || v === "keys") setView("documents");
    else if (v === "browse") setView("browse");
  }, [searchParams]);

  const {
    conversations,
    activeId,
    messages,
    sending,
    streamPhases,
    streamingText,
    stopStreaming,
    error: chatError,
    selectConversation,
    startComposing,
    startNewConversation,
    deleteConversation,
    sendMessageStream,
  } = useConversation(token, "rag");

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
      if (pendingScopeDocId === id) setPendingScopeDocId("");
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
  async function handleSend() {
    const content = draft.trim();
    if (!content) return;
    setDraft("");
    if (!activeId) {
      const conversation = await startNewConversation(
        pendingScopeDocId ? [pendingScopeDocId] : undefined
      );
      if (!conversation) return;
      await sendMessageStream(content, conversation.id, webSearch);
      return;
    }
    await sendMessageStream(content, undefined, webSearch);
  }

  function handleNewChat() {
    setPendingScopeDocId("");
    startComposing();
  }

  // ── RAG API keys ───────────────────────────────────────────────────────
  async function handleCreateKey(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !keyName.trim()) return;
    setKeyError(null);
    setCreatingKey(true);
    setRevealedKey(null);
    setRevealedMeta(null);
    setCopied(false);
    try {
      const created = await ragCreateKey(
        token,
        keyName.trim(),
        keyExpiryDays != null ? expiryIsoFromDays(keyExpiryDays) : null
      );
      setRevealedKey(created.key);
      setRevealedMeta({ name: created.name, expiresAt: created.expiresAt });
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
      setRevokeTarget(null);
      await refresh();
    } catch (err) {
      setKeyError(
        err instanceof ApiError ? err.message : "Failed to revoke key."
      );
    }
  }

  function ragExpiryText(expiresAt: string | null): string {
    if (!expiresAt) return "Never expires";
    const ms = new Date(expiresAt).getTime() - Date.now();
    if (ms <= 0) return "Expired";
    const days = Math.ceil(ms / (24 * 60 * 60 * 1000));
    return days === 1 ? "Expires tomorrow" : `Expires in ${days} days`;
  }

  async function handleCopy() {
    if (!revealedKey) return;
    await navigator.clipboard.writeText(revealedKey);
    setCopied(true);
  }

  const indexedDocs = documents.filter((d) => d.status === "indexed");
  const totalChunks = documents.reduce((sum, d) => sum + d.chunkCount, 0);
  const hasUploads = uploads.length > 0;
  const activeConversation = conversations.find((c) => c.id === activeId);

  function scopeLabel(documentIds: string[] | null | undefined): string {
    if (!documentIds || documentIds.length === 0) return "All documents";
    const doc = documents.find((d) => d.id === documentIds[0]);
    return doc ? doc.name : "1 document";
  }

  if (!token) return null;

  const tabs: { key: View; label: string }[] = [
    { key: "chat", label: "Chats" },
    { key: "documents", label: "Documents" },
    { key: "browse", label: "Visual view" },
  ];

  return (
    <AppShell
      sidebar={
        <AppSidebar
          mode="rag"
          search={search}
          onSearchChange={setSearch}
          onLiveSearchShortcut={() => {
            setView("chat");
            handleNewChat();
            setWebSearch(true);
          }}
          onNewChat={() => {
            setView("chat");
            handleNewChat();
          }}
        />
      }
      main={
        <div className="flex h-full min-h-0 flex-1 flex-col">
          {/* Compact top bar — fixed height, never scrolls */}
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-neutral-800 sm:px-6">
            <div className="flex items-center gap-3">
              <h1 className="text-base font-semibold tracking-tight">
                RAG Studio
              </h1>
              {documents.length > 0 && (
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  {documents.length} doc{documents.length === 1 ? "" : "s"} ·{" "}
                  {totalChunks} chunk{totalChunks === 1 ? "" : "s"}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {view === "chat" && activeId && (
                <span className="badge bg-gray-100 text-gray-600 dark:bg-neutral-800 dark:text-gray-300">
                  Scoped to: {scopeLabel(activeConversation?.documentIds)}
                </span>
              )}
              <div className="inline-flex rounded-lg border border-gray-200 p-1 dark:border-neutral-800">
                {tabs.map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setView(tab.key)}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                      view === tab.key
                        ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
                        : "text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Fills all remaining height — internal scroll only, page never scrolls */}
          <div className="min-h-0 flex-1">
            {view === "chat" && (
              <div className="flex h-full min-h-0 flex-1 flex-col">
                {!activeId && (
                  <div className="flex shrink-0 items-center gap-2 border-b border-gray-100 px-5 py-3 text-xs text-gray-500 dark:border-neutral-800 dark:text-gray-400">
                    Scope
                    <select
                      value={pendingScopeDocId}
                      onChange={(e) => setPendingScopeDocId(e.target.value)}
                      className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs dark:border-neutral-700 dark:bg-black"
                    >
                      <option value="">All documents</option>
                      {indexedDocs.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {chatError && (
                  <p className="shrink-0 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-400">
                    {chatError}
                  </p>
                )}

                {!activeId ? (
                  <WelcomeScreen
                    title="Ask your documents"
                    subtitle="Answers are grounded in your indexed chunks and come with citations back to the source."
                    actions={[
                      {
                        icon: <ChatIcon />,
                        label: "Ask your documents",
                        onClick: () => startComposing(),
                      },
                      {
                        icon: <DocIcon />,
                        label: "Upload a document",
                        onClick: () => setView("documents"),
                      },
                      {
                        icon: <LayersIcon />,
                        label: "Browse chunks visually",
                        onClick: () => setView("browse"),
                      },
                      {
                        icon: <KeyIcon />,
                        label: "Get a RAG API key",
                        onClick: () => setView("documents"),
                      },
                    ]}
                  />
                ) : (
                  <MessageThread
                    messages={messages}
                    sending={sending}
                    streamPhases={streamPhases}
                    streamingText={streamingText}
                    onRetry={(c) => void sendMessageStream(c, activeId ?? undefined, webSearch)}
                    emptyTitle="Ask your documents"
                    emptyBody="Answers are grounded in your indexed chunks and come with citations back to the source."
                  />
                )}

                <Composer
                  value={draft}
                  onChange={setDraft}
                  onSubmit={() => void handleSend()}
                  disabled={sending}
                  streaming={sending}
                  onStop={stopStreaming}
                  placeholder="e.g. What does the doc say about pricing?"
                  webSearch={webSearch}
                  onToggleWebSearch={() => setWebSearch((v) => !v)}
                  onAttach={() => setView("documents")}
                />
              </div>
            )}

            {view === "browse" && (
              <div className="h-full p-4">
                <DocumentChunkBrowser token={token} documents={documents} />
              </div>
            )}

            {view === "documents" && (
              <div className="h-full overflow-y-auto p-4 sm:p-6">
                <div className="grid gap-6 lg:grid-cols-2">
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
                          ? "border-gray-500 bg-gray-50 dark:bg-neutral-800"
                          : "border-gray-300 bg-white hover:border-gray-400 dark:border-neutral-700 dark:bg-neutral-900"
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
                        <span className="underline decoration-gray-300 underline-offset-2">
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
                        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-neutral-800">
                          <p className="text-sm font-semibold">Uploading</p>
                          {uploads.some((u) => u.status === "done") && (
                            <button onClick={clearCompleted} className="btn-ghost">
                              Clear completed
                            </button>
                          )}
                        </div>
                        <ul className="divide-y divide-gray-100 dark:divide-neutral-800">
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
                                      <XIcon className="h-4 w-4" />
                                    </button>
                                  )}
                                </div>
                              </div>
                              {u.status === "uploading" && (
                                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-neutral-800">
                                  <div
                                    className="h-full rounded-full bg-gray-900 transition-all dark:bg-white"
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
                      <div className="border-b border-gray-100 px-4 py-3 dark:border-neutral-800">
                        <p className="text-sm font-semibold">Your documents</p>
                      </div>
                      <ul className="divide-y divide-gray-100 dark:divide-neutral-800">
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
                              <p className="truncate text-sm font-medium">
                                {doc.name}
                              </p>
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
                              {(doc.status === "indexed" ||
                                doc.status === "failed") && (
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

                  <div className="card h-fit">
                    <div className="border-b border-gray-100 px-5 py-4 dark:border-neutral-800">
                      <p className="text-sm font-semibold">RAG API keys</p>
                      <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                        Use with{" "}
                        <code className="rounded bg-gray-100 px-1 py-0.5 text-[11px] dark:bg-neutral-800">
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
                        className="space-y-2"
                      >
                        <div className="flex gap-2">
                          <input
                            value={keyName}
                            onChange={(e) => setKeyName(e.target.value.slice(0, 60))}
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
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {KEY_EXPIRY_PRESETS.map((p) => (
                            <button
                              key={p.label}
                              type="button"
                              onClick={() => setKeyExpiryDays(p.days)}
                              className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                                keyExpiryDays === p.days
                                  ? "border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900"
                                  : "border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-neutral-700 dark:text-gray-300 dark:hover:bg-neutral-800"
                              }`}
                            >
                              {p.label}
                            </button>
                          ))}
                        </div>
                      </form>

                      {revealedKey && (
                        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/40 dark:bg-amber-950/20">
                          <p className="text-sm font-medium">
                            {revealedMeta?.name}
                            {revealedMeta?.expiresAt
                              ? ` · expires ${new Date(revealedMeta.expiresAt).toLocaleDateString()}`
                              : " · never expires"}
                          </p>
                          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                            Copy this key now — it&apos;s only shown once.
                          </p>
                          <div className="mt-2 flex items-center gap-2">
                            <code className="flex-1 overflow-x-auto rounded-lg bg-white px-3 py-2 font-mono text-xs dark:bg-black">
                              {revealedKey}
                            </code>
                            <button onClick={handleCopy} className="btn-secondary">
                              {copied ? "Copied" : "Copy"}
                            </button>
                            <button
                              onClick={() => {
                                setRevealedKey(null);
                                setRevealedMeta(null);
                              }}
                              className="btn-ghost"
                            >
                              Dismiss
                            </button>
                          </div>
                        </div>
                      )}

                      <ul className="divide-y divide-gray-100 dark:divide-neutral-800">
                        {keys.length === 0 && (
                          <li className="py-3 text-center text-sm text-gray-400 dark:text-gray-500">
                            No RAG keys yet.
                          </li>
                        )}
                        {keys.map((k) => (
                          <li
                            key={k.id}
                            className="flex items-center justify-between gap-3 py-3"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">
                                {k.name}
                              </p>
                              <p className="truncate font-mono text-xs text-gray-500 dark:text-gray-400">
                                {k.keyPrefix}
                              </p>
                              <p className="text-xs text-gray-400 dark:text-gray-500">
                                ${k.spend.toFixed(4)} spent ·{" "}
                                {new Date(k.createdAt).toLocaleDateString()} ·{" "}
                                {ragExpiryText(k.expiresAt)}
                              </p>
                            </div>
                            {k.status === "active" || k.status === "expiring-soon" ? (
                              <div className="flex shrink-0 items-center gap-2">
                                {k.status === "expiring-soon" && (
                                  <Badge variant="warning">Expiring soon</Badge>
                                )}
                                <button
                                  onClick={() => setRevokeTarget(k)}
                                  className="btn-danger"
                                >
                                  Revoke
                                </button>
                              </div>
                            ) : (
                              <Badge variant="danger">
                                {k.status === "expired" ? "Expired" : "Revoked"}
                              </Badge>
                            )}
                          </li>
                        ))}
                      </ul>
                      {revokeTarget && (
                        <div
                          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
                          onClick={() => setRevokeTarget(null)}
                        >
                          <div
                            className="card w-full max-w-sm p-6"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <h2 className="text-base font-semibold">Revoke key?</h2>
                            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                              <span className="font-medium text-gray-900 dark:text-gray-100">
                                {revokeTarget.name}
                              </span>{" "}
                              will stop working immediately. This cannot be undone.
                            </p>
                            <div className="mt-6 flex justify-end gap-2">
                              <button
                                onClick={() => setRevokeTarget(null)}
                                className="btn-secondary"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={() => void handleRevoke(revokeTarget.id)}
                                className="btn-danger px-4 py-2"
                              >
                                Revoke key
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      }
      rightPanel={
        <AppRightPanel
          conversations={conversations}
          activeId={activeId}
          search={search}
          onSelect={(id) => {
            setView("chat");
            void selectConversation(id);
          }}
          onDelete={(id) => void deleteConversation(id)}
          onNewChat={() => {
            setView("chat");
            handleNewChat();
          }}
        />
      }
    />
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
