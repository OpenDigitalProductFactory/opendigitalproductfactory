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
import { canRunStartupModelDiscovery } from "@/lib/routing/provider-eligibility";
import { capacityRoutingExclusionReason, isHardCapacityBlock } from "@/lib/routing/capacity-routing-exclude";
import { getErrorMessage } from "@/lib/shared/get-error-message";

const LOCK_KEY = 0x4d434156; // "MCAV" as int32 (deterministic, stable)

export type ModelRevalidationOutcome =
  | { providerId: string; status: "ok"; discovered: number; profiled: number }
  | { providerId: string; status: "failed"; error: string }
  | { providerId: string; status: "skipped"; reason: string };
export type ModelRevalidationSummary = { acquired: boolean; outcomes: ModelRevalidationOutcome[] };

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

/** providerId → reason, for providers whose recorded capacity is a hard block now. */
async function hardBlockedProviders(providerIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (providerIds.length === 0) return out;
  const nowMs = Date.now();
  const rows = await prisma.providerCapacityStatus.findMany({
    where: { providerId: { in: providerIds } },
    select: { providerId: true, state: true, retryAt: true, lastObservedAt: true },
  });
  for (const row of rows) {
    if (!row.providerId) continue;
    const snapshot = { state: row.state, retryAtMs: row.retryAt?.getTime() ?? null, observedAtMs: row.lastObservedAt?.getTime() ?? null };
    if (!isHardCapacityBlock(snapshot, nowMs)) continue;
    out.set(row.providerId, capacityRoutingExclusionReason(snapshot, nowMs) ?? `provider capacity ${row.state}`);
  }
  return out;
}

export async function runModelRevalidation(
  opts: { source: "startup" | "scheduled" | "manual" },
  pgPool: Pool,
): Promise<ModelRevalidationSummary> {
  console.log(`[model-revalidation] Starting (source=${opts.source})`);
  const outcomes: ModelRevalidationOutcome[] = [];

  const acquired = await withAdvisoryLock(pgPool, async () => {
    const totalDeadline = Date.now() + 10 * 60 * 1000; // 10-min hard cap

    const activeProviders = await prisma.modelProvider.findMany({
      where: { status: { in: ["active", "degraded"] } },
      select: {
        providerId: true,
        endpointType: true,
        category: true,
        serviceKind: true,
        authMethod: true,
        cliEngine: true,
      },
    });

    const blocked = opts.source === "manual" ? new Map<string, string>() : await hardBlockedProviders(activeProviders.map((p) => p.providerId));

    for (const provider of activeProviders.filter(canRunStartupModelDiscovery)) {
      const { providerId } = provider;
      const blockedReason = blocked.get(providerId);
      if (blockedReason) {
        // Unattended discovery and profiling against a provider that has said
        // calls will fail is guaranteed waste (BI-5A6C4011). An operator-run
        // refresh still goes through, so a just-fixed credential can be checked.
        outcomes.push({ providerId, status: "skipped", reason: blockedReason });
        console.log(`[model-revalidation] Skipped ${providerId}: ${blockedReason}`);
        continue;
      }
      if (Date.now() > totalDeadline) {
        console.warn(
          "[model-revalidation] Total budget exceeded — stopping early",
        );
        break;
      }
      try {
        // Per-provider 60s timeout: race the discovery against a rejection
        const result = await Promise.race([
          autoDiscoverAndProfile(providerId),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`${providerId} timed out after 60s`)),
              60_000,
            ),
          ),
        ]);
        if (result.error) {
          outcomes.push({ providerId, status: "failed", error: result.error });
          console.warn(`[model-revalidation] ${providerId} failed (non-fatal): ${result.error}`);
          continue;
        }
        outcomes.push({ providerId, status: "ok", discovered: result.discovered, profiled: result.profiled });
        console.log(`[model-revalidation] Refreshed ${providerId}`);
      } catch (err) {
        outcomes.push({ providerId, status: "failed", error: getErrorMessage(err) });
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
  return { acquired, outcomes };
}
