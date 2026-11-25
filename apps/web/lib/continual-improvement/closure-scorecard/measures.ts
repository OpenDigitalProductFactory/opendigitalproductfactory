// Pure measures for the closure scorecard (BI-97C56E20).
//
// The question each stream answers is the same: over the window, did the
// platform finish at least as much as it started? A stream whose inflow
// exceeds its outflow is accumulating; the scorecard says so in one word and
// shows the same numbers a week earlier, so a fix is visible as a change of
// direction rather than an anecdote.
//
// Pure: no reads, no writes, no clock.

/** Counts for one window, read by the loader from live tables. */
export type ClosureCounts = {
  builds: {
    started: number;
    completed: number;
    abandoned: number;
    failed: number;
    /** Non-terminal builds untouched for more than seven days (a point-in-time stock). */
    stranded: number;
  };
  signals: { filed: number; closed: number; open: number };
  proposals: { filed: number; closedOrVerified: number; open: number };
  escalations: {
    /** Owner-attention asks the route-to-human seam sent to an agent instead. */
    routedToAgent: number;
    /** Asks that reached the owner. */
    reachedOwner: number;
    /** Asks still waiting on the owner (stock). */
    held: number;
    oldestHeldDays: number | null;
  };
  decisions: { total: number; recommended: number };
  acceptance: {
    /** Awaiting acceptance and owned by this install (stock). */
    local: number;
    /** Awaiting acceptance but owned by a peer install; only it may close them (stock). */
    peerOwned: number;
    localMedianAgeDays: number | null;
  };
  backlog: { filed: number; done: number; retired: number };
  /** Items the platform filed about itself (source automated-detection). */
  selfFiled: { filed: number; done: number };
};

export type Better = "higher" | "lower";
export type Direction = "improving" | "worsening" | "flat" | "no-baseline";
export type StreamState = "closing" | "accumulating" | "idle";

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
  inflow: number;
  outflow: number;
  state: StreamState;
};

export type ClosureScorecard = {
  streams: ScorecardStream[];
  lines: ScorecardLine[];
  /** Streams accumulating this window, named for the one-line summary. */
  accumulating: string[];
};

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

export function streamState(inflow: number, outflow: number): StreamState {
  if (inflow === 0 && outflow === 0) return "idle";
  return outflow >= inflow ? "closing" : "accumulating";
}

/** Share as a whole percentage, or null when the denominator is zero. */
export function percent(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

type LineSpec = {
  key: string;
  label: string;
  better: Better;
  read: (c: ClosureCounts) => number | null;
};

const LINE_SPECS: readonly LineSpec[] = [
  { key: "builds.completed", label: "Build Studio builds completed", better: "higher", read: (c) => c.builds.completed },
  { key: "builds.abandoned", label: "Build Studio builds abandoned or failed", better: "lower", read: (c) => c.builds.abandoned + c.builds.failed },
  { key: "builds.stranded", label: "Build Studio builds untouched for over 7 days", better: "lower", read: (c) => c.builds.stranded },
  { key: "signals.closed", label: "Improvement signals closed", better: "higher", read: (c) => c.signals.closed },
  { key: "signals.open", label: "Improvement signals open", better: "lower", read: (c) => c.signals.open },
  { key: "proposals.closed", label: "Improvement proposals implemented or verified", better: "higher", read: (c) => c.proposals.closedOrVerified },
  { key: "escalations.ownerShare", label: "Owner asks that reached the owner (%)", better: "lower", read: (c) => percent(c.escalations.reachedOwner, c.escalations.reachedOwner + c.escalations.routedToAgent) },
  { key: "escalations.held", label: "Owner asks still waiting", better: "lower", read: (c) => c.escalations.held },
  { key: "decisions.recommendedShare", label: "Decisions with a recommendation (%)", better: "higher", read: (c) => percent(c.decisions.recommended, c.decisions.total) },
  { key: "acceptance.local", label: "Awaiting acceptance, owned here", better: "lower", read: (c) => c.acceptance.local },
  { key: "acceptance.localMedianAgeDays", label: "Awaiting acceptance here, median age (days)", better: "lower", read: (c) => c.acceptance.localMedianAgeDays },
  { key: "acceptance.peerOwned", label: "Awaiting acceptance, owned by a peer install", better: "lower", read: (c) => c.acceptance.peerOwned },
  { key: "selfFiled.done", label: "Self-filed items finished", better: "higher", read: (c) => c.selfFiled.done },
];

export function computeClosureScorecard(current: ClosureCounts, previous: ClosureCounts | null): ClosureScorecard {
  const streams: ScorecardStream[] = [
    { key: "builds", label: "Build Studio builds", inflow: current.builds.started, outflow: current.builds.completed + current.builds.abandoned + current.builds.failed },
    { key: "signals", label: "Improvement signals", inflow: current.signals.filed, outflow: current.signals.closed },
    { key: "proposals", label: "Improvement proposals", inflow: current.proposals.filed, outflow: current.proposals.closedOrVerified },
    { key: "backlog", label: "Backlog items", inflow: current.backlog.filed, outflow: current.backlog.done + current.backlog.retired },
    { key: "selfFiled", label: "Self-filed items", inflow: current.selfFiled.filed, outflow: current.selfFiled.done },
  ].map((s) => ({ ...s, state: streamState(s.inflow, s.outflow) }));

  const lines = LINE_SPECS.map((spec): ScorecardLine => {
    const value = spec.read(current);
    const prior = previous ? spec.read(previous) : null;
    return { key: spec.key, label: spec.label, value, previous: prior, better: spec.better, direction: direction(value, prior, spec.better) };
  });

  return { streams, lines, accumulating: streams.filter((s) => s.state === "accumulating").map((s) => s.label) };
}

/** One line for the schedule surface. */
export function describeClosureScorecard(card: ClosureScorecard): string {
  const flows = card.streams.map((s) => `${s.label.toLowerCase()} ${s.inflow} in / ${s.outflow} out`).join("; ");
  const worsening = card.lines.filter((l) => l.direction === "worsening").map((l) => l.label.toLowerCase());
  const head = card.accumulating.length
    ? `Accumulating: ${card.accumulating.join(", ")}.`
    : "Every stream finished at least what it started.";
  return `${head} ${flows}.${worsening.length ? ` Worse than a week ago: ${worsening.join(", ")}.` : ""}`;
}
