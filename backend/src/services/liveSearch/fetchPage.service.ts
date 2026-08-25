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
// Extraction prefers Mozilla Readability + jsdom when available (Firefox
// reader mode, better article focus), but jsdom 30 is incompatible with
// Node 20 on the pod (undici webidl). To avoid crash-looping the entire
// backend on a single import, jsdom/Readability are loaded lazily and any
// load failure falls back to node-html-parser (already in deps).
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
  // Try Readability + jsdom (lazy, may be incompatible with Node 20 pod)
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { JSDOM } = require("jsdom");
    const { Readability } = require("@mozilla/readability");
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    if (article?.textContent) {
      const cleaned = article.textContent.replace(/\s+/g, " ").trim();
      if (cleaned.length >= 120) return cleaned;
    }
  } catch {
    // fall through
  }
  // Fallback 1: jsdom body text
  try {
    const { JSDOM } = require("jsdom");
    const dom = new JSDOM(html);
    const bodyText = dom.window.document.body?.textContent ?? "";
    const cleaned = bodyText.replace(/\s+/g, " ").trim();
    if (cleaned) return cleaned;
  } catch {
    // fall through
  }
  // Fallback 2: node-html-parser (always works, no jsdom)
  try {
    const { parse } = require("node-html-parser");
    const root = parse(html);
    for (const sel of ["script", "style", "noscript", "nav", "header", "footer", "svg", "iframe", "form"]) {
      for (const el of root.querySelectorAll(sel)) el.remove();
    }
    const body = root.querySelector("body") ?? root;
    const text = body.text.replace(/\s+/g, " ").trim();
    return text || null;
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
