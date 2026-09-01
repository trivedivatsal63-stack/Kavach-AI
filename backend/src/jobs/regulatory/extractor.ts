import { JSDOM } from "jsdom";

export async function extractTextFromUrl(url: string, pdfUrl?: string | null): Promise<string | null> {
  const target = pdfUrl && pdfUrl.toLowerCase().endsWith(".pdf") ? pdfUrl : url;
  try {
    const res = await fetch(target, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36",
        Accept: target.endsWith(".pdf") ? "application/pdf,*/*" : "text/html,*/*",
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("pdf") || target.toLowerCase().endsWith(".pdf")) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.slice(0, 4).toString() !== "%PDF") return null;
      // Lazy load pdf-parse to avoid bundling issues
      const pdfParse = (await import("pdf-parse")).default as unknown as (b: Buffer) => Promise<{ text: string; numpages: number }>;
      try {
        const data = await pdfParse(buf);
        const text = data.text?.trim();
        if (!text || text.length < 100) return null;
        // cap 5 pages worth ~ 8000 chars safe for 8192 context
        return text.slice(0, 15000);
      } catch {
        return null;
      }
    } else {
      const html = await res.text();
      const dom = new JSDOM(html);
      const doc = dom.window.document;
      // iframe resolve
      const iframe = doc.querySelector("iframe");
      if (iframe) {
        const src = iframe.getAttribute("src");
        if (src) {
          let iframeUrl = src;
          if (iframeUrl.includes("?file=")) {
            try {
              const u = new URL(iframeUrl, target);
              iframeUrl = u.searchParams.get("file") || iframeUrl;
            } catch {}
          }
          if (!iframeUrl.startsWith("http")) iframeUrl = new URL(iframeUrl, target).toString();
          return extractTextFromUrl(iframeUrl, null);
        }
      }
      // Try content selectors
      const selectors = ["article", ".content-display", "#content", ".tablebg", "main", ".entry-content"];
      for (const sel of selectors) {
        const el = doc.querySelector(sel);
        if (el && (el.textContent?.trim().length ?? 0) > 200) return el.textContent!.trim().slice(0, 15000);
      }
      doc.querySelectorAll("header, footer, nav, script, style").forEach((e) => e.remove());
      return doc.body.textContent?.trim().slice(0, 15000) ?? null;
    }
  } catch {
    return null;
  }
}
