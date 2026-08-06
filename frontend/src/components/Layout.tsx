import type { ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

function navClass({ isActive }: { isActive: boolean }): string {
  return [
    "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
    isActive
      ? "bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-white"
      : "text-gray-600 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800/60 dark:hover:text-white",
  ].join(" ");
}

export function Layout({ children }: { children: ReactNode }) {
  const { token, user, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate("/login");
  }

  return (
    <div className="flex min-h-screen flex-col bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/80 backdrop-blur dark:border-gray-800 dark:bg-gray-950/80">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-bold text-white">
              K
            </span>
            <span className="text-base font-semibold tracking-tight">
              Kavach AI
            </span>
          </Link>

          <nav className="flex items-center gap-1 text-sm">
            {token ? (
              <>
                <NavLink to="/dashboard" className={navClass}>
                  Dashboard
                </NavLink>
                <NavLink to="/rag" className={navClass}>
                  RAG Studio
                </NavLink>
                <NavLink to="/test" className={navClass}>
                  Test a key
                </NavLink>
                <NavLink to="/docs" className={navClass}>
                  Docs
                </NavLink>
                <div className="ml-3 flex items-center gap-3 border-l border-gray-200 pl-3 dark:border-gray-800">
                  {user && (
                    <span className="hidden text-xs font-medium text-gray-600 sm:inline dark:text-gray-300">
                      ${user.creditBalanceUsd.toFixed(2)}
                    </span>
                  )}
                  <button
                    onClick={handleLogout}
                    className="rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white"
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

      <main className="flex flex-1 flex-col">{children}</main>

      <footer className="border-t border-gray-200 py-6 dark:border-gray-800">
        <p className="px-4 text-center text-xs text-gray-400 dark:text-gray-600">
          Kavach AI Platform — OpenAI-compatible gateway with RAG. Model:
          qwen2.5-1.5b.
        </p>
      </footer>
    </div>
  );
}
