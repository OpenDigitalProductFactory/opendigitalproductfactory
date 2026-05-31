// apps/web/lib/self-upgrade/impact/index.ts
//
// Orchestrator for the on-demand "What's in this update?" impact summary
// (BI-C26F7EE1). Cacheable per (currentLineageSha, targetSha).
//
// Resolution order:
//   1. currentLineageSha = latest succeeded SelfUpgradeRun.targetSha
//      (the upstream marker — see run-store.ts getLatestSucceededRun).
//   2. targetSha = resolved upstream HEAD (version.ts resolveTargetSha).
//   3. If lineage is missing or already equals target -> SummaryNotApplicable.
//   4. Otherwise: collect change set -> classify -> score -> phrase -> cache.

import { getLatestSucceededRun } from "@/lib/self-upgrade/run-store";
import { resolveTargetSha } from "@/lib/self-upgrade/version";
import { cacheKey, getCached, setCached } from "./cache";
import { collectChangeSet } from "./change-set";
import { collectInstallSignals } from "./install-signals";
import { parseCommits } from "./conventional";
import { countCategories } from "./classify";
import { enrichPrs } from "./pr-enrich";
import { orderByImpact, scoreCommits } from "./score";
import { phraseSummary } from "./phrase";
import {
  DEFAULT_TOP_N,
  type InstallSignals,
  type SummaryResult,
  type UpgradeImpactSummary,
} from "./types";

export type SummarizeOptions = {
  /** Force a fresh computation, bypassing the per-process cache. */
  refresh?: boolean;
  /** Cap on items returned in the top-N list (default DEFAULT_TOP_N). */
  topN?: number;
  /** Skip LLM phrasing — useful for tests / when LLM provider is offline. */
  skipPhrasing?: boolean;
};

export type SummarizeDeps = {
  loadCurrentLineageSha?: () => Promise<string | null>;
  loadTargetSha?: () => Promise<string | null>;
  loadInstallSignals?: () => Promise<InstallSignals>;
  loadChangeSet?: (input: { currentLineageSha: string; targetSha: string }) => Promise<
    Awaited<ReturnType<typeof collectChangeSet>>
  >;
  enrichPrs?: typeof enrichPrs;
  phraseSummary?: typeof phraseSummary;
};

async function defaultLoadCurrentLineageSha(): Promise<string | null> {
  const run = await getLatestSucceededRun();
  // The upstream lineage marker is the targetSha of the latest succeeded run
  // (the upstream commit absorbed into the running build) — NOT deployedSha,
  // which in merge mode is the merge-commit identity (see run-store.ts).
  return run?.targetSha ?? null;
}

async function defaultLoadTargetSha(): Promise<string | null> {
  return resolveTargetSha("operator-impact-summary");
}

/**
 * Compute the on-demand impact summary. Returns a discriminated
 * `SummaryResult` — orchestrator never throws on missing data; instead it
 * surfaces a typed `ok: false` reason the UI can render plainly.
 */
export async function summarizeUpgradeImpact(
  options: SummarizeOptions = {},
  deps: SummarizeDeps = {},
): Promise<SummaryResult> {
  const loadCurrentLineageSha = deps.loadCurrentLineageSha ?? defaultLoadCurrentLineageSha;
  const loadTargetSha = deps.loadTargetSha ?? defaultLoadTargetSha;
  const loadInstallSignals = deps.loadInstallSignals ?? (() => collectInstallSignals());
  const loadChangeSet = deps.loadChangeSet ?? ((input) => collectChangeSet(input));
  const enrich = deps.enrichPrs ?? enrichPrs;
  const phrase = deps.phraseSummary ?? phraseSummary;

  const currentLineageSha = await loadCurrentLineageSha();
  const targetSha = await loadTargetSha();

  if (!currentLineageSha) {
    return {
      ok: false,
      reason: "no-lineage",
      detail:
        "No succeeded self-upgrade run on record, so there's no upstream lineage marker to compare against. Run a self-upgrade once to seed the marker, or apply this upgrade without a summary.",
    };
  }
  if (!targetSha) {
    return {
      ok: false,
      reason: "no-target",
      detail:
        "Could not resolve the upstream target SHA. Confirm the host clone has a fresh fetch of the configured remote/branch.",
    };
  }
  if (currentLineageSha === targetSha) {
    return {
      ok: false,
      reason: "lineage-equals-target",
      detail:
        "The running build already contains the upstream target — there is nothing to summarize. The upstream lineage marker matches the resolved target.",
    };
  }

  if (!options.refresh) {
    const cached = getCached(currentLineageSha, targetSha);
    if (cached && cached.ok) {
      return { ok: true, summary: { ...cached.summary, fromCache: true } };
    }
    if (cached && !cached.ok) return cached;
  }

  let raw;
  try {
    raw = await loadChangeSet({ currentLineageSha, targetSha });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const result: SummaryResult = { ok: false, reason: "git-log-failed", detail };
    setCached(currentLineageSha, targetSha, result);
    return result;
  }

  // No commits but range was valid (e.g. fast-forward with no merge commits)
  // — still surface a usable summary with empty items.
  const commits = parseCommits(raw);
  const counts = countCategories(commits);
  const signals = await loadInstallSignals();

  const prNumbers = commits
    .map((c) => c.prNumber)
    .filter((n): n is number => typeof n === "number");
  const enrichment = await enrich(prNumbers);

  const scored = scoreCommits({
    commits,
    signals,
    enrichmentByPr: enrichment.byPr,
  });
  const allItems = orderByImpact(scored);
  const topN = options.topN ?? DEFAULT_TOP_N;
  const topItems = allItems.slice(0, topN);

  let phrased = null;
  if (!options.skipPhrasing && topItems.length > 0) {
    phrased = await phrase(
      { items: topItems, counts, signals },
    );
  }

  const summary: UpgradeImpactSummary = {
    currentLineageSha,
    targetSha,
    counts,
    topItems,
    allItems,
    phrased,
    enrichment: {
      githubReachable: enrichment.reachable,
      prsEnriched: enrichment.enriched,
    },
    generatedAt: new Date().toISOString(),
    fromCache: false,
  };

  const result: SummaryResult = { ok: true, summary };
  setCached(currentLineageSha, targetSha, result);
  return result;
}

export { cacheKey };
export * from "./types";
