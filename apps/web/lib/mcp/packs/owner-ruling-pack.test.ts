// BI-0C0B0836: a coworker carries the owner's ruling on an escalated review.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUnique, captureOrg, captureBuild } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  captureOrg: vi.fn(),
  captureBuild: vi.fn(),
}));

vi.mock("@dpf/db", () => ({ prisma: { decisionInteraction: { findUnique } } }));
vi.mock("@/lib/decision/owner-ruling-capture", () => ({
  captureOrgDecisionOutcomeAs: captureOrg,
  captureBuildDecisionAs: captureBuild,
}));

import { resolveEscalation } from "@/lib/govern/authority/escalation-gate";
import { ownerRulingPack } from "./owner-ruling-pack";

const tool = ownerRulingPack.definitions.find((definition) => definition.name === "record_owner_ruling")!;
const run = (params: Record<string, unknown>, userId = "owner-1") =>
  ownerRulingPack.handlers.record_owner_ruling!(params, userId);
const RULING = "Option 1: create internal qualification tasks due within 7 days; a human before any outreach.";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("record_owner_ruling is always put to a person", () => {
  it("is declared a side-effecting proposal with an authority consequence", () => {
    expect(tool).toMatchObject({ executionMode: "proposal", sideEffect: true, consequence: "authority" });
    expect(ownerRulingPack.grants.record_owner_ruling).toEqual(["decision_record_create"]);
  });

  it("the escalation gate sends it to a person even for a graduated coworker with steering", () => {
    for (const steering of ["none", "wwmd", "standing-ruling"] as const) {
      const decision = resolveEscalation({
        action: { sideEffect: true, executionMode: "proposal", consequence: "authority" },
        dataPolicy: { sensitivity: "internal" },
        operatorRequiresApproval: false,
        steering,
      });
      expect(decision).toMatchObject({ verdict: "human", reasonCode: "declared-proposal" });
    }
  });
});

describe("record_owner_ruling handler", () => {
  it("records a business review as the owner's answer, never as a standing stance", async () => {
    findUnique.mockResolvedValue({ buildId: null, outcomeType: "escalate", escalationRoute: "human" });
    captureOrg.mockResolvedValue({ ok: true, status: "captured", resolvedCount: 1 });
    const result = await run({ interactionId: " DI-AB432BFF8956 ", answer: RULING });
    expect(captureOrg).toHaveBeenCalledWith("owner-1", {
      interactionId: "DI-AB432BFF8956", answer: RULING, rationale: null, makeStanding: false, chosenOptionId: null,
    });
    expect(captureBuild).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: true, data: { status: "captured", resolvedCount: 1 } });
  });

  it("records a build review with the outcome the gate escalated it under", async () => {
    findUnique.mockResolvedValue({ buildId: "FB-2F2D46D5", outcomeType: "escalate", escalationRoute: "human" });
    captureBuild.mockResolvedValue({ status: "captured", captureType: "escalation", captureId: "ESC-1" });
    const result = await run({ interactionId: "DI-6B298D3E7FB6", answer: "Hold: do not ship until the skipped UX check has run." });
    expect(captureBuild).toHaveBeenCalledWith("owner-1", expect.objectContaining({
      interactionId: "DI-6B298D3E7FB6", buildId: "FB-2F2D46D5", outcomeType: "escalate", candidateMaterial: false,
    }));
    expect(result.success).toBe(true);
  });

  it("refuses a build review owned by someone else in plain words", async () => {
    findUnique.mockResolvedValue({ buildId: "FB-OTHER", outcomeType: "defer", escalationRoute: null });
    captureBuild.mockRejectedValue(new Error("Forbidden"));
    const result = await run({ interactionId: "DI-X", answer: RULING });
    expect(result.success).toBe(false);
    expect(result.message).toContain("did not start");
  });

  it("refuses a review the gate already resolved, an unknown review, and a ruling with no words", async () => {
    findUnique.mockResolvedValueOnce({ buildId: "FB-1", outcomeType: "proceed", escalationRoute: "automated" });
    expect((await run({ interactionId: "DI-GATE", answer: RULING })).message).toContain("resolved by the gate");

    findUnique.mockResolvedValueOnce(null);
    expect((await run({ interactionId: "DI-NONE", answer: RULING })).message).toContain("not found");

    expect((await run({ interactionId: "DI-X", answer: "ok" })).success).toBe(false);
    expect(captureOrg).not.toHaveBeenCalled();
    expect(captureBuild).not.toHaveBeenCalled();
  });

  it("passes the core's refusal through instead of claiming success", async () => {
    findUnique.mockResolvedValue({ buildId: null, outcomeType: "escalate", escalationRoute: "human" });
    captureOrg.mockResolvedValue({ ok: false, error: "The chosen option is not one of this decision's options." });
    const result = await run({ interactionId: "DI-Y", answer: RULING, chosenOptionId: "opt-9" });
    expect(result.success).toBe(false);
    expect(result.message).toContain("not one of this decision's options");
  });
});
