// Speed-counter axes of the UX route ratchet (BI-BDB43823), kept beside
// ratchet.ts so that module stays within its size budget. Only counters the
// admission file marks "admitted" are ever evaluated; a counter that has not
// proven itself repeatable and wall-clock-tracking can never block a PR.

import admissionFile from "./speed-counter-admission.json";
import type { SpeedCounterName, SpeedCounters } from "./speed-counters";

export type SpeedCounterBaseline = Partial<SpeedCounters>;

/** Counter names the committed admission file marks admitted. */
export function admittedSpeedCounters(
  file: { counters: Array<{ counter: string; status: string }> } = admissionFile,
): ReadonlySet<SpeedCounterName> {
  return new Set(file.counters.filter((c) => c.status === "admitted").map((c) => c.counter as SpeedCounterName));
}

/** Blocking regressions: an admitted counter above its frozen ceiling. */
export function speedCounterRegressions(
  now: SpeedCounters | undefined,
  was: SpeedCounterBaseline | undefined,
  admitted: ReadonlySet<SpeedCounterName>,
): string[] {
  if (!now || !was) return [];
  const out: string[] = [];
  for (const counter of admitted) {
    const ceiling = was[counter];
    // No frozen value yet: report-only until a baseline refresh records one.
    if (ceiling === undefined) continue;
    if (now[counter] > ceiling) out.push(`${counter} (speed counter): ${ceiling} → ${now[counter]}`);
  }
  return out;
}

/**
 * The counter values to freeze. A refresh may LOWER a ceiling, never raise
 * it: the frozen value is min(current, previous). Raising one is a hand edit,
 * visible in review.
 */
export function freezeSpeedCounters(
  now: SpeedCounters | undefined,
  previous: SpeedCounterBaseline | undefined,
  admitted: ReadonlySet<SpeedCounterName>,
): SpeedCounterBaseline | undefined {
  if (!now) return previous;
  const frozen: SpeedCounterBaseline = {};
  for (const counter of admitted) {
    const prev = previous?.[counter];
    frozen[counter] = prev === undefined ? now[counter] : Math.min(prev, now[counter]);
  }
  return Object.keys(frozen).length > 0 ? frozen : undefined;
}
