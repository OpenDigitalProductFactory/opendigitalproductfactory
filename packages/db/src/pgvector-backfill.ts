// BET-5 (BI-A1E864A5): one-time, idempotent copy of the Qdrant collections into pgvector.
// Runs during self-upgrade BEFORE Qdrant is removed (ordering per BI-922EBB99). Safe to re-run:
// a collection that already has rows in pgvector is skipped. Qdrant ids are already the hashed
// numeric point ids, so they are inserted verbatim (no re-hash) to preserve identity.
import { prisma } from "./client";
import { QDRANT_COLLECTIONS } from "./pgvector-store";
import { scrollAllPoints } from "./qdrant-legacy";

export async function backfillQdrantToPgvector(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const collection of Object.values(QDRANT_COLLECTIONS)) {
    const existing = (await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM vector_embedding WHERE collection = $1`,
      collection,
    )) as Array<{ n: number }>;
    if ((existing[0]?.n ?? 0) > 0) { counts[collection] = 0; continue; } // already backfilled

    let points: Array<{ id: number; vector: number[]; payload: Record<string, unknown> }>;
    try {
      points = await scrollAllPoints(collection);
    } catch {
      counts[collection] = 0; // Qdrant already gone / unreachable → nothing to copy
      continue;
    }
    for (const p of points) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO vector_embedding (collection, point_id, embedding, payload)
         VALUES ($1, $2, $3::vector, $4::jsonb)
         ON CONFLICT (collection, point_id) DO NOTHING`,
        collection,
        p.id,
        `[${p.vector.join(",")}]`,
        JSON.stringify(p.payload),
      );
    }
    counts[collection] = points.length;
  }
  return counts;
}
