// EP-GOLDEN-TRIANGLE Slice 6 (BI-9E7B712A) — learned-default descent.
//
// Pure: given a posture and its recent outcome receipts, suggest (never
// auto-apply) a calibration. This is the "descent" force from the cognitive-load
// model — the platform notices when a chosen posture is mis-fitted to reality and
// offers a better default. Conservative by design: it only speaks with a minimum
// sample and a clear, consistent signal; otherwise it stays quiet. No I/O, so it
// is fully snapshot-testable and reusable by the Outcomes view and any future
// auto-tuning loop.
import type { GoldenTrianglePreference } from "@/lib/golden-triangle";

import type { GoldenTriangleReceipt } from "./receipt";

export type CalibrationKind = "none" | "loosen-quality" | "raise-quality" | "address-reliability";

export interface CalibrationSuggestion {
  kind: CalibrationKind;
  /** Short, plain-language headline for the suggestion banner. */
  headline: string;
  /** One or two sentences explaining the evidence. */
  detail: string;
  /** How many receipts informed this suggestion. */
  sampleSize: number;
}

const MIN_SAMPLE = 5;
const FAILOVER_RATE = 0.3; // ≥30% of runs failed over → a reliability problem
const UNDER_RATE = 0.3; // ≥30% below tier (or rejected) → under-provisioned
const QUALITY_LEAN = 0.45; // posture counts as quality-leaning above this weight

function rate(n: number, total: number): number {
  return total === 0 ? 0 : n / total;
}

/**
 * Suggest a calibration for `current` from its recent `receipts`. Precedence is
 * reliability → under-provisioned → headroom(descent) → well-fitted, so the most
 * actionable signal wins when several are present.
 */
export function suggestCalibration(
  current: GoldenTrianglePreference,
  receipts: GoldenTriangleReceipt[],
): CalibrationSuggestion {
  const n = receipts.length;
  if (n < MIN_SAMPLE) {
    return {
      kind: "none",
      headline: "Not enough history yet",
      detail: `Calibration suggestions appear after at least ${MIN_SAMPLE} runs under this priority — ${n} so far.`,
      sampleSize: n,
    };
  }

  const failovers = receipts.filter((r) => r.actual.fallbackOccurred).length;
  const belowTier = receipts.filter((r) => !r.matchedRequest && !r.actual.fallbackOccurred).length;
  const rejected = receipts.filter((r) => r.actual.accepted === false || r.actual.verificationPassed === false).length;
  const cleanRuns = receipts.filter(
    (r) => r.matchedRequest && r.actual.accepted !== false && r.actual.verificationPassed !== false,
  ).length;

  // 1) Reliability first — frequent failover means the requested tier isn't reliably available.
  if (rate(failovers, n) >= FAILOVER_RATE) {
    return {
      kind: "address-reliability",
      headline: "Runs are failing over often",
      detail: `${failovers} of ${n} runs fell back to a backup provider. The tier you asked for may not be reliably available — consider adding capacity or easing the quality floor.`,
      sampleSize: n,
    };
  }

  // 2) Under-provisioned — frequently below the requested tier, or failing verification.
  if (rate(belowTier, n) >= UNDER_RATE || rate(rejected, n) >= UNDER_RATE) {
    const verifyNote = rejected ? `, and ${rejected} didn't pass verification` : "";
    return {
      kind: "raise-quality",
      headline: "This priority may be under-provisioned",
      detail: `${belowTier} of ${n} runs landed below the tier you asked for${verifyNote}. Nudging the triangle toward Quality should help.`,
      sampleSize: n,
    };
  }

  // 3) Descent (save cost) — a quality-leaning posture where every run was clean has headroom.
  if (current.qualityWeight >= QUALITY_LEAN && cleanRuns === n) {
    return {
      kind: "loosen-quality",
      headline: "You may have room to save",
      detail: `All ${n} runs met the high quality bar and were accepted. A more balanced priority would likely still pass while spending less — worth a try.`,
      sampleSize: n,
    };
  }

  return {
    kind: "none",
    headline: "This priority looks well-fitted",
    detail: `Across ${n} runs nothing stands out — the platform is delivering what you asked for without obvious waste.`,
    sampleSize: n,
  };
}
