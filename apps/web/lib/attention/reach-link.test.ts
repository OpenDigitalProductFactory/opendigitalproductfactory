import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createReachLink,
  reachLinkExpiry,
  verifyReachLink,
  type ReachLinkPayload,
} from "./reach-link";

const SECRET = "test-reach-secret";
const NOW = new Date("2026-08-01T12:00:00.000Z");

function payload(overrides: Partial<ReachLinkPayload> = {}): ReachLinkPayload {
  return {
    itemId: "business-journey:journey-failure:storefront-booking",
    deepLink: "/ops/journeys?journey=storefront-booking",
    exp: NOW.getTime() + 60_000,
    ...overrides,
  };
}

describe("reach link round trip", () => {
  it("verifies a well-formed, unexpired token", () => {
    const token = createReachLink(payload(), { secret: SECRET });
    const result = verifyReachLink(token, { secret: SECRET, now: NOW });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.itemId).toBe(payload().itemId);
      expect(result.payload.deepLink).toBe(payload().deepLink);
    }
  });

  it("does not depend on key insertion order — the signed bytes are canonical", () => {
    const a = createReachLink(
      { itemId: "i", deepLink: "/x", exp: NOW.getTime() + 1000 },
      { secret: SECRET },
    );
    const b = createReachLink(
      { exp: NOW.getTime() + 1000, deepLink: "/x", itemId: "i" } as ReachLinkPayload,
      { secret: SECRET },
    );
    expect(a).toBe(b);
  });
});

describe("reach link fails closed", () => {
  it("rejects a tampered itemId", () => {
    const token = createReachLink(payload(), { secret: SECRET });
    const [encoded, signature] = token.split(".");
    const decoded = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    decoded.itemId = "approval-bill:someone-elses-bill";
    const forged = `${Buffer.from(JSON.stringify(decoded), "utf8").toString("base64url")}.${signature}`;

    expect(verifyReachLink(forged, { secret: SECRET, now: NOW })).toEqual({
      ok: false,
      reason: "signature_mismatch",
    });
  });

  it("rejects an attempt to extend the lifetime by editing exp", () => {
    // The signature is checked BEFORE the payload is trusted for anything, including its
    // own expiry — otherwise a stale link could be renewed by whoever holds it.
    const token = createReachLink(payload({ exp: NOW.getTime() - 1 }), { secret: SECRET });
    const [encoded, signature] = token.split(".");
    const decoded = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    decoded.exp = NOW.getTime() + 999_999;
    const forged = `${Buffer.from(JSON.stringify(decoded), "utf8").toString("base64url")}.${signature}`;

    expect(verifyReachLink(forged, { secret: SECRET, now: NOW })).toEqual({
      ok: false,
      reason: "signature_mismatch",
    });
  });

  it("rejects a token signed with a different secret", () => {
    const token = createReachLink(payload(), { secret: "attacker-secret" });
    expect(verifyReachLink(token, { secret: SECRET, now: NOW })).toEqual({
      ok: false,
      reason: "signature_mismatch",
    });
  });

  it("reports an expired token distinguishably, so the operator gets a true message", () => {
    const token = createReachLink(payload({ exp: NOW.getTime() - 1 }), { secret: SECRET });
    expect(verifyReachLink(token, { secret: SECRET, now: NOW })).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("treats the expiry boundary as expired rather than valid", () => {
    const token = createReachLink(payload({ exp: NOW.getTime() }), { secret: SECRET });
    expect(verifyReachLink(token, { secret: SECRET, now: NOW }).ok).toBe(false);
  });

  it.each([
    ["empty", ""],
    ["no separator", "abcdef"],
    ["empty signature", "abcdef."],
    ["empty payload", ".abcdef"],
    ["not base64url", "!!!.$$$"],
  ])("rejects a malformed token (%s)", (_label, token) => {
    expect(verifyReachLink(token, { secret: SECRET, now: NOW }).ok).toBe(false);
  });
});

describe("reach link cannot become an open redirect", () => {
  it.each([
    ["absolute http", "http://evil.test/steal"],
    ["absolute https", "https://evil.test/steal"],
    ["protocol-relative", "//evil.test/steal"],
    ["no leading slash", "ops/journeys"],
  ])("rejects a deepLink that leaves the app (%s)", (_label, deepLink) => {
    // Signed by US, so the signature is valid — the payload shape check is the only thing
    // standing between a reach link and an open redirect.
    const token = createReachLink(payload({ deepLink }) as ReachLinkPayload, { secret: SECRET });
    expect(verifyReachLink(token, { secret: SECRET, now: NOW })).toEqual({
      ok: false,
      reason: "malformed",
    });
  });
});

describe("signing secret", () => {
  const saved = {
    reach: process.env.DPF_ATTENTION_REACH_SECRET,
    auth: process.env.AUTH_SECRET,
    nextAuth: process.env.NEXTAUTH_SECRET,
  };

  beforeEach(() => {
    delete process.env.DPF_ATTENTION_REACH_SECRET;
    delete process.env.AUTH_SECRET;
    delete process.env.NEXTAUTH_SECRET;
  });

  afterEach(() => {
    if (saved.reach === undefined) delete process.env.DPF_ATTENTION_REACH_SECRET;
    else process.env.DPF_ATTENTION_REACH_SECRET = saved.reach;
    if (saved.auth === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = saved.auth;
    if (saved.nextAuth === undefined) delete process.env.NEXTAUTH_SECRET;
    else process.env.NEXTAUTH_SECRET = saved.nextAuth;
  });

  it("throws rather than falling back to a constant when no secret is configured", () => {
    // A hardcoded default would let anyone who can read the repo mint valid links.
    expect(() => createReachLink(payload())).toThrow(/signing secret/i);
  });

  it("does not leak the misconfiguration to whoever holds the URL", () => {
    // Verification reports a plain mismatch rather than "the server has no secret".
    expect(verifyReachLink("abc.def", { now: NOW })).toEqual({
      ok: false,
      reason: "signature_mismatch",
    });
  });

  it("accepts AUTH_SECRET as a fallback source", () => {
    process.env.AUTH_SECRET = "from-auth-secret";
    const token = createReachLink(payload());
    expect(verifyReachLink(token, { now: NOW }).ok).toBe(true);
  });
});

describe("reachLinkExpiry", () => {
  it("defaults to a bounded lifetime rather than never expiring", () => {
    const exp = reachLinkExpiry(NOW);
    expect(exp).toBeGreaterThan(NOW.getTime());
    // A decision left for longer than this should be re-sent with fresh context.
    expect(exp - NOW.getTime()).toBeLessThanOrEqual(7 * 24 * 60 * 60 * 1000);
  });
});
