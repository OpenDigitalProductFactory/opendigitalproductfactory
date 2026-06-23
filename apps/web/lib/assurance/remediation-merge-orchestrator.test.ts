import { describe, expect, it, vi } from "vitest";
import {
  runRemediationMergeGate,
  type MergeGateAdapters,
  type PrReadiness,
  type ReadyRemediationPR,
} from "./remediation-merge-orchestrator";

function pr(overrides: Partial<ReadyRemediationPR> = {}): ReadyRemediationPR {
  return {
    buildId: "FB-1",
    buildPk: "cuid-1",
    backlogItemId: "BI-1",
    prNumber: 100,
    title: "Remediate: hono",
    fromVersion: "4.12.19",
    toVersion: "4.12.25",
    ...overrides,
  };
}

const allGreen: PrReadiness = { ciGreen: true, cooldownMet: true, osvClean: true, hasConflict: false };

function adapters(
  prs: ReadyRemediationPR[],
  readiness: PrReadiness,
  actuationEnabled: boolean,
): MergeGateAdapters & {
  armAutoMerge: ReturnType<typeof vi.fn>;
  escalate: ReturnType<typeof vi.fn>;
} {
  return {
    listReadyRemediationPRs: vi.fn(async () => prs),
    getReadiness: vi.fn(async () => readiness),
    armAutoMerge: vi.fn(async () => undefined),
    escalate: vi.fn(async () => undefined),
    actuationEnabled,
  };
}

describe("runRemediationMergeGate", () => {
  it("does nothing for a zero budget", async () => {
    const a = adapters([pr()], allGreen, true);
    const r = await runRemediationMergeGate({ adapters: a, budget: 0 });
    expect(r.processed).toBe(0);
    expect(a.listReadyRemediationPRs).not.toHaveBeenCalled();
  });

  it("arms auto-merge for a green patch when actuation is enabled", async () => {
    const a = adapters([pr()], allGreen, true);
    const r = await runRemediationMergeGate({ adapters: a, budget: 5 });
    expect(r).toMatchObject({ processed: 1, merged: 1, escalated: 0, dryRun: 0 });
    expect(a.armAutoMerge).toHaveBeenCalledTimes(1);
    expect(a.escalate).not.toHaveBeenCalled();
  });

  it("dark-runs (records, does not actuate) when actuation is disabled", async () => {
    const a = adapters([pr()], allGreen, false);
    const r = await runRemediationMergeGate({ adapters: a, budget: 5 });
    expect(r).toMatchObject({ processed: 1, merged: 0, dryRun: 1 });
    expect(a.armAutoMerge).not.toHaveBeenCalled();
    expect(r.outcomes[0]?.reason).toContain("dark");
  });

  it("escalates a minor bump (and still escalates when actuation is off)", async () => {
    const a = adapters([pr({ toVersion: "4.13.0" })], allGreen, false);
    const r = await runRemediationMergeGate({ adapters: a, budget: 5 });
    expect(r).toMatchObject({ escalated: 1, merged: 0, dryRun: 0 });
    expect(a.escalate).toHaveBeenCalledWith(expect.objectContaining({ prNumber: 100 }), expect.stringContaining("minor"));
  });

  it("escalates a green patch whose CI is not green", async () => {
    const a = adapters([pr()], { ...allGreen, ciGreen: false }, true);
    const r = await runRemediationMergeGate({ adapters: a, budget: 5 });
    expect(r.escalated).toBe(1);
    expect(a.armAutoMerge).not.toHaveBeenCalled();
  });

  it("escalates when the version delta is unknown", async () => {
    const a = adapters([pr({ fromVersion: null, toVersion: null })], allGreen, true);
    const r = await runRemediationMergeGate({ adapters: a, budget: 5 });
    expect(r.escalated).toBe(1);
  });

  it("caps work at the budget", async () => {
    const a = adapters([pr({ prNumber: 1 }), pr({ prNumber: 2 }), pr({ prNumber: 3 })], allGreen, true);
    const r = await runRemediationMergeGate({ adapters: a, budget: 2 });
    expect(r.processed).toBe(2);
    expect(a.armAutoMerge).toHaveBeenCalledTimes(2);
  });
});
