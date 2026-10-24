import { createHmac, timingSafeEqual } from "node:crypto";

/** Shared signature primitive; each domain retains its own payload and key policy. */
export function signCursor(encoded: string, secret: string): string {
  return createHmac("sha256", secret).update(encoded, "utf8").digest("base64url");
}

export function equalSignature(expected: string, actual: string): boolean {
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(actual, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}
