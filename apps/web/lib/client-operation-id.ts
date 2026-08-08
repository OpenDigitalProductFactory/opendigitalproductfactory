const UUID_RANDOM_BYTES = 16;

function uuidFromRandomBytes(bytes: Uint8Array): string {
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Returns a collision-resistant identifier for client command idempotency.
 * `randomUUID` requires a secure context in browsers, while `getRandomValues`
 * remains available on the LAN-hosted HTTP installs DPF supports.
 */
export function createClientOperationId(): string {
  const crypto = globalThis.crypto;

  if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();

  if (typeof crypto?.getRandomValues === "function") {
    const bytes = new Uint8Array(UUID_RANDOM_BYTES);
    crypto.getRandomValues(bytes);
    return uuidFromRandomBytes(bytes);
  }

  throw new Error("Web Crypto is required to create client operation identifiers");
}
