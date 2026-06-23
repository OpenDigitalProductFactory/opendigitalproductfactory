/**
 * Boot-time database-continuity guard (BI-B61779DB).
 *
 * The 2026-06-23 incident: the portal silently came up on an 8-day-stale postgres
 * volume (a compose-project/volume divergence let a plain `docker compose up`
 * attach the dormant canonical `dpf_pgdata`). `portal-init`'s migrate+seed then
 * MASKED it — the schema looked current while the DATA was 8 days old — because
 * nothing checks data freshness, only schema freshness.
 *
 * This guard closes that hole with a monotonic "continuity epoch" stored in BOTH
 * places that a volume swap separates:
 *   - the DB itself (PlatformConfig `db.continuity.epoch`) — reverts WITH the data
 *   - a host-side marker file OUTSIDE the postgres volume (a bind mount the portal
 *     already has, default `/backups/.dpf-db-continuity.json`) — does NOT revert
 *
 * On boot, if the DB's epoch is BEHIND the host marker, the DB went backwards
 * relative to what this host last durably observed → the volume was reverted or
 * swapped → fail loud (durable alert + CRITICAL log; optionally refuse to boot via
 * DPF_DB_REVERT_FAILCLOSED=1). Otherwise both advance in lockstep. The check is
 * monotonic, so legitimate downtime never false-positives (epochs do not advance
 * while the platform is off). An intentional restore of an older snapshot is
 * acknowledged with DPF_ALLOW_DB_REVERT=1.
 *
 * The pure {@link classifyContinuity} comparator and the dependency-injected
 * {@link runDbContinuityCheck} are exported for unit tests; {@link assertDbContinuityOnBoot}
 * is the real-IO wrapper called from instrumentation.ts.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

export type ContinuityVerdict = "first-boot" | "ok" | "reverted" | "skipped";

export const DB_CONTINUITY_EPOCH_KEY = "db.continuity.epoch";
export const DB_CONTINUITY_ALERT_KEY = "db.continuity.alert";
const DEFAULT_MARKER_PATH = "/backups/.dpf-db-continuity.json";

/**
 * Pure comparator. `reverted` ONLY when the host has durably seen a later epoch
 * than the DB currently reports (including the case where the DB has no epoch at
 * all but the host does — a wipe/revert to a pre-guard snapshot, exactly the
 * 2026-06-23 shape).
 */
export function classifyContinuity(args: {
  dbEpoch: number | null;
  hostEpoch: number | null;
}): ContinuityVerdict {
  const db = args.dbEpoch ?? 0;
  const host = args.hostEpoch ?? 0;
  if (db <= 0 && host <= 0) return "first-boot";
  if (host > 0 && db < host) return "reverted";
  return "ok";
}

export interface ContinuityAlert {
  detectedAt: string;
  dbEpoch: number | null;
  hostEpoch: number | null;
  reason: string;
}

export interface ContinuityDeps {
  readDbEpoch: () => Promise<number | null>;
  writeDbEpoch: (epoch: number) => Promise<void>;
  /** Upsert the durable revert alert, or clear it when passed null. */
  writeDbAlert: (alert: ContinuityAlert | null) => Promise<void>;
  readHostEpoch: () => Promise<number | null>;
  writeHostEpoch: (epoch: number) => Promise<void>;
  /** False in dev/test where the host marker dir isn't available — the check no-ops. */
  markerUsable: () => Promise<boolean>;
  env: Record<string, string | undefined>;
  now: () => Date;
  logger: Pick<Console, "log" | "warn" | "error">;
}

/**
 * The dependency-injected core. Returns the verdict and (when advanced) the new
 * epoch. Throws ONLY when a revert is detected AND DPF_DB_REVERT_FAILCLOSED=1.
 */
export async function runDbContinuityCheck(
  deps: ContinuityDeps,
): Promise<{ verdict: ContinuityVerdict; epoch?: number }> {
  if (!(await deps.markerUsable())) {
    deps.logger.log("[db-continuity] host marker unavailable — skipping freshness check (dev/test)");
    return { verdict: "skipped" };
  }

  const dbEpoch = await deps.readDbEpoch();
  const hostEpoch = await deps.readHostEpoch();
  const verdict = classifyContinuity({ dbEpoch, hostEpoch });
  const bypass = deps.env.DPF_ALLOW_DB_REVERT === "1";

  if (verdict === "reverted" && !bypass) {
    const alert: ContinuityAlert = {
      detectedAt: deps.now().toISOString(),
      dbEpoch,
      hostEpoch,
      reason:
        "postgres volume appears reverted/stale (DB continuity epoch is behind the host marker)",
    };
    deps.logger.error(
      `[db-continuity] CRITICAL: database appears REVERTED — dbEpoch=${dbEpoch ?? "none"} is behind ` +
        `hostEpoch=${hostEpoch}. The portal likely came up on a STALE or WRONG postgres volume ` +
        `(see BI-B61779DB). NOT advancing the epoch and NOT trusting this as current data. If this is ` +
        `an intentional restore of an older snapshot, re-boot once with DPF_ALLOW_DB_REVERT=1.`,
    );
    await deps.writeDbAlert(alert);
    if (deps.env.DPF_DB_REVERT_FAILCLOSED === "1") {
      throw new Error(
        "[db-continuity] DB revert detected and DPF_DB_REVERT_FAILCLOSED=1 — refusing to boot on a reverted/stale volume.",
      );
    }
    return { verdict };
  }

  // ok | first-boot | acknowledged-revert → advance both markers in lockstep and
  // clear any standing alert.
  const newEpoch = Math.max(dbEpoch ?? 0, hostEpoch ?? 0) + 1;
  await deps.writeDbEpoch(newEpoch);
  await deps.writeHostEpoch(newEpoch);
  await deps.writeDbAlert(null);

  if (verdict === "reverted" && bypass) {
    deps.logger.warn(
      `[db-continuity] revert detected but DPF_ALLOW_DB_REVERT=1 set — adopting epoch ${newEpoch} (intentional restore).`,
    );
    return { verdict: "ok", epoch: newEpoch };
  }
  deps.logger.log(`[db-continuity] ${verdict} — continuity epoch advanced to ${newEpoch}`);
  return { verdict, epoch: newEpoch };
}

function resolveMarkerPath(env: Record<string, string | undefined>): string {
  const fromEnv = env.DPF_DB_CONTINUITY_MARKER;
  return fromEnv && fromEnv.trim() ? fromEnv.trim() : DEFAULT_MARKER_PATH;
}

/**
 * Real-IO wrapper called from instrumentation.ts on boot. Non-fatal except the
 * opt-in fail-closed throw; any unexpected error is swallowed so a guard bug can
 * never wedge startup.
 */
export async function assertDbContinuityOnBoot(
  logger: Pick<Console, "log" | "warn" | "error"> = console,
): Promise<{ verdict: ContinuityVerdict; epoch?: number } | null> {
  const markerPath = resolveMarkerPath(process.env);
  const markerDir = path.posix.dirname(markerPath.replace(/\\/g, "/"));

  try {
    const { prisma } = await import("@dpf/db");

    const deps: ContinuityDeps = {
      env: process.env,
      now: () => new Date(),
      logger,
      markerUsable: async () => {
        try {
          await fs.mkdir(markerDir, { recursive: true });
          return true;
        } catch {
          return false;
        }
      },
      readHostEpoch: async () => {
        try {
          const raw = await fs.readFile(markerPath, "utf-8");
          const parsed = JSON.parse(raw) as { epoch?: number };
          return typeof parsed.epoch === "number" ? parsed.epoch : null;
        } catch {
          return null; // missing file = no prior host observation
        }
      },
      writeHostEpoch: async (epoch) => {
        await fs.writeFile(
          markerPath,
          `${JSON.stringify({ epoch, updatedAt: new Date().toISOString() }, null, 2)}\n`,
          "utf-8",
        );
      },
      readDbEpoch: async () => {
        const row = await prisma.platformConfig.findUnique({ where: { key: DB_CONTINUITY_EPOCH_KEY } });
        const epoch = (row?.value as { epoch?: number } | null)?.epoch;
        return typeof epoch === "number" ? epoch : null;
      },
      writeDbEpoch: async (epoch) => {
        const value = { epoch, updatedAt: new Date().toISOString() };
        await prisma.platformConfig.upsert({
          where: { key: DB_CONTINUITY_EPOCH_KEY },
          update: { value },
          create: { key: DB_CONTINUITY_EPOCH_KEY, value },
        });
      },
      writeDbAlert: async (alert) => {
        if (alert === null) {
          await prisma.platformConfig.deleteMany({ where: { key: DB_CONTINUITY_ALERT_KEY } });
          return;
        }
        await prisma.platformConfig.upsert({
          where: { key: DB_CONTINUITY_ALERT_KEY },
          update: { value: alert },
          create: { key: DB_CONTINUITY_ALERT_KEY, value: alert },
        });
      },
    };

    return await runDbContinuityCheck(deps);
  } catch (err) {
    // Re-throw ONLY the intentional fail-closed signal; everything else is non-fatal.
    if (err instanceof Error && err.message.includes("DPF_DB_REVERT_FAILCLOSED")) {
      throw err;
    }
    logger.error("[db-continuity] check failed (non-fatal):", err);
    return null;
  }
}
