import { describe, expect, it } from "vitest";

import {
  WORK_CASE_STATES,
  projectWorkCaseState,
  projectWorkUnitState,
} from "./status-projection";
import { toWorkUnitFromTaskRun } from "./work-unit";

describe("Work Case status projection", () => {
  it("defines the company-facing state vocabulary from the spec", () => {
    expect(WORK_CASE_STATES).toEqual([
      "intake",
      "triage",
      "active",
      "waiting-on-person",
      "waiting-on-system",
      "awaiting-decision",
      "verifying",
      "resolved",
      "closed",
      "cancelled",
    ]);
  });

  it("projects WorkItem queue states without merging the source enum", () => {
    expect(
      projectWorkCaseState({
        workItem: { itemId: "WI-1", status: "queued" },
      }),
    ).toMatchObject({
      state: "intake",
      a2aStatus: "submitted",
      sourceRef: { kind: "work-item", id: "WI-1", status: "queued" },
    });

    expect(
      projectWorkCaseState({
        workItem: { itemId: "WI-2", status: "in-progress" },
      }),
    ).toMatchObject({
      state: "active",
      a2aStatus: "working",
      sourceRef: { kind: "work-item", id: "WI-2", status: "in-progress" },
    });
  });

  it("projects human and approval waits to A2A input-required", () => {
    expect(
      projectWorkCaseState({
        workItem: { itemId: "WI-3", status: "awaiting-input" },
      }),
    ).toMatchObject({
      state: "waiting-on-person",
      a2aStatus: "input-required",
      blockingActorKind: "person",
    });

    expect(
      projectWorkCaseState({
        decision: { decisionId: "DI-1", status: "pending-human" },
      }),
    ).toMatchObject({
      state: "awaiting-decision",
      a2aStatus: "input-required",
      blockingActorKind: "decision",
      sourceRef: { kind: "decision-interaction", id: "DI-1" },
    });
  });

  it("projects coworker service engagement approval and terminal states", () => {
    expect(
      projectWorkCaseState({
        coworkerEngagement: { engagementId: "CE-1", status: "needs-approval" },
      }),
    ).toMatchObject({
      state: "awaiting-decision",
      a2aStatus: "input-required",
      blockingActorKind: "decision",
      sourceRef: { kind: "coworker-engagement", id: "CE-1", status: "needs-approval" },
    });

    expect(
      projectWorkCaseState({
        coworkerEngagement: { engagementId: "CE-2", status: "completed" },
      }),
    ).toMatchObject({
      state: "resolved",
      a2aStatus: "completed",
      terminal: true,
    });

    expect(
      projectWorkCaseState({
        coworkerEngagement: { engagementId: "CE-3", status: "rejected" },
      }),
    ).toMatchObject({
      state: "cancelled",
      a2aStatus: "rejected",
      terminal: true,
    });
  });

  it("prioritizes capsule and verification states over a still-open queue item", () => {
    expect(
      projectWorkCaseState({
        workItem: { itemId: "WI-4", status: "in-progress" },
        capsule: { capsuleId: "WC-1", status: "blocked" },
      }),
    ).toMatchObject({
      state: "waiting-on-system",
      blockingActorKind: "system",
      sourceRef: { kind: "work-capsule", id: "WC-1", status: "blocked" },
    });

    expect(
      projectWorkCaseState({
        workItem: { itemId: "WI-5", status: "in-progress" },
        runtimeVerification: { verificationId: "RV-1", status: "passed" },
      }),
    ).toMatchObject({
      state: "resolved",
      a2aStatus: "completed",
      sourceRef: { kind: "runtime-verification", id: "RV-1", status: "passed" },
    });
  });

  it("marks terminal projected states as sealed", () => {
    expect(
      projectWorkCaseState({
        workItem: { itemId: "WI-6", status: "completed" },
      }),
    ).toMatchObject({ state: "resolved", terminal: true });

    expect(
      projectWorkCaseState({
        workItem: { itemId: "WI-7", status: "cancelled" },
      }),
    ).toMatchObject({ state: "cancelled", terminal: true });
  });

  it("projects carrier-neutral WorkUnits through the same authority", () => {
    const task = toWorkUnitFromTaskRun({
      taskRunId: "TR-9",
      title: "Ask owner",
      status: "input-required",
      contextId: "BI-9",
    });
    expect(projectWorkUnitState(task)).toMatchObject({
      state: "waiting-on-person",
      a2aStatus: "input-required",
      sourceRef: { kind: "task-run", id: "TR-9", status: "input-required" },
    });
  });
});
