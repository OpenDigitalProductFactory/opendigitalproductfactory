import { describe, expect, it, vi } from "vitest";
import {
  buildLeaveScoredOptions,
  decideLeaveRequest,
  type LeaveDecisionInputs,
} from "./leave-decision-coworker";

// D2.2 orchestration. Threads the WWWD org-business gate through the surface
// adapter and the D2.1 safety guards. The gate is injected, so this is a pure
// unit test — no DB, no MCP. The gate governs the OUTCOME (recommend/escalate)
// against the org's own stance; the hard guards can only ever veto toward
// escalation; the coworker never mutates leave state (that stays on D1's path).

const baseInputs: LeaveDecisionInputs = {
  requestId: "LR-1",
  leaveType: "annual",
  organizationId: "ORG-1",
  requestedDays: 3,
  remainingBalance: 10,
  coverage: { requiredHeadcount: 2, coveredIfApproved: 4 },
  maxConsecutiveDays: 10,
  requestedConsecutiveDays: 3,
  inBlackoutWindow: false,
};

function makeGate(over: Record<string, unknown> = {}) {
  return vi.fn().mockResolvedValue({
    allowed: true,
    interactionId: "DI-TEST-1",
    operatorMessage: "org stance recommends approve",
    orgProfileSelected: true,
    evaluation: { outcomeType: "recommend", recommendedOptionId: "approve" },
    ...over,
  });
}

describe("buildLeaveScoredOptions", () => {
  it("returns exactly the approve and deny options with feature vectors", () => {
    const opts = buildLeaveScoredOptions(baseInputs);
    expect(opts.map((o) => o.id).sort()).toEqual(["approve", "deny"]);
    for (const o of opts) expect(Object.keys(o.features).length).toBeGreaterThan(0);
  });

  it("scores approve with higher business_disruption when coverage is tight", () => {
    const ample = buildLeaveScoredOptions({ ...baseInputs, coverage: { requiredHeadcount: 2, coveredIfApproved: 8 } });
    const tight = buildLeaveScoredOptions({ ...baseInputs, coverage: { requiredHeadcount: 4, coveredIfApproved: 4 } });
    const disruptionOf = (opts: ReturnType<typeof buildLeaveScoredOptions>) =>
      opts.find((o) => o.id === "approve")!.features.business_disruption;
    expect(disruptionOf(tight)).toBeGreaterThan(disruptionOf(ample));
  });

  it("scores approve's governance_compliance lower when the request exceeds the balance", () => {
    const within = buildLeaveScoredOptions({ ...baseInputs, requestedDays: 3, remainingBalance: 10 });
    const over = buildLeaveScoredOptions({ ...baseInputs, requestedDays: 12, remainingBalance: 10 });
    const complianceOf = (opts: ReturnType<typeof buildLeaveScoredOptions>) =>
      opts.find((o) => o.id === "approve")!.features.governance_compliance;
    expect(complianceOf(over)).toBeLessThan(complianceOf(within));
  });
});

describe("decideLeaveRequest", () => {
  it("recommends approve when the org gate recommends approve and no guard fires", async () => {
    const gate = makeGate();
    const result = await decideLeaveRequest(baseInputs, { db: {}, gate });
    expect(result.action).toBe("approve");
    expect(result.interactionId).toBe("DI-TEST-1");
    expect(result.orgProfileSelected).toBe(true);
    // Calls the WWWD business surface with the right shape.
    const callArg = gate.mock.calls[0][0];
    expect(callArg.domainClass).toBe("risk-assessment");
    expect(callArg.options).toEqual(["approve", "deny"]);
    expect(callArg.scoredOptions).toHaveLength(2);
  });

  it("escalates — never approves — when a hard guard fires, even if the gate recommends approve", async () => {
    const gate = makeGate();
    const result = await decideLeaveRequest(
      { ...baseInputs, coverage: { requiredHeadcount: 3, coveredIfApproved: 2 } },
      { db: {}, gate },
    );
    expect(result.action).toBe("escalate");
    expect(result.guardReasons.join(" ")).toMatch(/coverage/i);
  });

  it("escalates when the org gate escalates", async () => {
    const gate = makeGate({
      allowed: false,
      evaluation: { outcomeType: "escalate", recommendedOptionId: null },
    });
    const result = await decideLeaveRequest(baseInputs, { db: {}, gate });
    expect(result.action).toBe("escalate");
  });

  it("maps a gate deny recommendation to a deny action", async () => {
    const gate = makeGate({
      evaluation: { outcomeType: "recommend", recommendedOptionId: "deny" },
    });
    const result = await decideLeaveRequest(baseInputs, { db: {}, gate });
    expect(result.action).toBe("deny");
  });
});
