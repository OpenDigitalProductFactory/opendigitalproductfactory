// apps/web/lib/decision-perspective/profession-corpus-evidence.ts
//
// WSID Phase 3 — record what actually happens at runtime when a coworker's
// profession corpus is (or is not) injected into its prompt. Coverage ≠ usage:
// these writes are the evidence that distinguishes "pages seeded" from "corpus
// used" and turns every miss into a deduplicated growth-backlog item.
//
//   • recordProfessionCorpusUsage — per-profession/day injected vs. missed counter.
//   • recordProfessionCorpusGap   — deduped gap (unmapped | empty-corpus |
//                                    low-relevance | deferred), occurrences++.
//   • recordProfessionCorpusEvidence — orchestrator called from the prompt path.
//
// Fail-open + fire-and-forget: a coworker response must NEVER break because a
// telemetry write failed. Every public fn swallows its own errors (logs + warns)
// and the orchestrator additionally guards each sub-write.

import { createHash } from "node:crypto";
import { prisma } from "@dpf/db";
import {
  normalizeCorpusTopic,
  type ProfessionCorpusContext,
} from "./profession-corpus";

/** Sentinel profession key for misses where the agent mapped to no family. */
export const UNMAPPED_PROFESSION_KEY = "(unmapped)";

export type ProfessionCorpusGapReason =
  | "unmapped"
  | "empty-corpus"
  | "low-relevance"
  | "deferred"
  // Provider-compliance answer validation failures. These are durable corpus
  // repair signals, not transient inference errors.
  | "missing-topic"
  | "stale-source"
  | "citation-mismatch"
  | "conflicting-evidence"
  // A consolidation bet this profession worked has completed; its technique is
  // a learning the corpus does not yet capture (BI-5C01F920, EP-8DC217EB
  // BET-0f). Recorded by the self-optimization sweep, not a coworker turn.
  | "bet-completed";

// ─── Structural DB client (satisfied by PrismaClient + test fakes) ────────────

export type ProfessionCorpusEvidenceClient = {
  professionCorpusGap: {
    upsert(args: {
      where: { fingerprint: string };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }): Promise<unknown>;
  };
  professionCorpusUsageStat: {
    upsert(args: {
      where: { professionKey_day: { professionKey: string; day: string } };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }): Promise<unknown>;
  };
};

function resolveDb(db?: ProfessionCorpusEvidenceClient): ProfessionCorpusEvidenceClient {
  return db ?? (prisma as unknown as ProfessionCorpusEvidenceClient);
}

/** UTC day bucket `YYYY-MM-DD` (bounds usage-stat cardinality to families×days). */
export function corpusUsageDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Deterministic, dedupe fingerprint (16 hex chars). */
export function corpusGapFingerprint(
  professionKey: string,
  topic: string,
  reason: ProfessionCorpusGapReason,
): string {
  return createHash("sha256")
    .update(`${professionKey}:${normalizeCorpusTopic(topic)}:${reason}`)
    .digest("hex")
    .slice(0, 16);
}

// ─── Usage stat ───────────────────────────────────────────────────────────────

export async function recordProfessionCorpusUsage(
  input: { professionKey: string; injected: boolean; now?: Date },
  deps: { db?: ProfessionCorpusEvidenceClient } = {},
): Promise<void> {
  const db = resolveDb(deps.db);
  const day = corpusUsageDay(input.now ?? new Date());
  const injectedDelta = input.injected ? 1 : 0;
  const missedDelta = input.injected ? 0 : 1;
  try {
    await db.professionCorpusUsageStat.upsert({
      where: { professionKey_day: { professionKey: input.professionKey, day } },
      create: {
        professionKey: input.professionKey,
        day,
        injectedCount: injectedDelta,
        missedCount: missedDelta,
      },
      update: {
        injectedCount: { increment: injectedDelta },
        missedCount: { increment: missedDelta },
      },
    });
  } catch (err) {
    console.warn("[profession-corpus] usage-stat write failed (fail-open):", err);
  }
}

// ─── Gap ──────────────────────────────────────────────────────────────────────

export type RecordProfessionCorpusGapInput = {
  professionKey: string;
  reason: ProfessionCorpusGapReason;
  query: string;
  agentId?: string | null;
  routeContext?: string | null;
  suggestedSource?: string | null;
};

/**
 * Record (or coalesce) a profession-corpus gap. Re-detecting the same
 * (professionKey, topic, reason) increments `occurrences` and refreshes the
 * latest context rather than piling up duplicate rows.
 */
export async function recordProfessionCorpusGap(
  input: RecordProfessionCorpusGapInput,
  deps: { db?: ProfessionCorpusEvidenceClient } = {},
): Promise<{ recorded: boolean; fingerprint: string }> {
  const db = resolveDb(deps.db);
  const topic = normalizeCorpusTopic(input.query);
  if (topic.length === 0) return { recorded: false, fingerprint: "" };

  const fingerprint = corpusGapFingerprint(input.professionKey, topic, input.reason);
  try {
    await db.professionCorpusGap.upsert({
      where: { fingerprint },
      create: {
        fingerprint,
        professionKey: input.professionKey,
        agentId: input.agentId ?? null,
        routeContext: input.routeContext ?? null,
        query: input.query.slice(0, 2000),
        missingTopic: topic,
        reason: input.reason,
        suggestedSource: input.suggestedSource ?? null,
        occurrences: 1,
        status: "open",
      },
      update: {
        occurrences: { increment: 1 },
        // Refresh the latest-occurrence context for the operator.
        agentId: input.agentId ?? null,
        routeContext: input.routeContext ?? null,
        query: input.query.slice(0, 2000),
        suggestedSource: input.suggestedSource ?? null,
      },
    });
    return { recorded: true, fingerprint };
  } catch (err) {
    console.warn("[profession-corpus] gap write failed (fail-open):", err);
    return { recorded: false, fingerprint };
  }
}

/** Record deduplicated repair signals emitted by the provider-answer evidence gate. */
export async function recordProviderComplianceAnswerGaps(
  input: {
    reasons: ReadonlyArray<"missing-topic" | "stale-source" | "citation-mismatch" | "conflicting-evidence">;
    query: string;
    agentId?: string | null;
    routeContext?: string | null;
  },
  deps: { db?: ProfessionCorpusEvidenceClient } = {},
): Promise<void> {
  for (const reason of new Set(input.reasons)) {
    await recordProfessionCorpusGap({
      professionKey: "legal-compliance",
      reason,
      query: input.query,
      agentId: input.agentId,
      routeContext: input.routeContext,
    }, deps);
  }
}

// ─── Orchestrator (called from the prompt path) ───────────────────────────────

/** Map a resolved corpus context to the gap reason it should record, if any. */
export function gapReasonForContext(
  context: ProfessionCorpusContext,
): ProfessionCorpusGapReason | null {
  switch (context.status) {
    case "missed-unmapped":
      return "unmapped";
    case "missed-empty-corpus":
    case "missed-empty-applicable-corpus":
      return "empty-corpus";
    case "injected":
      return context.lowRelevance ? "low-relevance" : null;
    case "error":
      // Transient DB error — do NOT pollute the growth backlog with infra noise.
      return null;
  }
}

/**
 * Record both the usage signal and (when applicable) the growth gap for a single
 * coworker turn. Designed to be called fire-and-forget: it never throws.
 */
export async function recordProfessionCorpusEvidence(
  input: {
    context: ProfessionCorpusContext;
    query: string;
    agentId?: string | null;
    routeContext?: string | null;
    /**
     * Whether the corpus block ACTUALLY landed in the final prompt. Defaults to
     * `status === "injected"`, but the caller can override it: context
     * arbitration may drop a resolved block under a tight token budget, which is
     * a usage miss (corpus exists, but the coworker didn't get it) without being
     * a corpus gap (no growth-backlog item — the corpus is fine).
     */
    promptInjected?: boolean;
    now?: Date;
  },
  deps: { db?: ProfessionCorpusEvidenceClient } = {},
): Promise<void> {
  const { context } = input;
  const professionKey = context.professionKey ?? UNMAPPED_PROFESSION_KEY;
  const injected = input.promptInjected ?? context.status === "injected";

  // Usage stat — skip transient DB errors so the counter reflects real outcomes,
  // not infra blips.
  if (context.status !== "error") {
    await recordProfessionCorpusUsage(
      { professionKey, injected, now: input.now },
      { db: deps.db },
    );
  }

  const reason = gapReasonForContext(context);
  if (reason) {
    await recordProfessionCorpusGap(
      {
        professionKey,
        reason,
        query: input.query,
        agentId: input.agentId ?? null,
        routeContext: input.routeContext ?? null,
        suggestedSource: context.suggestedSource,
      },
      { db: deps.db },
    );
  }
}
