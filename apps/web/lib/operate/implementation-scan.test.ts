// apps/web/lib/operate/implementation-scan.test.ts
// BI-1A1EC5EC. Pure — no filesystem, no database, no index.

import { describe, expect, it } from "vitest";
import {
  detectsBuildIntent,
  findImplementationCandidates,
  renderScanAdvisory,
  salientTerms,
  scorePath,
} from "./implementation-scan";

/** A slice of the real tree, including the file the live miss should have found. */
const REPO = [
  "scripts/build-docs-staleness.mjs",
  "scripts/build-docs-staleness.test.mjs",
  "scripts/check-doc-links.mjs",
  "scripts/check-docs-impact.mjs",
  "scripts/gen-doc-impact.mjs",
  "scripts/measure-doc-staleness-coverage.mjs",
  "scripts/check-module-size.mjs",
  "apps/web/lib/docs/doc-impact.generated.json",
  "apps/web/lib/operate/backlog-ingest.ts",
  "apps/web/lib/demand/dedup.ts",
  "apps/web/lib/finance/po-match.ts",
  "packages/db/src/graph-sync.ts",
  "packages/db/src/doc-impact-graph.ts",
];

describe("the case this exists for", () => {
  it("surfaces the existing detector for the BI that missed it", () => {
    // THE ACCEPTANCE CRITERION. BI-3E5969DF was filed with this title while
    // scripts/build-docs-staleness.mjs already existed. Three backlog sweeps came
    // back clean because they search backlog rows, not source.
    const hits = findImplementationCandidates(
      "Detect semantic doc staleness — prose that drifted while its links still resolve",
      REPO,
      { workType: "feature" },
    );

    expect(hits.map((h) => h.path)).toContain("scripts/build-docs-staleness.mjs");
    // And it should be at or near the top, not buried in the tail.
    expect(hits[0].path).toMatch(/staleness/);
  });
});

describe("detectsBuildIntent", () => {
  it("is true for items proposing to create something", () => {
    expect(detectsBuildIntent("Detect semantic doc staleness")).toBe(true);
    expect(detectsBuildIntent("Add a coverage report for docs")).toBe(true);
    expect(detectsBuildIntent("Project doc edges into the graph mirror")).toBe(true);
  });

  it("is false for a bug, whose subject exists by definition", () => {
    // Telling a timesheet bug report that timesheet code exists is pure noise —
    // that the code exists is the premise of the report.
    expect(
      detectsBuildIntent("Timesheet approval lets any user approve anyone's", "bug"),
    ).toBe(false);
  });

  it("is false when no creation verb is present", () => {
    expect(detectsBuildIntent("Graph explorer opens empty")).toBe(false);
    expect(detectsBuildIntent("Code-graph index is stale")).toBe(false);
  });

  it("does not rely on workType alone", () => {
    // "feature" covers both "add X" and "X is missing a field"; the verb decides.
    expect(detectsBuildIntent("Add doc coverage report", "feature")).toBe(true);
    expect(detectsBuildIntent("Doc coverage report is wrong", "feature")).toBe(false);
  });
});

describe("salientTerms", () => {
  it("drops stopwords, build verbs and short tokens", () => {
    expect(salientTerms("Add a new gate for the doc corpus")).toEqual(["gate", "doc", "corpus"]);
  });

  it("keeps gate/check/guard — they are signal in this codebase", () => {
    // check-*.mjs and *-guard.ts are real naming conventions here, so treating
    // these as noise would blind the scan to the guard family entirely.
    expect(salientTerms("Add a check for retired substrate")).toContain("check");
    expect(salientTerms("Add a guard for module size")).toContain("guard");
  });

  it("stems so plural and -ness forms co-match their filenames", () => {
    expect(salientTerms("staleness")).toEqual(["stale"]);
    expect(salientTerms("Project doc edges")).toContain("edge");
  });

  it("deduplicates while preserving title order", () => {
    expect(salientTerms("Doc impact for doc pages")).toEqual(["doc", "impact", "page"]);
  });
});

describe("scorePath", () => {
  it("weights the filename above directories", () => {
    // The basename is what an author chose to call the thing.
    const inName = scorePath(["stale"], "scripts/build-docs-staleness.mjs");
    const inDir = scorePath(["stale"], "scripts/staleness/report.mjs");
    expect(inName.score).toBeGreaterThan(inDir.score);
  });

  it("rewards breadth, so one loud term cannot outrank two", () => {
    const oneTerm = scorePath(["doc"], "scripts/check-doc-links.mjs");
    const twoTerms = scorePath(["doc", "stale"], "scripts/build-docs-staleness.mjs");
    expect(twoTerms.score).toBeGreaterThan(oneTerm.score);
  });

  it("ignores structural path segments", () => {
    // Otherwise a term like "script" or "package" matches thousands of files.
    expect(scorePath(["script"], "scripts/foo.mjs").score).toBe(0);
    expect(scorePath(["lib", "app"], "apps/web/lib/x.ts").score).toBe(0);
  });
});

describe("defects found by replaying real titles (measure-implementation-scan.mts)", () => {
  it("does not strip -ness down to a fragment", () => {
    // "harness" -> "har" matched hardware/harbor paths. "staleness" -> "stale"
    // must still work, so the rule is a length floor on the remainder, not a
    // blanket retreat.
    expect(salientTerms("benchmark harness")).toContain("harness");
    expect(salientTerms("doc staleness")).toContain("stale");
  });

  it("never reports a file matched on only one term", () => {
    // The entire false-positive population in the first replay: "Create a payroll
    // remittance reconciliation ledger" returned five unrelated files matched on
    // `ledger` alone. One term finds the topic, not the thing.
    const hits = findImplementationCandidates(
      "Create a payroll remittance reconciliation ledger",
      [
        "apps/web/components/finance/TaxLiabilityLedgerCard.tsx",
        "apps/web/components/finance/ReconciliationFeed.tsx",
        "apps/web/components/ops/LocalChangesLedger.tsx",
      ],
      { workType: "feature" },
    );
    expect(hits).toEqual([]);
  });

  it("still fires when two terms genuinely co-occur", () => {
    const hits = findImplementationCandidates(
      "Create a payroll remittance ledger",
      ["apps/web/components/finance/PayrollRemittanceLedger.tsx"],
      { workType: "feature" },
    );
    expect(hits).toHaveLength(1);
    expect(hits[0].matchedTerms.length).toBeGreaterThanOrEqual(2);
  });
});

describe("precision guards", () => {
  it("returns nothing for a single salient term", () => {
    // One term separates topic from thing far too weakly: "doc" alone would
    // return every doc script in the repo.
    expect(findImplementationCandidates("Add doc", REPO, {})).toEqual([]);
  });

  it("returns nothing for a bug report", () => {
    expect(
      findImplementationCandidates("Doc staleness report shows wrong counts", REPO, {
        workType: "bug",
      }),
    ).toEqual([]);
  });

  it("returns nothing when the subject is genuinely absent", () => {
    const hits = findImplementationCandidates(
      "Add a payroll remittance reconciliation ledger",
      REPO,
      { workType: "feature" },
    );
    expect(hits).toEqual([]);
  });

  it("respects the limit and ranks strongest first", () => {
    const hits = findImplementationCandidates("Add doc impact graph edges", REPO, {
      workType: "feature",
      limit: 3,
    });
    expect(hits.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i - 1].score).toBeGreaterThanOrEqual(hits[i].score);
    }
  });

  it("is deterministic — ties break on path, not insertion order", () => {
    const a = findImplementationCandidates("Add doc impact graph edges", REPO, { workType: "feature" });
    const b = findImplementationCandidates("Add doc impact graph edges", [...REPO].reverse(), {
      workType: "feature",
    });
    expect(a).toEqual(b);
  });
});

describe("renderScanAdvisory", () => {
  it("is null when there is nothing to say", () => {
    expect(renderScanAdvisory([])).toBeNull();
  });

  it("asks rather than asserts, and names why a backlog sweep missed it", () => {
    // Asserting "this is a duplicate" on a heuristic this crude would train
    // filers to dismiss it unread — the noise failure BI-3E5969DF warned about.
    const text = renderScanAdvisory([
      { path: "scripts/build-docs-staleness.mjs", matchedTerms: ["doc", "stale"], score: 5 },
    ]);
    expect(text).toContain("confirm this is not already built");
    expect(text).toContain("scripts/build-docs-staleness.mjs");
    expect(text).toContain("not source");
    expect(text).not.toMatch(/\bduplicate\b/i);
  });
});
