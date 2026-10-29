// apps/web/lib/routing/metadata-hash.ts
import { createHash } from "crypto";
import { serializeLegacyMetadata } from "@dpf/validators/operating-composition/legacy-fingerprint";

/**
 * EP-INF-003: Compute deterministic SHA-256 hash of raw metadata.
 * Keys are sorted to ensure equivalent objects produce identical hashes
 * regardless of key ordering in the source JSON.
 */
export function computeMetadataHash(rawMetadata: unknown): string {
  const serialized = serializeLegacyMetadata(rawMetadata);
  return createHash("sha256").update(serialized!).digest("hex");
}
