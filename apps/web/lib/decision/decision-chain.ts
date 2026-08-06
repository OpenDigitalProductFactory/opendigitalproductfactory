// Trust-envelope immutability — append-only hash chain over recorded decisions
// (BI-81CC5D8E, EP-VERIFICATION-INTEGRITY; spec
// docs/superpowers/specs/2026-08-05-trustworthy-decision-evidence-trust-envelope-design.md §2 Axis 3).
//
// A recorded kernel decision is sealed into a per-`chainId` linked hash chain so
// that any post-hoc edit is DETECTABLE. This is the always-on B1 tier the kernel
// scored (Fork B): DB-native, fully local, no external dependency. Signing (B2)
// and external anchoring (B3) are deferred tiers layered ON TOP of this — they do
// not replace it.
//
// Trust boundary: B1 alone detects tampering by an agent or a lower-privilege
// actor. It does NOT stop a full-DB-write operator from recomputing the whole
// chain — that is precisely what the deferred B2/B3 tiers add. The chain is the
// substrate those tiers sign/anchor.

import { createHash } from "node:crypto";

/** The immutable content of a decision that the chain commits to. */
export type SealablePayload = {
  /** Decision context/question text. */
  question: string;
  /** Option ids scored, in the order supplied. */
  optionIds: string[];
  /**
   * The scored criteria per option: dimension key -> magnitude. This is the
   * "weights/criteria" the record must not be able to silently change.
   */
  criteria: Record<string, Record<string, number>>;
  /**
   * Per-(option,dimension) evidence digests — NOT the raw evidence, just a
   * stable digest so the chain commits to "this score cited this evidence"
   * without duplicating the evidence store.
   */
  evidenceDigests: Record<string, Record<string, string>>;
  /** The recommended option id (or null when the gate abstained). */
  recommendedOptionId: string | null;
  /** The winning composite score (or null). */
  composite: number | null;
};

export type SealResult = {
  chainId: string;
  prevHash: string | null;
  chainEntryHash: string;
  sealedAt: Date;
};

export type ChainEntry = {
  chainEntryHash: string;
  prevHash: string | null;
  payload: SealablePayload;
};

export type ChainVerification =
  | { valid: true; length: number }
  | { valid: false; length: number; brokenAt: number; reason: string };

/**
 * Deterministic JSON: object keys sorted recursively so the same logical payload
 * always hashes identically regardless of key insertion order. Arrays keep their
 * order (order is meaningful for optionIds).
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** sha256 hex of the canonical payload linked to the previous entry hash. */
export function computeEntryHash(payload: SealablePayload, prevHash: string | null): string {
  const material = canonicalize({ prev: prevHash, payload });
  return createHash("sha256").update(material).digest("hex");
}

/** Stable digest of one evidence citation set, used to build `evidenceDigests`. */
export function digestEvidence(value: unknown): string {
  return createHash("sha256").update(canonicalize(value)).digest("hex").slice(0, 16);
}

/**
 * Seal a decision as the next entry in `chainId`, linking to the current head
 * (`prevHash`, null for the first entry). `now` is injected so callers stay
 * testable and deterministic.
 */
export function sealDecision(input: {
  chainId: string;
  prevHash: string | null;
  payload: SealablePayload;
  now: Date;
}): SealResult {
  return {
    chainId: input.chainId,
    prevHash: input.prevHash,
    chainEntryHash: computeEntryHash(input.payload, input.prevHash),
    sealedAt: input.now,
  };
}

/**
 * Verify a chain end-to-end: every entry's hash must recompute from its payload
 * and recorded prevHash, and each entry's prevHash must equal the prior entry's
 * hash. Entries are expected oldest-first.
 */
export function verifyChain(entries: ChainEntry[]): ChainVerification {
  let expectedPrev: string | null = null;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.prevHash !== expectedPrev) {
      return {
        valid: false,
        length: entries.length,
        brokenAt: i,
        reason: `prevHash mismatch: entry ${i} links to ${e.prevHash ?? "null"}, expected ${expectedPrev ?? "null"}`,
      };
    }
    const recomputed = computeEntryHash(e.payload, e.prevHash);
    if (recomputed !== e.chainEntryHash) {
      return {
        valid: false,
        length: entries.length,
        brokenAt: i,
        reason: `entry ${i} hash does not match its payload — the record was altered after sealing`,
      };
    }
    expectedPrev = e.chainEntryHash;
  }
  return { valid: true, length: entries.length };
}

/** Fields that become immutable once `sealedAt` is set. */
export const SEALED_IMMUTABLE_FIELDS = [
  "chainId",
  "prevHash",
  "chainEntryHash",
  "sealedAt",
  "question",
  "options",
  "scoredOptions",
  "recommendedOptionId",
  "sources",
  "evidenceBundle",
] as const;

export type AppendOnlyViolation = { field: string; from: unknown; to: unknown };

/**
 * The append-only write guard. Given the existing (already-sealed) row and an
 * incoming update, return every immutable field the update would change. A
 * non-empty result MUST block the write — the DecisionInteraction row carries a
 * Prisma `@updatedAt`, so append-only is enforced here by discipline, not by the
 * absence of an update path (spec §4). An unsealed row (no `sealedAt`) is exempt.
 */
export function findAppendOnlyViolations(
  existing: Record<string, unknown> & { sealedAt?: unknown },
  incoming: Record<string, unknown>,
): AppendOnlyViolation[] {
  if (!existing.sealedAt) return [];
  const violations: AppendOnlyViolation[] = [];
  for (const field of SEALED_IMMUTABLE_FIELDS) {
    if (!(field in incoming)) continue;
    const from = existing[field];
    const to = incoming[field];
    if (canonicalize(from) !== canonicalize(to)) {
      violations.push({ field, from, to });
    }
  }
  return violations;
}

export function assertAppendOnly(
  existing: Record<string, unknown> & { sealedAt?: unknown },
  incoming: Record<string, unknown>,
): void {
  const violations = findAppendOnlyViolations(existing, incoming);
  if (violations.length > 0) {
    const names = violations.map((v) => v.field).join(", ");
    throw new Error(
      `[decision-chain] append-only violation: cannot mutate sealed field(s) [${names}] on an immutable decision record`,
    );
  }
}
