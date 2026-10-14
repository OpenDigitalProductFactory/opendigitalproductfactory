import { describe, expect, it } from "vitest";

import { NOT_ASKED_ACCOUNTABILITY } from "@/lib/queue/functions/workroom-drive-accountability";

import { resolveDriveConclusion } from "./drive-conclusion";
import type { DrivePlan } from "./drive-resolution";
import { gateDrivePlanOnWorkItem, workItemStanding } from "./drive-work-item-gate";
import { classifyDriveSegment } from "./workroom-flow-state";

// BI-72679FE0: on 2026-10-14 the drive restarted 277 delivery rooms whose item
// was already done, awaiting acceptance or deferred. Each got an agent at its
// first stage, each run left no evidence, and each became a "Needs you" card.
function plan(overrides: Partial<DrivePlan>): DrivePlan {
  return {
    action: "dispatch_agent",
    reason: "agent_stage",
    roomId: "WC-1",
    shapeKey: "delivery-small",
    shapeVersion: "1.0.0",
    definition: null,
    stageKey: "reproduce",
    accountablePrincipalRef: "agent:build-specialist",
    agentId: "build-specialist",
    attentionPrincipalRef: null,
    taskId: "workroom-WC-1-delivery-small",
    conformance: null,
    cycle: null,
    deviations: [],
    ledger: ["Dispatch agent:build-specialist for stage reproduce."],
    ...overrides,
  };
}

describe("workItemStanding", () => {
  it("reads open, in-progress, triaging and an unbound room as active", () => {
    for (const status of ["open", "in-progress", "triaging", null, undefined]) {
      expect(workItemStanding(status)).toBe("active");
    }
  });
  it("reads awaiting-acceptance as delivered", () => {
    expect(workItemStanding("awaiting-acceptance")).toBe("delivered");
  });
  it("reads done, deferred and retired as parked", () => {
    for (const status of ["done", "deferred", "retired"]) expect(workItemStanding(status)).toBe("parked");
  });
});

describe("gateDrivePlanOnWorkItem", () => {
  it("leaves an active item's plan untouched", () => {
    const p = plan({});
    expect(gateDrivePlanOnWorkItem(p, "open")).toBe(p);
  });

  it("does not dispatch an agent into a room whose item is done", () => {
    const gated = gateDrivePlanOnWorkItem(plan({}), "done");
    expect(gated.action).toBe("do_not_wake");
    expect(gated.reason).toBe("work_item_inactive");
    expect(gated.taskId).toBeNull();
    expect(gated.agentId).toBeNull();
    expect(gated.shapeKey).toBe("delivery-small");
    expect(gated.ledger.join(" ")).toContain("done");
  });

  it("clears an existing writeback stall on a deferred item, so its card leaves the inbox", () => {
    const gated = gateDrivePlanOnWorkItem(plan({ action: "pause", reason: "executor_writeback_unavailable" }), "deferred");
    expect(gated.action).toBe("do_not_wake");
  });

  it("does not dispatch an agent into a delivered item, nor hold it on an agent-side pause", () => {
    expect(gateDrivePlanOnWorkItem(plan({}), "awaiting-acceptance").action).toBe("do_not_wake");
    for (const reason of ["missing_task_owner", "executor_writeback_unavailable"] as const) {
      expect(gateDrivePlanOnWorkItem(plan({ action: "pause", reason }), "awaiting-acceptance").action).toBe("do_not_wake");
    }
  });

  it("still lets a delivered item's person stage ask for acceptance", () => {
    const accept = plan({ action: "attention", reason: "governed_decision", stageKey: "accept", agentId: null, attentionPrincipalRef: "user:owner" });
    expect(gateDrivePlanOnWorkItem(accept, "awaiting-acceptance")).toBe(accept);
  });

  it("stands a parked item's person stage down too", () => {
    const ask = plan({ action: "attention", reason: "person_stage", agentId: null, attentionPrincipalRef: "user:owner" });
    expect(gateDrivePlanOnWorkItem(ask, "retired").action).toBe("do_not_wake");
  });

  it("keeps a conformance stop or escalation, which a person must still see", () => {
    const stop = plan({ action: "stop", reason: "conformance_stop" });
    const escalate = plan({ action: "escalate", reason: "conformance_escalate" });
    expect(gateDrivePlanOnWorkItem(stop, "done")).toBe(stop);
    expect(gateDrivePlanOnWorkItem(escalate, "deferred")).toBe(escalate);
  });

  it("drops graph token and marking fields, so the stood-down plan is applied as one quiet tick", () => {
    const gated = gateDrivePlanOnWorkItem(plan({ tokens: [], marking: { raw: {} } }), "done");
    expect(gated.tokens).toBeUndefined();
    expect(gated.marking).toBeUndefined();
  });

  it("concludes as waiting, not as an unconcluded defect, and reads as awaiting a trigger in flow", () => {
    const conclusion = resolveDriveConclusion({
      action: "do_not_wake",
      reason: "work_item_inactive",
      accountability: NOT_ASKED_ACCOUNTABILITY,
    });
    expect(conclusion.kind).toBe("in-motion");
    expect(classifyDriveSegment({ action: "do_not_wake", reason: "work_item_inactive" })?.state).toBe("awaiting-trigger");
  });
});
