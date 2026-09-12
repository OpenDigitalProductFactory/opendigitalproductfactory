import { describe, expect, it } from "vitest";

import type { EffectiveHumanAccountability } from "./human-accountability";
import {
  everyDriveOutcome,
  resolveDriveConclusion,
  type DriveConclusionInput,
} from "./drive-conclusion";
import { listWorkShapes } from "./work-shapes";

const OWNED: EffectiveHumanAccountability = {
  state: "resolved",
  principalId: "PRN-OWNER",
  source: "explicit-room",
  inheritedFrom: ["WC-ROOM"],
};

const UNOWNED_MESSAGE =
  "This organization records no owner, so nothing can inherit accountability.";

const UNOWNED: EffectiveHumanAccountability = {
  state: "setup-required",
  reason: "no-organization-owner-recorded",
  message: UNOWNED_MESSAGE,
  atWorkroomId: null,
};

function input(overrides: Partial<DriveConclusionInput> = {}): DriveConclusionInput {
  return {
    action: "stop",
    reason: "unreachable_substrate",
    accountability: OWNED,
    ...overrides,
  };
}

describe("resolveDriveConclusion — the three legitimate states", () => {
  it("a completed cycle is outcome-met, and carries no blockage", () => {
    const decision = resolveDriveConclusion(input({ action: "stop", reason: "success" }));
    expect(decision.kind).toBe("outcome-met");
    expect(decision.blockage).toBeNull();
  });

  it("a dispatched or attended stage is in motion", () => {
    for (const [action, reason] of [
      ["dispatch_agent", "agent_stage"],
      ["attention", "role_stage"],
      ["attention", "person_stage"],
      ["attention", "governed_decision"],
    ] as const) {
      const decision = resolveDriveConclusion(
        input({ action, reason, attentionPrincipalRef: "person:PRN-1" }),
      );
      expect(decision.kind, `${action}/${reason}`).toBe("in-motion");
    }
  });

  it("a quiet posture is a cadence decision, not an unmet outcome", () => {
    const decision = resolveDriveConclusion(input({ action: "do_not_wake", reason: "quiet" }));
    expect(decision.kind).toBe("in-motion");
    expect(decision.summary).toContain("cadence");
  });

  it("a stop that concluded nothing is a blockage with an owner and an unblocking event", () => {
    const decision = resolveDriveConclusion(input({ action: "stop", reason: "unreachable_substrate" }));
    expect(decision.kind).toBe("blocked");
    expect(decision.blockage?.ownerPrincipalId).toBe("PRN-OWNER");
    expect(decision.blockage?.unblockedBy).toBe("the substrate answers a read again");
  });
});

describe("resolveDriveConclusion — silence is never the answer", () => {
  it("the four exits that used to stop and raise nothing are now blockages", () => {
    for (const [action, reason] of [
      ["do_not_wake", "missing_shape"],
      ["do_not_wake", "no_posture"],
      ["stop", "unreachable_substrate"],
      ["stop", "empty_read"],
    ] as const) {
      const decision = resolveDriveConclusion(input({ action, reason }));
      expect(decision.kind, `${action}/${reason}`).toBe("blocked");
      expect(decision.blockage?.what.length ?? 0).toBeGreaterThan(0);
      expect(decision.blockage?.unblockedBy.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("an attention that names nobody is waiting on nobody, whatever it is labelled", () => {
    const decision = resolveDriveConclusion(
      input({ action: "attention", reason: "role_stage", attentionPrincipalRef: null }),
    );
    expect(decision.kind).toBe("blocked");
    expect(decision.blockage?.what).toContain("waiting on nobody");
  });

  it("an unrecognised exit fails closed as unconcluded rather than assumed benign", () => {
    const decision = resolveDriveConclusion(
      input({ action: "stop", reason: "some_future_exit_nobody_classified" }),
    );
    expect(decision.kind).toBe("unconcluded");
    expect(decision.summary).toContain("names no conclusion");
  });
});

describe("resolveDriveConclusion — a blockage without an owner is a modelling defect", () => {
  it("does not store a blockage nobody can clear; it surfaces the setup that is missing", () => {
    const decision = resolveDriveConclusion(input({ accountability: UNOWNED }));
    expect(decision.kind).toBe("unconcluded");
    expect(decision.blockage?.ownerPrincipalId).toBeNull();
    expect(decision.blockage?.ownerSetupRequired).toBe(UNOWNED_MESSAGE);
    expect(decision.summary).toContain("No one can be named to clear it");
  });

  it("never invents an owner", () => {
    const decision = resolveDriveConclusion(input({ accountability: UNOWNED }));
    expect(JSON.stringify(decision)).not.toMatch(/PRN-OWNER/);
  });
});

describe("conformance — every drive outcome concludes (AC-CS-01)", () => {
  const outcomes = everyDriveOutcome();

  it("covers every action the drive can take", () => {
    expect(new Set(outcomes.map((o) => o.action))).toEqual(
      new Set(["do_not_wake", "stop", "escalate", "pause", "attention", "dispatch_agent"]),
    );
  });

  it("classifies every action/reason pair the drive can produce, with no silence", () => {
    const unclassified = outcomes.filter(({ action, reason }) => {
      const decision = resolveDriveConclusion(
        input({ action, reason, attentionPrincipalRef: "person:PRN-1" }),
      );
      return decision.kind === "unconcluded";
    });
    expect(unclassified).toEqual([]);
  });

  it("every blockage names an observable unblocking event, never a shrug", () => {
    for (const { action, reason } of outcomes) {
      const decision = resolveDriveConclusion(
        input({ action, reason, attentionPrincipalRef: "person:PRN-1" }),
      );
      if (decision.kind !== "blocked") continue;
      expect(decision.blockage?.unblockedBy, `${action}/${reason}`).toBeTruthy();
      // "someone looks at it" is not an unblocking event.
      expect(decision.blockage?.unblockedBy).not.toMatch(/someone (reviews|looks)/i);
    }
  });

  it("with no accountable owner, every blockage becomes a surfaced defect rather than a silent stop", () => {
    for (const { action, reason } of outcomes) {
      const owned = resolveDriveConclusion(
        input({ action, reason, attentionPrincipalRef: "person:PRN-1" }),
      );
      if (owned.kind !== "blocked") continue;
      const unowned = resolveDriveConclusion(
        input({ action, reason, attentionPrincipalRef: "person:PRN-1", accountability: UNOWNED }),
      );
      expect(unowned.kind, `${action}/${reason}`).toBe("unconcluded");
    }
  });
});

describe("conformance — every work shape can actually conclude (AC-CS-03)", () => {
  const shapes = listWorkShapes();

  it("the registry is not empty, so this walk means something", () => {
    expect(shapes.length).toBeGreaterThan(0);
  });

  it("every shape declares a way to succeed and a way to fail", () => {
    const missing = shapes
      .filter((shape) => {
        const kinds = new Set(shape.stopConditions.map((entry) => entry.kind));
        return !kinds.has("success") || !kinds.has("failure");
      })
      .map((shape) => shape.key);
    expect(missing).toEqual([]);
  });

  it("every stage names who answers for it, so a stop there can name an owner", () => {
    const anonymous = shapes.flatMap((shape) =>
      shape.stages
        .filter((stage) => !stage.accountablePrincipalRef?.trim())
        .map((stage) => `${shape.key}:${stage.key}`),
    );
    expect(anonymous).toEqual([]);
  });

  it("every stage key is unique within its shape, so a path cannot loop on itself", () => {
    const duplicated = shapes.flatMap((shape) => {
      const seen = new Set<string>();
      return shape.stages
        .filter((stage) => (seen.has(stage.key) ? true : (seen.add(stage.key), false)))
        .map((stage) => `${shape.key}:${stage.key}`);
    });
    expect(duplicated).toEqual([]);
  });

  it("every stage declares the evidence its conclusion rests on", () => {
    const evidenceless = shapes.flatMap((shape) =>
      shape.stages
        .filter((stage) => !Array.isArray(stage.evidence))
        .map((stage) => `${shape.key}:${stage.key}`),
    );
    expect(evidenceless).toEqual([]);
  });
});
