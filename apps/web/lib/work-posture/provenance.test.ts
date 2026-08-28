import { describe, expect, it } from "vitest";

import {
  buildPostureProvenance,
  driverForReasonCode,
  layerForReasonCode,
  POSTURE_LAYER_ORDER,
} from "./provenance";
import { resolveWorkPosture } from "./resolve";
import type { ProactivityPlan } from "@/lib/proactivity/proactivity-types";

function plan(overrides: Partial<ProactivityPlan> = {}): ProactivityPlan {
  return {
    resolvedLevel: "balanced",
    actionBoundary: "propose",
    evidenceRefs: [],
    explanation: "",
    ...overrides,
  } as ProactivityPlan;
}

describe("reasonCode classification", () => {
  it("attributes every layer-bearing code to its own layer", () => {
    expect(layerForReasonCode("hard_policy_floor")).toBe("hard-policy");
    expect(layerForReasonCode("regulated_ceiling")).toBe("hard-policy");
    expect(layerForReasonCode("room_declaration")).toBe("room-declaration");
    expect(layerForReasonCode("workroom_default")).toBe("workroom-default");
  });

  it("treats every derivation code as the derived layer", () => {
    for (const code of [
      "shape_outward_review",
      "activity_governance",
      "stream_trust_gate",
      "clock_out_of_hours",
      "mode_standing_between_cycles",
      "derived_priority_axis",
    ]) {
      expect(layerForReasonCode(code), code).toBe("derived");
    }
  });

  it("names the input that drove each derived clamp", () => {
    expect(driverForReasonCode("shape_escalation")).toBe("work-shape");
    expect(driverForReasonCode("activity_remediation")).toBe("activity-kind");
    expect(driverForReasonCode("stream_urgent_demand")).toBe("archetype-stream");
    expect(driverForReasonCode("clock_breach_imminent")).toBe("clock");
    expect(driverForReasonCode("mode_standing_between_cycles")).toBe("room-mode");
  });

  // The honest-fallthrough property: an unrecognised code must be visibly
  // unclassified rather than silently attributed to a plausible driver.
  it("reports an unknown code as unclassified rather than guessing", () => {
    expect(driverForReasonCode("task_class_tier_floor")).toBe("unclassified");
    expect(layerForReasonCode("something_new")).toBe("derived");
  });
});

describe("buildPostureProvenance", () => {
  it("renders every precedence layer, contributed or not", () => {
    const provenance = buildPostureProvenance({
      adjustments: [],
      inert: true,
      proactivitySource: "platform",
      prioritySource: "platform",
    });
    expect(provenance.layers.map((l) => l.layer)).toEqual([...POSTURE_LAYER_ORDER]);
    expect(provenance.inert).toBe(true);
  });

  it("marks an inert posture's layers as having contributed nothing", () => {
    const provenance = buildPostureProvenance({
      adjustments: [],
      inert: true,
      proactivitySource: "agent",
      prioritySource: "agent",
    });
    const contributed = provenance.layers.filter((l) => l.contributed).map((l) => l.layer);
    // Only the inherited layer that actually supplied the standing values.
    expect(contributed).toEqual(["agent"]);
  });

  it("attributes a clamp to the layer its reasonCode names", () => {
    const provenance = buildPostureProvenance({
      adjustments: [
        {
          field: "actionBoundary",
          from: "preauthorized",
          to: "propose",
          reasonCode: "shape_outward_review",
          reason: "Outward-facing review tightens authority.",
        },
        {
          field: "actionBoundary",
          from: "propose",
          to: "advise",
          reasonCode: "regulated_ceiling",
          reason: "This work is regulated, so the coworker advises rather than acts.",
        },
      ],
      inert: false,
      proactivitySource: "platform",
      prioritySource: "platform",
    });

    const derived = provenance.layers.find((l) => l.layer === "derived");
    const hard = provenance.layers.find((l) => l.layer === "hard-policy");
    expect(derived?.steps).toHaveLength(1);
    expect(hard?.steps).toHaveLength(1);
    // Hard policy applied last, so it owns the value in force.
    expect(hard?.decidedFields).toEqual(["actionBoundary"]);
    expect(derived?.decidedFields).toEqual([]);
    expect(derived?.steps[0]?.decisive).toBe(false);
    expect(hard?.steps[0]?.decisive).toBe(true);
  });

  // The load-bearing half: a superseded clamp must stay visible, because
  // "policy overrode what this room asked for" is the answer being sought.
  it("keeps a superseded clamp in the chain rather than dropping it", () => {
    const provenance = buildPostureProvenance({
      adjustments: [
        {
          field: "proactivityLevel",
          from: "balanced",
          to: "assertive",
          reasonCode: "room_declaration",
          reason: "The room declared this proactivity level when it was convened.",
        },
        {
          field: "proactivityLevel",
          from: "assertive",
          to: "quiet",
          reasonCode: "clock_out_of_hours",
          reason: "The business is closed.",
        },
      ],
      inert: false,
      proactivitySource: "derived",
      prioritySource: "platform",
    });
    const declaration = provenance.layers.find((l) => l.layer === "room-declaration");
    expect(declaration?.steps).toHaveLength(1);
    expect(declaration?.steps[0]?.decisive).toBe(false);
    expect(declaration?.steps[0]?.reason).toBe(
      "The room declared this proactivity level when it was convened.",
    );
  });

  it("carries the clamp reason verbatim from the adjustment", () => {
    const reason = "A policy floor applies that the posture cannot trade away.";
    const provenance = buildPostureProvenance({
      adjustments: [
        { field: "minimumTier", from: undefined, to: "strong", reasonCode: "hard_policy_floor", reason },
      ],
      inert: false,
      proactivitySource: "platform",
      prioritySource: "platform",
    });
    const hard = provenance.layers.find((l) => l.layer === "hard-policy");
    expect(hard?.steps[0]?.reason).toBe(reason);
  });
});

// End-to-end over the REAL resolver, so the projection cannot drift from the
// codes the resolver actually emits — the drift this module exists to prevent.
describe("provenance over a real resolution", () => {
  it("classifies every reasonCode a real resolution produces", () => {
    const resolved = resolveWorkPosture({
      inherited: { proactivityPlan: plan(), priority: null, source: "agent" },
      hardPolicy: { regulated: true },
      declaration: { proactivityLevel: "assertive" },
      shape: { shapeKey: "outward-review", activityKind: "governance", mode: "finite", cycleActive: false },
      stream: null,
      temporal: null,
    });

    const provenance = buildPostureProvenance(resolved);
    expect(resolved.adjustments.length).toBeGreaterThan(0);

    // No adjustment may land in the unclassified bucket: if the resolver grows
    // a new reasonCode, this fails rather than rendering an unexplained row.
    const unclassified = provenance.layers
      .flatMap((l) => l.steps)
      .filter((s) => s.driver === "unclassified");
    expect(unclassified, `unclassified: ${unclassified.map((s) => s.reasonCode).join(", ")}`).toEqual([]);

    // Every step is reachable from exactly one layer.
    const stepCount = provenance.layers.reduce((n, l) => n + l.steps.length, 0);
    expect(stepCount).toBe(resolved.adjustments.length);
  });

  it("is inert for a default context, matching the resolver", () => {
    const resolved = resolveWorkPosture({
      inherited: { proactivityPlan: plan(), priority: null, source: "platform" },
      shape: { shapeKey: null, activityKind: null, mode: "finite", cycleActive: false },
      stream: null,
      temporal: null,
    });
    const provenance = buildPostureProvenance(resolved);
    expect(provenance.inert).toBe(true);
    expect(provenance.layers.every((l) => l.steps.length === 0)).toBe(true);
  });
});
