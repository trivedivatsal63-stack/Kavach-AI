import { parse as parseHtml } from "node-html-parser";
import {
  PAGE_FETCH_MAX_BYTES,
  PAGE_FETCH_MAX_CHARS,
  PAGE_FETCH_TIMEOUT_MS,
  USER_AGENT,
} from "../../utils/liveSearch.constants";

const STRIP_SELECTORS = [
  "head",
  "script",
  "style",
  "noscript",
  "nav",
  "header",
  "footer",
  "svg",
  "iframe",
  "form",
];

// Fetches a search result's actual page and extracts its real text — the
// whole reason live search reads full pages instead of trusting SearXNG's
// thin one-line snippet. Returns null on any failure (timeout, non-HTML,
// error status) rather than throwing — callers fall back to the snippet for
// that one result instead of failing the whole search.
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

    const root = parseHtml(html);
    for (const selector of STRIP_SELECTORS) {
      for (const el of root.querySelectorAll(selector)) el.remove();
    }

    // Prefer <body> specifically — falling back to root would otherwise
    // still walk the doctype/head area on malformed markup. Collapsing ALL
    // whitespace (not just runs of spaces) to single spaces is deliberate:
    // this text only ever goes into an LLM prompt, never rendered, so
    // preserving paragraph breaks buys nothing and real pages (Wikipedia
    // especially) otherwise leave a wall of near-empty lines from nav/
    // accessibility chrome between visible text nodes.
    const body = root.querySelector("body") ?? root;
    const text = body.text
      .replace(/^<!DOCTYPE[^>]*>\s*/i, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) return null;

    return text.slice(0, PAGE_FETCH_MAX_CHARS);
  } catch {
    // Timeout (AbortError), DNS failure, connection reset, malformed HTML —
    // all treated the same: this one source didn't pan out, move on.
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
