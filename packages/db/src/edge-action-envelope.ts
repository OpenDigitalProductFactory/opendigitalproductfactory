import { sign, verify, type KeyObject } from "node:crypto";

export const EDGE_ACTION_ENVELOPE_VERSION = "dpf.edge-action/1" as const;
export const MAX_EDGE_ACTION_ENVELOPE_LIFETIME_MS = 5 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 30 * 1000;

export interface EdgeActionEnvelope {
  version: typeof EDGE_ACTION_ENVELOPE_VERSION;
  signingKeyId: string;
  actionKey: string;
  nodeId: string;
  actionType: string;
  parameters: unknown;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
}

export interface SignedEdgeActionEnvelope extends EdgeActionEnvelope {
  signature: string;
}

export type EdgeActionEnvelopeVerification =
  | { ok: true; nonce: string }
  | {
      ok: false;
      reason:
        | "invalid-envelope"
        | "invalid-signature"
        | "wrong-node"
        | "not-yet-valid"
        | "expired"
        | "lifetime-too-long"
        | "nonce-already-consumed";
    };

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Edge action parameters must contain finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
      .join(",")}}`;
  }
  throw new TypeError(`Edge action envelope contains unsupported ${typeof value}`);
}

export function canonicalizeEdgeActionEnvelope(envelope: EdgeActionEnvelope): string {
  const { version, signingKeyId, actionKey, nodeId, actionType, parameters, nonce, issuedAt, expiresAt } = envelope;
  return canonicalJson({ actionKey, actionType, expiresAt, issuedAt, nodeId, nonce, parameters, signingKeyId, version });
}

export function signEdgeActionEnvelope(envelope: EdgeActionEnvelope, privateKey: KeyObject): SignedEdgeActionEnvelope {
  const signature = sign(null, Buffer.from(canonicalizeEdgeActionEnvelope(envelope), "utf8"), privateKey);
  return { ...envelope, signature: signature.toString("base64url") };
}

export function verifyEdgeActionEnvelope(
  signed: SignedEdgeActionEnvelope,
  options: {
    publicKey: KeyObject;
    expectedNodeId: string;
    now?: Date;
    hasConsumedNonce?: (nonce: string) => boolean;
  },
): EdgeActionEnvelopeVerification {
  const { signature, ...envelope } = signed;
  if (
    envelope.version !== EDGE_ACTION_ENVELOPE_VERSION ||
    !envelope.signingKeyId || !envelope.actionKey || !envelope.nodeId || !envelope.actionType ||
    !envelope.nonce || !envelope.issuedAt || !envelope.expiresAt || !signature
  ) return { ok: false, reason: "invalid-envelope" };

  const signatureBytes = Buffer.from(signature, "base64url");
  if (
    signatureBytes.length !== 64 ||
    !verify(null, Buffer.from(canonicalizeEdgeActionEnvelope(envelope), "utf8"), options.publicKey, signatureBytes)
  ) return { ok: false, reason: "invalid-signature" };
  if (envelope.nodeId !== options.expectedNodeId) return { ok: false, reason: "wrong-node" };

  const issuedAt = Date.parse(envelope.issuedAt);
  const expiresAt = Date.parse(envelope.expiresAt);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= issuedAt) {
    return { ok: false, reason: "invalid-envelope" };
  }
  if (expiresAt - issuedAt > MAX_EDGE_ACTION_ENVELOPE_LIFETIME_MS) return { ok: false, reason: "lifetime-too-long" };
  const now = (options.now ?? new Date()).getTime();
  if (issuedAt > now + MAX_CLOCK_SKEW_MS) return { ok: false, reason: "not-yet-valid" };
  if (expiresAt <= now) return { ok: false, reason: "expired" };
  if (options.hasConsumedNonce?.(envelope.nonce)) return { ok: false, reason: "nonce-already-consumed" };
  return { ok: true, nonce: envelope.nonce };
}
