import { describe, expect, it } from "vitest";

import {
  isSameWorkCase,
  toWorkUnitFromCapsule,
  toWorkUnitFromWorkItem,
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
    expect(unit.carrier).toBe("work-capsule");
    expect(unit.carrierId).toBe("WC-1");
    expect(unit.caseRef).toEqual({ sourceType: "backlog-item", sourceId: "BI-9" });
    expect(unit.workItemId).toBe("wi-1");
    expect(unit.backlogItemId).toBe("BI-9");
  });

  it("leaves caseRef null for a capsule with no backlog item", () => {
    const unit = toWorkUnitFromCapsule({ capsuleId: "WC-2", title: "adhoc", status: "draft" });
    expect(unit.caseRef).toBeNull();
    expect(unit.backlogItemId).toBeNull();
    expect(unit.workItemId).toBeNull();
  });

  it("maps a backlog-item WorkItem to a unit whose anchor is itself", () => {
    const unit = toWorkUnitFromWorkItem({
      id: "wi-1",
      sourceType: "backlog-item",
      sourceId: "BI-9",
      title: "Work on BI-9",
      status: "queued",
    });
    expect(unit.carrier).toBe("work-item");
    expect(unit.workItemId).toBe("wi-1");
    expect(unit.backlogItemId).toBe("BI-9");
    expect(unit.caseRef).toEqual({ sourceType: "backlog-item", sourceId: "BI-9" });
  });

  it("does not treat a non-backlog WorkItem source as a backlog item", () => {
    const unit = toWorkUnitFromWorkItem({
      id: "wi-2",
      sourceType: "opportunity",
      sourceId: "OPP-3",
      title: "deal",
      status: "active",
    });
    expect(unit.backlogItemId).toBeNull();
    expect(unit.caseRef).toEqual({ sourceType: "opportunity", sourceId: "OPP-3" });
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
