import { env } from "../../config";
import type { SearchResult } from "./types";

// Self-hosted SearXNG (docker-compose.yml's `searxng` service) — a
// metasearch relay, not our own crawled index: it queries Google/Bing/
// DuckDuckGo/etc. live on every call and returns results, so there is
// nothing to keep fresh or grow in storage on our side. See searxng/
// settings.yml for the `formats: [html, json]` config this depends on
// (JSON is off by default upstream).
export async function searchWeb(
  query: string,
  limit: number
): Promise<SearchResult[]> {
  const url = new URL("/search", env.searxngBaseUrl);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");

  const res = await fetch(url, { method: "GET" });
  if (!res.ok) {
    throw new Error(`SearXNG /search failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as {
    results?: Array<{ title?: unknown; url?: unknown; content?: unknown }>;
  };

  return (data.results ?? [])
    .filter(
      (r): r is { title: string; url: string; content?: string } =>
        typeof r.title === "string" && typeof r.url === "string"
    )
    .slice(0, limit)
    .map((r) => ({
      title: r.title,
      url: r.url,
      snippet: typeof r.content === "string" ? r.content : "",
    }));
}
