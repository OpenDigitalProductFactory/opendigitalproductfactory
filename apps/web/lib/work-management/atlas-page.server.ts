import type { AtlasHold, AtlasShapeMeta } from "@/lib/work-management/atlas-map";
import type { AtlasRoom } from "@/lib/work-management/atlas-projection";
import type { HeldWorkroomRow } from "@/lib/work-management/held-workrooms";
import { ALL_ARCHETYPES, deriveTwinProfile } from "@dpf/storefront-templates";

import { AREA_SECTIONS } from "@/lib/navigation/portal-shell-sections";
import { atlasLayoutFor, type AtlasLayout } from "@/lib/work-management/atlas-layout";
import { getWorkShape } from "@/lib/work-management/work-shapes";

/** Display title and stages for each shape on the map, from the shape registry. */
export function atlasShapeMeta(rooms: readonly AtlasRoom[]): Record<string, AtlasShapeMeta> {
  const meta: Record<string, AtlasShapeMeta> = {};
  for (const key of new Set(rooms.flatMap((room) => room.shape ? [room.shape] : []))) {
    const shape = getWorkShape(key);
    if (shape) meta[key] = { title: shape.title, stages: shape.stages.map((stage) => ({ key: stage.key, title: stage.title })) };
  }
  return meta;
}

/**
 * The drive's recorded hold for each held room, in words. This is what the
 * retired "Shared recovery issues" section said; it now shows on the room's row.
 */
export function atlasHolds(rows: readonly HeldWorkroomRow[]): Record<string, AtlasHold> {
  return Object.fromEntries(rows.map((row) => {
    const cause = row.reason === "executor_writeback_unavailable" ? "Stage results were not recorded" : row.reason.replaceAll("_", " ");
    const detail = row.deviationCodes.map((code) => code.replaceAll("_", " "));
    return [row.capsuleId, { reason: [cause, ...detail].join(", "), since: row.since, recovery: row.recoveryCondition ?? null }];
  }));
}

/** The area page whose Work view draws this portfolio's shape map, for "Show in flow map". */
export function atlasFlowHref(portfolio: string, shape: string | undefined, stage: string | undefined): string | null {
  const section = AREA_SECTIONS.find((candidate) => candidate.portfolioRole === portfolio);
  if (!section || !shape) return null;
  const params = new URLSearchParams({ view: "work", shape });
  if (stage) params.set("stage", stage);
  return `/area/${section.key}?${params.toString()}`;
}

/** The install's business layout (A6a): its archetype's twin template, or the portfolio map. */
export async function loadAtlasLayout(db: {
  storefrontConfig?: { findFirst(args: unknown): Promise<{ archetype: { archetypeId: string } | null } | null> };
}): Promise<AtlasLayout & { workItems: string }> {
  const config = await db.storefrontConfig?.findFirst({ select: { archetype: { select: { archetypeId: true } } } }).catch(() => null);
  const archetype = config?.archetype ? ALL_ARCHETYPES.find((candidate) => candidate.archetypeId === config.archetype!.archetypeId) : undefined;
  const profile = archetype ? deriveTwinProfile(archetype) : null;
  return { ...atlasLayoutFor(profile?.template ?? "TENANTS"), workItems: profile?.workItemNoun.plural ?? "rooms" };
}

export type AtlasJustNowRow = { capsuleId: string; title: string; summary: string; recordedAt: string };

/** The last few things recorded across open rooms (design §3.7), newest first. */
export async function loadAtlasJustNow(db: {
  workroomActivity?: { findMany(args: unknown): Promise<Array<{ summary: string; recordedAt: Date; capsule: { capsuleId: string; title: string | null } }>> };
}, limit = 6): Promise<AtlasJustNowRow[]> {
  const rows = await db.workroomActivity?.findMany({
    where: { capsule: { archivedAt: null } },
    orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
    take: limit,
    select: { summary: true, recordedAt: true, capsule: { select: { capsuleId: true, title: true } } },
  }).catch(() => []) ?? [];
  return rows.map((row) => ({
    capsuleId: row.capsule.capsuleId,
    title: row.capsule.title?.trim() || row.capsule.capsuleId,
    summary: row.summary.length > 160 ? `${row.summary.slice(0, 159)}…` : row.summary,
    recordedAt: row.recordedAt.toISOString(),
  }));
}
