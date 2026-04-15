/**
 * EP-MODEL-CAP-001-D: Model capability re-validation with distributed safety.
 *
 * Uses a dedicated Postgres session (not prisma.$queryRaw) for the advisory
 * lock so the lock is held for the full job duration, not just one transaction.
 * prisma.$queryRaw returns the connection to the pool after each call, which
 * would silently release session-scoped advisory locks mid-job.
 */
import { prisma } from "@dpf/db";
import { Pool } from "pg";
import { autoDiscoverAndProfile } from "./ai-provider-internals";

const LOCK_KEY = 0x4d434156; // "MCAV" as int32 (deterministic, stable)

/**
 * Acquire a session-scoped Postgres advisory lock on a dedicated connection.
 * The lock is held until fn() resolves, then explicitly released before the
 * connection is returned to the pool.
 * Returns false if another instance already holds the lock.
 */
async function withAdvisoryLock(
  pool: Pool,
  fn: () => Promise<void>,
): Promise<boolean> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock($1::bigint) AS acquired",
      [LOCK_KEY],
    );
    if (!rows[0]?.acquired) return false;
    try {
      await fn();
      return true;
    } finally {
      await client
        .query("SELECT pg_advisory_unlock($1::bigint)", [LOCK_KEY])
        .catch(() => {});
    }
  } finally {
    client.release();
  }
}

export async function runModelRevalidation(
  opts: { source: "startup" | "scheduled" | "manual" },
  pgPool: Pool,
): Promise<void> {
  console.log(`[model-revalidation] Starting (source=${opts.source})`);

  const acquired = await withAdvisoryLock(pgPool, async () => {
    const totalDeadline = Date.now() + 10 * 60 * 1000; // 10-min hard cap

    const activeProviders = await prisma.modelProvider.findMany({
      where: { status: { in: ["active", "degraded"] } },
      select: { providerId: true },
    });

    for (const { providerId } of activeProviders) {
      if (Date.now() > totalDeadline) {
        console.warn(
          "[model-revalidation] Total budget exceeded — stopping early",
        );
        break;
      }
      try {
        // Per-provider 60s timeout: race the discovery against a rejection
        await Promise.race([
          autoDiscoverAndProfile(providerId),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`${providerId} timed out after 60s`)),
              60_000,
            ),
          ),
        ]);
        console.log(`[model-revalidation] Refreshed ${providerId}`);
      } catch (err) {
        console.warn(
          `[model-revalidation] ${providerId} failed (non-fatal):`,
          err,
        );
      }
    }
  });

  if (!acquired) {
    console.log("[model-revalidation] Skipped — another instance is running");
  }
}
