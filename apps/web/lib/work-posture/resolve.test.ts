import { describe, expect, it } from "vitest";

import { resolveWorkPosture, type WorkPostureInput } from "./resolve";
import { TIGHTEN_RANKS } from "./tighten";
import type {
  ProactivityActionBoundary,
  ProactivityLevel,
  ProactivityPlan,
} from "@/lib/proactivity/proactivity-types";
import type { GoldenTrianglePreference } from "@/lib/golden-triangle";
import type { WeeklySchedule } from "@/lib/operating-hours-types";

const LEVELS: ProactivityLevel[] = ["quiet", "balanced", "assertive"];
const BOUNDARIES: ProactivityActionBoundary[] = ["preauthorized", "propose", "advise"];

const BALANCED_PRIORITY: GoldenTrianglePreference = {
  costWeight: 1 / 3,
  qualityWeight: 1 / 3,
  timeWeight: 1 / 3,
  preset: "balanced",
};

function plan(
  resolvedLevel: ProactivityLevel,
  actionBoundary: ProactivityActionBoundary,
): ProactivityPlan {
  return {
    resolvedLevel,
    policyId: `proactivity:test:${resolvedLevel}`,
    attentionWindowMinutes: 60,
    followUpCadenceMinutes: [120],
    maxAttempts: 2,
    spendClass: "standard",
    channelPolicy: "preferred-channel",
    escalationTarget: "attention-surface",
    actionBoundary,
    explanation: "test",
    evidenceRefs: [],
  };
}

function baseInput(overrides: Partial<WorkPostureInput> = {}): WorkPostureInput {
  return {
    inherited: {
      proactivityPlan: plan("balanced", "propose"),
      priority: BALANCED_PRIORITY,
      source: "agent",
    },
    ...overrides,
  };
}

const NINE_TO_FIVE: WeeklySchedule = {
  monday: { enabled: true, open: "09:00", close: "17:00" },
  tuesday: { enabled: true, open: "09:00", close: "17:00" },
  wednesday: { enabled: true, open: "09:00", close: "17:00" },
  thursday: { enabled: true, open: "09:00", close: "17:00" },
  friday: { enabled: true, open: "09:00", close: "17:00" },
  saturday: { enabled: false, open: "09:00", close: "17:00" },
  sunday: { enabled: false, open: "09:00", close: "17:00" },
};

const WED_1000 = new Date("2026-08-19T10:00:00Z");
const WED_2200 = new Date("2026-08-19T22:00:00Z");

describe("resolveWorkPosture — Balanced-inert", () => {
  it("returns the inherited posture unchanged when nothing is declared or derivable", () => {
    const input = baseInput();
    const result = resolveWorkPosture(input);

    expect(result.proactivityLevel).toBe("balanced");
    expect(result.actionBoundary).toBe("propose");
    expect(result.priority).toBe(BALANCED_PRIORITY);
    expect(result.adjustments).toEqual([]);
    expect(result.inert).toBe(true);
    expect(result.proactivitySource).toBe("agent");
  });

  it("stays inert in-hours with an empty shape and no stream", () => {
    const result = resolveWorkPosture(
      baseInput({
        shape: { shapeKey: null, activityKind: null, mode: "finite" },
        stream: null,
        temporal: { now: WED_1000, schedule: NINE_TO_FIVE, timezone: "UTC" },
      }),
    );
    expect(result.inert).toBe(true);
    expect(result.temporalBand).toBe("in-hours");
  });

  it("stays inert for an unrecognised shape key", () => {
    expect(
      resolveWorkPosture(baseInput({ shape: { shapeKey: "not-a-shape" } })).inert,
    ).toBe(true);
  });
});

describe("resolveWorkPosture — the tighten-only invariant", () => {
  // The load-bearing property: across the FULL cross-product of inherited
  // postures and every derivable context, a derivation must never widen
  // authority, lower a tier floor, or drop a verification requirement.
  const CONTEXTS: Array<Partial<WorkPostureInput>> = [
    { shape: { shapeKey: "craft-stewardship" } },
    { shape: { shapeKey: "escalation" } },
    { shape: { shapeKey: "outward-review" } },
    { shape: { shapeKey: "change-consequential" } },
    { shape: { shapeKey: "approval-sign-off" } },
    { shape: { shapeKey: "specialist-alignment" } },
    { shape: { activityKind: "remediation" } },
    { shape: { activityKind: "governance" } },
    { shape: { activityKind: "launch-readiness" } },
    { shape: { mode: "standing", cycleActive: false } },
    { stream: { demandSignature: "emergency-reactive" } },
    { stream: { demandSignature: "steady" } },
    { stream: { capacityUnit: "slot-hours" } },
    { stream: { trustGates: ["identity-verified"] } },
    { stream: { loadBearingStageKeys: ["deliver"], stageKey: "deliver" } },
    { temporal: { now: WED_2200, schedule: NINE_TO_FIVE, timezone: "UTC" } },
    { temporal: { now: WED_1000, schedule: NINE_TO_FIVE, timezone: "UTC", dueAt: WED_1000 } },
  ];

  it("never widens the action boundary, for any inherited posture in any context", () => {
    for (const level of LEVELS) {
      for (const boundary of BOUNDARIES) {
        for (const context of CONTEXTS) {
          const result = resolveWorkPosture(
            baseInput({
              inherited: {
                proactivityPlan: plan(level, boundary),
                priority: BALANCED_PRIORITY,
                source: "agent",
              },
              ...context,
            }),
          );
          expect(
            TIGHTEN_RANKS.boundary[result.actionBoundary],
            `boundary widened from ${boundary} in ${JSON.stringify(context)}`,
          ).toBeGreaterThanOrEqual(TIGHTEN_RANKS.boundary[boundary]);
        }
      }
    }
  });

  it("never lowers a tier floor or drops a verification requirement", () => {
    for (const context of CONTEXTS) {
      const result = resolveWorkPosture(
        baseInput({
          hardPolicy: { minimumTierFloor: "strong", verificationDepthFloor: "shallow" },
          ...context,
        }),
      );
      expect(TIGHTEN_RANKS.tier[result.minimumTier!]).toBeGreaterThanOrEqual(
        TIGHTEN_RANKS.tier.strong,
      );
      expect(TIGHTEN_RANKS.verification[result.verificationDepth!]).toBeGreaterThanOrEqual(
        TIGHTEN_RANKS.verification.shallow,
      );
    }
  });

  it("out-of-hours damping reaches cadence only, never authority", () => {
    for (const boundary of BOUNDARIES) {
      const closed = resolveWorkPosture(
        baseInput({
          inherited: {
            proactivityPlan: plan("assertive", boundary),
            priority: BALANCED_PRIORITY,
            source: "agent",
          },
          temporal: { now: WED_2200, schedule: NINE_TO_FIVE, timezone: "UTC" },
        }),
      );
      // Cadence damped...
      expect(closed.proactivityLevel).toBe("balanced");
      // ...authority untouched.
      expect(closed.actionBoundary).toBe(boundary);
    }
  });

  it("does not damp an exempt family when the business is closed", () => {
    const result = resolveWorkPosture(
      baseInput({
        inherited: {
          proactivityPlan: plan("assertive", "propose"),
          priority: BALANCED_PRIORITY,
          source: "agent",
        },
        temporal: {
          now: WED_2200,
          schedule: NINE_TO_FIVE,
          timezone: "UTC",
          activityFamily: "security-incident",
        },
      }),
    );
    expect(result.temporalBand).toBe("in-hours");
    expect(result.proactivityLevel).toBe("assertive");
  });
});

describe("resolveWorkPosture — derivation", () => {
  it("an escalation shape raises persistence and pulls toward time", () => {
    const result = resolveWorkPosture(
      baseInput({
        inherited: {
          proactivityPlan: plan("quiet", "propose"),
          priority: BALANCED_PRIORITY,
          source: "agent",
        },
        shape: { shapeKey: "escalation" },
      }),
    );
    expect(result.proactivityLevel).toBe("assertive");
    expect(result.proactivitySource).toBe("derived");
    expect(result.priority!.timeWeight).toBeGreaterThan(result.priority!.costWeight);
  });

  it("an outward-review shape requires deep verification and a propose boundary", () => {
    const result = resolveWorkPosture(
      baseInput({
        inherited: {
          proactivityPlan: plan("balanced", "preauthorized"),
          priority: BALANCED_PRIORITY,
          source: "agent",
        },
        shape: { shapeKey: "outward-review" },
      }),
    );
    expect(result.verificationDepth).toBe("deep");
    expect(result.actionBoundary).toBe("propose");
  });

  it("a trust gate on the stage deepens verification for any archetype", () => {
    const result = resolveWorkPosture(
      baseInput({ stream: { trustGates: ["licence-checked"] } }),
    );
    expect(result.verificationDepth).toBe("deep");
  });

  it("a perishable capacity unit raises persistence", () => {
    expect(
      resolveWorkPosture(baseInput({ stream: { capacityUnit: "perishable-stock" } }))
        .proactivityLevel,
    ).toBe("assertive");
  });

  it("a steady demand signature contributes nothing", () => {
    expect(resolveWorkPosture(baseInput({ stream: { demandSignature: "steady" } })).inert).toBe(
      true,
    );
  });

  it("a craft-stewardship room is quieter — the quiet intent is expressed as damping", () => {
    // Regression guard: expressing this as `proactivityLevel: "quiet"` would be
    // silently inert, because the tighten-only clamps never lower proactivity.
    // Only `damp` can reduce cadence.
    const result = resolveWorkPosture(
      baseInput({
        inherited: {
          proactivityPlan: plan("assertive", "propose"),
          priority: BALANCED_PRIORITY,
          source: "agent",
        },
        shape: { shapeKey: "craft-stewardship" },
      }),
    );
    expect(result.proactivityLevel).toBe("balanced");
    expect(result.actionBoundary).toBe("propose");
  });

  it("a standing room between cycles is quieter, but not between-cycles when active", () => {
    expect(
      resolveWorkPosture(baseInput({ shape: { mode: "standing", cycleActive: false } }))
        .proactivityLevel,
    ).toBe("quiet");
    expect(
      resolveWorkPosture(baseInput({ shape: { mode: "standing", cycleActive: true } })).inert,
    ).toBe(true);
  });

  it("a deadline beats the closed-business clock", () => {
    const result = resolveWorkPosture(
      baseInput({
        temporal: {
          now: WED_2200,
          schedule: NINE_TO_FIVE,
          timezone: "UTC",
          dueAt: new Date("2026-08-20T00:00:00Z"),
        },
      }),
    );
    expect(result.temporalBand).toBe("pre-deadline");
    expect(result.proactivityLevel).toBe("assertive");
  });
});

describe("resolveWorkPosture — precedence", () => {
  it("a room declaration outranks derivation for the proactivity level", () => {
    const result = resolveWorkPosture(
      baseInput({
        shape: { shapeKey: "escalation" }, // derives assertive
        declaration: { proactivityLevel: "quiet" },
      }),
    );
    expect(result.proactivityLevel).toBe("quiet");
    expect(result.proactivitySource).toBe("room-declaration");
  });

  it("a room declaration may still only tighten the action boundary", () => {
    const result = resolveWorkPosture(
      baseInput({
        inherited: {
          proactivityPlan: plan("balanced", "advise"),
          priority: BALANCED_PRIORITY,
          source: "agent",
        },
        declaration: { actionBoundary: "preauthorized" }, // attempts to widen
      }),
    );
    expect(result.actionBoundary).toBe("advise");
  });

  it("hard policy outranks the room declaration", () => {
    const result = resolveWorkPosture(
      baseInput({
        declaration: { actionBoundary: "preauthorized" },
        hardPolicy: { actionBoundaryFloor: "propose" },
      }),
    );
    expect(result.actionBoundary).toBe("propose");
  });

  it("regulated work is advised, never acted, whatever anything else says", () => {
    const result = resolveWorkPosture(
      baseInput({
        inherited: {
          proactivityPlan: plan("assertive", "preauthorized"),
          priority: BALANCED_PRIORITY,
          source: "agent",
        },
        declaration: { actionBoundary: "preauthorized" },
        shape: { shapeKey: "escalation" },
        hardPolicy: { regulated: true },
      }),
    );
    expect(result.actionBoundary).toBe("advise");
  });
});

describe("resolveWorkPosture — provenance", () => {
  it("records every clamp with a stable reason code", () => {
    const result = resolveWorkPosture(
      baseInput({
        inherited: {
          proactivityPlan: plan("quiet", "preauthorized"),
          priority: BALANCED_PRIORITY,
          source: "agent",
        },
        shape: { shapeKey: "outward-review" },
        hardPolicy: { minimumTierFloor: "frontier" },
      }),
    );
    const codes = result.adjustments.map((a) => a.reasonCode);
    expect(codes).toContain("shape_outward_review");
    expect(codes).toContain("hard_policy_floor");
    for (const adjustment of result.adjustments) {
      expect(adjustment.reasonCode).toMatch(/^[a-z0-9_]+$/);
      expect(adjustment.reason.length).toBeGreaterThan(0);
    }
  });

  it("is deterministic", () => {
    const input = baseInput({
      shape: { shapeKey: "approval-sign-off" },
      stream: { demandSignature: "emergency-reactive" },
      temporal: { now: WED_1000, schedule: NINE_TO_FIVE, timezone: "UTC" },
    });
    expect(resolveWorkPosture(input)).toEqual(resolveWorkPosture(input));
  });
});
