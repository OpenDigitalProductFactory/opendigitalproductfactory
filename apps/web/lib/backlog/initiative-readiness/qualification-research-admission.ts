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
  permittedTools: string[];
  allowedPaths: string[];
  issuedAt: string;
  expiresAt: string;
  maxStarts: 1;
  maxDurationMs: number;
  candidate?: CandidateRef;
};

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
    protocolPath: text(protocol?.path), protocolCommit: text(protocol?.commitSha), protocolBlob: text(protocol?.providerBlobId),
  };
  const datesValid = issuedAt && expiresAt && Number.isFinite(Date.parse(issuedAt)) && Number.isFinite(Date.parse(expiresAt))
    && Date.parse(issuedAt) < Date.parse(expiresAt);
  const valid = raw?.schemaVersion === 1 && (phase === "prepare" || phase === "verify")
    && Object.values(scalar).every(Boolean) && FULL_SHA.test(scalar.baseSha!) && FULL_SHA.test(scalar.headSha!)
    && FULL_SHA.test(scalar.protocolCommit!) && FULL_SHA.test(scalar.protocolBlob!)
    && scalar.protocolCommit === scalar.headSha && tools && tools.every((tool) => QUALIFICATION_TOOLS.has(tool))
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
