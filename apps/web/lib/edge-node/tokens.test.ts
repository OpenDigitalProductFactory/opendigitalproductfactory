import { describe, expect, it } from "vitest";

import {
  BOOTSTRAP_TOKEN_DEFAULT_TTL_MS,
  BOOTSTRAP_TOKEN_MAX_TTL_MS,
  BOOTSTRAP_TOKEN_PREFIX,
  EDGE_NODE_TOKEN_PREFIX,
} from "@dpf/db/edge-node-types";

import {
  classifyTokenPrefix,
  computeBootstrapExpiry,
  generateBootstrapToken,
  generateNodeToken,
  hashToken,
} from "./tokens";

describe("tokens — generateBootstrapToken", () => {
  it("emits a dpfboot_-prefixed token + sha256 hash", () => {
    const t = generateBootstrapToken();
    expect(t.plaintext.startsWith(BOOTSTRAP_TOKEN_PREFIX)).toBe(true);
    expect(t.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(t.prefix.length).toBe(12);
    expect(t.prefix.startsWith(BOOTSTRAP_TOKEN_PREFIX)).toBe(true);
  });

  it("emits unique tokens across calls", () => {
    const a = generateBootstrapToken();
    const b = generateBootstrapToken();
    expect(a.plaintext).not.toBe(b.plaintext);
    expect(a.hash).not.toBe(b.hash);
  });

  it("hash matches hashToken(plaintext)", () => {
    const t = generateBootstrapToken();
    expect(hashToken(t.plaintext)).toBe(t.hash);
  });
});

describe("tokens — generateNodeToken", () => {
  it("emits a dpfedge_-prefixed token + sha256 hash", () => {
    const t = generateNodeToken();
    expect(t.plaintext.startsWith(EDGE_NODE_TOKEN_PREFIX)).toBe(true);
    expect(t.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(t.prefix.startsWith(EDGE_NODE_TOKEN_PREFIX)).toBe(true);
  });

  it("plaintext never contains the literal 'undefined' (base32 alphabet sanity)", () => {
    // Defensive: BASE32_ALPHABET length mismatch would template-literal
    // `undefined` into the secret. Catches a class of regression that
    // is otherwise silent.
    for (let i = 0; i < 100; i++) {
      const t = generateNodeToken();
      expect(t.plaintext).not.toContain("undefined");
    }
  });
});

describe("tokens — hashToken", () => {
  it("is deterministic", () => {
    const sample = "dpfedge_TESTTESTTESTTEST";
    expect(hashToken(sample)).toBe(hashToken(sample));
  });

  it("produces 64 hex chars (sha256)", () => {
    expect(hashToken("any input")).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("tokens — computeBootstrapExpiry", () => {
  const now = new Date("2026-05-12T12:00:00Z");

  it("uses default TTL when no argument", () => {
    const expiry = computeBootstrapExpiry(undefined, now);
    expect(expiry.getTime() - now.getTime()).toBe(BOOTSTRAP_TOKEN_DEFAULT_TTL_MS);
  });

  it("honors a shorter TTL", () => {
    const expiry = computeBootstrapExpiry(60_000, now);
    expect(expiry.getTime() - now.getTime()).toBe(60_000);
  });

  it("caps at the spec's max TTL", () => {
    const oneWeek = 7 * 24 * 60 * 60 * 1000;
    const expiry = computeBootstrapExpiry(oneWeek, now);
    expect(expiry.getTime() - now.getTime()).toBe(BOOTSTRAP_TOKEN_MAX_TTL_MS);
  });

  it("clamps non-positive TTL to 1ms (degenerate but not throwing)", () => {
    const expiry = computeBootstrapExpiry(-1000, now);
    expect(expiry.getTime() - now.getTime()).toBe(1);
  });
});

describe("tokens — classifyTokenPrefix", () => {
  it("recognizes node tokens", () => {
    expect(classifyTokenPrefix("dpfedge_ABCDEF")).toBe("node");
  });

  it("recognizes bootstrap tokens", () => {
    expect(classifyTokenPrefix("dpfboot_ABCDEF")).toBe("bootstrap");
  });

  it("returns null for unknown prefix", () => {
    expect(classifyTokenPrefix("dpfmcp_ABCDEF")).toBe(null);
    expect(classifyTokenPrefix("Bearer dpfedge_ABC")).toBe(null);
    expect(classifyTokenPrefix("")).toBe(null);
    expect(classifyTokenPrefix("garbage")).toBe(null);
  });
});
