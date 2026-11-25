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
// Only the self-upgrade owner is accepted here so far; runtime-capability
// launches still run on the legacy recipe until their host context is bound.

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
};

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
  "maintenanceRecoveryPointDigest", "installStateMigrationHandoff", "containerName", "timeoutMs", "hostIdentity",
]);

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
  };
}

/** Strictly parse and bind a self-upgrade launch. Every host-facing field must
 * equal the value the actuator derives for itself. */
export function admitSelfUpgradeLaunch(value: unknown, binding: PromoterInstallBinding,
  config: Pick<SelfUpgradeConfig, "hostInstallPath" | "useIsolatedWorkspace" | "upgradeWorkspaceHostPath" | "composeProject" | "composeFiles" | "healthUrl">,
): { owner: Extract<PromoterLaunchOwner, { kind: "self-upgrade" }>; params: PromoterParams } {
  if (!isRecord(value) || Object.keys(value).length !== 2 || !isRecord(value.owner) || !isRecord(value.params)) return refuse();
  const owner = value.owner, params = value.params;
  if (Object.keys(owner).length !== 2 || owner.kind !== "self-upgrade" || typeof owner.runId !== "string" || !RUN_ID.test(owner.runId)) refuse();
  const runId = owner.runId as string;
  if (Object.keys(params).some((key) => !ALLOWED_KEYS.has(key))) refuse();

  const canonical = config.hostInstallPath ?? binding.installPath;
  const workspace = config.useIsolatedWorkspace
    ? config.upgradeWorkspaceHostPath ?? `${trimSlash(canonical)}/.upgrade-workspace` : undefined;
  const backupHostPath = binding.backupsHostPath ?? `${trimSlash(canonical)}/backups`;
  const composeProject = config.composeProject ?? binding.project;
  const composeFiles = config.composeFiles ?? binding.composeFiles;
  const healthUrl = config.healthUrl ?? binding.healthUrl ?? "";

  if (composeProject !== binding.project || params.composeProject !== binding.project
    || params.canonicalInstallPath !== canonical || params.hostInstallPath !== (workspace ?? canonical)
    || params.backupHostPath !== backupHostPath
    || params.composeEnvFileHostPath !== `${trimSlash(canonical)}/.env`
    || params.backupPath !== (binding.backupPathOverride ?? `/backups/self-upgrade/${runId}`)
    || (params.stateDirHostPath ?? undefined) !== binding.stateDirHostPath
    || params.healthUrl !== healthUrl
    || params.containerName !== `dpf-promoter-${runId}`
    || params.installStateMigrationRunId !== runId
    || params.dryRun === true
    || typeof params.targetSha !== "string" || !SHA.test(params.targetSha)
    || typeof params.promoterImage !== "string" || !IMAGE_ID.test(params.promoterImage)
    || typeof params.maintenanceRecoveryPointDigest !== "string" || !HEX64.test(params.maintenanceRecoveryPointDigest)
    || typeof params.installStateMigrationEnvelope !== "string" || !ENVELOPE.test(params.installStateMigrationEnvelope)
    || typeof params.installStateMigrationSignature !== "string" || !HEX64.test(params.installStateMigrationSignature)
    || (params.timeoutMs !== undefined && (typeof params.timeoutMs !== "number" || params.timeoutMs <= 0 || params.timeoutMs > 60 * 60_000))) refuse();
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
  return { owner: { kind: "self-upgrade", runId }, params: params as unknown as PromoterParams };
}

const tail = (value: string) => {
  const bytes = Buffer.from(value);
  return bytes.length > RESULT_STREAM_BYTES ? `…${bytes.subarray(-RESULT_STREAM_BYTES).toString("utf8")}` : value;
};

/** Actuator side. A refused or malformed request never reaches Docker. */
export async function launchPromoterAtActuator(value: unknown, deps: {
  binding: PromoterInstallBinding;
  readConfig: () => Promise<SelfUpgradeConfig>;
  launch: (params: PromoterParams, owner: PromoterLaunchOwner) => Promise<PromoterResult>;
}): Promise<PromoterResult> {
  if (Buffer.byteLength(JSON.stringify(value ?? null)) > MAX_REQUEST_BYTES) refuse();
  const { owner, params } = admitSelfUpgradeLaunch(value, deps.binding, await deps.readConfig());
  const result = await deps.launch({ ...params, launchOwner: owner }, owner);
  return { exitCode: result.exitCode, stdout: tail(result.stdout), stderr: tail(result.stderr) };
}

/** Portal side. A lost or refused reply keeps the owner pending: the launch is
 * idempotent by name and binding, and the run watchdog settles a stuck run. */
export async function requestPromoterLaunchThroughActuator(params: PromoterParams, owner: PromoterLaunchOwner,
  request: (body: unknown, timeoutMs: number) => Promise<unknown>): Promise<PromoterResult> {
  const pending: PromoterResult = {
    exitCode: owner.kind === "runtime-capability" ? 75 : PROMOTER_ALREADY_RUNNING_EXIT_CODE,
    stdout: "",
    stderr: "The private actuator did not confirm the promoter launch; the run stays pending until its owner settles it.",
  };
  if (owner.kind !== "self-upgrade") return pending;
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
 * mounted, an admitted self-upgrade launch goes to it; null keeps the legacy
 * path. The actuator itself calls runAdmittedPromoter directly, never this. */
export async function launchThroughPrivateActuator(params: PromoterParams): Promise<PromoterResult | null> {
  if (params.launchOwner?.kind !== "self-upgrade") return null;
  const observation = await import("../../../../scripts/lib/scope-writer-observation.mjs");
  if (!await observation.usesPrivateActuator()) return null;
  return requestPromoterLaunchThroughActuator(params, params.launchOwner,
    (body, timeoutMs) => observation.launchActuatorPromoter(body, { timeoutMs }));
}
