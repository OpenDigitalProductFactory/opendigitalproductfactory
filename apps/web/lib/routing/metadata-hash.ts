// apps/web/lib/routing/metadata-hash.ts
import { createHash } from "crypto";

/**
 * EP-INF-003: Compute deterministic SHA-256 hash of raw metadata.
 * Keys are sorted to ensure equivalent objects produce identical hashes
 * regardless of key ordering in the source JSON.
 */
export function computeMetadataHash(rawMetadata: unknown): string {
  const serialized = JSON.stringify(rawMetadata, sortReplacer);
  return createHash("sha256").update(serialized).digest("hex");
}

/** JSON.stringify replacer that sorts object keys for deterministic output. */
function sortReplacer(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((sorted, k) => {
        sorted[k] = (value as Record<string, unknown>)[k];
        return sorted;
      }, {});
  }
  return value;
}
