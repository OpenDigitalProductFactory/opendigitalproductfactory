/**
 * EP-WORK-POSTURE Slice B (BI-0C5A83A8) — derivation tables.
 *
 * Design: docs/superpowers/specs/2026-08-22-workroom-work-posture-design.md §4, §5, §6.
 *
 * Layer 3 of the precedence ladder. Each derivation contributes a BIAS, never a
 * final value: biases are applied through the tighten-only clamps in
 * `tighten.ts`, so no table here can widen authority however it is edited.
 *
 * A bias that wants a coworker to be QUIETER must set `damp`, not
 * `proactivityLevel` — the tighten-only clamps raise proactivity and never lower
 * it, so a `proactivityLevel: "quiet"` bias is silently inert. `damp` is the
 * only reducing lever, and by construction it cannot reach authority.
 *
 * The tables are declared ONCE in code and are deliberately NOT per-archetype.
 * The archetype contribution is derived from the OVSM projection's four
 * properties — demandSignature, capacityUnit, loadBearingStageKeys, trustGates
 * — which the projection already produces for every leaf archetype. Authoring a
 * per-archetype posture table is the defect BI-BEDAFF57 exists to prevent.
 */
import type { QualityTier } from "@/lib/routing/quality-tiers";
import type {
  ProactivityActionBoundary,
  ProactivityLevel,
} from "@/lib/proactivity/proactivity-types";
import type { VerificationDepth } from "@/lib/golden-triangle";
import type { TemporalBand } from "./temporal-band";

/** What a single derivation input wants to tighten. All fields optional. */
export interface PostureBias {
  proactivityLevel?: ProactivityLevel;
  actionBoundary?: ProactivityActionBoundary;
  minimumTier?: QualityTier;
  verificationDepth?: VerificationDepth;
  /** Which Golden Triangle axis this input pulls toward, for the priority bias. */
  priorityAxis?: "quality" | "cost" | "time";
  /**
   * Lower cadence by one step. The ONLY reducing lever — `proactivityLevel`
   * can raise but never lower, so a bias that wants quiet sets this instead.
   * Never reaches the action boundary, tier floor or verification depth.
   */
  damp?: boolean;
  reasonCode: string;
  reason: string;
}

// ── Shape: collaboration shape (WorkroomShapeKey) ────────────────────────────

const SHAPE_BIAS: Record<string, PostureBias> = {
  "change-consequential": {
    actionBoundary: "propose",
    priorityAxis: "quality",
    reasonCode: "shape_change_consequential",
    reason: "A consequential change is reviewed and confirmed before execution.",
  },
  "approval-sign-off": {
    actionBoundary: "propose",
    priorityAxis: "quality",
    verificationDepth: "shallow",
    reasonCode: "shape_approval_sign_off",
    reason: "An accountable approver signs off, so evidence quality outranks speed.",
  },
  "outward-review": {
    actionBoundary: "propose",
    priorityAxis: "quality",
    verificationDepth: "deep",
    reasonCode: "shape_outward_review",
    reason: "The action faces outward, so it is reviewed and verified before it leaves.",
  },
  escalation: {
    proactivityLevel: "assertive",
    actionBoundary: "propose",
    priorityAxis: "time",
    reasonCode: "shape_escalation",
    reason: "An escalation is waiting on a human, so timing outranks cost.",
  },
  "specialist-alignment": {
    priorityAxis: "quality",
    reasonCode: "shape_specialist_alignment",
    reason: "A corpus check routes to a qualified specialist before the approver sees it.",
  },
  "craft-stewardship": {
    // Damp rather than declaring `proactivityLevel: "quiet"`: the tighten-only
    // clamps can only RAISE proactivity, so a "quiet" bias would be silently
    // inert. Lowering cadence is expressible only through `damp`, which by
    // construction cannot reach authority.
    damp: true,
    priorityAxis: "cost",
    reasonCode: "shape_craft_stewardship",
    reason: "Standing corpus curation is background work; it should not interrupt.",
  },
};

// ── Shape: activity kind (WORK_CAPSULE_SCOPE_ACTIVITY_KINDS) ─────────────────

const ACTIVITY_KIND_BIAS: Record<string, PostureBias> = {
  remediation: {
    proactivityLevel: "assertive",
    priorityAxis: "time",
    reasonCode: "activity_remediation",
    reason: "Remediation work is fixing something already wrong, so it should not wait.",
  },
  governance: {
    actionBoundary: "propose",
    priorityAxis: "quality",
    reasonCode: "activity_governance",
    reason: "Governance work sets precedent, so it is proposed rather than taken.",
  },
  "launch-readiness": {
    priorityAxis: "quality",
    verificationDepth: "shallow",
    reasonCode: "activity_launch_readiness",
    reason: "Launch readiness is a gate; an unverified pass is worth nothing.",
  },
  "craft-judgment": {
    priorityAxis: "quality",
    reasonCode: "activity_craft_judgment",
    reason: "Craft judgment is the deliverable, so quality outranks speed and cost.",
  },
};

// ── Stream: the archetype's operational value stream (OVSM) ──────────────────

/**
 * Demand signatures that mean waiting is expensive. `steady` contributes
 * nothing — the absence of a bias is a real answer, not a gap.
 */
const URGENT_DEMAND_SIGNATURES = new Set([
  "emergency-reactive",
  "synchronized-contention",
]);

/**
 * Capacity units that are DESTROYED rather than deferred when unused: an empty
 * appointment slot, a spoiled item, an unsold seat. Idle capacity in these
 * units is a loss the business never recovers, so surfacing beats batching.
 */
const PERISHABLE_CAPACITY_UNITS = new Set([
  "slot-hours",
  "perishable-stock",
  "physical-hard-cap",
]);

export interface ArchetypeStreamInput {
  demandSignature?: string | null;
  capacityUnit?: string | null;
  loadBearingStageKeys?: readonly string[] | null;
  trustGates?: readonly string[] | null;
  /** The stage this work sits in, when known. */
  stageKey?: string | null;
}

/**
 * Existing Build Studio rightsizing facts that describe the stakes of the
 * deliverable. These are already persisted on the build plan and already ride
 * on phase-gate evidence; the posture layer consumes them rather than creating
 * a second risk taxonomy.
 */
export interface WorkStakesInput {
  qualityFirst?: boolean | null;
  deliverableSensitivity?: string | null;
}

/**
 * Convert the existing rightsizing ladder into a verification floor.
 *
 * The mapping is deliberately tighten-only and tier-preserving:
 *   inert/low -> no bias (today exactly)
 *   quality-first/elevated -> shallow
 *   high -> deep
 *
 * Phase 2 observes this declaration in shadow mode; it does not make the gate
 * verdict blocking. The resulting ledger is what calibrates the declaration
 * before any policy cell adopts the requirement.
 */
export function deriveStakesBias(
  stakes: WorkStakesInput | null | undefined,
): PostureBias | null {
  if (!stakes) return null;
  if (stakes.deliverableSensitivity === "high") {
    return {
      verificationDepth: "deep",
      reasonCode: "stakes_high_sensitivity",
      reason: "High-sensitivity work receives the deepest existing verification floor.",
    };
  }
  if (stakes.qualityFirst === true || stakes.deliverableSensitivity === "elevated") {
    return {
      verificationDepth: "shallow",
      reasonCode: stakes.deliverableSensitivity === "elevated"
        ? "stakes_elevated_sensitivity"
        : "stakes_quality_first",
      reason: stakes.deliverableSensitivity === "elevated"
        ? "Elevated-sensitivity work receives a shallow verification floor."
        : "Quality-first work receives a shallow verification floor.",
    };
  }
  return null;
}

export function deriveStreamBiases(stream: ArchetypeStreamInput | null | undefined): PostureBias[] {
  if (!stream) return [];
  const biases: PostureBias[] = [];

  if (stream.demandSignature && URGENT_DEMAND_SIGNATURES.has(stream.demandSignature)) {
    biases.push({
      proactivityLevel: "assertive",
      priorityAxis: "time",
      reasonCode: "stream_urgent_demand",
      reason: `Demand for this business is ${stream.demandSignature}, so delay compounds.`,
    });
  }

  if (stream.demandSignature === "fiscal-calendar") {
    biases.push({
      priorityAxis: "quality",
      reasonCode: "stream_fiscal_calendar",
      reason: "Work on a fiscal calendar is judged against a filed date, not a preference.",
    });
  }

  if (stream.capacityUnit && PERISHABLE_CAPACITY_UNITS.has(stream.capacityUnit)) {
    biases.push({
      proactivityLevel: "assertive",
      priorityAxis: "time",
      reasonCode: "stream_perishable_capacity",
      reason: `Capacity is measured in ${stream.capacityUnit}, which is lost rather than deferred when unused.`,
    });
  }

  if (stream.stageKey && (stream.loadBearingStageKeys ?? []).includes(stream.stageKey)) {
    biases.push({
      proactivityLevel: "assertive",
      reasonCode: "stream_load_bearing_stage",
      reason: "This stage carries the value stream; a stall here stalls the business.",
    });
  }

  if ((stream.trustGates ?? []).length > 0) {
    biases.push({
      verificationDepth: "deep",
      actionBoundary: "propose",
      priorityAxis: "quality",
      reasonCode: "stream_trust_gate",
      reason: "This stage carries a trust gate, so the work is verified before it advances.",
    });
  }

  return biases;
}

// ── Clock: the temporal band ─────────────────────────────────────────────────

export function deriveTemporalBias(band: TemporalBand): PostureBias | null {
  switch (band) {
    case "breach-imminent":
      return {
        proactivityLevel: "assertive",
        priorityAxis: "time",
        reasonCode: "clock_breach_imminent",
        reason: "The obligation is at or past its due time.",
      };
    case "pre-deadline":
      return {
        proactivityLevel: "assertive",
        priorityAxis: "time",
        reasonCode: "clock_pre_deadline",
        reason: "The obligation falls due soon.",
      };
    case "low-traffic":
      // The cost bias for a trough is applied from the lowTraffic FLAG
      // (deriveLowTrafficBias), so it still fires while closed. Returning it
      // here as well would double-count the nudge.
      return null;
    case "out-of-hours":
      return {
        damp: true,
        reasonCode: "clock_out_of_hours",
        reason: "The business is closed, so follow-up waits — authority is unchanged.",
      };
    case "in-hours":
      return null;
  }
}

/**
 * The cost opportunity of a declared trough, independent of the band. Closed
 * hours outrank cheap hours for IMMEDIACY (see temporal-band precedence), but
 * the cost opportunity is still real while closed — so it is applied from the
 * flag rather than from the band.
 */
export function deriveLowTrafficBias(lowTraffic: boolean): PostureBias | null {
  if (!lowTraffic) return null;
  return {
    priorityAxis: "cost",
    reasonCode: "clock_low_traffic",
    reason: "Inside a declared low-traffic window, so the work can be run cheaply.",
  };
}

export function shapeBiasFor(shapeKey: string | null | undefined): PostureBias | null {
  return shapeKey ? (SHAPE_BIAS[shapeKey] ?? null) : null;
}

export function activityKindBiasFor(kind: string | null | undefined): PostureBias | null {
  return kind ? (ACTIVITY_KIND_BIAS[kind] ?? null) : null;
}

/**
 * A standing room between cycles is ongoing background activity, not a live
 * push. Damping applies to cadence only, exactly as out-of-hours does.
 */
export function modeBiasFor(
  mode: string | null | undefined,
  cycleActive: boolean,
): PostureBias | null {
  if (mode !== "standing" || cycleActive) return null;
  return {
    damp: true,
    reasonCode: "mode_standing_between_cycles",
    reason: "This standing room is between cycles, so follow-up is quieter.",
  };
}
