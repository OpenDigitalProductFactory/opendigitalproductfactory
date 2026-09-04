import { describe, expect, it } from "vitest";

import { resolveWorkroomPosture, type WorkroomPostureContext } from "./room-posture";
import type { ProactivityPlan } from "@/lib/proactivity/proactivity-types";
import type { WeeklySchedule } from "@/lib/operating-hours-types";

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

const PLAN: ProactivityPlan = {
  resolvedLevel: "balanced",
  policyId: "proactivity:test:balanced",
  attentionWindowMinutes: 60,
  followUpCadenceMinutes: [120],
  maxAttempts: 2,
  spendClass: "standard",
  channelPolicy: "preferred-channel",
  escalationTarget: "attention-surface",
  actionBoundary: "propose",
  explanation: "test",
  evidenceRefs: [],
};

function context(overrides: Partial<WorkroomPostureContext> = {}): WorkroomPostureContext {
  return {
    inherited: { proactivityPlan: PLAN, priority: null, source: "platform" },
    operatingHours: { schedule: NINE_TO_FIVE, timezone: "UTC", lowTrafficWindows: [] },
    ...overrides,
  };
}

const FACTS = {
  shapeKey: null,
  activityKind: null,
  mode: "finite",
  cycleActive: false,
  dueAt: null,
  declaration: null,
};

describe("resolveWorkroomPosture", () => {
  it("returns null when the loader supplied no context", () => {
    // A room with no known baseline has no posture. Fabricating one would be
    // worse than saying nothing.
    expect(resolveWorkroomPosture(FACTS, null, WED_1000)).toBeNull();
    expect(resolveWorkroomPosture(FACTS, undefined, WED_1000)).toBeNull();
  });

  it("is inert for a plain room during business hours", () => {
    const posture = resolveWorkroomPosture(FACTS, context(), WED_1000)!;
    expect(posture.inert).toBe(true);
    expect(posture.proactivityLevel).toBe("balanced");
    expect(posture.actionBoundary).toBe("propose");
    expect(posture.temporalBand).toBe("in-hours");
  });

  it("damps cadence out of hours without touching authority", () => {
    const posture = resolveWorkroomPosture(FACTS, context(), WED_2200)!;
    expect(posture.temporalBand).toBe("out-of-hours");
    expect(posture.proactivityLevel).toBe("quiet");
    expect(posture.actionBoundary).toBe("propose");
  });

  it("raises pace for an escalation-shaped room", () => {
    const posture = resolveWorkroomPosture(
      { ...FACTS, shapeKey: "escalation" },
      context(),
      WED_1000,
    )!;
    expect(posture.proactivityLevel).toBe("assertive");
    expect(posture.proactivitySource).toBe("derived");
  });

  it("lets the room's own declaration outrank the derivation", () => {
    const posture = resolveWorkroomPosture(
      { ...FACTS, shapeKey: "escalation", declaration: { proactivityLevel: "quiet" } },
      context(),
      WED_1000,
    )!;
    expect(posture.proactivityLevel).toBe("quiet");
    expect(posture.proactivitySource).toBe("room-declaration");
  });

  it("never lets a declaration widen authority", () => {
    const posture = resolveWorkroomPosture(
      { ...FACTS, declaration: { actionBoundary: "preauthorized" } },
      context({
        inherited: {
          proactivityPlan: { ...PLAN, actionBoundary: "advise" },
          priority: null,
          source: "platform",
        },
      }),
      WED_1000,
    )!;
    expect(posture.actionBoundary).toBe("advise");
  });

  it("uses the room's own due date for the deadline bands", () => {
    const posture = resolveWorkroomPosture(
      { ...FACTS, dueAt: "2026-08-20T00:00:00.000Z" }, // clock-bomb-guard: allow `now` is passed explicitly (WED_2200), so wall-clock never enters this assertion
      context(),
      WED_2200,
    )!;
    // Closed, but due in two hours — the deadline wins.
    expect(posture.temporalBand).toBe("pre-deadline");
    expect(posture.proactivityLevel).toBe("assertive");
  });

  it("ignores a malformed due date rather than throwing", () => {
    const posture = resolveWorkroomPosture({ ...FACTS, dueAt: "not-a-date" }, context(), WED_1000)!;
    expect(posture.temporalBand).toBe("in-hours");
  });

  it("deepens verification when the archetype's stage carries a trust gate", () => {
    const posture = resolveWorkroomPosture(
      FACTS,
      context({ stream: { trustGates: ["identity-verified"] } }),
      WED_1000,
    )!;
    expect(posture.verificationDepth).toBe("deep");
  });

  it("threads build rightsizing stakes through the room posture resolver", () => {
    const posture = resolveWorkroomPosture(
      { ...FACTS, stakes: { qualityFirst: true, deliverableSensitivity: "high" } },
      context(),
      WED_1000,
    )!;
    expect(posture.verificationDepth).toBe("deep");
    expect(posture.adjustments).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "verificationDepth", reasonCode: "stakes_high_sensitivity" }),
    ]));
  });

  it("raises pace for an emergency-reactive archetype", () => {
    const posture = resolveWorkroomPosture(
      FACTS,
      context({ stream: { demandSignature: "emergency-reactive" } }),
      WED_1000,
    )!;
    expect(posture.proactivityLevel).toBe("assertive");
  });

  it("does not damp an exempt activity family when the business is closed", () => {
    const posture = resolveWorkroomPosture(
      FACTS,
      context({ activityFamily: "platform-health" }),
      WED_2200,
    )!;
    expect(posture.temporalBand).toBe("in-hours");
    expect(posture.proactivityLevel).toBe("balanced");
  });

  it("treats a standing room between cycles as quieter", () => {
    const posture = resolveWorkroomPosture(
      { ...FACTS, mode: "standing", cycleActive: false },
      context(),
      WED_1000,
    )!;
    expect(posture.proactivityLevel).toBe("quiet");
  });

  it("is deterministic for a fixed instant", () => {
    const args = [{ ...FACTS, shapeKey: "outward-review" }, context(), WED_1000] as const;
    expect(resolveWorkroomPosture(...args)).toEqual(resolveWorkroomPosture(...args));
  });
});
