import { createHmac, timingSafeEqual } from "node:crypto";

import { canonicalJson } from "@/lib/shared/canonical-json";
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

export const SELF_UPGRADE_TARGET_BINDING_TTL_MS = 15 * 60 * 1_000;

function signingSecret(): string {
  const secret =
    process.env.DPF_SELF_UPGRADE_TARGET_BINDING_SECRET ??
    process.env.AUTH_SECRET ??
    process.env.NEXTAUTH_SECRET;
  if (!secret?.trim()) {
    throw new Error(
      "Self-upgrade target bindings require a signing secret (DPF_SELF_UPGRADE_TARGET_BINDING_SECRET or AUTH_SECRET).",
    );
  }
  return secret;
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

export function verifySelfUpgradeTargetBinding(
  token: string,
  options: { now?: Date; secret?: string } = {},
): Verification {
  if (typeof token !== "string" || token.length === 0) return err("malformed");
  const separator = token.lastIndexOf(".");
  if (separator <= 0 || separator === token.length - 1) return err("malformed");
  const encoded = token.slice(0, separator);
  const actualSignature = token.slice(separator + 1);

  let secret: string;
  try {
    secret = options.secret ?? signingSecret();
  } catch {
    return err("signature-mismatch");
  }
  if (!signaturesMatch(sign(encoded, secret), actualSignature)) {
    return err("signature-mismatch");
  }

  const decoded = decode(encoded);
  if (decoded === null) return err("malformed");
  let payload: unknown;
  try {
    payload = JSON.parse(decoded);
  } catch {
    return err("malformed");
  }
  if (!validPayload(payload)) return err("malformed");
  if (payload.expiresAt <= (options.now ?? new Date()).getTime()) {
    return err("expired");
  }
  return ok({
      targetKind: payload.targetKind,
      targetSha: payload.targetSha,
      targetTag: payload.targetTag,
  });
}
