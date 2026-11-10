// BI-CE564FBB: every work shape carries the standard improve activity, and a
// room inherits it from its declared shape with no per-room setup.

import { describe, expect, it } from "vitest";

import {
  CONTINUAL_IMPROVEMENT_MANAGER_REF,
  IMPROVE_ACTIVITY_EXECUTORS,
  validateImproveActivity,
} from "./improve-activity";
import { getWorkShape, getWorkShapeImproveActivity, listWorkShapes, resolveRoomImproveActivity } from "./work-shapes";

describe("the improve activity on every work shape", () => {
  it("is declared by every shape in the registry, and each declaration is valid", () => {
    const shapes = listWorkShapes();
    expect(shapes.length).toBeGreaterThan(20);
    const missing = shapes.filter((shape) => getWorkShapeImproveActivity(shape.key) === null).map((shape) => shape.key);
    expect(missing, "shapes without an improve activity").toEqual([]);
    for (const shape of shapes) {
      expect(validateImproveActivity(getWorkShapeImproveActivity(shape.key)!), shape.key).toEqual([]);
    }
  });

  it("is deterministic code by default, owned by the CI Manager, executed by the room's own Process Overseer", () => {
    for (const shape of listWorkShapes()) {
      const activity = getWorkShapeImproveActivity(shape.key)!;
      expect(activity.mode, shape.key).toBe("deterministic");
      expect(activity.judgement, shape.key).toBe("criteria-gated");
      expect(activity.ownerPrincipalRef, shape.key).toBe(CONTINUAL_IMPROVEMENT_MANAGER_REF);
      // The room's coordinator IS its Process Overseer (BI-3913EB49). No second overseer.
      expect(activity.executorRole, shape.key).toBe("coordinator");
    }
  });

  it("puts the delivery shapes in ring 0 under WWMD", () => {
    for (const key of ["delivery-small", "delivery-medium", "delivery-large", "delivery-xlarge", "delivery-break-fix"]) {
      expect(getWorkShape(key), key).not.toBeNull();
      const activity = getWorkShapeImproveActivity(key)!;
      expect(activity.layer, key).toBe("ring-0");
      expect(activity.decisionScope, key).toBe("wwmd");
    }
  });

  it("records misses from every executor, not only one client", () => {
    const activity = getWorkShapeImproveActivity("delivery-medium")!;
    expect([...activity.executors].sort()).toEqual([...IMPROVE_ACTIVITY_EXECUTORS].sort());
    expect(activity.executors).toContain("human");
  });

  it("is inherited by a room from its declared shape alone", () => {
    const activity = resolveRoomImproveActivity([{ workShape: "delivery-small@1.0.0" }]);
    expect(activity?.layer).toBe("ring-0");
    expect(resolveRoomImproveActivity([{ workShape: "payables-watch@1.1.0" }])?.layer).toBe("platform-operations");
    expect(resolveRoomImproveActivity([])).toBeNull();
    expect(resolveRoomImproveActivity([{ workShape: "no-such-shape@1.0.0" }])).toBeNull();
  });

  it("refuses a declaration that turns improvement off or hands it to a person", () => {
    const valid = getWorkShapeImproveActivity("delivery-small")!;
    expect(validateImproveActivity({ ...valid, mode: "off" as never })).not.toEqual([]);
    expect(validateImproveActivity({ ...valid, ownerPrincipalRef: "role:platform-owner" })).not.toEqual([]);
    expect(validateImproveActivity({ ...valid, executors: ["claude"] })).not.toEqual([]);
  });
});
