/**
 * EP-WORK-POSTURE Slice H (BI-4EB2F1D0) — the provenance projection.
 *
 * Design: docs/superpowers/specs/2026-08-22-workroom-work-posture-design.md §9.
 *
 * The question this answers, for an operator who set a posture and is watching
 * something else happen: WHICH LAYER decided each value, and what drove it.
 *
 * This module DECIDES NOTHING. `resolveWorkPosture` already emits a complete
 * decision log — every clamp, in application order, with a stable `reasonCode`
 * — and this is a projection over it. The layer and the driver are read from
 * the reasonCode by lookup; they are never recomputed from the inputs, because
 * a second derivation is a second source of truth that can disagree with the
 * first (AGENTS.md §1).
 *
 * Pure: no React, no I/O, no ambient time.
 */
import type { PolicyAdjustment } from "@/lib/golden-triangle";

import type { PostureLayer, ResolvedWorkPosture } from "./resolve";

/**
 * What actually drove a derived clamp. The derived layer is one precedence
 * step but four distinct inputs, and "derived" alone does not tell an operator
 * whether to change the room's shape, its hours, or nothing at all.
 */
export type PostureProvenanceDriver =
  | "hard-policy"
  | "room-declaration"
  | "workroom-default"
  | "work-shape"
  | "activity-kind"
  | "archetype-stream"
  | "clock"
  | "room-mode"
  | "inherited"
  | "unclassified";

/**
 * reasonCode → the layer that emitted it. Exhaustive over the codes
 * `resolve.ts` and `derive.ts` actually emit; anything else falls to `derived`
 * with an `unclassified` driver rather than being dropped or guessed at.
 */
const LAYER_BY_REASON_CODE: Record<string, PostureLayer> = {
  hard_policy_floor: "hard-policy",
  regulated_ceiling: "hard-policy",
  room_declaration: "room-declaration",
  workroom_default: "workroom-default",
};

/** reasonCode prefix → the input that drove it. Order matters: longest first. */
const DRIVER_BY_PREFIX: ReadonlyArray<readonly [string, PostureProvenanceDriver]> = [
  ["hard_policy_", "hard-policy"],
  ["regulated_", "hard-policy"],
  ["room_declaration", "room-declaration"],
  ["workroom_default", "workroom-default"],
  ["shape_", "work-shape"],
  ["activity_", "activity-kind"],
  ["stream_", "archetype-stream"],
  ["clock_", "clock"],
  ["mode_", "room-mode"],
  // The composite priority shift. Its inputs are the accumulated axis biases,
  // which come from several drivers at once, so it is attributed to the shape
  // of the work as a whole — which is exactly what its reason text says.
  ["derived_priority_axis", "work-shape"],
];

export function layerForReasonCode(reasonCode: string): PostureLayer {
  return LAYER_BY_REASON_CODE[reasonCode] ?? "derived";
}

export function driverForReasonCode(reasonCode: string): PostureProvenanceDriver {
  for (const [prefix, driver] of DRIVER_BY_PREFIX) {
    if (reasonCode.startsWith(prefix)) return driver;
  }
  return "unclassified";
}

export interface PostureProvenanceStep {
  field: string;
  from: unknown;
  to: unknown;
  /** Carried verbatim so the view never re-words a clamp reason. */
  reasonCode: string;
  reason: string;
  driver: PostureProvenanceDriver;
  /**
   * True when this step produced the value the room is actually running at —
   * i.e. nothing after it moved the same field. A superseded clamp still shows,
   * because "policy overrode what this room asked for" is the answer an
   * operator came for.
   */
  decisive: boolean;
}

export interface PostureProvenanceLayer {
  layer: PostureLayer;
  /** Every step this layer contributed, in application order. */
  steps: PostureProvenanceStep[];
  /** Fields whose final value this layer is responsible for. */
  decidedFields: string[];
  /** False when the layer applied to this room and changed nothing. */
  contributed: boolean;
}

export interface PostureProvenance {
  /** EVERY layer, in precedence order, contributed or not. */
  layers: PostureProvenanceLayer[];
  /** True when no layer moved anything — the inherited posture stands. */
  inert: boolean;
}

/**
 * Precedence order, strongest first. Mirrors the ladder in `resolve.ts`'s
 * header, with `workroom-default` in its decided position: below derivation,
 * because what the work IS outranks a blanket preference about rooms.
 */
export const POSTURE_LAYER_ORDER: readonly PostureLayer[] = [
  "hard-policy",
  "room-declaration",
  "derived",
  "workroom-default",
  "agent",
  "organization",
  "platform",
];

/** The layers that never emit an adjustment — they are the starting point. */
const INHERITED_LAYERS: ReadonlySet<PostureLayer> = new Set(["agent", "organization", "platform"]);

type ProvenanceSource = Pick<
  ResolvedWorkPosture,
  "adjustments" | "inert" | "proactivitySource" | "prioritySource"
>;

/**
 * Project the resolver's decision log into a layer-by-layer account.
 *
 * The last adjustment to touch a field is the one that decided it, so decisive
 * steps fall out of the chain's order rather than needing a second pass over
 * the inputs.
 */
export function buildPostureProvenance(resolved: ProvenanceSource): PostureProvenance {
  const adjustments: readonly PolicyAdjustment[] = resolved.adjustments;

  // Index of the final adjustment per field — the decisive one.
  const lastIndexByField = new Map<string, number>();
  adjustments.forEach((adjustment, index) => lastIndexByField.set(adjustment.field, index));

  const stepsByLayer = new Map<PostureLayer, PostureProvenanceStep[]>();
  const decidedByLayer = new Map<PostureLayer, string[]>();

  adjustments.forEach((adjustment, index) => {
    const layer = layerForReasonCode(adjustment.reasonCode);
    const decisive = lastIndexByField.get(adjustment.field) === index;
    const step: PostureProvenanceStep = {
      field: adjustment.field,
      from: adjustment.from,
      to: adjustment.to,
      reasonCode: adjustment.reasonCode,
      reason: adjustment.reason,
      driver: driverForReasonCode(adjustment.reasonCode),
      decisive,
    };
    const steps = stepsByLayer.get(layer) ?? [];
    steps.push(step);
    stepsByLayer.set(layer, steps);
    if (decisive) {
      const decided = decidedByLayer.get(layer) ?? [];
      decided.push(adjustment.field);
      decidedByLayer.set(layer, decided);
    }
  });

  // The inherited layers emit no adjustments, so their responsibility is read
  // from the resolver's own source fields — the only record that a value came
  // from the coworker, the organization or the platform default untouched.
  attributeInherited(decidedByLayer, resolved.proactivitySource, "proactivityLevel");
  attributeInherited(decidedByLayer, resolved.prioritySource, "priority");

  const layers = POSTURE_LAYER_ORDER.map((layer) => {
    const steps = stepsByLayer.get(layer) ?? [];
    const decidedFields = decidedByLayer.get(layer) ?? [];
    return {
      layer,
      steps,
      decidedFields,
      contributed: steps.length > 0 || decidedFields.length > 0,
    };
  });

  return { layers, inert: resolved.inert };
}

function attributeInherited(
  decidedByLayer: Map<PostureLayer, string[]>,
  source: PostureLayer,
  field: string,
): void {
  if (!INHERITED_LAYERS.has(source)) return;
  const decided = decidedByLayer.get(source) ?? [];
  if (!decided.includes(field)) decided.push(field);
  decidedByLayer.set(source, decided);
}
