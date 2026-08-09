import {
  createHash,
  randomBytes as nodeRandomBytes,
  timingSafeEqual,
} from "node:crypto";

import { DEMAND_PROJECTION_TEMPLATES } from "@dpf/db/federated-demand-contract";

import { isLinkLocalFederationEndpoint } from "./nearby-candidates";
import {
  deriveDeviceId,
  isDeviceId,
  signIdentityStatement,
  verifyIdentityStatement,
} from "./instance-identity";
import type { FederationSigningIdentity } from "./demand-identity";
import {
  buildSasCommitmentStatement,
  computeCommitment,
  deriveSas,
  deriveSharedSecret,
  generateEphemeralKeypair,
  generatePairingNonce,
  verifyCommitment,
} from "./sas-pairing";

const PAIRING_SECRET_PREFIX = "dpffpair_";
const PAIRING_SECRET_BYTES = 32;
const MAX_DISPLAY_NAME_LENGTH = 120;
const MAX_DISCOVERY_ID_LENGTH = 160;

export interface NearbyPairingRequest {
  requesterAuthorityUrl: string;
  displayName: string;
  requesterInstallationId: string;
  candidateDiscoveryId: string;
  requesterDeviceId: string;
  requesterSigningPublicKey: string;
  requesterCommitment: string;
  requesterCommitmentSignature: string;
  relationshipPreset: "same-organization";
}

export interface NearbyPairingProjectionSummary {
  relationshipLabel: "Same organization";
  retentionClass: string;
  sharedSlices: string[];
  staysLocal: string[];
}

export type RequestNearbyPairingResult =
  | {
      ok: true;
      pairingId: string;
      pairingSecret: string;
      matchingCode: string;
      peerDisplayName: string;
      peerInstallationId: string;
      peerDeviceId: string;
      peerSigningPublicKey: string;
      expiresAt: string;
      projectionSummary: NearbyPairingProjectionSummary;
    }
  | {
      ok: false;
      error: "tls_required" | "not_nearby" | "peer_unreachable" | "peer_rejected" | "invalid_peer_response";
      message: string;
    };

function pairingSecretHash(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

export function createNearbyPairingMaterial(options: {
  randomBytes?: (size: number) => Buffer;
} = {}): {
  plaintextSecret: string;
  secretHash: string;
} {
  const randomBytes = options.randomBytes ?? nodeRandomBytes;
  const entropy = randomBytes(PAIRING_SECRET_BYTES);
  if (entropy.length !== PAIRING_SECRET_BYTES) {
    throw new Error(`pairing entropy must contain ${PAIRING_SECRET_BYTES} bytes`);
  }
  const plaintextSecret = `${PAIRING_SECRET_PREFIX}${entropy.toString("base64url")}`;
  return {
    plaintextSecret,
    secretHash: pairingSecretHash(plaintextSecret),
  };
}

export function pairingSecretMatches(plaintext: string, expectedHash: string): boolean {
  if (!plaintext.startsWith(PAIRING_SECRET_PREFIX) || !/^[a-f0-9]{64}$/.test(expectedHash)) {
    return false;
  }
  const actual = Buffer.from(pairingSecretHash(plaintext), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function boundedString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.trim().length > maxLength) {
    throw new Error(`${label} must be between 1 and ${maxLength} characters`);
  }
  return value.trim();
}

export function parseNearbyPairingRequest(value: unknown): NearbyPairingRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("pairing request must be an object");
  }
  const input = value as Record<string, unknown>;
  const allowedFields = new Set([
    "requesterAuthorityUrl",
    "displayName",
    "requesterInstallationId",
    "candidateDiscoveryId",
    "requesterDeviceId",
    "requesterSigningPublicKey",
    "requesterCommitment",
    "requesterCommitmentSignature",
    "relationshipPreset",
  ]);
  const unknownField = Object.keys(input).find((key) => !allowedFields.has(key));
  if (unknownField) throw new Error(`unknown pairing field: ${unknownField}`);
  if (
    input.relationshipPreset !== undefined &&
    input.relationshipPreset !== "same-organization"
  ) {
    throw new Error("automatic nearby pairing supports only same-organization relationships");
  }
  const requesterAuthorityUrl = boundedString(
    input.requesterAuthorityUrl,
    "requester authority URL",
    500,
  );
  let url: URL;
  try {
    url = new URL(requesterAuthorityUrl);
  } catch {
    throw new Error("peer authority URL is invalid");
  }
  if (url.protocol !== "https:") {
    throw new Error("automatic pairing requires certificate-valid HTTPS");
  }
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("requester authority URL must be an origin");
  }
  if (!isLinkLocalFederationEndpoint(url.origin)) {
    throw new Error("automatic pairing requires a nearby private or local endpoint");
  }

  const requesterInstallationId = boundedString(
    input.requesterInstallationId,
    "requester installation ID",
    MAX_DISCOVERY_ID_LENGTH,
  );
  if (!/^inst_[a-f0-9]{32}$/.test(requesterInstallationId)) {
    throw new Error("requester installation ID is invalid");
  }
  const candidateDiscoveryId = boundedString(
    input.candidateDiscoveryId,
    "candidate discovery ID",
    MAX_DISCOVERY_ID_LENGTH,
  );
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(candidateDiscoveryId)) {
    throw new Error("candidate discovery ID is invalid");
  }

  const requesterDeviceId = boundedString(input.requesterDeviceId, "requester device ID", 80);
  const requesterSigningPublicKey = boundedString(
    input.requesterSigningPublicKey,
    "requester signing public key",
    256,
  );
  const requesterCommitment = boundedString(
    input.requesterCommitment,
    "requester SAS commitment",
    64,
  );
  const requesterCommitmentSignature = boundedString(
    input.requesterCommitmentSignature,
    "requester SAS commitment signature",
    256,
  );
  if (!isDeviceId(requesterDeviceId) || !/^[a-f0-9]{64}$/.test(requesterCommitment)) {
    throw new Error("requester SAS identity is invalid");
  }
  try {
    if (deriveDeviceId(requesterSigningPublicKey) !== requesterDeviceId) {
      throw new Error("requester device ID does not match its signing key");
    }
  } catch {
    throw new Error("requester device ID does not match its signing key");
  }
  const commitmentStatement = buildSasCommitmentStatement({
    deviceId: requesterDeviceId,
    peerBinding: candidateDiscoveryId,
    authorityUrl: url.origin,
    pairingContext: candidateDiscoveryId,
    commitment: requesterCommitment,
  });
  if (!verifyIdentityStatement(
    requesterSigningPublicKey,
    commitmentStatement,
    requesterCommitmentSignature,
  )) {
    throw new Error("requester SAS commitment signature is invalid");
  }

  return {
    requesterAuthorityUrl: url.origin,
    displayName: boundedString(input.displayName, "display name", MAX_DISPLAY_NAME_LENGTH),
    requesterInstallationId,
    candidateDiscoveryId,
    requesterDeviceId,
    requesterSigningPublicKey,
    requesterCommitment,
    requesterCommitmentSignature,
    relationshipPreset: "same-organization",
  };
}

export function summarizeNearbyPairingProjection(): NearbyPairingProjectionSummary {
  const projection = DEMAND_PROJECTION_TEMPLATES["same-organization"];
  return {
    relationshipLabel: "Same organization",
    retentionClass: projection.retentionClass ?? "standard",
    sharedSlices: [...projection.includeSlices],
    staysLocal: [
      "local backlog details",
      "work capsules",
      "private planning",
      "attachments",
      "customer context",
    ],
  };
}


interface PairingCommitResponse {
  ok: true;
  pairingId: string;
  pairingSecret: string;
  receiverDeviceId: string;
  receiverSigningPublicKey: string;
  receiverCommitment: string;
  receiverCommitmentSignature: string;
  peerDisplayName: string;
  peerInstallationId: string;
  expiresAt: string;
  projectionSummary: NearbyPairingProjectionSummary;
}

function isPairingStartResponse(value: unknown): value is PairingCommitResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const projection = row.projectionSummary as Record<string, unknown> | null;
  const canonicalProjection = summarizeNearbyPairingProjection();
  const matchesCanonicalList = (actual: unknown, expected: string[]) =>
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((item, index) => item === expected[index]);
  return (
    row.ok === true &&
    typeof row.pairingId === "string" &&
    /^pair_[A-Za-z0-9_-]{3,160}$/.test(row.pairingId) &&
    typeof row.pairingSecret === "string" &&
    row.pairingSecret.startsWith(PAIRING_SECRET_PREFIX) &&
    typeof row.receiverDeviceId === "string" &&
    isDeviceId(row.receiverDeviceId) &&
    typeof row.receiverSigningPublicKey === "string" &&
    typeof row.receiverCommitment === "string" &&
    /^[a-f0-9]{64}$/.test(row.receiverCommitment) &&
    typeof row.receiverCommitmentSignature === "string" &&
    typeof row.peerDisplayName === "string" &&
    row.peerDisplayName.length > 0 && row.peerDisplayName.length <= MAX_DISPLAY_NAME_LENGTH &&
    typeof row.peerInstallationId === "string" &&
    /^inst_[a-f0-9]{32}$/.test(row.peerInstallationId) &&
    typeof row.expiresAt === "string" &&
    !Number.isNaN(Date.parse(row.expiresAt)) &&
    !!projection &&
    typeof projection === "object" &&
    !Array.isArray(projection) &&
    projection.relationshipLabel === canonicalProjection.relationshipLabel &&
    projection.retentionClass === canonicalProjection.retentionClass &&
    matchesCanonicalList(projection.sharedSlices, canonicalProjection.sharedSlices) &&
    matchesCanonicalList(projection.staysLocal, canonicalProjection.staysLocal)
  );
}

export async function requestNearbyPairing(input: {
  candidateEndpoint: string;
  requesterAuthorityUrl: string;
  displayName: string;
  requesterInstallationId: string;
  candidateDiscoveryId: string;
  requesterIdentity: FederationSigningIdentity;
  fetchImpl?: typeof fetch;
}): Promise<RequestNearbyPairingResult> {
  let candidate: URL;
  try {
    candidate = new URL(input.candidateEndpoint);
  } catch {
    return { ok: false, error: "not_nearby", message: "Nearby DPF endpoint is invalid." };
  }
  if (candidate.protocol !== "https:") {
    return {
      ok: false,
      error: "tls_required",
      message: "Automatic pairing requires a certificate-valid HTTPS endpoint.",
    };
  }
  if (!isLinkLocalFederationEndpoint(input.candidateEndpoint)) {
    return {
      ok: false,
      error: "not_nearby",
      message: "Automatic nearby pairing is limited to private or local-network endpoints.",
    };
  }

  const requesterEphemeral = generateEphemeralKeypair();
  const requesterNonce = generatePairingNonce();
  const requesterCommitment = computeCommitment(requesterEphemeral.publicKey, requesterNonce);
  const requesterCommitmentSignature = signIdentityStatement(
    input.requesterIdentity.signingPrivateKey,
    buildSasCommitmentStatement({
      deviceId: input.requesterIdentity.deviceId,
      peerBinding: input.candidateDiscoveryId,
      authorityUrl: new URL(input.requesterAuthorityUrl).origin,
      pairingContext: input.candidateDiscoveryId,
      commitment: requesterCommitment,
    }),
  );
  let request: NearbyPairingRequest;
  try {
    request = parseNearbyPairingRequest({
      requesterAuthorityUrl: input.requesterAuthorityUrl,
      displayName: input.displayName,
      requesterInstallationId: input.requesterInstallationId,
      candidateDiscoveryId: input.candidateDiscoveryId,
      requesterDeviceId: input.requesterIdentity.deviceId,
      requesterSigningPublicKey: input.requesterIdentity.signingPublicKey,
      requesterCommitment,
      requesterCommitmentSignature,
    });
  } catch (error) {
    return {
      ok: false,
      error: "not_nearby",
      message: error instanceof Error ? error.message : "Pairing request is invalid.",
    };
  }

  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(
      `${candidate.href.replace(/\/+$/, "")}/connect/pair`,
      {
        method: "POST",
        redirect: "error",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ operation: "request", ...request }),
      },
    );
  } catch {
    return {
      ok: false,
      error: "peer_unreachable",
      message: "The nearby DPF could not be reached with a valid HTTPS certificate.",
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const peerMessage = body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>).message
      : null;
    return {
      ok: false,
      error: "peer_rejected",
      message: typeof peerMessage === "string" ? peerMessage : `Nearby DPF responded ${response.status}.`,
    };
  }
  if (!isPairingStartResponse(body)) {
    return {
      ok: false,
      error: "invalid_peer_response",
      message: "The nearby DPF returned an invalid pairing response.",
    };
  }
  let receiverDeviceId: string;
  try {
    receiverDeviceId = deriveDeviceId(body.receiverSigningPublicKey);
  } catch {
    return { ok: false, error: "invalid_peer_response", message: "Nearby DPF returned an invalid device identity." };
  }
  if (
    receiverDeviceId !== body.receiverDeviceId ||
    !verifyIdentityStatement(
      body.receiverSigningPublicKey,
      buildSasCommitmentStatement({
        deviceId: body.receiverDeviceId,
        peerBinding: input.requesterIdentity.deviceId,
        authorityUrl: candidate.origin,
        pairingContext: body.pairingId,
        commitment: body.receiverCommitment,
      }),
      body.receiverCommitmentSignature,
    )
  ) {
    return { ok: false, error: "invalid_peer_response", message: "Nearby DPF identity signature did not verify." };
  }

  let revealResponse: Response;
  try {
    revealResponse = await (input.fetchImpl ?? fetch)(
      `${candidate.href.replace(/\/+$/, "")}/connect/pair`,
      {
        method: "POST",
        redirect: "error",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          operation: "reveal",
          pairingId: body.pairingId,
          pairingSecret: body.pairingSecret,
          requesterEphemeralPublicKey: requesterEphemeral.publicKey,
          requesterNonce,
        }),
      },
    );
  } catch {
    return { ok: false, error: "peer_unreachable", message: "The nearby DPF could not complete the SAS exchange." };
  }
  let revealBody: unknown;
  try {
    revealBody = await revealResponse.json();
  } catch {
    revealBody = null;
  }
  if (!revealResponse.ok || !revealBody || typeof revealBody !== "object" || Array.isArray(revealBody)) {
    return { ok: false, error: "invalid_peer_response", message: "Nearby DPF returned an invalid SAS reveal." };
  }
  const reveal = revealBody as Record<string, unknown>;
  if (
    reveal.ok !== true ||
    typeof reveal.receiverEphemeralPublicKey !== "string" ||
    typeof reveal.receiverNonce !== "string" ||
    !verifyCommitment(
      reveal.receiverEphemeralPublicKey,
      reveal.receiverNonce,
      body.receiverCommitment,
    )
  ) {
    return { ok: false, error: "invalid_peer_response", message: "Nearby DPF SAS commitment did not verify." };
  }
  const matchingCode = deriveSas({
    localDeviceId: input.requesterIdentity.deviceId,
    remoteDeviceId: body.receiverDeviceId,
    localEphemeralPublicKey: requesterEphemeral.publicKey,
    remoteEphemeralPublicKey: reveal.receiverEphemeralPublicKey,
    localNonce: requesterNonce,
    remoteNonce: reveal.receiverNonce,
    sharedSecret: deriveSharedSecret(requesterEphemeral.privateKey, reveal.receiverEphemeralPublicKey),
  });
  if (reveal.matchingCode !== matchingCode) {
    return { ok: false, error: "invalid_peer_response", message: "Nearby DPF SAS values did not match." };
  }
  return {
    ok: true,
    pairingId: body.pairingId,
    pairingSecret: body.pairingSecret,
    matchingCode,
    peerDisplayName: body.peerDisplayName,
    peerInstallationId: body.peerInstallationId,
    peerDeviceId: body.receiverDeviceId,
    peerSigningPublicKey: body.receiverSigningPublicKey,
    expiresAt: body.expiresAt,
    projectionSummary: body.projectionSummary,
  };
}

export type PollNearbyPairingPeerResult =
  | { ok: true; status: "pending" | "denied" | "expired" | "consumed" }
  | { ok: true; status: "approved"; bootstrapToken: string }
  | { ok: false; error: "tls_required" | "not_nearby" | "peer_unreachable" | "peer_rejected" | "invalid_peer_response"; message: string };

export type ConfirmNearbyPairingPeerResult =
  | { ok: true; status: "pending-confirmation" | "approved" }
  | { ok: false; error: "tls_required" | "not_nearby" | "peer_unreachable" | "peer_rejected" | "invalid_peer_response"; message: string };

export async function confirmNearbyPairingPeer(input: {
  candidateEndpoint: string;
  pairingId: string;
  pairingSecret: string;
  fetchImpl?: typeof fetch;
}): Promise<ConfirmNearbyPairingPeerResult> {
  let candidate: URL;
  try {
    candidate = new URL(input.candidateEndpoint);
  } catch {
    return { ok: false, error: "not_nearby", message: "Nearby DPF endpoint is invalid." };
  }
  if (candidate.protocol !== "https:") {
    return { ok: false, error: "tls_required", message: "Automatic pairing requires certificate-valid HTTPS." };
  }
  if (!isLinkLocalFederationEndpoint(input.candidateEndpoint)) {
    return { ok: false, error: "not_nearby", message: "Pairing endpoint is not on the nearby private network." };
  }
  if (
    !/^pair_[A-Za-z0-9_-]{3,160}$/.test(input.pairingId) ||
    !/^dpffpair_[A-Za-z0-9_-]{40,80}$/.test(input.pairingSecret)
  ) return { ok: false, error: "invalid_peer_response", message: "Stored pairing session is invalid." };
  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(
      `${candidate.href.replace(/\/+$/, "")}/connect/pair`,
      {
        method: "POST",
        redirect: "error",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          operation: "confirm",
          pairingId: input.pairingId,
          pairingSecret: input.pairingSecret,
        }),
      },
    );
  } catch {
    return { ok: false, error: "peer_unreachable", message: "The nearby DPF could not record the SAS confirmation." };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) return { ok: false, error: "peer_rejected", message: `Nearby DPF responded ${response.status}.` };
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "invalid_peer_response", message: "Nearby DPF returned an invalid confirmation." };
  }
  const value = body as Record<string, unknown>;
  if (value.ok !== true || !["pending-confirmation", "approved"].includes(String(value.status))) {
    return { ok: false, error: "invalid_peer_response", message: "Nearby DPF returned an invalid confirmation state." };
  }
  return { ok: true, status: value.status as "pending-confirmation" | "approved" };
}

export async function pollNearbyPairingPeer(input: {
  candidateEndpoint: string;
  pairingId: string;
  pairingSecret: string;
  fetchImpl?: typeof fetch;
}): Promise<PollNearbyPairingPeerResult> {
  let candidate: URL;
  try {
    candidate = new URL(input.candidateEndpoint);
  } catch {
    return { ok: false, error: "not_nearby", message: "Nearby DPF endpoint is invalid." };
  }
  if (candidate.protocol !== "https:") {
    return { ok: false, error: "tls_required", message: "Automatic pairing requires certificate-valid HTTPS." };
  }
  if (!isLinkLocalFederationEndpoint(input.candidateEndpoint)) {
    return { ok: false, error: "not_nearby", message: "Pairing endpoint is not on the nearby private network." };
  }
  if (
    !/^pair_[A-Za-z0-9_-]{3,160}$/.test(input.pairingId) ||
    !/^dpffpair_[A-Za-z0-9_-]{40,80}$/.test(input.pairingSecret)
  ) {
    return { ok: false, error: "invalid_peer_response", message: "Stored pairing session is invalid." };
  }
  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(
      `${candidate.href.replace(/\/+$/, "")}/connect/pair`,
      {
        method: "POST",
        redirect: "error",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          operation: "poll",
          pairingId: input.pairingId,
          pairingSecret: input.pairingSecret,
        }),
      },
    );
  } catch {
    return {
      ok: false,
      error: "peer_unreachable",
      message: "The nearby DPF could not be reached with a valid HTTPS certificate.",
    };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    return { ok: false, error: "peer_rejected", message: `Nearby DPF responded ${response.status}.` };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "invalid_peer_response", message: "Nearby DPF returned an invalid poll response." };
  }
  const value = body as Record<string, unknown>;
  if (value.ok !== true || !["pending", "approved", "denied", "expired", "consumed"].includes(String(value.status))) {
    return { ok: false, error: "invalid_peer_response", message: "Nearby DPF returned an invalid poll state." };
  }
  if (value.status === "approved") {
    if (typeof value.bootstrapToken !== "string" || !value.bootstrapToken.startsWith("dpffboot_")) {
      return { ok: false, error: "invalid_peer_response", message: "Approved pairing did not return a bootstrap token." };
    }
    return { ok: true, status: "approved", bootstrapToken: value.bootstrapToken };
  }
  return { ok: true, status: value.status as "pending" | "denied" | "expired" | "consumed" };
}
