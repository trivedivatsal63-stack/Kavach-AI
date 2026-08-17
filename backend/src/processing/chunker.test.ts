import { describe, expect, it } from "vitest";
import { chunkDocument } from "./chunker";

// Regression test for a real, confirmed production failure: the LLP Act's
// definitions section packed ~6 unrelated defined terms into one chunk
// (pdf-parse extracts the whole list as one continuous run, no real newline
// between entries), diluting the "Tribunal" definition enough that it never
// surfaced in retrieval for a "what is Tribunal" query — reproduced,
// diagnosed, and fixed against this exact real text.
const REAL_LLP_ACT_DEFINITIONS = `Gazette, appoint: Provided that different dates may be appointed for different provisions of this Act and any reference in any such provision to the commencement of this Act shall be construed as a reference to the coming into force of that provision. 2. Definitions. —(1) In this Act, unless the context otherwise requires,— (a) "address", in relation to a partner of a limited liability partnership, means his usual residential address; (b) "Appellate Tribunal" means the National Company Law Appellate Tribunal constituted under 2 [section 410] of 3 [the Companies Act, 2013 (18 of 2013)]; (c)  "body  corporate"  means  a  company  as  defined  in 4 [clause  (20)  of  section  2] of 3 [the Companies Act, 2013 (18 of 2013)] and includes  a limited liability partnership registered under this Act; (t) "small limited liability partnership" means a limited liability partnership whose contribution does not exceed forty lakh rupees or such higher amount, not exceeding fifty crore rupees, as may be prescribed;] (u)  "Tribunal"  means  the  National  Company  Law  Tribunal  constituted  under 1 [section  408] of 2 [the Companies Act, 2013 (18 of 2013)]. (2) Words and expressions used and not defined in this Act but defined in the Companies Act, 2013 shall have the meanings respectively assigned to them in that Act.`;

describe("chunkDocument — legal definitions list splitting", () => {
  it("isolates each defined term into its own chunk with an accurate headingPath", () => {
    const chunks = chunkDocument({ text: REAL_LLP_ACT_DEFINITIONS, pageCount: null });

    const tribunal = chunks.find((c) => c.headingPath[0] === "Tribunal");
    expect(tribunal).toBeDefined();
    expect(tribunal!.headingPath).toEqual(["Tribunal"]);
    // Double spaces between some words are a real artifact of the original
    // PDF extraction, preserved verbatim here — matched loosely rather than
    // asserting exact spacing.
    expect(tribunal!.content).toMatch(/National\s+Company\s+Law\s+Tribunal\s+constituted/);
    // Not diluted by neighboring definitions.
    expect(tribunal!.content).not.toContain("Appellate Tribunal");
    expect(tribunal!.content).not.toContain('"address"');
  });

  it("does not drop a definition's body text even when the heading marker only matches a line prefix", () => {
    const chunks = chunkDocument({ text: REAL_LLP_ACT_DEFINITIONS, pageCount: null });
    const appellate = chunks.find((c) => c.headingPath[0] === "Appellate Tribunal");
    expect(appellate).toBeDefined();
    // The regression this guards: buildBlocks treats a detected heading as
    // consuming its whole line, so without splitting the marker onto its
    // own line, everything after "means" on the same source line — the
    // entire definition body — was silently discarded, not just left
    // unsplit.
    expect(appellate!.content).toContain("National Company Law Appellate Tribunal constituted under");
  });

  it("does not misclassify a statute cross-reference like \"(18 of 2013)\" as bibliography citation noise", () => {
    const chunks = chunkDocument({ text: REAL_LLP_ACT_DEFINITIONS, pageCount: null });
    const bodyCorporate = chunks.find((c) => c.headingPath[0] === "body  corporate");
    expect(bodyCorporate).toBeDefined();
    expect(bodyCorporate!.content).toContain("Companies Act, 2013 (18 of 2013)");
  });

  it("still treats an ordinary enumerated proviso as plain content, not a heading", () => {
    // "(a) he has been found..." has no quoted term + "means" — must not be
    // mistaken for a defined-term entry.
    const text = `Partners.—Any individual or body corporate may be a partner in a limited liability partnership: Provided that an individual shall not be capable of becoming a partner of a limited liability partnership, if— (a) he has been found to be of unsound mind by a Court of competent jurisdiction and the finding is in force; (b) he is an undischarged insolvent.`;
    const chunks = chunkDocument({ text, pageCount: null });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].headingPath).toEqual([]);
    expect(chunks[0].content).toContain("unsound mind");
    expect(chunks[0].content).toContain("undischarged insolvent");
  });
});
