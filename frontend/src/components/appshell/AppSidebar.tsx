import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ShieldMark } from "../ShieldMark";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";

function NavItem({
  active,
  chip,
  chipColor,
  label,
  onClick,
}: {
  active: boolean;
  chip: ReactNode;
  chipColor: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-medium transition-colors ${
        active
          ? "bg-gray-100 text-gray-900 dark:bg-neutral-800 dark:text-white"
          : "text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-neutral-800/60"
      }`}
    >
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-sm ${chipColor}`}
      >
        {chip}
      </span>
      {label}
    </button>
  );
}

// Shared left rail for /chat and /rag — matches a reference layout the user
// provided (3-column app shell), deliberately in its own black/white style
// rather than the rest of the site's indigo accent (confirmed
// intentional). Only real Kavach destinations are represented here —
// "Templates"/"Community" from the reference have no equivalent and were
// dropped rather than faked.
export function AppSidebar({
  mode,
  search,
  onSearchChange,
  onLiveSearchShortcut,
  onNewChat,
}: {
  mode: "chat" | "rag";
  search: string;
  onSearchChange: (value: string) => void;
  onLiveSearchShortcut: () => void;
  onNewChat: () => void;
}) {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-gray-200 bg-white dark:border-neutral-800 dark:bg-black">
      <div className="flex items-center gap-2 px-4 py-4">
        <Link to="/" className="block">
          <ShieldMark className="h-[60px] w-[180px] max-w-[180px]" />
        </Link>
      </div>

      <div className="px-3 pb-3">
        <input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search conversations"
          className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none dark:border-neutral-800 dark:bg-neutral-900 dark:text-gray-100 dark:placeholder:text-gray-500"
        />
      </div>

      <div className="px-3 pb-3">
        <button
          onClick={onNewChat}
          className="flex w-full items-center gap-2.5 rounded-lg border border-gray-200 px-2.5 py-2 text-left text-sm font-medium text-gray-900 transition-colors hover:bg-gray-50 dark:border-neutral-800 dark:text-white dark:hover:bg-neutral-800/60"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gray-900 text-sm text-white dark:bg-white dark:text-gray-900">
            +
          </span>
          New chat
        </button>
      </div>

      <nav className="flex flex-col gap-0.5 px-3">
        <NavItem
          active={mode === "chat"}
          chip="💬"
          chipColor="bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400"
          label="Chat"
          onClick={() => navigate("/chat")}
        />
        <NavItem
          active={mode === "rag"}
          chip="📄"
          chipColor="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
          label="RAG Studio"
          onClick={() => navigate("/rag")}
        />
        <NavItem
          active={false}
          chip="📁"
          chipColor="bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-400"
          label="Documents"
          onClick={() => navigate("/rag?view=documents")}
        />
        <NavItem
          active={false}
          chip="🌐"
          chipColor="bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-400"
          label="Live Search"
          onClick={onLiveSearchShortcut}
        />
      </nav>

      <div className="mt-3 border-t border-gray-100 px-3 pt-3 dark:border-neutral-800">
        <p className="px-2.5 pb-1 text-[11px] font-semibold tracking-wide text-gray-400 uppercase dark:text-gray-500">
          More
        </p>
        <NavItem
          active={false}
          chip="📊"
          chipColor="bg-gray-100 text-gray-600 dark:bg-neutral-800 dark:text-gray-300"
          label="Dashboard"
          onClick={() => navigate("/dashboard")}
        />
        {user?.role === "superadmin" && (
          <NavItem
            active={false}
            chip="🛡️"
            chipColor="bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-400"
            label="Admin"
            onClick={() => navigate("/admin")}
          />
        )}
        <NavItem
          active={false}
          chip="📚"
          chipColor="bg-gray-100 text-gray-600 dark:bg-neutral-800 dark:text-gray-300"
          label="Docs"
          onClick={() => navigate("/docs")}
        />
      </div>

      <div className="flex-1" />

      <div className="px-3 pb-3">
        <button
          onClick={() => navigate("/dashboard")}
          className="w-full rounded-lg bg-gray-900 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200"
        >
          Add credits
        </button>
      </div>

      <div className="flex items-center justify-between border-t border-gray-100 px-3 py-2 dark:border-neutral-800">
        <div className="inline-flex rounded-lg border border-gray-200 p-0.5 text-xs dark:border-neutral-800">
          <button
            onClick={() => theme !== "light" && toggleTheme()}
            className={`rounded-md px-2 py-1 font-medium transition-colors ${
              theme === "light"
                ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900"
                : "text-gray-500 dark:text-gray-400"
            }`}
          >
            Light
          </button>
          <button
            onClick={() => theme !== "dark" && toggleTheme()}
            className={`rounded-md px-2 py-1 font-medium transition-colors ${
              theme === "dark"
                ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900"
                : "text-gray-500 dark:text-gray-400"
            }`}
          >
            Dark
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-gray-100 px-4 py-3 dark:border-neutral-800">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-gray-900 dark:text-white">
            {user?.name || user?.email}
          </p>
          <p className="truncate text-xs text-gray-400 dark:text-gray-500">
            ${user?.creditBalanceUsd.toFixed(2)} balance
          </p>
        </div>
        <button
          onClick={logout}
          className="shrink-0 rounded-lg px-2 py-1.5 text-xs font-medium text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-neutral-800 dark:hover:text-gray-200"
        >
          Log out
        </button>
      </div>
    </aside>
  );
}
