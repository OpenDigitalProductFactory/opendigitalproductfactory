import { describe, expect, it } from "vitest";

import { computeTrustStateFromLedger } from "./trust-state";

describe("computeTrustStateFromLedger", () => {
  it("aggregates reconciled ledger entries for one trust triple", () => {
    const state = computeTrustStateFromLedger({
      agentId: "build-specialist",
      activityType: "work-pattern.review",
      riskClass: "internal-reversible",
      currentLevel: "propose",
      rows: [
        ...Array.from({ length: 5 }, (_, index) => ({
          agreement: true,
          observedAt: new Date(`2026-06-28T10:0${index}:00.000Z`),
        })),
        ...Array.from({ length: 5 }, (_, index) => ({
          agreement: false,
          observedAt: new Date(`2026-06-28T11:0${index}:00.000Z`),
        })),
        { agreement: null, observedAt: new Date("2026-06-28T12:00:00.000Z") },
      ],
    });

    expect(state.window).toEqual({ samples: 10, agreements: 5 });
    expect(state.agreementRate).toBe(0.5);
    expect(state.latestObservedAt?.toISOString()).toBe("2026-06-28T12:00:00.000Z");
    expect(state.recommendation).toMatchObject({
      action: "demote",
      from: "propose",
      to: "shadow",
    });
  });

  it("threads regulatory ceilings into the trust recommendation", () => {
    const state = computeTrustStateFromLedger({
      agentId: "finance-agent",
      activityType: "invoice.send",
      riskClass: "read-only",
      currentLevel: "propose",
      regulatoryCeiling: "propose",
      rows: Array.from({ length: 20 }, (_, index) => ({
        agreement: true,
        observedAt: new Date(`2026-06-28T12:${String(index).padStart(2, "0")}:00.000Z`),
      })),
    });

    expect(state.window).toEqual({ samples: 20, agreements: 20 });
    expect(state.regulatoryCeiling).toBe("propose");
    expect(state.recommendation).toMatchObject({
      action: "hold",
      level: "propose",
    });
    expect(state.recommendation.reason).toMatch(/regulatory ceiling/);
  });

  it("holds when the ledger has no resolved agreement evidence yet", () => {
    const state = computeTrustStateFromLedger({
      agentId: "review-agent",
      activityType: "work-pattern.draft",
      riskClass: "internal-reversible",
      rows: [
        { agreement: null, observedAt: "2026-06-28T09:00:00.000Z" },
        { agreement: null, observedAt: "2026-06-28T10:00:00.000Z" },
      ],
    });

    expect(state.currentLevel).toBe("shadow");
    expect(state.window).toEqual({ samples: 0, agreements: 0 });
    expect(state.agreementRate).toBeNull();
    expect(state.latestObservedAt?.toISOString()).toBe("2026-06-28T10:00:00.000Z");
    expect(state.recommendation).toMatchObject({
      action: "hold",
      level: "shadow",
    });
    expect(state.recommendation.reason).toMatch(/samples/);
  });
});
