import type { RagCitation } from "../../lib/api";

export function Citations({ citations }: { citations: RagCitation[] }) {
  if (citations.length === 0) return null;
  return (
    <div className="mt-3 space-y-2 border-t border-current/10 pt-2.5">
      <p className="text-[10px] font-medium tracking-wider uppercase opacity-70">
        Sources
      </p>
      {citations.map((c, i) => (
        <div key={c.chunkId} className="text-xs leading-relaxed opacity-90">
          <p className="font-medium">
            [{i + 1}] {c.source}
            {c.headingPath && c.headingPath.length > 0 && (
              <span className="opacity-70">{" · "}{c.headingPath.join(" > ")}</span>
            )}
            <span className="opacity-70">
              {" · "}
              {Math.round(c.score * 1000) / 10}% match
            </span>
          </p>
          <p className="mt-0.5 opacity-75">{c.excerpt}</p>
        </div>
      ))}
    </div>
  );
}
