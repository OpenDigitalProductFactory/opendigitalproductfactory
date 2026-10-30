import { describe, expect, it } from "vitest";

import { resolveWorkPosture } from "@dpf/validators/workroom-policy/resolve";
import type { ProactivityPlan } from "@dpf/validators/workroom-policy/proactivity-types";
import { GENERIC_DEFAULTS } from "@/lib/operating-hours-types";

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

  it("still tightens the boundary outside a gate-governed room, out of hours too", () => {
    // BI-D0DFE502: the gate-governed exception below must not leak into rooms a
    // person reviews. A change-consequential room keeps "asks first", and the
    // closed business still quiets its pace.
    const result = resolveWorkPosture(
      base({
        shape: { shapeKey: "change-consequential" },
        workroomDefault: { proactivityLevel: "assertive", actionBoundary: "preauthorized" },
        temporal: CLOSED,
      }),
    );
    expect(result.actionBoundary).toBe("propose");
    expect(result.proactivityLevel).toBe("quiet");
  });
});

// BI-D0DFE502 / WWMD DI-EDAF65D71636: a room whose change already passes a
// governed gate chain (Build Studio: CI, merge queue, semantic review, DCO)
// proposes to those gates, not to a person. There the decreed default decides
// the boundary exactly as the runtime turn authority does, and the clock does
// not quiet it.
// 2026-10-15 is a Thursday; 22:00 UTC is after a nine-to-five close.
const CLOSED = {
  now: new Date("2026-10-15T22:00:00.000Z"),
  schedule: GENERIC_DEFAULTS,
  timezone: "UTC",
};

describe("the decreed workroom default in a gate-governed room", () => {
  it("decides the boundary and the pace, out of hours", () => {
    const result = resolveWorkPosture(
      base({
        gateGoverned: true,
        workroomDefault: { proactivityLevel: "assertive", actionBoundary: "preauthorized" },
        temporal: CLOSED,
      }),
    );
    expect(result.actionBoundary).toBe("preauthorized");
    expect(result.proactivityLevel).toBe("assertive");
    expect(result.proactivitySource).toBe("workroom-default");
  });

  it("ignores a shape's ask-first: the gates review the change", () => {
    const result = resolveWorkPosture(
      base({
        gateGoverned: true,
        shape: { shapeKey: "change-consequential" },
        workroomDefault: { actionBoundary: "preauthorized" },
      }),
    );
    expect(result.actionBoundary).toBe("preauthorized");
  });

  it("is still tightened by the room's own declaration", () => {
    const result = resolveWorkPosture(
      base({
        gateGoverned: true,
        workroomDefault: { actionBoundary: "preauthorized" },
        declaration: { actionBoundary: "propose" },
      }),
    );
    expect(result.actionBoundary).toBe("propose");
  });

  it("is still outranked by hard policy", () => {
    const result = resolveWorkPosture(
      base({
        gateGoverned: true,
        workroomDefault: { actionBoundary: "preauthorized" },
        hardPolicy: { regulated: true },
      }),
    );
    expect(result.actionBoundary).toBe("advise");
  });
});

describe("the decreed workroom default and hard policy", () => {
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
