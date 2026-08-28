/**
 * EP-WORK-POSTURE Slice B (BI-0C5A83A8) — the work-posture resolver.
 *
 * Design: docs/superpowers/specs/2026-08-22-workroom-work-posture-design.md §3.
 *
 * ONE precedence ladder for BOTH postures. This does not replace
 * `resolveProactivityPlan` or `compileGoldenTrianglePolicy` — it composes over
 * them:
 *
 *   1. Hard policy      residency · sensitivity · regulated ceiling (never relaxed)
 *   2. Room declaration an explicit choice made when the room was convened
 *   3. Derived          work shape × archetype stream × clock × stakes
 *   4. Agent            the coworker's own saved posture
 *   5. Org / activity-family
 *   6. Platform default Balanced/balanced
 *
 * Layers 1, 4, 5 and 6 already exist and keep their current meaning; the
 * resolver receives their result as `inherited` and layers 2 and 3 on top.
 *
 * Two properties make this safe to put on the hot path:
 *
 *   TIGHTEN-ONLY  Every derived delta is applied through `tighten.ts`, which
 *                 can only move a value in the tightening direction. A widening
 *                 derivation is unrepresentable, not merely untested.
 *
 *   BALANCED-INERT  A fully default context derives no deltas, so the result is
 *                 the inherited posture unchanged — byte-identical to today.
 *
 * Pure and deterministic: no I/O, no ambient Date, no random. `now` and the
 * schedule arrive as inputs.
 */
import type { QualityTier } from "@/lib/routing/quality-tiers";
import type {
  ProactivityActionBoundary,
  ProactivityLevel,
  ProactivityPlan,
} from "@/lib/proactivity/proactivity-types";
import type {
  GoldenTrianglePreference,
  PolicyAdjustment,
  VerificationDepth,
} from "@/lib/golden-triangle";

import {
  activityKindBiasFor,
  deriveLowTrafficBias,
  deriveStreamBiases,
  deriveTemporalBias,
  modeBiasFor,
  shapeBiasFor,
  type ArchetypeStreamInput,
  type PostureBias,
} from "./derive";
import {
  dampProactivityLevel,
  tightenActionBoundary,
  tightenMinimumTier,
  tightenProactivityLevel,
  tightenVerificationDepth,
} from "./tighten";
import {
  resolveTemporalBand,
  type TemporalBandInput,
  type TemporalBand,
  type TemporalBandResult,
} from "./temporal-band";

/** Which precedence layer supplied a value — surfaced so the operator sees why. */
export type PostureLayer =
  | "hard-policy"
  | "room-declaration"
  | "workroom-default"
  | "derived"
  | "agent"
  | "organization"
  | "platform";

/** Hard bounds the posture may never cross. Layer 1. */
export interface PostureHardPolicy {
  /** An absolute floor on the action boundary — the posture may only tighten past it. */
  actionBoundaryFloor?: ProactivityActionBoundary;
  minimumTierFloor?: QualityTier;
  verificationDepthFloor?: VerificationDepth;
  /** True when the work is regulated; recorded for provenance and applied as a floor. */
  regulated?: boolean;
  reason?: string;
}

/** An explicit posture chosen when the room was convened. Layer 2. */
export interface RoomPostureDeclaration {
  proactivityLevel?: ProactivityLevel;
  actionBoundary?: ProactivityActionBoundary;
  priority?: GoldenTrianglePreference;
  declaredBy?: string | null;
  declaredAt?: string | null;
}

/** The shape axes of the room the work is happening in. Layer 3 input. */
export interface RoomShapeInput {
  /** WorkroomShapeKey — the declared collaboration shape. */
  shapeKey?: string | null;
  /** Workroom.activityKind. */
  activityKind?: string | null;
  /** WorkroomMode — "finite" | "standing". */
  mode?: string | null;
  /** Whether a standing room currently has an open cycle. */
  cycleActive?: boolean;
}

export interface WorkPostureInput {
  /**
   * The posture resolved by the EXISTING ladders (agent → org/activity-family →
   * platform). This resolver never re-derives it.
   */
  inherited: {
    proactivityPlan: ProactivityPlan;
    priority?: GoldenTrianglePreference | null;
    /** Which of the existing layers supplied it, for provenance. */
    source?: PostureLayer;
  };
  hardPolicy?: PostureHardPolicy | null;
  declaration?: RoomPostureDeclaration | null;
  /**
   * The DECREED DEFAULT for rooms (workroom-posture-defaults.ts): how work in a
   * room behaves here unless the room says otherwise. Sits BELOW derivation —
   * what the work actually is outranks a blanket preference about rooms — and
   * ABOVE agent/org/platform, which answer a different question (how does this
   * COWORKER behave). Absent means today's behaviour exactly.
   */
  workroomDefault?: RoomPostureDeclaration | null;
  shape?: RoomShapeInput | null;
  stream?: ArchetypeStreamInput | null;
  /** Everything the clock needs. Passed in — the resolver reads no ambient time. */
  temporal?: TemporalBandInput | null;
}

export interface ResolvedWorkPosture {
  proactivityLevel: ProactivityLevel;
  actionBoundary: ProactivityActionBoundary;
  minimumTier?: QualityTier;
  verificationDepth?: VerificationDepth;
  priority: GoldenTrianglePreference | null;
  /** The band that applied, or null when no temporal input was supplied. */
  temporalBand: TemporalBand | null;
  /** Which layer supplied the headline proactivity value. */
  proactivitySource: PostureLayer;
  /** Which layer supplied the priority. */
  prioritySource: PostureLayer;
  /**
   * Every clamp, in application order, with a stable reasonCode. This is the
   * decision log the provenance surface (BI-4EB2F1D0) renders.
   */
  adjustments: PolicyAdjustment[];
  /** True when nothing was derived or declared — the inherited posture stands. */
  inert: boolean;
}

function record(
  adjustments: PolicyAdjustment[],
  field: string,
  from: unknown,
  to: unknown,
  bias: { reasonCode: string; reason: string },
): void {
  if (from === to) return;
  adjustments.push({ field, from, to, reasonCode: bias.reasonCode, reason: bias.reason });
}

/** Collect every derivation bias that applies, in a stable order. */
function collectBiases(
  input: WorkPostureInput,
  clock: TemporalBandResult | null,
): PostureBias[] {
  const biases: PostureBias[] = [];

  const shapeBias = shapeBiasFor(input.shape?.shapeKey);
  if (shapeBias) biases.push(shapeBias);

  const kindBias = activityKindBiasFor(input.shape?.activityKind);
  if (kindBias) biases.push(kindBias);

  biases.push(...deriveStreamBiases(input.stream));

  if (clock) {
    const temporalBias = deriveTemporalBias(clock.band);
    if (temporalBias) biases.push(temporalBias);
    // Independent of the band: a trough is a cost opportunity even while closed.
    const troughBias = deriveLowTrafficBias(clock.lowTraffic);
    if (troughBias) biases.push(troughBias);
  }

  const mode = modeBiasFor(input.shape?.mode, input.shape?.cycleActive ?? false);
  if (mode) biases.push(mode);

  return biases;
}

/**
 * Fold the priority axis bias into a Golden Triangle preference.
 *
 * Deliberately conservative: a derived axis nudges the inherited weights toward
 * that axis rather than replacing the operator's posture. An explicit
 * declaration or an agent's own saved posture still reads as itself; the
 * derivation shifts emphasis, it does not overrule intent.
 */
function applyPriorityAxis(
  base: GoldenTrianglePreference | null,
  axes: ReadonlyArray<"quality" | "cost" | "time">,
): GoldenTrianglePreference | null {
  if (!base || axes.length === 0) return base;

  const NUDGE = 0.1;
  let { costWeight, qualityWeight, timeWeight } = base;
  for (const axis of axes) {
    if (axis === "quality") qualityWeight += NUDGE;
    else if (axis === "cost") costWeight += NUDGE;
    else timeWeight += NUDGE;
  }
  const sum = costWeight + qualityWeight + timeWeight;
  if (sum <= 0) return base;
  return {
    costWeight: costWeight / sum,
    qualityWeight: qualityWeight / sum,
    timeWeight: timeWeight / sum,
    // The posture is no longer the named preset once a derivation shifted it.
    preset: "custom",
  };
}

export function resolveWorkPosture(input: WorkPostureInput): ResolvedWorkPosture {
  const adjustments: PolicyAdjustment[] = [];
  const inheritedPlan = input.inherited.proactivityPlan;

  // ── Layer 6/5/4: the inherited starting point ──
  let proactivityLevel = inheritedPlan.resolvedLevel;
  let actionBoundary = inheritedPlan.actionBoundary;
  let priority = input.inherited.priority ?? null;
  let proactivitySource: PostureLayer = input.inherited.source ?? "platform";
  let prioritySource: PostureLayer = input.inherited.source ?? "platform";
  let minimumTier: QualityTier | undefined;
  let verificationDepth: VerificationDepth | undefined;

  const clock = input.temporal ? resolveTemporalBand(input.temporal) : null;
  const band: TemporalBand | null = clock?.band ?? null;
  const biases = collectBiases(input, clock);

  // ── Layer 3: derived. Applied ONLY through the tighten-only clamps. ──
  const priorityAxes: Array<"quality" | "cost" | "time"> = [];
  for (const bias of biases) {
    if (bias.proactivityLevel) {
      const next = tightenProactivityLevel(proactivityLevel, bias.proactivityLevel);
      record(adjustments, "proactivityLevel", proactivityLevel, next, bias);
      if (next !== proactivityLevel) proactivitySource = "derived";
      proactivityLevel = next;
    }
    if (bias.actionBoundary) {
      const next = tightenActionBoundary(actionBoundary, bias.actionBoundary);
      record(adjustments, "actionBoundary", actionBoundary, next, bias);
      actionBoundary = next;
    }
    if (bias.minimumTier) {
      const next = tightenMinimumTier(minimumTier, bias.minimumTier);
      record(adjustments, "minimumTier", minimumTier, next, bias);
      minimumTier = next;
    }
    if (bias.verificationDepth) {
      const next = tightenVerificationDepth(verificationDepth, bias.verificationDepth);
      record(adjustments, "verificationDepth", verificationDepth, next, bias);
      verificationDepth = next;
    }
    if (bias.priorityAxis) priorityAxes.push(bias.priorityAxis);
  }

  // Damping is applied AFTER every tightening bias, and reaches the cadence
  // level only — never the action boundary, tier floor or verification depth.
  // This is what makes "the business is closed" safe (design §3.2, §6).
  for (const bias of biases) {
    if (!bias.damp) continue;
    const next = dampProactivityLevel(proactivityLevel);
    record(adjustments, "proactivityLevel", proactivityLevel, next, bias);
    if (next !== proactivityLevel) proactivitySource = "derived";
    proactivityLevel = next;
  }

  if (priorityAxes.length > 0) {
    const next = applyPriorityAxis(priority, priorityAxes);
    if (next && next !== priority) {
      adjustments.push({
        field: "priority",
        from: priority?.preset ?? null,
        to: next.preset,
        reasonCode: "derived_priority_axis",
        reason: `Priority shifted toward ${[...new Set(priorityAxes)].join(" and ")} by the shape of this work.`,
      });
      prioritySource = "derived";
      priority = next;
    }
  }

  // ── The decreed workroom default: applied where nothing more specific spoke ──
  // Only fills gaps. It never overrides a derived value, because the shape of
  // the work is more specific than a blanket preference about rooms; and its
  // boundary still goes through the tighten-only clamp, so decreeing a default
  // can restrict what rooms may do and can never widen it.
  const workroomDefault = input.workroomDefault;
  if (workroomDefault) {
    if (workroomDefault.proactivityLevel && proactivitySource !== "derived") {
      const next = workroomDefault.proactivityLevel;
      record(adjustments, "proactivityLevel", proactivityLevel, next, {
        reasonCode: "workroom_default",
        reason: "The platform's default for rooms applies, because nothing more specific did.",
      });
      if (next !== proactivityLevel) proactivitySource = "workroom-default";
      proactivityLevel = next;
    }
    if (workroomDefault.actionBoundary) {
      const next = tightenActionBoundary(actionBoundary, workroomDefault.actionBoundary);
      record(adjustments, "actionBoundary", actionBoundary, next, {
        reasonCode: "workroom_default",
        reason: "The platform's default for rooms applies, because nothing more specific did.",
      });
      actionBoundary = next;
    }
    if (workroomDefault.priority && prioritySource !== "derived") {
      adjustments.push({
        field: "priority",
        from: priority?.preset ?? null,
        to: workroomDefault.priority.preset,
        reasonCode: "workroom_default",
        reason: "The platform's default priority for rooms applies.",
      });
      priority = workroomDefault.priority;
      prioritySource = "workroom-default";
    }
  }

  // ── Layer 2: the room's explicit declaration outranks derivation ──
  const declaration = input.declaration;
  if (declaration?.proactivityLevel && declaration.proactivityLevel !== proactivityLevel) {
    adjustments.push({
      field: "proactivityLevel",
      from: proactivityLevel,
      to: declaration.proactivityLevel,
      reasonCode: "room_declaration",
      reason: "The room declared this proactivity level when it was convened.",
    });
    proactivityLevel = declaration.proactivityLevel;
    proactivitySource = "room-declaration";
  }
  if (declaration?.actionBoundary) {
    // Even a declaration may only TIGHTEN authority: convening a room cannot
    // buy a coworker more freedom than its own policy already granted.
    const next = tightenActionBoundary(actionBoundary, declaration.actionBoundary);
    record(adjustments, "actionBoundary", actionBoundary, next, {
      reasonCode: "room_declaration",
      reason: "The room declared this action boundary when it was convened.",
    });
    actionBoundary = next;
  }
  if (declaration?.priority) {
    adjustments.push({
      field: "priority",
      from: priority?.preset ?? null,
      to: declaration.priority.preset,
      reasonCode: "room_declaration",
      reason: "The room declared this cost/quality/time posture when it was convened.",
    });
    priority = declaration.priority;
    prioritySource = "room-declaration";
  }

  // ── Layer 1: hard policy. Floors only; never relaxed by anything above. ──
  const hard = input.hardPolicy;
  if (hard) {
    const hardReason = {
      reasonCode: "hard_policy_floor",
      reason: hard.reason ?? "A policy floor applies that the posture cannot trade away.",
    };
    if (hard.actionBoundaryFloor) {
      const next = tightenActionBoundary(actionBoundary, hard.actionBoundaryFloor);
      record(adjustments, "actionBoundary", actionBoundary, next, hardReason);
      actionBoundary = next;
    }
    if (hard.regulated) {
      const next = tightenActionBoundary(actionBoundary, "advise");
      record(adjustments, "actionBoundary", actionBoundary, next, {
        reasonCode: "regulated_ceiling",
        reason: "This work is regulated, so the coworker advises rather than acts.",
      });
      actionBoundary = next;
    }
    if (hard.minimumTierFloor) {
      const next = tightenMinimumTier(minimumTier, hard.minimumTierFloor);
      record(adjustments, "minimumTier", minimumTier, next, hardReason);
      minimumTier = next;
    }
    if (hard.verificationDepthFloor) {
      const next = tightenVerificationDepth(verificationDepth, hard.verificationDepthFloor);
      record(adjustments, "verificationDepth", verificationDepth, next, hardReason);
      verificationDepth = next;
    }
  }

  return {
    proactivityLevel,
    actionBoundary,
    minimumTier,
    verificationDepth,
    priority,
    temporalBand: band,
    proactivitySource,
    prioritySource,
    adjustments,
    inert: adjustments.length === 0,
  };
}
