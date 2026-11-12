// BI-FEDD8F45 — the retirement ratchet's decision, pure.
// Design: docs/superpowers/specs/2026-10-14-guard-outcome-efficacy-design.md §4.5.
//
// This never disables or deletes a guard. It decides which guards a person
// should review, and why, with the counts and their denominators. The floors
// keep it from filing on thin evidence; the window restart keeps it from
// re-filing a guard whose review just closed or whose code just changed.

export const DEFAULT_REVIEW_WINDOW_DAYS = 90;
export const R1A_MIN_RUNS = 30;
export const R1B_MIN_CLASSIFIED = 4;
export const R2_MIN_DECIDED = 4;
export const R2_FALSE_REFUSAL_THRESHOLD = 0.25;
export const MAX_NEW_GUARD_ITEMS_PER_RUN = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

export type GuardDeclaration = {
  owner: string;
  purpose: string;
  catchClass: string;
  declared: boolean;
  reviewWindowDays: number;
  keep: { owner: string; expiry: string; reason: string; decisionRef: string | null } | null;
};

/** Per-guard evidence over its window, computed by the store. */
export type GuardEvidence = {
  guardId: string;
  /** When the guard's current digest was first recorded. */
  currentDigestFirstSeenAt: Date;
  runs: number;
  refusals: number;
  caught: number;
  falseRefusals: number;
  overridden: number;
  unresolved: number;
  totalDurationMs: number;
  medianDurationMs: number;
};

export type RetirementRule = "R-1a" | "R-1b" | "R-2";

export type RetirementFinding = {
  guardId: string;
  rule: RetirementRule;
  windowDays: number;
  evidence: GuardEvidence;
  declaration: GuardDeclaration;
  /** e.g. "false refusals 3 of 4 decided refusals (75%)" */
  measure: string;
};

export type RetirementEvaluation = {
  /** One item each, capped. */
  perGuard: RetirementFinding[];
  /** Over the cap: filed on a later run. */
  deferred: RetirementFinding[];
  /** R-1a: one weekly digest item lists them all. */
  digest: RetirementFinding[];
  silencedByKeep: string[];
  undeclared: string[];
};

/** The derived default for a guard with no declaration (design §4.4). */
export function undeclaredGuard(): GuardDeclaration {
  return {
    owner: "platform-engineering",
    purpose: "undeclared",
    catchClass: "unknown",
    declared: false,
    reviewWindowDays: DEFAULT_REVIEW_WINDOW_DAYS,
    keep: null,
  };
}

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Read one guard's entry from the declarations file; tolerant of anything malformed. */
export function readDeclaration(guardId: string, guards: unknown): GuardDeclaration {
  const entry = guards && typeof guards === "object" ? (guards as Record<string, unknown>)[guardId] : undefined;
  if (!entry || typeof entry !== "object") return undeclaredGuard();
  const e = entry as Record<string, unknown>;
  const owner = nonEmpty(e.owner);
  const purpose = nonEmpty(e.purpose);
  const catchClass = nonEmpty(e.catchClass);
  const keepRaw = e.keep && typeof e.keep === "object" ? (e.keep as Record<string, unknown>) : null;
  const keepOwner = nonEmpty(keepRaw?.owner);
  const keepReason = nonEmpty(keepRaw?.reason);
  const keepExpiry = typeof keepRaw?.expiry === "string" && /^\d{4}-\d{2}-\d{2}$/.test(keepRaw.expiry) ? keepRaw.expiry : null;
  return {
    owner: owner ?? "platform-engineering",
    purpose: purpose ?? "undeclared",
    catchClass: catchClass ?? "unknown",
    declared: Boolean(owner && purpose && catchClass),
    reviewWindowDays:
      typeof e.reviewWindowDays === "number" && Number.isInteger(e.reviewWindowDays) && e.reviewWindowDays > 0
        ? e.reviewWindowDays
        : DEFAULT_REVIEW_WINDOW_DAYS,
    keep: keepOwner && keepReason && keepExpiry ? { owner: keepOwner, expiry: keepExpiry, reason: keepReason, decisionRef: nonEmpty(keepRaw?.decisionRef) } : null,
  };
}

function percent(numerator: number, denominator: number): string {
  return `${Math.round((numerator / denominator) * 100)}%`;
}

/**
 * The window start for a guard: the latest of (now − window), the moment its
 * current digest appeared, and the close of its last review item.
 */
export function windowStartFor(
  windowDays: number,
  now: Date,
  currentDigestFirstSeenAt: Date,
  lastReviewClosedAt: Date | null,
): Date {
  const candidates = [now.getTime() - windowDays * DAY_MS, currentDigestFirstSeenAt.getTime()];
  if (lastReviewClosedAt) candidates.push(lastReviewClosedAt.getTime());
  return new Date(Math.max(...candidates));
}

function ruleFor(evidence: GuardEvidence, windowCovered: boolean): { rule: RetirementRule; measure: string } | null {
  const decided = evidence.caught + evidence.falseRefusals;
  if (decided >= R2_MIN_DECIDED && evidence.falseRefusals / decided > R2_FALSE_REFUSAL_THRESHOLD) {
    return {
      rule: "R-2",
      measure: `false refusals ${evidence.falseRefusals} of ${decided} decided refusals (${percent(evidence.falseRefusals, decided)})`,
    };
  }
  const classified = evidence.caught + evidence.falseRefusals + evidence.overridden + evidence.unresolved;
  if (classified >= R1B_MIN_CLASSIFIED && evidence.caught === 0) {
    return { rule: "R-1b", measure: `0 caught of ${classified} classified refusals` };
  }
  if (evidence.refusals === 0 && evidence.runs >= R1A_MIN_RUNS && windowCovered) {
    return { rule: "R-1a", measure: `0 refusals in ${evidence.runs} runs` };
  }
  return null;
}

/**
 * Decide which guards need review. `evidence` must already be restricted to
 * each guard's window (see windowStartFor); `windowCovered` says whether that
 * window is fully covered by records, which R-1a requires.
 */
export function evaluateGuardRetirement(input: {
  now: Date;
  guards: ReadonlyArray<{
    evidence: GuardEvidence;
    declaration: GuardDeclaration;
    windowCovered: boolean;
    /** An open review item already exists for this guard. */
    reviewOpen: boolean;
  }>;
  maxNewItems?: number;
}): RetirementEvaluation {
  const today = input.now.toISOString().slice(0, 10);
  const result: RetirementEvaluation = { perGuard: [], deferred: [], digest: [], silencedByKeep: [], undeclared: [] };
  const cap = input.maxNewItems ?? MAX_NEW_GUARD_ITEMS_PER_RUN;
  let filedNew = 0;

  const ordered = [...input.guards].sort((a, b) => a.evidence.guardId.localeCompare(b.evidence.guardId));
  for (const { evidence, declaration, windowCovered, reviewOpen } of ordered) {
    if (!declaration.declared) result.undeclared.push(evidence.guardId);
    if (declaration.keep && declaration.keep.expiry >= today) {
      result.silencedByKeep.push(evidence.guardId);
      continue;
    }
    const decided = ruleFor(evidence, windowCovered);
    if (!decided) continue;
    const finding: RetirementFinding = {
      guardId: evidence.guardId,
      rule: decided.rule,
      windowDays: declaration.reviewWindowDays,
      evidence,
      declaration,
      measure: decided.measure,
    };
    if (decided.rule === "R-1a") {
      result.digest.push(finding);
    } else if (reviewOpen) {
      // Recurrence: the filer bumps the open item, which costs no review slot.
      result.perGuard.push(finding);
    } else if (filedNew < cap) {
      result.perGuard.push(finding);
      filedNew += 1;
    } else {
      result.deferred.push(finding);
    }
  }
  return result;
}

/** ISO week key (e.g. 2026-W42) for the weekly digest item. */
export function isoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
