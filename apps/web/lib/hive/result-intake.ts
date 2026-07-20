import { createHash } from "node:crypto";

import { projectHiveResultBundle } from "@/lib/integrate/contribution-egress";

const OPAQUE_RECEIPT_RE = /^(?!BI-|WC-|FB-|EP-)[A-Za-z0-9._:-]{8,200}$/i;
const MAX_HIVE_RESULT_BYTES = 48 * 1024;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;
    return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${stableJson(row[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export type HiveResultIntake =
  | { ok: true; projected: Record<string, unknown>; payloadHash: string; sourceReceipt: string }
  | { ok: false; violations: string[] };

export function normalizeHiveResultIntake(payload: unknown): HiveResultIntake {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, violations: ["payload:invalid"] };
  }
  if (Buffer.byteLength(stableJson(payload), "utf8") > MAX_HIVE_RESULT_BYTES) {
    return { ok: false, violations: ["payload:too-large"] };
  }
  const { projected, violations } = projectHiveResultBundle(payload as Record<string, unknown>);
  const sourceReceipt = projected.sourceReceipt;
  if (typeof sourceReceipt !== "string" || !OPAQUE_RECEIPT_RE.test(sourceReceipt)) {
    violations.push("sourceReceipt:not-opaque");
  }
  if (violations.length > 0) return { ok: false, violations };
  return {
    ok: true,
    projected,
    sourceReceipt: sourceReceipt as string,
    payloadHash: `sha256:${createHash("sha256").update(stableJson(projected)).digest("hex")}`,
  };
}

export function resolveHiveDeliveryAttempt(input:
  | { ok: true; remoteRef: string; attempts: number }
  | { ok: false; error: string; attempts: number; now?: Date }
) {
  const attempts = input.attempts + 1;
  if (input.ok) {
    return { status: "delivered" as const, attempts, remoteRef: input.remoteRef, lastError: null, nextAttemptAt: null };
  }
  const now = input.now ?? new Date();
  const retryMinutes = Math.min(24 * 60, 5 * (2 ** Math.min(input.attempts, 8)));
  return {
    status: "retry" as const,
    attempts,
    remoteRef: null,
    lastError: input.error.slice(0, 1_000),
    nextAttemptAt: new Date(now.getTime() + retryMinutes * 60_000),
  };
}
