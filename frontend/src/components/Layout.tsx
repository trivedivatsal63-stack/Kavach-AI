import type { ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { ShieldMark } from "./ShieldMark";

function navClass({ isActive }: { isActive: boolean }): string {
  return [
    "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
    isActive
      ? "bg-gray-100 text-gray-900 dark:bg-neutral-800 dark:text-white"
      : "text-gray-600 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-neutral-800/60 dark:hover:text-white",
  ].join(" ");
}

export function Layout({
  children,
  fullHeight = false,
}: {
  children: ReactNode;
  /**
   * App-shell mode for immersive, ChatGPT/Claude-style pages (Chat, RAG
   * Studio): locks the page to the viewport height with no page-level
   * scroll — the page's own content owns its internal scroll regions
   * instead — and drops the footer, matching how those apps look during
   * actual use (no footer competing for space). Regular pages keep the
   * normal scrolling-document layout.
   */
  fullHeight?: boolean;
}) {
  const { token, user, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate("/login");
  }

  return (
    <div
      className={`flex flex-col bg-gray-50 text-gray-900 dark:bg-black dark:text-gray-100 ${
        fullHeight ? "h-screen overflow-hidden" : "min-h-screen"
      }`}
    >
      <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/80 backdrop-blur dark:border-neutral-800 dark:bg-black/80">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="flex items-center">
            <ShieldMark className="h-8 w-auto" />
          </Link>

          <nav className="flex items-center gap-1 text-sm">
            {token ? (
              <>
                <NavLink to="/dashboard" className={navClass}>
                  Dashboard
                </NavLink>
                <NavLink to="/chat" className={navClass}>
                  Chat
                </NavLink>
                <NavLink to="/rag" className={navClass}>
                  RAG Studio
                </NavLink>
                <NavLink to="/test" className={navClass}>
                  Test a key
                </NavLink>
                {user?.role === "superadmin" && (
                  <NavLink to="/admin" className={navClass}>
                    Admin
                  </NavLink>
                )}
                <NavLink to="/docs" className={navClass}>
                  Docs
                </NavLink>
                <div className="ml-3 flex items-center gap-3 border-l border-gray-200 pl-3 dark:border-neutral-800">
                  {user && (
                    <span className="hidden text-xs font-medium text-gray-600 sm:inline dark:text-gray-300">
                      ${user.creditBalanceUsd.toFixed(2)}
                    </span>
                  )}
                  <button
                    onClick={handleLogout}
                    className="rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-neutral-800 dark:hover:text-white"
                  >
                    Log out
                  </button>
                </div>
              </>
            ) : (
              <>
                <NavLink to="/docs" className={navClass}>
                  Docs
                </NavLink>
                <NavLink to="/login" className={navClass}>
                  Log in
                </NavLink>
                <Link to="/signup" className="btn-primary ml-2">
                  Sign up
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      {token && user?.status === "paused" && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300">
          This account is paused. You can browse your dashboard, but chat, RAG,
          and API keys are disabled until an administrator unpauses you.
        </div>
      )}

      <main
        className={`flex flex-1 flex-col ${fullHeight ? "min-h-0 overflow-hidden" : ""}`}
      >
        {children}
      </main>

      {!fullHeight && (
        <footer className="border-t border-gray-200 py-8 dark:border-neutral-800">
          <div className="mx-auto flex max-w-7xl flex-col items-center gap-3 px-4 sm:flex-row sm:justify-between sm:px-6">
            <div className="flex items-center">
              <ShieldMark className="h-7 w-auto" />
            </div>
            <p className="text-center text-xs text-gray-400 dark:text-gray-600">
              Self-hosted gateway — vLLM · LiteLLM · Qdrant. Serving{" "}
              <code className="font-mono text-gray-500 dark:text-gray-500">
                qwen3-30b-a3b
              </code>
              .
            </p>
          </div>
        </footer>
      )}
    </div>
  );
}
