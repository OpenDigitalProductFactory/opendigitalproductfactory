// Defense-in-depth cleanup for orphaned promoter containers (BI-3EC7FDB0).
//
// Two sweeps, chosen by where the promoter was launched (BI-224F56F1):
// - Installs without the private actuator keep the original sweep below
//   (sweepLegacyPromoterContainers): runPromoter's timer lives in the
//   orchestrator, so a portal killed mid-build (the thing a swap does) leaves a
//   `docker run --rm` promoter building unattended; this age-gated sweep of
//   running `dpf-promoter-*` containers is the cron-independent backstop.
// - The private actuator's durable launches keep their exact container as a
//   replay barrier until the canonical action owner is settled, even if the
//   caller or its reply is lost; sweepOrphanedPromoterContainersAtDaemon removes
//   one only under that settled-owner proof.

import { reconcileActuatorPromoters, usesPrivateActuator } from "@/lib/platform-runtime/actuator-client";

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

async function underSettledPromoterOwner(owner: string, remove: () => Promise<void>): Promise<boolean> {
  const [{ prisma }, { lockCanonicalRuntimeAdmission }] = await Promise.all([
    import("@dpf/db"), import("../platform-runtime/work-admission"),
  ]);
  return prisma.$transaction(async tx => {
    await lockCanonicalRuntimeAdmission(tx as unknown as Parameters<typeof lockCanonicalRuntimeAdmission>[0]);
    if (owner.startsWith("SUR-")) {
      await tx.$queryRaw`SELECT id FROM "SelfUpgradeRun" WHERE "runId" = ${owner} FOR UPDATE`;
      const run = await tx.selfUpgradeRun.findUnique({ where: { runId: owner }, select: { status: true } });
      if (!run || !["succeeded", "failed", "cancelled", "skipped", "rolled_back"].includes(run.status)) return false;
    } else {
      const transition = await tx.runtimeCapabilityTransition.findUnique({ where: { transitionId: owner },
        select: { status: true } });
      if (!transition || !["succeeded", "failed", "rolled_back"].includes(transition.status)) return false;
    }
    await remove();
    return true;
  }, { timeout: 20_000 });
}

/** Remove old promoters by immutable Docker ID. Legacy running containers
 * retain their original age gate. Any ownership label requires settled proof. */
export async function sweepOrphanedPromoterContainersAtDaemon(
  opts: { project?: string; maxAgeMs?: number; now?: () => Date; run?: DockerRun; underSettledOwner?: typeof underSettledPromoterOwner } = {},
  logger: Pick<Console, "log" | "error"> = console,
): Promise<{ removed: number } | null> {
  const maxAgeMs = opts.maxAgeMs ?? 30 * 60 * 1000;
  const now = opts.now?.() ?? new Date();
  try {
    const run = opts.run ?? (await defaultDockerRun());
    const project = opts.project;
    if (project !== undefined && !/^[a-z0-9][a-z0-9_-]{0,99}$/.test(project)) return null;
    const { stdout } = await run(
      "docker",
      ["ps", "--all", "--no-trunc", "--filter", "name=dpf-promoter-",
        ...(project ? ["--filter", `label=dpf.promoter-project=${project}`] : []), "--format",
        '{{.ID}}\t{{.Names}}\t{{.CreatedAt}}\t{{.State}}\t{{.Label "dpf.promoter-owner"}}\t{{.Label "dpf.promoter-binding"}}\t{{.Label "dpf.promoter-project"}}'],
      { timeout: 15_000 },
    );
    let removed = 0;
    for (const line of stdout.split("\n")) {
      const [id, name, createdAt, state, owner, binding, installedProject] = line.split("\t");
      if (!/^[a-f0-9]{64}$/.test(id) || !/^dpf-promoter-[A-Za-z0-9-]+$/.test(name)) continue;
      if (project && (project !== installedProject || !owner || !binding)) continue;
      if (!isPromoterContainerStale(createdAt ?? "", now, maxAgeMs)) continue;
      try {
        const remove = async () => { await run("docker", ["rm", "-f", id], { timeout: 15_000 }); };
        if (owner || binding) {
          if (!/^(?:SUR|RCT)-[A-Za-z0-9-]{1,100}$/.test(owner ?? "") || !/^[a-f0-9]{64}$/.test(binding ?? "")
            || !await (opts.underSettledOwner ?? underSettledPromoterOwner)(owner, remove)) continue;
        } else if (state === "running") {
          await remove();
        } else continue;
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
/**
 * Force-remove any `dpf-promoter-*` container older than `maxAgeMs` — well past
 * both runPromoter's self-timeout and a normal ~7-min swap, so a legitimately
 * in-flight promoter is never touched. Non-fatal; never throws.
 */
export async function sweepLegacyPromoterContainers(
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

/** The sweep for this install: the actuator's owner-settled sweep when it is
 * mounted (fail closed: an unreadable mount table counts as mounted), else the
 * original legacy sweep. An injected runner always means the legacy sweep. */
export async function sweepOrphanedPromoterContainers(opts: Parameters<typeof sweepLegacyPromoterContainers>[0] = {},
  logger: Pick<Console, "log" | "error"> = console): Promise<{ removed: number } | null> {
  if (!opts.run && await usesPrivateActuator()) {
    try { return await reconcileActuatorPromoters(); }
    catch (error) { logger.error("[promoter-sweep] private actuator unavailable:", error); return null; }
  }
  return sweepLegacyPromoterContainers(opts, logger);
}
