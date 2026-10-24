import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SESSION_SECRET_GRACE_CUTOFF } from "@/lib/auth/dedicated-signing-key";

import {
  createReachLink,
  REACH_LINK_TTL_MS,
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

describe("dedicated key with a bounded AUTH_SECRET grace window (BI-F6929F50)", () => {
  const DEDICATED = "fixture-dedicated-reach-key";
  const SESSION = "fixture-session-secret";
  const BEFORE_CUTOFF = new Date(SESSION_SECRET_GRACE_CUTOFF.getTime() - 24 * 60 * 60 * 1000);
  const AFTER_CUTOFF = new Date(SESSION_SECRET_GRACE_CUTOFF.getTime() + 1);
  const saved = {
    reach: process.env.DPF_ATTENTION_REACH_SECRET,
    auth: process.env.AUTH_SECRET,
    nextAuth: process.env.NEXTAUTH_SECRET,
  };
  const at = (now: Date, overrides: Partial<ReachLinkPayload> = {}) =>
    payload({ exp: now.getTime() + 60_000, ...overrides });

  beforeEach(() => {
    process.env.DPF_ATTENTION_REACH_SECRET = DEDICATED;
    process.env.AUTH_SECRET = SESSION;
    delete process.env.NEXTAUTH_SECRET;
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (saved.reach === undefined) delete process.env.DPF_ATTENTION_REACH_SECRET;
    else process.env.DPF_ATTENTION_REACH_SECRET = saved.reach;
    if (saved.auth === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = saved.auth;
    if (saved.nextAuth === undefined) delete process.env.NEXTAUTH_SECRET;
    else process.env.NEXTAUTH_SECRET = saved.nextAuth;
  });

  it("signs new links with the dedicated key, not the session secret", () => {
    const token = createReachLink(at(BEFORE_CUTOFF));
    expect(token).toBe(createReachLink(at(BEFORE_CUTOFF), { secret: DEDICATED }));
    expect(token).not.toBe(createReachLink(at(BEFORE_CUTOFF), { secret: SESSION }));
    const fresh = createReachLink(at(AFTER_CUTOFF));
    expect(verifyReachLink(fresh, { now: AFTER_CUTOFF })).toMatchObject({ ok: true, verifiedWith: "dedicated" });
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("accepts a pre-upgrade AUTH_SECRET-signed link inside the window and records that the fallback was used", () => {
    const legacy = createReachLink(at(BEFORE_CUTOFF), { secret: SESSION });
    expect(verifyReachLink(legacy, { now: BEFORE_CUTOFF })).toMatchObject({
      ok: true,
      verifiedWith: "session-secret-grace",
    });
    expect(console.warn).toHaveBeenCalledTimes(1);
    const logged = String(vi.mocked(console.warn).mock.calls[0]?.[0]);
    expect(logged).toMatch(/grace fallback/);
    expect(logged).not.toContain(SESSION);
    expect(logged).not.toContain(legacy);
  });

  it("refuses an AUTH_SECRET-signed link after the cutoff", () => {
    const legacy = createReachLink(at(AFTER_CUTOFF), { secret: SESSION });
    expect(verifyReachLink(legacy, { now: AFTER_CUTOFF })).toEqual({ ok: false, reason: "signature_mismatch" });
  });

  it("refuses an AUTH_SECRET-signed link claiming more life than a link minted now could have", () => {
    const farFuture = createReachLink(
      at(BEFORE_CUTOFF, { exp: BEFORE_CUTOFF.getTime() + REACH_LINK_TTL_MS + 60_000 }),
      { secret: SESSION },
    );
    expect(verifyReachLink(farFuture, { now: BEFORE_CUTOFF })).toEqual({ ok: false, reason: "signature_mismatch" });
  });

  it("keeps today's behaviour when the dedicated key is unset or blank", () => {
    for (const unset of [undefined, "", "   "]) {
      if (unset === undefined) delete process.env.DPF_ATTENTION_REACH_SECRET;
      else process.env.DPF_ATTENTION_REACH_SECRET = unset;
      const token = createReachLink(at(AFTER_CUTOFF));
      expect(token).toBe(createReachLink(at(AFTER_CUTOFF), { secret: SESSION }));
      // No window applies: the session secret is the install's only key.
      expect(verifyReachLink(token, { now: AFTER_CUTOFF })).toMatchObject({ ok: true, verifiedWith: "session-secret" });
    }
    expect(console.warn).not.toHaveBeenCalled();
  });

  it.each([
    ["dedicated key set, inside the window", "set", BEFORE_CUTOFF],
    ["dedicated key set, after the window", "set", AFTER_CUTOFF],
    ["dedicated key unset", "unset", BEFORE_CUTOFF],
  ])("refuses a forged link (%s)", (_label, mode, now) => {
    if (mode === "unset") delete process.env.DPF_ATTENTION_REACH_SECRET;
    const forged = createReachLink(at(now), { secret: "fixture-attacker-key" });
    expect(verifyReachLink(forged, { now })).toEqual({ ok: false, reason: "signature_mismatch" });
    const valid = createReachLink(at(now));
    const [, signature] = valid.split(".");
    const tampered = `${Buffer.from(JSON.stringify(at(now, { itemId: "someone-else" })), "utf8").toString("base64url")}.${signature}`;
    expect(verifyReachLink(tampered, { now })).toEqual({ ok: false, reason: "signature_mismatch" });
  });
});
