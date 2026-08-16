// apps/web/lib/self-upgrade/impact/store.ts
//
// Durable persistence for the upgrade impact summary. The in-memory cache
// (./cache) is process-local and dies on the restart every self-upgrade
// triggers — so the summary the operator generated vanished, and re-opening it
// re-ran the git-log walk + LLM phrasing from scratch. This table makes a
// computed summary survive refresh and restart, keyed by the immutable
// (currentLineageSha, targetSha) pair (the commit range between two SHAs is
// fixed, so the summary for a pair never changes). Only successful summaries
// are persisted — the negative / not-applicable results are state-dependent and
// cheap to recompute, so they stay in the L1 cache only.

import { prisma, Prisma } from "@dpf/db";
import type { ImpactCategoryCounts, UpgradeImpactSummary } from "./types";

function compoundKey(currentLineageSha: string, targetSha: string) {
  return { currentLineageSha_targetSha: { currentLineageSha, targetSha } };
}

/** Read the persisted summary for a (lineage, target) pair, or null. */
export async function getPersistedSummary(
  currentLineageSha: string,
  targetSha: string,
): Promise<UpgradeImpactSummary | null> {
  const row = await prisma.upgradeImpactSummary.findUnique({
    where: compoundKey(currentLineageSha, targetSha),
    select: { summary: true },
  });
  return (row?.summary as UpgradeImpactSummary | undefined) ?? null;
}

/**
 * Read the persisted summary by its row id, or null. A SelfUpgradeRun records
 * the summary it carried via `impactSummaryId`, so the run card can show
 * exactly the changes THIS run applied — no (lineage, target) re-derivation,
 * which would drift once the upstream target advances past the run's endpoints.
 */
export async function getPersistedSummaryById(
  id: string,
): Promise<UpgradeImpactSummary | null> {
  const row = await prisma.upgradeImpactSummary.findUnique({
    where: { id },
    select: { summary: true },
  });
  return (row?.summary as UpgradeImpactSummary | undefined) ?? null;
}

/**
 * Read the persisted row id + summary for a pair — used to attach a
 * SelfUpgradeRun to the summary the operator reviewed. Null when none exists.
 */
export async function getPersistedSummaryRow(
  currentLineageSha: string,
  targetSha: string,
): Promise<{ id: string; summary: UpgradeImpactSummary } | null> {
  const row = await prisma.upgradeImpactSummary.findUnique({
    where: compoundKey(currentLineageSha, targetSha),
    select: { id: true, summary: true },
  });
  if (!row) return null;
  return { id: row.id, summary: row.summary as UpgradeImpactSummary };
}

/**
 * Batch-read the DIGEST (headline + counts) for a set of summary ids.
 *
 * The Run History table needs "what did this run carry?" for every visible row.
 * Reading each row's full `summary` JSON to get two fields would haul the entire
 * `allItems` array for a page of runs — potentially megabytes for a large
 * upgrade — so the projection happens in Postgres via jsonb paths and only the
 * two fields cross the wire. Bounded by the caller's page size; ids are
 * parameterised, never interpolated.
 */
export async function getPersistedSummaryDigests(
  ids: string[],
): Promise<Map<string, { counts: ImpactCategoryCounts; headline: string | null }>> {
  const unique = Array.from(new Set(ids.filter((id) => typeof id === "string" && id.length > 0)));
  const out = new Map<string, { counts: ImpactCategoryCounts; headline: string | null }>();
  if (unique.length === 0) return out;

  const rows = await prisma.$queryRaw<
    Array<{ id: string; counts: unknown; headline: string | null }>
  >`
    SELECT id,
           summary -> 'counts' AS counts,
           summary -> 'phrased' ->> 'headline' AS headline
      FROM "UpgradeImpactSummary"
     WHERE id = ANY(${unique})
  `;

  for (const row of rows) {
    if (!row.counts || typeof row.counts !== "object") continue;
    const headline = row.headline?.trim();
    out.set(row.id, {
      counts: row.counts as ImpactCategoryCounts,
      headline: headline ? headline : null,
    });
  }
  return out;
}

/**
 * Upsert a computed summary keyed by its (lineage, target) pair; returns the
 * row id. Idempotent — a re-computation (Refresh) overwrites in place.
 */
export async function persistSummary(summary: UpgradeImpactSummary): Promise<string> {
  const key = {
    currentLineageSha: summary.currentLineageSha,
    targetSha: summary.targetSha,
  };
  const data = {
    summary: summary as unknown as Prisma.InputJsonValue,
    generatedAt: new Date(summary.generatedAt),
  };
  const row = await prisma.upgradeImpactSummary.upsert({
    where: compoundKey(key.currentLineageSha, key.targetSha),
    create: { ...key, ...data },
    update: data,
    select: { id: true },
  });
  return row.id;
}
