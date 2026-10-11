import { describe, expect, it } from "vitest";

import { DELIVERY_SHAPES } from "./delivery-shapes";
import { resolveDrivePlan } from "./drive-resolution";
import {
  bindReviewStage,
  isReadinessReviewStage,
  READINESS_REVIEW_GATE_BY_CODE,
  readinessReviewGatesForStage,
  resolveReviewStageBinding,
  type ReadinessReviewRoute,
} from "./readiness-review-stages";
import type { WorkroomParticipantView } from "./room-types";
import { readWorkShapeDefinitionContract } from "./work-shapes";

// BI-2C8750FC: readiness review gates become room drive review stages.

const large = readWorkShapeDefinitionContract(DELIVERY_SHAPES["delivery-large"]);
const medium = readWorkShapeDefinitionContract(DELIVERY_SHAPES["delivery-medium"]);

function route(gate: string, extras: Partial<ReadinessReviewRoute> = {}): ReadinessReviewRoute {
  return {
    gate,
    accountableRole: gate === "plan-review" ? "plan-reviewer" : "design-checklist-reviewer",
    targetAgentId: "AGT-WS-REVIEW",
    independent: true,
    requestCoworker: { targetAgent: "AGT-WS-REVIEW", requestKey: `key-${gate}` },
    ...extras,
  };
}

const coordinator: WorkroomParticipantView = {
  principalRef: "PRN-COORD", displayName: "coord", kind: "agent", roles: ["coordinator"], workState: "unknown",
  presence: "unknown", currentWorkSummary: null, enteredReason: null, sponsorPrincipalRef: null, authoritySummary: "",
  sourceRefs: [], assignmentSource: "explicit", coordinatorSource: "explicit",
};

/** A delivery-large room sitting on spec-approval: the spec stage already earned its receipt. */
function atSpecApproval(definition = large, extras: Partial<Parameters<typeof resolveDrivePlan>[0]> = {}) {
  return resolveDrivePlan({
    roomId: "WC-REVIEW", definition, collaborationShape: null, postureLevel: "assertive",
    participants: [coordinator], currentStageKey: "spec", receipts: [{ stageKey: "spec", kind: "design-doc" }],
    budgetUsage: [], stopConditionHits: [], reviewDue: false, substrateReachable: true, substrateEmpty: false,
    coordinatorHasProcessCoordinationAuthority: true, coordinatorEligibility: { jsi: "eligible", authorityBinding: "eligible" },
    now: new Date("2026-10-06T00:00:00.000Z"),
    ...extras,
  });
}

describe("readiness review stages (BI-2C8750FC)", () => {
  it("maps exactly the three readiness review codes to their gates", () => {
    expect(READINESS_REVIEW_GATE_BY_CODE).toEqual({
      CANONICAL_DESIGN_REQUIRED: "design-spec",
      SPEC_APPROVAL_REQUIRED: "spec-approval",
      PLAN_REVIEW_REQUIRED: "plan-review",
    });
  });

  it("reads review stages off the declared shape's evidence, not a parallel list", () => {
    expect(readinessReviewGatesForStage(large.stages.find((stage) => stage.key === "spec-approval")))
      .toEqual(["design-spec", "spec-approval"]);
    expect(readinessReviewGatesForStage(large.stages.find((stage) => stage.key === "plan"))).toEqual(["plan-review"]);
    expect(isReadinessReviewStage(large, "implement")).toBe(false);
    expect(medium.stages.some((stage) => isReadinessReviewStage(medium, stage.key))).toBe(false);
  });

  it("person-authored, preauthorized: binds the stage to the eligible reviewer AGENT with its exact packet", () => {
    const binding = resolveReviewStageBinding({
      definition: large, stageKey: "spec-approval", routes: [route("spec-approval")],
      author: { kind: "person", userId: "user-1" }, actionBoundary: "preauthorized",
    });
    expect(binding).toEqual({
      stageKey: "spec-approval", gate: "spec-approval",
      accountablePrincipalRef: "agent:AGT-WS-REVIEW", independentEvaluatorPrincipalRef: "agent:AGT-WS-REVIEW",
      requestCoworker: { targetAgent: "AGT-WS-REVIEW", requestKey: "key-spec-approval" },
    });
  });

  it("orders design-spec before spec-approval at the same stage, so the baseline is minted in order", () => {
    const binding = resolveReviewStageBinding({
      definition: large, stageKey: "spec-approval", routes: [route("spec-approval"), route("design-spec")],
      author: { kind: "person", userId: "user-1" }, actionBoundary: "preauthorized",
    });
    expect(binding?.gate).toBe("design-spec");
  });

  it("agent-authored: the reviewer is the human ROLE, never an agent, even at preauthorized", () => {
    const binding = resolveReviewStageBinding({
      definition: large, stageKey: "plan", routes: [route("plan-review")],
      author: { kind: "agent", agentId: "AGT-EXT-CLAUDE" }, actionBoundary: "preauthorized",
    });
    expect(binding).toMatchObject({ accountablePrincipalRef: "role:plan-reviewer", requestCoworker: null });
  });

  it("person-authored below full proactivity: tees the review up for the reviewer role, not the author", () => {
    const binding = resolveReviewStageBinding({
      definition: large, stageKey: "plan", routes: [route("plan-review")],
      author: { kind: "person", userId: "user-1" }, actionBoundary: "propose",
    });
    expect(binding).toMatchObject({ accountablePrincipalRef: "role:plan-reviewer", requestCoworker: null });
  });

  it("binds nothing when independence cannot be shown", () => {
    const base = { definition: large, stageKey: "spec-approval", actionBoundary: "preauthorized" as const };
    // The reviewing agent is the authoring agent.
    expect(resolveReviewStageBinding({ ...base, routes: [route("spec-approval", { targetAgentId: "AGT-X" })],
      author: { kind: "agent", agentId: "AGT-X" } })).toBeNull();
    // The recovery did not mark the route independent.
    expect(resolveReviewStageBinding({ ...base, routes: [route("spec-approval", { independent: false })],
      author: { kind: "person", userId: "user-1" } })).toBeNull();
    // Nobody is known to have authored it.
    expect(resolveReviewStageBinding({ ...base, routes: [route("spec-approval")], author: { kind: "unknown" } })).toBeNull();
    // No review is owed.
    expect(resolveReviewStageBinding({ ...base, routes: [], author: { kind: "person", userId: "user-1" } })).toBeNull();
    // A route for a different stage's gate.
    expect(resolveReviewStageBinding({ ...base, routes: [route("plan-review")], author: { kind: "person", userId: "user-1" } })).toBeNull();
  });

  it("rebinds a copy and never mutates the registry shape", () => {
    const rebound = bindReviewStage(large, { stageKey: "spec-approval", accountablePrincipalRef: "agent:AGT-WS-REVIEW" });
    expect(rebound.stages.find((stage) => stage.key === "spec-approval")?.accountablePrincipalRef).toBe("agent:AGT-WS-REVIEW");
    expect(DELIVERY_SHAPES["delivery-large"].stages.find((stage) => stage.key === "spec-approval")?.accountablePrincipalRef)
      .toBe("role:design-checklist-reviewer");
  });

  describe("through the drive's own author-flip (resolveDrivePlan)", () => {
    it("today: the declared spec-approval stage raises attention", () => {
      expect(atSpecApproval()).toMatchObject({ action: "attention", stageKey: "spec-approval", reason: "governed_decision" });
    });

    it("person-authored at preauthorized: the review stage dispatches the reviewer agent", () => {
      const binding = resolveReviewStageBinding({
        definition: large, stageKey: "spec-approval", routes: [route("spec-approval")],
        author: { kind: "person", userId: "user-1" }, actionBoundary: "preauthorized",
      })!;
      const plan = atSpecApproval(bindReviewStage(large, binding), {
        actionBoundary: "preauthorized", independentEvaluatorPrincipalRef: binding.independentEvaluatorPrincipalRef,
      });
      expect(plan).toMatchObject({ action: "dispatch_agent", agentId: "AGT-WS-REVIEW", stageKey: "spec-approval" });
    });

    it("agent-authored: attention goes to the reviewer role", () => {
      const binding = resolveReviewStageBinding({
        definition: large, stageKey: "spec-approval", routes: [route("spec-approval")],
        author: { kind: "agent", agentId: "AGT-EXT-CLAUDE" }, actionBoundary: "preauthorized",
      })!;
      const plan = atSpecApproval(bindReviewStage(large, binding), { actionBoundary: "preauthorized" });
      expect(plan).toMatchObject({ action: "attention", attentionPrincipalRef: "role:design-checklist-reviewer", agentId: null });
    });

    it("an agent principal without the preauthorized boundary still only raises attention", () => {
      const rebound = bindReviewStage(large, { stageKey: "spec-approval", accountablePrincipalRef: "agent:AGT-WS-REVIEW" });
      expect(atSpecApproval(rebound, { actionBoundary: "propose" })).toMatchObject({ action: "attention", taskId: null });
    });
  });
});
