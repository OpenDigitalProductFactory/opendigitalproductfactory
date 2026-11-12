import { isBoundedTrustedJson } from "../bounded-trusted-json.ts";
import { projectHiveResultBundle } from "./result-projection.ts";

const OPAQUE_RECEIPT_RE = /^(?!BI-|WC-|FB-|EP-)[A-Za-z0-9._:-]{8,200}$/i;
const MAX_HIVE_RESULT_BYTES = 48 * 1024;

function legacyHiveResultJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(legacyHiveResultJson).join(",")}]`;
  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;
    return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${legacyHiveResultJson(row[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export type HiveResultIntake =
  | { ok: true; projected: Record<string, unknown>; payloadHash: string; sourceReceipt: string }
  | { ok: false; violations: string[] };

/** A trusted digest port hashes these exact legacy UTF-8 JSON bytes; no permission is implied. */
export function normalizeHiveResultIntakeWithDigest(payload: unknown, digestHex: (bytes: string) => string): HiveResultIntake {
  if (!isBoundedTrustedJson(payload)) return { ok: false, violations: ["payload:not-bounded-json"] };
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, violations: ["payload:invalid"] };
  }
  if (new TextEncoder().encode(legacyHiveResultJson(payload)).byteLength > MAX_HIVE_RESULT_BYTES) {
    return { ok: false, violations: ["payload:too-large"] };
  }
  const { projected, violations } = projectHiveResultBundle(payload as Record<string, unknown>);
  const sourceReceipt = projected.sourceReceipt;
  if (typeof sourceReceipt !== "string" || !OPAQUE_RECEIPT_RE.test(sourceReceipt)) {
    violations.push("sourceReceipt:not-opaque");
  }
  if (violations.length > 0) return { ok: false, violations };
  let hash: string;
  try { hash = digestHex(legacyHiveResultJson(projected)); } catch { return { ok: false, violations: ["digest:unavailable"] }; }
  if (!/^[a-f0-9]{64}$/.test(hash)) return { ok: false, violations: ["digest:invalid"] };
  return {
    ok: true,
    projected,
    sourceReceipt: sourceReceipt as string,
    payloadHash: `sha256:${hash}`,
  };
}

export function planHiveDeliveryAttempt(input:
  | { ok: true; remoteRef: string; attempts: number }
  | { ok: false; error: string; attempts: number; now: Date }
) {
  const attempts = input.attempts + 1;
  if (input.ok) {
    return { status: "delivered" as const, attempts, remoteRef: input.remoteRef, lastError: null, nextAttemptAt: null };
  }
  const now = input.now;
  const retryMinutes = Math.min(24 * 60, 5 * (2 ** Math.min(input.attempts, 8)));
  return {
    status: "retry" as const,
    attempts,
    remoteRef: null,
    lastError: input.error.slice(0, 1_000),
    nextAttemptAt: new Date(now.getTime() + retryMinutes * 60_000),
  };
}
