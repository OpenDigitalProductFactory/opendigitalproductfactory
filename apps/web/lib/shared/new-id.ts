// apps/web/lib/shared/new-id.ts
//
// Owned id generator over Node crypto — replaces the nanoid dependency
// (EP-8DC217EB BET-14, kernel-approved own-newid-facade, HIGH, margin 3.115).
// URL-safe, collision-resistant; matches nanoid's default alphabet semantics
// closely enough for non-cryptographic unique ids (which is every call site).
//
// The ids are opaque unique strings, so exact byte-for-byte parity with nanoid
// is not required. We deliberately keep nanoid's default 64-char url-safe
// alphabet and its `byte & 63` mapping so the OUTPUT SHAPE (character set and
// length) is unchanged — no downstream length/charset assumption can break.
import { randomBytes } from "node:crypto";

// nanoid's default 64-char url-safe alphabet.
const ALPHABET =
  "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";

/**
 * Generate a url-safe unique id of `size` characters (default 21, matching
 * nanoid's default). Each character is drawn from a 64-symbol alphabet via
 * `byte & 63`, so the distribution is uniform and no rejection loop is needed.
 */
export function newId(size = 21): string {
  const bytes = randomBytes(size);
  let id = "";
  for (let i = 0; i < size; i++) {
    id += ALPHABET[bytes[i] & 63];
  }
  return id;
}
