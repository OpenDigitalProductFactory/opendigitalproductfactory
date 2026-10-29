import { createHmac, timingSafeEqual } from "node:crypto";

import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { signingKey, verificationKeys } from "@/lib/auth/dedicated-signing-key";
import { err, ok, type ActionResult } from "@/lib/shared/action-result";

const FULL_SHA = /^[a-f0-9]{40}$/i;
const SHA256 = /^sha256:[a-f0-9]{64}$/i;
const QUALIFICATION_TOOLS = new Set([
  "read_source_at_version",
  "read_codebase_manifest",
  "list_patch_posture",
  "write_sandbox_file",
  "edit_sandbox_file",
  "run_sandbox_tests",
  "record_execution_evidence",
  "record_workroom_evidence",
]);

export type QualificationExecutorMode = "sandbox-build" | "workroom-host";
export type QualificationPlatform = "linux" | "win32";

type ProtocolRef = { path: string; commitSha: string; providerBlobId: string };
export type QualificationCandidateRef = {
  headSha: string;
  diffDigest: string;
  testBlobIds: string[];
  productionBytesUnchanged: true;
  reviewReceiptId: string;
};

export type QualificationExperimentBinding = {
  schemaVersion: 1;
  phase: "prepare" | "verify";
  itemId: string;
  workroomId: string;
  repositoryFullName: string;
  baseSha: string;
  headSha: string;
  protocol: ProtocolRef;
  installationId: string;
  accountablePrincipalRef: string;
  protocolReviewReceiptId: string;
  shapeKey: string;
  shapeVersion: string;
  stageKey: string;
  policyVersion: 1;
  executorMode: QualificationExecutorMode;
  requiredPlatform: QualificationPlatform;
  targetProductionBlobIds: string[];
  permittedTools: string[];
  allowedPaths: string[];
  issuedAt: string;
  expiresAt: string;
  maxStarts: 1;
  maxDurationMs: number;
  candidate?: QualificationCandidateRef;
};

export type QualificationExperimentAdmission = {
  schemaVersion: 1;
  purpose: "qualification-research-admission";
  binding: QualificationExperimentBinding;
  bindingDigest: string;
};

export type QualificationExperimentState = {
  schemaVersion: 1;
  status: "issued" | "started" | "settled";
  token: string;
  bindingDigest: string;
  startCount: 0 | 1;
  issuedAt: string;
  startedAt?: string;
  taskId?: string;
  taskRunId?: string;
  evidenceId?: string;
};

export const QUALIFICATION_EXPERIMENT_STATE_KEY = "qualificationExperimentAdmission";

export function parseQualificationExperimentState(value: unknown): QualificationExperimentState | null {
  const raw = record(value);
  const token = text(raw?.token);
  const bindingDigest = text(raw?.bindingDigest);
  const issuedAt = text(raw?.issuedAt);
  const status = raw?.status;
  const startCount = raw?.startCount;
  if (raw?.schemaVersion !== 1 || !token || !bindingDigest || !SHA256.test(bindingDigest) || !issuedAt
    || !Number.isFinite(Date.parse(issuedAt)) || (status !== "issued" && status !== "started" && status !== "settled")
    || (startCount !== 0 && startCount !== 1)) return null;
  const startedAt = text(raw?.startedAt) ?? undefined;
  const taskId = text(raw?.taskId) ?? undefined;
  const taskRunId = text(raw?.taskRunId) ?? undefined;
  const evidenceId = text(raw?.evidenceId) ?? undefined;
  if (status === "issued" && (startCount !== 0 || startedAt || taskId || taskRunId || evidenceId)) return null;
  if (status !== "issued" && (startCount !== 1 || !startedAt || !taskId)) return null;
  if (status === "settled" && !evidenceId) return null;
  return { schemaVersion: 1, status, token, bindingDigest, startCount, issuedAt,
    ...(startedAt ? { startedAt } : {}), ...(taskId ? { taskId } : {}),
    ...(taskRunId ? { taskRunId } : {}), ...(evidenceId ? { evidenceId } : {}) };
}

export function issueQualificationExperimentState(input: {
  existing: QualificationExperimentState | null;
  token: string;
  binding: QualificationExperimentBinding;
}): ActionResult<QualificationExperimentState> {
  const digest = qualificationBindingDigest(input.binding);
  if (input.existing && (input.existing.bindingDigest !== digest || input.existing.token !== input.token)) {
    return err("A different qualification admission already exists for this Workroom.");
  }
  if (input.existing && input.existing.status !== "issued") {
    return err("Qualification admission was already started or settled and cannot be rearmed.");
  }
  return ok(input.existing ?? {
    schemaVersion: 1, status: "issued", token: input.token, bindingDigest: digest,
    startCount: 0, issuedAt: input.binding.issuedAt,
  });
}

export function advanceQualificationExperimentState(input: {
  existing: QualificationExperimentState;
  existingBinding: QualificationExperimentBinding;
  token: string;
  binding: QualificationExperimentBinding;
}): ActionResult<QualificationExperimentState> {
  const prior = input.existingBinding;
  const next = input.binding;
  const sameProtocol = prior.itemId === next.itemId && prior.workroomId === next.workroomId
    && prior.repositoryFullName === next.repositoryFullName && prior.baseSha === next.baseSha
    && prior.protocol.path === next.protocol.path && prior.protocol.commitSha === next.protocol.commitSha
    && prior.protocol.providerBlobId === next.protocol.providerBlobId
    && prior.installationId === next.installationId
    && prior.accountablePrincipalRef === next.accountablePrincipalRef
    && prior.protocolReviewReceiptId === next.protocolReviewReceiptId
    && prior.shapeKey === next.shapeKey && prior.shapeVersion === next.shapeVersion
    && prior.stageKey === next.stageKey && prior.policyVersion === next.policyVersion
    && prior.executorMode === next.executorMode && prior.requiredPlatform === next.requiredPlatform
    && JSON.stringify(prior.targetProductionBlobIds) === JSON.stringify(next.targetProductionBlobIds)
    && JSON.stringify(prior.allowedPaths) === JSON.stringify(next.allowedPaths);
  if (input.existing.status !== "settled" || prior.phase !== "prepare" || next.phase !== "verify"
    || !next.candidate || next.headSha !== next.candidate.headSha || !sameProtocol) {
    return err("Only a settled preparation may advance to its exact independently reviewed verification binding.");
  }
  return ok({ schemaVersion: 1, status: "issued", token: input.token,
    bindingDigest: qualificationBindingDigest(next), startCount: 0, issuedAt: next.issuedAt });
}

const SIGNING_SECRET_ENV = "DPF_QUALIFICATION_ADMISSION_SECRET";

function signingSecret(): string {
  const key = signingKey(SIGNING_SECRET_ENV);
  if (!key) throw new Error("Qualification admission requires DPF_QUALIFICATION_ADMISSION_SECRET or AUTH_SECRET.");
  return key.secret;
}

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function sign(encoded: string, secret: string): string {
  return createHmac("sha256", secret).update(encoded).digest("base64url");
}

function equalSignature(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function qualificationBindingDigest(binding: QualificationExperimentBinding): string {
  const normalized = { ...binding,
    executorMode: binding.executorMode ?? "sandbox-build",
    requiredPlatform: binding.requiredPlatform ?? "linux" };
  return `sha256:${createHmac("sha256", "qualification-binding-v1").update(canonicalJson(normalized)).digest("hex")}`;
}

export function createQualificationExperimentAdmission(
  binding: QualificationExperimentBinding,
  options: { secret?: string } = {},
): string {
  const parsed = parseQualificationExperimentBinding(binding);
  if (!parsed.ok) throw new Error(parsed.error);
  const admission: QualificationExperimentAdmission = {
    schemaVersion: 1,
    purpose: "qualification-research-admission",
    binding: parsed.data,
    bindingDigest: qualificationBindingDigest(parsed.data),
  };
  const encoded = encode(canonicalJson(admission));
  return `${encoded}.${sign(encoded, options.secret ?? signingSecret())}`;
}

export function verifyQualificationExperimentAdmission(
  token: string,
  options: { now?: Date; secret?: string; allowExpired?: boolean } = {},
): ActionResult<QualificationExperimentAdmission> {
  const separator = token.lastIndexOf(".");
  if (separator <= 0 || separator === token.length - 1) return err("Malformed qualification admission token.");
  const encoded = token.slice(0, separator);
  const actual = token.slice(separator + 1);
  const keys = options.secret !== undefined
    ? [{ secret: options.secret }]
    : verificationKeys(SIGNING_SECRET_ENV, options.now ?? new Date());
  if (!keys.some((key) => equalSignature(sign(encoded, key.secret), actual))) {
    return err("Qualification admission signature does not match.");
  }
  let value: unknown;
  try { value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")); } catch {
    return err("Qualification admission payload is malformed.");
  }
  const raw = record(value);
  const parsed = parseQualificationExperimentBinding(raw?.binding);
  if (!parsed.ok || raw?.schemaVersion !== 1 || raw?.purpose !== "qualification-research-admission"
    || raw?.bindingDigest !== qualificationBindingDigest(parsed.data)) {
    return err("Qualification admission payload does not match its immutable binding.");
  }
  if (!options.allowExpired && Date.parse(parsed.data.expiresAt) <= (options.now ?? new Date()).getTime()) {
    return err("Qualification admission expired.");
  }
  return ok({ schemaVersion: 1, purpose: "qualification-research-admission", binding: parsed.data,
    bindingDigest: qualificationBindingDigest(parsed.data) });
}

export type QualificationExperimentContext = Pick<QualificationExperimentBinding,
  "itemId" | "workroomId" | "repositoryFullName" | "baseSha" | "headSha" | "protocol"
  | "installationId" | "accountablePrincipalRef" | "protocolReviewReceiptId"> & {
    startCount: number;
    now: Date;
  };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function exactStrings(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const strings = value.map(text);
  if (strings.some((entry) => entry === null)) return null;
  const result = strings as string[];
  return result.length > 0 && new Set(result).size === result.length ? result : null;
}

function validTestPath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  return !normalized.startsWith("/") && !normalized.includes("../")
    && /(?:\.test\.|\.spec\.|test-helper\.)/.test(normalized);
}

export function parseQualificationExperimentBinding(value: unknown): ActionResult<QualificationExperimentBinding> {
  const raw = record(value);
  const protocol = record(raw?.protocol);
  const tools = exactStrings(raw?.permittedTools);
  const paths = exactStrings(raw?.allowedPaths);
  const issuedAt = text(raw?.issuedAt);
  const expiresAt = text(raw?.expiresAt);
  const phase = raw?.phase;
  // Existing issued v1 bindings predate executor-mode fields and were always
  // Build Studio/Linux bindings. Preserve their exact interpretation while
  // requiring every newly issued host-specific binding to be explicit.
  const executorMode = raw?.executorMode ?? "sandbox-build";
  const requiredPlatform = raw?.requiredPlatform ?? "linux";
  const candidateRaw = record(raw?.candidate);
  const candidateBlobs = candidateRaw ? exactStrings(candidateRaw.testBlobIds) : null;
  const candidate = candidateRaw && text(candidateRaw.headSha) && text(candidateRaw.diffDigest)
    && candidateBlobs && text(candidateRaw.reviewReceiptId) && candidateRaw.productionBytesUnchanged === true
    ? { headSha: text(candidateRaw.headSha)!, diffDigest: text(candidateRaw.diffDigest)!, testBlobIds: candidateBlobs,
      productionBytesUnchanged: true as const, reviewReceiptId: text(candidateRaw.reviewReceiptId)! }
    : null;
  const scalar = {
    itemId: text(raw?.itemId), workroomId: text(raw?.workroomId), repositoryFullName: text(raw?.repositoryFullName),
    baseSha: text(raw?.baseSha), headSha: text(raw?.headSha), installationId: text(raw?.installationId),
    accountablePrincipalRef: text(raw?.accountablePrincipalRef), protocolReviewReceiptId: text(raw?.protocolReviewReceiptId),
    shapeKey: text(raw?.shapeKey), shapeVersion: text(raw?.shapeVersion), stageKey: text(raw?.stageKey),
    protocolPath: text(protocol?.path), protocolCommit: text(protocol?.commitSha), protocolBlob: text(protocol?.providerBlobId),
  };
  const datesValid = issuedAt && expiresAt && Number.isFinite(Date.parse(issuedAt)) && Number.isFinite(Date.parse(expiresAt))
    && Date.parse(issuedAt) < Date.parse(expiresAt);
  const phaseToolsValid = phase === "prepare"
    ? tools?.includes("record_workroom_evidence") && !tools.includes("run_sandbox_tests")
      && (executorMode === "sandbox-build" ? tools.includes("write_sandbox_file")
        : executorMode === "workroom-host" && !tools.includes("write_sandbox_file") && !tools.includes("edit_sandbox_file"))
    : phase === "verify"
      ? tools?.includes("record_workroom_evidence")
        && (executorMode === "sandbox-build" ? tools.includes("run_sandbox_tests") && !tools.includes("record_execution_evidence")
          : executorMode === "workroom-host" && tools.includes("record_execution_evidence") && !tools.includes("run_sandbox_tests"))
        && !tools.includes("write_sandbox_file") && !tools.includes("edit_sandbox_file")
      : false;
  const valid = raw?.schemaVersion === 1 && (phase === "prepare" || phase === "verify")
    && (executorMode === "sandbox-build" || executorMode === "workroom-host")
    && (requiredPlatform === "linux" || requiredPlatform === "win32")
    && (executorMode !== "sandbox-build" || requiredPlatform === "linux")
    && Object.values(scalar).every(Boolean) && FULL_SHA.test(scalar.baseSha!) && FULL_SHA.test(scalar.headSha!)
    && FULL_SHA.test(scalar.protocolCommit!) && FULL_SHA.test(scalar.protocolBlob!)
    && raw?.policyVersion === 1 && tools && tools.every((tool) => QUALIFICATION_TOOLS.has(tool)) && phaseToolsValid
    && exactStrings(raw?.targetProductionBlobIds)?.every((blob) => FULL_SHA.test(blob))
    && paths && paths.every(validTestPath) && datesValid && raw?.maxStarts === 1
    && typeof raw?.maxDurationMs === "number" && raw.maxDurationMs > 0 && raw.maxDurationMs <= 3_600_000
    && (phase === "prepare" ? !candidateRaw && scalar.protocolCommit === scalar.headSha
      : candidate && FULL_SHA.test(candidate.headSha) && scalar.headSha === candidate.headSha
        && SHA256.test(candidate.diffDigest) && candidate.testBlobIds.every((blob) => FULL_SHA.test(blob)));
  if (!valid) return err("Qualification binding is incomplete, widened, stale-shaped, or not bound to test-only paths.");
  return ok({
    schemaVersion: 1, phase, itemId: scalar.itemId!, workroomId: scalar.workroomId!,
    repositoryFullName: scalar.repositoryFullName!, baseSha: scalar.baseSha!, headSha: scalar.headSha!,
    protocol: { path: scalar.protocolPath!, commitSha: scalar.protocolCommit!, providerBlobId: scalar.protocolBlob! },
    installationId: scalar.installationId!, accountablePrincipalRef: scalar.accountablePrincipalRef!,
    protocolReviewReceiptId: scalar.protocolReviewReceiptId!, permittedTools: tools, allowedPaths: paths,
    shapeKey: scalar.shapeKey!, shapeVersion: scalar.shapeVersion!, stageKey: scalar.stageKey!, policyVersion: 1,
    executorMode, requiredPlatform,
    targetProductionBlobIds: exactStrings(raw?.targetProductionBlobIds)!,
    issuedAt: issuedAt!, expiresAt: expiresAt!, maxStarts: 1, maxDurationMs: raw.maxDurationMs as number,
    ...(candidate ? { candidate } : {}),
  });
}

function protocolEqual(left: ProtocolRef, right: ProtocolRef): boolean {
  return left.path === right.path && left.commitSha.toLowerCase() === right.commitSha.toLowerCase()
    && left.providerBlobId.toLowerCase() === right.providerBlobId.toLowerCase();
}

export function validateQualificationExperimentAdmission(
  binding: QualificationExperimentBinding,
  context: QualificationExperimentContext,
): ActionResult<{ binding: QualificationExperimentBinding; researchSatisfied: false; ordinaryImplementationAuthorized: false }> {
  const exact = binding.itemId === context.itemId && binding.workroomId === context.workroomId
    && binding.repositoryFullName === context.repositoryFullName
    && binding.baseSha.toLowerCase() === context.baseSha.toLowerCase()
    && binding.headSha.toLowerCase() === context.headSha.toLowerCase()
    && protocolEqual(binding.protocol, context.protocol) && binding.installationId === context.installationId
    && binding.accountablePrincipalRef === context.accountablePrincipalRef
    && binding.protocolReviewReceiptId === context.protocolReviewReceiptId;
  if (!exact || context.startCount !== 0 || context.now.getTime() > Date.parse(binding.expiresAt)) {
    return err("Qualification identity changed, expired, or already started.");
  }
  return ok({ binding, researchSatisfied: false, ordinaryImplementationAuthorized: false });
}

export function qualificationToolEffectAllowed(input: {
  binding: QualificationExperimentBinding;
  state: QualificationExperimentState;
  toolName: string;
  params?: Readonly<Record<string, unknown>>;
  now: Date;
}): boolean {
  if (input.state.status !== "started" || input.state.startCount !== 1 || !input.state.startedAt
    || input.now.getTime() - Date.parse(input.state.startedAt) > input.binding.maxDurationMs
    || !input.binding.permittedTools.includes(input.toolName)) return false;
  if (input.toolName === "write_sandbox_file" || input.toolName === "edit_sandbox_file") {
    if (input.binding.phase !== "prepare") return false;
    const path = typeof input.params?.path === "string" ? input.params.path.replaceAll("\\", "/") : null;
    return path !== null && input.binding.allowedPaths.includes(path);
  }
  if (input.toolName === "record_workroom_evidence") {
    const result = record(input.params?.result);
    const disposition = result?.qualificationOutcome;
    const phaseOutcome = input.binding.phase === "prepare"
      ? disposition === "candidate" || disposition === "inconclusive" || disposition === "blocked"
      : disposition === "positive" || disposition === "negative" || disposition === "inconclusive" || disposition === "blocked";
    return phaseOutcome && input.params?.capsuleId === input.binding.workroomId
      && input.params.stageKey === input.binding.stageKey
      && result?.qualificationBindingDigest === qualificationBindingDigest(input.binding)
      && typeof input.params.summary === "string" && input.params.summary.trim().length > 0
      && (input.params.outcome === "completed" || input.params.outcome === "blocked")
      && (input.binding.phase !== "prepare" || disposition !== "candidate" || qualificationCandidateEvidenceMatches(result, input.binding))
      && (input.binding.phase !== "verify" || disposition === "blocked"
        || qualificationVerificationEvidenceMatches(result, input.binding));
  }
  if (input.toolName === "run_sandbox_tests") {
    return input.binding.phase === "verify" && input.params?.auto_fix !== true;
  }
  return true;
}

export type QualificationVerificationEvidence = {
  command: string; outputDigest: string; executorMode: QualificationExecutorMode;
  requiredPlatform: QualificationPlatform; headSha: string; testBlobIds: string[];
  startedAt: string; completedAt: string;
  taskRunId?: string; toolExecutionReceiptIds?: string[]; executionEvidenceActivityIds?: string[];
};

export type QualificationExecutionEvidence = {
  workroomId: string; qualificationBindingDigest: string; executorMode: "workroom-host";
  platform: QualificationPlatform; headSha: string; testBlobIds: string[]; command: string;
  outputDigest: string; startedAt: string; completedAt: string; exitCode: number; skipped: false;
};

export function parseQualificationExecutionEvidence(value: unknown): QualificationExecutionEvidence | null {
  const raw = record(value);
  const workroomId = text(raw?.workroomId);
  const bindingDigest = text(raw?.qualificationBindingDigest);
  const platform = raw?.platform;
  const headSha = text(raw?.headSha);
  const testBlobIds = exactStrings(raw?.testBlobIds);
  const command = text(raw?.command);
  const outputDigest = text(raw?.outputDigest);
  const startedAt = text(raw?.startedAt);
  const completedAt = text(raw?.completedAt);
  if (!workroomId || !bindingDigest || !SHA256.test(bindingDigest)
    || raw?.executorMode !== "workroom-host" || (platform !== "linux" && platform !== "win32")
    || !headSha || !FULL_SHA.test(headSha) || !testBlobIds?.every((blob) => FULL_SHA.test(blob))
    || !command || !outputDigest || !SHA256.test(outputDigest)
    || !startedAt || !completedAt || !Number.isFinite(Date.parse(startedAt))
    || !Number.isFinite(Date.parse(completedAt)) || Date.parse(startedAt) > Date.parse(completedAt)
    || raw?.exitCode !== 0 || raw?.skipped !== false) return null;
  return { workroomId, qualificationBindingDigest: bindingDigest, executorMode: "workroom-host",
    platform, headSha, testBlobIds, command, outputDigest, startedAt, completedAt,
    exitCode: 0, skipped: false };
}

export function qualificationExecutionEvidenceAllowed(input: {
  binding: QualificationExperimentBinding; state: QualificationExperimentState;
  evidence: unknown; accountablePrincipalRef: string | null; now: Date;
}): boolean {
  const evidence = parseQualificationExecutionEvidence(input.evidence);
  if (!evidence || input.binding.phase !== "verify" || input.binding.executorMode !== "workroom-host"
    || !input.binding.candidate || input.accountablePrincipalRef !== input.binding.accountablePrincipalRef
    || (input.state.status !== "started" && input.state.status !== "settled")
    || input.state.startCount !== 1 || !input.state.startedAt
    || evidence.workroomId !== input.binding.workroomId
    || evidence.qualificationBindingDigest !== qualificationBindingDigest(input.binding)
    || evidence.platform !== input.binding.requiredPlatform
    || evidence.headSha.toLowerCase() !== input.binding.candidate.headSha.toLowerCase()
    || canonicalJson(evidence.testBlobIds) !== canonicalJson(input.binding.candidate.testBlobIds)) return false;
  const admittedAt = Date.parse(input.state.startedAt);
  const startedAt = Date.parse(evidence.startedAt);
  const completedAt = Date.parse(evidence.completedAt);
  const admittedUntil = Math.min(admittedAt + input.binding.maxDurationMs, Date.parse(input.binding.expiresAt));
  return startedAt >= admittedAt && completedAt <= admittedUntil && input.now.getTime() <= admittedUntil;
}

export function qualificationExecutionActivitiesMatch(input: {
  binding: QualificationExperimentBinding; state: QualificationExperimentState;
  itemId: string; activityIds: string[]; rows: unknown[]; accountablePrincipalRef: string | null;
}): boolean {
  if (input.activityIds.length === 0 || input.rows.length !== input.activityIds.length) return false;
  const expected = new Set(input.activityIds);
  const matches = input.rows.every((value) => {
    const row = record(value);
    const payload = record(row?.payload);
    const backlogItem = record(row?.backlogItem);
    const qualification = parseQualificationExecutionEvidence(payload?.qualification);
    return typeof row?.id === "string" && expected.delete(row.id)
      && backlogItem?.itemId === input.itemId && payload?.evidenceKind === "test_pass"
      && qualification !== null
      && qualificationExecutionEvidenceAllowed({ binding: input.binding, state: input.state,
        evidence: qualification, accountablePrincipalRef: input.accountablePrincipalRef,
        now: new Date(qualification.completedAt) });
  });
  return matches && expected.size === 0;
}

export function parseQualificationVerificationEvidence(value: unknown): QualificationVerificationEvidence | null {
  const result = record(value);
  if (!result) return null;
  const command = text(result.command);
  const outputDigest = text(result.outputDigest);
  const executorMode = result.executorMode;
  const requiredPlatform = result.requiredPlatform;
  const headSha = text(result.headSha);
  const testBlobIds = exactStrings(result.testBlobIds);
  const taskRunId = text(result.taskRunId) ?? undefined;
  const receiptIds = exactStrings(result.toolExecutionReceiptIds) ?? undefined;
  const activityIds = exactStrings(result.executionEvidenceActivityIds) ?? undefined;
  const startedAt = text(result.startedAt);
  const completedAt = text(result.completedAt);
  if ((executorMode !== "sandbox-build" && executorMode !== "workroom-host")
    || (requiredPlatform !== "linux" && requiredPlatform !== "win32")) return null;
  const executorProof = executorMode === "sandbox-build" ? Boolean(taskRunId && receiptIds && !activityIds)
    : Boolean(activityIds && !taskRunId && !receiptIds);
  if (!command || !outputDigest || !SHA256.test(outputDigest) || !executorProof
    || !headSha || !FULL_SHA.test(headSha) || !testBlobIds?.every((blob) => FULL_SHA.test(blob))
    || !startedAt || !completedAt || !Number.isFinite(Date.parse(startedAt))
    || !Number.isFinite(Date.parse(completedAt)) || Date.parse(startedAt) > Date.parse(completedAt)) return null;
  return { command, outputDigest, executorMode, requiredPlatform, headSha, testBlobIds,
    startedAt, completedAt, ...(taskRunId ? { taskRunId } : {}),
    ...(receiptIds ? { toolExecutionReceiptIds: receiptIds } : {}),
    ...(activityIds ? { executionEvidenceActivityIds: activityIds } : {}) };
}

function qualificationVerificationEvidenceMatches(
  result: Record<string, unknown>,
  binding: QualificationExperimentBinding,
): boolean {
  const proof = parseQualificationVerificationEvidence(result);
  return proof !== null && binding.candidate !== undefined
    && proof.executorMode === binding.executorMode
    && proof.requiredPlatform === binding.requiredPlatform
    && proof.headSha.toLowerCase() === binding.candidate.headSha.toLowerCase()
    && canonicalJson(proof.testBlobIds) === canonicalJson(binding.candidate.testBlobIds);
}

function qualificationCandidateEvidenceMatches(
  result: Record<string, unknown>,
  binding: QualificationExperimentBinding,
): boolean {
  const candidate = record(result.candidate);
  const headSha = text(candidate?.headSha);
  const diffDigest = text(candidate?.diffDigest);
  const testBlobIds = exactStrings(candidate?.testBlobIds);
  const productionBlobIds = exactStrings(candidate?.targetProductionBlobIds);
  return Boolean(headSha && FULL_SHA.test(headSha) && diffDigest && SHA256.test(diffDigest)
    && testBlobIds?.every((blob) => FULL_SHA.test(blob))
    && candidate?.productionBytesUnchanged === true
    && productionBlobIds && canonicalJson(productionBlobIds) === canonicalJson(binding.targetProductionBlobIds));
}

export function parseQualificationCandidateEvidence(
  value: unknown,
  binding: QualificationExperimentBinding,
): ActionResult<Omit<QualificationCandidateRef, "reviewReceiptId">> {
  const result = record(value);
  if (!result || result.qualificationOutcome !== "candidate" || !qualificationCandidateEvidenceMatches(result, binding)) {
    return err("Preparation evidence does not contain one complete exact candidate.");
  }
  const candidate = record(result.candidate)!;
  return ok({ headSha: text(candidate.headSha)!, diffDigest: text(candidate.diffDigest)!,
    testBlobIds: exactStrings(candidate.testBlobIds)!, productionBytesUnchanged: true });
}
