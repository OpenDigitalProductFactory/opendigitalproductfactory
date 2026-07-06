// apps/web/lib/actions/hive-scout/ambiguity-review.ts
//
// Hive Scout — bounded autonomous ambiguity review of candidate archetype
// gaps: decision schema, review metrics helpers, decision cache lookup, and
// the default TAK-routed reviewer.

import { z } from "zod";
import type { PrismaClient } from "@dpf/db";
import { loadPrompt } from "@/lib/tak/prompt-loader";
import {
  validateAutonomousReviewDecisions,
  type ReviewFailureReason as BoundedReviewFailureReason,
  type ReviewRunSummary,
  type ReviewSkipReason as BoundedReviewSkipReason,
} from "@/lib/tak/bounded-autonomous-review";
import type { CatalogEntry } from "./catalog-readme";
import { sourceUrlHash } from "./gap-mapping";

// ─── Constants ──────────────────────────────────────────────────────────────

const REVIEWER_PROMPT_CATEGORY = "specialist";
const REVIEWER_PROMPT_SLUG = "hive-scout-ambiguity-reviewer";
export const REVIEW_BATCH_LIMIT = 12;
export const REVIEW_CACHE_TTL_DAYS = 30;
export const REVIEW_SETTING_PREFIX = "hive-scout.review";

// ─── Types ──────────────────────────────────────────────────────────────────

export type AmbiguityReviewClassification =
  | "new_archetype"
  | "existing_skill_gap"
  | "duplicate_pattern"
  | "out_of_scope"
  | "needs_human_review";

export type ReviewClassificationBreakdown = Record<
  string,
  Partial<Record<AmbiguityReviewClassification, number>>
>;

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

export type PublicReviewEntry = Pick<
  CatalogEntry,
  "name" | "industry" | "description" | "sourceUrl"
>;

export type AmbiguityReviewInput = {
  entries: PublicReviewEntry[];
  existingSkillNames: string[];
  existingCoworkerNames: string[];
  valueStreamNames: string[];
};

export type AmbiguityReviewer = (input: AmbiguityReviewInput) => Promise<unknown[]>;

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

// ─── Metrics helpers ────────────────────────────────────────────────────────

export function toPublicReviewEntry(entry: CatalogEntry): PublicReviewEntry {
  return {
    name: entry.name,
    industry: entry.industry,
    description: entry.description,
    sourceUrl: entry.sourceUrl,
  };
}

export function incrementClassification(
  histogram: Partial<Record<AmbiguityReviewClassification, number>>,
  classification: AmbiguityReviewClassification,
): void {
  histogram[classification] = (histogram[classification] ?? 0) + 1;
}

function incrementBreakdown(
  breakdown: ReviewClassificationBreakdown,
  rawKey: string,
  classification: AmbiguityReviewClassification,
): void {
  const key = rawKey.trim() || "unknown";
  const bucket = breakdown[key] ?? {};
  bucket[classification] = (bucket[classification] ?? 0) + 1;
  breakdown[key] = bucket;
}

export function incrementReviewBreakdowns(
  entry: CatalogEntry,
  classification: AmbiguityReviewClassification,
  byFramework: ReviewClassificationBreakdown,
  byIndustry: ReviewClassificationBreakdown,
): void {
  incrementBreakdown(byFramework, entry.framework ?? "main", classification);
  incrementBreakdown(byIndustry, entry.industry, classification);
}

function readPayloadRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function readReviewRunSummary(progressPayload: unknown): ReviewRunSummary | null {
  const progress = readPayloadRecord(progressPayload);
  const summaryPayload = readPayloadRecord(progress?.scheduledSummaryPayload);
  return readPayloadRecord(summaryPayload?.metrics);
}

// ─── Decision cache / validation ────────────────────────────────────────────

export async function findCachedReview(
  db: Pick<PrismaClient, "backlogItemActivity">,
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

export function validateReviewDecisions(values: unknown[]): {
  decisions: AmbiguityReviewDecision[];
  dropped: number;
} {
  const result = validateAutonomousReviewDecisions(AmbiguityReviewDecisionSchema, values);
  return { decisions: result.decisions, dropped: result.dropped };
}

function isValidAmbiguityDecision(value: unknown): value is AmbiguityReviewDecision {
  return AmbiguityReviewDecisionSchema.safeParse(value).success;
}

// ─── Default TAK-routed reviewer ────────────────────────────────────────────

const FALLBACK_REVIEWER_PROMPT = [
  "You are the Hive Scout ambiguity reviewer.",
  "Return ONLY a JSON array. One decision per entry.",
  "Each decision must contain sourceUrl, classification, novelty, valueStream, valueStreamConfidence, and rationale.",
  "classification must be one of: new_archetype, existing_skill_gap, duplicate_pattern, out_of_scope, needs_human_review.",
  "Judge novelty, archetype clustering, value-stream fit, and whether the idea is actually new for DPF.",
  "Keep deterministic mechanics outside this review: do not fetch, parse, dedupe, or write backlog items.",
].join(" ");

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

export async function reviewAmbiguousEntriesWithTak(
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
