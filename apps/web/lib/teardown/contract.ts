export const TEARDOWN_SCOPES = ["containers", "volumes", "source", "everything"] as const;
export type TeardownScope = (typeof TEARDOWN_SCOPES)[number];

export type TeardownStage =
  | "planned"
  | "salvaging"
  | "stopping"
  | "deleting-volumes"
  | "deleting-source"
  | "completed";

export interface TeardownRecoveryReceipt {
  backupRunId: string;
  backupSha256: string | null;
  trialRestoreId: string;
  trialStatus: "ok" | "failed";
}

export type TeardownConfirmation =
  | { mode: "non-destructive" }
  | { mode: "pointer-hold"; challengeId: string; heldForMs: number };

export interface TeardownEnvelope {
  schemaVersion: 1;
  kind: "installation-teardown";
  runId: string;
  issuedAt: string;
  expiresAt: string;
  scope: TeardownScope;
  actorRef: string;
  installPath: string;
  backupsPath: string;
  composeProject: string;
  composeFiles: string[];
  previewDigest: string;
  salvageDigest: string;
  recovery: TeardownRecoveryReceipt | null;
  confirmation: TeardownConfirmation;
}

export type TeardownValidationResult =
  | { valid: true }
  | { valid: false; code: string };

const SHA256 = /^[a-f0-9]{64}$/;
const RUN_ID = /^TDR-[A-Z0-9]{8,32}$/;
const PROJECT = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const RELATIVE_COMPOSE_FILE = /^[A-Za-z0-9._/-]+$/;
const MAX_PLAN_TTL_MS = 5 * 60_000;
export const MIN_HOLD_MS = 2_000;

export function isDestructiveScope(scope: TeardownScope): boolean {
  return scope !== "containers";
}

export function scopeDeletesVolumes(scope: TeardownScope): boolean {
  return scope === "volumes" || scope === "everything";
}

export function scopeDeletesSource(scope: TeardownScope): boolean {
  return scope === "source" || scope === "everything";
}

export function buildTeardownStages(scope: TeardownScope): TeardownStage[] {
  return [
    "planned",
    ...(scopeDeletesSource(scope) ? (["salvaging"] as const) : []),
    "stopping",
    ...(scopeDeletesVolumes(scope) ? (["deleting-volumes"] as const) : []),
    ...(scopeDeletesSource(scope) ? (["deleting-source"] as const) : []),
    "completed",
  ];
}

function pathStyle(value: string): "windows" | "posix" | null {
  if (/^[A-Za-z]:[\\/]/.test(value)) return "windows";
  if (value.startsWith("/")) return "posix";
  return null;
}

function normalizePath(value: string): { style: "windows" | "posix"; value: string } | null {
  const style = pathStyle(value);
  if (!style || /[\0\r\n]/.test(value)) return null;
  let normalized = value.replaceAll("\\", "/").replace(/\/{2,}/g, "/");
  if (style === "windows") normalized = normalized.toLowerCase();
  normalized = normalized.length > 1 ? normalized.replace(/\/$/, "") : normalized;
  const body = style === "windows" ? normalized.slice(3) : normalized.slice(1);
  if (!body || body.split("/").some((part) => part === ".." || part === ".")) return null;
  return { style, value: normalized };
}

function isUnsafeDeletionRoot(path: { style: "windows" | "posix"; value: string }): boolean {
  if (path.style === "posix") {
    if (["/etc", "/home", "/opt", "/root", "/srv", "/tmp", "/usr", "/users", "/var"].includes(path.value.toLowerCase())) return true;
    return /^\/(?:home|users)\/[^/]+$/i.test(path.value);
  }
  return /^[a-z]:\/(?:documents and settings|program files(?: \(x86\))?|programdata|users|windows)$/i.test(path.value) ||
    /^[a-z]:\/(?:documents and settings|users)\/[^/]+$/i.test(path.value);
}

/** True when child equals parent or is a path-segment descendant of it. */
export function isNestedPath(parent: string, child: string): boolean {
  const normalizedParent = normalizePath(parent);
  const normalizedChild = normalizePath(child);
  if (!normalizedParent || !normalizedChild || normalizedParent.style !== normalizedChild.style) return false;
  return normalizedChild.value === normalizedParent.value || normalizedChild.value.startsWith(`${normalizedParent.value}/`);
}

function validComposeFiles(files: unknown): files is string[] {
  return Array.isArray(files) && files.length > 0 && files.length <= 12 && files.every((file) =>
    typeof file === "string" &&
    file.length <= 160 &&
    RELATIVE_COMPOSE_FILE.test(file) &&
    !file.startsWith("/") &&
    !/^[A-Za-z]:/.test(file) &&
    !file.split("/").includes(".."),
  );
}

export function validateTeardownEnvelope(
  envelope: TeardownEnvelope,
  nowMs = Date.now(),
): TeardownValidationResult {
  if (envelope?.schemaVersion !== 1 || envelope.kind !== "installation-teardown") return { valid: false, code: "teardown_plan_schema_invalid" };
  if (!RUN_ID.test(envelope.runId)) return { valid: false, code: "teardown_run_id_invalid" };
  if (!(TEARDOWN_SCOPES as readonly string[]).includes(envelope.scope)) return { valid: false, code: "teardown_scope_invalid" };
  const issuedAt = Date.parse(envelope.issuedAt);
  const expiresAt = Date.parse(envelope.expiresAt);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= issuedAt) return { valid: false, code: "teardown_plan_time_invalid" };
  if (expiresAt - issuedAt > MAX_PLAN_TTL_MS) return { valid: false, code: "teardown_plan_ttl_exceeded" };
  if (nowMs > expiresAt) return { valid: false, code: "teardown_plan_expired" };
  if (issuedAt - nowMs > 30_000) return { valid: false, code: "teardown_plan_not_yet_valid" };
  if (!envelope.actorRef?.trim() || envelope.actorRef.length > 200) return { valid: false, code: "teardown_actor_invalid" };
  const installPath = normalizePath(envelope.installPath);
  if (!installPath || !normalizePath(envelope.backupsPath)) return { valid: false, code: "teardown_host_path_invalid" };
  if (isUnsafeDeletionRoot(installPath)) return { valid: false, code: "teardown_host_path_unsafe" };
  if (!PROJECT.test(envelope.composeProject)) return { valid: false, code: "teardown_compose_project_invalid" };
  if (!validComposeFiles(envelope.composeFiles)) return { valid: false, code: "teardown_compose_files_invalid" };
  if (!SHA256.test(envelope.previewDigest) || !SHA256.test(envelope.salvageDigest)) return { valid: false, code: "teardown_digest_invalid" };
  if (scopeDeletesSource(envelope.scope) && isNestedPath(envelope.installPath, envelope.backupsPath)) return { valid: false, code: "teardown_evidence_inside_source" };

  if (scopeDeletesVolumes(envelope.scope)) {
    const recovery = envelope.recovery;
    if (!recovery || recovery.trialStatus !== "ok" || !recovery.backupRunId || !recovery.trialRestoreId || !recovery.backupSha256 || !SHA256.test(recovery.backupSha256)) {
      return { valid: false, code: "teardown_recovery_unverified" };
    }
  }
  if (isDestructiveScope(envelope.scope)) {
    if (envelope.confirmation.mode !== "pointer-hold" || !envelope.confirmation.challengeId || envelope.confirmation.heldForMs < MIN_HOLD_MS) {
      return { valid: false, code: "teardown_human_confirmation_missing" };
    }
  } else if (envelope.confirmation.mode !== "non-destructive") {
    return { valid: false, code: "teardown_confirmation_invalid" };
  }
  return { valid: true };
}
