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
// - Canonical enums (see CLAUDE.md): type "portfolio", status "open"|"deferred".

import { createHash } from "crypto";
import { prisma } from "@dpf/db";
import { upsertRawSource } from "@dpf/db/wiki-store";
import type { Prisma, PrismaClient } from "@dpf/db";
import { z } from "zod";
import { loadPrompt } from "@/lib/tak/prompt-loader";
import { sendQueueNotification } from "@/lib/queue/notification-adapter";
import {
  assertEgressAllowlist,
  classifyReviewFailure,
  evaluateReviewerHealth,
  loadReviewSettings,
  validateAutonomousReviewDecisions,
  type AutoPauseTrigger,
  type ReviewFailureReason as BoundedReviewFailureReason,
  type ReviewRunSummary,
  type ReviewSkipReason as BoundedReviewSkipReason,
} from "@/lib/tak/bounded-autonomous-review";

// ─── Constants ──────────────────────────────────────────────────────────────

const CATALOG_NAME = "500-AI-Agents-Projects";
const CATALOG_LICENSE = "MIT";
const CATALOG_README_URL =
  "https://raw.githubusercontent.com/ashishpatel26/500-AI-Agents-Projects/main/README.md";
const BACKLOG_SOURCE = "hive-scout";
const ITEM_ID_PREFIX = "HS";
// Backlog-item body template (not a coworker persona). Lives under
// prompts/templates/ to keep prompts/specialist/ scoped to actual specialists.
const PROMPT_CATEGORY = "templates";
const PROMPT_SLUG = "hive-scout-archetype-gap";
const REVIEWER_PROMPT_CATEGORY = "specialist";
const REVIEWER_PROMPT_SLUG = "hive-scout-ambiguity-reviewer";
const DEEP_LINK = "/portfolio/backlog?source=hive-scout";
const REVIEW_BATCH_LIMIT = 12;
const REVIEW_CACHE_TTL_DAYS = 30;
const REVIEW_SETTING_PREFIX = "hive-scout.review";

// A starter mapping from catalog-industry labels to IT4IT value-stream names
// as seeded into `EaReferenceModelElement` (kind="value_stream"). Entries are
// only included when the industry clearly aligns with an IT4IT stream. Any
// industry not found here is filed as status="deferred" with
// VALUE_STREAM_CONFIDENCE="needs-mapping" so a human completes the mapping
// before the item is prioritised — per the spec's ambiguity rule.
const INDUSTRY_TO_VALUE_STREAM: Record<string, string> = {
  "devops": "Operate",
  "it operations": "Operate",
  "sre": "Operate",
  "site reliability": "Operate",
  "cybersecurity": "Operate",
  "security": "Operate",
  "monitoring": "Operate",
  "observability": "Operate",
  "developer tools": "Integrate",
  "development": "Integrate",
  "software engineering": "Integrate",
  "coding": "Integrate",
  "data engineering": "Integrate",
  "qa": "Integrate",
  "testing": "Integrate",
  "research": "Evaluate",
  "portfolio": "Evaluate",
  "strategy": "Evaluate",
  "product management": "Evaluate",
  "product": "Evaluate",
  "discovery": "Explore",
  "ideation": "Explore",
  "ai integration": "Explore",
  "knowledge management": "Explore",
  "deployment": "Deploy",
  "infrastructure": "Deploy",
  "release management": "Release",
  "devrel": "Release",
  "documentation": "Release",
  "customer service": "Consume",
  "customer support": "Consume",
  "support": "Consume",
  "marketing": "Consume",
  "sales": "Consume",
  "e-commerce": "Consume",
  "retail": "Consume",
};

// ─── Types ──────────────────────────────────────────────────────────────────

export type Framework = "crewai" | "autogen" | "agno" | "langgraph";

export interface CatalogEntry {
  name: string;
  industry: string;
  description: string;
  sourceUrl: string;
  framework?: Framework;
}

export interface ValueStreamMatch {
  stream: string | null;
  confidence: "mapped" | "needs-mapping";
}

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
  reviewCacheHits?: number;
  reviewCacheHitRate?: number;
  reviewLatencyMs?: number | null;
  created: number;
  duplicates: number;
  deferred: number;
  createdItemIds?: string[];
}

export type AmbiguityReviewClassification =
  | "new_archetype"
  | "existing_skill_gap"
  | "duplicate_pattern"
  | "out_of_scope"
  | "needs_human_review";

export type AmbiguityReviewDecision = {
  sourceUrl: string;
  classification: AmbiguityReviewClassification;
  novelty: "high" | "medium" | "low";
  valueStream: string | null;
  valueStreamConfidence: "high" | "medium" | "low";
  rationale: string;
};

export type ReviewFailureReason = BoundedReviewFailureReason;

export type ReviewSkipReason = BoundedReviewSkipReason;

type PublicReviewEntry = Pick<CatalogEntry, "name" | "industry" | "description" | "sourceUrl">;

type AmbiguityReviewInput = {
  entries: PublicReviewEntry[];
  existingSkillNames: string[];
  existingCoworkerNames: string[];
  valueStreamNames: string[];
};

type AmbiguityReviewer = (input: AmbiguityReviewInput) => Promise<unknown[]>;

type HiveScoutPrisma = Pick<
  PrismaClient,
  | "eaReferenceModelElement"
  | "skillDefinition"
  | "agent"
  | "backlogItem"
  | "backlogItemActivity"
  | "user"
  | "platformConfig"
  | "rawSource"
> & {
  taskRun?: unknown;
};

const AmbiguityReviewDecisionSchema = z.object({
  sourceUrl: z.string().url(),
  classification: z.enum([
    "new_archetype",
    "existing_skill_gap",
    "duplicate_pattern",
    "out_of_scope",
    "needs_human_review",
  ]),
  novelty: z.enum(["high", "medium", "low"]),
  valueStream: z.string().nullable(),
  valueStreamConfidence: z.enum(["high", "medium", "low"]),
  rationale: z.string().min(1),
});

// ─── Parsing ────────────────────────────────────────────────────────────────

/**
 * Strip leading emoji / punctuation / markdown-bold wrappers from a table cell.
 * The upstream README prefixes many cells with emoji (e.g. "🗣️ Communication").
 */
function cleanCell(raw: string): string {
  return raw
    .trim()
    .replace(/^\*\*|\*\*$/g, "")
    .replace(/^\*|\*$/g, "")
    .replace(/^[^\w(]+/, "") // drop leading emoji / symbol runs
    .trim();
}

/**
 * Extract the first http(s) URL from a cell (cells contain badge images
 * followed by the real link in markdown: [![badge](img)](URL)).
 */
function firstUrl(cell: string): string | null {
  // Look for the closing paren of the outer link: `](URL)` at end of cell
  const matches = cell.match(/\(https?:\/\/[^\s)]+\)/g);
  if (!matches || matches.length === 0) return null;
  // The last match is the outer link's target (innermost is the badge image)
  const last = matches[matches.length - 1];
  return last.slice(1, -1);
}

/**
 * Parse a single markdown table into rows of 4 string cells.
 * Returns rows in the order they appear; skips header and separator.
 */
function parseMarkdownTable(block: string): string[][] {
  const lines = block.split("\n").filter((l) => l.trim().startsWith("|"));
  if (lines.length < 3) return []; // need header + separator + at least one row

  const rows: string[][] = [];
  for (let i = 2; i < lines.length; i++) {
    const line = lines[i];
    // Separator rows look like "| --- | --- | ... |" — skip just in case they
    // appear mid-table (rare but possible)
    if (/^\|\s*-+\s*\|/.test(line)) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length >= 4) rows.push(cells);
  }
  return rows;
}

/**
 * Extract a contiguous block of markdown-table lines starting at `startIdx`.
 * Returns the block as a single string and the index after the block ends.
 */
function extractTable(lines: string[], startIdx: number): { block: string; next: number } {
  let i = startIdx;
  const blockLines: string[] = [];
  while (i < lines.length && lines[i].trim().startsWith("|")) {
    blockLines.push(lines[i]);
    i++;
  }
  return { block: blockLines.join("\n"), next: i };
}

/**
 * Parse the upstream README markdown into catalog entries.
 * Recognises the main "Use Case Table" and each framework sub-table.
 *
 * Throws if no entries are found — upstream format drift should fail loud
 * rather than silently return empty results.
 */
export function parseReadme(markdown: string): CatalogEntry[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const entries: CatalogEntry[] = [];
  let currentFramework: Framework | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track framework section headings like:
    //   ### **Framework Name**: **CrewAI**
    const fwMatch = line.match(/Framework Name[^*]*\*\*:\s*\*\*([A-Za-z]+)/);
    if (fwMatch) {
      const raw = fwMatch[1].toLowerCase();
      if (raw === "crewai") currentFramework = "crewai";
      else if (raw === "autogen") currentFramework = "autogen";
      else if (raw === "agno") currentFramework = "agno";
      else if (raw === "langgraph") currentFramework = "langgraph";
      else currentFramework = undefined;
      continue;
    }

    // When we hit a table row, slurp the whole contiguous block
    if (line.trim().startsWith("|") && lines[i + 1]?.trim().startsWith("|")) {
      const { block, next } = extractTable(lines, i);
      for (const row of parseMarkdownTable(block)) {
        const [nameCell, industryCell, descCell, linkCell] = row;
        const url = firstUrl(linkCell);
        if (!url) continue;
        const name = cleanCell(nameCell);
        const industry = cleanCell(industryCell);
        const description = cleanCell(descCell);
        if (!name || !industry || !description) continue;

        entries.push({
          name,
          industry,
          description,
          sourceUrl: url,
          ...(currentFramework ? { framework: currentFramework } : {}),
        });
      }
      i = next - 1;
    }
  }

  if (entries.length === 0) {
    throw new Error(
      "Hive Scout parser produced zero catalog entries — upstream README format may have changed. " +
        "Refusing to write partial results.",
    );
  }

  return entries;
}

// ─── Value-stream mapping ───────────────────────────────────────────────────

/**
 * Map a catalog-industry label to a seeded IT4IT value-stream name.
 * Returns `confidence: "mapped"` when a starter-mapping entry exists AND the
 * stream is present in the seeded `EaReferenceModelElement` catalog.
 * Otherwise `confidence: "needs-mapping"`, which forces the BacklogItem into
 * the `deferred` status for human review.
 */
export function mapIndustryToStream(
  industry: string,
  seededStreamNames: Set<string>,
): ValueStreamMatch {
  const candidate = INDUSTRY_TO_VALUE_STREAM[industry.trim().toLowerCase()];
  if (!candidate) return { stream: null, confidence: "needs-mapping" };
  if (!seededStreamNames.has(candidate)) {
    // Mapping exists in code but the stream isn't in the DB yet — treat as
    // needs-mapping rather than silently linking to a nonexistent stream.
    return { stream: null, confidence: "needs-mapping" };
  }
  return { stream: candidate, confidence: "mapped" };
}

// ─── Dedupe / idempotency ───────────────────────────────────────────────────

/**
 * Deterministic BacklogItem.itemId derived from the source URL.
 * 16 hex chars of SHA-256 keeps collisions astronomically unlikely across the
 * ~500 entries while staying short enough to read in the UI.
 */
export function itemIdForSource(sourceUrl: string): string {
  const digest = sourceUrlHash(sourceUrl).slice(0, 16);
  return `${ITEM_ID_PREFIX}-${digest.toUpperCase()}`;
}

export function sourceUrlHash(sourceUrl: string): string {
  return createHash("sha256").update(sourceUrl).digest("hex");
}

const RAW_SOURCE_KEY_PREFIX = "hive-scout:500-ai-agents";

/**
 * Stable, human-readable key for `RawSource.sourceKey`. Idempotency depends
 * on this returning the same string for the same source URL across runs.
 *
 * Shape: `hive-scout:500-ai-agents:<canonical-slug>` where the slug is
 * derived from the URL host + path with non-alphanumerics collapsed to
 * single dashes. Scheme, userinfo, port, query, and fragment are stripped
 * so cosmetic URL variations do not split a single logical source into
 * two RawSource rows.
 */
export function rawSourceKeyForEntry(entry: Pick<CatalogEntry, "sourceUrl">): string {
  return `${RAW_SOURCE_KEY_PREFIX}:${canonicalSlugForUrl(entry.sourceUrl)}`;
}

function canonicalSlugForUrl(rawUrl: string): string {
  let canonical: string;
  try {
    const parsed = new URL(rawUrl.trim());
    // host (no userinfo, no port) + pathname only; query + fragment dropped.
    canonical = `${parsed.hostname}${parsed.pathname}`;
  } catch {
    // Lenient fallback for malformed URLs — preserves a key rather than
    // throwing mid-ingest. Strip scheme + userinfo + port + query/fragment.
    canonical = rawUrl
      .trim()
      .replace(/^[a-z]+:\/\//i, "")
      .replace(/^[^/@]*@/, "")
      .replace(/:\d+/, "")
      .split(/[?#]/)[0];
  }
  return canonical
    .toLowerCase()
    .replace(/\.git$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ─── Gap detection ──────────────────────────────────────────────────────────

function normaliseForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Returns true when no existing skill or coworker archetype plausibly covers
 * the catalog entry. Matching is deliberately conservative — we'd rather file
 * a duplicate-looking suggestion than silently discard a real gap; humans
 * can reject it in one click.
 */
function isGap(
  entry: CatalogEntry,
  existingSkillNames: string[],
  existingCoworkerNames: string[],
): boolean {
  const needle = normaliseForMatch(entry.name);
  if (!needle) return false;

  const tokens = needle.split(" ").filter((t) => t.length >= 4);
  if (tokens.length === 0) return true;

  const haystacks = [...existingSkillNames, ...existingCoworkerNames].map(normaliseForMatch);

  // A skill/coworker "covers" the entry if any single long token from the
  // entry name appears verbatim in its name. This is coarse but prevents the
  // trivial "Trading Bot"/"Trading" collisions while letting genuinely new
  // archetypes through.
  return !haystacks.some((h) => tokens.some((t) => h.includes(t)));
}

// ─── Description rendering ──────────────────────────────────────────────────

const FALLBACK_BODY_TEMPLATE = `**Use case:** {{NAME}}

**Industry (as labelled upstream):** {{INDUSTRY}}

**Upstream description:** {{DESCRIPTION}}

**Source:** {{SOURCE_URL}}
**Catalog:** {{CATALOG_NAME}} ({{CATALOG_LICENSE}})
**Framework (if any):** {{FRAMEWORK}}

**Candidate IT4IT value stream:** {{VALUE_STREAM}} ({{VALUE_STREAM_CONFIDENCE}})

---

Reference only — not vendored. The linked repository is MIT-licensed
inspiration for a DPF-native archetype; we do not import its code.`;

const FALLBACK_REVIEWER_PROMPT = [
  "You are the Hive Scout ambiguity reviewer.",
  "Return ONLY a JSON array. One decision per entry.",
  "Each decision must contain sourceUrl, classification, novelty, valueStream, valueStreamConfidence, and rationale.",
  "classification must be one of: new_archetype, existing_skill_gap, duplicate_pattern, out_of_scope, needs_human_review.",
  "Judge novelty, archetype clustering, value-stream fit, and whether the idea is actually new for DPF.",
  "Keep deterministic mechanics outside this review: do not fetch, parse, dedupe, or write backlog items.",
].join(" ");

function renderBody(
  template: string,
  entry: CatalogEntry,
  match: ValueStreamMatch,
): string {
  const substitutions: Record<string, string> = {
    NAME: entry.name,
    INDUSTRY: entry.industry,
    DESCRIPTION: entry.description,
    SOURCE_URL: entry.sourceUrl,
    VALUE_STREAM: match.stream ?? "(none)",
    VALUE_STREAM_CONFIDENCE: match.confidence,
    FRAMEWORK: entry.framework ?? "(none)",
    CATALOG_NAME,
    CATALOG_LICENSE,
  };
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
    substitutions[key] ?? `{{${key}}}`,
  );
}

function toPublicReviewEntry(entry: CatalogEntry): PublicReviewEntry {
  return {
    name: entry.name,
    industry: entry.industry,
    description: entry.description,
    sourceUrl: entry.sourceUrl,
  };
}

function incrementClassification(
  histogram: Partial<Record<AmbiguityReviewClassification, number>>,
  classification: AmbiguityReviewClassification,
): void {
  histogram[classification] = (histogram[classification] ?? 0) + 1;
}

function readPayloadRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readReviewRunSummary(progressPayload: unknown): ReviewRunSummary | null {
  const progress = readPayloadRecord(progressPayload);
  const summaryPayload = readPayloadRecord(progress?.scheduledSummaryPayload);
  return readPayloadRecord(summaryPayload?.metrics);
}

async function findCachedReview(
  db: HiveScoutPrisma,
  sourceUrl: string,
  cacheTtlDays: number,
): Promise<AmbiguityReviewDecision | null> {
  const cutoff = new Date(Date.now() - cacheTtlDays * 24 * 60 * 60 * 1000);
  const hash = sourceUrlHash(sourceUrl);
  const rows = await db.backlogItemActivity.findMany({
    where: {
      kind: "evidence",
      recordedAt: { gte: cutoff },
      payload: {
        path: ["sourceUrlHash"],
        equals: hash,
      },
    },
    orderBy: { recordedAt: "desc" },
    take: 1,
    select: { payload: true },
  });

  const payload = readPayloadRecord(rows[0]?.payload);
  const review = payload ? payload.ambiguityReview : null;
  return isValidAmbiguityDecision(review) ? review : null;
}

function validateReviewDecisions(values: unknown[]): {
  decisions: AmbiguityReviewDecision[];
  dropped: number;
} {
  const result = validateAutonomousReviewDecisions(AmbiguityReviewDecisionSchema, values);
  return { decisions: result.decisions, dropped: result.dropped };
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
  let created = 0;
  let duplicates = 0;
  let deferred = 0;
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
          for (const decision of acceptedDecisions) {
            reviewBySource.set(decision.sourceUrl, decision);
            incrementClassification(reviewClassificationHistogram, decision.classification);
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
    const status = match.confidence === "mapped" ? "open" : "deferred";
    const reviewRequiresHuman = review?.classification === "needs_human_review";
    const finalStatus = reviewRequiresHuman ? "deferred" : status;
    if (finalStatus === "deferred") deferred++;

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
    reviewCacheHits,
    reviewCacheHitRate,
    reviewLatencyMs,
    created,
    duplicates,
    deferred,
    createdItemIds,
  };
}

function applyReviewToMatch(
  match: ValueStreamMatch,
  _review: AmbiguityReviewDecision | null,
): ValueStreamMatch {
  return match;
}

function isValidAmbiguityDecision(value: unknown): value is AmbiguityReviewDecision {
  return AmbiguityReviewDecisionSchema.safeParse(value).success;
}

function extractJsonArray(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\[[\s\S]*\]/);
    if (!match) throw new Error("No JSON array found in ambiguity review response");
    return JSON.parse(match[0]);
  }
}

async function reviewAmbiguousEntriesWithTak(
  input: AmbiguityReviewInput,
): Promise<unknown[]> {
  const entries = input.entries.slice(0, REVIEW_BATCH_LIMIT);
  if (entries.length === 0) return [];

  const { routeAndCall } = await import("@/lib/routed-inference");
  const systemPrompt = await loadPrompt(
    REVIEWER_PROMPT_CATEGORY,
    REVIEWER_PROMPT_SLUG,
    FALLBACK_REVIEWER_PROMPT,
  );
  const result = await routeAndCall(
    [
      {
        role: "user",
        content: JSON.stringify(
          {
            entries,
            existingSkillNames: input.existingSkillNames.slice(0, 80),
            existingCoworkerNames: input.existingCoworkerNames.slice(0, 80),
            valueStreamNames: input.valueStreamNames,
          },
          null,
          2,
        ),
      },
    ],
    systemPrompt,
    "internal",
    {
      taskType: "analysis",
      budgetClass: "minimize_cost",
      effort: "low",
      agentId: "external-catalog-scout",
      agentDisplayName: "External Catalog Scout",
      persistDecision: true,
    },
  );

  const parsed = extractJsonArray(result.content);
  return Array.isArray(parsed) ? parsed : [];
}

async function notifyAdmins(created: number, prismaClient: HiveScoutPrisma = prisma): Promise<void> {
  if (created === 0) return;
  const admins = await prismaClient.user.findMany({
    where: { isSuperuser: true, isActive: true },
    select: { id: true },
  });
  if (admins.length === 0) return;

  await Promise.all(
    admins.map((admin: { id: string }) =>
      sendQueueNotification({
        recipientUserId: admin.id,
        workItemId: `hive-scout-${Date.now()}`,
        title: "Hive Scout — new archetype suggestions",
        body: `${created} new archetype suggestions from external catalogs.`,
        urgency: "low",
        deepLink: DEEP_LINK,
      }),
    ),
  );
}
