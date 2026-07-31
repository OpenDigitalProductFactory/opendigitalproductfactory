// apps/web/lib/coworker-record/workforce-summary.test.ts
// EP-COWORKER-RT (coworker-management-consolidation, WS5) — workforce summary rollup guards.

import { describe, it, expect } from "vitest";
import { computeWorkforceSummary } from "./workforce-summary";
import type { RosterRow } from "./roster";

function row(over: Partial<RosterRow> = {}): RosterRow {
  return {
    agentId: "AGT-1",
    slugId: "finance",
    name: "Finance",
    displayName: "Finance",
    kind: "specialist",
    tier: 2,
    valueStream: "operate",
    lifecycleStage: "production",
    plainJob: "Keeps finance work moving.",
    workSearchText: "Monthly close",
    canStartConversation: true,
    area: {
      key: "foundational",
      label: "Platform and back office",
      order: 4,
    },
    areas: [
      {
        key: "foundational",
        label: "Platform and back office",
        order: 4,
      },
    ],
    interaction: { scopes: ["internal-only"], labels: ["Internal only"] },
    availability: {
      state: "available",
      label: "Available for your business type",
      reason: "Explicit support",
      matchLevel: "leaf",
      evidence: [],
    },
    authority: {
      state: "resolved",
      scope: { kind: "default-posture" },
      level: "review-required",
      label: "Acts with review",
      summary: "This coworker acts within limits and a person reviews results.",
      ownerReason: "Review is required.",
      ownerAction: "Review the result after the action runs.",
      winner: {
        source: "agent",
        ref: "AGT-1",
        field: "hitlTierDefault",
        role: "selected-base",
        observedValue: "2",
        normalizedLevel: "review-required",
        detail: "Agent has HITL tier 2",
      },
      evidence: [],
    },
    familyKey: "finance",
    familyLabel: "Finance & Accounting",
    coveragePct: 90,
    jurisdictions: ["us"],
    competencies: ["practitioner"],
    profileBound: true,
    emptyCorpus: false,
    openBlockers: 0,
    deferRate: 0,
    unmapped: false,
    lastActiveAt: null,
    ...over,
  };
}

describe("computeWorkforceSummary", () => {
  it("returns an all-zero summary for no rows", () => {
    const s = computeWorkforceSummary([]);
    expect(s.total).toBe(0);
    expect(s.byKind).toEqual([]);
    expect(s.byFamily).toEqual([]);
    expect(s.familiesRepresented).toBe(0);
    expect(s.health.conversationReady).toBe(0);
    expect(s.naming.needsAttention).toBe(0);
  });

  it("counts total and buckets kind, sorted by count desc", () => {
    const s = computeWorkforceSummary([
      row({ kind: "orchestrator" }),
      row({ kind: "specialist" }),
      row({ kind: "specialist" }),
    ]);
    expect(s.total).toBe(3);
    expect(s.byKind[0]).toEqual({ key: "specialist", label: "Specialist", count: 2 });
    expect(s.byKind[1]).toEqual({ key: "orchestrator", label: "Orchestrator", count: 1 });
  });

  it("buckets families and folds unmapped into one bucket; counts distinct families", () => {
    const s = computeWorkforceSummary([
      row({ familyKey: "finance", familyLabel: "Finance & Accounting", unmapped: false }),
      row({ familyKey: "marketing", familyLabel: "Marketing", unmapped: false }),
      row({ familyKey: null, familyLabel: null, unmapped: true }),
      row({ familyKey: null, familyLabel: null, unmapped: true }),
    ]);
    expect(s.familiesRepresented).toBe(2);
    const unmapped = s.byFamily.find((b) => b.key === "__unmapped__");
    expect(unmapped).toEqual({ key: "__unmapped__", label: "Unmapped", count: 2 });
    // family mix sums to total
    expect(s.byFamily.reduce((n, b) => n + b.count, 0)).toBe(4);
  });

  it("rolls up conversation availability, unmapped roles, blockers, and low coverage", () => {
    const s = computeWorkforceSummary([
      row({ canStartConversation: true, openBlockers: 0, coveragePct: 90 }),
      row({ canStartConversation: false, openBlockers: 2, coveragePct: 90 }),
      row({ unmapped: true, familyKey: null, coveragePct: null }),
      row({ canStartConversation: true, openBlockers: 1, coveragePct: 40 }),
    ]);
    expect(s.health.conversationReady).toBe(3);
    expect(s.health.conversationUnavailable).toBe(1);
    expect(s.health.unmappedRole).toBe(1);
    expect(s.health.withOpenBlockers).toBe(2);
    expect(s.health.openBlockersTotal).toBe(3);
    expect(s.health.lowCoverage).toBe(1); // only the mapped 40% row; unmapped (null) excluded
  });

  it("surfaces naming-health: missing displayName and lingering name suffixes", () => {
    const s = computeWorkforceSummary([
      row({ displayName: "Build Lead" }),
      row({ displayName: "" }),
      row({ displayName: "finance-agent" }),
      row({ displayName: "marketing-specialist" }),
    ]);
    expect(s.naming.missingDisplayName).toBe(1);
    expect(s.naming.suffixInName).toBe(2);
    expect(s.naming.needsAttention).toBe(3);
  });

  it("reports zero naming attention when every coworker has a clean displayName", () => {
    const s = computeWorkforceSummary([
      row({ displayName: "Build Lead" }),
      row({ displayName: "COO" }),
      row({ displayName: "Finance" }),
    ]);
    expect(s.naming.needsAttention).toBe(0);
  });
});
