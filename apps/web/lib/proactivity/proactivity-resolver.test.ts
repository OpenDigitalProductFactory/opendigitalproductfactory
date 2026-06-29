import { describe, expect, it } from "vitest";

import { getProactivityLevelCopy } from "./proactivity-copy";
import { resolveProactivityPlan } from "./proactivity-resolver";
import { PROACTIVITY_ACTIVITY_FAMILIES, PROACTIVITY_LEVELS, isProactivityLevel } from "./proactivity-types";

describe("proactivity types", () => {
  it("keeps the persisted level enum closed and stable", () => {
    expect(PROACTIVITY_LEVELS).toEqual(["quiet", "balanced", "assertive"]);
    expect(isProactivityLevel("balanced")).toBe(true);
    expect(isProactivityLevel("aggressive")).toBe(false);
    expect(isProactivityLevel("not-proactive")).toBe(false);
  });

  it("includes the first implementation activity families", () => {
    expect(PROACTIVITY_ACTIVITY_FAMILIES).toContain("field-dispatch-appointment");
    expect(PROACTIVITY_ACTIVITY_FAMILIES).toContain("build-studio-custodian");
    expect(PROACTIVITY_ACTIVITY_FAMILIES).toContain("tax-compliance");
  });
});

describe("proactivity copy", () => {
  it("uses labels and descriptions that do not imply broader authority", () => {
    expect(getProactivityLevelCopy("assertive").label).toBe("Assertive");
    expect(getProactivityLevelCopy("assertive").description).toContain("warn earlier");
    expect(getProactivityLevelCopy("assertive").description).not.toMatch(/auto-approve|permission|authority/i);
  });

  it("pairs color with gauge treatment for every level", () => {
    expect(getProactivityLevelCopy("quiet").accent).toBe("green");
    expect(getProactivityLevelCopy("balanced").gaugeNeedle).toBe("center");
    expect(getProactivityLevelCopy("assertive").accent).toBe("red");
  });
});

describe("resolveProactivityPlan", () => {
  it("makes field-dispatch appointment delays assertive for slot-hours emergency work", () => {
    expect(
      resolveProactivityPlan({
        activityFamily: "field-dispatch-appointment",
        archetype: {
          demandSignature: "emergency-reactive",
          capacityUnit: "slot-hours",
          fieldDispatchRunningLate: true,
        },
        riskBand: "medium",
      }),
    ).toMatchObject({
      resolvedLevel: "assertive",
      channelPolicy: "urgent-channel",
      escalationTarget: "dispatcher",
      actionBoundary: "propose",
    });
  });

  it("keeps todo follow-up balanced and bounded", () => {
    const plan = resolveProactivityPlan({ activityFamily: "todo-follow-up" });

    expect(plan.resolvedLevel).toBe("balanced");
    expect(plan.maxAttempts).toBeLessThanOrEqual(2);
  });

  it("escalates Build Studio blocked work without increasing authority", () => {
    expect(
      resolveProactivityPlan({
        activityFamily: "build-studio-custodian",
        statusSignal: "stalled",
      }),
    ).toMatchObject({
      resolvedLevel: "assertive",
      actionBoundary: "propose",
    });
  });

  it("uses assertive reminders for tax deadlines but keeps action advisory or proposal-gated", () => {
    const plan = resolveProactivityPlan({
      activityFamily: "tax-compliance",
      deadlineWindowDays: 7,
      regulated: true,
    });

    expect(plan.resolvedLevel).toBe("assertive");
    expect(["advise", "propose"]).toContain(plan.actionBoundary);
  });
});
