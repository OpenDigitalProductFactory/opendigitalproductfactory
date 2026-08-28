import { describe, it, expect, vi } from "vitest";
import { createHash, randomBytes } from "crypto";

// These modules only need prisma to exist at import time; every function under
// test here is pure. The DB-touching paths are covered by the route tests.
vi.mock("@dpf/db", () => ({ prisma: {} }));

import { secretMatches, verifyPkceS256 } from "./oauth-tokens";
import { isRedirectUriAllowed, isRegisterableRedirectUri } from "./oauth-clients";

function challengeFor(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

function freshVerifier(): string {
  return randomBytes(48).toString("base64url"); // 64 chars, within 43..128
}

describe("PKCE S256 verification", () => {
  it("accepts a correct verifier", () => {
    const v = freshVerifier();
    expect(verifyPkceS256(v, challengeFor(v))).toBe(true);
  });

  it("rejects a wrong verifier", () => {
    const v = freshVerifier();
    expect(verifyPkceS256(freshVerifier(), challengeFor(v))).toBe(false);
  });

  it("rejects the PLAIN downgrade — verifier presented as its own challenge", () => {
    // OAuth 2.1 removes `plain`. If this ever passed, a client (or an
    // attacker who intercepted the code) could skip PKCE entirely.
    const v = freshVerifier();
    expect(verifyPkceS256(v, v)).toBe(false);
  });

  it("rejects verifiers outside the RFC 7636 length bounds", () => {
    const short = "a".repeat(42);
    const long = "a".repeat(129);
    expect(verifyPkceS256(short, challengeFor(short))).toBe(false);
    expect(verifyPkceS256(long, challengeFor(long))).toBe(false);
    expect(verifyPkceS256("", "")).toBe(false);
  });

  it("accepts exactly at the boundary lengths", () => {
    for (const len of [43, 128]) {
      const v = "a".repeat(len);
      expect(verifyPkceS256(v, challengeFor(v))).toBe(true);
    }
  });

  it("rejects a base64 (non-url) encoded challenge", () => {
    const v = freshVerifier();
    const std = createHash("sha256").update(v, "ascii").digest("base64");
    if (std === challengeFor(v)) return; // no +/= in this digest; nothing to assert
    expect(verifyPkceS256(v, std)).toBe(false);
  });
});

describe("client secret comparison", () => {
  it("accepts the right secret and rejects a wrong one", () => {
    const secret = "dpfocs_" + randomBytes(32).toString("base64url");
    const hash = createHash("sha256").update(secret).digest("hex");
    expect(secretMatches(secret, hash)).toBe(true);
    expect(secretMatches(secret + "x", hash)).toBe(false);
    expect(secretMatches("", hash)).toBe(false);
  });

  it("rejects a malformed stored hash without throwing", () => {
    expect(secretMatches("anything", "")).toBe(false);
    expect(secretMatches("anything", "not-a-hash")).toBe(false);
  });
});

const client = (redirectUris: string[]) => ({
  rowId: "r",
  clientId: "c",
  clientName: "n",
  registrationKind: "dcr" as const,
  redirectUris,
  allowedScopes: [],
  ownerUserId: null,
  agentId: null,
  clientSecretHash: null,
  selfAsserted: true,
});

describe("redirect URI matching", () => {
  it("ignores the PORT for loopback — the RFC 8252 native-app carve-out", () => {
    // A CLI cannot know its ephemeral port in advance; this is the one
    // sanctioned relaxation of exact matching.
    const c = client(["http://127.0.0.1:1234/callback"]);
    expect(isRedirectUriAllowed(c, "http://127.0.0.1:54321/callback")).toBe(true);
    expect(isRedirectUriAllowed(c, "http://127.0.0.1:1234/callback")).toBe(true);
  });

  it("still requires host and path to match for loopback", () => {
    const c = client(["http://127.0.0.1:1234/callback"]);
    expect(isRedirectUriAllowed(c, "http://127.0.0.1:54321/other")).toBe(false);
    expect(isRedirectUriAllowed(c, "http://localhost:54321/callback")).toBe(false);
  });

  it("matches non-loopback EXACTLY, including port and query", () => {
    const c = client(["https://app.example.com/cb"]);
    expect(isRedirectUriAllowed(c, "https://app.example.com/cb")).toBe(true);
    expect(isRedirectUriAllowed(c, "https://app.example.com:8443/cb")).toBe(false);
    expect(isRedirectUriAllowed(c, "https://app.example.com/cb?x=1")).toBe(false);
  });

  it("refuses prefix and subdomain lookalikes — the code-interception classic", () => {
    const c = client(["https://app.example.com/cb"]);
    expect(isRedirectUriAllowed(c, "https://app.example.com.evil.test/cb")).toBe(false);
    expect(isRedirectUriAllowed(c, "https://app.example.com/cb/../evil")).toBe(false);
    expect(isRedirectUriAllowed(c, "https://evil.test/cb")).toBe(false);
  });

  it("refuses a scheme downgrade", () => {
    const c = client(["https://app.example.com/cb"]);
    expect(isRedirectUriAllowed(c, "http://app.example.com/cb")).toBe(false);
  });

  it("refuses a redirect carrying a fragment", () => {
    // The authorization response appends a query; a fragment would swallow it.
    const c = client(["https://app.example.com/cb"]);
    expect(isRedirectUriAllowed(c, "https://app.example.com/cb#x")).toBe(false);
  });

  it("refuses anything when nothing is registered", () => {
    expect(isRedirectUriAllowed(client([]), "https://app.example.com/cb")).toBe(false);
  });

  it("refuses a malformed candidate without throwing", () => {
    expect(isRedirectUriAllowed(client(["https://a.test/cb"]), "not a url")).toBe(false);
  });
});

describe("registerable redirect URIs", () => {
  it("allows https anywhere", () => {
    expect(isRegisterableRedirectUri("https://app.example.com/cb")).toBe(true);
  });

  it("allows http ONLY on loopback", () => {
    expect(isRegisterableRedirectUri("http://127.0.0.1:0/cb")).toBe(true);
    expect(isRegisterableRedirectUri("http://localhost/cb")).toBe(true);
    // Plaintext to a remote host would expose the authorization code.
    expect(isRegisterableRedirectUri("http://app.example.com/cb")).toBe(false);
  });

  it("allows a custom scheme (native app pattern)", () => {
    expect(isRegisterableRedirectUri("myapp://callback")).toBe(true);
  });

  it("refuses garbage and fragments", () => {
    expect(isRegisterableRedirectUri("not a url")).toBe(false);
    expect(isRegisterableRedirectUri("https://a.test/cb#frag")).toBe(false);
  });
});
