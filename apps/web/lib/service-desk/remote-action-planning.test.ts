import { describe, expect, it } from "vitest";

import { CONSERVATIVE_AUTHORITY_BAND } from "./remediation-authority";
import { mapToRemoteActionType, planRemoteActionsForProposal } from "./remote-action-planning";

describe("mapToRemoteActionType", () => {
  it("maps A4 verbs to the convergent RemoteAction vocabulary", () => {
    expect(mapToRemoteActionType("collect-interface-diagnostics")).toBe("diagnostics.collect");
    expect(mapToRemoteActionType("collect-disk-usage")).toBe("diagnostics.collect");
    expect(mapToRemoteActionType("restart-service")).toBe("service.restart");
    expect(mapToRemoteActionType("restart-interface")).toBe("interface.restart");
    expect(mapToRemoteActionType("rotate-certificate")).toBe("cert.rotate");
    expect(mapToRemoteActionType("apply-patch")).toBe("patch.apply");
  });

  it("passes unknown verbs through faithfully (riskClass still governs)", () => {
    expect(mapToRemoteActionType("frobnicate-widget")).toBe("frobnicate-widget");
  });
});

describe("planRemoteActionsForProposal", () => {
  it("read-only → approved, mutating → proposed, destructive → refused (conservative band)", () => {
    const plan = planRemoteActionsForProposal(
      [
        { actionType: "collect-service-diagnostics", riskClass: "read-only", rationale: "look first" },
        { actionType: "restart-service", riskClass: "medium", rationale: "bounce it" },
        { actionType: "wipe-and-reimage", riskClass: "destructive", rationale: "nuke" },
      ],
      CONSERVATIVE_AUTHORITY_BAND,
    );
    expect(plan.toMaterialize).toHaveLength(2);
    const byType = Object.fromEntries(plan.toMaterialize.map((a) => [a.actionType, a.approvalState]));
    expect(byType["diagnostics.collect"]).toBe("approved");
    expect(byType["service.restart"]).toBe("proposed");
    expect(plan.refused.map((r) => r.actionType)).toEqual(["wipe-and-reimage"]);
  });

  it("re-checks risk from the action, NOT a frozen decision — a mutating action never auto-approves under conservative", () => {
    // Even if the wire claimed auto-approve, riskClass medium re-evaluates to needs-human.
    const plan = planRemoteActionsForProposal(
      [{ actionType: "restart-service", riskClass: "medium", rationale: "x" }],
      CONSERVATIVE_AUTHORITY_BAND,
    );
    expect(plan.toMaterialize[0]?.approvalState).toBe("proposed");
  });

  it("coerces an unknown/missing riskClass to high (fail-safe: never auto-approve)", () => {
    const plan = planRemoteActionsForProposal(
      [{ actionType: "mystery", riskClass: "bogus", rationale: "?" }],
      CONSERVATIVE_AUTHORITY_BAND,
    );
    expect(plan.toMaterialize[0]?.approvalState).toBe("proposed");
    expect(plan.toMaterialize[0]?.riskClass).toBe("high");
  });

  it("a widened band can auto-approve a higher class", () => {
    const plan = planRemoteActionsForProposal(
      [{ actionType: "restart-service", riskClass: "medium", rationale: "x" }],
      { autoApproveCeiling: "medium", humanApprovalCeiling: "high" },
    );
    expect(plan.toMaterialize[0]?.approvalState).toBe("approved");
  });
});
