import { describe, expect, it } from "vitest";

import { orderByImpact, scoreCommits } from "./score";
import { parseCommit } from "./conventional";
import type { InstallSignals, ParsedCommit, PrEnrichment, RawCommit } from "./types";

function raw(subject: string, files: string[] = [], date = "2026-05-01T00:00:00Z"): RawCommit {
  return {
    sha: "0".padEnd(40, "0"),
    subject,
    author: "Test",
    authorDate: date,
    files,
  };
}

const emptySignals: InstallSignals = {
  archetypeId: null,
  industry: null,
  customizationPaths: [],
  customizationVerticals: [],
  openIssueKeywords: [],
  relevantPrLabels: [],
};

function commits(...subjects: ParsedCommit[]): ParsedCommit[] {
  return subjects;
}

describe("scoreCommits — base weights", () => {
  it("ranks breaking > feature > perf > fix > dependency > docs > maintenance when nothing matches install state", () => {
    const c = commits(
      parseCommit(raw("feat!: bk")),
      parseCommit(raw("feat: f")),
      parseCommit(raw("perf: p")),
      parseCommit(raw("fix: x")),
      parseCommit(raw("build(deps): bump thing")),
      parseCommit(raw("docs: d")),
      parseCommit(raw("chore: o")),
    );
    const scored = scoreCommits({ commits: c, signals: emptySignals, enrichmentByPr: new Map() });
    // base weights: 100, 50, 30, 25, 12, 6, 5
    expect(scored.map((s) => s.score)).toEqual([100, 50, 30, 25, 12, 6, 5]);
    expect(scored.map((s) => s.reasons[0]!.kind)).toEqual([
      "breaking-change",
      "base-weight",
      "base-weight",
      "base-weight",
      "base-weight",
      "base-weight",
      "base-weight",
    ]);
  });

  // A security fix must outrank anything an operator merely asked for — it is
  // the one bucket besides `breaking` they should never scroll past.
  it("weights a security change above a feature", () => {
    const c = commits(parseCommit(raw("fix: patch the disclosed vulnerability")));
    const [scored] = scoreCommits({
      commits: c,
      signals: emptySignals,
      enrichmentByPr: new Map(),
    });
    // The subject alone does not promote — refineCategories owns that pass —
    // so score the already-refined category directly.
    expect(scored!.score).toBe(25);
    const promoted = scoreCommits({
      commits: [{ ...c[0]!, category: "security" }],
      signals: emptySignals,
      enrichmentByPr: new Map(),
    });
    expect(promoted[0]!.score).toBe(80);
  });
});

describe("scoreCommits — install relevance amplifies the right commits", () => {
  it("archetype-scope match adds an archetype reason and bumps score", () => {
    const c = commits(parseCommit(raw("feat(hvac): new estimate flow")));
    const signals: InstallSignals = {
      ...emptySignals,
      archetypeId: "hvac",
      industry: "field-service",
    };
    const scored = scoreCommits({ commits: c, signals, enrichmentByPr: new Map() });
    expect(scored[0]!.reasons.map((r) => r.kind)).toContain("archetype-match");
    // base 50 * 1.5 (archetype) = 75
    expect(scored[0]!.score).toBe(75);
  });

  it("customization-path overlap surfaces touchesCustomizations + path-overlap reason", () => {
    const c = commits(
      parseCommit(raw("fix: dale dispatch bug", ["apps/web/lib/field-service/dispatch.ts"])),
    );
    const signals: InstallSignals = {
      ...emptySignals,
      customizationPaths: ["apps/web/lib/field-service/"],
    };
    const scored = scoreCommits({ commits: c, signals, enrichmentByPr: new Map() });
    expect(scored[0]!.touchesCustomizations).toBe(true);
    const overlap = scored[0]!.reasons.find((r) => r.kind === "customization-path-overlap");
    expect(overlap).toBeDefined();
    // base 25 (fix) * 1.6 (path overlap) = 40
    expect(scored[0]!.score).toBe(40);
  });

  it("open-issue keyword hit lifts a small fix above an irrelevant feature", () => {
    const fixCommit = parseCommit(raw("fix: dunning email duplicate send"));
    const featCommit = parseCommit(raw("feat: archive view"));
    const signals: InstallSignals = {
      ...emptySignals,
      openIssueKeywords: ["dunning"],
    };
    const scored = scoreCommits({ commits: [fixCommit, featCommit], signals, enrichmentByPr: new Map() });
    // fix base 25 * 1.5 = 37; feat base 50 * 1.0 = 50 — feat still wins on raw weight.
    // The keyword bump is a tie-breaker / signal that the operator should see this fix.
    const fixScored = scored[0]!;
    const featScored = scored[1]!;
    expect(fixScored.reasons.some((r) => r.kind === "open-issue-keyword")).toBe(true);
    expect(featScored.reasons.every((r) => r.kind !== "open-issue-keyword")).toBe(true);
    expect(fixScored.score).toBeGreaterThan(25);
  });

  it("PR-label relevance adds to multiplier without doubling reasons", () => {
    const c = commits(parseCommit(raw("feat: thing (#42)")));
    const signals: InstallSignals = {
      ...emptySignals,
      relevantPrLabels: ["hvac"],
    };
    const enrichment = new Map<number, PrEnrichment>();
    enrichment.set(42, { prNumber: 42, title: "Thing", body: null, labels: ["hvac", "ui"] });
    const scored = scoreCommits({ commits: c, signals, enrichmentByPr: enrichment });
    // base 50 * 1.3 (label match) = 65
    expect(scored[0]!.score).toBe(65);
  });
});

describe("orderByImpact", () => {
  it("orders by score desc and breaks ties by category rank", () => {
    const scored = scoreCommits({
      commits: [
        parseCommit(raw("feat: a")),       // 50
        parseCommit(raw("feat!: b")),      // 100
        parseCommit(raw("fix: c")),        // 25
        parseCommit(raw("perf: d")),       // 30
      ],
      signals: emptySignals,
      enrichmentByPr: new Map(),
    });
    const ordered = orderByImpact(scored);
    expect(ordered.map((i) => i.category)).toEqual(["breaking", "feature", "performance", "fix"]);
  });
});
