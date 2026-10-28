// BI-FEDD8F45 — the retirement ratchet's IO: build each guard's evidence over
// its window, ask the pure evaluator, and file review items.
// Design: docs/superpowers/specs/2026-10-14-guard-outcome-efficacy-design.md §4.5.
//
// Filing goes through ingestBacklogItem with an origin marker, so an open item
// is bumped rather than duplicated. A closed review restarts the guard's
// window, so closing an item as "narrowed" does not re-file it the next day.

import type { BacklogIngestInput, BacklogIngestResult } from "@/lib/operate/backlog-ingest";

import { PAIRING_PROXY_LIMITATION } from "./efficacy-measures";
import type { GuardOutcomeCount, GuardRunDay } from "./guard-outcome-store";
import {
  DEFAULT_REVIEW_WINDOW_DAYS,
  evaluateGuardRetirement,
  isoWeekKey,
  readDeclaration,
  windowStartFor,
  type GuardDeclaration,
  type GuardEvidence,
  type RetirementEvaluation,
  type RetirementFinding,
} from "./guard-retirement";

export const RETIREMENT_ORIGIN_KIND = "guard-retirement-review";
export const DIGEST_ORIGIN_KIND = "guard-retirement-digest";
/** The longest window any guard may declare that the store reads. */
export const MAX_WINDOW_DAYS = 180;

const DAY_MS = 24 * 60 * 60 * 1000;

export type ReviewItemState = { guardId: string; open: boolean; closedAt: Date | null };

/**
 * Turn day aggregates into each guard's evidence over its own window. The
 * current digest is the one seen most recently; days under an older digest do
 * not count, because the window restarts when the guard changes.
 */
export function buildGuardEvidence(input: {
  now: Date;
  runDays: readonly GuardRunDay[];
  outcomes: readonly GuardOutcomeCount[];
  declarations: Record<string, unknown>;
  reviewItems: ReadonlyMap<string, ReviewItemState>;
  medianDurations: ReadonlyMap<string, number>;
  /** The earliest record the store holds; a window before it is not covered. */
  earliestRecordAt: Date | null;
}): Array<{ evidence: GuardEvidence; declaration: GuardDeclaration; windowCovered: boolean; reviewOpen: boolean }> {
  const byGuard = new Map<string, GuardRunDay[]>();
  for (const day of input.runDays) {
    const list = byGuard.get(day.guardId) ?? [];
    list.push(day);
    byGuard.set(day.guardId, list);
  }

  return [...byGuard.entries()].map(([guardId, days]) => {
    const declaration = readDeclaration(guardId, input.declarations);
    const latest = days.reduce((a, b) => (b.day > a.day ? b : a));
    const current = days.filter((d) => d.guardDigest === latest.guardDigest);
    const digestFirstSeen = current.reduce((min, d) => (d.day < min ? d.day : min), current[0].day);
    const review = input.reviewItems.get(guardId);
    const windowStart = windowStartFor(declaration.reviewWindowDays, input.now, digestFirstSeen, review?.closedAt ?? null);
    const inWindow = current.filter((d) => d.day >= windowStart);
    const outcomes = input.outcomes.filter((o) => o.guardId === guardId && o.refusedAt >= windowStart);
    const count = (outcome: string) => outcomes.filter((o) => o.outcome === outcome).reduce((sum, o) => sum + o.count, 0);
    const fullWindowStart = new Date(input.now.getTime() - declaration.reviewWindowDays * DAY_MS);
    const windowCovered =
      windowStart.getTime() <= fullWindowStart.getTime() &&
      input.earliestRecordAt !== null &&
      input.earliestRecordAt.getTime() <= fullWindowStart.getTime() + DAY_MS;
    return {
      evidence: {
        guardId,
        currentDigestFirstSeenAt: digestFirstSeen,
        runs: inWindow.reduce((sum, d) => sum + d.runs, 0),
        refusals: inWindow.reduce((sum, d) => sum + d.refusals, 0),
        caught: count("caught"),
        falseRefusals: count("false-refusal"),
        overridden: count("overridden"),
        unresolved: count("unresolved"),
        totalDurationMs: inWindow.reduce((sum, d) => sum + d.totalDurationMs, 0),
        medianDurationMs: input.medianDurations.get(guardId) ?? 0,
      },
      declaration,
      windowCovered,
      reviewOpen: review?.open ?? false,
    };
  });
}

function describe(finding: RetirementFinding): string {
  const e = finding.evidence;
  const classified = e.caught + e.falseRefusals + e.overridden + e.unresolved;
  return [
    `Rule ${finding.rule}: ${finding.measure}, over a ${finding.windowDays}-day window.`,
    "",
    `- Runs: ${e.runs}; refusals: ${e.refusals}; classified: ${classified} (caught ${e.caught}, false refusal ${e.falseRefusals}, overridden ${e.overridden}, unresolved ${e.unresolved}).`,
    `- Cost: ${Math.round(e.totalDurationMs / 1000)} s total, median ${Math.round(e.medianDurationMs)} ms per run.`,
    `- How to read these: ${PAIRING_PROXY_LIMITATION}`,
    `- Declaration: owner ${finding.declaration.owner}; purpose ${finding.declaration.purpose}; catch class ${finding.declaration.catchClass}${finding.declaration.declared ? "" : " (undeclared: please declare it in scripts/guard-declarations.json)"}.`,
  ].join("\n");
}

const CHOICES = [
  "",
  "## Choices",
  "",
  "- Retire the guard: remove it in a PR that cites this item.",
  "- Narrow it: change what it checks so it stops refusing correct work.",
  '- Keep it: add `"keep": { "owner", "expiry", "reason", "decisionRef" }` to its entry in `scripts/guard-declarations.json`. That silences this review until the expiry.',
  "",
  "Filed by the guard retirement ratchet (BI-FEDD8F45). Nothing was disabled or deleted. Design: docs/superpowers/specs/2026-10-14-guard-outcome-efficacy-design.md §4.5.",
].join("\n");

export type FileReviewItems = (input: BacklogIngestInput) => Promise<BacklogIngestResult>;

export type RetirementFilingResult = {
  evaluation: RetirementEvaluation;
  filed: Array<{ guardId: string; itemId: string; created: boolean; rule: string }>;
  digest: { itemId: string; created: boolean; guards: number } | null;
};

export async function fileRetirementReviews(input: {
  now: Date;
  guards: ReturnType<typeof buildGuardEvidence>;
  file: FileReviewItems;
  agentId?: string;
}): Promise<RetirementFilingResult> {
  const evaluation = evaluateGuardRetirement({ now: input.now, guards: input.guards });
  const filed: RetirementFilingResult["filed"] = [];
  for (const finding of evaluation.perGuard) {
    const result = await input.file({
      title: `[Guard review] ${finding.guardId}: ${finding.measure}`.slice(0, 200),
      body: `${describe(finding)}\n${CHOICES}`,
      outcome: `\`${finding.guardId}\` is retired, narrowed so it stops refusing correct work, or kept with an owner and an expiry.`,
      workType: "chore",
      source: "automated-detection",
      type: "portfolio",
      status: "triaging",
      scopeKind: "platform",
      agentId: input.agentId ?? null,
      itemIdPrefix: "GUARD",
      origin: { kind: RETIREMENT_ORIGIN_KIND, id: finding.guardId },
    });
    filed.push({ guardId: finding.guardId, itemId: result.itemId, created: result.created, rule: finding.rule });
  }

  let digest: RetirementFilingResult["digest"] = null;
  if (evaluation.digest.length > 0) {
    const week = isoWeekKey(input.now);
    const lines = evaluation.digest.map(
      (f) => `- \`${f.guardId}\`: ${f.measure}; ${Math.round(f.evidence.totalDurationMs / 1000)} s total; owner ${f.declaration.owner}`,
    );
    const result = await input.file({
      title: `[Guard review] ${evaluation.digest.length} guard(s) never refused in their window (${week})`,
      body: [
        "A guard that never refuses is either deterring the defect it names or checking for something that no longer happens. One review decides which, for each guard below.",
        "",
        ...lines,
        CHOICES,
      ].join("\n"),
      outcome: "Each guard listed is retired, narrowed, or kept with an owner and an expiry.",
      workType: "chore",
      source: "automated-detection",
      type: "portfolio",
      status: "triaging",
      scopeKind: "platform",
      agentId: input.agentId ?? null,
      itemIdPrefix: "GUARD",
      origin: { kind: DIGEST_ORIGIN_KIND, id: week },
    });
    digest = { itemId: result.itemId, created: result.created, guards: evaluation.digest.length };
  }

  return { evaluation, filed, digest };
}

export { DEFAULT_REVIEW_WINDOW_DAYS };
