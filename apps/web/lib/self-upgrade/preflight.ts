import { getErrorMessage } from "@/lib/shared/get-error-message";
import type { ReadinessOwner } from "./promoter";
import { signTransitionPayload } from "@/lib/platform-runtime/transition-protocol";
import type { SelfUpgradeHostIdentity } from "./config";

type PromoterRuntime = Pick<
  typeof import("./promoter"),
  "buildCandidatePromoterImage" | "resolvePromoterArtifact" | "runPromoterReadiness"
>;
type RecordReadiness = typeof import("./run-store").recordPromoterReadiness;
type FailRun = typeof import("./run-store").failRun;
type ReadinessFailure = { code: string; message: string; remediation?: string };

export type CandidatePreflightResult =
  | { ok: true; resolvedPromoterDigest?: string; migrationHandoff?: InstallStateMigrationHandoff }
  | { ok: false; reason: "promoter-readiness-failed" };

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
  hostIdentity?: SelfUpgradeHostIdentity;
  runtimeTransitionSecret?: string;
  now?: () => Date;
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
      backupHostPath: process.env.DPF_BACKUPS_HOST_PATH ?? undefined,
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
      hostIdentity: params.hostIdentity,
    });
    let failures: ReadinessFailure[] = [];
    let report: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(readiness.stdout) as { failures?: ReadinessFailure[] } & Record<string, unknown>;
      report = parsed;
      if (Array.isArray(parsed.failures)) failures = parsed.failures;
    } catch {
      if (readiness.exitCode !== 0) failures = [{ code: "readiness_report_invalid", message: "Promoter readiness returned an invalid report." }];
    }
    const ready = readiness.exitCode === 0;
    let migrationHandoff: InstallStateMigrationHandoff | undefined;
    if (ready) {
      if (!params.hostIdentity || !params.runtimeTransitionSecret) throw new Error("install_state_signing_context_missing");
      const now = params.now?.() ?? new Date();
      const envelope: InstallStateMigrationEnvelope = {
        version: 1, kind: "install-state-migration", runId: params.runId,
        issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
        sourceHash: requireHash(report.sourceHash, "source_hash_missing"),
        projectionHash: requireHash(report.projectionHash, "projection_hash_missing"),
        fromSchemaVersion: requireVersion(report.fromSchemaVersion), toSchemaVersion: requireVersion(report.toSchemaVersion),
        hostIdentity: params.hostIdentity, promoterDigest: artifact.digest,
      };
      migrationHandoff = { envelope, signature: signTransitionPayload(envelope, params.runtimeTransitionSecret) };
    }
    await params.recordReadiness(params.runId, {
      stage: "preflight", owner: "portal", mode: "enforced", result: ready ? "ready" : "failed",
      baselineSha: params.baselineSha ?? undefined, targetSha: params.targetSha, imageDigest: artifact.digest,
      contractVersion: artifact.contractSchema, contractDigest: artifact.contractDigest,
      startedAt, completedAt: new Date().toISOString(), quiescenceBegan: false, failures, migrationHandoff,
    } as Parameters<RecordReadiness>[1]);
    if (!ready) {
      await params.failRun(params.runId, `promoter-readiness-failed: ${failures[0]?.message ?? "Promoter readiness failed."}`);
      await params.emitFailure(params.runId);
      return { ok: false, reason: "promoter-readiness-failed" };
    }
    return { ok: true, resolvedPromoterDigest: artifact.digest, migrationHandoff };
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

export type InstallStateMigrationEnvelope = {
  version: 1; kind: "install-state-migration"; runId: string; issuedAt: string; expiresAt: string;
  sourceHash: string; projectionHash: string; fromSchemaVersion: number; toSchemaVersion: number;
  hostIdentity: SelfUpgradeHostIdentity; promoterDigest: string;
};
export type InstallStateMigrationHandoff = { envelope: InstallStateMigrationEnvelope; signature: string };
function requireHash(value: unknown, error: string): string { if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error(error); return value; }
function requireVersion(value: unknown): number { if (!Number.isInteger(value) || (value as number) < 1) throw new Error("schema_version_missing"); return value as number; }
