import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { extractText } from "./parsers";
import { chunkTabularSheets } from "./tabularChunker";

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const ROW_COUNT = 60;

// Each row's Department/Email/Notes fields are padded long enough that the
// serialized row comfortably exceeds MIN_CHUNK_CHARS on its own, so no two
// rows ever get batched into the same chunk — the row<->chunk mapping stays
// exactly 1:1 and unambiguous for the assertions below.
async function buildWorkbookBuffer(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Employees");
  sheet.addRow(["Name", "Department", "Email", "Notes"]);
  for (let i = 1; i <= ROW_COUNT; i++) {
    sheet.addRow([
      `Employee ${i}`,
      `Department ${((i - 1) % 5) + 1} - Operations And Logistics Division`,
      `employee${i}.marker.unique@example-company-domain.com`,
      `Performance notes for employee number ${i} covering this quarter's review cycle and goals.`,
    ]);
  }
  const buf = await workbook.xlsx.writeBuffer();
  return Buffer.from(buf);
}

describe("XLSX extraction + tabular chunking", () => {
  it("extracts every row with headers", async () => {
    const buffer = await buildWorkbookBuffer();
    const extracted = await extractText(XLSX_MIME, buffer);

    expect(extracted.kind).toBe("tabular");
    if (extracted.kind !== "tabular") return;
    expect(extracted.sheets).toHaveLength(1);
    expect(extracted.sheets[0].name).toBe("Employees");
    expect(extracted.sheets[0].headers).toEqual(["Name", "Department", "Email", "Notes"]);
    expect(extracted.sheets[0].rows).toHaveLength(ROW_COUNT);
  });

  it("round-trips row 50 to its own chunk, independent of the other 59 rows", async () => {
    const buffer = await buildWorkbookBuffer();
    const extracted = await extractText(XLSX_MIME, buffer);
    if (extracted.kind !== "tabular") throw new Error("expected tabular extraction");

    const chunks = chunkTabularSheets(extracted.sheets);

    // 1:1 row-to-chunk mapping — no batching, given how the fixture rows are sized.
    expect(chunks).toHaveLength(ROW_COUNT);
    expect(chunks.every((c) => c.headingPath.length === 1 && c.headingPath[0] === "Employees")).toBe(true);

    const row50Chunk = chunks[49]; // 0-indexed: row 50
    expect(row50Chunk.content).toContain("employee50.marker.unique@");
    // Header context present in every chunk, not just the first.
    expect(row50Chunk.content).toContain("Name:");
    expect(row50Chunk.content).toContain("Department:");

    // The whole point: retrieving row 50 must not require (or leak) rows 1-49 or 51-60.
    expect(row50Chunk.content).not.toContain("employee1.marker.unique@");
    expect(row50Chunk.content).not.toContain("employee49.marker.unique@");
    expect(row50Chunk.content).not.toContain("employee51.marker.unique@");
    expect(row50Chunk.content).not.toContain(`employee${ROW_COUNT}.marker.unique@`);
  });
});
