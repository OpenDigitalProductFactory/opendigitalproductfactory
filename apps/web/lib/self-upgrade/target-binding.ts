import { createHmac, timingSafeEqual } from "node:crypto";

import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import {
  noteSessionSecretGraceUse,
  signingKey,
  verificationKeys,
  type SigningKeyCandidate,
} from "@/lib/auth/dedicated-signing-key";
import { err, ok, type ActionResult } from "@/lib/shared/action-result";

export type SelfUpgradeBoundTarget = {
  targetKind: "release-artifact";
  targetSha: string;
  targetTag: string;
};

type BindingPayload = SelfUpgradeBoundTarget & {
  purpose: "self-upgrade-target-admission";
  version: 1;
  issuedAt: number;
  expiresAt: number;
};

type Verification = ActionResult<SelfUpgradeBoundTarget>;
type PayloadVerification = ActionResult<BindingPayload>;

export const SELF_UPGRADE_TARGET_BINDING_TTL_MS = 15 * 60 * 1_000;

const BINDING_SECRET_ENV = "DPF_SELF_UPGRADE_TARGET_BINDING_SECRET";

/**
 * The dedicated DPF_SELF_UPGRADE_TARGET_BINDING_SECRET signs when set; an install
 * without it keeps signing with AUTH_SECRET / NEXTAUTH_SECRET (BI-231A4BC7,
 * lib/auth/dedicated-signing-key.ts). A blank value counts as unset, because
 * docker-compose passes `${KEY:-}` to an install whose .env lacks the key.
 */
function signingSecret(): string {
  const key = signingKey(BINDING_SECRET_ENV);
  if (!key) {
    throw new Error(
      "Self-upgrade target bindings require a signing secret (DPF_SELF_UPGRADE_TARGET_BINDING_SECRET or AUTH_SECRET).",
    );
  }
  return key.secret;
}

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decode(value: string): string | null {
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    return encode(decoded) === value ? decoded : null;
  } catch {
    return null;
  }
}

function sign(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

function signaturesMatch(expected: string, actual: string): boolean {
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(actual, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

function validTarget(value: unknown): value is SelfUpgradeBoundTarget {
  if (!value || typeof value !== "object") return false;
  const target = value as Record<string, unknown>;
  return (
    target.targetKind === "release-artifact" &&
    typeof target.targetSha === "string" &&
    /^[0-9a-f]{40}$/i.test(target.targetSha) &&
    typeof target.targetTag === "string" &&
    target.targetTag.length > 0 &&
    target.targetTag.length <= 200 &&
    target.targetTag.trim() === target.targetTag
  );
}

function validPayload(value: unknown): value is BindingPayload {
  if (!validTarget(value)) return false;
  const payload = value as unknown as Record<string, unknown>;
  return (
    payload.purpose === "self-upgrade-target-admission" &&
    payload.version === 1 &&
    typeof payload.issuedAt === "number" &&
    Number.isFinite(payload.issuedAt) &&
    typeof payload.expiresAt === "number" &&
    Number.isFinite(payload.expiresAt) &&
    payload.expiresAt > payload.issuedAt
  );
}

export function createSelfUpgradeTargetBinding(
  target: SelfUpgradeBoundTarget,
  options: { now?: Date; ttlMs?: number; secret?: string } = {},
): string {
  if (!validTarget(target)) throw new Error("Invalid self-upgrade release target binding.");
  const issuedAt = (options.now ?? new Date()).getTime();
  const payload: BindingPayload = {
    purpose: "self-upgrade-target-admission",
    version: 1,
    ...target,
    issuedAt,
    expiresAt: issuedAt + (options.ttlMs ?? SELF_UPGRADE_TARGET_BINDING_TTL_MS),
  };
  const encoded = encode(canonicalJson(payload));
  return `${encoded}.${sign(encoded, options.secret ?? signingSecret())}`;
}

function verifySignedPayload(
  token: string,
  options: { now?: Date; secret?: string } = {},
): PayloadVerification {
  if (typeof token !== "string" || token.length === 0) return err("malformed");
  const separator = token.lastIndexOf(".");
  if (separator <= 0 || separator === token.length - 1) return err("malformed");
  const encoded = token.slice(0, separator);
  const actualSignature = token.slice(separator + 1);

  const now = options.now ?? new Date();
  const keys: Array<SigningKeyCandidate | { secret: string; source: "explicit" }> =
    options.secret !== undefined
      ? [{ secret: options.secret, source: "explicit" }]
      : verificationKeys(BINDING_SECRET_ENV, now);
  // No key at all is a configuration fault; report it as a mismatch, as before.
  const matched = keys.find((key) => signaturesMatch(sign(encoded, key.secret), actualSignature));
  if (!matched) return err("signature-mismatch");

  const decoded = decode(encoded);
  if (decoded === null) return err("malformed");
  let payload: unknown;
  try {
    payload = JSON.parse(decoded);
  } catch {
    return err("malformed");
  }
  if (!validPayload(payload)) return err("malformed");

  if (matched.source === "session-secret-grace") {
    // Grace bound per binding (BI-231A4BC7): a binding the pre-upgrade portal
    // signed with the session secret may claim no more life than one minted
    // now (SELF_UPGRADE_TARGET_BINDING_TTL_MS) and may not be issued in the
    // future. Genuine pre-upgrade bindings pass; a long-lived binding minted by
    // whoever holds AUTH_SECRET does not.
    if (
      payload.expiresAt - payload.issuedAt > SELF_UPGRADE_TARGET_BINDING_TTL_MS ||
      payload.issuedAt > now.getTime()
    ) {
      return err("signature-mismatch");
    }
    noteSessionSecretGraceUse("self-upgrade-target-binding");
  }
  return ok(payload);
}

/**
 * Compare a cryptographically valid rendered binding with an independently
 * resolved, current server target. Freshness is intentionally not authority
 * here: callers may use this only after current discovery has already supplied
 * the candidate. The function exposes no stale target for admission.
 */
export function matchesSignedSelfUpgradeTargetBinding(
  token: string,
  currentTarget: SelfUpgradeBoundTarget,
  options: { now?: Date; secret?: string } = {},
): boolean {
  const signed = verifySignedPayload(token, options);
  return signed.ok &&
    signed.data.targetKind === currentTarget.targetKind &&
    signed.data.targetSha.toLowerCase() === currentTarget.targetSha.toLowerCase() &&
    signed.data.targetTag === currentTarget.targetTag;
}

export function verifySelfUpgradeTargetBinding(
  token: string,
  options: { now?: Date; secret?: string } = {},
): Verification {
  const signed = verifySignedPayload(token, options);
  if (!signed.ok) return signed;
  if (signed.data.expiresAt <= (options.now ?? new Date()).getTime()) {
    return err("expired");
  }
  return ok({
    targetKind: signed.data.targetKind,
    targetSha: signed.data.targetSha,
    targetTag: signed.data.targetTag,
  });
}
