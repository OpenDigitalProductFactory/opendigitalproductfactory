import { prisma } from "@dpf/db";

type RawExecutor = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;

/**
 * Close every still-open phase run of a build that has just gone terminal
 * (failed or abandoned). Each row keeps its real duration.
 *
 * BI-59164941: the abandon and fail writers set the build's phase and left its
 * BuildPhaseRun open, so a reader that treats `completedAt IS NULL` as work in
 * flight (quiescence, metering, quiet-window checks) counted finished builds
 * forever; live on 2026-10-06 three of eight "open" runs belonged to builds
 * that had failed or been abandoned up to an hour earlier. Quiescence's
 * reconciler closes such rows, but only when a self-upgrade is captured.
 * Accepts the caller's transaction so the close lands with the terminal write.
 * Best-effort outside a transaction: a failure here must never undo the
 * terminal transition itself.
 */
export async function closeOpenBuildPhaseRunsForTerminalBuild(
  buildId: string,
  opts?: { db?: unknown; now?: Date },
): Promise<number> {
  const executeRaw = (opts?.db as { $executeRaw?: RawExecutor } | undefined)?.$executeRaw ?? (prisma.$executeRaw as RawExecutor);
  const now = opts?.now ?? new Date();
  try {
    const closed = await executeRaw`
      UPDATE "BuildPhaseRun"
      SET "completedAt" = ${now},
          "durationMs" = GREATEST(0, (EXTRACT(EPOCH FROM (${now}::timestamp - "startedAt")) * 1000)::int)
      WHERE "buildId" = ${buildId} AND "completedAt" IS NULL`;
    return Number(closed) || 0;
  } catch (err) {
    // Bookkeeping only: never let it undo the terminal transition it follows.
    console.warn("[build-phase-run] Failed to close open phase runs for terminal build:", { buildId }, err);
    return 0;
  }
}

