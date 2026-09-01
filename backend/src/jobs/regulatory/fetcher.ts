import { JSDOM } from "jsdom";

export type RegulatorySourceCode = "SEBI" | "RBI" | "NSE" | "MCA";

export interface FetchedCircular {
  source: RegulatorySourceCode;
  sourceUrl: string;
  title: string;
  publishedAt: Date | null;
  pdfUrl: string | null;
}

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://www.sebi.gov.in/",
};

const SEBI_HOMEPAGE = "https://www.sebi.gov.in/sebiweb/home/HomeAction.do?doDisplay=yes";
const SEBI_ENDPOINTS: Record<string, string> = {
  SEBI_GAZETTE: "https://www.sebi.gov.in/sebiweb/home/HomeAction.do?doListing=yes&sid=1&ssid=82&smid=0",
  SEBI_MASTER: "https://www.sebi.gov.in/sebiweb/home/HomeAction.do?doListing=yes&sid=1&ssid=6&smid=0",
  SEBI_CIRCULARS: "https://www.sebi.gov.in/sebiweb/home/HomeAction.do?doListing=yes&sid=1&ssid=7&smid=0",
  SEBI_REG: "https://www.sebi.gov.in/sebiweb/home/HomeAction.do?doListingLegal=yes&sid=1&ssid=3&mid=0",
};
const RBI_URL = "https://www.rbi.org.in/Scripts/NotificationUser.aspx";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function safeFetch(url: string, opts: RequestInit = {}, retries = 2): Promise<string> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        ...opts,
        headers: { ...BROWSER_HEADERS, ...(opts.headers as Record<string, string>) },
        signal: AbortSignal.timeout(30_000),
      } as RequestInit);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return await res.text();
    } catch (e) {
      if (attempt === retries) throw e;
      await sleep(1500 * (attempt + 1));
    }
  }
  throw new Error("fetch failed");
}

export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.protocol = "https:";
    u.hostname = u.hostname.toLowerCase();
    if (u.pathname.endsWith("/") && u.pathname.length > 1) u.pathname = u.pathname.slice(0, -1);
    u.hash = "";
    // keep search (Id param) for RBI/SEBI — stripping it collapses all notifications to same URL
    return u.toString();
  } catch {
    return url.trim();
  }
}

async function warmSebiSession(): Promise<void> {
  try {
    await fetch(SEBI_HOMEPAGE, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(15000) }).catch(() => {});
    await sleep(500 + Math.random() * 1000);
  } catch {}
}

function parseDateText(s: string): Date | null {
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d;
  // Try dd-MMM-yyyy
  const m = s.match(/(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})/i);
  if (m) {
    const dt = new Date(`${m[2]} ${m[1]}, ${m[3]}`);
    if (!isNaN(dt.getTime())) return dt;
  }
  return null;
}

async function fetchSebiList(url: string, source: RegulatorySourceCode): Promise<FetchedCircular[]> {
  await warmSebiSession();
  const html = await safeFetch(url);
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const rows = doc.querySelectorAll("table#sample_1 tbody tr");
  const out: FetchedCircular[] = [];
  rows.forEach((tr) => {
    const tds = tr.querySelectorAll("td");
    if (tds.length < 2) return;
    const dateText = tds[0]?.textContent?.trim() ?? "";
    const anchor = tds[1]?.querySelector("a");
    const title = anchor?.textContent?.trim() || tds[1]?.textContent?.trim() || "";
    const href = anchor?.getAttribute("href")?.trim() || "";
    if (!title || !href) return;
    const absolute = href.startsWith("http") ? href : new URL(href, "https://www.sebi.gov.in").toString();
    const pdfUrl = absolute.toLowerCase().endsWith(".pdf") ? absolute : null;
    const sourceUrl = normalizeUrl(absolute);
    out.push({ source, sourceUrl, title, publishedAt: parseDateText(dateText), pdfUrl });
  });
  // Sort desc by publishedAt, keep all rows (fix for AmitC-DC head(1) limitation)
  out.sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0));
  return out;
}

export async function fetchSebiGazette(): Promise<FetchedCircular[]> {
  return fetchSebiList(SEBI_ENDPOINTS.SEBI_GAZETTE, "SEBI");
}
export async function fetchSebiMaster(): Promise<FetchedCircular[]> {
  return fetchSebiList(SEBI_ENDPOINTS.SEBI_MASTER, "SEBI");
}
export async function fetchSebiCirculars(): Promise<FetchedCircular[]> {
  return fetchSebiList(SEBI_ENDPOINTS.SEBI_CIRCULARS, "SEBI");
}
export async function fetchSebiRegulations(): Promise<FetchedCircular[]> {
  return fetchSebiList(SEBI_ENDPOINTS.SEBI_REG, "SEBI");
}

export async function fetchRbiNotifications(): Promise<FetchedCircular[]> {
  const html = await safeFetch(RBI_URL, { headers: { ...BROWSER_HEADERS, Referer: "https://www.rbi.org.in/" } });
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const table = doc.querySelector("table.tablebg");
  if (!table) return [];
  const rows = table.querySelectorAll("tr");
  const out: FetchedCircular[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const dateB = row.querySelector("td.tableheader b");
    if (!dateB) continue;
    const dateText = dateB.textContent?.trim() ?? "";
    const next = rows[i + 1];
    if (!next) continue;
    const tds = next.querySelectorAll("td");
    if (tds.length < 2) { i++; continue; }
    // col 0: title/amendment link, col 1: rbidocs PDF link
    const titleAnchor = tds[0]?.querySelector("a");
    const title = (titleAnchor?.textContent?.trim() || tds[0]?.textContent?.trim() || "").replace(/\s+/g, " ").trim();
    const href = titleAnchor?.getAttribute("href")?.trim() || "";
    let amendmentLink: string | null = null;
    if (href) {
      let abs = href;
      if (!abs.startsWith("http")) {
        if (abs.includes("NotificationUser.aspx") && !abs.startsWith("/Scripts")) abs = "/Scripts/" + abs.replace(/^\//, "");
        else if (!abs.startsWith("/")) abs = "/" + abs;
        abs = "https://www.rbi.org.in" + abs;
      }
      amendmentLink = abs;
    }
    const pdfAnchor = tds[1]?.querySelector('a[href*=".pdf"]');
    let pdfUrl: string | null = null;
    if (pdfAnchor) {
      const raw = pdfAnchor.getAttribute("href")?.trim() || "";
      if (raw) pdfUrl = raw.startsWith("http") ? raw : `https://rbidocs.rbi.org.in${raw.startsWith("/") ? "" : "/"}${raw}`;
    }
    if (!title) { i++; continue; }
    // Prefer dedicated PDF as sourceUrl so click goes to PDF, fallback to amendment page
    const sourceUrl = pdfUrl ? normalizeUrl(pdfUrl) : amendmentLink ? normalizeUrl(amendmentLink) : null;
    if (!sourceUrl) { i++; continue; }
    const dt = parseDateText(dateText);
    out.push({ source: "RBI", sourceUrl, title, publishedAt: dt, pdfUrl: pdfUrl ?? amendmentLink });
    i++;
  }
  out.sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0));
  return out;
}

export async function fetchBySources(sources: RegulatorySourceCode[]): Promise<FetchedCircular[]> {
  const tasks: Promise<FetchedCircular[]>[] = [];
  if (sources.includes("SEBI")) {
    tasks.push(fetchSebiGazette(), fetchSebiMaster(), fetchSebiCirculars(), fetchSebiRegulations());
  }
  if (sources.includes("RBI")) tasks.push(fetchRbiNotifications());
  // NSE/MCA stubs return empty until implemented
  if (sources.includes("NSE") || sources.includes("MCA")) {
    // intentional no-op
  }
  const results = await Promise.allSettled(tasks);
  const all: FetchedCircular[] = [];
  for (const r of results) if (r.status === "fulfilled") all.push(...r.value);
  return all;
}
