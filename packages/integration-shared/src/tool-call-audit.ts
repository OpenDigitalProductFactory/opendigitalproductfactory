import { createHash } from "node:crypto";

export function hashToolArgs(args: unknown): string {
  const record = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
  const canonical = JSON.stringify(record, Object.keys(record).sort());
  return createHash("sha256").update(canonical).digest("hex");
}
