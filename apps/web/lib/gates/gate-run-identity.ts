import { createHash } from "node:crypto";

export const GATE_RUN_IDENTITY_SCHEMA_VERSION = 1 as const;
export const GATE_KINDS = ["local-integration-ci", "semantic-review"] as const;

export type GateKind = (typeof GATE_KINDS)[number];

export type GateRunIdentityInput = {
  repository: string;
  integrationTreeSha: string;
  evidencePlanDigest: string;
  toolchainFingerprint: string;
  gateKind: GateKind;
};

export type GateRunIdentity = GateRunIdentityInput & {
  schemaVersion: typeof GATE_RUN_IDENTITY_SCHEMA_VERSION;
};

export type LocalCiTerminalEvidenceProjection =
  | { status: "reused"; evidenceRecordId: string; resultClass: "pass" | "fail" }
  | { status: "rerunnable" }
  | {
    status: "blocked";
    reason: "missing-evidence" | "mismatched-evidence" | "expired-evidence";
  };

export type SemanticReviewGateIdentityInput = {
  repository: string;
  identity: {
    capsuleId: string;
    baseTreeHash: string;
    headTreeHash: string;
    diffDigest: string;
    policyVersion: string;
    reviewerVersion: string;
    specialistIds: readonly string[];
  };
  risk: string;
  dispatchContractVersion: string;
};

const SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const REPOSITORY = /^[^/\s]+\/[^/\s]+$/;

function invalid(component: string): never {
  throw new TypeError(`Invalid gate run identity ${component}.`);
}

function normalizeHex(value: string, pattern: RegExp, component: string): string {
  const normalized = value.trim().toLowerCase();
  return pattern.test(normalized) ? normalized : invalid(component);
}

function nonEmpty(value: string, component: string): string {
  const normalized = value.trim();
  return normalized ? normalized : invalid(component);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function normalizeGateRunIdentity(input: GateRunIdentityInput): GateRunIdentity {
  const repository = input.repository.trim().toLowerCase();
  if (!REPOSITORY.test(repository)) invalid("repository");
  if (!(GATE_KINDS as readonly string[]).includes(input.gateKind)) invalid("gate kind");

  return {
    schemaVersion: GATE_RUN_IDENTITY_SCHEMA_VERSION,
    repository,
    integrationTreeSha: normalizeHex(input.integrationTreeSha, SHA1, "integration tree SHA"),
    evidencePlanDigest: normalizeHex(input.evidencePlanDigest, SHA256, "evidence plan digest"),
    toolchainFingerprint: normalizeHex(input.toolchainFingerprint, SHA256, "toolchain fingerprint"),
    gateKind: input.gateKind,
  };
}

export function deriveGateKey(input: GateRunIdentityInput | GateRunIdentity): string {
  return sha256(normalizeGateRunIdentity(input));
}

export function isImmutableGateClaimKey(claimKey: string | null | undefined): boolean {
  return Boolean(claimKey?.startsWith("gate:"));
}

export function projectLocalCiTerminalEvidence(input: {
  claimKey: string;
  evidence: {
    id: string;
    operationType: string;
    details: unknown;
  } | null;
  now: Date;
}): LocalCiTerminalEvidenceProjection {
  // The record id was set but the row is gone (retention, or a failed write that
  // still stamped the lease). Same reasoning as the null-id case above.
  if (!input.evidence) return { status: "rerunnable" };
  const details = input.evidence.details && typeof input.evidence.details === "object"
    && !Array.isArray(input.evidence.details)
    ? input.evidence.details as Record<string, unknown>
    : null;
  const validity = details?.evidenceValidity
    && typeof details.evidenceValidity === "object"
    && !Array.isArray(details.evidenceValidity)
    ? details.evidenceValidity as Record<string, unknown>
    : null;
  if (
    input.evidence.operationType !== "local_integration_ci"
    || details?.gateKey !== input.claimKey.slice("gate:".length)
    || (details.status !== "passed" && details.status !== "failed")
  ) {
    return { status: "blocked", reason: "mismatched-evidence" };
  }
  // An expiry that was never STAMPED is not an expiry that lapsed. The gate
  // stamps validity only for a run that reached a product verdict, so evidence
  // without one is infrastructure evidence — a killed child, a starved control
  // plane, recorded for observability and never a verdict to reuse. Reading it
  // as "expired" bricked the tree the same way a dropped write did, just under a
  // different reason (BI-C59AC8AF). Only a real timestamp in the past expires.
  const expiresAt = typeof validity?.expiresAt === "string"
    ? Date.parse(validity.expiresAt)
    : Number.NaN;
  if (!Number.isFinite(expiresAt)) return { status: "rerunnable" };
  if (expiresAt <= input.now.getTime()) {
    return { status: "blocked", reason: "expired-evidence" };
  }
  return {
    status: "reused",
    evidenceRecordId: input.evidence.id,
    resultClass: details.status === "passed" ? "pass" : "fail",
  };
}

export async function resolveLocalCiTerminalEvidence(input: {
  claimKey: string;
  evidenceRecordId: string | null;
  now: Date;
  loadEvidence: (id: string) => Promise<{
    id: string;
    operationType: string;
    details: unknown;
  } | null>;
}): Promise<LocalCiTerminalEvidenceProjection> {
  // A terminal lease that never recorded evidence describes a run that DIED,
  // not a verdict — the executor was killed, or the portal rejected its status
  // write. Blocking on it made that tree permanently ungateable, because the
  // gate key hashes the integration tree: a fresh commit of the same content
  // lands on the same key and the same refusal (BI-C59AC8AF). Nothing is being
  // reused here, so there is nothing to protect — the honest answer is to let
  // the gate run again. `mismatched-evidence` and `expired-evidence` stay
  // blocking: there, evidence EXISTS and does not fit, which is a real verdict.
  if (!input.evidenceRecordId) return { status: "rerunnable" };
  return projectLocalCiTerminalEvidence({
    claimKey: input.claimKey,
    evidence: await input.loadEvidence(input.evidenceRecordId),
    now: input.now,
  });
}

function normalizedSpecialistIds(ids: readonly string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))].sort();
}

export function deriveSemanticReviewGateIdentity(input: SemanticReviewGateIdentityInput): {
  identity: GateRunIdentity;
  gateKey: string;
} {
  const reviewPlan = {
    capsuleId: nonEmpty(input.identity.capsuleId, "semantic-review capsule"),
    baseTreeHash: normalizeHex(input.identity.baseTreeHash, SHA1, "semantic-review base tree SHA"),
    diffDigest: normalizeHex(input.identity.diffDigest, SHA256, "semantic-review diff digest"),
    policyVersion: nonEmpty(input.identity.policyVersion, "semantic-review policy version"),
    risk: nonEmpty(input.risk, "semantic-review risk"),
    specialistIds: normalizedSpecialistIds(input.identity.specialistIds),
  };
  const reviewToolchain = {
    dispatchContractVersion: nonEmpty(
      input.dispatchContractVersion,
      "semantic-review dispatch contract version",
    ),
    reviewerVersion: nonEmpty(input.identity.reviewerVersion, "semantic-review reviewer version"),
  };
  const identity = normalizeGateRunIdentity({
    repository: input.repository,
    integrationTreeSha: input.identity.headTreeHash,
    evidencePlanDigest: sha256(reviewPlan),
    toolchainFingerprint: sha256(reviewToolchain),
    gateKind: "semantic-review",
  });

  return { identity, gateKey: deriveGateKey(identity) };
}
