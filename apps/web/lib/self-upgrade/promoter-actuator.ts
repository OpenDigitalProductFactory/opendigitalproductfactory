// Admitted promoter launches through the private actuator (BI-224F56F1).
//
// The immutable portal has no Docker socket. For a launch that changes the
// live runtime, the portal sends its owner and promoter parameters to the
// actuator. The actuator never trusts the host-facing fields it receives: it
// re-derives project, install, backup, state and Compose inputs from its own
// installation binding (the install's Compose interpolation) and the stored
// self-upgrade configuration, and refuses any difference. It then calls the
// existing admitted launch, which re-reads the owner row under the canonical
// admission lock before the exact-ID start.
//
// Runtime-capability actions (apply, rollback and the host authority
// reserve/release/reconcile/rotate operations) are bound the same way: their
// host context must equal one the actuator derives from the install, and
// reconciliation uses the actuator's own view of active transitions.

import type { SelfUpgradeConfig } from "./config";
import type { PromoterLaunchOwner } from "./promoter-launch";
import type { PromoterParams, PromoterResult } from "./promoter";
import { PROMOTER_ALREADY_RUNNING_EXIT_CODE } from "./promoter-exit-codes";
import { resolvePromoterTimeoutMs } from "./promoter-timeout";
import { isRecord } from "@/lib/shared/coerce";

export type PromoterInstallBinding = {
  project: string;
  installPath: string;
  stateDirHostPath?: string;
  backupsHostPath?: string;
  backupPathOverride?: string;
  composeFiles?: string[];
  healthUrl?: string;
  transitionSecretFileHostPath?: string;
  appUrl?: string;
};

/** Host context fields a runtime-transition promoter receives. */
export type RuntimeHostContext = Pick<PromoterParams, "hostInstallPath" | "composeFiles" | "composeProject" | "composeEnvFileHostPath" | "hostIdentity"> & { stateDirHostPath: string };

const refuse = (): never => { throw new Error("promoter_actuator_admission_refused"); };
const PROJECT = /^[a-z0-9][a-z0-9_-]{0,99}$/;
const RUN_ID = /^SUR-[A-Za-z0-9-]{1,100}$/;
// prepare-source stamps a local working tree as HEAD plus "-dirty".
const SHA = /^[a-f0-9]{40}(?:-dirty)?$/;
const HEX64 = /^[a-f0-9]{64}$/;
const IMAGE_ID = /^sha256:[a-f0-9]{64}$/;
const ENVELOPE = /^[A-Za-z0-9_-]{16,65536}$/;
const COMPOSE_FILE = /^docker-compose(?:\.[a-z0-9-]{1,40})?\.yml$/;
const MAX_REQUEST_BYTES = 256 * 1024;
const RESULT_STREAM_BYTES = 256 * 1024;

const ALLOWED_KEYS = new Set([
  "hostInstallPath", "canonicalInstallPath", "targetSha", "backupPath", "backupHostPath", "composeEnvFileHostPath",
  "composeFiles", "composeProject", "healthUrl", "promoterImage", "release", "stateDirHostPath", "dryRun",
  "installStateMigrationEnvelope", "installStateMigrationSignature", "installStateMigrationRunId",
  "maintenanceRecoveryPointDigest", "installStateMigrationHandoff", "containerName", "timeoutMs", "hostIdentity", "phase",
]);

/** Self-upgrade promoter stages, each with its own fixed container and inputs. */
export type SelfUpgradeStage = "swap" | "prebuild" | "readiness";
const STAGES = new Set<SelfUpgradeStage>(["swap", "prebuild", "readiness"]);
const MIGRATION_KEYS = ["installStateMigrationEnvelope", "installStateMigrationSignature", "installStateMigrationRunId",
  "maintenanceRecoveryPointDigest", "installStateMigrationHandoff"] as const;

function safeHostPath(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 2 || value.length > 1024 || /[\0\r\n]/.test(value)) return false;
  const normalized = value.replaceAll("\\", "/");
  const body = normalized.startsWith("/") ? normalized.slice(1) : /^[A-Za-z]:\//.test(normalized) ? normalized.slice(3) : "";
  return body.length > 0 && body.split("/").every((segment) => segment !== ".." && segment !== "." && /^[A-Za-z0-9._ -]+$/.test(segment));
}

const trimSlash = (path: string) => path.replace(/[\\/]$/, "");

/** The actuator's install binding comes only from its own environment, which
 * the canonical promoter renders from the install's Compose interpolation. */
export function readPromoterInstallBinding(env: Record<string, string | undefined>): PromoterInstallBinding {
  const project = env.PROMOTE_COMPOSE_PROJECT ?? "";
  const installPath = env.DPF_HOST_INSTALL_PATH || env.PROMOTE_SOURCE || "";
  if (!PROJECT.test(project) || !safeHostPath(installPath)) refuse();
  const optionalPath = (value: string | undefined) => {
    if (!value) return undefined;
    if (!safeHostPath(value)) refuse();
    return value;
  };
  const composeFiles = env.DPF_SELF_UPGRADE_COMPOSE_FILES?.split(/\s+/).filter(Boolean);
  if (composeFiles?.some((file) => !COMPOSE_FILE.test(file))) refuse();
  const backupPathOverride = env.PROMOTE_BACKUP_PATH || undefined;
  if (backupPathOverride && !/^\/backups(?:\/[A-Za-z0-9._-]+)*$/.test(backupPathOverride)) refuse();
  return {
    project,
    installPath,
    stateDirHostPath: optionalPath(env.DPF_STATE_DIR_HOST),
    backupsHostPath: optionalPath(env.DPF_BACKUPS_HOST_PATH),
    backupPathOverride,
    composeFiles: composeFiles?.length ? composeFiles : undefined,
    healthUrl: env.PROMOTE_HEALTH_URL || undefined,
    transitionSecretFileHostPath: optionalPath(env.DPF_RUNTIME_TRANSITION_SECRET_FILE_HOST),
    appUrl: env.APP_URL || undefined,
  };
}

/** Strictly parse and bind a self-upgrade launch. Every host-facing field must
 * equal the value the actuator derives for itself; each stage has a fixed
 * container name, backup path and field set. */
export function admitSelfUpgradeLaunch(value: unknown, binding: PromoterInstallBinding,
  config: Pick<SelfUpgradeConfig, "hostInstallPath" | "useIsolatedWorkspace" | "upgradeWorkspaceHostPath" | "composeProject" | "composeFiles" | "healthUrl">,
): { owner: Extract<PromoterLaunchOwner, { kind: "self-upgrade" }>; params: PromoterParams; stage: SelfUpgradeStage } {
  if (!isRecord(value) || Object.keys(value).length !== 2 || !isRecord(value.owner) || !isRecord(value.params)) return refuse();
  const owner = value.owner, params = value.params;
  const stage = (owner.stage ?? "swap") as SelfUpgradeStage;
  if (Object.keys(owner).length !== (owner.stage === undefined ? 2 : 3) || owner.kind !== "self-upgrade"
    || typeof owner.runId !== "string" || !RUN_ID.test(owner.runId) || !STAGES.has(stage)) refuse();
  const runId = owner.runId as string;
  if (Object.keys(params).some((key) => !ALLOWED_KEYS.has(key))) refuse();

  const canonical = config.hostInstallPath ?? binding.installPath;
  const workspace = config.useIsolatedWorkspace
    ? config.upgradeWorkspaceHostPath ?? `${trimSlash(canonical)}/.upgrade-workspace` : undefined;
  const backupHostPath = binding.backupsHostPath ?? `${trimSlash(canonical)}/backups`;
  const composeProject = config.composeProject ?? binding.project;
  const composeFiles = config.composeFiles ?? binding.composeFiles;
  const healthUrl = config.healthUrl ?? binding.healthUrl ?? "";
  const backupPath = binding.backupPathOverride ?? `/backups/self-upgrade/${runId}`;
  const expected: Record<SelfUpgradeStage, { container: string; backupPath: string; canonical: string | undefined; maxTimeoutMs: number }> = {
    swap: { container: `dpf-promoter-${runId}`, backupPath, canonical, maxTimeoutMs: 60 * 60_000 },
    prebuild: { container: `dpf-promoter-${runId}-prebuild`, backupPath: `${backupPath.replace(/\/$/, "")}/prebuild`, canonical, maxTimeoutMs: 4 * 60 * 60_000 },
    readiness: { container: `dpf-promoter-readiness-${runId}`, backupPath, canonical: undefined, maxTimeoutMs: 60 * 60_000 },
  };
  const rule = expected[stage];

  if (composeProject !== binding.project || params.composeProject !== binding.project
    || params.canonicalInstallPath !== rule.canonical || params.hostInstallPath !== (workspace ?? canonical)
    || params.backupHostPath !== backupHostPath
    || params.composeEnvFileHostPath !== `${trimSlash(canonical)}/.env`
    || params.backupPath !== rule.backupPath
    || (params.stateDirHostPath ?? undefined) !== binding.stateDirHostPath
    || params.healthUrl !== healthUrl
    || params.containerName !== rule.container
    || (params.phase ?? undefined) !== (stage === "prebuild" ? "build" : undefined)
    || params.dryRun === true
    || typeof params.targetSha !== "string" || !SHA.test(params.targetSha)
    || typeof params.promoterImage !== "string" || !IMAGE_ID.test(params.promoterImage)
    || (params.timeoutMs !== undefined && (typeof params.timeoutMs !== "number" || params.timeoutMs <= 0 || params.timeoutMs > rule.maxTimeoutMs))) refuse();
  if (stage === "swap") {
    // Only the swap carries the signed migration handoff and recovery point.
    if (params.installStateMigrationRunId !== runId
      || typeof params.maintenanceRecoveryPointDigest !== "string" || !HEX64.test(params.maintenanceRecoveryPointDigest)
      || typeof params.installStateMigrationEnvelope !== "string" || !ENVELOPE.test(params.installStateMigrationEnvelope)
      || typeof params.installStateMigrationSignature !== "string" || !HEX64.test(params.installStateMigrationSignature)) refuse();
  } else if (MIGRATION_KEYS.some((key) => params[key] !== undefined)) refuse();
  const files = params.composeFiles;
  if (!Array.isArray(files) || files.length > 8 || files.some((file) => typeof file !== "string" || !COMPOSE_FILE.test(file))
    || (composeFiles && JSON.stringify(files) !== JSON.stringify(composeFiles))) refuse();
  if (params.hostIdentity !== undefined) {
    const identity = params.hostIdentity;
    if (!isRecord(identity) || Object.keys(identity).length !== 3
      || !["win32", "darwin", "linux"].includes(String(identity.platform))
      || !["amd64", "arm64", "x86_64"].includes(String(identity.arch))
      || !["explicit", "install-state", "legacy-windows-paths"].includes(String(identity.provenance))) refuse();
  }
  return { owner: { kind: "self-upgrade", runId }, params: params as unknown as PromoterParams, stage };
}

const RUNTIME_ID = /^RCT-[A-Za-z0-9-]{1,48}$/;
const RUNTIME_KEYS = new Set([
  "hostInstallPath", "stateDirHostPath", "composeFiles", "composeProject", "composeEnvFileHostPath", "hostIdentity",
  "runtimeCapabilitySecretFileHostPath", "targetSha", "promoterImage", "backupPath", "healthUrl", "timeoutMs",
  "runtimeCapabilityTransitionId", "runtimeTransitionAuthorityOperation", "runtimeTransitionAuthorityToken",
  "runtimeTransitionActiveIds", "runtimeCapabilityEnvelope", "runtimeCapabilitySignature", "runtimeCapabilityProfiles", "containerName",
]);
const CONTEXT_KEYS = ["hostInstallPath", "stateDirHostPath", "composeFiles", "composeProject", "composeEnvFileHostPath", "hostIdentity"] as const;
const AUTHORITY_CONTAINER: Record<string, (id: string) => string> = {
  reserve: (id) => `dpf-promoter-authority-${id}`,
  release: (id) => `dpf-promoter-authority-release-${id}`,
  reconcile: () => "dpf-promoter-authority-reconcile",
  "rotate-secret": () => "dpf-promoter-runtime-secret-rotation",
};

/** Strictly bind a runtime-capability action or host authority operation. */
export async function admitRuntimeTransitionLaunch(value: unknown, binding: PromoterInstallBinding,
  contexts: RuntimeHostContext[], activeTransitionIds: () => Promise<string[]>): Promise<PromoterParams> {
  if (!isRecord(value) || Object.keys(value).length !== 2 || !isRecord(value.owner) || !isRecord(value.params)) return refuse();
  const owner = value.owner, params = value.params;
  if (Object.keys(params).some((key) => !RUNTIME_KEYS.has(key))) refuse();
  // The host context must equal one the actuator derived from the install;
  // only the fields the caller sent are compared, as a group.
  const sent = CONTEXT_KEYS.filter((key) => params[key] !== undefined);
  if (params.hostInstallPath !== binding.installPath || params.stateDirHostPath !== binding.stateDirHostPath
    || !contexts.some((context) => sent.every((key) => JSON.stringify(context[key]) === JSON.stringify(params[key])))) refuse();
  if (params.composeProject !== undefined && params.composeProject !== binding.project) refuse();
  if (params.runtimeCapabilitySecretFileHostPath !== undefined
    && params.runtimeCapabilitySecretFileHostPath !== binding.transitionSecretFileHostPath) refuse();
  if (params.backupPath !== "/backups/runtime-capability-transition"
    || params.healthUrl !== `${binding.appUrl ?? "http://localhost:3000"}/api/health`
    || typeof params.targetSha !== "string" || !(SHA.test(params.targetSha) || params.targetSha === "runtime-capability-transition")
    || (params.promoterImage !== undefined && (typeof params.promoterImage !== "string" || !IMAGE_ID.test(params.promoterImage)))
    || (params.timeoutMs !== undefined && (typeof params.timeoutMs !== "number" || params.timeoutMs <= 0 || params.timeoutMs > 60 * 60_000))) refuse();
  const action = params.runtimeCapabilityTransitionId;
  if (action !== undefined && (typeof action !== "string" || !RUNTIME_ID.test(action))) refuse();

  if (owner.kind === "runtime-capability" && Object.keys(owner).length === 2
    && typeof owner.transitionId === "string" && RUNTIME_ID.test(owner.transitionId)) {
    // launchDurablePromoter re-reads the row (or its compensation) and the
    // exact envelope and signature under the admission lock.
    if (!action || params.runtimeTransitionAuthorityOperation !== undefined || params.containerName !== `dpf-promoter-${action}`
      || typeof params.runtimeCapabilityEnvelope !== "string" || !ENVELOPE.test(params.runtimeCapabilityEnvelope)
      || typeof params.runtimeCapabilitySignature !== "string" || !HEX64.test(params.runtimeCapabilitySignature)) refuse();
    return { ...(params as unknown as PromoterParams), launchOwner: { kind: "runtime-capability", transitionId: owner.transitionId } };
  }
  const operation = owner.operation;
  if (owner.kind !== "runtime-authority" || Object.keys(owner).length !== 2 || typeof operation !== "string"
    || !Object.hasOwn(AUTHORITY_CONTAINER, operation) || params.runtimeTransitionAuthorityOperation !== operation
    || params.runtimeCapabilityEnvelope !== undefined || params.runtimeCapabilitySignature !== undefined) return refuse();
  const scoped = operation === "reserve" || operation === "release";
  if ((scoped ? !action : action !== undefined) || params.containerName !== AUTHORITY_CONTAINER[operation]!(String(action ?? ""))
    || (operation === "release") !== (typeof params.runtimeTransitionAuthorityToken === "string" && HEX64.test(params.runtimeTransitionAuthorityToken))
    || (operation !== "release" && params.runtimeTransitionAuthorityToken !== undefined)) refuse();
  const admitted = { ...(params as unknown as PromoterParams) };
  if (operation === "reconcile") admitted.runtimeTransitionActiveIds = await activeTransitionIds();
  else if (params.runtimeTransitionActiveIds !== undefined) refuse();
  return admitted;
}

const tail = (value: string) => {
  const bytes = Buffer.from(value);
  return bytes.length > RESULT_STREAM_BYTES ? `…${bytes.subarray(-RESULT_STREAM_BYTES).toString("utf8")}` : value;
};

/** Actuator side. A refused or malformed request never reaches Docker. */
export async function launchPromoterAtActuator(value: unknown, deps: {
  binding: PromoterInstallBinding;
  readConfig: () => Promise<SelfUpgradeConfig>;
  hostContexts: (params: Record<string, unknown>) => Promise<RuntimeHostContext[]>;
  activeTransitionIds: () => Promise<string[]>;
  run: (params: PromoterParams) => Promise<PromoterResult>;
  /** Resolves the artifact from the image itself, then runs readiness. */
  readiness?: (params: PromoterParams) => Promise<PromoterResult>;
  readRunStatus?: (runId: string) => Promise<string | null>;
}): Promise<PromoterResult> {
  if (Buffer.byteLength(JSON.stringify(value ?? null)) > MAX_REQUEST_BYTES || !isRecord(value) || !isRecord(value.owner)
    || !isRecord(value.params)) refuse();
  const request = value as { owner: Record<string, unknown>; params: Record<string, unknown> };
  let params: PromoterParams;
  if (request.owner.kind === "self-upgrade") {
    const admitted = admitSelfUpgradeLaunch(request, deps.binding, await deps.readConfig());
    if (admitted.stage === "swap") {
      // launchDurablePromoter re-reads the run under the admission lock.
      params = { ...admitted.params, launchOwner: admitted.owner };
    } else {
      if (!deps.readRunStatus || await deps.readRunStatus(admitted.owner.runId) !== "running") refuse();
      if (admitted.stage === "readiness") {
        if (!deps.readiness) refuse();
        const result = await deps.readiness!(admitted.params);
        return { exitCode: result.exitCode, stdout: tail(result.stdout), stderr: tail(result.stderr) };
      }
      params = admitted.params;
    }
  } else {
    params = await admitRuntimeTransitionLaunch(request, deps.binding, await deps.hostContexts(request.params), deps.activeTransitionIds);
  }
  const result = await deps.run(params);
  return { exitCode: result.exitCode, stdout: tail(result.stdout), stderr: tail(result.stderr) };
}

/** Portal side. A lost or refused reply keeps the owner pending: the launch is
 * idempotent by name and binding, and the run watchdog settles a stuck run. */
type ActuatorPromoterOwner = PromoterLaunchOwner | { kind: "self-upgrade"; runId: string; stage: SelfUpgradeStage }
  | { kind: "runtime-authority"; operation: string };

export async function requestPromoterLaunchThroughActuator(params: PromoterParams, owner: ActuatorPromoterOwner,
  request: (body: unknown, timeoutMs: number) => Promise<unknown>): Promise<PromoterResult> {
  const pending: PromoterResult = {
    exitCode: owner.kind === "self-upgrade" ? PROMOTER_ALREADY_RUNNING_EXIT_CODE : 75,
    stdout: "",
    stderr: "The private actuator did not confirm the promoter launch; the run stays pending until its owner settles it.",
  };
  const { launchOwner: _owner, ...rest } = params;
  void _owner;
  try {
    const result = await request({ owner, params: rest }, resolvePromoterTimeoutMs(params) + 60_000);
    if (!isRecord(result) || !Number.isInteger(result.exitCode) || typeof result.stdout !== "string" || typeof result.stderr !== "string") return pending;
    return { exitCode: result.exitCode as number, stdout: result.stdout, stderr: result.stderr };
  } catch {
    return pending;
  }
}

/** BI-224F56F1: the immutable portal has no Docker socket. With the actuator
 * mounted, admitted launches and host authority operations go to it; null
 * keeps the existing path (build, readiness and dry runs are migrated
 * separately). The actuator itself calls runPromoterAtDaemon, never this. */
type ActuatorSend = (body: unknown, timeoutMs: number) => Promise<unknown>;

export async function launchThroughPrivateActuator(params: PromoterParams,
  available?: () => Promise<boolean>, send?: ActuatorSend): Promise<PromoterResult | null> {
  if (params.dryRun) return null;
  const owner: ActuatorPromoterOwner | null = params.launchOwner && !params.runtimeTransitionAuthorityOperation
    ? params.phase === "build"
      ? params.launchOwner.kind === "self-upgrade" ? { ...params.launchOwner, stage: "prebuild" } : null
      : params.launchOwner
    : params.runtimeTransitionAuthorityOperation && params.phase !== "build"
      ? { kind: "runtime-authority", operation: params.runtimeTransitionAuthorityOperation } : null;
  if (!owner) return null;
  const observation = await import("../../../../scripts/lib/scope-writer-observation.mjs");
  if (!await (available ?? observation.usesPrivateActuator)()) return null;
  return requestPromoterLaunchThroughActuator(params, owner,
    send ?? ((body, timeoutMs) => observation.launchActuatorPromoter(body, { timeoutMs })));
}

/** Readiness runs in a promoter container keyed by its run's name. The
 * actuator re-resolves the artifact from the image; the caller's copy stays. */
export async function readinessThroughPrivateActuator(params: PromoterParams & { artifact: unknown },
  available?: () => Promise<boolean>, send?: ActuatorSend): Promise<PromoterResult | null> {
  const runId = /^dpf-promoter-readiness-(SUR-[A-Za-z0-9-]{1,100})$/.exec(params.containerName ?? "")?.[1];
  if (!runId) return null;
  const observation = await import("../../../../scripts/lib/scope-writer-observation.mjs");
  if (!await (available ?? observation.usesPrivateActuator)()) return null;
  const { artifact: _artifact, ...rest } = params;
  void _artifact;
  return requestPromoterLaunchThroughActuator(rest, { kind: "self-upgrade", runId, stage: "readiness" },
    send ?? ((body, timeoutMs) => observation.launchActuatorPromoter(body, { timeoutMs })));
}
