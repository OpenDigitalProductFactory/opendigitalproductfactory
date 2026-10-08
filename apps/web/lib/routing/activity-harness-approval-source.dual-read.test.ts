// Approval convergence A3 (BI-C8EC05C9, spec D2 S3, D8): activity-routing
// overrides are read from durable configuration facts AND from legacy
// approved proposals, so an override approved before the change keeps
// applying. No fact exists yet, so the result is exactly today's.
import { describe, expect, it, vi } from "vitest";

import {
  ACTIVITY_HARNESS_CONFIDENCE_OVERRIDE_ACTION,
  ACTIVITY_ROUTING_OVERRIDE_FACT_CATEGORY,
  activityHarnessOverridesFromProposalRows,
  loadApprovedActivityHarnessOverrides,
} from "./activity-harness-approval-source";

const legacy = [{
  proposalId: "p-1", actionType: ACTIVITY_HARNESS_CONFIDENCE_OVERRIDE_ACTION, status: "executed",
  decidedById: "user-1", decidedAt: new Date("2026-10-01T00:00:00.000Z"),
  parameters: { proposalId: "p-1", activityClass: "plan", harnessRecipeKey: "k", providerId: "p", modelId: null, confidence: "trusted" },
}];

function db(facts: Array<Record<string, unknown>> = []) {
  return {
    agentActionProposal: { findMany: vi.fn(async () => legacy) },
    userFact: { findMany: vi.fn(async () => facts) },
  };
}

describe("loadApprovedActivityHarnessOverrides", () => {
  it("with no facts, returns exactly what the legacy proposal read returns (parity)", async () => {
    const store = db();
    await expect(loadApprovedActivityHarnessOverrides(store, { take: 40 })).resolves.toEqual(activityHarnessOverridesFromProposalRows(legacy));
    expect(store.agentActionProposal.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { actionType: ACTIVITY_HARNESS_CONFIDENCE_OVERRIDE_ACTION, status: { in: ["approve", "approved", "executed"] } },
      take: 40,
    }));
    expect(store.userFact.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { category: ACTIVITY_ROUTING_OVERRIDE_FACT_CATEGORY, supersededAt: null },
    }));
  });

  it("adds a current override fact ahead of legacy rows", async () => {
    const store = db([{
      userId: "user-2", key: "activity-routing-override:build|k2|p2|m2", createdAt: new Date("2026-10-08T00:00:00.000Z"),
      value: JSON.stringify({ activityClass: "build", harnessRecipeKey: "k2", providerId: "p2", modelId: "m2", confidence: "degraded", approvedAt: "2026-10-08T00:00:00.000Z" }),
    }]);
    const overrides = await loadApprovedActivityHarnessOverrides(store, { take: 40 });
    expect(overrides.map((o) => [o.calibrationKey, o.confidence, o.approvedBy])).toEqual([
      ["build|k2|p2|m2", "degraded", "user-2"],
      ["plan|k|p|unknown-model", "trusted", "user-1"],
    ]);
  });

  it("ignores a malformed fact rather than inventing an override", async () => {
    const overrides = await loadApprovedActivityHarnessOverrides(db([{ userId: "u", key: "x", createdAt: new Date(), value: "{not json" }]), { take: 40 });
    expect(overrides).toEqual(activityHarnessOverridesFromProposalRows(legacy));
  });
});
