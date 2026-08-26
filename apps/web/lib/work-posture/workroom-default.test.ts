import { describe, expect, it } from "vitest";

import { resolveWorkPosture } from "./resolve";
import type { ProactivityPlan } from "@/lib/proactivity/proactivity-types";

// EP-WORK-POSTURE — the DECREED DEFAULT for rooms.
//
// The gap this closes: the platform could default how a COWORKER behaves, and a
// room could declare its own posture, but there was nowhere to say "this is how
// work in a room behaves here unless the room says otherwise". Those are
// different questions and only the first had a control.

const PLAN: ProactivityPlan = {
  resolvedLevel: "balanced",
  policyId: "proactivity:test",
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

function base(overrides = {}) {
  return {
    inherited: { proactivityPlan: PLAN, priority: null, source: "platform" as const },
    ...overrides,
  };
}

describe("the decreed workroom default", () => {
  it("applies when nothing more specific spoke", () => {
    const result = resolveWorkPosture(
      base({ workroomDefault: { proactivityLevel: "assertive" } }),
    );
    expect(result.proactivityLevel).toBe("assertive");
    expect(result.proactivitySource).toBe("workroom-default");
    expect(result.adjustments.map((a) => a.reasonCode)).toContain("workroom_default");
  });

  it("does NOT override what the work itself asked for", () => {
    // craft-stewardship damps; a blanket "rooms should push" preference must not
    // overrule the shape of the job in front of you.
    const result = resolveWorkPosture(
      base({
        shape: { shapeKey: "craft-stewardship" },
        workroomDefault: { proactivityLevel: "assertive" },
      }),
    );
    expect(result.proactivitySource).toBe("derived");
    expect(result.proactivityLevel).not.toBe("assertive");
  });

  it("is outranked by the room's own declaration", () => {
    const result = resolveWorkPosture(
      base({
        workroomDefault: { proactivityLevel: "assertive" },
        declaration: { proactivityLevel: "quiet" },
      }),
    );
    expect(result.proactivityLevel).toBe("quiet");
    expect(result.proactivitySource).toBe("room-declaration");
  });

  it("can only TIGHTEN authority, never widen it", () => {
    // Decreeing "rooms may act alone" cannot hand a coworker more freedom than
    // its own policy already granted.
    const result = resolveWorkPosture(
      base({
        inherited: {
          proactivityPlan: { ...PLAN, actionBoundary: "advise" },
          priority: null,
          source: "platform" as const,
        },
        workroomDefault: { actionBoundary: "preauthorized" },
      }),
    );
    expect(result.actionBoundary).toBe("advise");
  });

  it("tightens when the decree is stricter than the inherited boundary", () => {
    const result = resolveWorkPosture(
      base({
        inherited: {
          proactivityPlan: { ...PLAN, actionBoundary: "preauthorized" },
          priority: null,
          source: "platform" as const,
        },
        workroomDefault: { actionBoundary: "advise" },
      }),
    );
    expect(result.actionBoundary).toBe("advise");
  });

  it("is inert when no default is decreed", () => {
    expect(resolveWorkPosture(base()).inert).toBe(true);
    expect(resolveWorkPosture(base({ workroomDefault: null })).inert).toBe(true);
  });

  it("is still outranked by hard policy", () => {
    const result = resolveWorkPosture(
      base({
        workroomDefault: { actionBoundary: "preauthorized" },
        hardPolicy: { regulated: true },
      }),
    );
    expect(result.actionBoundary).toBe("advise");
  });
});
