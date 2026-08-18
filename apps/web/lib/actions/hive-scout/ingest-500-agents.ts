// apps/web/lib/actions/hive-scout/ingest-500-agents.ts
//
// Hive Scout — periodic ingestion of the MIT-licensed 500-AI-Agents-Projects
// catalog into DPF as archetype-suggestion BacklogItems.
//
// Contract:
// - Read-only scouting. No repo is forked, cloned, or vendored.
// - Re-parses the live upstream README on every run (no hardcoded catalog).
// - Idempotent: re-runs never create duplicate BacklogItems. Dedupe key is
//   a stable hash of the source URL encoded into BacklogItem.itemId.
// - Canonical backlog statuses: mapped suggestions are open; unmapped or
//   ambiguous suggestions enter triaging rather than becoming unattributed
//   deferrals.
//
// This module is the orchestrator; the cohesive pieces live alongside it:
// - catalog-readme.ts — upstream README parsing
// - gap-mapping.ts — value-stream mapping, dedupe keys, gap detection, body rendering
// - ambiguity-review.ts — bounded autonomous review (schema, cache, TAK reviewer)
// - ingest-db.ts — Prisma surface, workforce links, admin notification

import { prisma } from "@dpf/db";
import { upsertRawSource } from "@dpf/db/wiki-store";
import type { Prisma } from "@dpf/db";
import { loadPrompt } from "@/lib/tak/prompt-loader";
import {
  assertEgressAllowlist,
  classifyReviewFailure,
  evaluateReviewerHealth,
  loadReviewSettings,
  type AutoPauseTrigger,
  type ReviewRunSummary,
} from "@/lib/tak/bounded-autonomous-review";
import {
  CATALOG_LICENSE,
  CATALOG_NAME,
  CATALOG_README_URL,
  parseReadme,
  type CatalogEntry,
} from "./catalog-readme";
import {
  FALLBACK_BODY_TEMPLATE,
  PROMPT_CATEGORY,
  PROMPT_SLUG,
  isGap,
  itemIdForSource,
  mapIndustryToStream,
  rawSourceKeyForEntry,
  renderBody,
  sourceUrlHash,
  type ValueStreamMatch,
} from "./gap-mapping";
import {
  REVIEW_BATCH_LIMIT,
  REVIEW_CACHE_TTL_DAYS,
  REVIEW_SETTING_PREFIX,
  findCachedReview,
  incrementClassification,
  incrementReviewBreakdowns,
  readReviewRunSummary,
  reviewAmbiguousEntriesWithTak,
  toPublicReviewEntry,
  validateReviewDecisions,
  type AmbiguityReviewClassification,
  type AmbiguityReviewDecision,
  type AmbiguityReviewer,
  type ReviewClassificationBreakdown,
  type ReviewFailureReason,
  type ReviewSkipReason,
} from "./ambiguity-review";
import {
  notifyAdmins,
  resolveHiveScoutWorkforceLinks,
  type HiveScoutPrisma,
} from "./ingest-db";
import { runMarketSourcePass, type MarketSourcePassResult } from "./market-sources";

// Re-exported so existing importers (tests, scripts, MCP tools) keep a single
// entry point for the Hive Scout ingest API.
export { parseReadme } from "./catalog-readme";
export type { CatalogEntry, Framework } from "./catalog-readme";
export {
  itemIdForSource,
  mapIndustryToStream,
  rawSourceKeyForEntry,
  sourceUrlHash,
} from "./gap-mapping";
export type { ValueStreamMatch } from "./gap-mapping";
export type {
  AmbiguityReviewClassification,
  AmbiguityReviewDecision,
  ReviewClassificationBreakdown,
  ReviewFailureReason,
  ReviewSkipReason,
} from "./ambiguity-review";

// ─── Constants ──────────────────────────────────────────────────────────────

const BACKLOG_SOURCE = "hive-scout";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface IngestResult {
  catalogEntries: number;
  gaps: number;
  reviewed?: number;
  skippedByReview?: number;
  reviewFailed?: number;
  reviewFailureReason?: ReviewFailureReason;
  reviewSkipReason?: ReviewSkipReason;
  autoPauseTrigger?: AutoPauseTrigger | null;
  reviewBatchSize?: number;
  reviewBatchUtilization?: number;
  reviewSchemaDropCount?: number;
  reviewParseSuccessRate?: number;
  reviewClassificationHistogram?: Partial<Record<AmbiguityReviewClassification, number>>;
  reviewClassificationByFramework?: ReviewClassificationBreakdown;
  reviewClassificationByIndustry?: ReviewClassificationBreakdown;
  reviewCacheHits?: number;
  reviewCacheHitRate?: number;
  reviewLatencyMs?: number | null;
  created: number;
  duplicates: number;
  needsReview: number;
  createdItemIds?: string[];
  /** Market-aperture pass (BI-B8E4317D) — product/market sources beyond the agent catalog. */
  marketSources?: MarketSourcePassResult;
}

// ─── Main entry point ───────────────────────────────────────────────────────

export interface IngestOptions {
  /** Override the upstream URL (used in tests). */
  readmeUrl?: string;
  /** Override the fetcher (used in tests). */
  fetcher?: (url: string) => Promise<string>;
  /** Optional actor attribution when run through a coworker tool/task. */
  actorAgentId?: string;
  /** Optional parent task run id for backlog evidence provenance. */
  taskRunId?: string;
  /** Enable the default TAK-routed ambiguity reviewer for candidate gaps. */
  enableAutonomousReview?: boolean;
  /** Test/runtime seam for bounded ambiguity review. */
  ambiguityReviewer?: AmbiguityReviewer;
  /** Test seam; production uses the shared Prisma client. */
  prisma?: HiveScoutPrisma;
  /** Test seam; production uses the prompt loader. */
  loadPrompt?: typeof loadPrompt;
  /** Test seam; production uses queue notifications. */
  notifyAdmins?: (created: number, prismaClient: HiveScoutPrisma) => Promise<void>;
}

async function defaultFetcher(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": "dpf-hive-scout/1.0" } });
  if (!res.ok) {
    throw new Error(`Hive Scout: upstream fetch failed (${res.status} ${res.statusText})`);
  }
  return res.text();
}

export async function runHiveScoutIngest(
  options: IngestOptions = {},
): Promise<IngestResult> {
  const fetcher = options.fetcher ?? defaultFetcher;
  const url = options.readmeUrl ?? CATALOG_README_URL;
  const db = (options.prisma ?? prisma) as HiveScoutPrisma;
  const promptLoader = options.loadPrompt ?? loadPrompt;
  const adminNotifier = options.notifyAdmins ?? notifyAdmins;
  const workforceLinks = await resolveHiveScoutWorkforceLinks(db);

  const markdown = await fetcher(url);
  const entries = parseReadme(markdown);

  const [seededStreams, existingSkills, agentRows] = await Promise.all([
    db.eaReferenceModelElement.findMany({
      where: { kind: "value_stream" },
      select: { name: true },
    }),
    db.skillDefinition.findMany({ select: { name: true } }),
    db.agent.findMany({
      where: { archived: false },
      select: { name: true },
    }),
  ]);

  const streamNames = new Set(seededStreams.map((s: { name: string }) => s.name));
  const skillNames = existingSkills.map((s: { name: string }) => s.name);
  const coworkerNames = agentRows.map((a: { name: string }) => a.name);

  const bodyTemplate = await promptLoader(
    PROMPT_CATEGORY,
    PROMPT_SLUG,
    FALLBACK_BODY_TEMPLATE,
  );

  let gaps = 0;
  let reviewed = 0;
  let skippedByReview = 0;
  let reviewFailed = 0;
  let reviewFailureReason: ReviewFailureReason | undefined;
  let reviewSkipReason: ReviewSkipReason | undefined;
  let reviewBatchSize = 0;
  let reviewSchemaDropCount = 0;
  let reviewParseSuccessRate = 0;
  let reviewCacheHits = 0;
  let reviewLatencyMs: number | null = null;
  let autoPauseTrigger: AutoPauseTrigger | null = null;
  const reviewClassificationHistogram: Partial<Record<AmbiguityReviewClassification, number>> = {};
  const reviewClassificationByFramework: ReviewClassificationBreakdown = {};
  const reviewClassificationByIndustry: ReviewClassificationBreakdown = {};
  let created = 0;
  let duplicates = 0;
  let needsReview = 0;
  const createdItemIds: string[] = [];
  const candidates: Array<{ entry: CatalogEntry; itemId: string; match: ValueStreamMatch }> = [];

  for (const entry of entries) {
    if (!isGap(entry, skillNames, coworkerNames)) continue;
    gaps++;

    const itemId = itemIdForSource(entry.sourceUrl);
    const existing = await db.backlogItem.findUnique({ where: { itemId } });
    if (existing) {
      duplicates++;
      continue;
    }

    const match = mapIndustryToStream(entry.industry, streamNames);
    candidates.push({ entry, itemId, match });
  }

  const reviewBySource = new Map<string, AmbiguityReviewDecision>();
  const reviewer = options.ambiguityReviewer ?? (options.enableAutonomousReview ? reviewAmbiguousEntriesWithTak : null);
  if (reviewer && candidates.length > 0) {
    const reviewSettings = await loadReviewSettings({
      namespace: REVIEW_SETTING_PREFIX,
      platformConfig: db.platformConfig,
      defaults: { cacheTtlDays: REVIEW_CACHE_TTL_DAYS },
    });
    if (!reviewSettings.enabled) {
      reviewSkipReason = "operator_disabled";
    } else {
      const taskRunClient = db.taskRun as
        | { findMany: (args: unknown) => Promise<Array<{ progressPayload: unknown }>> }
        | undefined;
      const reviewHistory = taskRunClient
        ? (await taskRunClient.findMany({
            where: {
              currentAgentId: "external-catalog-scout",
              progressPayload: { not: null },
            },
            orderBy: { createdAt: "desc" },
            take: reviewSettings.healthWindowSize,
            select: { progressPayload: true },
          }))
            .map((run) => readReviewRunSummary(run.progressPayload))
            .filter((summary): summary is ReviewRunSummary => Boolean(summary))
        : [];
      const reviewerHealth = evaluateReviewerHealth({
        history: reviewHistory,
        thresholds: {
          minParseRate: reviewSettings.minParseRate,
          maxUnknownFailuresInWindow: reviewSettings.maxUnknownFailuresInWindow,
          maxSingleClassFraction: reviewSettings.maxSingleClassFraction,
          healthWindowSize: reviewSettings.healthWindowSize,
        },
      });
      if (reviewerHealth.state === "auto_paused") {
        reviewSkipReason = "auto_paused";
        autoPauseTrigger = reviewerHealth.trigger;
      }
    }

    if (!reviewSkipReason) {
      for (const candidate of candidates) {
        const cachedReview = await findCachedReview(db, candidate.entry.sourceUrl, reviewSettings.cacheTtlDays);
        if (cachedReview) {
          reviewBySource.set(candidate.entry.sourceUrl, cachedReview);
          incrementClassification(reviewClassificationHistogram, cachedReview.classification);
          incrementReviewBreakdowns(
            candidate.entry,
            cachedReview.classification,
            reviewClassificationByFramework,
            reviewClassificationByIndustry,
          );
          reviewCacheHits++;
        }
      }

      const reviewCandidates = candidates
        .filter((candidate) => !reviewBySource.has(candidate.entry.sourceUrl))
        .slice(0, REVIEW_BATCH_LIMIT);
      reviewBatchSize = reviewCandidates.length;
      const startedAt = Date.now();

      if (reviewCandidates.length === 0) {
        reviewParseSuccessRate = 1;
      } else {
        try {
          const reviewedSourceUrls = new Set(reviewCandidates.map((candidate) => candidate.entry.sourceUrl));
          const reviewInput = {
            entries: reviewCandidates.map((candidate) => toPublicReviewEntry(candidate.entry)),
            existingSkillNames: skillNames,
            existingCoworkerNames: coworkerNames,
            valueStreamNames: [...streamNames],
          };
          assertEgressAllowlist(reviewInput, [
            "entries",
            "existingSkillNames",
            "existingCoworkerNames",
            "valueStreamNames",
          ]);
          const rawDecisions = await reviewer(reviewInput);
          reviewLatencyMs = Date.now() - startedAt;
          const { decisions, dropped } = validateReviewDecisions(rawDecisions);
          const acceptedDecisions = decisions.filter((decision) => reviewedSourceUrls.has(decision.sourceUrl));
          reviewSchemaDropCount = dropped + (decisions.length - acceptedDecisions.length);
          const reviewCandidateBySource = new Map(
            reviewCandidates.map((candidate) => [candidate.entry.sourceUrl, candidate]),
          );
          for (const decision of acceptedDecisions) {
            reviewBySource.set(decision.sourceUrl, decision);
            incrementClassification(reviewClassificationHistogram, decision.classification);
            const candidate = reviewCandidateBySource.get(decision.sourceUrl);
            if (candidate) {
              incrementReviewBreakdowns(
                candidate.entry,
                decision.classification,
                reviewClassificationByFramework,
                reviewClassificationByIndustry,
              );
            }
          }
          reviewParseSuccessRate = reviewBatchSize > 0 ? acceptedDecisions.length / reviewBatchSize : 1;
        } catch (error) {
          reviewLatencyMs = Date.now() - startedAt;
          reviewFailed = reviewCandidates.length;
          reviewFailureReason = classifyReviewFailure(error);
        }
      }
    }
    reviewed = reviewBySource.size;
  } else if (reviewer && candidates.length === 0) {
    reviewSkipReason = "no_candidates";
    reviewParseSuccessRate = 1;
  }

  const reviewBatchUtilization = reviewBatchSize / REVIEW_BATCH_LIMIT;
  const reviewCacheHitRate = candidates.length > 0 ? reviewCacheHits / candidates.length : 0;

  for (const candidate of candidates) {
    const { entry, itemId } = candidate;
    const review = reviewBySource.get(entry.sourceUrl) ?? null;
    if (review?.classification === "duplicate_pattern" || review?.classification === "out_of_scope") {
      skippedByReview++;
      continue;
    }

    const match = applyReviewToMatch(candidate.match, review);
    const status = match.confidence === "mapped" ? "open" : "triaging";
    const reviewRequiresHuman = review?.classification === "needs_human_review";
    const finalStatus = reviewRequiresHuman ? "triaging" : status;
    if (finalStatus === "triaging") needsReview++;

    // Upsert a citable RawSource for the catalog entry. Idempotent on
    // sourceKey — repeat runs do not create duplicate rows. organizationId
    // is null because the 500-AI-Agents-Projects catalog is platform-shared
    // (every install reads the same upstream README); WikiPage rows that
    // cite this source in Slice 3 will be org-scoped per
    // commitIngestProposal's contract.
    const rawSource = await upsertRawSource(db, {
      sourceKey: rawSourceKeyForEntry(entry),
      sourceType: "external-url",
      title: entry.name,
      url: entry.sourceUrl,
      license: CATALOG_LICENSE,
      retrievedAt: new Date(),
      organizationId: null,
      isKernel: false,
    });
    const rawSourceId = (rawSource as { id: string }).id;

    const createdItem = await db.backlogItem.create({
      data: {
        itemId,
        title: `Coworker archetype: ${entry.name} (${entry.industry})`,
        type: "portfolio",
        status: finalStatus,
        body: renderBody(bodyTemplate, entry, match),
        source: BACKLOG_SOURCE,
        digitalProductId: workforceLinks.digitalProductId,
        taxonomyNodeId: workforceLinks.taxonomyNodeId,
      },
    });
    createdItemIds.push(itemId);
    await db.backlogItemActivity.create({
      data: {
        backlogItemId: createdItem.id,
        kind: "evidence",
        summary: `Hive Scout identified external catalog gap: ${entry.name}`,
        payload: {
          taskRunId: options.taskRunId ?? null,
          catalog: CATALOG_NAME,
          catalogLicense: CATALOG_LICENSE,
          sourceUrl: entry.sourceUrl,
          sourceUrlHash: sourceUrlHash(entry.sourceUrl),
          framework: entry.framework ?? null,
          valueStream: match.stream,
          valueStreamConfidence: match.confidence,
          ambiguityReview: review,
          rawSourceId,
        } as Prisma.InputJsonValue,
        recordedByAgentId: options.actorAgentId ?? null,
      },
    });
    created++;
  }

  await adminNotifier(created, db);

  // Market-aperture pass runs after the catalog pass so a market-source
  // failure can never mask a catalog regression; per-source errors are
  // captured inside the pass, never thrown.
  const marketSources = await runMarketSourcePass({ db, fetcher });

  return {
    catalogEntries: entries.length,
    gaps,
    reviewed,
    skippedByReview,
    reviewFailed,
    ...(reviewFailureReason ? { reviewFailureReason } : {}),
    ...(reviewSkipReason ? { reviewSkipReason } : {}),
    autoPauseTrigger,
    reviewBatchSize,
    reviewBatchUtilization,
    reviewSchemaDropCount,
    reviewParseSuccessRate,
    reviewClassificationHistogram,
    reviewClassificationByFramework,
    reviewClassificationByIndustry,
    reviewCacheHits,
    reviewCacheHitRate,
    reviewLatencyMs,
    created,
    duplicates,
    needsReview,
    createdItemIds,
    marketSources,
  };
}

function applyReviewToMatch(
  match: ValueStreamMatch,
  _review: AmbiguityReviewDecision | null,
): ValueStreamMatch {
  return match;
}
