import type { ResumePreBuildOutcome } from "./resume-pre-build-phase";

/** Tool name of the stranded-build reconciler's BuildActivity rows. */
export const RESUME_ACTIVITY_TOOL = "resumeStrandedBuildsOnBoot";

export function formatResumeOutcomeSummary(phase: string, outcome: ResumePreBuildOutcome): string {
  return `Pre-build resume (${phase}): ${outcome.kind}${
    "via" in outcome ? ` via ${outcome.via} — ${outcome.detail}` : ""
  }${"reason" in outcome ? ` — ${outcome.reason}` : ""}${
    "error" in outcome ? ` — ${outcome.error}` : ""
  }`;
}

/** Counts, waits and timestamps move every tick; the reason itself is what matters. */
function normalizeSkipSummary(summary: string): string {
  return summary
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, "<at>")
    .replace(/\b\d+h \d+m\b|\b\d+m\b/g, "<wait>")
    .replace(/\d+/g, "<n>");
}

/**
 * A skip is unchanged when the build's previous resume row recorded the same
 * reason. The resumer runs every tick; writing an identical skip each time
 * produced ~14k rows in three days without any new information.
 */
export function isUnchangedResumeSkip(previousSummary: string | null | undefined, nextSummary: string): boolean {
  if (!previousSummary) return false;
  return normalizeSkipSummary(previousSummary) === normalizeSkipSummary(nextSummary);
}

type ResumeActivityDb = {
  buildActivity: {
    findFirst(args: {
      where: { buildId: string; tool: string };
      orderBy: { createdAt: "desc" };
      select: { summary: true };
    }): Promise<{ summary: string | null } | null>;
    create(args: { data: { buildId: string; tool: string; summary: string } }): Promise<unknown>;
  };
};

/**
 * Record a pre-build resume outcome. Resumed and failed outcomes are always
 * written; a skip is written only when its reason changed since the build's
 * last resume row. Returns whether a row was written.
 */
export async function recordResumeOutcomeActivity(
  db: ResumeActivityDb,
  args: { buildId: string; phase: string; outcome: ResumePreBuildOutcome },
): Promise<boolean> {
  const { buildId, phase, outcome } = args;
  if (outcome.kind === "skipped" && outcome.quiet) return false; // BI-6F2872FC
  const summary = formatResumeOutcomeSummary(phase, outcome);
  if (outcome.kind === "skipped") {
    const previous = await db.buildActivity.findFirst({
      where: { buildId, tool: RESUME_ACTIVITY_TOOL },
      orderBy: { createdAt: "desc" },
      select: { summary: true },
    });
    if (isUnchangedResumeSkip(previous?.summary, summary)) return false;
  }
  await db.buildActivity.create({ data: { buildId, tool: RESUME_ACTIVITY_TOOL, summary } });
  return true;
}
