import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import type { ReadinessOwner, VerifiedReleaseIdentity } from "./promoter";
import { signTransitionPayload } from "@/lib/platform-runtime/transition-protocol";
import { verifyInstallStateMigrationEnvelope } from "../../../../scripts/lib/transition-signing.mjs";
import { resolveSelfUpgradeHostIdentity, type SelfUpgradeHostIdentity } from "./config";

type EmitFailure = (runId: string) => Promise<unknown>;

type PromoterRuntime = Pick<
  typeof import("./promoter"),
  "buildCandidatePromoterImage" | "resolvePromoterArtifact" | "runPromoterReadiness"
>;
type RecordReadiness = typeof import("./run-store").recordPromoterReadiness;
type FailRun = typeof import("./run-store").failRun;
type ReadinessFailure = { code: string; message: string; remediation?: string };

export type CandidatePreflightResult =
  | { ok: true; resolvedPromoterDigest?: string; migrationHandoff?: InstallStateMigrationHandoff }
  | { ok: false; reason: "promoter-readiness-failed" | "installer-state-repair-required" };

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
  /** Published immutable release promoter; bypasses source compilation. */
  candidatePromoterReference?: string;
  /** Verified release identity carried into candidate readiness. */
  release?: VerifiedReleaseIdentity;
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
      result: "unavailable",
      baselineSha: params.baselineSha ?? undefined, targetSha: params.targetSha,
      startedAt: new Date().toISOString(), completedAt: new Date().toISOString(),
      quiescenceBegan: false, failures: [{ code: "installer_state_repair_required", message: "Legacy bootstrap cannot produce the signed install-state migration handoff required before quiescence." }],
    });
    await params.failRun(params.runId, "installer-state-repair-required: legacy bootstrap cannot produce a signed install-state migration handoff");
    await params.emitFailure(params.runId);
    return { ok: false, reason: "installer-state-repair-required" };
  }

  const runtime = await params.runtime();
  const startedAt = new Date().toISOString();
  try {
    const image = params.candidatePromoterReference ?? await runtime.buildCandidatePromoterImage({
      sourcePath: params.sourcePath, targetSha: params.targetSha, promoterImage: params.promoterImage,
    });
    const artifact = await runtime.resolvePromoterArtifact({
      promoterImage: image,
      candidateReference: params.candidatePromoterReference,
      targetSha: params.targetSha,
      callerProtocol: params.callerProtocolVersion,
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
      hostIdentity: params.hostIdentity,
      release: params.release,
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
      verifyInstallStateMigrationEnvelope(envelope, migrationHandoff.signature, params.runtimeTransitionSecret, {
        runId: params.runId, promoterDigest: artifact.digest, sourceHash: envelope.sourceHash,
        hostIdentity: params.hostIdentity, now: now.getTime(),
      });
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

export type InstallStateSigningContext =
  | { ok: true; runtimeTransitionSecret: string | undefined; hostIdentity: SelfUpgradeHostIdentity | undefined }
  | { ok: false; reason: string };

/**
 * Load the runtime-transition secret + host identity the swap must sign the
 * install-state migration handoff with. dryRun carries no signing context. On
 * any read/parse failure it records the run failed and returns a repair reason —
 * the orchestrator just returns it. Extracted from the self-upgrade orchestrator
 * to keep this install-state concern beside the signing/verify logic it feeds.
 */
export async function loadInstallStateSigningContext(params: {
  dryRun?: boolean;
  runId: string;
  failRun: FailRun;
  emitFailure: EmitFailure;
}): Promise<InstallStateSigningContext> {
  if (params.dryRun) return { ok: true, runtimeTransitionSecret: undefined, hostIdentity: undefined };
  try {
    const installStateBytes = await readFile("/dpf-state/install-state.json", "utf8");
    const runtimeTransitionSecret = (await readFile("/dpf-state/runtime-transition.secret", "utf8")).trim();
    if (!runtimeTransitionSecret) throw new Error("runtime_transition_secret_empty");
    const hostIdentity = resolveSelfUpgradeHostIdentity(process.env, JSON.parse(installStateBytes.replace(/^\uFEFF/, "")));
    return { ok: true, runtimeTransitionSecret, hostIdentity };
  } catch (error) {
    const reason = `installer-state-repair-required: ${error instanceof Error ? error.message : "install_state_preparation_failed"}`;
    await params.failRun(params.runId, reason);
    await params.emitFailure(params.runId);
    return { ok: false, reason };
  }
}

/**
 * Re-verify the signed migration handoff against the CURRENT install-state hash
 * immediately before the swap (the state may have moved since preflight signed
 * it). On failure it records the run failed and returns a repair reason.
 */
export async function verifyMigrationHandoff(params: {
  dryRun?: boolean;
  runId: string;
  migrationHandoff?: InstallStateMigrationHandoff;
  resolvedPromoterDigest?: string;
  runtimeTransitionSecret?: string;
  hostIdentity?: SelfUpgradeHostIdentity;
  failRun: FailRun;
  emitFailure: EmitFailure;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (params.dryRun) return { ok: true };
  try {
    if (!params.migrationHandoff || !params.resolvedPromoterDigest || !params.runtimeTransitionSecret || !params.hostIdentity) {
      throw new Error("install_state_migration_handoff_missing");
    }
    const currentStateBytes = await readFile("/dpf-state/install-state.json", "utf8");
    verifyInstallStateMigrationEnvelope(params.migrationHandoff.envelope, params.migrationHandoff.signature, params.runtimeTransitionSecret, {
      runId: params.runId, promoterDigest: params.resolvedPromoterDigest,
      sourceHash: createHash("sha256").update(currentStateBytes).digest("hex"), hostIdentity: params.hostIdentity, now: Date.now(),
    });
    return { ok: true };
  } catch (error) {
    const reason = `installer-state-repair-required: ${error instanceof Error ? error.message : "install_state_migration_handoff_invalid"}`;
    await params.failRun(params.runId, reason);
    await params.emitFailure(params.runId);
    return { ok: false, reason };
  }
}
