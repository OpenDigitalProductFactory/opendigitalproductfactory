import { createHmac, timingSafeEqual } from "node:crypto";

import type { TeardownEnvelope } from "./contract";

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stable(child)]),
    );
  }
  return value;
}

export function canonicalTeardownEnvelope(envelope: TeardownEnvelope): string {
  return canonicalJson(envelope);
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(stable(value));
}

export function signTeardownEnvelope(envelope: TeardownEnvelope, secret: string): string {
  if (secret.length < 32) throw new Error("teardown_signing_secret_invalid");
  return createHmac("sha256", secret).update(canonicalTeardownEnvelope(envelope)).digest("hex");
}

export function verifyTeardownEnvelopeSignature(
  envelope: TeardownEnvelope,
  signature: string,
  secret: string,
): boolean {
  if (!/^[a-f0-9]{64}$/.test(signature) || secret.length < 32) return false;
  const expected = signTeardownEnvelope(envelope, secret);
  return timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"));
}
