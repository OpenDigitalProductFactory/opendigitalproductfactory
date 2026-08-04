import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { canonicalJson } from "@/lib/shared/canonical-json";

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
  | { ok: true }
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
  options: { secret?: string } = {},
): CoworkerDelegationReceiptVerification {
  if (receipt.signature.alg !== "HMAC-SHA256") return { ok: false, reason: "unsupported_algorithm" };
  const expected = signUnsignedReceipt(stripSignature(receipt), {
    secret: options.secret,
    keyId: receipt.signature.keyId,
  });
  const actual = Buffer.from(receipt.signature.value, "hex");
  const expectedValue = Buffer.from(expected.value, "hex");
  if (actual.length !== expectedValue.length || !timingSafeEqual(actual, expectedValue)) {
    return { ok: false, reason: "signature_mismatch" };
  }
  return { ok: true };
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
 * Signing secret. Throws when unset — there is deliberately NO fallback constant.
 *
 * The previous default was a literal in this file, so anyone who could read the
 * repository could mint a receipt that verified. A receipt exists to let a
 * RECEIVING party trust a delegation they did not witness; one signed with a
 * public constant carries no such assurance while looking exactly like one that
 * does. Failing to start is the correct behaviour (BI-2F318FB3).
 */
function receiptSecret(): string {
  const secret =
    process.env.DPF_DELEGATION_RECEIPT_SECRET ??
    process.env.AUTH_SECRET ??
    process.env.NEXTAUTH_SECRET;
  if (!secret || secret.trim().length === 0) {
    throw new Error(
      "Coworker delegation receipts require a signing secret: set DPF_DELEGATION_RECEIPT_SECRET (or AUTH_SECRET / NEXTAUTH_SECRET).",
    );
  }
  return secret;
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
