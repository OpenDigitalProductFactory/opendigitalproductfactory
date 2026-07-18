import { getErrorMessage } from "@/lib/shared/get-error-message";
import type { ReadinessOwner } from "./promoter";

type PromoterRuntime = Pick<
  typeof import("./promoter"),
  "buildCandidatePromoterImage" | "resolvePromoterArtifact" | "runPromoterReadiness"
>;
type RecordReadiness = typeof import("./run-store").recordPromoterReadiness;
type FailRun = typeof import("./run-store").failRun;
type ReadinessFailure = { code: string; message: string; remediation?: string };

export type CandidatePreflightResult =
  | { ok: true; resolvedPromoterDigest?: string }
  | { ok: false; reason: "promoter-readiness-failed" };

/**
 * Resolve the host path bound to /backups in the readiness container, mirroring
 * the compose-level default `${DPF_BACKUPS_HOST_PATH:-${DPF_HOST_INSTALL_PATH}/backups}`.
 * DPF_BACKUPS_HOST_PATH ships EMPTY by design (compose fills the default), so an
 * empty/whitespace value must be treated as unset — a plain `?? undefined` only
 * catches undefined and leaks "" through, which skips the /backups mount and makes
 * the readiness preflight fail `recovery_parent_unavailable`. BI-E2625B79.
 */
export function resolveReadinessBackupHostPath(
  backupsHostPathEnv: string | undefined,
  canonicalInstallPath: string,
): string | undefined {
  const explicit = backupsHostPathEnv?.trim();
  if (explicit) return explicit;
  const root = canonicalInstallPath.replace(/\/$/, "");
  return root ? `${root}/backups` : undefined;
}

export async function runCandidatePreflight(params: {
  dryRun?: boolean;
  readinessMode?: string;
  readinessOwner?: ReadinessOwner;
  promoterImage?: string;
  callerProtocolVersion?: number;
  sourcePath: string;
  hostInstallPath: string;
  canonicalInstallPath: string;
  targetSha: string;
  baselineSha?: string | null;
  runId: string;
  composeFiles: string[];
  composeProject?: string;
  healthUrl: string;
  runtime: () => Promise<PromoterRuntime>;
  recordReadiness: RecordReadiness;
  failRun: FailRun;
  emitFailure: (runId: string) => Promise<unknown>;
}): Promise<CandidatePreflightResult> {
  if (params.dryRun) return { ok: true };
  if (params.readinessMode === "legacy-bootstrap") {
    await params.recordReadiness(params.runId, {
      stage: "preflight", owner: params.readinessOwner ?? "unavailable", mode: "legacy-bootstrap",
      result: params.readinessOwner === "bridge" ? "ready" : "unavailable",
      baselineSha: params.baselineSha ?? undefined, targetSha: params.targetSha,
      startedAt: new Date().toISOString(), completedAt: new Date().toISOString(),
      quiescenceBegan: false, failures: [],
    });
    return { ok: true };
  }

  const runtime = await params.runtime();
  const startedAt = new Date().toISOString();
  try {
    const image = await runtime.buildCandidatePromoterImage({
      sourcePath: params.sourcePath, targetSha: params.targetSha, promoterImage: params.promoterImage,
    });
    const artifact = await runtime.resolvePromoterArtifact({
      promoterImage: image, targetSha: params.targetSha, callerProtocol: params.callerProtocolVersion,
    });
    const readiness = await runtime.runPromoterReadiness({
      hostInstallPath: params.hostInstallPath,
      targetSha: params.targetSha,
      backupPath: process.env.PROMOTE_BACKUP_PATH ?? `/backups/self-upgrade/${params.runId}`,
      backupHostPath: resolveReadinessBackupHostPath(process.env.DPF_BACKUPS_HOST_PATH, params.canonicalInstallPath),
      composeEnvFileHostPath: params.canonicalInstallPath
        ? `${params.canonicalInstallPath.replace(/\/$/, "")}/.env`
        : undefined,
      composeFiles: params.composeFiles,
      composeProject: params.composeProject,
      healthUrl: params.healthUrl,
      promoterImage: artifact.digest,
      stateDirHostPath: process.env.DPF_STATE_DIR_HOST,
      containerName: `dpf-promoter-readiness-${params.runId}`,
      artifact,
    });
    let failures: ReadinessFailure[] = [];
    try {
      const parsed = JSON.parse(readiness.stdout) as { failures?: ReadinessFailure[] };
      if (Array.isArray(parsed.failures)) failures = parsed.failures;
    } catch {
      if (readiness.exitCode !== 0) failures = [{ code: "readiness_report_invalid", message: "Promoter readiness returned an invalid report." }];
    }
    const ready = readiness.exitCode === 0;
    await params.recordReadiness(params.runId, {
      stage: "preflight", owner: "portal", mode: "enforced", result: ready ? "ready" : "failed",
      baselineSha: params.baselineSha ?? undefined, targetSha: params.targetSha, imageDigest: artifact.digest,
      contractVersion: artifact.contractSchema, contractDigest: artifact.contractDigest,
      startedAt, completedAt: new Date().toISOString(), quiescenceBegan: false, failures,
    });
    if (!ready) {
      await params.failRun(params.runId, `promoter-readiness-failed: ${failures[0]?.message ?? "Promoter readiness failed."}`);
      await params.emitFailure(params.runId);
      return { ok: false, reason: "promoter-readiness-failed" };
    }
    return { ok: true, resolvedPromoterDigest: artifact.digest };
  } catch (error) {
    const message = getErrorMessage(error);
    await params.recordReadiness(params.runId, {
      stage: "preflight", owner: "portal", mode: "enforced", result: "failed",
      baselineSha: params.baselineSha ?? undefined, targetSha: params.targetSha,
      startedAt, completedAt: new Date().toISOString(), quiescenceBegan: false,
      failures: [{ code: "artifact_resolution_failed", message }],
    });
    await params.failRun(params.runId, `promoter-readiness-failed: ${message}`);
    await params.emitFailure(params.runId);
    return { ok: false, reason: "promoter-readiness-failed" };
  }
}
