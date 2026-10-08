import { describe, expect, it } from "vitest";

import { AUTHOR_STAGE_AGENT_REF, decideAuthorStageAutonomy } from "./author-stage-autonomy";
import { DELIVERY_SHAPES } from "./delivery-shapes";
import { resolveDrivePlan } from "./drive-resolution";
import type { WorkroomParticipantRole, WorkroomParticipantView } from "./room-types";
import { readWorkShapeDefinitionContract } from "./work-shapes";

// BI-8A32EBFF: the drive runs a role:author delivery stage with an agent only
// under the operator pre-authorisation and within budget; otherwise it raises
// attention as before and its ledger names the missing condition.

function participant(principalRef: string, roles: WorkroomParticipantRole[], kind: WorkroomParticipantView["kind"]): WorkroomParticipantView {
  return {
    principalRef, displayName: principalRef, kind, roles, workState: "unknown", presence: "unknown",
    currentWorkSummary: null, enteredReason: null, sponsorPrincipalRef: null, authoritySummary: "", sourceRefs: [],
    assignmentSource: "explicit", coordinatorSource: roles.includes("coordinator") ? "explicit" : "none",
  };
}

const IN_FORCE = { state: "in-force" as const, setByUserId: "user-op", setAt: "2026-10-07T00:00:00.000Z", reason: "all shapes" };
const FUNDED = { funded: true as const, portfolioId: "pf", summary: "funded" };

function plan(
  shapeKey: keyof typeof DELIVERY_SHAPES,
  stageKey: string,
  autonomy: ReturnType<typeof decideAuthorStageAutonomy>,
  receipts: { stageKey: string; kind: string }[] = [],
) {
  return resolveDrivePlan({
    roomId: "WC-DELIVERY",
    definition: readWorkShapeDefinitionContract(DELIVERY_SHAPES[shapeKey]),
    collaborationShape: null,
    postureLevel: "balanced",
    participants: [
      participant("PRN-COORD", ["coordinator"], "agent"),
      participant("PRN-OWNER", ["accountable"], "person"),
      participant("PRN-REVIEWER", ["reviewer"], "person"),
    ],
    currentStageKey: stageKey,
    proposedStageKey: stageKey,
    receipts,
    budgetUsage: [],
    stopConditionHits: [],
    reviewDue: false,
    substrateReachable: true,
    substrateEmpty: false,
    coordinatorHasProcessCoordinationAuthority: true,
    coordinatorEligibility: { jsi: "eligible", authorityBinding: "eligible" },
    now: new Date("2026-10-07T12:00:00.000Z"),
    roleBindings: autonomy.roleBindings,
    authorStageWithheldBecause: autonomy.withheldBecause,
  });
}

describe("drive: role:author delivery stages under the operator pre-authorisation (BI-8A32EBFF)", () => {
  it("AC-1: dispatches the author stage to the coworker when pre-authorised and funded", () => {
    const autonomy = decideAuthorStageAutonomy({ shapeKey: "delivery-medium", preauthorisation: IN_FORCE, funding: FUNDED });
    const result = plan("delivery-medium", "design-note", autonomy);
    expect(result).toMatchObject({ action: "dispatch_agent", reason: "agent_stage", stageKey: "design-note", accountablePrincipalRef: AUTHOR_STAGE_AGENT_REF });
  });

  it("AC-1: without funding the stage raises attention as before, and the ledger names the missing condition", () => {
    const autonomy = decideAuthorStageAutonomy({
      shapeKey: "delivery-medium",
      preauthorisation: IN_FORCE,
      funding: { funded: false, because: "No budget is set for Foundational this quarter; unfunded work is not pre-authorised." },
    });
    const result = plan("delivery-medium", "design-note", autonomy);
    expect(result).toMatchObject({ action: "attention", reason: "role_stage", attentionPrincipalRef: "role:author" });
    expect(result.ledger.join(" ")).toMatch(/An agent may not run it: No budget is set for Foundational/);
  });

  it("AC-1: without the pre-authorisation the stage raises attention, naming it", () => {
    const autonomy = decideAuthorStageAutonomy({
      shapeKey: "delivery-break-fix",
      preauthorisation: { state: "not-in-force", because: "No operator pre-authorisation is recorded (workroom-drive.author-stage-preauthorisation)." },
      funding: FUNDED,
    });
    const result = plan("delivery-break-fix", "reproduce", autonomy);
    expect(result).toMatchObject({ action: "attention", reason: "role_stage" });
    expect(result.ledger.join(" ")).toMatch(/No operator pre-authorisation is recorded/);
  });

  it("AC-2: a governed author stage (merge) still escalates to a person even when pre-authorised and funded", () => {
    const autonomy = decideAuthorStageAutonomy({ shapeKey: "delivery-medium", preauthorisation: IN_FORCE, funding: FUNDED });
    const done = (key: string) => ({ stageKey: key, kind: "completed" });
    const result = plan("delivery-medium", "merge", autonomy, [done("design-note"), done("implement")]);
    expect(result).toMatchObject({ action: "attention", reason: "governed_decision", agentId: null });
  });
});
