import { prisma } from "../../models/prisma";
import { FetchedCircular, fetchBySources, normalizeUrl } from "../../jobs/regulatory/fetcher";
import type { RegulatorySourceCode } from "../../jobs/regulatory/fetcher";
import { createHash } from "crypto";

export function pdfHashFor(url: string): string {
  return createHash("sha256").update(normalizeUrl(url)).digest("hex").slice(0, 16);
}

export async function ingestCirculars(sources: RegulatorySourceCode[], lookbackDays = 30): Promise<number> {
  const fetched = await fetchBySources(sources);
  const cutoff = new Date(Date.now() - lookbackDays * 24 * 3600 * 1000);
  let inserted = 0;
  for (const f of fetched) {
    if (f.publishedAt && f.publishedAt < cutoff) continue;
    const hash = pdfHashFor(f.sourceUrl);
    try {
      await prisma.regulatoryCircular.upsert({
        where: { sourceUrl: normalizeUrl(f.sourceUrl) },
        create: {
          source: f.source,
          sourceUrl: normalizeUrl(f.sourceUrl),
          title: f.title.slice(0, 500),
          publishedAt: f.publishedAt,
          pdfUrl: f.pdfUrl,
          pdfHash: hash,
          status: "pending",
        },
        update: {
          title: f.title.slice(0, 500),
          publishedAt: f.publishedAt,
          pdfUrl: f.pdfUrl,
        },
      });
      inserted++;
    } catch {}
  }
  return inserted;
}

export async function listCircularsForRun(sources: string[], lookbackDays: number) {
  const cutoff = new Date(Date.now() - lookbackDays * 24 * 3600 * 1000);
  return prisma.regulatoryCircular.findMany({
    where: { source: { in: sources }, publishedAt: { gte: cutoff } },
    orderBy: { publishedAt: "desc" },
    take: 100,
  });
}
