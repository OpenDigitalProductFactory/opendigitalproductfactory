// apps/web/lib/compliance/obligation-cadence.ts
//
// What `Obligation.frequency` and `Control.reviewFrequency` actually mean.
//
// The column looks like a schedule and is not one. Across the seven seeded
// compliance packs it holds exactly four values, and they are THREE different
// kinds of thing:
//
//   annual (27), monthly (7)  → a real recurrence. A date can be computed, and
//                               an obligation with no anchor date is a defect:
//                               nothing will ever fall due.
//   continuous (46)           → a standing control. It is not scheduled at all;
//                               it is in force every day. Having no next date is
//                               CORRECT, not missing.
//   event-driven (42)         → started by an occurrence (a breach, a request, a
//                               filing). Also correctly dateless: the trigger is
//                               the event, not the calendar.
//
// Reading all four as "a recurrence" made the first deadline-horizon sweep
// report 141 findings on the live install of which 88 were false — it told an
// operator that 88 correctly-configured obligations were broken. An
// over-reporting compliance ledger is worse than none: it trains the reader to
// dismiss the whole list, including the 34 findings that are real.
//
// These map onto the TAK §8.11.1 trigger vocabulary already used by the
// work-shape registry, deliberately: `cadence` obligations are what the
// `deadline-horizon` trigger consumes, and the other two classes are consumed
// by nothing here and must not be reported as if they were.

export const OBLIGATION_TRIGGER_CLASSES = [
  /** A recurrence a date can be computed from. Consumed by `deadline-horizon`. */
  "cadence",
  /** A standing control, in force every day. Correctly has no next date. */
  "continuous",
  /** Started by an occurrence, not the calendar. Correctly has no next date. */
  "event-driven",
  /** Words present, but no period can be computed and no class recognised. */
  "unrecognised",
  /** No frequency recorded at all. */
  "unspecified",
] as const;
export type ObligationTriggerClass = (typeof OBLIGATION_TRIGGER_CLASSES)[number];

/**
 * Recurrence words that yield a computable period, in days.
 * Deliberately closed. An unrecognised word is reported as `unrecognised`, never
 * guessed at — a cadence nobody can compute is not a control, and inventing a
 * period would put a fabricated due date in front of a compliance owner.
 */
export const CADENCE_PERIOD_DAYS: Readonly<Record<string, number>> = {
  daily: 1,
  weekly: 7,
  biweekly: 14,
  fortnightly: 14,
  monthly: 30,
  bimonthly: 60,
  quarterly: 91,
  "semi-annual": 182,
  semiannual: 182,
  "half-yearly": 182,
  biannual: 182,
  annual: 365,
  annually: 365,
  yearly: 365,
  biennial: 730,
  triennial: 1095,
};

/** Words that declare a standing, always-in-force control rather than a schedule. */
const CONTINUOUS_WORDS = new Set(["continuous", "continual", "ongoing", "standing", "always"]);

/** Words that declare an occurrence-started obligation rather than a schedule. */
const EVENT_DRIVEN_WORDS = new Set([
  "event-driven",
  "event driven",
  "on-event",
  "as-needed",
  "as needed",
  "on-request",
  "on request",
  "ad-hoc",
  "ad hoc",
]);

export type ObligationCadence = {
  triggerClass: ObligationTriggerClass;
  /** Days between occurrences. Non-null only for `cadence`. */
  periodDays: number | null;
  /** True only when a next date is meaningful and therefore required. */
  requiresAnchorDate: boolean;
};

/**
 * Classify a recorded frequency. Total and side-effect free: every input lands
 * in exactly one class, and only `cadence` ever asks for a date.
 */
export function classifyObligationFrequency(frequency: string | null | undefined): ObligationCadence {
  if (typeof frequency !== "string" || frequency.trim() === "") {
    return { triggerClass: "unspecified", periodDays: null, requiresAnchorDate: false };
  }
  const normalized = frequency.trim().toLowerCase();

  const periodDays = CADENCE_PERIOD_DAYS[normalized];
  if (periodDays !== undefined) {
    return { triggerClass: "cadence", periodDays, requiresAnchorDate: true };
  }
  if (CONTINUOUS_WORDS.has(normalized)) {
    return { triggerClass: "continuous", periodDays: null, requiresAnchorDate: false };
  }
  if (EVENT_DRIVEN_WORDS.has(normalized)) {
    return { triggerClass: "event-driven", periodDays: null, requiresAnchorDate: false };
  }
  // Words are recorded and mean something to a person, but nothing here can
  // turn them into a date. Surfaced as its own low-severity finding rather than
  // silently treated as either a schedule or a standing control.
  return { triggerClass: "unrecognised", periodDays: null, requiresAnchorDate: false };
}

/** Convenience for the sweep: days between occurrences, or null. */
export function cadenceToDays(frequency: string | null | undefined): number | null {
  return classifyObligationFrequency(frequency).periodDays;
}

/** The vocabulary a seed may write. Pinned by a conformance test over every pack. */
export const SEEDABLE_OBLIGATION_FREQUENCIES: readonly string[] = [
  ...Object.keys(CADENCE_PERIOD_DAYS),
  ...CONTINUOUS_WORDS,
  ...EVENT_DRIVEN_WORDS,
];
