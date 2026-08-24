import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import {
  PAGE_FETCH_MAX_BYTES,
  PAGE_FETCH_MAX_CHARS,
  PAGE_FETCH_TIMEOUT_MS,
  USER_AGENT,
} from "../../utils/liveSearch.constants";

// Fetches a search result's actual page and extracts its real text — the
// whole reason live search reads full pages instead of trusting SearXNG's
// thin one-line snippet. Returns null on any failure (timeout, non-HTML,
// error status) rather than throwing — callers fall back to the snippet for
// that one result instead of failing the whole search.
//
// Extraction uses Mozilla Readability (same as Firefox reader mode) for
// article-focused text, falling back to naive body text on failure. This
// removes nav/chrome more reliably than manual strip selectors, especially
// for Wikipedia/docs.
export async function fetchPageText(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PAGE_FETCH_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(url, {
        signal: controller.signal,
        redirect: "follow",
        headers: { "User-Agent": USER_AGENT, Accept: "text/html,*/*" },
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) return null;

    const html = await readCapped(res, PAGE_FETCH_MAX_BYTES);
    if (html === null) return null;

    const text = extractWithReadability(html, url);
    if (!text) return null;

    return text.slice(0, PAGE_FETCH_MAX_CHARS);
  } catch {
    // Timeout (AbortError), DNS failure, connection reset, malformed HTML —
    // all treated the same: this one source didn't pan out, move on.
    return null;
  }
}

function extractWithReadability(html: string, url: string): string | null {
  try {
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    if (article?.textContent) {
      const cleaned = article.textContent.replace(/\s+/g, " ").trim();
      if (cleaned.length >= 120) return cleaned;
    }
  } catch {
    // fall through to fallback
  }
  // Fallback: naive body text if Readability fails or yields too little
  try {
    const dom = new JSDOM(html);
    const bodyText = dom.window.document.body?.textContent ?? "";
    const cleaned = bodyText.replace(/\s+/g, " ").trim();
    return cleaned || null;
  } catch {
    return null;
  }
}

// Reads the response body up to maxBytes and stops — protects against a
// single huge page stalling/ballooning memory when several fetches run in
// parallel. Returns null if the body can't be streamed at all.
async function readCapped(res: Response, maxBytes: number): Promise<string | null> {
  const reader = res.body?.getReader();
  if (!reader) return null;

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks).toString("utf-8");
}
