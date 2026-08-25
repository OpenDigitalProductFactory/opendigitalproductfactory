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
