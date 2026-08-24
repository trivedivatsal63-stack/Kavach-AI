import type { WebCitation } from "../../lib/api";

// Claude/ChatGPT-style sources: links-only (no excerpt), favicon + domain + title
// as compact cards. Excerpt is still fed to the LLM privately via webCitationFormat.ts.
export function WebCitations({ citations }: { citations: WebCitation[] }) {
  if (citations.length === 0) return null;
  return (
    <div className="mt-3 border-t border-current/10 pt-3">
      <p className="mb-2 text-[10px] font-medium tracking-wider uppercase opacity-60">
        Sources · {citations.length}
      </p>
      <div className="flex flex-wrap gap-2">
        {citations.map((c, i) => {
          let domain = "";
          let favicon = "";
          try {
            const u = new URL(c.url);
            domain = u.hostname.replace(/^www\./, "");
            favicon = `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=32`;
          } catch {
            domain = c.url;
          }
          return (
            <a
              key={`${c.url}-${i}`}
              href={c.url}
              target="_blank"
              rel="noopener noreferrer"
              title={c.title}
              className="group inline-flex max-w-[280px] items-center gap-2 rounded-full border border-gray-200 bg-white px-2.5 py-1.5 text-xs shadow-sm transition hover:border-gray-300 hover:bg-gray-50 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800"
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-100 text-[10px] font-semibold text-gray-600 dark:bg-neutral-800 dark:text-gray-300">
                {favicon ? (
                  <img
                    src={favicon}
                    alt=""
                    width={14}
                    height={14}
                    className="h-3.5 w-3.5 rounded-sm"
                    loading="lazy"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = "none";
                    }}
                  />
                ) : (
                  <>{i + 1}</>
                )}
              </span>
              <span className="flex min-w-0 flex-col text-left">
                <span className="max-w-[170px] truncate font-medium leading-none text-gray-900 dark:text-gray-100">
                  {c.title}
                </span>
                <span className="max-w-[170px] truncate text-[10px] leading-none opacity-60">
                  {domain}
                </span>
              </span>
              <span className="ml-1 shrink-0 text-[10px] font-medium opacity-40 group-hover:opacity-70">
                [{i + 1}]
              </span>
              <svg
                className="h-3 w-3 shrink-0 opacity-30 group-hover:opacity-60"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          );
        })}
      </div>
    </div>
  );
}
