// EP-DATA-RETENTION — Generic retention purge engine.
//
// Spec: docs/superpowers/specs/2026-06-14-data-retention-lifecycle-governance-design.md §5
//
// Pure, prisma-injected, deterministic given `now`. No scheduling, no
// ScheduledJob writes, no industry I/O here — that orchestration lives in
// run.ts. This file just: for each PURGE_POLICY, compute the effective cutoff
// (base widened by industry floor), then either count (dry-run) or batch-delete
// rows older than the cutoff, bounded by a per-policy cap.

import {
  PURGE_POLICIES,
  RETAINED_DATASETS,
  type PurgePolicy,
  type RetentionPrismaClient,
} from "./policies";
import { resolveEffectiveRetentionDays } from "./industry-floors";
import { legalHoldExclusion } from "./legal-hold";
import {
  RETENTION_BATCH_SIZE,
  RETENTION_PER_POLICY_CAP,
  cutoffForDays,
} from "./constants";
import { getErrorMessage } from "@/lib/shared/get-error-message";

export interface PolicyResult {
  model: string;
  label: string;
  category: string;
  baseRetentionDays: number;
  effectiveRetentionDays: number;
  /** ISO cutoff: rows with timestamp < this were eligible. */
  cutoff: string;
  /** Rows deleted (or, in dry-run, rows that WOULD be deleted). */
  affected: number;
  /** True when the per-policy cap was hit (more remain for the next run). */
  capped: boolean;
  durationMs: number;
  error?: string;
}

export interface RetentionSweepReport {
  dryRun: boolean;
  industryKey: string | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  /** Total rows deleted (0 in dry-run). */
  totalAffected: number;
  /** How many policies errored (the sweep continues past a failing policy). */
  errorCount: number;
  results: PolicyResult[];
  /** Count of regulated datasets explicitly excluded from purge this run. */
  retainedDatasetCount: number;
}

export interface RunRetentionSweepOptions {
  prisma: RetentionPrismaClient;
  now: Date;
  /** When true, count only — no deletes. */
  dryRun: boolean;
  /** Industry/archetype key for floor widening (null = base windows). */
  industryKey: string | null;
  /** Test/operator overrides. */
  batchSize?: number;
  perPolicyCap?: number;
  /** Restrict to a subset of policies (by model). Defaults to all. */
  onlyModels?: string[];
}

/**
 * Batch-delete rows older than `cutoff` using an id-windowed loop: select a page
 * of ids matching the cutoff, delete them by id, repeat until none remain or the
 * cap is reached. deleteMany-by-id keeps each statement small and index-friendly
 * (PK), avoiding one giant range delete that locks the table.
 */
async function purgeByTimestamp(
  policy: PurgePolicy,
  prisma: RetentionPrismaClient,
  cutoff: Date,
  batchSize: number,
  cap: number,
): Promise<{ deleted: number; capped: boolean }> {
  const delegate = prisma[policy.model];
  if (!delegate) {
    throw new Error(`Unknown Prisma model for retention policy: ${policy.model}`);
  }
  const baseWhere: Record<string, unknown> = {
    [policy.timestampField]: { lt: cutoff },
    ...(policy.extraWhere ?? {}),
    // BI-90A8D153 GAP 2: never purge a row under legal hold. No-op for models
    // without a legalHold column; excludes held rows on those that have one.
    ...legalHoldExclusion(policy.model),
  };

  let deleted = 0;
  while (deleted < cap) {
    const take = Math.min(batchSize, cap - deleted);
    const rows = await delegate.findMany({
      where: baseWhere,
      select: { id: true },
      take,
    });
    if (rows.length === 0) break;
    const res = await delegate.deleteMany({
      where: { id: { in: rows.map((r) => r.id) } },
    });
    deleted += res.count;
    if (rows.length < take) break; // last partial page — nothing more matches
  }
  return { deleted, capped: deleted >= cap };
}

/** Dry-run count of rows a policy would purge. */
async function countEligible(
  policy: PurgePolicy,
  prisma: RetentionPrismaClient,
  cutoff: Date,
  cap: number,
): Promise<{ deleted: number; capped: boolean }> {
  const delegate = prisma[policy.model];
  if (!delegate) {
    throw new Error(`Unknown Prisma model for retention policy: ${policy.model}`);
  }
  const count = await delegate.count({
    where: {
      [policy.timestampField]: { lt: cutoff },
      ...(policy.extraWhere ?? {}),
      // BI-90A8D153 GAP 2: the dry-run count must match the real purge, so it
      // excludes held rows on the same models the live path does.
      ...legalHoldExclusion(policy.model),
    },
  });
  return { deleted: Math.min(count, cap), capped: count > cap };
}

/** Run the full sweep across all (or a subset of) purge policies. */
export async function runRetentionSweep(
  opts: RunRetentionSweepOptions,
): Promise<RetentionSweepReport> {
  const {
    prisma,
    now,
    dryRun,
    industryKey,
    batchSize = RETENTION_BATCH_SIZE,
    perPolicyCap = RETENTION_PER_POLICY_CAP,
    onlyModels,
  } = opts;

  const startedAt = now;
  const policies = onlyModels
    ? PURGE_POLICIES.filter((p) => onlyModels.includes(p.model))
    : PURGE_POLICIES;

  const results: PolicyResult[] = [];
  let totalAffected = 0;
  let errorCount = 0;

  for (const policy of policies) {
    const policyStart = Date.now();
    const effectiveRetentionDays = resolveEffectiveRetentionDays(
      policy,
      industryKey,
    );
    const cutoff = cutoffForDays(effectiveRetentionDays, now);

    try {
      let outcome: { deleted: number; capped: boolean };
      if (dryRun) {
        // Custom handlers don't expose a count path; report 0 with a note in
        // the rationale-driven docs. For dry-run we count via the timestamp
        // field even for custom-purge policies (parent-row estimate).
        outcome = await countEligible(policy, prisma, cutoff, perPolicyCap);
      } else if (policy.customPurge) {
        outcome = await policy.customPurge({
          prisma,
          cutoff,
          batchSize,
          cap: perPolicyCap,
        });
      } else {
        outcome = await purgeByTimestamp(
          policy,
          prisma,
          cutoff,
          batchSize,
          perPolicyCap,
        );
      }

      totalAffected += outcome.deleted;
      results.push({
        model: policy.model,
        label: policy.label,
        category: policy.category,
        baseRetentionDays: policy.baseRetentionDays,
        effectiveRetentionDays,
        cutoff: cutoff.toISOString(),
        affected: outcome.deleted,
        capped: outcome.capped,
        durationMs: Date.now() - policyStart,
      });
    } catch (err) {
      errorCount += 1;
      results.push({
        model: policy.model,
        label: policy.label,
        category: policy.category,
        baseRetentionDays: policy.baseRetentionDays,
        effectiveRetentionDays,
        cutoff: cutoff.toISOString(),
        affected: 0,
        capped: false,
        durationMs: Date.now() - policyStart,
        error: getErrorMessage(err),
      });
      // Continue: one policy failing must not strand the rest of the sweep.
    }
  }

  const finishedAt = new Date();
  return {
    dryRun,
    industryKey,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    totalAffected,
    errorCount,
    results,
    retainedDatasetCount: RETAINED_DATASETS.length,
  };
}
