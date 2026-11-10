// The exact-call parameter hash a GPP permit binds (spec §5.6, plan PR-D).
//
// paramHash = SHA-256(canonicalJson({ tool, params })), lowercase hex. Bound at
// mint for every outward, authority or irreversible call, and recomputed by the
// reference monitor for the call it receives: a handle replayed with other
// arguments records `param_mismatch`.
//
// Uses the one shared canonicaliser. The existing exact-call fingerprints are
// not reused: `fingerprintCoworkerInput` sorts keys with `localeCompare`, which
// is host-locale dependent (see delegation-receipt.ts), and `digestPayload` is
// a slow scrypt. Converging those on canonicalJson changes live approval
// bindings, so it is separate work. Pure.

import { createHash } from "node:crypto";

import { canonicalJson } from "@dpf/integration-shared/canonical-json";

export function computeParamHash(toolName: string, params: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalJson({ tool: toolName, params })).digest("hex");
}
