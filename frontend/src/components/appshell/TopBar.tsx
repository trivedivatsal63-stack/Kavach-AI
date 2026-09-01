import { Link } from "react-router-dom";
import { MODEL_LABEL, MODEL_NAME } from "../../lib/modelInfo";
import { useAuth } from "../../context/AuthContext";

/** Top chrome — model chip (Llama config, never GLM) + site links. */
export function TopBar() {
  const { token, user, logout } = useAuth();

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-gray-200/80 bg-transparent px-5 dark:border-neutral-800">
      <div className="flex min-w-0 items-center gap-2">
        <div
          className="inline-flex max-w-full items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-sm shadow-sm dark:border-neutral-700 dark:bg-neutral-900"
          title={MODEL_LABEL}
        >
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-gray-900 text-[10px] font-bold text-white dark:bg-white dark:text-gray-900">
            L
          </span>
          <span className="truncate font-medium text-gray-800 dark:text-gray-100">
            {MODEL_NAME}
          </span>
          <span className="hidden truncate text-xs text-gray-400 sm:inline dark:text-gray-500">
            · FP16 · 16K
          </span>
          <svg
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-3.5 w-3.5 shrink-0 text-gray-400"
            aria-hidden
          >
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 10.94l3.71-3.71a.75.75 0 1 1 1.06 1.06l-4.24 4.25a.75.75 0 0 1-1.06 0L5.21 8.29a.75.75 0 0 1 .02-1.08Z"
              clipRule="evenodd"
            />
          </svg>
        </div>
      </div>

      <nav className="flex items-center gap-1 sm:gap-2">
        <Link
          to="/docs"
          className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-neutral-800 dark:hover:text-white"
        >
          API
        </Link>
        <Link
          to="/dashboard"
          className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-neutral-800 dark:hover:text-white"
        >
          Dashboard
        </Link>
        {user?.role === "superadmin" && (
          <Link
            to="/admin"
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-neutral-800 dark:hover:text-white"
          >
            Admin
          </Link>
        )}
        {token ? (
          <button
            onClick={logout}
            className="ml-1 rounded-full bg-gray-900 px-3.5 py-1.5 text-sm font-medium text-white transition-colors hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200"
            title={user?.email}
          >
            Sign out
          </button>
        ) : (
          <Link
            to="/login"
            className="ml-1 rounded-full bg-gray-900 px-3.5 py-1.5 text-sm font-medium text-white transition-colors hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200"
          >
            Sign in
          </Link>
        )}
      </nav>
    </header>
  );
}
