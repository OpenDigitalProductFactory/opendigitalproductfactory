import { describe, expect, it } from "vitest";

import {
  FILING_DUPLICATE_THRESHOLD,
  findDuplicateCandidates,
  renderFilingDuplicateAdvisory,
} from "@/lib/demand/dedup";

/**
 * The pair this feature exists for (BI-3722E9A1), as actually filed on
 * 2026-09-12. Session 156da776 spent an hour diagnosing spurious host-cpu-high
 * pool closures and filed the first; PR #5334 had already measured the same
 * defect with stronger evidence under the second. Neither saw the other until a
 * manual overlap check, after the investigation was already spent.
 *
 * Kept verbatim rather than paraphrased: the value of this fixture is that it
 * is a real pair a real threshold had to catch, not one written to pass.
 */
const FILED = {
  itemId: "BI-91B1C23D",
  title:
    "A running local-CI gate is destroyed when an unrelated process allocates: admission does not reserve headroom for a model load that arrives mid-run",
  body: "host-memory-low fences a lease that is already running. Observed: the pool closed on host-cpu-high at 24% real CPU with 26 GB free.",
} as const;

const EXISTING = {
  itemId: "BI-48F42581",
  title:
    "Local-CI admission opened and closed the pool on a number that is not CPU: measure CPU to admit gates, and record the observation the decision used",
  body: "Load average is a one-minute-smoothed count of runnable plus uninterruptible-IO tasks. Using it as a utilization percentage is wrong in both directions.",
  status: "in-progress",
} as const;

describe("the advisory speaks plainly and never asserts", () => {
  it("names each candidate with its status and the signal that found it", () => {
    const advisory = renderFilingDuplicateAdvisory([
      { itemId: "BI-48F42581", title: "Measure CPU to admit gates", similarity: 0.71, status: "in-progress", matchedBy: "semantic" },
      { itemId: "BI-FFCFCCE0", title: "A late starvation event must not withdraw a PASS", similarity: 0.63, status: "done", matchedBy: "both" },
    ]);
    expect(advisory).toContain("BI-48F42581 [in-progress]");
    expect(advisory).toContain("(semantic)");
    expect(advisory).toContain("BI-FFCFCCE0 [done]");
    expect(advisory).toContain("(both)");
    expect(advisory).toContain("absorb rather than re-diagnose");
    // The wording contract the sibling implementation-scan advisory settled: a
    // similarity score cannot tell the same defect from an adjacent one.
    expect(advisory).toContain("If this is genuinely a different defect");
    expect(advisory).not.toMatch(/\bis a duplicate\b/i);
  });

  it("says nothing when there is nothing to say", () => {
    expect(renderFilingDuplicateAdvisory([])).toBeNull();
  });

  it("does not fire on two genuinely distinct items", () => {
    expect(
      findDuplicateCandidates(
        { itemId: "BI-NEW", title: "Seed the archetype stance bank for pet rescue", body: "Per-archetype WWWD defaults" },
        [{ itemId: "BI-OTHER", title: "Re-freeze the perspectives route budget baseline", body: "UX sweep" }],
        FILING_DUPLICATE_THRESHOLD,
      ),
    ).toEqual([]);
  });
});

/**
 * Why this feature needs two signals rather than one.
 *
 * The lexical score compares words. These two items are the same subsystem and
 * share almost no vocabulary, so no threshold worth running catches them:
 * lowering it until this pair matched would fire constantly across a
 * 1,300-item open backlog and train filers to skip the line, which is the
 * failure mode the advisory exists to avoid.
 */
describe("what each signal can and cannot catch", () => {
  it("lexical matching misses the observed pair, and the fixture records the miss", () => {
    expect(findDuplicateCandidates(FILED, [EXISTING], FILING_DUPLICATE_THRESHOLD)).toEqual([]);
    const loose = findDuplicateCandidates(FILED, [EXISTING], 0.2);
    expect(loose[0]?.itemId).toBe("BI-48F42581");
    expect(loose[0]?.similarity).toBeLessThan(FILING_DUPLICATE_THRESHOLD);
  });

  it("lexical matching still earns its place on a reworded restatement", () => {
    const reworded = {
      itemId: "BI-REWORD",
      title:
        "Local-CI admission closed the pool on a number that is not CPU, so measure CPU to admit gates",
      body: "Load average is not a utilization percentage.",
    };
    const hits = findDuplicateCandidates(reworded, [EXISTING], FILING_DUPLICATE_THRESHOLD);
    expect(hits[0]?.itemId).toBe("BI-48F42581");
  });
});

/**
 * A search that could not run is not a clean result. AGENTS.md §4 states this
 * for gates; an advisory that silently degrades teaches the same wrong lesson,
 * so the degraded case is surfaced rather than swallowed.
 */
describe("a search that could not run says so", () => {
  it("reports the degraded state even with no candidates to show", () => {
    const advisory = renderFilingDuplicateAdvisory([], "embeddings deferred while local CI holds host capacity");
    expect(advisory).toContain("Meaning-based matching did not run");
    expect(advisory).toContain("embeddings deferred");
    expect(advisory).toContain("only shared wording was compared");
  });

  it("carries the degraded note alongside candidates the other signal did find", () => {
    const advisory = renderFilingDuplicateAdvisory(
      [{ itemId: "BI-X", title: "Something similar", similarity: 0.8, status: "open", matchedBy: "lexical" }],
      "the embedding step failed",
    );
    expect(advisory).toContain("BI-X [open]");
    expect(advisory).toContain("Meaning-based matching did not run");
  });

  it("stays silent when the search ran and found nothing", () => {
    expect(renderFilingDuplicateAdvisory([], null)).toBeNull();
  });
});
