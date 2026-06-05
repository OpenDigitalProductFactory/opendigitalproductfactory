// apps/web/lib/workspace-home/activation-orchestrator/types.ts
//
// Phase 1 of the archetype-driven workspace-home setup activation orchestrator.
// See docs/superpowers/plans/2026-06-04-workspace-home-activation-orchestrator.md
// (BI-B14D6CF6 plan, PR #1464) §Phase 1.
//
// The ActivationPlan is a structured projection of a resolved
// WorkspaceHomeContribution's setupActivation declarations against an install's
// actual data state. Phase 2 (setup-task generator) reads this plan and emits
// admin-actionable tasks for unsatisfied declarations. Phase 4 (empty-state
// coordinator) reads slot behaviors to drive render decisions per slot.
//
// Walker is a pure-ish boundary: it reads from prisma, but emits no writes and
// produces no side effects beyond an [orchestrator-unknown-canonical-data] log
// when it encounters an unregistered declaration key. The pure shape lets per-
// archetype tests exercise the walker against synthetic seeds without touching
// a real database.

import type { WorkspaceHomeContribution } from "../types";

/** A single canonical-data declaration's walk result. */
export type CanonicalDataWalkResult = {
  /** The key declared by `contribution.setupActivation.requiredCanonicalData[]`. */
  key: string;
  /** Whether the install has at least `expectedMin` rows matching the declaration. */
  satisfied: boolean;
  /**
   * Sample evidence — what the walker actually observed. `null` when the key
   * has no entry in the canonical-data registry; the walker logs
   * [orchestrator-unknown-canonical-data] in that case so the gap surfaces.
   */
  sample: {
    tableName: string;
    expectedMin: number;
    observed: number;
  } | null;
};

/** A single signal-kind declaration's binding result. */
export type SignalBindingWalkResult = {
  /** The kind declared by `contribution.setupActivation.requiredSignals[]`. */
  kind: string;
  /**
   * The projection-service loader id the kind maps to. `null` when the signal
   * has no entry in the signal registry yet — typically because BI-3E8D2CF5's
   * projection-service implementation hasn't landed the loader for this kind.
   * Phase 2 generates a "projection-service gap" setup task pointing at
   * BI-3E8D2CF5 when this is null.
   */
  loaderId: string | null;
  /** True when loaderId is non-null AND the projection service can serve it. */
  bound: boolean;
};

/** A single slot's render-decision input derived from the contribution + plan. */
export type SlotBehaviorWalkResult = {
  /** The slot id from `contribution.slots[].id`. */
  slotId: string;
  /** Mirrors the contribution's `setupActivation.missingDataBehavior` for this slot. */
  missingDataBehavior: WorkspaceHomeContribution["setupActivation"]["missingDataBehavior"];
  /**
   * Whether any of the slot's components' required data refs are satisfied.
   * Required data refs are checked against the canonical-data walk + the signal
   * binding walk. A slot with NO required data refs is reported as `hasData: true`
   * (the slot exists for layout reasons; the renderer decides what to show).
   */
  hasData: boolean;
};

/**
 * The full activation plan emitted by the walker.
 *
 * Phase 2 (setup-task generator) reads `canonicalData` + `signals` to emit
 * admin-actionable setup tasks for unsatisfied declarations. Phase 4 (empty-
 * state coordinator) reads `slotBehaviors` to drive per-slot render decisions.
 */
export type ActivationPlan = {
  contributionId: string;
  archetypeContext: string;
  canonicalData: CanonicalDataWalkResult[];
  signals: SignalBindingWalkResult[];
  slotBehaviors: SlotBehaviorWalkResult[];
};
