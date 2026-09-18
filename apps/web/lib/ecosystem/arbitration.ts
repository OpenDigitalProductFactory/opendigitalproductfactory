/**
 * Arbitration under limited capacity (BI-4C8A83AB).
 *
 * When capacity binds, something must go first. Precedence is the score the
 * demand engine ALREADY computed — now with the vote-derived inputs populated —
 * and then three tie-breaks, in this order:
 *
 *   1. a defect blocking an install's core value stream outranks an
 *      enhancement, whatever the tally. A shop that cannot take orders is not
 *      outvoted by a hundred installs wanting a nicer report.
 *   2. breadth over intensity — more affected organisations first.
 *   3. oldest unanswered first, so a minority submitter is not starved
 *      indefinitely by a popular one.
 *
 * The result is ADVISORY. `commons-are-curated-not-just-appended` applies:
 * guards nominate, the accountable human decides. Apache's rule is the same —
 * a +1 is a signal, not a vote.
 */

export interface ArbitrationCandidate {
  ref: string;
  title: string;
  /** Score from the demand engine. Null when unscored — never coerced to zero. */
  score: number | null;
  /** True when the submission reports a blocked core value stream. */
  blocksValueStream?: boolean;
  workType?: string | null;
  affectedOrganizations?: number | null;
  /** When it was submitted — the starvation guard. */
  submittedAt: Date;
  /** When it last received a disposition, or null if never answered. */
  answeredAt?: Date | null;
}

export interface ArbitrationEntry extends ArbitrationCandidate {
  rank: number;
  /** Plain-language justification for this position. */
  rationale: string;
}

function isBlocking(candidate: ArbitrationCandidate): boolean {
  return candidate.blocksValueStream === true;
}

function rationaleFor(candidate: ArbitrationCandidate, unanswered: boolean): string {
  if (isBlocking(candidate)) return "blocks a core value stream, which outranks the tally";
  const parts: string[] = [];
  parts.push(candidate.score === null ? "not yet scored" : `score ${candidate.score}`);
  if (typeof candidate.affectedOrganizations === "number") {
    parts.push(`${candidate.affectedOrganizations} organization${candidate.affectedOrganizations === 1 ? "" : "s"} affected`);
  }
  if (unanswered) parts.push("still unanswered");
  return parts.join(" · ");
}

/**
 * Order candidates for a capacity-bound queue.
 *
 * Deterministic: equal candidates fall through to `ref` so two runs over the
 * same input never disagree. A queue that reshuffles itself is not a queue an
 * operator can act on.
 */
export function arbitrate(candidates: ArbitrationCandidate[], now: Date = new Date()): ArbitrationEntry[] {
  const ordered = [...candidates].sort((a, b) => {
    // 1. Value-stream blockers first, regardless of score or tally.
    const blocking = Number(isBlocking(b)) - Number(isBlocking(a));
    if (blocking !== 0) return blocking;

    // 2. The score the demand engine already computed. Unscored sorts last
    //    rather than as zero — "not scored" is not "scored zero".
    if (a.score !== b.score) {
      if (a.score === null) return 1;
      if (b.score === null) return -1;
      return b.score - a.score;
    }

    // 3. Breadth over intensity.
    const reach = (b.affectedOrganizations ?? 0) - (a.affectedOrganizations ?? 0);
    if (reach !== 0) return reach;

    // 4. Oldest unanswered first — the starvation guard.
    const age = a.submittedAt.getTime() - b.submittedAt.getTime();
    if (age !== 0) return age;

    return a.ref.localeCompare(b.ref);
  });

  return ordered.map((candidate, index) => ({
    ...candidate,
    rank: index + 1,
    rationale: rationaleFor(candidate, !candidate.answeredAt),
  }));
}

export interface CapacityDraw {
  /** What this cycle's capacity can fund. */
  funded: ArbitrationEntry[];
  /** Everything else, in order, so the queue is visible rather than silent. */
  queued: ArbitrationEntry[];
}

/**
 * Split an arbitrated queue at the capacity line.
 *
 * Starvation is made VISIBLE rather than fixed by magic: what could not be
 * funded stays in `queued`, in order, so an operator can see the line and a
 * submitter can be told honestly where they stand. A silent drop is the failure
 * mode this exists to avoid.
 */
export function drawAgainstCapacity(
  entries: ArbitrationEntry[],
  capacity: number,
): CapacityDraw {
  if (!Number.isFinite(capacity) || capacity <= 0) return { funded: [], queued: entries };
  return { funded: entries.slice(0, capacity), queued: entries.slice(capacity) };
}

export type DispositionOutcome = "scheduled" | "declined" | "deferred";

export interface DispositionNotice {
  ref: string;
  outcome: DispositionOutcome;
  reason: string;
}

/**
 * Every submission that entered arbitration leaves it with an answer.
 *
 * This is the §3.5 closure obligation made mechanical: funded work is
 * `scheduled`, queued work is `deferred` WITH ITS POSITION, and nothing is left
 * silent. Ubuntu Brainstorm was retired for accumulating votes that were never
 * answered; a queue that answers nobody reproduces that failure exactly.
 */
export function buildDispositions(draw: CapacityDraw): DispositionNotice[] {
  return [
    ...draw.funded.map((entry) => ({
      ref: entry.ref,
      outcome: "scheduled" as const,
      reason: `funded this cycle at position ${entry.rank} — ${entry.rationale}`,
    })),
    ...draw.queued.map((entry) => ({
      ref: entry.ref,
      outcome: "deferred" as const,
      reason: `queued at position ${entry.rank}, beyond this cycle's capacity — ${entry.rationale}`,
    })),
  ];
}
