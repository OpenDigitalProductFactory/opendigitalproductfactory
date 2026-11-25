// Pure measures for the closure scorecard (BI-97C56E20).
//
// The question each stream answers: is the pile of unfinished work in it
// growing or shrinking? Each run snapshots how many records sit in each state,
// read from indexed status columns, and compares with the snapshot recorded
// seven days earlier. What that comparison yields is the NET CHANGE IN STOCK
// per state. It is not a count of events: a record created and finished in
// the same week leaves no trace, and a deleted record lowers a stock without
// anything having finished. The scorecard therefore labels these numbers as
// net change, never as started/ended, and a week in which a stream's total
// stock fell (rows were deleted or retired out of the table) is
// "indeterminate": its open-stock change is not attributed to closure.
// Most of these tables carry no state-transition timestamp (a signal or
// proposal has only `updatedAt`, which any later edit moves), which is why
// state snapshots, not timestamps, are the honest basis.
//
// The two streams that are naturally events (owner-attention asks, decisions)
// are counted in the window by an indexed `createdAt`.
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
   * Distinct owner-attention asks raised in the window (one per ask identity),
   * each classified once: for the owner when any of its reports carried the
   * owner self-fix class, otherwise routed to an agent. A classification, not
   * proof the owner was notified.
   */
  asks: { forOwner: number; routedToAgent: number };
  decisions: { total: number; recommended: number };
};

export type ClosureCounts = { snapshot: ClosureSnapshot; window: ClosureWindowFlows };

/** Net change in stock between two snapshots; null without a baseline. */
export type StockChanges = {
  buildsOpen: number | null;
  buildsComplete: number | null;
  buildsTotal: number | null;
  signalsOpen: number | null;
  signalsClosed: number | null;
  signalsTotal: number | null;
  proposalsOpen: number | null;
  proposalsImplemented: number | null;
  proposalsTotal: number | null;
  backlogOpen: number | null;
  backlogTotal: number | null;
  selfFiledOpen: number | null;
  selfFiledDone: number | null;
  selfFiledTotal: number | null;
};

export type Better = "higher" | "lower";
export type Direction = "improving" | "worsening" | "flat" | "no-baseline";
/**
 * accumulating / reducing / steady: the open stock grew, fell or held.
 * indeterminate: the stream's total stock fell, so rows left the table and the
 * open-stock change cannot be read as work finishing.
 */
export type StreamState = "accumulating" | "reducing" | "steady" | "indeterminate" | "no-baseline";

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
  /** Open (unfinished) records now. */
  openNow: number;
  /** Net change in the open stock since the baseline snapshot. */
  netOpenChange: number | null;
  /** Net change in the stream's total stock; negative means rows left the table. */
  netTotalChange: number | null;
  state: StreamState;
};

export type ClosureScorecard = {
  changes: StockChanges;
  streams: ScorecardStream[];
  lines: ScorecardLine[];
  /** Streams whose open stock grew this week, named for the one-line summary. */
  accumulating: string[];
};

/** What the run recorded seven days earlier. */
export type PriorRun = { counts: ClosureCounts; changes: StockChanges | null };

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

/** The verdict for a stream. A shrinking total never drives it: that is deletion, not closure. */
export function streamState(netOpenChange: number | null, netTotalChange: number | null): StreamState {
  if (netOpenChange === null || netTotalChange === null) return "no-baseline";
  if (netTotalChange < 0) return "indeterminate";
  if (netOpenChange > 0) return "accumulating";
  if (netOpenChange < 0) return "reducing";
  return "steady";
}

/** Share as a whole percentage, or null when the denominator is zero. */
export function percent(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

const openBuilds = (s: ClosureSnapshot) => s.builds.total - s.builds.complete - s.builds.abandoned - s.builds.failed;
const openBacklog = (s: ClosureSnapshot) => s.backlog.total - s.backlog.done - s.backlog.retired;
const openSelfFiled = (s: ClosureSnapshot) => s.selfFiled.total - s.selfFiled.done;

function change(now: number, before: number | undefined): number | null {
  return before === undefined ? null : now - before;
}

/** Net change in each stock: this snapshot minus the one seven days earlier. */
export function stockChanges(now: ClosureSnapshot, before: ClosureSnapshot | null): StockChanges {
  const b = before ?? undefined;
  return {
    buildsOpen: change(openBuilds(now), b && openBuilds(b)),
    buildsComplete: change(now.builds.complete, b?.builds.complete),
    buildsTotal: change(now.builds.total, b?.builds.total),
    signalsOpen: change(now.signals.open, b?.signals.open),
    signalsClosed: change(now.signals.closed, b?.signals.closed),
    signalsTotal: change(now.signals.total, b?.signals.total),
    proposalsOpen: change(now.proposals.open, b?.proposals.open),
    proposalsImplemented: change(now.proposals.implemented, b?.proposals.implemented),
    proposalsTotal: change(now.proposals.total, b?.proposals.total),
    backlogOpen: change(openBacklog(now), b && openBacklog(b)),
    backlogTotal: change(now.backlog.total, b?.backlog.total),
    selfFiledOpen: change(openSelfFiled(now), b && openSelfFiled(b)),
    selfFiledDone: change(now.selfFiled.done, b?.selfFiled.done),
    selfFiledTotal: change(now.selfFiled.total, b?.selfFiled.total),
  };
}

type LineSpec = {
  key: string;
  label: string;
  better: Better;
  read: (counts: ClosureCounts, changes: StockChanges | null) => number | null;
};

const LINE_SPECS: readonly LineSpec[] = [
  { key: "builds.completeNetChange", label: "Build Studio builds complete, net change in stock this week", better: "higher", read: (_c, d) => d?.buildsComplete ?? null },
  { key: "builds.stranded", label: "Build Studio builds untouched for over 7 days", better: "lower", read: (c) => c.snapshot.builds.stranded },
  { key: "signals.closedNetChange", label: "Improvement signals closed, net change in stock this week", better: "higher", read: (_c, d) => d?.signalsClosed ?? null },
  { key: "signals.open", label: "Improvement signals open", better: "lower", read: (c) => c.snapshot.signals.open },
  { key: "proposals.implementedNetChange", label: "Improvement proposals implemented, net change in stock this week", better: "higher", read: (_c, d) => d?.proposalsImplemented ?? null },
  { key: "proposals.open", label: "Improvement proposals open", better: "lower", read: (c) => c.snapshot.proposals.open },
  { key: "asks.ownerShare", label: "Owner-attention asks classified for the owner (%)", better: "lower", read: (c) => percent(c.window.asks.forOwner, c.window.asks.forOwner + c.window.asks.routedToAgent) },
  { key: "escalations.held", label: "Owner-attention reports awaiting acknowledgement", better: "lower", read: (c) => c.snapshot.escalations.held },
  { key: "decisions.recommendedShare", label: "Decisions with a recommendation (%)", better: "higher", read: (c) => percent(c.window.decisions.recommended, c.window.decisions.total) },
  { key: "acceptance.local", label: "Awaiting acceptance, owned here", better: "lower", read: (c) => c.snapshot.acceptance.local },
  { key: "acceptance.localMedianDaysSinceChange", label: "Awaiting acceptance here, median days since last change", better: "lower", read: (c) => c.snapshot.acceptance.localMedianDaysSinceChange },
  { key: "acceptance.peerOwned", label: "Awaiting acceptance, owned by a peer install", better: "lower", read: (c) => c.snapshot.acceptance.peerOwned },
  { key: "selfFiled.doneNetChange", label: "Self-filed items done, net change in stock this week", better: "higher", read: (_c, d) => d?.selfFiledDone ?? null },
];

export function computeClosureScorecard(current: ClosureCounts, prior: PriorRun | null): ClosureScorecard {
  const now = current.snapshot;
  const changes = stockChanges(now, prior?.counts.snapshot ?? null);
  const stream = (key: string, label: string, openNow: number, netOpenChange: number | null, netTotalChange: number | null): ScorecardStream =>
    ({ key, label, openNow, netOpenChange, netTotalChange, state: streamState(netOpenChange, netTotalChange) });

  const streams: ScorecardStream[] = [
    stream("builds", "Build Studio builds", openBuilds(now), changes.buildsOpen, changes.buildsTotal),
    stream("signals", "Improvement signals", now.signals.open, changes.signalsOpen, changes.signalsTotal),
    stream("proposals", "Improvement proposals", now.proposals.open, changes.proposalsOpen, changes.proposalsTotal),
    stream("backlog", "Backlog items", openBacklog(now), changes.backlogOpen, changes.backlogTotal),
    stream("selfFiled", "Self-filed items", openSelfFiled(now), changes.selfFiledOpen, changes.selfFiledTotal),
  ];

  const lines = LINE_SPECS.map((spec): ScorecardLine => {
    const value = spec.read(current, changes);
    const previous = prior ? spec.read(prior.counts, prior.changes) : null;
    return { key: spec.key, label: spec.label, value, previous, better: spec.better, direction: direction(value, previous, spec.better) };
  });

  return { changes, streams, lines, accumulating: streams.filter((s) => s.state === "accumulating").map((s) => s.label) };
}

/** One line for the schedule surface. */
export function describeClosureScorecard(card: ClosureScorecard): string {
  const signed = (n: number | null) => (n === null ? "?" : n > 0 ? `+${n}` : String(n));
  const stocks = card.streams.map((s) => `${s.label.toLowerCase()} ${s.openNow} open (${signed(s.netOpenChange)}, ${s.state})`).join("; ");
  const worsening = card.lines.filter((l) => l.direction === "worsening").map((l) => l.label.toLowerCase());
  const head = card.streams.every((s) => s.state === "no-baseline")
    ? "Baseline recorded; net changes start once a run from seven days earlier exists."
    : card.accumulating.length
      ? `Open stock grew: ${card.accumulating.join(", ")}.`
      : "No stream's open stock grew.";
  return `${head} ${stocks}.${worsening.length ? ` Worse than a week ago: ${worsening.join(", ")}.` : ""}`;
}
