// apps/web/lib/coworker-record/roster-filter.test.ts
// EP-AI-WORKFORCE-001 (HRIS surface) — roster filter predicate guards.

import { describe, it, expect } from "vitest";
import { matchesFilters, isCoverageGap, EMPTY_FILTERS } from "./roster-filter";
import type { RosterRow } from "./roster";

function row(over: Partial<RosterRow> = {}): RosterRow {
  return {
    agentId: "AGT-1",
    slugId: "finance-agent",
    name: "Finance",
    tier: 2,
    valueStream: "operate",
    lifecycleStage: "production",
    familyKey: "finance",
    familyLabel: "Finance",
    coveragePct: 90,
    jurisdictions: ["us", "global"],
    competencies: ["practitioner"],
    profileBound: true,
    emptyCorpus: false,
    providerHealthy: true,
    openBlockers: 0,
    deferRate: 0,
    unmapped: false,
    ...over,
  };
}

describe("isCoverageGap", () => {
  it("flags unmapped, empty corpus, and sub-80% coverage", () => {
    expect(isCoverageGap(row({ unmapped: true, familyKey: null, coveragePct: null }))).toBe(true);
    expect(isCoverageGap(row({ emptyCorpus: true }))).toBe(true);
    expect(isCoverageGap(row({ coveragePct: 50 }))).toBe(true);
    expect(isCoverageGap(row({ coveragePct: 90 }))).toBe(false);
  });
});

describe("matchesFilters", () => {
  it("passes everything with empty filters", () => {
    expect(matchesFilters(row(), EMPTY_FILTERS)).toBe(true);
  });

  it("filters by family, jurisdiction, competency, lifecycle", () => {
    expect(matchesFilters(row(), { ...EMPTY_FILTERS, family: "finance" })).toBe(true);
    expect(matchesFilters(row(), { ...EMPTY_FILTERS, family: "marketing" })).toBe(false);
    expect(matchesFilters(row(), { ...EMPTY_FILTERS, jurisdiction: "us" })).toBe(true);
    expect(matchesFilters(row(), { ...EMPTY_FILTERS, jurisdiction: "eu" })).toBe(false);
    expect(matchesFilters(row(), { ...EMPTY_FILTERS, competency: "expert" })).toBe(false);
    expect(matchesFilters(row(), { ...EMPTY_FILTERS, lifecycle: "retirement" })).toBe(false);
  });

  it("coverageGap filter excludes healthy rows and keeps gaps", () => {
    expect(matchesFilters(row({ coveragePct: 95 }), { ...EMPTY_FILTERS, coverageGap: true })).toBe(false);
    expect(matchesFilters(row({ unmapped: true }), { ...EMPTY_FILTERS, coverageGap: true })).toBe(true);
  });
});
