import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { canonicalJson } from "@dpf/integration-shared/canonical-json";

import {
  noteSessionSecretGraceUse,
  signingKey,
  verificationKeys,
  type SigningKeySource,
} from "@/lib/auth/dedicated-signing-key";

const RECEIPT_SECRET_ENV = "DPF_DELEGATION_RECEIPT_SECRET";

export type CoworkerDelegationReceiptAccessProfile = "internal-a2a" | "partner-a2a" | "external-a2a";

export type CoworkerDelegationReceiptInput = {
  protocol: "a2a" | "mcp";
  accessProfile: CoworkerDelegationReceiptAccessProfile;
  offerId: string;
  serviceId: string;
  actingAgentGaid: string;
  delegatingAgentGaid: string;
  delegatedAgentId: string;
  delegatedAgentGaid: string;
  requestedOutcome: string;
  authorityBoundary: string;
  riskTier: string;
  requiredGrants?: string[];
  contractContext?: {
    termsRef?: string | null;
    dataBoundaryRef?: string | null;
    [key: string]: unknown;
  } | null;
};

export type CoworkerDelegationReceipt = CoworkerDelegationReceiptInput & {
  receiptKind: "coworker-delegation";
  receiptId: string;
  issuedAt: string;
  requestedOutcomeDigest: string;
  contractRefs: {
    termsRef: string | null;
    dataBoundaryRef: string | null;
  };
  signature: {
    alg: "HMAC-SHA256";
    keyId: string;
    value: string;
  };
};

export type CoworkerDelegationReceiptVerification =
  /** `verifiedWith` names the key that matched, so a grace-window fallback is observable. */
  | { ok: true; verifiedWith: SigningKeySource | "explicit" }
  | { ok: false; reason: "unsupported_algorithm" | "signature_mismatch" };

export function createCoworkerDelegationReceipt(
  input: CoworkerDelegationReceiptInput,
  options: { issuedAt?: Date; secret?: string; keyId?: string } = {},
): CoworkerDelegationReceipt {
  const issuedAt = (options.issuedAt ?? new Date()).toISOString();
  const unsigned = unsignedReceipt(input, issuedAt);
  const signature = signUnsignedReceipt(unsigned, options);
  return {
    ...unsigned,
    receiptId: `CDR-${createHash("sha256").update(signature.value).digest("hex").slice(0, 16).toUpperCase()}`,
    signature,
  };
}

export function verifyCoworkerDelegationReceipt(
  receipt: CoworkerDelegationReceipt,
  options: { secret?: string; now?: Date } = {},
): CoworkerDelegationReceiptVerification {
  if (receipt.signature.alg !== "HMAC-SHA256") return { ok: false, reason: "unsupported_algorithm" };
  const now = options.now ?? new Date();
  const keys = options.secret !== undefined
    ? [{ secret: options.secret, source: "explicit" as const }]
    : verificationKeys(RECEIPT_SECRET_ENV, now);
  const unsigned = stripSignature(receipt);
  const actual = Buffer.from(receipt.signature.value, "hex");
  const matched = keys.find((key) => {
    const expected = Buffer.from(
      signUnsignedReceipt(unsigned, { secret: key.secret, keyId: receipt.signature.keyId }).value,
      "hex",
    );
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  });
  if (!matched) return { ok: false, reason: "signature_mismatch" };
  if (matched.source === "session-secret-grace") {
    // Grace bound per handle: receipts carry no expiry, so only a receipt issued before the
    // verification moment (and so before the cutoff, which bounds the window) is accepted
    // under the session secret. verificationKeys already withholds the key after the cutoff.
    const issuedAt = Date.parse(receipt.issuedAt);
    if (!Number.isFinite(issuedAt) || issuedAt > now.getTime()) {
      return { ok: false, reason: "signature_mismatch" };
    }
    noteSessionSecretGraceUse("delegation-receipt");
  }
  return { ok: true, verifiedWith: matched.source };
}

function unsignedReceipt(
  input: CoworkerDelegationReceiptInput,
  issuedAt: string,
): Omit<CoworkerDelegationReceipt, "receiptId" | "signature"> {
  return {
    receiptKind: "coworker-delegation",
    protocol: input.protocol,
    accessProfile: input.accessProfile,
    offerId: input.offerId,
    serviceId: input.serviceId,
    actingAgentGaid: input.actingAgentGaid,
    delegatingAgentGaid: input.delegatingAgentGaid,
    delegatedAgentId: input.delegatedAgentId,
    delegatedAgentGaid: input.delegatedAgentGaid,
    requestedOutcome: input.requestedOutcome,
    requestedOutcomeDigest: digest(input.requestedOutcome),
    authorityBoundary: input.authorityBoundary,
    riskTier: input.riskTier,
    requiredGrants: [...(input.requiredGrants ?? [])].sort(),
    contractContext: input.contractContext ?? null,
    contractRefs: {
      termsRef: stringValue(input.contractContext?.termsRef),
      dataBoundaryRef: stringValue(input.contractContext?.dataBoundaryRef),
    },
    issuedAt,
  };
}

function stripSignature(receipt: CoworkerDelegationReceipt): Omit<CoworkerDelegationReceipt, "receiptId" | "signature"> {
  const { receiptId: _receiptId, signature: _signature, ...unsigned } = receipt;
  return unsigned;
}

function signUnsignedReceipt(
  unsigned: Omit<CoworkerDelegationReceipt, "receiptId" | "signature">,
  options: { secret?: string; keyId?: string },
): CoworkerDelegationReceipt["signature"] {
  return {
    alg: "HMAC-SHA256",
    keyId: options.keyId ?? process.env.DPF_DELEGATION_RECEIPT_KEY_ID ?? "local-install",
    value: createHmac("sha256", options.secret ?? receiptSecret())
      .update(stableJson(unsigned))
      .digest("hex"),
  };
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Whether this install can sign a receipt at all.
 *
 * Exposed so callers can decide EXPLICITLY rather than by catching an exception.
 * A2A task creation uses it to omit the receipt when no secret is configured:
 * emitting no receipt is truthful, whereas emitting one signed with a guessable
 * value is a lie that looks exactly like the real thing — and failing task
 * creation outright would turn a configuration gap into an outage of the whole
 * collaboration path (BI-2F318FB3).
 */
export function canSignDelegationReceipts(): boolean {
  try {
    receiptSecret();
    return true;
  } catch {
    return false;
  }
}

/**
 * Signing secret. Throws when unset — there is deliberately NO fallback constant.
 *
 * The previous default was a literal in this file, so anyone who could read the
 * repository could mint a receipt that verified. A receipt exists to let a
 * RECEIVING party trust a delegation they did not witness; one signed with a
 * public constant carries no such assurance while looking exactly like one that
 * does. Failing to start is the correct behaviour (BI-2F318FB3).
 */
function receiptSecret(): string {
  // The dedicated DPF_DELEGATION_RECEIPT_SECRET signs when set; an install without it keeps
  // signing with AUTH_SECRET / NEXTAUTH_SECRET (BI-F6929F50, lib/auth/dedicated-signing-key.ts).
  const key = signingKey(RECEIPT_SECRET_ENV);
  if (!key) {
    throw new Error(
      "Coworker delegation receipts require a signing secret: set DPF_DELEGATION_RECEIPT_SECRET (or AUTH_SECRET / NEXTAUTH_SECRET).",
    );
  }
  return key.secret;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

// Canonicalisation is delegated to the shared helper. The local copy sorted keys
// with `localeCompare`, which resolves against the host's default locale and ICU
// data — so the same receipt could canonicalise differently on two machines,
// producing a signature mismatch that looks exactly like tampering. That is the
// worst possible way for this to fail: the receipt exists to establish trust, and
// the failure mode accuses the counterparty of forging it (BI-2F318FB3).
const stableJson = canonicalJson;
