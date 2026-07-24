// apps/web/lib/coworker-record/corpus-signal-presentation.ts
// How the profession-corpus runtime tiles should READ (BI-579210DD).
//
// Deliberately its own module, importing nothing: the only consumer is a
// "use client" panel, and its sibling corpus-signals.ts imports prisma. A value
// import from there into a client component drags the whole server graph
// (prisma, fs, process.cwd) into the browser bundle and fails the production
// build — which is exactly what happened when this logic first lived there.
// Types are safe to import across that boundary because they erase; functions
// are not.
//
// Pure and dependency-free, so it is also testable without a DOM or a database.

/** Structural mirror of ProfessionCorpusSignals["totals"], kept import-free. */
export type CorpusSignalTotals = {
  injected: number;
  missed: number;
  openGaps: number;
  injectionRatePct: number | null;
};

export type CorpusSignalPresentation = {
  /** False when nothing ran — the tiles are empty, not healthy. */
  hasUsage: boolean;
  injectionsIntent: "success" | "neutral";
  missesIntent: "warning" | "neutral";
  gapsIntent: "warning" | "success" | "neutral";
  /** Banner shown only when there is no usage at all; null otherwise. */
  noUsageNotice: string | null;
  /** Copy for the empty gap table — never claims grounding that did not happen. */
  emptyGapsCopy: string;
};

/**
 * The founder-reported defect this exists to prevent: a coworker that had never
 * run rendered green and told the operator "every coworker turn has been
 * grounded in its profession corpus". That is vacuously true over an empty set
 * and indistinguishable from a corpus that genuinely works — the silent-empty
 * pattern this platform outlaws (`structural-verification-is-not-functional`,
 * applied to a signal panel). The panel's own subtitle already warned that
 * coverage is not usage.
 *
 * The rollup always knew the difference (injectionRatePct is null with no
 * usage); only the presentation collapsed it.
 */
export function presentCorpusSignals(totals: CorpusSignalTotals): CorpusSignalPresentation {
  const hasUsage = totals.injected + totals.missed > 0;
  return {
    hasUsage,
    injectionsIntent: totals.injected > 0 ? "success" : "neutral",
    missesIntent: totals.missed > 0 ? "warning" : "neutral",
    // Zero gaps only means something once turns have happened. With no usage
    // nothing has had the chance to go wrong, so this must not read as success.
    gapsIntent: totals.openGaps > 0 ? "warning" : hasUsage ? "success" : "neutral",
    noUsageNotice: hasUsage
      ? null
      : "No coworker turns recorded in the last 30 days, so there is nothing to judge this corpus by yet. The figures below are empty, not healthy — seeded coverage says the pages exist, not that they have ever been used.",
    emptyGapsCopy: hasUsage
      ? "No corpus gaps recorded yet — every coworker turn has been grounded in its profession corpus."
      : "No corpus gaps recorded — but no coworker turns happened either, so this is an absence of evidence, not evidence of health.",
  };
}
