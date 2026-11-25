// Pure measures for the closure scorecard (BI-97C56E20).
//
// The question each stream answers is the same: over the week, did the
// platform finish at least as much as it started? A stream whose inflow
// exceeds its outflow is accumulating; the scorecard says so in one word and
// shows the same numbers a week earlier, so a fix is visible as a change of
// direction rather than an anecdote.
//
// Flows are derived, not timestamped. Most of these records carry no
// state-transition timestamp (a signal or proposal has only `updatedAt`, which
// any later edit moves), so each run snapshots how many records sit in each
// state, and a week's flow is the difference between this snapshot and the one
// recorded seven days earlier. Only a change of state moves a state count, so
// an unrelated edit can never re-count an old closure. The two streams that are
// naturally events (owner-attention asks, decisions) are counted in the window
// by an indexed `createdAt`.
//
// Pure: no reads, no writes, no clock.

/** Point-in-time counts by state, read from indexed status or phase columns. */
export type ClosureSnapshot = {
  builds: {
    total: number;
    complete: number;
    abandoned: number;
    failed: number;
    /** Non-terminal builds untouched for more than seven days. */
    stranded: number;
  };
  signals: { total: number; open: number; closed: number };
  proposals: {
    total: number;
    /** proposed, reviewed, prioritized or in_progress. */
    open: number;
    /** implemented or verified: the change was made. */
    implemented: number;
    rejected: number;
  };
  backlog: { total: number; done: number; retired: number };
  /** Items the platform filed about itself (source automated-detection). */
  selfFiled: { total: number; done: number };
  acceptance: {
    /** Awaiting acceptance and owned by this install. */
    local: number;
    /** Awaiting acceptance but owned by a peer install; only it may close them. */
    peerOwned: number;
    /** Median days since a locally owned awaiting item last changed. */
    localMedianDaysSinceChange: number | null;
  };
  escalations: {
    /** Owner-attention reports still awaiting the owner's acknowledgement. */
    held: number;
    oldestHeldDays: number | null;
  };
};

/** Event counts inside the window, read by an indexed `createdAt`. */
export type ClosureWindowFlows = {
  /**
   * Distinct owner-attention asks raised in the window (one per dedupe key),
   * each classified once: for the owner when any of its reports carried the
   * owner self-fix class, otherwise routed to an agent when it was filed as a
   * routed repair. A classification, not proof the owner was notified.
   */
  asks: { forOwner: number; routedToAgent: number };
  decisions: { total: number; recommended: number };
};

export type ClosureCounts = { snapshot: ClosureSnapshot; window: ClosureWindowFlows };

/** The week's derived flows; each is null when there is no baseline snapshot. */
export type WeekFlows = {
  buildsStarted: number | null;
  buildsCompleted: number | null;
  buildsEnded: number | null;
  signalsFiled: number | null;
  signalsClosed: number | null;
  proposalsFiled: number | null;
  proposalsImplemented: number | null;
  proposalsEnded: number | null;
  backlogFiled: number | null;
  backlogEnded: number | null;
  selfFiled: number | null;
  selfDone: number | null;
};

export type Better = "higher" | "lower";
export type Direction = "improving" | "worsening" | "flat" | "no-baseline";
export type StreamState = "closing" | "accumulating" | "idle" | "no-baseline";

export type ScorecardLine = {
  key: string;
  label: string;
  value: number | null;
  previous: number | null;
  better: Better;
  direction: Direction;
};

export type ScorecardStream = {
  key: string;
  label: string;
  /** Net records that entered the stream this week. */
  inflow: number | null;
  /** Net records that left the stream this week. */
  outflow: number | null;
  state: StreamState;
};

export type ClosureScorecard = {
  flows: WeekFlows;
  streams: ScorecardStream[];
  lines: ScorecardLine[];
  /** Streams accumulating this week, named for the one-line summary. */
  accumulating: string[];
};

/** What the run recorded seven days earlier. */
export type PriorRun = { counts: ClosureCounts; flows: WeekFlows | null };

/** A change smaller than this share of the previous value reads as flat. */
export const FLAT_TOLERANCE = 0.05;

export function direction(value: number | null, previous: number | null, better: Better): Direction {
  if (value === null || previous === null) return "no-baseline";
  const delta = value - previous;
  const scale = Math.max(Math.abs(previous), 1);
  if (Math.abs(delta) / scale <= FLAT_TOLERANCE) return "flat";
  const up = delta > 0;
  return (up && better === "higher") || (!up && better === "lower") ? "improving" : "worsening";
}

export function streamState(inflow: number | null, outflow: number | null): StreamState {
  if (inflow === null || outflow === null) return "no-baseline";
  if (inflow === 0 && outflow === 0) return "idle";
  return outflow >= inflow ? "closing" : "accumulating";
}

/** Share as a whole percentage, or null when the denominator is zero. */
export function percent(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

function change(now: number, before: number | undefined): number | null {
  return before === undefined ? null : now - before;
}

function sum(...parts: Array<number | null>): number | null {
  let total = 0;
  for (const part of parts) {
    if (part === null) return null;
    total += part;
  }
  return total;
}

/** The week's flows: this snapshot minus the one seven days earlier. */
export function weekFlows(now: ClosureSnapshot, before: ClosureSnapshot | null): WeekFlows {
  const b = before ?? undefined;
  const buildsCompleted = change(now.builds.complete, b?.builds.complete);
  const proposalsImplemented = change(now.proposals.implemented, b?.proposals.implemented);
  return {
    buildsStarted: change(now.builds.total, b?.builds.total),
    buildsCompleted,
    buildsEnded: sum(buildsCompleted, change(now.builds.abandoned, b?.builds.abandoned), change(now.builds.failed, b?.builds.failed)),
    signalsFiled: change(now.signals.total, b?.signals.total),
    signalsClosed: change(now.signals.closed, b?.signals.closed),
    proposalsFiled: change(now.proposals.total, b?.proposals.total),
    proposalsImplemented,
    proposalsEnded: sum(proposalsImplemented, change(now.proposals.rejected, b?.proposals.rejected)),
    backlogFiled: change(now.backlog.total, b?.backlog.total),
    backlogEnded: sum(change(now.backlog.done, b?.backlog.done), change(now.backlog.retired, b?.backlog.retired)),
    selfFiled: change(now.selfFiled.total, b?.selfFiled.total),
    selfDone: change(now.selfFiled.done, b?.selfFiled.done),
  };
}

type LineSpec = {
  key: string;
  label: string;
  better: Better;
  read: (counts: ClosureCounts, flows: WeekFlows | null) => number | null;
};

const LINE_SPECS: readonly LineSpec[] = [
  { key: "builds.completed", label: "Build Studio builds completed this week", better: "higher", read: (_c, f) => f?.buildsCompleted ?? null },
  { key: "builds.stranded", label: "Build Studio builds untouched for over 7 days", better: "lower", read: (c) => c.snapshot.builds.stranded },
  { key: "signals.closed", label: "Improvement signals closed this week", better: "higher", read: (_c, f) => f?.signalsClosed ?? null },
  { key: "signals.open", label: "Improvement signals open", better: "lower", read: (c) => c.snapshot.signals.open },
  { key: "proposals.implemented", label: "Improvement proposals implemented this week", better: "higher", read: (_c, f) => f?.proposalsImplemented ?? null },
  { key: "proposals.open", label: "Improvement proposals open", better: "lower", read: (c) => c.snapshot.proposals.open },
  { key: "asks.ownerShare", label: "Owner-attention asks classified for the owner (%)", better: "lower", read: (c) => percent(c.window.asks.forOwner, c.window.asks.forOwner + c.window.asks.routedToAgent) },
  { key: "escalations.held", label: "Owner-attention reports awaiting acknowledgement", better: "lower", read: (c) => c.snapshot.escalations.held },
  { key: "decisions.recommendedShare", label: "Decisions with a recommendation (%)", better: "higher", read: (c) => percent(c.window.decisions.recommended, c.window.decisions.total) },
  { key: "acceptance.local", label: "Awaiting acceptance, owned here", better: "lower", read: (c) => c.snapshot.acceptance.local },
  { key: "acceptance.localMedianDaysSinceChange", label: "Awaiting acceptance here, median days since last change", better: "lower", read: (c) => c.snapshot.acceptance.localMedianDaysSinceChange },
  { key: "acceptance.peerOwned", label: "Awaiting acceptance, owned by a peer install", better: "lower", read: (c) => c.snapshot.acceptance.peerOwned },
  { key: "selfFiled.done", label: "Self-filed items finished this week", better: "higher", read: (_c, f) => f?.selfDone ?? null },
];

export function computeClosureScorecard(current: ClosureCounts, prior: PriorRun | null): ClosureScorecard {
  const flows = weekFlows(current.snapshot, prior?.counts.snapshot ?? null);

  const streams: ScorecardStream[] = [
    { key: "builds", label: "Build Studio builds", inflow: flows.buildsStarted, outflow: flows.buildsEnded },
    { key: "signals", label: "Improvement signals", inflow: flows.signalsFiled, outflow: flows.signalsClosed },
    { key: "proposals", label: "Improvement proposals", inflow: flows.proposalsFiled, outflow: flows.proposalsEnded },
    { key: "backlog", label: "Backlog items", inflow: flows.backlogFiled, outflow: flows.backlogEnded },
    { key: "selfFiled", label: "Self-filed items", inflow: flows.selfFiled, outflow: flows.selfDone },
  ].map((s) => ({ ...s, state: streamState(s.inflow, s.outflow) }));

  const lines = LINE_SPECS.map((spec): ScorecardLine => {
    const value = spec.read(current, flows);
    const previous = prior ? spec.read(prior.counts, prior.flows) : null;
    return { key: spec.key, label: spec.label, value, previous, better: spec.better, direction: direction(value, previous, spec.better) };
  });

  return { flows, streams, lines, accumulating: streams.filter((s) => s.state === "accumulating").map((s) => s.label) };
}

/** One line for the schedule surface. */
export function describeClosureScorecard(card: ClosureScorecard): string {
  const n = (value: number | null) => (value === null ? "?" : String(value));
  const flows = card.streams.map((s) => `${s.label.toLowerCase()} ${n(s.inflow)} in / ${n(s.outflow)} out`).join("; ");
  const worsening = card.lines.filter((l) => l.direction === "worsening").map((l) => l.label.toLowerCase());
  const head = card.streams.every((s) => s.state === "no-baseline")
    ? "Baseline recorded; weekly flows start once a run from seven days earlier exists."
    : card.accumulating.length
      ? `Accumulating: ${card.accumulating.join(", ")}.`
      : "Every stream finished at least what it started.";
  return `${head} ${flows}.${worsening.length ? ` Worse than a week ago: ${worsening.join(", ")}.` : ""}`;
}
