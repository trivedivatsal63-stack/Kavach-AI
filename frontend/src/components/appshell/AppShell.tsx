import type { ReactNode } from "react";
import { TopBar } from "./TopBar";

/** Full-viewport shell: left rail + (top bar + main). No right panel — chats live in the sidebar. */
export function AppShell({
  sidebar,
  main,
}: {
  sidebar: ReactNode;
  main: ReactNode;
}) {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#f4f4f5] text-gray-900 dark:bg-neutral-950 dark:text-gray-100">
      {sidebar}
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <TopBar />
        <div className="flex min-h-0 flex-1 flex-col">{main}</div>
      </div>
    </div>
  );
}
