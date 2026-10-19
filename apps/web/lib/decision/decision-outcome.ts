// BI-F302B80E slice 1, part 2. Whether the kernel's recommendation was FOLLOWED.
//
// Part 1 gave the kernel's own pick a column (`recommendedOptionId`, 658 of
// 1,080 rows). Nothing then recorded what the caller actually did, so the pick
// was a dead end: `chosenOptionId` and `humanOutcome` had no writer on the
// kernel-consult path, and `principle_decide` rows are excluded from every
// owner-ruling surface by design (`owner-ruling-queue.ts`). A recorded
// recommendation that nobody can compare to an action measures nothing.
//
// This module is the RULE half and is deliberately pure: the same predicate
// that decides whether a resolution may be recorded also decides whether a row
// belongs in an agreement denominator. Keeping those in one place is the point
// — a rate computed over a population defined somewhere else is how a
// flattering number gets produced.
//
// Three refusals, each protecting a way the number could lie:
//
//   no-recommendation   the kernel abstained, so there is nothing to agree or
//                       disagree with. Recording one would invent a comparison.
//   already-resolved    an outcome is already on the row. An override is the
//                       single highest-value row in this corpus — a labelled
//                       correction — and silently overwriting one destroys it.
//   option-not-offered  the named option was never scored, so "the kernel was
//                       wrong" would be a claim about a menu it never saw.
//
// `unresolved` is a RECORDED state, never an absent row. Absence means nobody
// reported back; it must never be read as agreement.

/** What the actor did with the kernel's recommendation. */
export const DECISION_DISPOSITIONS = ["followed", "overridden", "unresolved"] as const;
export type DecisionDisposition = (typeof DECISION_DISPOSITIONS)[number];

/**
 * Who reported the outcome. These are never pooled into one rate: an agent
 * agreeing with the kernel and a human agreeing with the kernel are different
 * measurements, and averaging them describes neither.
 */
export const DECISION_RESOLVERS = ["human", "agent"] as const;
export type DecisionResolver = (typeof DECISION_RESOLVERS)[number];

export const RESOLUTION_REFUSALS = [
  "no-recommendation",
  "already-resolved",
  "option-not-offered",
] as const;
export type ResolutionRefusal = (typeof RESOLUTION_REFUSALS)[number];

/** The recorded columns this module reasons over. Nothing else is read. */
export type ResolvableDecisionRow = {
  interactionId: string;
  /** The kernel's argmax pick, or null when it abstained. */
  recommendedOptionId: string | null;
  /** Set once an outcome has been recorded. */
  chosenOptionId: string | null;
  /** Set once an outcome has been recorded; shape is opaque here. */
  humanOutcome: unknown;
  /** Option ids that were actually scored, in the order supplied. */
  options: string[];
  /** True when no human was in the loop when the decision was MADE. */
  autonomous: boolean;
};

export type ResolutionRequest = {
  /**
   * The option the actor went with, or null to record explicitly that the
   * decision was left unresolved. Null is a disposition, not an omission.
   */
  chosenOptionId: string | null;
  resolvedBy: DecisionResolver;
};

export type ResolutionPlan = {
  accepted: true;
  disposition: DecisionDisposition;
  chosenOptionId: string | null;
  /**
   * True when the actor went with the kernel's pick, false when it diverged,
   * null when the decision was left unresolved. Null is NOT disagreement —
   * anything that counts it as either is measuring the wrong thing.
   */
  agreement: boolean | null;
  resolvedBy: DecisionResolver;
};

export type ResolutionRefusalResult = { accepted: false; reason: ResolutionRefusal; detail: string };

export type ResolutionOutcome = ResolutionPlan | ResolutionRefusalResult;

/** True once any outcome has been recorded on the row. */
export function isResolved(row: Pick<ResolvableDecisionRow, "chosenOptionId" | "humanOutcome">): boolean {
  return row.chosenOptionId !== null || (row.humanOutcome !== null && row.humanOutcome !== undefined);
}

/**
 * Whether a resolution MAY be recorded against this row, and what it would
 * mean. Pure; performs no IO and mutates nothing.
 */
export function planResolution(
  row: ResolvableDecisionRow,
  request: ResolutionRequest,
): ResolutionOutcome {
  if (row.recommendedOptionId === null) {
    return {
      accepted: false,
      reason: "no-recommendation",
      detail:
        "The kernel made no recommendation on this decision, so there is nothing for an outcome to "
        + "agree or disagree with. Recording one would manufacture a comparison that never happened.",
    };
  }

  if (isResolved(row)) {
    return {
      accepted: false,
      reason: "already-resolved",
      detail:
        "An outcome is already recorded on this decision. An override is a labelled correction and "
        + "the most informative row in this corpus; overwriting one silently destroys it. Record an "
        + "amendment as its own decision rather than replacing this one.",
    };
  }

  if (request.chosenOptionId === null) {
    return {
      accepted: true,
      disposition: "unresolved",
      chosenOptionId: null,
      agreement: null,
      resolvedBy: request.resolvedBy,
    };
  }

  if (!row.options.includes(request.chosenOptionId)) {
    return {
      accepted: false,
      reason: "option-not-offered",
      detail:
        `Option ${JSON.stringify(request.chosenOptionId)} was not among the options scored for this `
        + `decision (${row.options.map((id) => JSON.stringify(id)).join(", ") || "none recorded"}). `
        + "Recording it would score the kernel against a menu it never saw.",
    };
  }

  const followed = request.chosenOptionId === row.recommendedOptionId;
  return {
    accepted: true,
    disposition: followed ? "followed" : "overridden",
    chosenOptionId: request.chosenOptionId,
    agreement: followed,
    resolvedBy: request.resolvedBy,
  };
}

/**
 * The payload written to `humanOutcome`. Named for the column, which predates
 * agent-reported resolutions; `resolvedBy` carries which kind this is, so a
 * reader never has to assume a human was involved.
 */
export type RecordedResolution = {
  type: "kernel-consult-resolution";
  disposition: DecisionDisposition;
  resolvedBy: DecisionResolver;
  recommendedOptionId: string;
  chosenOptionId: string | null;
  agreement: boolean | null;
  rationale: string;
  resolvedAt: string;
};

export function buildRecordedResolution(input: {
  plan: ResolutionPlan;
  recommendedOptionId: string;
  rationale: string;
  now: Date;
}): RecordedResolution {
  return {
    type: "kernel-consult-resolution",
    disposition: input.plan.disposition,
    resolvedBy: input.plan.resolvedBy,
    recommendedOptionId: input.recommendedOptionId,
    chosenOptionId: input.plan.chosenOptionId,
    agreement: input.plan.agreement,
    rationale: input.rationale,
    resolvedAt: input.now.toISOString(),
  };
}

/** A row as it appears to the denominator calculation. */
export type AgreementInputRow = ResolvableDecisionRow & {
  /** Parsed `humanOutcome`, when it is one of ours. */
  resolution: RecordedResolution | null;
};

export type AgreementPopulation = {
  /** Rows that could never carry an agreement signal, and why. */
  ineligible: { noRecommendation: number; unattended: number };
  /** Rows that could, split by whether anyone reported back. */
  eligible: number;
  reported: number;
  /**
   * Eligible rows nobody reported an outcome for. Counted, never assumed —
   * silence is not agreement.
   */
  unreported: number;
  /** Per-resolver breakdown. Deliberately never summed into one rate. */
  byResolver: Record<
    DecisionResolver,
    { followed: number; overridden: number; unresolved: number; denominator: number; rate: number | null }
  >;
};

/**
 * Read a resolution payload back, returning null for anything that is not one
 * of ours — an escalation answer, a machine withdrawal, or a legacy shape.
 */
export function readRecordedResolution(value: unknown): RecordedResolution | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.type !== "kernel-consult-resolution") return null;
  const disposition = candidate.disposition;
  const resolvedBy = candidate.resolvedBy;
  if (!(DECISION_DISPOSITIONS as readonly unknown[]).includes(disposition)) return null;
  if (!(DECISION_RESOLVERS as readonly unknown[]).includes(resolvedBy)) return null;
  return candidate as unknown as RecordedResolution;
}

/**
 * Classify a set of rows into the population an agreement rate may legitimately
 * use. Excludes by CONSTRUCTION rather than by a filter a later reader has to
 * remember: a decision nobody attended and a decision the kernel abstained on
 * are counted separately and never reach a numerator.
 *
 * A rate is null, not zero, when its denominator is empty. Zero would read as
 * "never agreed".
 */
export function summarizeAgreement(rows: AgreementInputRow[]): AgreementPopulation {
  const byResolver: AgreementPopulation["byResolver"] = {
    human: { followed: 0, overridden: 0, unresolved: 0, denominator: 0, rate: null },
    agent: { followed: 0, overridden: 0, unresolved: 0, denominator: 0, rate: null },
  };
  let noRecommendation = 0;
  let unattended = 0;
  let eligible = 0;
  let reported = 0;

  for (const row of rows) {
    if (row.recommendedOptionId === null) {
      noRecommendation += 1;
      continue;
    }
    if (row.autonomous && row.resolution === null) {
      // An unattended decision nobody reported back on. Counting it would put a
      // decision with no second party into a denominator by the back door.
      unattended += 1;
      continue;
    }
    eligible += 1;
    if (row.resolution === null) continue;
    reported += 1;
    const bucket = byResolver[row.resolution.resolvedBy];
    bucket[row.resolution.disposition] += 1;
  }

  for (const resolver of DECISION_RESOLVERS) {
    const bucket = byResolver[resolver];
    // `unresolved` is reported but carries no agreement signal, so it is
    // counted and then kept out of the denominator.
    bucket.denominator = bucket.followed + bucket.overridden;
    bucket.rate = bucket.denominator === 0 ? null : bucket.followed / bucket.denominator;
  }

  return {
    ineligible: { noRecommendation, unattended },
    eligible,
    reported,
    unreported: eligible - reported,
    byResolver,
  };
}
