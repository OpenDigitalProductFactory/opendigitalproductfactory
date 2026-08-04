/**
 * BI-CF3049E7 — declared-vs-measured sensitivity drift.
 *
 * A route's sensitivity is a hardcoded static label in `tak/route-context-map`,
 * and `screen-inference-payload` applies it as a FLOOR over whatever the payload
 * actually measures. Nothing reconciled the two, so a label set higher than the
 * data it carries silently narrowed that route's endpoint pool — surfacing to
 * the user as "the AI provider is temporarily unavailable", which points at
 * providers rather than at the label that caused it.
 *
 * Since #3919 every screen receipt records both levels plus whether the floor
 * bound. This rolls those receipts up so a persistent over-declaration shows as
 * a repeated observation rather than something an operator has to re-derive by
 * hand-composing a payload.
 *
 * Pure: takes already-loaded samples, touches no database. Levels only — no
 * payload text passes through here, so a rollup is as safe to surface as the
 * receipts it reads.
 */
import { sensitivityLevelsAbove } from "./data-screening/sensitivity-rank";
import type { InferencePayloadSensitivity } from "./data-screening/types";

export type SensitivityDriftSample = {
  taskType: string;
  agentId: string | null;
  /**
   * The route whose static context declared the sensitivity. Null for callers
   * with no route (scheduled jobs, system tasks) and for rows predating the
   * column — those are reported unattributed rather than dropped, since
   * dropping them would understate drift.
   */
  routeContext?: string | null;
  /** Absent on receipts written before the drift fields shipped (#3919). */
  declaredSensitivity?: InferencePayloadSensitivity;
  measuredSensitivity?: InferencePayloadSensitivity;
  sensitivityFloorApplied?: boolean;
};

export type SensitivityDriftGroup = {
  taskType: string;
  agentId: string | null;
  /** The route that declared the level, or null when there was none. */
  routeContext: string | null;
  declared: InferencePayloadSensitivity;
  measured: InferencePayloadSensitivity;
  /** How far the declared label sits above the measured payload. Always ≥ 1. */
  levelsAbove: number;
  observations: number;
  flooredObservations: number;
};

export type SensitivityDriftRollup = {
  /** Receipts carrying both levels — the only ones that can be adjudicated. */
  observationsWithDriftFields: number;
  /**
   * Receipts predating the drift fields. Held separately rather than folded
   * into `aligned`, because counting unmeasured receipts as agreeing would
   * report a clean estate that was never actually checked.
   */
  observationsMissingDriftFields: number;
  /** Groups whose declared label sits strictly above the measured payload. */
  drifting: SensitivityDriftGroup[];
  /** Observations whose declared label the payload justifies. */
  aligned: number;
};

// JSON rather than a delimiter: agent ids and task types are free-form, so any
// separator character could collide and silently merge two distinct groups.
function groupKey(parts: readonly (string | null)[]): string {
  return JSON.stringify(parts);
}

export function rollUpSensitivityDrift(
  samples: readonly SensitivityDriftSample[],
): SensitivityDriftRollup {
  const groups = new Map<string, SensitivityDriftGroup>();
  let observationsWithDriftFields = 0;
  let observationsMissingDriftFields = 0;
  let aligned = 0;

  for (const sample of samples) {
    const { declaredSensitivity: declared, measuredSensitivity: measured } = sample;
    if (!declared || !measured) {
      observationsMissingDriftFields += 1;
      continue;
    }
    observationsWithDriftFields += 1;

    const levelsAbove = sensitivityLevelsAbove(declared, measured);
    if (levelsAbove === 0) {
      aligned += 1;
      continue;
    }

    // Key on the declared/measured pair as well as the agent: an agent whose
    // payload sometimes genuinely carries records would otherwise have its
    // real findings averaged away by its clean turns.
    // Route first: one agent can serve several routes, and only one of them
    // may over-declare. Merging them would average a real finding away.
    const routeContext = sample.routeContext ?? null;
    const key = groupKey([routeContext, sample.agentId, sample.taskType, declared, measured]);
    const existing = groups.get(key);
    if (existing) {
      existing.observations += 1;
      if (sample.sensitivityFloorApplied) existing.flooredObservations += 1;
      continue;
    }
    groups.set(key, {
      taskType: sample.taskType,
      agentId: sample.agentId,
      routeContext,
      declared,
      measured,
      levelsAbove,
      observations: 1,
      flooredObservations: sample.sensitivityFloorApplied ? 1 : 0,
    });
  }

  // Worst over-declaration first — a route stranded three levels above its data
  // is a harder failure than one sitting a single level high, however often the
  // milder one is seen. Observation count breaks ties.
  const drifting = [...groups.values()].sort(
    (a, b) =>
      b.levelsAbove - a.levelsAbove ||
      b.observations - a.observations ||
      (a.routeContext ?? "").localeCompare(b.routeContext ?? "") ||
      (a.agentId ?? "").localeCompare(b.agentId ?? "") ||
      a.taskType.localeCompare(b.taskType),
  );

  return { observationsWithDriftFields, observationsMissingDriftFields, drifting, aligned };
}
