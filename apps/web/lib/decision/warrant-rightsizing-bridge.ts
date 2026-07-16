// apps/web/lib/decision/warrant-rightsizing-bridge.ts
//
// Convergence bridge: WorkWarrant (decision-altitude control plane, EP-7B169558)
// → the EXISTING right-sizing engine (getProcessPolicy / getModelTier /
// deriveDeliverableSensitivity, EP-QUALITY-RIGHTSIZING).
//
// WHY THIS EXISTS: build-process-matrix already escalates gate/review rigor
// MONOTONICALLY via RightsizingOpts {qualityFirst, sensitivity} and picks a
// BuildModelTier. The warrant's budget.gateProfile / budget.modelTier are the
// SAME decisions viewed through altitude + blast-radius. Rather than run two
// parallel rigor engines (drift + double gate logic), the warrant becomes the
// single front door and this bridge lets it DRIVE the one existing engine —
// checkPhaseGate stays the sole gate authority; the warrant just supplies opts.
//
// Monotonic by construction: a collapsed (WSID) warrant maps to inert opts →
// getProcessPolicy returns the byte-identical base cell; higher gate profiles can
// only RAISE rigor, never relax below the matrix baseline.

import type { WorkWarrant } from "./work-warrant";
import {
  getProcessPolicy,
  type RightsizingOpts,
  type LifecyclePolicy,
  type BuildProcessType,
  type BuildProcessSize,
  type BuildModelTier,
  type DeliverableSensitivity,
} from "@/lib/explore/build-process-matrix";

/**
 * Map the warrant's gate profile to the existing RightsizingOpts.
 *   collapsed → inert (qualityFirst off, low sensitivity) ⇒ base cell, unchanged
 *   standard  → qualityFirst + elevated sensitivity
 *   full      → qualityFirst + high sensitivity ⇒ deepest policy for the type
 */
export function warrantToRightsizingOpts(warrant: WorkWarrant): RightsizingOpts {
  const sensitivity: DeliverableSensitivity =
    warrant.budget.gateProfile === "full"
      ? "high"
      : warrant.budget.gateProfile === "standard"
        ? "elevated"
        : "low";
  return {
    qualityFirst: warrant.budget.gateProfile !== "collapsed",
    sensitivity,
  };
}

/**
 * Resolve the ONE lifecycle policy a build should run, driven by its warrant.
 * Thin over getProcessPolicy so checkPhaseGate remains the single gate authority
 * and the (type, size) base matrix is unchanged — the warrant only supplies the
 * escalation opts derived from altitude + blast-radius.
 */
export function resolveWarrantedPolicy(
  processType: BuildProcessType | string | null | undefined,
  processSize: BuildProcessSize | string | null | undefined,
  warrant: WorkWarrant,
): LifecyclePolicy {
  return getProcessPolicy(processType, processSize, warrantToRightsizingOpts(warrant));
}

/**
 * Reconcile the warrant's 3-tier model budget with the engine's 2-tier
 * BuildModelTier (local | robust). `economical` → on-box local model; both
 * `standard` and `strong` → the robust configured engine. Keeps a single
 * model-tier vocabulary at the dispatch boundary (build-studio-config resolves
 * the concrete provider for the tier).
 */
export function warrantToModelTier(warrant: WorkWarrant): BuildModelTier {
  return warrant.budget.modelTier === "economical" ? "local" : "robust";
}
