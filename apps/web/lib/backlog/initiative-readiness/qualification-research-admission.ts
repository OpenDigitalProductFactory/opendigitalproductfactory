import { createHmac, timingSafeEqual } from "node:crypto";

import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { signingKey, verificationKeys } from "@/lib/auth/dedicated-signing-key";

const FULL_SHA = /^[a-f0-9]{40}$/i;
const SHA256 = /^sha256:[a-f0-9]{64}$/i;
const QUALIFICATION_TOOLS = new Set([
  "read_source_at_version",
  "read_codebase_manifest",
  "list_patch_posture",
  "write_sandbox_file",
  "edit_sandbox_file",
  "run_sandbox_tests",
  "record_workroom_evidence",
]);

type ProtocolRef = { path: string; commitSha: string; providerBlobId: string };
type CandidateRef = {
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
  authorityDecisionId: string;
  shapeKey: string;
  shapeVersion: string;
  stageKey: string;
  policyVersion: 1;
  targetProductionBlobIds: string[];
  permittedTools: string[];
  allowedPaths: string[];
  issuedAt: string;
  expiresAt: string;
  maxStarts: 1;
  maxDurationMs: number;
  candidate?: CandidateRef;
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
  return `sha256:${createHmac("sha256", "qualification-binding-v1").update(canonicalJson(binding)).digest("hex")}`;
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
    binding: parsed.binding,
    bindingDigest: qualificationBindingDigest(parsed.binding),
  };
  const encoded = encode(canonicalJson(admission));
  return `${encoded}.${sign(encoded, options.secret ?? signingSecret())}`;
}

export function verifyQualificationExperimentAdmission(
  token: string,
  options: { now?: Date; secret?: string } = {},
): { ok: true; admission: QualificationExperimentAdmission } | { ok: false; code: "qualification-admission-token-invalid"; error: string } {
  const separator = token.lastIndexOf(".");
  if (separator <= 0 || separator === token.length - 1) return { ok: false, code: "qualification-admission-token-invalid", error: "Malformed qualification admission token." };
  const encoded = token.slice(0, separator);
  const actual = token.slice(separator + 1);
  const keys = options.secret !== undefined
    ? [{ secret: options.secret }]
    : verificationKeys(SIGNING_SECRET_ENV, options.now ?? new Date());
  if (!keys.some((key) => equalSignature(sign(encoded, key.secret), actual))) {
    return { ok: false, code: "qualification-admission-token-invalid", error: "Qualification admission signature does not match." };
  }
  let value: unknown;
  try { value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")); } catch {
    return { ok: false, code: "qualification-admission-token-invalid", error: "Qualification admission payload is malformed." };
  }
  const raw = record(value);
  const parsed = parseQualificationExperimentBinding(raw?.binding);
  if (!parsed.ok || raw?.schemaVersion !== 1 || raw?.purpose !== "qualification-research-admission"
    || raw?.bindingDigest !== qualificationBindingDigest(parsed.binding)) {
    return { ok: false, code: "qualification-admission-token-invalid", error: "Qualification admission payload does not match its immutable binding." };
  }
  if (Date.parse(parsed.binding.expiresAt) <= (options.now ?? new Date()).getTime()) {
    return { ok: false, code: "qualification-admission-token-invalid", error: "Qualification admission expired." };
  }
  return { ok: true, admission: { schemaVersion: 1, purpose: "qualification-research-admission", binding: parsed.binding,
    bindingDigest: qualificationBindingDigest(parsed.binding) } };
}

export type QualificationExperimentContext = Pick<QualificationExperimentBinding,
  "itemId" | "workroomId" | "repositoryFullName" | "baseSha" | "headSha" | "protocol"
  | "installationId" | "accountablePrincipalRef" | "authorityDecisionId"> & {
    startCount: number;
    now: Date;
  };

type ParseResult = { ok: true; binding: QualificationExperimentBinding }
  | { ok: false; code: "qualification-binding-malformed"; error: string };

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

export function parseQualificationExperimentBinding(value: unknown): ParseResult {
  const raw = record(value);
  const protocol = record(raw?.protocol);
  const tools = exactStrings(raw?.permittedTools);
  const paths = exactStrings(raw?.allowedPaths);
  const issuedAt = text(raw?.issuedAt);
  const expiresAt = text(raw?.expiresAt);
  const phase = raw?.phase;
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
    accountablePrincipalRef: text(raw?.accountablePrincipalRef), authorityDecisionId: text(raw?.authorityDecisionId),
    shapeKey: text(raw?.shapeKey), shapeVersion: text(raw?.shapeVersion), stageKey: text(raw?.stageKey),
    protocolPath: text(protocol?.path), protocolCommit: text(protocol?.commitSha), protocolBlob: text(protocol?.providerBlobId),
  };
  const datesValid = issuedAt && expiresAt && Number.isFinite(Date.parse(issuedAt)) && Number.isFinite(Date.parse(expiresAt))
    && Date.parse(issuedAt) < Date.parse(expiresAt);
  const valid = raw?.schemaVersion === 1 && (phase === "prepare" || phase === "verify")
    && Object.values(scalar).every(Boolean) && FULL_SHA.test(scalar.baseSha!) && FULL_SHA.test(scalar.headSha!)
    && FULL_SHA.test(scalar.protocolCommit!) && FULL_SHA.test(scalar.protocolBlob!)
    && scalar.protocolCommit === scalar.headSha && raw?.policyVersion === 1
    && tools && tools.every((tool) => QUALIFICATION_TOOLS.has(tool))
    && exactStrings(raw?.targetProductionBlobIds)?.every((blob) => FULL_SHA.test(blob))
    && paths && paths.every(validTestPath) && datesValid && raw?.maxStarts === 1
    && typeof raw?.maxDurationMs === "number" && raw.maxDurationMs > 0 && raw.maxDurationMs <= 3_600_000
    && (phase === "prepare" ? !candidateRaw : candidate && FULL_SHA.test(candidate.headSha)
      && SHA256.test(candidate.diffDigest) && candidate.testBlobIds.every((blob) => FULL_SHA.test(blob)));
  if (!valid) return { ok: false, code: "qualification-binding-malformed",
    error: "Qualification binding is incomplete, widened, stale-shaped, or not bound to test-only paths." };
  return { ok: true, binding: {
    schemaVersion: 1, phase, itemId: scalar.itemId!, workroomId: scalar.workroomId!,
    repositoryFullName: scalar.repositoryFullName!, baseSha: scalar.baseSha!, headSha: scalar.headSha!,
    protocol: { path: scalar.protocolPath!, commitSha: scalar.protocolCommit!, providerBlobId: scalar.protocolBlob! },
    installationId: scalar.installationId!, accountablePrincipalRef: scalar.accountablePrincipalRef!,
    authorityDecisionId: scalar.authorityDecisionId!, permittedTools: tools, allowedPaths: paths,
    shapeKey: scalar.shapeKey!, shapeVersion: scalar.shapeVersion!, stageKey: scalar.stageKey!, policyVersion: 1,
    targetProductionBlobIds: exactStrings(raw?.targetProductionBlobIds)!,
    issuedAt: issuedAt!, expiresAt: expiresAt!, maxStarts: 1, maxDurationMs: raw.maxDurationMs as number,
    ...(candidate ? { candidate } : {}),
  } };
}

function protocolEqual(left: ProtocolRef, right: ProtocolRef): boolean {
  return left.path === right.path && left.commitSha.toLowerCase() === right.commitSha.toLowerCase()
    && left.providerBlobId.toLowerCase() === right.providerBlobId.toLowerCase();
}

export function validateQualificationExperimentAdmission(binding: QualificationExperimentBinding, context: QualificationExperimentContext) {
  const exact = binding.itemId === context.itemId && binding.workroomId === context.workroomId
    && binding.repositoryFullName === context.repositoryFullName
    && binding.baseSha.toLowerCase() === context.baseSha.toLowerCase()
    && binding.headSha.toLowerCase() === context.headSha.toLowerCase()
    && protocolEqual(binding.protocol, context.protocol) && binding.installationId === context.installationId
    && binding.accountablePrincipalRef === context.accountablePrincipalRef
    && binding.authorityDecisionId === context.authorityDecisionId;
  if (!exact || context.startCount !== 0 || context.now.getTime() > Date.parse(binding.expiresAt)) {
    return { ok: false as const, code: "qualification-admission-refused" as const,
      error: "Qualification identity changed, expired, or already started." };
  }
  return { ok: true as const, binding, researchSatisfied: false as const, ordinaryImplementationAuthorized: false as const };
}
