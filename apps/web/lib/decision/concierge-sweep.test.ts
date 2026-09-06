import { describe, expect, it, vi } from "vitest";

import {
  orderCandidates,
  runConciergeSweep,
  type SweepDeps,
} from "./concierge-sweep";
import type { ConductorOutcome, TriageSubject } from "./triage-conductor";

function subject(interactionId: string, riskTier: string): TriageSubject {
  return {
    interactionRowId: `row-${interactionId}`,
    interactionId,
    profileId: "p",
    question: "q",
    domainClass: "risk-assessment",
    gateKey: null,
    riskTier,
    outcomeType: "escalate",
    resolved: false,
  };
}

function deps(overrides: Partial<SweepDeps> = {}): SweepDeps & { reported: unknown[] } {
  const reported: unknown[] = [];
  return {
    reported,
    candidates: async () => [subject("DI-1", "medium")],
    conduct: vi.fn(
      async (): Promise<ConductorOutcome> => ({
        status: "proposed",
        proposalId: "DRP-1",
        verdict: {} as never,
        uncovered: false,
      }),
    ),
    retireStale: async () => 0,
    report: async (summary) => {
      reported.push(summary);
    },
    ...overrides,
  } as SweepDeps & { reported: unknown[] };
}

describe("orderCandidates", () => {
  it("spends the panel on the most consequential decision first", () => {
    const ordered = orderCandidates([
      subject("DI-b", "medium"),
      subject("DI-a", "critical"),
      subject("DI-c", "high"),
    ]);
    expect(ordered.map((s) => s.riskTier)).toEqual(["critical", "high", "medium"]);
  });

  it("is stable within a risk tier so an old decision is not starved", () => {
    const ordered = orderCandidates([subject("DI-9", "high"), subject("DI-1", "high")]);
    expect(ordered.map((s) => s.interactionId)).toEqual(["DI-1", "DI-9"]);
  });
});

describe("runConciergeSweep", () => {
  it("retires stale drafts before deciding what still needs a panel", async () => {
    const order: string[] = [];
    const d = deps({
      retireStale: async () => {
        order.push("retire");
        return 2;
      },
      candidates: async () => {
        order.push("candidates");
        return [];
      },
    });
    const summary = await runConciergeSweep(d);
    expect(order).toEqual(["retire", "candidates"]);
    expect(summary.retiredStaleProposals).toBe(2);
  });

  it("says plainly when nothing was waiting", async () => {
    const summary = await runConciergeSweep(deps({ candidates: async () => [] }));
    expect(summary.headline).toBe("Nothing was waiting on you.");
    expect(summary.panelled).toBe(0);
  });

  it("never spends more panels than its cap, and REPORTS what it dropped", async () => {
    const many = Array.from({ length: 9 }, (_, i) => subject(`DI-${i}`, "high"));
    const d = deps({ candidates: async () => many });
    const summary = await runConciergeSweep(d, { maxPanels: 3 });

    expect(summary.considered).toBe(9);
    expect(summary.panelled).toBe(3);
    expect(summary.deferredToNextPass).toBe(6);
    expect(d.conduct).toHaveBeenCalledTimes(3);
    expect(summary.headline).toContain("6 more are queued");
  });

  it("counts an unproductive panel by its reason instead of calling it a draft", async () => {
    const d = deps({
      candidates: async () => [subject("DI-1", "high"), subject("DI-2", "high")],
      conduct: async (s) =>
        s.interactionId === "DI-1"
          ? { status: "proposed", proposalId: "DRP-1", verdict: {} as never, uncovered: false }
          : { status: "verdict-refused", detail: "no dissent recorded" },
    });
    const summary = await runConciergeSweep(d);
    expect(summary.proposed).toBe(1);
    expect(summary.unproductive["verdict-refused"]).toBe(1);
    expect(summary.headline).toContain("No draft for: 1 verdict refused");
  });

  it("does not claim drafts when every panel came up short", async () => {
    const d = deps({
      conduct: async () => ({ status: "panel-inconclusive", detail: "could not ground it" }),
    });
    const summary = await runConciergeSweep(d);
    expect(summary.proposed).toBe(0);
    expect(summary.headline).toContain("could not draft an answer");
  });

  it("hands the same numbers to the reporter that it returns", async () => {
    const d = deps();
    const summary = await runConciergeSweep(d);
    expect(d.reported).toEqual([summary]);
  });

  it("spends nothing when the cap is zero", async () => {
    const d = deps({ candidates: async () => [subject("DI-1", "critical")] });
    const summary = await runConciergeSweep(d, { maxPanels: 0 });
    expect(d.conduct).not.toHaveBeenCalled();
    expect(summary.deferredToNextPass).toBe(1);
  });
});
