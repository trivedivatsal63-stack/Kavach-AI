import { useCallback, useEffect, useMemo, useState } from "react";
import {
  adminBlockUser,
  adminDeleteUser,
  adminPauseUser,
  adminRestoreUser,
  adminRevokeAllKeys,
  adminRevokeUserKey,
  adminUnblockUser,
  adminUnpauseUser,
  ApiError,
  getAdminUser,
  listAdminUsers,
  type AdminUserActivity,
  type AdminUserSummary,
  type UserStatus,
} from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Layout } from "../components/Layout";
import { Badge } from "../components/Badge";
import { Spinner } from "../components/Spinner";

function statusBadge(status: UserStatus, deletedAt: string | null) {
  if (deletedAt) return <Badge variant="danger">Deleted</Badge>;
  if (status === "blocked") return <Badge variant="danger">Blocked</Badge>;
  if (status === "paused") return <Badge variant="warning">Paused</Badge>;
  return <Badge variant="success">Active</Badge>;
}

function actionLabel(action: string) {
  return action.replaceAll("_", " ");
}

export function AdminPage() {
  const { token } = useAuth();
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminUserActivity | null>(null);
  const [query, setQuery] = useState("");
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const refreshUsers = useCallback(async () => {
    if (!token) return;
    const rows = await listAdminUsers(token, { q: query, includeDeleted });
    setUsers(rows);
    setSelectedId((current) => {
      if (current && rows.some((u) => u.id === current)) return current;
      return rows[0]?.id ?? null;
    });
  }, [token, query, includeDeleted]);

  const refreshDetail = useCallback(async (id: string) => {
    if (!token) return;
    setDetail(await getAdminUser(token, id));
  }, [token]);

  useEffect(() => {
    setLoading(true);
    refreshUsers()
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : "Failed to load users.");
      })
      .finally(() => setLoading(false));
  }, [refreshUsers]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    void refreshDetail(selectedId).catch((err) => {
      setError(err instanceof ApiError ? err.message : "Failed to load user.");
    });
  }, [selectedId, refreshDetail]);

  const selected = useMemo(
    () => users.find((u) => u.id === selectedId) ?? null,
    [users, selectedId]
  );

  async function run(
    confirmText: string | null,
    fn: () => Promise<unknown>
  ) {
    if (!token || !selectedId) return;
    if (confirmText && !window.confirm(confirmText)) return;
    setError(null);
    setBusy(true);
    try {
      await fn();
      await Promise.all([refreshUsers(), refreshDetail(selectedId)]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <Layout>
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-gray-500">
          <Spinner />
          Loading users…
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
        <div>
          <p className="eyebrow">Role-based access</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">
            Superadmin panel
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            View every account&apos;s activity and pause, block, soft-delete, or
            revoke keys.
          </p>
        </div>

        {error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-400">
            {error}
          </p>
        )}

        <div className="grid min-h-0 flex-1 gap-6 lg:grid-cols-[minmax(280px,340px)_1fr]">
          <section className="card flex max-h-[calc(100vh-14rem)] flex-col overflow-hidden">
            <div className="space-y-3 border-b border-gray-100 p-4 dark:border-neutral-800">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search email or name"
                className="input"
              />
              <label className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                <input
                  type="checkbox"
                  checked={includeDeleted}
                  onChange={(e) => setIncludeDeleted(e.target.checked)}
                />
                Include deleted accounts
              </label>
            </div>
            <ul className="flex-1 overflow-y-auto divide-y divide-gray-100 dark:divide-neutral-800">
              {users.length === 0 && (
                <li className="p-4 text-sm text-gray-500">No users found.</li>
              )}
              {users.map((u) => (
                <li key={u.id}>
                  <button
                    onClick={() => setSelectedId(u.id)}
                    className={`flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors ${
                      u.id === selectedId
                        ? "bg-gray-50 dark:bg-neutral-800/70"
                        : "hover:bg-gray-50/70 dark:hover:bg-neutral-800/40"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">
                        {u.name || u.email}
                      </span>
                      {statusBadge(u.status, u.deletedAt)}
                    </div>
                    <p className="truncate text-xs text-gray-500">{u.email}</p>
                    <p className="text-[11px] text-gray-400">
                      {u.conversationCount} chats · {u.apiKeyCount} keys · $
                      {u.creditBalanceUsd.toFixed(2)}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="space-y-5">
            {!selected || !detail ? (
              <div className="card p-8 text-sm text-gray-500">
                Select a user to inspect activity.
              </div>
            ) : (
              <>
                <div className="card p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-lg font-semibold">
                          {detail.user.name || detail.user.email}
                        </h2>
                        {statusBadge(detail.user.status, detail.user.deletedAt)}
                        {detail.user.role === "superadmin" && (
                          <Badge variant="info">Superadmin</Badge>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-gray-500">
                        {detail.user.email}
                      </p>
                      <p className="mt-1 text-xs text-gray-400">
                        Joined {new Date(detail.user.createdAt).toLocaleString()} ·
                        balance ${detail.user.creditBalanceUsd.toFixed(2)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {detail.user.deletedAt ? (
                        <button
                          disabled={busy}
                          className="btn-secondary text-xs"
                          onClick={() =>
                            void run("Restore this account?", () =>
                              adminRestoreUser(token!, selected.id)
                            )
                          }
                        >
                          Restore
                        </button>
                      ) : (
                        <>
                          {detail.user.status === "paused" ? (
                            <button
                              disabled={busy}
                              className="btn-secondary text-xs"
                              onClick={() =>
                                void run(null, () =>
                                  adminUnpauseUser(token!, selected.id)
                                )
                              }
                            >
                              Unpause
                            </button>
                          ) : (
                            <button
                              disabled={busy}
                              className="btn-secondary text-xs"
                              onClick={() =>
                                void run(
                                  "Pause this account? They can log in but cannot use the API or chat.",
                                  () => adminPauseUser(token!, selected.id)
                                )
                              }
                            >
                              Pause activity
                            </button>
                          )}
                          {detail.user.status === "blocked" ? (
                            <button
                              disabled={busy}
                              className="btn-secondary text-xs"
                              onClick={() =>
                                void run(null, () =>
                                  adminUnblockUser(token!, selected.id)
                                )
                              }
                            >
                              Unblock
                            </button>
                          ) : (
                            <button
                              disabled={busy}
                              className="btn-danger"
                              onClick={() =>
                                void run(
                                  "Block this account? They will be signed out and all keys revoked.",
                                  () => adminBlockUser(token!, selected.id)
                                )
                              }
                            >
                              Block account
                            </button>
                          )}
                          <button
                            disabled={busy}
                            className="btn-danger"
                            onClick={() =>
                              void run(
                                "Soft-delete this account? Keys are revoked; the row is kept.",
                                () => adminDeleteUser(token!, selected.id)
                              )
                            }
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="card overflow-hidden">
                  <div className="flex items-center justify-between border-b border-gray-100 p-4 dark:border-neutral-800">
                    <div>
                      <h3 className="text-sm font-semibold">API keys</h3>
                      <p className="text-xs text-gray-500">
                        Dashboard keys and RAG keys, with live LiteLLM spend.
                      </p>
                    </div>
                    <button
                      disabled={busy}
                      className="btn-danger"
                      onClick={() =>
                        void run(
                          "Revoke every live key for this user?",
                          () => adminRevokeAllKeys(token!, selected.id)
                        )
                      }
                    >
                      Revoke all keys
                    </button>
                  </div>
                  {detail.keys.length === 0 ? (
                    <p className="p-4 text-sm text-gray-500">No keys.</p>
                  ) : (
                    <ul className="divide-y divide-gray-100 dark:divide-neutral-800">
                      {detail.keys.map((k) => (
                        <li
                          key={`${k.kind}-${k.id}`}
                          className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
                        >
                          <div className="min-w-0">
                            <p className="font-medium">
                              {k.kind === "rag" ? k.name || "RAG key" : "API key"}
                            </p>
                            <p className="truncate font-mono text-[11px] text-gray-400">
                              {k.id}
                            </p>
                            <p className="text-xs text-gray-500">
                              ${k.totalSpend.toFixed(4)} · {k.totalRequests}{" "}
                              requests · {k.promptTokens + k.completionTokens}{" "}
                              tokens
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <Badge variant={k.revokedAt ? "danger" : "success"}>
                              {k.revokedAt ? "Revoked" : "Active"}
                            </Badge>
                            {!k.revokedAt && (
                              <button
                                disabled={busy}
                                className="btn-danger"
                                onClick={() =>
                                  void run("Revoke this key?", () =>
                                    adminRevokeUserKey(
                                      token!,
                                      selected.id,
                                      k.id,
                                      k.kind
                                    )
                                  )
                                }
                              >
                                Revoke
                              </button>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="card overflow-hidden">
                  <div className="border-b border-gray-100 p-4 dark:border-neutral-800">
                    <h3 className="text-sm font-semibold">Conversations</h3>
                    <p className="text-xs text-gray-500">
                      Recent Chat and RAG Studio activity.
                    </p>
                  </div>
                  {detail.conversations.length === 0 ? (
                    <p className="p-4 text-sm text-gray-500">
                      No conversations yet.
                    </p>
                  ) : (
                    <ul className="divide-y divide-gray-100 dark:divide-neutral-800">
                      {detail.conversations.map((c) => (
                        <li key={c.id} className="px-4 py-3">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-sm font-medium">
                              {c.title}
                            </p>
                            <Badge variant="neutral">{c.mode}</Badge>
                          </div>
                          <p className="mt-1 text-xs text-gray-500">
                            {c.messageCount} messages ·{" "}
                            {new Date(c.updatedAt).toLocaleString()}
                          </p>
                          {c.lastMessage && (
                            <p className="mt-1 line-clamp-2 text-xs text-gray-400">
                              {c.lastMessage.role}: {c.lastMessage.preview}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="card overflow-hidden">
                  <div className="border-b border-gray-100 p-4 dark:border-neutral-800">
                    <h3 className="text-sm font-semibold">Admin audit</h3>
                  </div>
                  {detail.audit.length === 0 ? (
                    <p className="p-4 text-sm text-gray-500">No admin actions yet.</p>
                  ) : (
                    <ul className="divide-y divide-gray-100 text-sm dark:divide-neutral-800">
                      {detail.audit.map((row) => (
                        <li key={row.id} className="px-4 py-3">
                          <span className="font-medium capitalize">
                            {actionLabel(row.action)}
                          </span>
                          <span className="ml-2 text-xs text-gray-400">
                            {new Date(row.createdAt).toLocaleString()}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </Layout>
  );
}
