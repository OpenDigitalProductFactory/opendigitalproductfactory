import { createHash } from "crypto";
import type { FindingIdentifierStability, FindingKeyInput } from "./types";

export function createFindingKey(input: FindingKeyInput): string {
  return createHash("sha256")
    .update(
      [
        input.adapterKey,
        input.findingKind,
        input.affectedType,
        input.affectedId,
        input.vendorIdentifier,
      ].join("::"),
    )
    .digest("hex")
    .slice(0, 24);
}

export function normalizeVendorIdentifier(
  vendorIdentifier: string | null | undefined,
  fallbackText: string,
): { identifier: string; stability: FindingIdentifierStability } {
  const trimmed = vendorIdentifier?.trim();
  if (trimmed) return { identifier: trimmed, stability: "strong" };

  const fallbackHash = createHash("sha256")
    .update(fallbackText.trim().toLowerCase())
    .digest("hex")
    .slice(0, 16);

  return { identifier: `weak:${fallbackHash}`, stability: "weak" };
}
