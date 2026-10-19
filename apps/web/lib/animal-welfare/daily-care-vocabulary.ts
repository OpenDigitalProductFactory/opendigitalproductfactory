/**
 * Client-safe daily-care vocabulary (BI-5A25EC37). No database import lives
 * here so the care surface's client component can share the same closed sets
 * and projection types as the server commands without pulling Prisma — and
 * with it Node built-ins — into the browser bundle.
 */

export const CARE_ROUTINE_KINDS = ["feed", "water", "medication", "walk", "clean", "weigh", "observe"] as const;
export type CareRoutineKind = (typeof CARE_ROUTINE_KINDS)[number];

export const CARE_ROUND_OUTCOMES = ["done", "partial", "refused", "not-eaten", "concern"] as const;
export type CareRoundOutcome = (typeof CARE_ROUND_OUTCOMES)[number];

/** Outcomes that mean the round happened but the animal needs a person's attention. */
export const EXCEPTION_OUTCOMES: ReadonlySet<CareRoundOutcome> = new Set(["refused", "not-eaten", "concern"]);

export const KIND_LABEL: Record<CareRoutineKind, string> = {
  feed: "Feed",
  water: "Water",
  medication: "Medication",
  walk: "Walk",
  clean: "Clean",
  weigh: "Weigh",
  observe: "Welfare check",
};

export interface CareRound {
  id: string;
  title: string;
  kind: CareRoutineKind | null;
  instruction: string | null;
  animalProfileId: string | null;
  animalName: string;
  animalRef: string | null;
  dueAt: string;
  status: string;
  overdue: boolean;
  medicationOverdue: boolean;
}

export interface CareEscalation {
  id: string;
  title: string;
  reason: string | null;
  animalName: string;
  raisedAt: string;
}

export interface DailyCareBoard {
  rounds: CareRound[];
  escalations: CareEscalation[];
  animals: Array<{ animalProfileId: string; name: string; animalRef: string }>;
  limit: number;
}
