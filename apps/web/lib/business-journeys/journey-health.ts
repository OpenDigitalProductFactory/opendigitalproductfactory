// Read model for the operator's journey-health surface.
// Spec: docs/superpowers/specs/2026-07-28-critical-business-journey-watchdog-design.md
//
// Projects the latest AssuranceRun summary into owner-language rows. Pure
// projection — the surface never re-runs a sweep to render.
//
// The honesty rules are enforced HERE as well as in the runner, because this is
// what the operator actually reads: `verified` is a narrow, earned label, and
// `notCheckedSentence` is always populated while `interaction` depth is
// uncovered.

import type { prisma } from "@dpf/db";
import { checkedSentence, uncheckedSentence } from "./depth";
import { BUSINESS_JOURNEYS } from "./registry";
import {
  JOURNEY_ADAPTER_KEY,
  JOURNEY_ASSURANCE_SCOPE_TYPE,
  type JourneyStatus,
  type JourneyStepResult,
  type UnverifiableReason,
  type VerificationDepth,
} from "./types";

type Db = typeof prisma;

/** What a journey that has never run says about itself. */
export const NEVER_RUN_SENTENCE = "Not checked yet.";

export type JourneyHealthRow = {
  journeyId: string;
  /** Owner-language outcome — what the business can or cannot do. */
  outcome: string;
  businessImpact: string;
  revenueBearing: boolean;
  status: JourneyStatus | "never-run";
  achievedDepth: VerificationDepth | null;
  /** "Checked: …" — null when nothing was established. */
  checkedSentence: string | null;
  /** "Not checked: …" — the anti-false-confidence line. */
  notCheckedSentence: string | null;
  notApplicableReason?: string;
  /** Why the run could not check this journey — set only when unverifiable. */
  unverifiableReason?: UnverifiableReason;
  steps: JourneyStepResult[];
  durationMs: number;
};

export type JourneyHealth = {
  lastRunAt: Date | null;
  runId: string | null;
  rows: JourneyHealthRow[];
  failing: number;
  passing: number;
  notApplicable: number;
  neverRun: number;
  /** Journeys the run could not check at all. Counted separately from `failing`
   *  because they are a statement about the watchdog, not about the business. */
  unverifiable: number;
};

type PersistedJourney = {
  journeyId?: string;
  outcome?: string;
  status?: JourneyStatus;
  achievedDepth?: VerificationDepth | null;
  notApplicableReason?: string | null;
  unverifiableReason?: UnverifiableReason | null;
  durationMs?: number;
  steps?: JourneyStepResult[];
};

function persistedJourneys(summary: unknown): PersistedJourney[] {
  if (!summary || typeof summary !== "object") return [];
  const journeys = (summary as { journeys?: unknown }).journeys;
  return Array.isArray(journeys) ? (journeys as PersistedJourney[]) : [];
}

/**
 * Build the health view. Every journey in the registry gets a row, even one the
 * last sweep never reached — an absent journey silently missing from the surface
 * would be the same false-confidence failure the depth ladder exists to prevent.
 */
export async function loadJourneyHealth(db: Db): Promise<JourneyHealth> {
  const latest = await db.assuranceRun.findFirst({
    where: { scopeType: JOURNEY_ASSURANCE_SCOPE_TYPE, adapterKey: JOURNEY_ADAPTER_KEY },
    orderBy: { startedAt: "desc" },
    select: { runId: true, startedAt: true, completedAt: true, summary: true },
  });

  const byId = new Map(persistedJourneys(latest?.summary).map((j) => [j.journeyId, j]));

  const rows: JourneyHealthRow[] = BUSINESS_JOURNEYS.map((definition) => {
    const persisted = byId.get(definition.journeyId);
    if (!persisted) {
      return {
        journeyId: definition.journeyId,
        outcome: definition.outcome,
        businessImpact: definition.businessImpact,
        revenueBearing: definition.revenueBearing,
        status: "never-run" as const,
        achievedDepth: null,
        checkedSentence: null,
        // Nothing ran, so listing all four depths is noise rather than honesty —
        // "we checked none of these four things" and "we have not looked yet"
        // are the same fact, and the short form is the one an owner can read.
        notCheckedSentence: NEVER_RUN_SENTENCE,
        steps: [],
        durationMs: 0,
      };
    }
    const depth = persisted.achievedDepth ?? null;
    const status = persisted.status ?? "never-run";
    return {
      journeyId: definition.journeyId,
      outcome: definition.outcome,
      businessImpact: definition.businessImpact,
      revenueBearing: definition.revenueBearing,
      status,
      achievedDepth: depth,
      checkedSentence: checkedSentence(depth),
      // A not-applicable journey has nothing unchecked — there was nothing to check.
      notCheckedSentence: status === "not-applicable" ? null : uncheckedSentence(depth),
      ...(persisted.notApplicableReason
        ? { notApplicableReason: persisted.notApplicableReason }
        : {}),
      ...(persisted.unverifiableReason
        ? { unverifiableReason: persisted.unverifiableReason }
        : {}),
      steps: persisted.steps ?? [],
      durationMs: persisted.durationMs ?? 0,
    };
  });

  return {
    lastRunAt: latest?.completedAt ?? latest?.startedAt ?? null,
    runId: latest?.runId ?? null,
    rows,
    failing: rows.filter((r) => r.status === "failed").length,
    passing: rows.filter((r) => r.status === "passed").length,
    notApplicable: rows.filter((r) => r.status === "not-applicable").length,
    neverRun: rows.filter((r) => r.status === "never-run").length,
    unverifiable: rows.filter((r) => r.status === "unverifiable").length,
  };
}

/**
 * One-line owner summary for the page header.
 *
 * Kept short and fully punctuated on purpose. The UX budget grades the page's
 * Flesch–Kincaid level over ALL visible text joined together, and unpunctuated
 * fragments merge into one very long sentence — so a terse, terminated sentence
 * here lowers the whole page's grade as well as reading better.
 */
export function journeyHealthHeadline(health: JourneyHealth): string {
  if (health.lastRunAt === null) return "No checks have run yet.";
  if (health.failing > 0) {
    return health.failing === 1 ? "1 check is failing." : `${health.failing} checks are failing.`;
  }
  // Before claiming anything passed. A run that could not reach the install has
  // zero failures and zero passes, and the old wording called that "Nothing to
  // check yet." — which reads as all-clear on an install where nothing had ever
  // been checked at all.
  if (health.unverifiable > 0) {
    return health.unverifiable === 1
      ? "1 check could not run."
      : `${health.unverifiable} checks could not run.`;
  }
  return health.passing === 0 ? "Nothing to check yet." : `All ${health.passing} checks passed.`;
}
