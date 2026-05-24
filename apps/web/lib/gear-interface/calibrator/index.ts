// apps/web/lib/gear-interface/calibrator/index.ts
//
// Reduction Gear Phase 1 — Calibrator public surface.
//
// Read-only. The Calibrator NEVER writes to GearInterface — it only reads the
// stream and returns trust readings the Autonomy Governor consults. Writes
// happen via the writer service when the Governor decides to act (e.g. emit a
// graduation event). This split keeps reads cheap and side-effect-free.
//
// Fail-closed contract (spec §6.1): when Calibrator data is unavailable the
// Governor MUST NOT elevate autonomy. Empty rows ⇒ score=null, sampleSize=0,
// confidence=0 — the Governor reads those values and chooses to stay in HITL.
//
// Spec: docs/superpowers/specs/2026-05-24-reduction-gear-architecture-design.md §6
// BI:   BI-861C4959

import { prisma } from "@dpf/db";
import {
  computeBayesianTrust,
  computeFrequentistTrust,
  type ScorableRow,
} from "./trust";
import {
  DEFAULT_OPTIONS,
  type CalibrationKey,
  type CalibratorOptions,
  type TrustReading,
} from "./types";

export type { CalibrationKey, CalibratorOptions, TrustReading };
export { computeFrequentistTrust, computeBayesianTrust };
export type { ScorableRow };

/**
 * Fetch the trust reading for one CalibrationKey. Reads the last N
 * GearInterface rows that match the key, then runs the scorer over them.
 *
 * Returns the empty reading (score=null, sampleSize=0, confidence=0) on any
 * error so callers stay fail-closed.
 */
export async function getTrustForTriple(
  key: CalibrationKey,
  options: CalibratorOptions = {},
): Promise<TrustReading> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  try {
    // Honest match: every CalibrationKey field constrains the row set. Nulls
    // round-trip via `equals: null` so we don't accidentally elevate trust
    // across archetype contexts that share the same agent+capability.
    const rows = await prisma.gearInterface.findMany({
      where: {
        agentIdForTriple: key.agentIdForTriple,
        capabilityName: key.capabilityName,
        archetypeContext: key.archetypeContext,
        interfaceClass: key.interfaceClass,
        innerRing: key.innerRing,
        outerRing: key.outerRing,
        // autonomyLevel is intentionally NOT used as a filter — we want the
        // history across autonomy tiers so graduation decisions can see the
        // full trajectory. Phase 1b may segment by tier if calibration warrants.
        outcomeType: { in: ["transmission", "slip", "calibration-update"] },
      },
      orderBy: { recordedAt: "desc" },
      take: opts.rollingWindow,
      select: { torqueTechnical: true, graderType: true, recordedAt: true },
    });

    return opts.useBayesian
      ? computeBayesianTrust(rows, opts)
      : computeFrequentistTrust(rows, opts);
  } catch (err) {
    console.warn(
      "[gear-interface][calibrator] read failed; returning empty trust:",
      { agentIdForTriple: key.agentIdForTriple, capabilityName: key.capabilityName },
      err,
    );
    return {
      score: null,
      sampleSize: 0,
      confidence: 0,
      lastSeenAt: null,
      recentFailureCount: 0,
      humanGradedCount: 0,
    };
  }
}
