import { describe, expect, it, vi } from "vitest";
import { loadPlanBaselinePrerequisite } from "./plan-baseline-prerequisite";
import { readinessRequirement } from "./readiness-guidance";
import type { InitiativeReadinessDecision } from "./types";

const item = { id: "row-child", itemId: "BI-CHILD" };
const decision: InitiativeReadinessDecision = {
  decisionId: "IRD-PLAN", policyVersion: "initiative-readiness.v3",
  subject: { kind: "backlog-item", id: item.itemId },
  transitionObject: { kind: "work-capsule", id: "WC-PLAN", expectedVersion: "claim.v1", targetState: "implementation" },
  profile: "fix", target: "implementation", verdict: "input-required", satisfied: [], blockers: [],
  unmet: [readinessRequirement({ code: "PLAN_REQUIRED", state: "missing", accountableRole: "plan-author" })],
  evaluatedAt: "2026-10-23T00:00:00Z",
};
function database() {
  return { backlogItem: { findFirst: vi.fn().mockResolvedValue(null) },
    backlogItemActivity: { findMany: vi.fn().mockResolvedValue([]) } };
}
const baseline = (payload: unknown) => ({ id: "old-baseline", kind: "initiative_scope_baseline",
  recordedAt: new Date("2026-09-01T00:00:00Z"), payload });

describe("plan baseline prerequisite independent of delivery closure", () => {
  it.each(["verified", "not-applicable"])("finds a missing baseline with %s design observation", async currentDesignState => {
    const db = database();
    expect(await loadPlanBaselinePrerequisite({ db, item, decision, currentDesignState })).toMatchObject({
      code: "OBJECTIVE_BASELINE_REQUIRED", state: "missing", accountableRole: "design-checklist-reviewer",
    });
    expect(db.backlogItemActivity.findMany).toHaveBeenCalledWith({
      where: { backlogItemId: item.id, kind: "initiative_scope_baseline" },
      orderBy: [{ recordedAt: "asc" }, { id: "asc" }],
      select: { id: true, backlogItemId: true, kind: true, recordedAt: true, payload: true },
    });
  });

  it.each([
    [{ baselineId: "old", supersedesBaselineId: null }],
    [{ origin: "item-body", baselineId: "body" }],
    [null],
    [{ baselineId: "a", supersedesBaselineId: "b" }, { baselineId: "b", supersedesBaselineId: "a" }],
  ])("does not treat retained history as absent: %j", async (...payloads) => {
    const db = database();
    db.backlogItemActivity.findMany.mockResolvedValueOnce(payloads.map(baseline));
    expect(await loadPlanBaselinePrerequisite({ db, item, decision, currentDesignState: "not-applicable" })).toBeNull();
    expect(db.backlogItemActivity.findMany).toHaveBeenCalledTimes(1);
  });

  it("respects a baseline inherited through the parent's plan coverage", async () => {
    const db = database();
    db.backlogItem.findFirst.mockResolvedValue({ itemId: "BI-PARENT" } as never);
    db.backlogItemActivity.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "coverage", backlogItemId: "row-parent", payload: {
        schemaVersion: 2, decision: "decomposed", planPath: "docs/superpowers/plans/parent.md",
        deliverables: [{ key: "child", backlogItemId: item.itemId }],
      } }])
      .mockResolvedValueOnce([baseline({ baselineId: "parent", supersedesBaselineId: null })]);
    expect(await loadPlanBaselinePrerequisite({ db, item, decision, currentDesignState: "not-applicable" })).toBeNull();
    expect(db.backlogItem.findFirst).toHaveBeenCalled();
  });

  it.each(["unavailable", "recorded-only", undefined])("does not infer absence from %s design evidence", async currentDesignState => {
    const db = database();
    expect(await loadPlanBaselinePrerequisite({ db, item, decision, currentDesignState })).toBeNull();
    expect(db.backlogItemActivity.findMany).not.toHaveBeenCalled();
  });

  it.each([
    { ...decision, verdict: "allowed" as const },
    { ...decision, verdict: "denied" as const },
    { ...decision, target: "plan" as const },
    { ...decision, unmet: [] },
    undefined,
  ])("does not add reviews when implementation does not owe plan coverage", async candidate => {
    const db = database();
    expect(await loadPlanBaselinePrerequisite({ db, item, decision: candidate, currentDesignState: "verified" })).toBeNull();
    expect(db.backlogItemActivity.findMany).not.toHaveBeenCalled();
  });

  it("propagates unavailable history instead of representing it as missing", async () => {
    const db = database();
    db.backlogItemActivity.findMany.mockRejectedValue(new Error("history unavailable"));
    await expect(loadPlanBaselinePrerequisite({ db, item, decision, currentDesignState: "not-applicable" }))
      .rejects.toThrow("history unavailable");
  });
});
