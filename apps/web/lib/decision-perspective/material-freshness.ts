// Material freshness lifecycle (BI-06B2EC05, EP-CORPUS-BOOTSTRAP).
//
// Enriched material is born "current" but nothing ages it — so stale research
// would influence decisions forever. This adds the missing decay: on a schedule,
// material that hasn't been re-validated within a staleness window transitions
// current → stale (down-weighted in decisions; FRESHNESS_FACTORS.stale = 0.5).
//
// First-party material (evidence grade A — the operator's own stated facts) does
// NOT auto-decay; only DERIVED/RESEARCHED material (grades B/C/D) ages, because
// that's the content whose accuracy drifts as the world changes. A later refresh
// re-validates it (lastValidatedAt = now, freshness = current).
//
// Superseded/contradicted transitions are explicit (a replacement or refutation),
// not time-based, so they are not handled here.

const DEFAULT_STALENESS_WINDOW_DAYS = 90;

/** Evidence grades that age over time. First-party (A) facts do not auto-decay. */
const DECAYING_GRADES = new Set(["B", "C", "D"]);

export type FreshnessDecayClient = {
  perspectiveMaterial: {
    findMany: (args: unknown) => Promise<unknown>;
    update: (args: unknown) => Promise<unknown>;
  };
};

export type DecayStaleMaterialsInput = {
  now?: Date;
  stalenessWindowDays?: number;
  db?: FreshnessDecayClient;
};

export type DecayStaleMaterialsResult = { scanned: number; staled: number };

type MaterialRow = {
  materialId: string;
  evidenceGrade: string;
  lastValidatedAt: Date | null;
  createdAt: Date;
};

/** Age `current` material to `stale` when it has not been validated within the
 *  staleness window. Idempotent: only touches `current` rows past the cutoff. */
export async function decayStaleMaterials(
  input: DecayStaleMaterialsInput = {},
): Promise<DecayStaleMaterialsResult> {
  const now = input.now ?? new Date();
  const windowDays = input.stalenessWindowDays ?? DEFAULT_STALENESS_WINDOW_DAYS;
  const cutoff = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);

  const db = input.db;
  if (!db) {
    const { prisma } = await import("@dpf/db");
    return decayStaleMaterials({ ...input, db: prisma as unknown as FreshnessDecayClient });
  }

  const rows = (await db.perspectiveMaterial.findMany({
    where: { freshness: "current" },
    select: { materialId: true, evidenceGrade: true, lastValidatedAt: true, createdAt: true },
  })) as MaterialRow[];

  let staled = 0;
  for (const row of rows) {
    if (!DECAYING_GRADES.has(row.evidenceGrade)) continue; // first-party A never auto-decays
    const lastTouched = row.lastValidatedAt ?? row.createdAt;
    if (lastTouched.getTime() > cutoff.getTime()) continue; // still within window
    await db.perspectiveMaterial.update({
      where: { materialId: row.materialId },
      data: { freshness: "stale" },
    });
    staled++;
  }

  return { scanned: rows.length, staled };
}
