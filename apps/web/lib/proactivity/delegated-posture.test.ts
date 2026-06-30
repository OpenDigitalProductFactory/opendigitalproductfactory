import { describe, expect, it } from "vitest";

import type { GoldenTrianglePreference } from "@/lib/golden-triangle";
import type { ProactivityPlan } from "./proactivity-types";
import { resolveDelegatedPosture } from "./delegated-posture";

function plan(resolvedLevel: ProactivityPlan["resolvedLevel"]): ProactivityPlan {
  return {
    resolvedLevel,
    policyId: `proactivity:test:${resolvedLevel}`,
    attentionWindowMinutes: 60,
    followUpCadenceMinutes: [],
    maxAttempts: 1,
    spendClass: resolvedLevel === "assertive" ? "elevated" : "standard",
    channelPolicy: "preferred-channel",
    escalationTarget: "attention-surface",
    actionBoundary: resolvedLevel === "quiet" ? "advise" : "propose",
    explanation: `${resolvedLevel} test plan`,
    evidenceRefs: [{ kind: "test", id: resolvedLevel }],
  };
}

const balancedPriority: GoldenTrianglePreference = {
  preset: "balanced",
  qualityWeight: 1 / 3,
  costWeight: 1 / 3,
  timeWeight: 1 / 3,
};

const fastPriority: GoldenTrianglePreference = {
  preset: "fast",
  qualityWeight: 0.1,
  costWeight: 0.1,
  timeWeight: 0.8,
};

const assuredPriority: GoldenTrianglePreference = {
  preset: "assured",
  qualityWeight: 0.8,
  costWeight: 0.1,
  timeWeight: 0.1,
};

describe("resolveDelegatedPosture", () => {
  it("inherits caller assertiveness and time priority as advisory context", () => {
    const resolved = resolveDelegatedPosture({
      caller: {
        agentId: "dispatch-coordinator",
        parentTaskRunId: "TR-PARENT",
        proactivityPlan: plan("assertive"),
        priority: fastPriority,
      },
      receiver: {
        agentId: "parts-specialist",
        localProactivityPlan: plan("balanced"),
        localPriority: balancedPriority,
      },
    });

    expect(resolved.executionAllowed).toBe(true);
    expect(resolved.proactivity).toMatchObject({
      inheritedLevel: "assertive",
      localLevel: "balanced",
      effectiveLevel: "assertive",
      source: "inherited-bias",
      actionBoundary: "propose",
    });
    expect(resolved.priority).toMatchObject({
      source: "inherited-bias",
      dominantAxis: "time",
      effective: fastPriority,
    });
    expect(resolved.metadata).toMatchObject({
      source: "delegated-coworker",
      fromAgentId: "dispatch-coordinator",
      toAgentId: "parts-specialist",
      parentTaskRunId: "TR-PARENT",
    });
  });

  it("keeps receiver quality floor ahead of caller time bias", () => {
    const resolved = resolveDelegatedPosture({
      caller: {
        agentId: "build-coordinator",
        proactivityPlan: plan("assertive"),
        priority: fastPriority,
      },
      receiver: {
        agentId: "security-reviewer",
        localProactivityPlan: plan("balanced"),
        localPriority: assuredPriority,
        constraints: {
          qualityCritical: true,
          regulated: true,
          reason: "Security review cannot trade away quality for speed.",
        },
      },
    });

    expect(resolved.executionAllowed).toBe(true);
    expect(resolved.priority).toMatchObject({
      source: "receiver-override",
      dominantAxis: "quality",
      effective: assuredPriority,
    });
    expect(resolved.proactivity.actionBoundary).toBe("propose");
    expect(resolved.proactivity.explanation).toContain("Security review cannot trade away quality");
  });

  it("uses receiver local posture when no caller posture is present", () => {
    const resolved = resolveDelegatedPosture({
      caller: {
        agentId: "researcher",
      },
      receiver: {
        agentId: "tax-specialist",
        localProactivityPlan: plan("balanced"),
        localPriority: assuredPriority,
      },
    });

    expect(resolved.executionAllowed).toBe(true);
    expect(resolved.proactivity.source).toBe("receiver-local");
    expect(resolved.proactivity.effectiveLevel).toBe("balanced");
    expect(resolved.priority.source).toBe("receiver-local");
    expect(resolved.priority.effective).toBe(assuredPriority);
  });
});
