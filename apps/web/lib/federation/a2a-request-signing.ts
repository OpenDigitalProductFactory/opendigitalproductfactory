// Federated A2A request signing and verification (BI-B45BBD8A).
//
// Same model as the guidance snapshot (guidance-snapshot.ts): the sender signs
// with its installation's long-lived Ed25519 key, whose fingerprint is its DID.
// The receiver accepts the public key the request carries only when it hashes to
// the DID recorded on its trusted link to that sender, so no new key
// distribution is needed. Compact JWS (RFC 7515), alg EdDSA (RFC 8037).

import {
  a2aRequestSigningPayload,
  type A2aRequestV1,
} from "@dpf/db/federated-a2a-contract";

import {
  deriveDeviceId,
  signIdentityStatement,
  verifyIdentityStatement,
  type InstanceSigningKeypair,
} from "./instance-identity";

const JWS_TYPE = "dpf-a2a-request+jws";

function b64url(text: string): string {
  return Buffer.from(text, "utf8").toString("base64url");
}

/** Sign a request. sourceInstallationDid and the key are set from the keypair, never from the caller. */
export function signA2aRequest(
  unsigned: Omit<A2aRequestV1, "signature" | "sourceInstallationDid" | "sourceSigningPublicKey">,
  key: InstanceSigningKeypair,
): A2aRequestV1 {
  const body = {
    ...unsigned,
    sourceInstallationDid: deriveDeviceId(key.signingPublicKey),
    sourceSigningPublicKey: key.signingPublicKey,
  };
  const signingInput = `${b64url(JSON.stringify({ alg: "EdDSA", typ: JWS_TYPE, kid: body.sourceInstallationDid }))}.${
    b64url(a2aRequestSigningPayload(body))}`;
  const signature = Buffer.from(signIdentityStatement(key.signingPrivateKey, signingInput), "base64").toString("base64url");
  return { ...body, signature: `${signingInput}.${signature}` };
}

/**
 * True only when the signature is a valid EdDSA JWS by the key the request
 * carries, over exactly this request's content, and that key hashes to
 * `expectedSourceDid` (the DID on the receiver's link to the sender).
 */
export function verifyA2aRequestSignature(request: A2aRequestV1, expectedSourceDid: string): boolean {
  if (request.sourceInstallationDid !== expectedSourceDid) return false;
  let derived: string;
  try {
    derived = deriveDeviceId(request.sourceSigningPublicKey);
  } catch {
    return false;
  }
  if (derived !== expectedSourceDid) return false;
  const [header, payload, signature] = request.signature.split(".");
  if (!header || !payload || !signature) return false;
  try {
    const parsed = JSON.parse(Buffer.from(header, "base64url").toString("utf8")) as Record<string, unknown>;
    if (parsed.alg !== "EdDSA" || parsed.typ !== JWS_TYPE || parsed.kid !== expectedSourceDid) return false;
  } catch {
    return false;
  }
  // The signed payload must be exactly this request, so no field can be swapped
  // under a valid signature.
  if (Buffer.from(payload, "base64url").toString("utf8") !== a2aRequestSigningPayload(request)) return false;
  return verifyIdentityStatement(
    request.sourceSigningPublicKey,
    `${header}.${payload}`,
    Buffer.from(signature, "base64url").toString("base64"),
  );
}
