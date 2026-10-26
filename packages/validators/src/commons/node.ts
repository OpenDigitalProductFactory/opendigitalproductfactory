import { createHash } from "node:crypto";
import { normalizeHiveResultIntakeWithDigest, planHiveDeliveryAttempt } from "./result-intake.ts";
export function normalizeHiveResultIntake(payload: unknown) {
  return normalizeHiveResultIntakeWithDigest(payload, (bytes) => createHash("sha256").update(bytes).digest("hex"));
}
/** Compatibility for the existing host retry policy; portable callers supply trusted time. */
export function resolveHiveDeliveryAttempt(input: { ok: true; remoteRef: string; attempts: number } | { ok: false; error: string; attempts: number; now?: Date }) {
  return input.ok ? planHiveDeliveryAttempt(input) : planHiveDeliveryAttempt({ ...input, now: input.now ?? new Date() });
}
