import { describe, expect, it } from "vitest";

import { resolveDrivePlan } from "./drive-resolution";
import type { WorkroomParticipantRole, WorkroomParticipantView } from "./room-types";
import { earnEvidenceReceipts, stageHasCompletingEvidence } from "./stage-evidence-receipts";
import { stageEvidenceKinds } from "./stage-briefing";
import { getWorkShape, listWorkShapes, readWorkShapeDefinitionContract } from "./work-shapes";
import { WORK_SHAPE_PRIOR_VERSIONS } from "./work-shape-prior-versions";
import { DEFER_ON_REFUSE_ROUTE, REFUSE_TO_STOP, REWORK_1, SHADOW_GATE } from "./__fixtures__/graph-shapes/rework";
import {
  buildStageDecisionEvidence,
  governedDecisionStage,
  STAGE_DECISION_CHOICE_LABEL,
  stageDecisionChoices,
  priorStageFindings,
  readPendingGovernedDecision,
  readPendingGovernedDecisions,
  resolveStageDecider,
  stageDeciderRefusal,
  validateStageDecision,
} from "./workroom-stage-decision";

const shape = getWorkShape("dependency-advisory-watch")!;
const definition = readWorkShapeDefinitionContract(shape);
const now = new Date("2026-09-29T12:00:00.000Z");

function participant(principalRef: string, roles: WorkroomParticipantRole[], kind: "agent" | "person"): WorkroomParticipantView {
  return {
    principalRef, displayName: principalRef, kind, roles, workState: "unknown", presence: "unknown",
    currentWorkSummary: null, enteredReason: null, sponsorPrincipalRef: null, authoritySummary: "",
    sourceRefs: [], assignmentSource: "explicit",
    coordinatorSource: roles.includes("coordinator") ? "explicit" : "none",
  };
}

describe("governed stage decision (pure)", () => {
  it("reads only a governed_decision pending attention", () => {
    expect(readPendingGovernedDecision({ workroomDrive: { pendingAttention: {
      reason: "governed_decision", stageKey: "decide", principalRef: "role:security-owner" } } }))
      .toEqual({ stageKey: "decide", principalRef: "role:security-owner" });
    expect(readPendingGovernedDecision({ workroomDrive: { pendingAttention: {
      reason: "role_stage", stageKey: "decide" } } })).toBeNull();
    expect(readPendingGovernedDecision({ workroomDrive: { pendingAttention: null } })).toBeNull();
  });

  // GPP Phase 3c PR-3c-2: parallel branches can wait on several decisions at once.
  it("lists every pending governed decision of a graph room, and falls back to the single one", () => {
    const both = { workroomDrive: {
      pendingAttention: { reason: "governed_decision", stageKey: "legal", principalRef: "role:owner" },
      pendingAttentions: [
        { reason: "governed_decision", stageKey: "legal", principalRef: "role:owner" },
        { reason: "role_stage", stageKey: "notes", principalRef: "role:author" },
        { reason: "governed_decision", stageKey: "security", principalRef: " " },
        { reason: "governed_decision", stageKey: "legal", principalRef: "role:owner" },
      ],
    } };
    expect(readPendingGovernedDecisions(both)).toEqual([
      { stageKey: "legal", principalRef: "role:owner" },
      { stageKey: "security", principalRef: null },
    ]);
    // The single reader still returns the first, unchanged.
    expect(readPendingGovernedDecision(both)).toEqual({ stageKey: "legal", principalRef: "role:owner" });
    // Deciding one: the drive's next snapshot lists only the other.
    expect(readPendingGovernedDecisions({ workroomDrive: { pendingAttentions: [both.workroomDrive.pendingAttentions[2]] } }))
      .toEqual([{ stageKey: "security", principalRef: null }]);
    // A sequential room has no list: the single pendingAttention is read exactly as before.
    expect(readPendingGovernedDecisions({ workroomDrive: { pendingAttention: { reason: "governed_decision", stageKey: "decide", principalRef: "role:security-owner" } } }))
      .toEqual([{ stageKey: "decide", principalRef: "role:security-owner" }]);
    expect(readPendingGovernedDecisions({ workroomDrive: { pendingAttention: { reason: "role_stage", stageKey: "decide" } } })).toEqual([]);
    expect(readPendingGovernedDecisions({ workroomDrive: { pendingAttentions: [] } })).toEqual([]);
  });

  it("offers accept/patch/defer for dependency-advisory-watch and only accept/defer otherwise", () => {
    const stage = governedDecisionStage(definition, "decide")!;
    expect(stage.evidenceKind).toBe("decision-record");
    expect(stage.choices).toEqual(["accept", "patch", "defer"]);
    expect(stage.priorStages.map((prior) => prior.key)).toEqual(["sweep", "raise"]);
    const policy = readWorkShapeDefinitionContract(getWorkShape("repository-policy-drift-watch")!);
    const governed = policy.stages.find((entry) => entry.advance.kind === "governed-decision")!;
    expect(governedDecisionStage(policy, governed.key)!.choices).toEqual(["accept", "defer"]);
  });

  it("is not a governed decision for an agent stage", () => {
    expect(governedDecisionStage(definition, "sweep")).toBeNull();
    expect(governedDecisionStage(null, "decide")).toBeNull();
  });

  it("requires a future date to defer", () => {
    const stage = governedDecisionStage(definition, "decide")!;
    expect(validateStageDecision({ stageKey: "decide", choice: "defer" }, stage, now).ok).toBe(false);
    expect(validateStageDecision({ stageKey: "decide", choice: "defer", deferUntil: "2026-09-29" }, stage, now).ok).toBe(false);
    expect(validateStageDecision({ stageKey: "decide", choice: "defer", deferUntil: "2026-02-31" }, stage, now).ok).toBe(false);
    expect(validateStageDecision({ stageKey: "decide", choice: "defer", deferUntil: "2026-10-15" }, stage, now))
      .toEqual({ ok: true, data: { choice: "defer", deferUntil: "2026-10-15", rationale: null } });
    expect(validateStageDecision({ stageKey: "decide", choice: "shrug" }, stage, now).ok).toBe(false);
  });

  it("names who can decide in the refusal, and fails closed with no owner", () => {
    const owner = resolveStageDecider({ state: "resolved", principalId: "p-owner", source: "organization-owner", inheritedFrom: [] }, "Alex Owner");
    expect(owner).toMatchObject({ state: "resolved", principalId: "p-owner", decidedBy: "accountable-owner-fallback" });
    expect(stageDeciderRefusal(owner)).toBe("Only Alex Owner (the room's accountable owner) can record this decision.");
    const none = resolveStageDecider({ state: "setup-required", reason: "no-organization-owner-recorded", message: "x", atWorkroomId: null }, null);
    expect(none.state).toBe("none");
  });

  it("summarises the latest completed evidence of prior stages only", () => {
    const stage = governedDecisionStage(definition, "decide")!;
    const findings = priorStageFindings(stage, [
      { payload: { stageKey: "raise", outcome: "blocked" }, summary: "blocked raise" },
      { payload: { stageKey: "raise", outcome: "completed" }, summary: "2 findings raised" },
      { payload: { stageKey: "sweep", outcome: "completed" }, summary: "14 advisories read" },
      { payload: { stageKey: "decide", outcome: "completed" }, summary: "not prior" },
    ]);
    expect(findings).toEqual([
      { stageKey: "sweep", title: expect.any(String), summary: "14 advisories read" },
      { stageKey: "raise", title: expect.any(String), summary: "2 findings raised" },
    ]);
  });
});

describe("a recorded decision completes the governed stage through the one receipt path", () => {
  const askedAt = new Date("2026-09-26T01:30:00.806Z");
  const stage = governedDecisionStage(definition, "decide")!;
  const evidence = buildStageDecisionEvidence({
    stage,
    decision: { choice: "accept", deferUntil: null, rationale: null },
    decidedBy: "accountable-owner-fallback",
    deciderName: "Alex Owner",
  });
  const decisionRow = { stageKey: evidence.stageKey, kind: evidence.kind, outcome: evidence.outcome, recordedAt: now };

  it("records the stage's declared kind, outcome completed, and the fallback provenance", () => {
    expect(evidence).toMatchObject({
      kind: "decision-record", stageKey: "decide", outcome: "completed",
      result: { choice: "accept", decisionScope: "security-advisory-response", principalRef: "role:security-owner", decidedBy: "accountable-owner-fallback" },
    });
  });

  it("does not count evidence recorded before the room asked", () => {
    const early = { ...decisionRow, recordedAt: new Date(askedAt.getTime() - 1) };
    expect(stageHasCompletingEvidence({ stageKey: "decide", declaredKinds: ["decision-record"], evidence: [early], dispatchedAt: askedAt })).toBe(false);
    expect(stageHasCompletingEvidence({ stageKey: "decide", declaredKinds: ["decision-record"], evidence: [decisionRow], dispatchedAt: askedAt })).toBe(true);
    expect(stageHasCompletingEvidence({ stageKey: "decide", declaredKinds: ["decision-record"], evidence: [decisionRow], dispatchedAt: null })).toBe(false);
  });

  it("earns the completing receipt and the drive ends the cycle with success", () => {
    const existing = [{ stageKey: "sweep", kind: "stage-evidence-recorded" }, { stageKey: "raise", kind: "stage-evidence-recorded" }];
    const receipts = earnEvidenceReceipts({
      stageKey: "decide",
      declaredKinds: stageEvidenceKinds(definition, "decide"),
      evidence: [decisionRow],
      dispatchedAt: askedAt,
      existing,
    });
    expect(receipts).toHaveLength(3);
    const base = {
      roomId: "WC-TEST", definition, collaborationShape: shape.collaborationShape ?? null, postureLevel: "balanced" as const,
      participants: [participant("PRN-COORD", ["coordinator"], "agent"), participant("PRN-OWNER", ["accountable"], "person")],
      budgetUsage: [], stopConditionHits: [], reviewDue: false, substrateReachable: true, substrateEmpty: false,
      coordinatorHasProcessCoordinationAuthority: true,
      coordinatorEligibility: { jsi: "eligible" as const, authorityBinding: "eligible" as const }, now,
    };
    const waiting = resolveDrivePlan({ ...base, currentStageKey: "decide", receipts: existing as never });
    expect(waiting).toMatchObject({ action: "attention", reason: "governed_decision", stageKey: "decide" });
    const decided = resolveDrivePlan({ ...base, currentStageKey: "decide", receipts: receipts as never });
    expect(decided).toMatchObject({ action: "stop", reason: "success" });
  });
});

// GPP Phase 3c PR-3c-3 (BI-8875C9DF), design §6.2: the `refuse` choice, labelled "Send back".
describe("Send back (refuse) is offered only where the gate declares a refuse route", () => {
  it("is labelled Send back and appended only when the stage declares a refuse route", () => {
    expect(STAGE_DECISION_CHOICE_LABEL.refuse).toBe("Send back");
    expect(stageDecisionChoices("The owner accepts or defers.")).toEqual(["accept", "defer"]);
    expect(stageDecisionChoices("accepts, patches, or defers", true)).toEqual(["accept", "patch", "defer", "refuse"]);
    expect(governedDecisionStage(readWorkShapeDefinitionContract(REWORK_1), "b")!.choices).toEqual(["accept", "defer", "refuse"]);
    expect(governedDecisionStage(readWorkShapeDefinitionContract(REFUSE_TO_STOP), "decide")!.choices).toEqual(["accept", "defer", "refuse"]);
    // A shadow gate that declares a route still offers it (the refusal is recorded; the gate does not hold the token).
    expect(governedDecisionStage(readWorkShapeDefinitionContract(SHADOW_GATE), "b")!.choices).toEqual(["accept", "defer", "refuse"]);
    // An enforced gate without a refuse route does not.
    expect(governedDecisionStage(readWorkShapeDefinitionContract(DEFER_ON_REFUSE_ROUTE), "approve")!.choices).toEqual(["accept", "defer"]);
  });

  it("leaves every existing registry stage's offered choices unchanged: none offers Send back", () => {
    let governed = 0;
    for (const registryShape of [...listWorkShapes(), ...WORK_SHAPE_PRIOR_VERSIONS]) {
      const contract = readWorkShapeDefinitionContract(registryShape);
      for (const stage of contract.stages) {
        const decision = governedDecisionStage(contract, stage.key);
        if (!decision || stage.advance.kind !== "governed-decision") continue;
        governed += 1;
        expect(decision.choices, `${registryShape.key}@${registryShape.version}/${stage.key}`).toEqual(stageDecisionChoices(stage.advance.condition));
        expect(decision.choices).not.toContain("refuse");
      }
    }
    expect(governed).toBeGreaterThan(0);
  });

  it("validates a send-back without a date and records it with the verb sent back", () => {
    const stage = governedDecisionStage(readWorkShapeDefinitionContract(REWORK_1), "b")!;
    const valid = validateStageDecision({ stageKey: "b", choice: "refuse", rationale: "Evidence is missing." }, stage, now);
    expect(valid).toEqual({ ok: true, data: { choice: "refuse", deferUntil: null, rationale: "Evidence is missing." } });
    if (!valid.ok) return;
    const evidence = buildStageDecisionEvidence({ stage, decision: valid.data, decidedBy: "accountable-owner-fallback", deciderName: "Alex Owner" });
    expect(evidence).toMatchObject({ kind: "decision-record", stageKey: "b", outcome: "completed", result: { choice: "refuse" } });
    expect(evidence.summary).toBe("Alex Owner sent back: Decide b. Evidence is missing.");
    // A stage without a refuse route refuses the choice.
    expect(validateStageDecision({ stageKey: "decide", choice: "refuse" }, governedDecisionStage(definition, "decide")!, now).ok).toBe(false);
  });

  it("a refused stage whose route is spent (gate_refused) is decided through the same control", () => {
    const pending = { reason: "gate_refused", stageKey: "b", principalRef: "role:owner" };
    expect(readPendingGovernedDecision({ workroomDrive: { pendingAttention: pending } })).toEqual({ stageKey: "b", principalRef: "role:owner" });
    expect(readPendingGovernedDecisions({ workroomDrive: { pendingAttention: pending, pendingAttentions: [pending] } }))
      .toEqual([{ stageKey: "b", principalRef: "role:owner" }]);
  });
});
