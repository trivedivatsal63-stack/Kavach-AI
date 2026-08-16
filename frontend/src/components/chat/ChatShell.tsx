import type { ReactNode } from "react";

// Pure layout: a fixed-width sidebar slot beside a flexible main slot, both
// filling the full height given to them by the parent (Layout's fullHeight
// <main>). Used by both ChatPage (general chat) and RagPage (adds
// upload/document/browse panels around it) so the two share one visual
// language without sharing page-specific content. Edge-to-edge like a real
// app, not centered/padded like a marketing page.
export function ChatShell({
  sidebar,
  main,
}: {
  sidebar: ReactNode;
  main: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 w-full flex-1 gap-4 overflow-hidden p-4">
      <aside className="flex h-full w-72 shrink-0 flex-col">{sidebar}</aside>
      <div className="flex h-full min-w-0 flex-1 flex-col">{main}</div>
    </div>
  );
}
