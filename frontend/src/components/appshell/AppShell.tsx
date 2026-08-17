import type { ReactNode } from "react";

// Full-viewport 3-column app shell for /chat and /rag — deliberately
// standalone, does NOT render inside the site's shared <Layout>: this
// sidebar replaces Layout's top header entirely for these two pages, so
// nesting them would produce a redundant double-nav.
export function AppShell({
  sidebar,
  main,
  rightPanel,
}: {
  sidebar: ReactNode;
  main: ReactNode;
  rightPanel: ReactNode;
}) {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-gray-50 text-gray-900 dark:bg-black dark:text-gray-100">
      {sidebar}
      <div className="flex h-full min-w-0 flex-1 flex-col">{main}</div>
      {rightPanel}
    </div>
  );
}
