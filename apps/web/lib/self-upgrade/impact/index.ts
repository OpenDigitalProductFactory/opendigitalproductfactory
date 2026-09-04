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
import { getDeployedSha } from "@/lib/self-upgrade/completion";
import { getSelfUpgradeConfig } from "@/lib/self-upgrade/config";
import { resolveTargetSha } from "@/lib/self-upgrade/version";
import { cacheKey, getCached, setCached } from "./cache";
import {
  getPersistedSummary,
  getPersistedSummaryById,
  getPersistedSummaryDigests,
  getPersistedSummaryRow,
  persistSummary,
} from "./store";
import { collectChangeSet } from "./change-set";
import { collectInstallSignals } from "./install-signals";
import { parseCommits } from "./conventional";
import { countCategories } from "./classify";
import { refineCategories } from "./refine";
import { enrichPrs } from "./pr-enrich";
import { orderByImpact, scoreCommits } from "./score";
import { phraseSummary } from "./phrase";
import {
  DEFAULT_TOP_N,
  type InstallSignals,
  type RunImpactDigest,
  type SummaryResult,
  type UpgradeImpactSummary,
} from "./types";
import { getErrorMessage } from "@/lib/shared/get-error-message";

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

const GIT_SHA_RE = /^[0-9a-f]{40}$/i;

/**
 * The upstream commit the running build contains.
 *
 * Exported because the operator-facing merge-point labels (BI-5B1FDA09) must
 * resolve the SAME "running" end this analyzer compares from — labelling the
 * banner off `deployedSha` instead would resolve a local merge commit, whose
 * subject carries no PR reference.
 */
export async function resolveCurrentLineageSha(): Promise<string | null> {
  return defaultLoadCurrentLineageSha();
}

async function defaultLoadCurrentLineageSha(): Promise<string | null> {
  const run = await getLatestSucceededRun();
  // The upstream lineage marker is the targetSha of the latest succeeded run
  // (the upstream commit absorbed into the running build) — NOT deployedSha,
  // which in merge mode is the merge-commit identity (see run-store.ts).
  if (run?.targetSha && GIT_SHA_RE.test(run.targetSha)) return run.targetSha;

  // No succeeded self-upgrade yet (a never-upgraded install). Fall back to the
  // commit THIS install was built from, so a CI-stamped ("labeled") production
  // build can still summarize everything between install and the upstream
  // target. A local/content-hash build has no git-SHA identity, so this stays
  // null and the panel honestly reports "no lineage" rather than a wall of hex.
  const deployed = await getDeployedSha();
  if (deployed && GIT_SHA_RE.test(deployed)) return deployed;
  return null;
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
  // The self-upgrade config carries the host clone path + remote/branch the git
  // reads must use. getSelfUpgradeStatus threads this into resolveTargetSha; the
  // impact summary historically did NOT, so both the target resolve and the
  // change-set `git log` ran against the wrong default path (`/workspace`) and
  // the panel could never produce output on any real install. Load it once and
  // pass it through (only when the caller hasn't injected its own loaders).
  const needsConfig = !deps.loadTargetSha || !deps.loadChangeSet;
  const config = needsConfig ? await getSelfUpgradeConfig() : null;

  const loadCurrentLineageSha = deps.loadCurrentLineageSha ?? defaultLoadCurrentLineageSha;
  const loadTargetSha =
    deps.loadTargetSha ??
    (() => resolveTargetSha("operator-impact-summary", config ?? {}));
  const loadInstallSignals = deps.loadInstallSignals ?? (() => collectInstallSignals());
  const loadChangeSet =
    deps.loadChangeSet ??
    ((input) =>
      collectChangeSet({
        ...input,
        config: { hostSourcePath: config?.hostSourceMountPath },
      }));
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
        "Could not resolve the upstream target SHA: the configured remote did not answer and the host clone has no local ref for the branch.",
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

    // L1 (in-memory) miss — check the durable store. This is what survives the
    // process restart every self-upgrade triggers: a previously-computed
    // summary is served without re-walking git log or re-calling the LLM.
    const persisted = await getPersistedSummary(currentLineageSha, targetSha).catch(
      () => null,
    );
    if (persisted) {
      const result: SummaryResult = {
        ok: true,
        summary: { ...persisted, fromCache: true },
      };
      setCached(currentLineageSha, targetSha, result);
      return result;
    }
  }

  let raw;
  try {
    raw = await loadChangeSet({ currentLineageSha, targetSha });
  } catch (err) {
    const detail = getErrorMessage(err);
    const result: SummaryResult = { ok: false, reason: "git-log-failed", detail };
    setCached(currentLineageSha, targetSha, result);
    return result;
  }

  // No commits but range was valid (e.g. fast-forward with no merge commits)
  // — still surface a usable summary with empty items.
  const parsed = parseCommits(raw);
  const signals = await loadInstallSignals();

  const prNumbers = parsed
    .map((c) => c.prNumber)
    .filter((n): n is number => typeof n === "number");
  const enrichment = await enrich(prNumbers);

  // Categories are settled only after PR enrichment — a `build(deps)` bump that
  // closes an advisory is a security change, and only the PR says so. Counts
  // MUST be taken after this pass or the headline and the badges disagree.
  const commits = refineCategories(parsed, enrichment.byPr);
  const counts = countCategories(commits);

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
  // Durably persist the computed summary so it survives refresh + the restart
  // every self-upgrade triggers. Non-fatal: a write failure must not break the
  // operator's view — L1 still serves this process and the next compute retries.
  await persistSummary(summary).catch(() => undefined);
  return result;
}

/**
 * Read-only path for the self-upgrade page server-component: return the
 * persisted summary for the CURRENT (lineage, target) WITHOUT computing
 * anything, so the panel rehydrates on page load — no click, no LLM call, no
 * git walk. Null when nothing is persisted yet (the panel falls back to its
 * "Summarize update" call-to-action). The target is passed in (the page already
 * resolved it via getSelfUpgradeStatus) so this adds no extra git read.
 */
export async function loadPersistedImpactSummary(
  targetSha: string | null,
  deps: { loadCurrentLineageSha?: () => Promise<string | null> } = {},
): Promise<SummaryResult | null> {
  if (!targetSha) return null;
  const loadLineage = deps.loadCurrentLineageSha ?? defaultLoadCurrentLineageSha;
  const currentLineageSha = await loadLineage().catch(() => null);
  if (!currentLineageSha || currentLineageSha === targetSha) return null;
  const summary = await getPersistedSummary(currentLineageSha, targetSha).catch(
    () => null,
  );
  if (!summary) return null;
  return { ok: true, summary: { ...summary, fromCache: true } };
}

/**
 * Compact impact digest for the Latest Run card — the human-readable "what did
 * this run carry?" the raw SHA pair never gave. Loaded by the run's OWN
 * `impactSummaryId` (the summary the operator reviewed at launch), not by a
 * (lineage, target) re-derivation, so it stays correct for a completed run even
 * after the upstream target has advanced past that run's endpoints.
 */
export async function loadRunImpactDigest(
  impactSummaryId: string | null | undefined,
): Promise<RunImpactDigest | null> {
  if (!impactSummaryId) return null;
  const summary = await getPersistedSummaryById(impactSummaryId).catch(() => null);
  if (!summary) return null;
  const headline = summary.phrased?.headline?.trim();
  return { counts: summary.counts, headline: headline ? headline : null };
}

/**
 * Digests for a page of runs — "what did each past upgrade carry?".
 *
 * Keyed by the run's OWN `impactSummaryId` for the same reason
 * `loadRunImpactDigest` is: a completed run must keep showing the changes IT
 * applied, and a (lineage, target) re-derivation drifts as soon as the upstream
 * target advances past that run's endpoints. One batched read for the whole
 * page, projected in Postgres, so the history table does not fan out into a
 * query per row or ship every item of every summary.
 */
export async function loadRunImpactDigests(
  impactSummaryIds: Array<string | null | undefined>,
): Promise<Map<string, RunImpactDigest>> {
  const ids = impactSummaryIds.filter((id): id is string => !!id);
  if (ids.length === 0) return new Map();
  return getPersistedSummaryDigests(ids).catch(() => new Map());
}

/**
 * The full persisted summary a given run carried — the item-level detail behind
 * a Run History row, loaded on demand when the operator expands it. Returns
 * null when the run recorded no summary (a scheduled run that never generated
 * one) or the row has since been removed.
 */
export async function loadRunImpactSummary(
  impactSummaryId: string | null | undefined,
): Promise<UpgradeImpactSummary | null> {
  if (!impactSummaryId) return null;
  return getPersistedSummaryById(impactSummaryId).catch(() => null);
}

/**
 * Resolve the persisted summary id for the CURRENT (lineage, target) so a
 * SelfUpgradeRun can be linked to the what's-new the operator reviewed before
 * launching it. Best effort: null when no summary was generated, or on any
 * resolution error — the upgrade proceeds regardless.
 */
export async function getCurrentImpactSummaryId(
  deps: SummarizeDeps = {},
): Promise<string | null> {
  try {
    const config = !deps.loadTargetSha ? await getSelfUpgradeConfig() : null;
    const loadLineage = deps.loadCurrentLineageSha ?? defaultLoadCurrentLineageSha;
    const loadTarget =
      deps.loadTargetSha ??
      (() => resolveTargetSha("operator-impact-summary", config ?? {}));
    const currentLineageSha = await loadLineage();
    const targetSha = await loadTarget();
    if (!currentLineageSha || !targetSha || currentLineageSha === targetSha) {
      return null;
    }
    const row = await getPersistedSummaryRow(currentLineageSha, targetSha);
    return row?.id ?? null;
  } catch {
    return null;
  }
}

export { cacheKey };
export * from "./types";
