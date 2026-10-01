/**
 * The post-drain half of a self-upgrade: recovery point, handoff refresh,
 * promoter swap, and the run's terminal record (moved out of self-upgrade.ts
 * for BI-F9EE05E5 so it can run as its own job step after an hour-long drain).
 *
 * Everything it needs arrives as a plain-JSON {@link SelfUpgradeSwapContext}
 * built by the pre-drain step. The install-state signing secret is never part
 * of it: it is reloaded here, so it never lands in the job engine's state.
 */
import type { PromoterParams, VerifiedReleaseIdentity } from "@/lib/self-upgrade/promoter";
import { PROMOTER_ALREADY_RUNNING_EXIT_CODE } from "@/lib/self-upgrade/promoter-exit-codes";
import {
  loadInstallStateSigningContext,
  refreshMigrationHandoffAfterDrain,
  resolveReadinessBackupHostPath,
  runCandidatePreflight,
  type InstallStateMigrationHandoff,
} from "@/lib/self-upgrade/preflight";
import { isFeatureBuildDeployed } from "@/lib/self-upgrade/completion";
import { classifyBuildFailure, formatClassifiedExcerpt } from "@/lib/self-upgrade/build-failure-classifier";
import { completeRun, failRun, recordPromoterReadiness, recordRunRecoveryPoint } from "@/lib/self-upgrade/run-store";
import { clearCooldown, recordCooldown } from "@/lib/self-upgrade/cooldown";
import { emitUpgradeEvent } from "@/lib/self-upgrade/notifications";
import {
  createSelfUpgradeRecoveryPoint,
  summarizeRecoveryPointDegradation,
  summarizeRecoveryPointFailure,
} from "@/lib/self-upgrade/recovery-point";
import { failQuiescenceSwap, signalSwapComplete, signalSwapStarting } from "@/lib/self-upgrade/quiescence";
import { guardAdmissionClosedForSwap } from "@/lib/self-upgrade/drain-admission";

type PreflightParams = Parameters<typeof runCandidatePreflight>[0];

/** The plain-data part of the candidate preflight, so it can be re-run after
 *  the drain if the install-state moved (the injected functions and the signing
 *  secret are re-supplied in the swap step). */
export type SelfUpgradePreflightPlan = Omit<
  PreflightParams,
  "runtime" | "recordReadiness" | "failRun" | "emitFailure" | "hostIdentity" | "runtimeTransitionSecret" | "now" | "prePullDoctools" | "sourceLineage"
>;

export type SelfUpgradeSwapContext = {
  runId: string;
  quiescenceRunId: string | null;
  dryRun?: boolean;
  /** Operator emergency override (shipForce) — the swap guard honours it. */
  force?: boolean;
  buildId?: string;
  cooldownMinutes: number;
  builtStamp: string;
  promoter: {
    hostInstallPath: string;
    canonicalInstallPath: string;
    composeFiles?: string[];
    composeProject?: string;
    healthUrl: string;
    promoterImage?: string;
    release?: VerifiedReleaseIdentity;
  };
  preflight: SelfUpgradePreflightPlan;
  migrationHandoff?: InstallStateMigrationHandoff;
  resolvedPromoterDigest?: string;
};

async function loadPromoterRuntime() {
  return await import("@/lib/self-upgrade/promoter");
}

export async function finishSelfUpgrade(ctx: SelfUpgradeSwapContext): Promise<Record<string, unknown>> {
  const { runId, quiescenceRunId, dryRun, cooldownMinutes } = ctx;
  // Cooldowns start when the failure happens, not when the attempt began an
  // hour ago (the drain may have waited that long).
  const now = new Date();
  const emitFailure = (id: string) => emitUpgradeEvent({ type: "upgrade.failed", runId: id });

  const signingContext = await loadInstallStateSigningContext({ dryRun, runId, failRun, emitFailure });
  if (!signingContext.ok) {
    if (quiescenceRunId) await failQuiescenceSwap(quiescenceRunId, signingContext.reason);
    return { ok: false, status: "failed", runId, quiescenceRunId, reason: "installer-state-repair-required", excerpt: signingContext.reason };
  }
  const { runtimeTransitionSecret, hostIdentity } = signingContext;

  const recoveryPoint = await createSelfUpgradeRecoveryPoint({ runId, dryRun });
  await recordRunRecoveryPoint(runId, recoveryPoint);
  if (recoveryPoint.status === "degraded") {
    // A best-effort (derived-store) backup failed — derived stores rebuild
    // from source, so this does NOT block
    // the upgrade. Record it loudly for the operator audit trail and proceed.
    const note = summarizeRecoveryPointDegradation(recoveryPoint);
    if (note) console.warn(`[self-upgrade] ${runId}: ${note}`);
  }
  if (recoveryPoint.status === "failed") {
    const reason = summarizeRecoveryPointFailure(recoveryPoint);
    if (quiescenceRunId) await failQuiescenceSwap(quiescenceRunId, reason);
    await failRun(runId, reason);
    await recordCooldown(now, cooldownMinutes);
    await emitUpgradeEvent({ type: "upgrade.failed", runId, payload: { reason } });
    return { ok: false, status: "failed", runId, quiescenceRunId, reason: "recovery-point-failed", recoveryPoint, excerpt: reason };
  }

  // Signal swap-starting for audit; record the moment we cross the
  // ready-to-swap → actually-swapping boundary on the QuiescenceRun.
  // No-op when quiescenceRunId is null (dryRun path).
  if (quiescenceRunId) await signalSwapStarting(quiescenceRunId);

  // The drain and recovery point above take minutes; the handoff was verified
  // BEFORE them. Re-bind it to the bytes the promoter will actually migrate,
  // re-running readiness if a host-side writer moved the state meanwhile
  // (SUR-4758058F, BI-95DF1BFC). Fail-closed on anything that is not a
  // legitimate state move or TTL expiry.
  const preflightParams: PreflightParams = {
    ...ctx.preflight,
    runtime: loadPromoterRuntime, recordReadiness: recordPromoterReadiness, failRun, emitFailure,
    hostIdentity, runtimeTransitionSecret,
  };
  const refreshed = await refreshMigrationHandoffAfterDrain({
    dryRun, runId, migrationHandoff: ctx.migrationHandoff, resolvedPromoterDigest: ctx.resolvedPromoterDigest,
    runtimeTransitionSecret, hostIdentity, failRun, emitFailure,
    rerunPreflight: () => runCandidatePreflight(preflightParams),
  });
  if (!refreshed.ok) {
    if (quiescenceRunId) await failQuiescenceSwap(quiescenceRunId, refreshed.reason);
    await recordCooldown(now, cooldownMinutes);
    return { ok: false, status: "failed", runId, quiescenceRunId, reason: "installer-state-repair-required", excerpt: refreshed.reason };
  }
  if (refreshed.data.refreshed) console.warn(`[self-upgrade] ${runId}: install-state handoff re-bound after the drain (${refreshed.data.code})`);
  const migrationHandoff = refreshed.data.migrationHandoff;
  const resolvedPromoterDigest = refreshed.data.resolvedPromoterDigest;

  // BI-F9EE05E5: never swap with admission open. The drain may have waited an
  // hour; if anything reopened admission meanwhile (a portal restart resets
  // the level on boot), close it again and re-check before the promoter runs.
  if (quiescenceRunId) {
    const guard = await guardAdmissionClosedForSwap(quiescenceRunId, { forced: ctx.force });
    if (!guard.ok) {
      await failQuiescenceSwap(quiescenceRunId, guard.error);
      await failRun(runId, `admission-reopened-before-swap: ${guard.error}`);
      await recordCooldown(now, cooldownMinutes);
      await emitUpgradeEvent({ type: "upgrade.failed", runId });
      return { ok: false, status: "failed", runId, quiescenceRunId, reason: "admission-reopened-before-swap", excerpt: guard.error };
    }
  }

  const { hostInstallPath, canonicalInstallPath } = ctx.promoter;
  let result: { exitCode: number; stdout: string; stderr: string };
  try {
    const { runPromoter } = await loadPromoterRuntime();
    const promoterParams: PromoterParams = {
      // HOST path of the install tree, bind-mounted into the promoter container.
      // BI-A8A7CCFD — with the isolated workspace, this is the workspace HOST
      // path; the promoter mounts it at `/host-source:ro` either way.
      hostInstallPath,
      canonicalInstallPath,
      // The honest built identity from source prep; promote.sh re-derives it
      // from the tree's HEAD and cross-checks against it.
      targetSha: ctx.builtStamp,
      backupPath: process.env.PROMOTE_BACKUP_PATH ?? `/backups/self-upgrade/${runId}`,
      backupHostPath: resolveReadinessBackupHostPath(process.env.DPF_BACKUPS_HOST_PATH, canonicalInstallPath ?? ""),
      composeEnvFileHostPath: canonicalInstallPath ? `${canonicalInstallPath.replace(/\/$/, "")}/.env` : undefined,
      // The install's own platform compose chain, so an overlay is applied only
      // on the host that recorded it.
      composeFiles: ctx.promoter.composeFiles,
      composeProject: ctx.promoter.composeProject,
      healthUrl: ctx.promoter.healthUrl,
      promoterImage: resolvedPromoterDigest ?? ctx.promoter.promoterImage,
      release: ctx.promoter.release,
      stateDirHostPath: process.env.DPF_STATE_DIR_HOST,
      installStateMigrationEnvelope: migrationHandoff ? Buffer.from(JSON.stringify(migrationHandoff.envelope)).toString("base64url") : undefined,
      installStateMigrationSignature: migrationHandoff?.signature,
      installStateMigrationRunId: migrationHandoff?.envelope.runId,
      installStateMigrationHandoff: migrationHandoff,
      dryRun,
      // Deterministic name so a stalled build can be force-removed by name on
      // timeout (runPromoter) or by the watchdog backstop.
      containerName: `dpf-promoter-${runId}`,
    };
    result = await runPromoter(promoterParams);
  } catch (err) {
    // The promoter failed to even spawn (e.g. docker missing). Without this
    // catch the rejection would leave the run stuck "running" — blocking every
    // future trigger.
    const msg = err instanceof Error ? err.message : String(err);
    if (quiescenceRunId) await failQuiescenceSwap(quiescenceRunId, msg);
    await failRun(runId, `promoter-spawn-error: ${msg}`);
    await recordCooldown(now, cooldownMinutes);
    await emitUpgradeEvent({ type: "upgrade.failed", runId });
    return { ok: false, status: "failed", runId, quiescenceRunId, excerpt: msg };
  }

  if (result.exitCode === PROMOTER_ALREADY_RUNNING_EXIT_CODE) {
    // A concurrent/retried dispatch for THIS runId found a promoter already
    // building it. Leave run state untouched — the owning dispatch, and as a
    // backstop the stuck-run watchdog, finalizes the run (SUR-E2BF265E).
    return { ok: true, status: "already-in-flight", runId, quiescenceRunId, note: result.stderr.trim() };
  }

  if (result.exitCode === 0) {
    // Signal swap-complete BEFORE marking the upgrade succeeded so the
    // coordinator flips the level back to normal as fast as possible.
    if (quiescenceRunId) await signalSwapComplete(quiescenceRunId);
    await completeRun(runId);
    // A swap succeeded, so the backoff from an earlier defer/fail no longer applies.
    if (!dryRun) await clearCooldown();
    await emitUpgradeEvent({ type: "upgrade.succeeded", runId });
    const deployed = ctx.buildId ? await isFeatureBuildDeployed(ctx.buildId) : null;
    return { ok: true, status: "succeeded", runId, quiescenceRunId, deployed };
  }

  // Persist a tail of BOTH streams: with the classic builder the failing RUN
  // step's output is on stdout while compose writes only progress to stderr
  // (SUR-73668D5C persisted no pnpm output at all).
  const streamTail = (s: string) => (s.length > 4000 ? `…${s.slice(-4000)}` : s);
  const rawExcerpt =
    [
      result.stderr && `--- stderr (tail) ---\n${streamTail(result.stderr)}`,
      result.stdout && `--- stdout (tail) ---\n${streamTail(result.stdout)}`,
    ]
      .filter(Boolean)
      .join("\n") || "unknown error";
  // Classify the build-gate failure so the persisted failure leads with an
  // actionable diagnosis (BI-E4CBC7C1; spec §3.3).
  const failureClass = classifyBuildFailure({ log: `${result.stdout}\n${result.stderr}` });
  const excerpt = formatClassifiedExcerpt(failureClass, rawExcerpt);
  // Promoter failed — signal the coordinator so it flips the level back to
  // normal (critical: without this, the portal stays draining forever).
  if (quiescenceRunId) await failQuiescenceSwap(quiescenceRunId, excerpt);
  await failRun(runId, excerpt);
  await recordCooldown(now, cooldownMinutes);
  await emitUpgradeEvent({ type: "upgrade.failed", runId });
  return {
    ok: false,
    status: "failed",
    runId,
    quiescenceRunId,
    exitCode: result.exitCode,
    failureClass: failureClass.class,
    excerpt,
  };
}
