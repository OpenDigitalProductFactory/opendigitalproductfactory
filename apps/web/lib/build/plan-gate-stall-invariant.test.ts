import { describe, expect, it, vi } from "vitest";

import { findPlanGateStall, runPlanGateStallInvariant, type PlanGateStallActivity } from "./plan-gate-stall-invariant";

// BI-9FA1F9CF: FB-9CAA65DE's live history on 2026-11-13/14 — plan review passed
// at 21:47 and every resume tick since was refused on PLAN_REQUIRED.
const at = (time: string) => new Date(`2026-11-13T${time}:00.000Z`);
const PASS = "Plan review: pass. Reviewer 1: ok";
const BLOCKED = "This cannot move into build yet because PLAN_REQUIRED (implementation-planner).";

function build(activities: PlanGateStallActivity[]) {
  return { id: "row-1", buildId: "FB-9CAA65DE", title: "Adopt every stuck PR", activities };
}

describe("findPlanGateStall (BI-9FA1F9CF)", () => {
  const live = [
    { tool: "reviewBuildPlan", summary: "Plan review: fail. Missing a task.", createdAt: at("21:44") },
    { tool: "reviewBuildPlan", summary: PASS, createdAt: at("21:47") },
    { tool: "phase:gate-blocked", summary: BLOCKED, createdAt: at("21:47") },
    { tool: "phase:gate-blocked", summary: BLOCKED, createdAt: at("22:17") },
  ];

  it("reports a passed plan refused on PLAN_REQUIRED for 15 minutes or more", () => {
    expect(findPlanGateStall(build(live), at("22:20"))).toMatchObject({
      buildId: "FB-9CAA65DE", planPassedAt: at("21:47"), blockedSince: at("21:47"), lastBlockedAt: at("22:17"),
    });
  });

  it("stays quiet inside the threshold", () => {
    expect(findPlanGateStall(build(live.slice(0, 3)), at("22:01"))).toBeNull();
  });

  it("stays quiet when the latest plan review did not pass", () => {
    expect(findPlanGateStall(build([...live, { tool: "reviewBuildPlan", summary: "Plan review: fail. x", createdAt: at("22:18") }]), at("23:00"))).toBeNull();
  });

  it("stays quiet when the build is now refused for something else", () => {
    const sibling = { tool: "phase:gate-blocked", summary: "Waiting on: Audit truck.", createdAt: at("22:30") };
    expect(findPlanGateStall(build([...live, sibling]), at("23:00"))).toBeNull();
  });

  it("dates the stall from the unbroken PLAN_REQUIRED run, not an earlier different refusal", () => {
    const rows = [
      { tool: "reviewBuildPlan", summary: PASS, createdAt: at("21:00") },
      { tool: "phase:gate-blocked", summary: BLOCKED, createdAt: at("21:01") },
      { tool: "phase:gate-blocked", summary: "Waiting on: Audit truck.", createdAt: at("21:30") },
      { tool: "phase:gate-blocked", summary: BLOCKED, createdAt: at("21:50") },
    ];
    expect(findPlanGateStall(build(rows), at("22:00"))).toBeNull();
    expect(findPlanGateStall(build(rows), at("22:06"))).toMatchObject({ blockedSince: at("21:50") });
  });

  it("ignores refusals logged before the passing review", () => {
    const rows = [
      { tool: "phase:gate-blocked", summary: BLOCKED, createdAt: at("20:00") },
      { tool: "reviewBuildPlan", summary: PASS, createdAt: at("21:47") },
    ];
    expect(findPlanGateStall(build(rows), at("23:00"))).toBeNull();
  });
});

describe("runPlanGateStallInvariant", () => {
  it("files one report per stalled build and nothing for the rest", async () => {
    const fileReport = vi.fn(async () => undefined);
    const result = await runPlanGateStallInvariant({
      now: () => at("22:20"),
      loadCandidates: async () => [
        build([{ tool: "reviewBuildPlan", summary: PASS, createdAt: at("21:47") }, { tool: "phase:gate-blocked", summary: BLOCKED, createdAt: at("21:47") }]),
        { ...build([{ tool: "reviewBuildPlan", summary: PASS, createdAt: at("22:15") }]), buildId: "FB-FRESH" },
      ],
      fileReport,
    });
    expect(result).toEqual({ checked: 2, stalled: ["FB-9CAA65DE"] });
    expect(fileReport).toHaveBeenCalledTimes(1);
  });
});
