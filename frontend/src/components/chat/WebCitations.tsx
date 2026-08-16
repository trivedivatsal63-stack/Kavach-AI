import type { WebCitation } from "../../lib/api";

// Sibling to Citations.tsx (document sources) — same visual language, own
// component since the shape is different (no chunkId/score/headingPath,
// just a real fetched page).
export function WebCitations({ citations }: { citations: WebCitation[] }) {
  if (citations.length === 0) return null;
  return (
    <div className="mt-3 space-y-2 border-t border-current/10 pt-2.5">
      <p className="text-[10px] font-medium tracking-wider uppercase opacity-70">
        Web sources
      </p>
      {citations.map((c, i) => (
        <div key={c.url} className="text-xs leading-relaxed opacity-90">
          <p className="font-medium">
            [{i + 1}]{" "}
            <a
              href={c.url}
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-current/40 underline-offset-2 hover:decoration-current"
            >
              {c.title}
            </a>
          </p>
          <p className="mt-0.5 opacity-75">{c.excerpt}</p>
        </div>
      ))}
    </div>
  );
}
