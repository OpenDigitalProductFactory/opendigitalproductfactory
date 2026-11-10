import { describe, expect, it } from "vitest";

import {
  isSameWorkCase,
  toWorkUnitFromCapsule,
  toWorkUnitFromCoworkerEngagement,
  toWorkUnitFromWorkItem,
  toWorkUnitFromTaskRun,
} from "./work-unit";

describe("WorkUnit adapters", () => {
  it("maps a backlog-anchored capsule to a work-case ref", () => {
    const unit = toWorkUnitFromCapsule({
      capsuleId: "WC-1",
      title: "Work on BI-9",
      status: "working",
      backlogItemId: "BI-9",
      workItemId: "wi-1",
    });
    expect(unit.identity.carrier).toBe("work-capsule");
    expect(unit.identity.carrierId).toBe("WC-1");
    expect(unit.identity.caseRef).toEqual({ sourceType: "backlog-item", sourceId: "BI-9" });
    expect(unit.identity.workItemId).toBe("wi-1");
    expect(unit.identity.backlogItemId).toBe("BI-9");
    expect(unit.process.formula).toEqual(["frame", "propose", "collaborate", "review", "govern", "verify", "carry-over"]);
    expect(unit.currentState.status).toBe("working");
    expect(unit.carryOver.restartable).toBe(true);
  });

  it("leaves caseRef null for a capsule with no backlog item", () => {
    const unit = toWorkUnitFromCapsule({ capsuleId: "WC-2", title: "adhoc", status: "draft" });
    expect(unit.identity.caseRef).toEqual({ sourceType: "work-capsule", sourceId: "WC-2" });
    expect(unit.identity.backlogItemId).toBeNull();
    expect(unit.identity.workItemId).toBeNull();
  });

  it("maps a backlog-item WorkItem to a unit whose anchor is itself", () => {
    const unit = toWorkUnitFromWorkItem({
      id: "wi-1",
      sourceType: "backlog-item",
      sourceId: "BI-9",
      title: "Work on BI-9",
      status: "queued",
    });
    expect(unit.identity.carrier).toBe("work-item");
    expect(unit.identity.workItemId).toBe("wi-1");
    expect(unit.identity.backlogItemId).toBe("BI-9");
    expect(unit.identity.caseRef).toEqual({ sourceType: "backlog-item", sourceId: "BI-9" });
  });

  it("does not treat a non-backlog WorkItem source as a backlog item", () => {
    const unit = toWorkUnitFromWorkItem({
      id: "wi-2",
      sourceType: "opportunity",
      sourceId: "OPP-3",
      title: "deal",
      status: "active",
    });
    expect(unit.identity.backlogItemId).toBeNull();
    expect(unit.identity.caseRef).toEqual({ sourceType: "opportunity", sourceId: "OPP-3" });
  });

  it("adapts a TaskRun without inventing a second lifecycle", () => {
    const unit = toWorkUnitFromTaskRun({
      taskRunId: "TR-1",
      title: "Validate rollout",
      status: "input-required",
      contextId: "BI-9",
      initiatingAgentId: "release-manager",
      currentAgentId: "ops-coordinator",
    });
    expect(unit.identity).toMatchObject({
      carrier: "task-run",
      carrierId: "TR-1",
      caseRef: { sourceType: "backlog-item", sourceId: "BI-9" },
      backlogItemId: "BI-9",
    });
    expect(unit.participants).toEqual({
      accountableRef: "release-manager",
      contributorRefs: ["ops-coordinator"],
    });
    expect(unit.currentState.status).toBe("input-required");
  });

  it("adapts a CoworkerEngagement without inventing a second lifecycle", () => {
    const unit = toWorkUnitFromCoworkerEngagement({
      engagementId: "CE-1",
      requestedOutcome: "Prepare launch readiness.",
      status: "needs-approval",
      requestedByUserId: "user-1",
      providerAgentId: "agent-launch",
    });

    expect(unit.identity).toMatchObject({
      carrier: "coworker-engagement",
      carrierId: "CE-1",
      title: "Prepare launch readiness.",
      caseRef: { sourceType: "coworker-engagement", sourceId: "CE-1" },
      workItemId: null,
    });
    expect(unit.participants).toEqual({
      accountableRef: "user-1",
      contributorRefs: ["agent-launch"],
    });
  });

  it("recognizes a capsule and a work-item as the same case via the shared anchor", () => {
    const capsule = toWorkUnitFromCapsule({
      capsuleId: "WC-1",
      title: "t",
      status: "working",
      backlogItemId: "BI-9",
      workItemId: "wi-1",
    });
    const workItem = toWorkUnitFromWorkItem({
      id: "wi-1",
      sourceType: "backlog-item",
      sourceId: "BI-9",
      title: "t",
      status: "queued",
    });
    expect(isSameWorkCase(capsule, workItem)).toBe(true);
  });

  it("matches on caseRef when no workItem anchor is set yet", () => {
    const a = toWorkUnitFromCapsule({ capsuleId: "WC-1", title: "t", status: "working", backlogItemId: "BI-9" });
    const b = toWorkUnitFromWorkItem({ id: "wi-1", sourceType: "backlog-item", sourceId: "BI-9", title: "t", status: "queued" });
    expect(isSameWorkCase(a, b)).toBe(true);
  });

  it("does not match unrelated units", () => {
    const a = toWorkUnitFromCapsule({ capsuleId: "WC-1", title: "t", status: "working", backlogItemId: "BI-9" });
    const b = toWorkUnitFromWorkItem({ id: "wi-2", sourceType: "backlog-item", sourceId: "BI-10", title: "t", status: "queued" });
    expect(isSameWorkCase(a, b)).toBe(false);
  });
});
