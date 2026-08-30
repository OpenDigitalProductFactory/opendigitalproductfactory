import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    userFact: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@dpf/db", () => ({ prisma: mocks.prisma }));

import { getProactivityLevelCopy } from "./proactivity-copy";
import { resolveProactivityPlan, resolveProactivityPlanForLevel } from "./proactivity-resolver";
import { resolveUserAwareProactivityPlan } from "./proactivity-resolver.server";
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

  it("keeps forced assertive fallback explanation aligned with the resolved level", () => {
    const plan = resolveProactivityPlanForLevel({ activityFamily: "scheduled-task" }, "assertive", "user-override");

    expect(plan.resolvedLevel).toBe("assertive");
    expect(plan.explanation).toMatch(/stay on this|warn earlier|escalate sooner/i);
    expect(plan.explanation).not.toMatch(/quiet minimizes/i);
  });
});

describe("resolveUserAwareProactivityPlan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("applies the most specific acknowledged user override over rule defaults", async () => {
    mocks.prisma.userFact.findMany.mockResolvedValue([
      {
        id: "fact-agent",
        key: "aiCoworkerProactivity:agent:dispatcher",
        value: JSON.stringify({
          scopeKey: "agent:dispatcher",
          level: "quiet",
          acknowledgedAt: "2026-06-30T18:30:00.000Z",
        }),
        createdAt: new Date("2026-06-30T18:30:00.000Z"),
      },
      {
        id: "fact-family",
        key: "aiCoworkerProactivity:activity-family:field-dispatch-appointment",
        value: JSON.stringify({
          scopeKey: "activity-family:field-dispatch-appointment",
          level: "assertive",
          acknowledgedAt: "2026-06-30T18:00:00.000Z",
        }),
        createdAt: new Date("2026-06-30T18:00:00.000Z"),
      },
    ]);

    const plan = await resolveUserAwareProactivityPlan({
      userId: "user-1",
      input: {
        activityFamily: "field-dispatch-appointment",
        agentId: "dispatcher",
        archetype: {
          demandSignature: "emergency-reactive",
          capacityUnit: "slot-hours",
        },
      },
    });

    expect(plan).toMatchObject({
      resolvedLevel: "quiet",
      preferenceSource: "user-override",
      userOverrideScopeKey: "agent:dispatcher",
      policyId: "proactivity:field-dispatch-appointment:quiet",
      actionBoundary: "advise",
    });
    expect(plan.evidenceRefs).toContainEqual({ kind: "user-fact", id: "fact-agent" });
  });

  it("surfaces active cooldown facts so repeat proactivity suggestions can be suppressed", async () => {
    mocks.prisma.userFact.findMany.mockResolvedValue([
      {
        id: "cooldown-family",
        key: "aiCoworkerProactivityCooldown:activity-family:todo-follow-up",
        value: JSON.stringify({
          scopeKey: "activity-family:todo-follow-up",
          proposedLevel: "assertive",
          cooldownUntil: "2026-07-07T18:30:00.000Z",
        }),
        createdAt: new Date("2026-06-30T18:30:00.000Z"),
      },
    ]);

    const plan = await resolveUserAwareProactivityPlan({
      userId: "user-1",
      now: new Date("2026-07-01T12:00:00.000Z"),
      input: { activityFamily: "todo-follow-up" },
    });

    expect(plan).toMatchObject({
      resolvedLevel: "balanced",
      suggestionSuppressed: true,
      suggestionCooldownUntil: "2026-07-07T18:30:00.000Z",
      suggestionCooldownScopeKey: "activity-family:todo-follow-up",
    });
    expect(plan.evidenceRefs).toContainEqual({ kind: "user-fact", id: "cooldown-family" });
  });
});

describe("marketing-campaign proactivity (BI-C26FE785)", () => {
  it("is a real family the resolver knows, not a declared-but-unwired enum entry", () => {
    expect(PROACTIVITY_ACTIVITY_FAMILIES).toContain("marketing-campaign");

    const plan = resolveProactivityPlan({ activityFamily: "marketing-campaign" });

    expect(plan.policyId).toBe("proactivity:marketing-campaign:balanced");
    expect(plan.evidenceRefs).toContainEqual({ kind: "activity-family", id: "marketing-campaign" });
  });

  it("produces campaign work on a steady cadence by default", () => {
    const plan = resolveProactivityPlan({ activityFamily: "marketing-campaign" });

    expect(plan.resolvedLevel).toBe("balanced");
    expect(plan.explanation).toContain("steady cadence");
  });

  it("raises the work sooner only when a committed campaign date is within three days", () => {
    const near = resolveProactivityPlan({ activityFamily: "marketing-campaign", deadlineWindowDays: 2 });
    const far = resolveProactivityPlan({ activityFamily: "marketing-campaign", deadlineWindowDays: 10 });

    expect(near.resolvedLevel).toBe("assertive");
    expect(far.resolvedLevel).toBe("balanced");
  });

  it("never grants a preauthorized boundary at any level, so marketing cannot publish or spend on its own", () => {
    for (const level of PROACTIVITY_LEVELS) {
      const plan = resolveProactivityPlanForLevel({ activityFamily: "marketing-campaign" }, level);
      expect(plan.actionBoundary).not.toBe("preauthorized");
    }
  });

  it("keeps marketing off the urgent channel even when assertive", () => {
    const plan = resolveProactivityPlanForLevel({ activityFamily: "marketing-campaign" }, "assertive");

    // Contrast: security-incident is what the urgent channel exists for.
    const incident = resolveProactivityPlanForLevel({ activityFamily: "security-incident" }, "assertive");

    expect(plan.channelPolicy).toBe("preferred-channel");
    expect(incident.channelPolicy).toBe("urgent-channel");
  });

  it("escalates an unanswered campaign nudge to the owner, not the attention surface", () => {
    const plan = resolveProactivityPlan({ activityFamily: "marketing-campaign" });

    expect(plan.escalationTarget).toBe("owner");
  });

  it("explains quiet as produce-only-when-asked so the owner can predict the behaviour", () => {
    const plan = resolveProactivityPlanForLevel({ activityFamily: "marketing-campaign" }, "quiet");

    expect(plan.explanation).toContain("only when asked");
    expect(plan.actionBoundary).toBe("advise");
  });
});
