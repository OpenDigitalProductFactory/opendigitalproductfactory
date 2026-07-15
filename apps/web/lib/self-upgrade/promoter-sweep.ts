// Defense-in-depth cleanup for orphaned promoter containers (BI-3EC7FDB0).
//
// runPromoter (promoter.ts) kills + force-removes a promoter that blows its
// ~25-min budget, but that timer lives in the ORCHESTRATOR process — if the
// portal itself is killed/restarted mid-build (the exact thing a swap does),
// the timer dies with it and the promoter `docker run` keeps building
// unattended. `--rm` only fires on a clean exit, so a stalled build lingers
// (SUR-756751D1: `Up 52m`) and, worse, could eventually finish and
// `--force-recreate` an UNEXPECTED swap for a run already failed. This periodic
// sweep (driven from instrumentation.ts) is the cron-independent backstop.

/**
 * Whether a `docker ps` CreatedAt stamp is older than maxAgeMs. Docker renders
 * CreatedAt as e.g. "2026-07-11 11:41:26 +0000 UTC"; the trailing " UTC" is not
 * ISO, so strip it before parsing. Returns FALSE on any unparseable input —
 * never claim a container is stale (and removable) when we can't prove its age.
 */
export function isPromoterContainerStale(
  createdAt: string,
  now: Date,
  maxAgeMs: number,
): boolean {
  const started = Date.parse((createdAt ?? "").replace(/ UTC$/, ""));
  if (!Number.isFinite(started)) return false;
  return now.getTime() - started >= maxAgeMs;
}

/** Minimal shape of a promisified execFile, so tests can inject a fake docker. */
export type DockerRun = (
  file: string,
  args: string[],
  options: { timeout: number },
) => Promise<{ stdout: string }>;

async function defaultDockerRun(): Promise<DockerRun> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  return promisify(execFile) as unknown as DockerRun;
}

/**
 * Force-remove any `dpf-promoter-*` container older than `maxAgeMs` — well past
 * both runPromoter's self-timeout and a normal ~7-min swap, so a legitimately
 * in-flight promoter is never touched. Non-fatal; never throws.
 */
export async function sweepOrphanedPromoterContainers(
  opts: { maxAgeMs?: number; now?: () => Date; run?: DockerRun } = {},
  logger: Pick<Console, "log" | "error"> = console,
): Promise<{ removed: number } | null> {
  const maxAgeMs = opts.maxAgeMs ?? 30 * 60 * 1000;
  const now = opts.now?.() ?? new Date();
  try {
    const run = opts.run ?? (await defaultDockerRun());
    const { stdout } = await run(
      "docker",
      ["ps", "--filter", "name=dpf-promoter-", "--format", "{{.Names}}\t{{.CreatedAt}}"],
      { timeout: 15_000 },
    );
    let removed = 0;
    for (const line of stdout.split("\n").map((l) => l.trim()).filter(Boolean)) {
      const [name, createdAt] = line.split("\t");
      if (!name) continue;
      if (!isPromoterContainerStale(createdAt ?? "", now, maxAgeMs)) continue;
      try {
        await run("docker", ["rm", "-f", name], { timeout: 15_000 });
        removed++;
        logger.log(
          `[promoter-sweep] force-removed orphaned promoter ${name} (age > ${Math.round(maxAgeMs / 60000)}m)`,
        );
      } catch (rmErr) {
        logger.error(`[promoter-sweep] failed to remove ${name} (non-fatal):`, rmErr);
      }
    }
    return { removed };
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code === "ENOENT") {
      // The docker CLI isn't on PATH — an entirely expected state on Docker-less
      // runtimes. Log it quietly (info, no stack) so this benign "skip" doesn't
      // trip the error-log PIR scanner on every sweep interval (BI-PIR-ae7f19b6).
      logger.log("[promoter-sweep] docker CLI unavailable (ENOENT); nothing to sweep");
      return null;
    }
    // A real docker/daemon failure (timeout, permission, daemon down) — surface it.
    logger.error("[promoter-sweep] failed (non-fatal):", err);
    return null;
  }
}
