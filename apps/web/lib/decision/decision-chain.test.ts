import { describe, it, expect } from "vitest";
import {
  sealDecision,
  verifyChain,
  computeEntryHash,
  canonicalize,
  findAppendOnlyViolations,
  assertAppendOnly,
  type SealablePayload,
  type ChainEntry,
} from "./decision-chain";

const NOW = new Date("2026-08-06T00:00:00.000Z");

function payload(over: Partial<SealablePayload> = {}): SealablePayload {
  return {
    question: "which immutability mechanism?",
    optionIds: ["a", "b"],
    criteria: { a: { governance_compliance: 0.9 }, b: { speed_to_value: 0.8 } },
    evidenceDigests: { a: { governance_compliance: "deadbeef" } },
    recommendedOptionId: "a",
    composite: 12.6,
    ...over,
  };
}

describe("decision-chain", () => {
  it("canonicalize is key-order independent but array-order sensitive", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
    expect(canonicalize([1, 2])).not.toBe(canonicalize([2, 1]));
  });

  it("seal is deterministic for the same payload + prevHash", () => {
    const a = sealDecision({ chainId: "c1", prevHash: null, payload: payload(), now: NOW });
    const b = sealDecision({ chainId: "c1", prevHash: null, payload: payload(), now: NOW });
    expect(a.chainEntryHash).toBe(b.chainEntryHash);
    expect(a.prevHash).toBeNull();
  });

  it("changing any sealed content changes the hash", () => {
    const base = computeEntryHash(payload(), null);
    expect(computeEntryHash(payload({ composite: 12.7 }), null)).not.toBe(base);
    expect(computeEntryHash(payload({ recommendedOptionId: "b" }), null)).not.toBe(base);
    expect(computeEntryHash(payload(), "prev-abc")).not.toBe(base);
  });

  it("verifyChain accepts a well-formed linked chain", () => {
    const e1 = sealDecision({ chainId: "c", prevHash: null, payload: payload(), now: NOW });
    const e2 = sealDecision({ chainId: "c", prevHash: e1.chainEntryHash, payload: payload({ optionIds: ["c", "d"] }), now: NOW });
    const entries: ChainEntry[] = [
      { chainEntryHash: e1.chainEntryHash, prevHash: e1.prevHash, payload: payload() },
      { chainEntryHash: e2.chainEntryHash, prevHash: e2.prevHash, payload: payload({ optionIds: ["c", "d"] }) },
    ];
    expect(verifyChain(entries)).toEqual({ valid: true, length: 2 });
  });

  it("verifyChain detects a payload altered after sealing", () => {
    const e1 = sealDecision({ chainId: "c", prevHash: null, payload: payload(), now: NOW });
    const tampered: ChainEntry[] = [
      // hash was computed for composite 12.6; the stored payload now says 99.
      { chainEntryHash: e1.chainEntryHash, prevHash: null, payload: payload({ composite: 99 }) },
    ];
    const result = verifyChain(tampered);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.brokenAt).toBe(0);
  });

  it("verifyChain detects a broken prevHash link", () => {
    const e1 = sealDecision({ chainId: "c", prevHash: null, payload: payload(), now: NOW });
    const e2 = sealDecision({ chainId: "c", prevHash: e1.chainEntryHash, payload: payload(), now: NOW });
    const entries: ChainEntry[] = [
      { chainEntryHash: e1.chainEntryHash, prevHash: null, payload: payload() },
      // link points at nothing valid
      { chainEntryHash: e2.chainEntryHash, prevHash: "wrong-link", payload: payload() },
    ];
    const result = verifyChain(entries);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.brokenAt).toBe(1);
  });

  it("append-only guard blocks mutating a sealed immutable field", () => {
    const existing = { sealedAt: NOW, question: "original", composite: 1 };
    const violations = findAppendOnlyViolations(existing, { question: "rewritten" });
    expect(violations.map((v) => v.field)).toContain("question");
    expect(() => assertAppendOnly(existing, { question: "rewritten" })).toThrow(/append-only/);
  });

  it("append-only guard is a no-op on an unsealed row", () => {
    const unsealed = { sealedAt: null, question: "draft" };
    expect(findAppendOnlyViolations(unsealed, { question: "edited" })).toEqual([]);
    expect(() => assertAppendOnly(unsealed, { question: "edited" })).not.toThrow();
  });

  it("append-only guard permits appending non-immutable fields (e.g. humanOutcome)", () => {
    const existing = { sealedAt: NOW, question: "q", humanOutcome: null };
    expect(findAppendOnlyViolations(existing, { humanOutcome: { chosenOptionId: "a" } })).toEqual([]);
  });
});
