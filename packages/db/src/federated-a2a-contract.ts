// Federated A2A request envelope (BI-B45BBD8A; design
// docs/superpowers/specs/2026-08-11-a2a-coordination-layer-design.md §7, §18.3, §19.4–19.5,
// and the dialog broker docs/superpowers/specs/2026-10-27-agent-dialog-broker-design.md §8).
//
// One signed request crosses a trusted same-organization link to the peer's
// `/api/v1/federation/a2a` ingress. The receiver owns the work it creates; the
// sender keeps only correlation. This module is pure: the shape, the signing
// input and the content digest. Signing and verifying with the installation key
// live beside that key, in apps/web/lib/federation/a2a-request-signing.ts.
//
// `requestId` is the durable idempotency key, scoped to the authenticated link.
// The CloudEvent `id` stays a transport identity and is never reused for it.

import { createHash } from "node:crypto";

import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { isRecord } from "@dpf/validators";

/** The outbox and inbox record type for A2A requests on FederatedRecordMirror. */
export const A2A_REQUEST_RECORD_TYPE = "a2a-request";

/**
 * Operations this ingress understands, each carried as one CloudEvent type.
 * The binding item (BI-ADB5CC1C) and cross-install rooms (BI-0F8CEAD4) register
 * further operations here; an unknown operation is refused as unsupported.
 */
export const A2A_REQUEST_OPERATIONS = ["task.submitted"] as const;
export type A2aRequestOperation = (typeof A2A_REQUEST_OPERATIONS)[number];

export const A2A_REQUEST_ACTIVITIES = A2A_REQUEST_OPERATIONS.map((operation) => `dpf.a2a.${operation}.v1`) as
  readonly `dpf.a2a.${A2aRequestOperation}.v1`[];

export function a2aActivityForOperation(operation: A2aRequestOperation): `dpf.a2a.${A2aRequestOperation}.v1` {
  return `dpf.a2a.${operation}.v1`;
}

/** Design §18.3: the sender proposes notAfter; 72 hours is the default. */
export const A2A_REQUEST_DEFAULT_LIFETIME_MS = 72 * 60 * 60 * 1000;
/** The receiver never accepts a request it may start further out than this. */
export const A2A_REQUEST_MAX_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000;
/** Bounds one request's payload so a single record cannot exhaust a receiver. */
export const A2A_REQUEST_MAX_PAYLOAD_BYTES = 64 * 1024;

const DID_RE = /^did_[a-f0-9]{64}$/;
const REQUEST_ID_RE = /^a2r_[A-Za-z0-9_-]{8,120}$/;

export interface A2aRequestProvenanceV1 {
  /** The sender's acting coworker GAID. Provenance only until BI-7E73D523 lands. */
  actingAgentGaid: string | null;
  delegatingAgentGaid: string | null;
}

export interface A2aRequestV1 {
  specVersion: "dpf.a2a-request/1";
  requestId: string;
  operation: A2aRequestOperation;
  createdAt: string;
  /** The latest moment the receiver may start the work. */
  notAfter: string;
  sourceInstallationDid: string;
  /** The sender's Ed25519 public key; accepted only when it hashes to the link's attested DID. */
  sourceSigningPublicKey: string;
  targetInstallationDid: string;
  organizationRef: string;
  requesterEnvironmentClass: string | null;
  /** The sender's own task id, echoed back so the sender can correlate. */
  senderTaskId: string | null;
  contextId: string | null;
  provenance: A2aRequestProvenanceV1;
  payload: Record<string, unknown>;
  /** Compact JWS (EdDSA) over a2aRequestSigningPayload. */
  signature: string;
}

/** The exact bytes the JWS signs: every field except the signature, canonically serialized. */
export function a2aRequestSigningPayload(request: Omit<A2aRequestV1, "signature"> & { signature?: string }): string {
  const { signature: _signature, ...signed } = request;
  return canonicalJson(signed);
}

/** Digest of the signed content; a reused requestId with a different digest is a conflict. */
export function a2aRequestDigest(request: Omit<A2aRequestV1, "signature"> & { signature?: string }): string {
  return `sha256:${createHash("sha256").update(a2aRequestSigningPayload(request)).digest("hex")}`;
}

function isIso(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function boundedString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function nullableBoundedString(value: unknown, max: number): boolean {
  return value === null || boundedString(value, max);
}

/** Shape check only. The caller verifies the signature against the link's DID. */
export function validateA2aRequestV1(value: unknown): string[] {
  if (!isRecord(value)) return ["request:invalid"];
  const out: string[] = [];
  if (value.specVersion !== "dpf.a2a-request/1") out.push("specVersion:unsupported");
  if (typeof value.requestId !== "string" || !REQUEST_ID_RE.test(value.requestId)) out.push("requestId:invalid");
  if (!(A2A_REQUEST_OPERATIONS as readonly string[]).includes(String(value.operation))) out.push("operation:unsupported");
  if (!isIso(value.createdAt)) out.push("createdAt:invalid");
  if (!isIso(value.notAfter)) out.push("notAfter:invalid");
  else if (isIso(value.createdAt) && Date.parse(value.notAfter) < Date.parse(value.createdAt)) {
    out.push("notAfter:before-createdAt");
  }
  if (typeof value.sourceInstallationDid !== "string" || !DID_RE.test(value.sourceInstallationDid)) {
    out.push("sourceInstallationDid:invalid");
  }
  if (!boundedString(value.sourceSigningPublicKey, 400)) out.push("sourceSigningPublicKey:invalid");
  if (typeof value.targetInstallationDid !== "string" || !DID_RE.test(value.targetInstallationDid)) {
    out.push("targetInstallationDid:invalid");
  }
  if (!boundedString(value.organizationRef, 200)) out.push("organizationRef:invalid");
  if (!nullableBoundedString(value.requesterEnvironmentClass, 40)) out.push("requesterEnvironmentClass:invalid");
  if (!nullableBoundedString(value.senderTaskId, 200)) out.push("senderTaskId:invalid");
  if (!nullableBoundedString(value.contextId, 300)) out.push("contextId:invalid");
  if (!isRecord(value.provenance)
    || !nullableBoundedString(value.provenance.actingAgentGaid, 300)
    || !nullableBoundedString(value.provenance.delegatingAgentGaid, 300)) {
    out.push("provenance:invalid");
  }
  if (!isRecord(value.payload)) out.push("payload:invalid");
  else if (Buffer.byteLength(JSON.stringify(value.payload)) > A2A_REQUEST_MAX_PAYLOAD_BYTES) out.push("payload:too-large");
  if (typeof value.signature !== "string" || value.signature.split(".").length !== 3) out.push("signature:invalid");
  return out;
}

/** The receiver's answer, carried in the ingress response body. */
export type A2aRequestReceiptV1 =
  | {
    specVersion: "dpf.a2a-receipt/1";
    requestId: string;
    outcome: "accepted" | "duplicate";
    /** The receiver-owned task id (its own id, never the sender's). */
    receiverTaskId: string;
    state: string;
  }
  | {
    specVersion: "dpf.a2a-receipt/1";
    requestId: string;
    outcome: "rejected";
    reason: A2aRequestRejection;
  };

export type A2aRequestRejection =
  | "disabled"
  | "link-not-eligible"
  | "malformed"
  | "bad-signature"
  | "source-mismatch"
  | "not-for-this-installation"
  | "organization-mismatch"
  | "expired"
  | "lifetime-too-long"
  | "request-id-conflict"
  | "unsupported-operation"
  | "target-unavailable"
  | "not-authorized";
