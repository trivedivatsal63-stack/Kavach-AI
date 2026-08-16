# RAG accuracy improvement — format completeness + accuracy parity

## Goal (as stated, 2026-08-14)

A user can upload any document type — PDF, spreadsheet, presentation — of any difficulty level, from a simple one-pager to a dense 300-400 page document (e.g. an Indian law act, or heavy study material), and get **equally accurate answers regardless of format or complexity.** Not "works for easy documents" — parity.

## Verified current state (read directly from `backend/src/processing/parsers.ts` and `chunker.ts`, not assumed)

- **Format support today:** PDF, DOCX, XLSX, TXT, MD. **PPTX (presentations) is not supported at all** — not in `ALLOWED_UPLOAD_MIMES`, no parser exists. A `.pptx` upload is rejected outright.
- **Structure awareness is format-dependent, and this is the root cause of the accuracy gap:**
  - **DOCX** gets *real* structure — mammoth converts to HTML, so headings/tables/lists are known with certainty (`chunkStructuredBlocks`).
  - **PDF, TXT, MD** all fall back to a regex-heuristic path (`chunkDocument`) that *guesses* structure from flat text: Markdown `#`, dot-numbered headings (`1.`, `2.1`) only when standalone or ending in `:`, and short ALL-CAPS lines. This is measurably weaker, and gets weaker as a document's structure gets more complex.
- **Confirmed specific gap:** the heading regex has **no pattern for parenthesized sub-clause numbering** — `(1)`, `(a)`, `(i)` — which is the actual structural convention of Indian statutes (Section → sub-section → clause → sub-clause). Content inside a section becomes an undifferentiated character-counted blob; a chunk boundary can land mid-clause.
- **This is not hypothetical** — it's very likely the same mechanism behind the LLP Act retrieval gaps already found and left unfixed earlier in this project (correct "Tribunal" definition losing to a similarly-worded wrong section).
- PDF chunks also carry no page number (`page: null` hardcoded on the regex path — `pdf-parse` gives no per-page boundaries), weakening citation quality relative to DOCX.

## The layered fix — and an honest accounting of what each layer does and doesn't solve

Confirmed directly with the user: **no single layer below is "the fix" on its own.** True parity needs all of them; each closes a different, non-overlapping failure mode.

### 1. Real PDF structure extraction (font-size/weight + embedded outline/bookmarks)
Replaces blank-line/colon guessing with the document's actual visual structure — font size/weight per text run, and the bookmark/outline tree many official Act PDFs and Word-generated study material already embed.
- **Solves:** reliable *section-level* heading detection — the single most valuable upgrade, gets PDF close to DOCX-level reliability for well-authored documents.
- **Does not solve:** anything below.

### 2. Regex clause-numbering patch (parenthesized sub-clauses)
Extend `detectHeading()` to recognize `(1)`, `(a)`, `(i)` as heading levels, layered *inside* whatever section boundary layer 1 finds.
- **Solves:** the specific Indian-law clause-splitting problem — this layer is still needed even with layer 1, since sub-clauses are never font-differentiated or fine-grained enough to appear in an outline/bookmark tree.
- Contained, scoped change to one function. Estimated ~1–2 hrs.

### 3. Multi-column layout handling
Textbooks/study material frequently use two-column pages. Linear text extraction can silently interleave text from both columns out of order, corrupting chunking regardless of how good heading detection is. Needs layout-aware extraction (reading by column, using text position coordinates) rather than raw reading order.
- **New risk, not previously flagged** — surfaced specifically while reasoning through what font/outline extraction does *not* cover.

### 4. Table detection inside PDFs
Font/outline extraction gives headings, not tables. Recognizing rows/columns from a PDF requires text-position/alignment analysis — a different technique entirely. Needed for schedules, comparison tables, and appendix tables common in both legal documents and study material.

### 5. OCR fallback for scanned PDFs
No text layer means no font metadata and (usually) no real outline either — layers 1–4 give zero benefit on a scan. Already tracked as item 12 in `remaining.md`; listed here because it's part of the same overall accuracy-parity goal.

### 6. PPTX parser
Wholly separate from all of the above — presentations aren't PDFs. Likely *more* tractable than PDF structure work, since slide titles and bullet placeholders are clearer inherent structure to begin with.

## Relationship to `remaining.md`

`remaining.md` covers the broader security + RAG-quality backlog (reranking, query rewriting, eval harness, contextual chunking, faithfulness checking, document versioning, OCR). This file is the detailed breakdown of one item from that goal — actually achieving **uniform document-parsing accuracy** — since it turned out to be several genuinely separate technical problems wearing one trenchcoat, not a single fix.

## Suggested sequencing

1. Layer 1 (PDF structure extraction) + Layer 2 (clause-numbering patch) together — these two directly address the exact failure mode already found and verified.
2. Layer 6 (PPTX) — closes the format-completeness gap, largely independent of the PDF work above.
3. Layers 3–5 (multi-column, tables, OCR) — real, but treat as follow-ups once 1/2/6 are in and re-verified against a real complex document.

Nothing in this file has been implemented yet.
