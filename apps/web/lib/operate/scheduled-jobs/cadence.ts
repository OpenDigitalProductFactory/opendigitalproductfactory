// EP-SCHEDULING-SURFACE — cadence vocabulary (pure).
//
// Split out of ./control so the admin editor can validate a cadence and preview
// its next fire in the browser, instead of round-tripping to the server to find
// out that the value it offered was not accepted.

import { computeNextRunAt, SCHEDULE_INTERVALS_MS } from "@/lib/inference/ai-provider-types";
import { computeNextCronFire } from "@/lib/operate/cron-next-run";
import type { ActionResult } from "@/lib/shared/action-result";

/** Named cadences offered as presets. A cron expression is also accepted. */
export const EDITABLE_SCHEDULE_OPTIONS: readonly string[] = [
  ...Object.keys(SCHEDULE_INTERVALS_MS),
  "disabled",
];

/** Operator mutation outcome. The success payload is the sentence shown back to
 *  the operator ("'x' set to Daily at 03:00 — next run …"). */
export type MutationResult = ActionResult<string>;

/** A 5-field cron the scheduler can actually project a next run for. */
export function isSupportedCron(schedule: string): boolean {
  return computeNextCronFire(schedule, new Date()) !== null;
}

export function isValidSchedule(schedule: string): boolean {
  return EDITABLE_SCHEDULE_OPTIONS.includes(schedule) || isSupportedCron(schedule);
}

/** Next fire time for either cadence form. Null when the job will not fire. */
export function projectNextRun(schedule: string, from: Date): Date | null {
  if (schedule === "disabled") return null;
  return computeNextRunAt(schedule, from) ?? computeNextCronFire(schedule, from);
}


/**
 * Cadences an agent-backed task can actually be retuned to.
 *
 * Keep the existing daily/weekly/monthly preset vocabulary. Explicit cron
 * expressions use the full UTC evaluator; retuning preset clock fields is a
 * separate policy from computing an expression's next timestamp.
 */
export const AGENT_RETUNABLE_TOKENS = ["daily", "weekly", "monthly"] as const;

/**
 * Apply a frequency preset to an existing cron while PRESERVING its time of
 * day. Retuning the marketing brief from daily to weekly should keep it at
 * 14:07, not silently move it to midnight.
 */
export function retuneCron(currentCron: string, token: string): string | null {
  const parts = currentCron.trim().split(/\s+/);
  const [min, hour] = parts.length === 5 ? parts : ["0", "9"];
  const at = `${min} ${hour}`;
  switch (token) {
    case "daily":
      return `${at} * * *`;
    case "weekly": {
      // Keep the existing weekday when there is one; otherwise Monday.
      const dow = parts.length === 5 && parts[4] !== "*" ? parts[4] : "1";
      return `${at} * * ${dow}`;
    }
    case "monthly": {
      const dom = parts.length === 5 && parts[2] !== "*" ? parts[2] : "1";
      return `${at} ${dom} * *`;
    }
    default:
      return null;
  }
}

