// BI-78D3CF1E — make a lapsed consent request countable.
//
// A CoworkerActionEnvelope is a coworker asking one named human to approve one
// side-effecting call, and it expires 15 minutes after it is raised. An envelope
// nobody answers transitions to nothing: no alert, no error, no row anywhere an
// operator looks. Seven lapsed unactioned on the founder's install before an
// approval surface existed, and the only way to learn that was to query the
// table by hand.
//
// The approval surface itself shipped separately (#4660). This closes the other
// half: whatever the surface, a consent request that can vanish silently needs a
// number attached to it. Two gauges — how many are waiting on a person right
// now, and how many closed unanswered.
//
// Deliberately a read-only projection. It never mutates an envelope — an
// observer that quietly expired rows would be changing the thing it measures,
// and the state machine owns that transition.

/** Terminal outcomes worth counting separately. `expired` is the point. */
export const ENVELOPE_OUTCOMES = [
  "approved",
  "declined",
  "cancelled",
  "executed",
  "failed",
  "expired",
] as const;
export type EnvelopeOutcome = (typeof ENVELOPE_OUTCOMES)[number];

/** The envelope fields this projection needs. Kept Prisma-free so it is pure. */
export interface ObservableEnvelope {
  status: string;
  manifestActionId: string;
  expiresAt: Date | null;
  resolvedAt: Date | null;
}

export interface EnvelopeObservation {
  /** Currently proposed AND unexpired — someone can still act on these. */
  awaitingDecision: number;
  /**
   * Proposed, past expiry, never resolved. The silent failure: the status still
   * reads `proposed` because nothing rewrites it, so a naive count of
   * `status = proposed` overstates how many are actionable.
   */
  expiredUnactioned: number;
  /** Per-outcome totals, including `expired`. */
  byOutcome: Record<EnvelopeOutcome, number>;
  /** Action ids that lapsed, so an operator sees WHAT went unanswered. */
  expiredActions: string[];
}

function emptyOutcomes(): Record<EnvelopeOutcome, number> {
  return {
    approved: 0,
    declined: 0,
    cancelled: 0,
    executed: 0,
    failed: 0,
    expired: 0,
  };
}

function isOutcome(value: string): value is EnvelopeOutcome {
  return (ENVELOPE_OUTCOMES as readonly string[]).includes(value);
}

/**
 * Project a set of envelopes into the observation.
 *
 * Pure and total: `now` is injected, an unrecognised status is ignored rather
 * than crashing the projection, and a missing `expiresAt` is treated as "no time
 * limit" rather than as already expired.
 */
export function observeEnvelopes(
  envelopes: readonly ObservableEnvelope[],
  now: Date,
): EnvelopeObservation {
  const byOutcome = emptyOutcomes();
  let awaitingDecision = 0;
  let expiredUnactioned = 0;
  const expiredActions: string[] = [];

  for (const envelope of envelopes) {
    if (envelope.status === "proposed") {
      const lapsed =
        envelope.expiresAt !== null &&
        envelope.resolvedAt === null &&
        envelope.expiresAt.getTime() <= now.getTime();
      if (lapsed) {
        expiredUnactioned += 1;
        byOutcome.expired += 1;
        expiredActions.push(envelope.manifestActionId);
      } else {
        awaitingDecision += 1;
      }
      continue;
    }
    if (isOutcome(envelope.status)) byOutcome[envelope.status] += 1;
  }

  return { awaitingDecision, expiredUnactioned, byOutcome, expiredActions };
}

/** The metric sinks this module writes to. Injected so it is testable. */
export interface EnvelopeMetricSinks {
  awaiting: { set(value: number): void };
  expiredUnactioned: { set(value: number): void };
}

/**
 * Publish an observation to the metrics registry.
 *
 * Both sinks are GAUGES. This is observed periodically rather than emitted once
 * per transition, so a counter would multiply by however often anyone looks.
 *
 * Never throws: observability must not be able to break the surface that calls
 * it, matching the workspace-home resolver counter's rule.
 */
export function publishEnvelopeObservation(
  observation: EnvelopeObservation,
  sinks: EnvelopeMetricSinks,
): void {
  try {
    sinks.awaiting.set(observation.awaitingDecision);
    sinks.expiredUnactioned.set(observation.expiredUnactioned);
  } catch {
    // Swallow — a registry mishap must not affect the caller.
  }
}

/** The counting reads this module needs. Kept Prisma-free. */
export interface EnvelopeCountStore {
  countProposedWithin(now: Date): Promise<number>;
  countProposedExpired(now: Date): Promise<number>;
}

/**
 * Observe the install-wide envelope backlog with two COUNTS, not row fetches.
 *
 * Install-wide on purpose: the question an operator has is "are consent requests
 * lapsing here", not "are mine". Counting keeps it cheap enough to run on a
 * surface render without competing with the page it rides on.
 */
export async function observeEnvelopeBacklog(
  store: EnvelopeCountStore,
  sinks: EnvelopeMetricSinks,
  now: Date,
): Promise<EnvelopeObservation> {
  const observation: EnvelopeObservation = {
    awaitingDecision: 0,
    expiredUnactioned: 0,
    byOutcome: emptyOutcomes(),
    expiredActions: [],
  };
  try {
    const [awaiting, expired] = await Promise.all([
      store.countProposedWithin(now),
      store.countProposedExpired(now),
    ]);
    observation.awaitingDecision = awaiting;
    observation.expiredUnactioned = expired;
    observation.byOutcome.expired = expired;
  } catch {
    // A failed count publishes nothing rather than publishing a zero, because a
    // fabricated zero reads as "nothing is lapsing" — the precise false comfort
    // this metric exists to remove.
    return observation;
  }
  publishEnvelopeObservation(observation, sinks);
  return observation;
}
