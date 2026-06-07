// apps/web/components/admin/OAuthPortMismatchBanner.test.tsx
// BI-87D93A71 (Minimum) — unit tests for the OAuth port-mismatch detector
// and the rendered banner.

import { describe, expect, it } from "vitest";

import {
  parseRequiredOAuthPort,
  // getCurrentOriginPort is exercised via the integration check;
  // we don't unit-test it because it just reads window.location.
} from "./OAuthPortMismatchBanner";

describe("parseRequiredOAuthPort", () => {
  it("returns the explicit port from a callback URL with one set", () => {
    expect(parseRequiredOAuthPort("http://localhost:1455/auth/callback")).toBe(1455);
  });

  it("defaults http URIs with no explicit port to 80", () => {
    expect(parseRequiredOAuthPort("http://example.com/auth/callback")).toBe(80);
  });

  it("defaults https URIs with no explicit port to 443", () => {
    expect(parseRequiredOAuthPort("https://example.com/auth/callback")).toBe(443);
  });

  it("returns null for null / undefined / empty input", () => {
    expect(parseRequiredOAuthPort(null)).toBeNull();
    expect(parseRequiredOAuthPort(undefined)).toBeNull();
    expect(parseRequiredOAuthPort("")).toBeNull();
  });

  it("returns null for an unparseable URI", () => {
    expect(parseRequiredOAuthPort("not a url")).toBeNull();
  });

  it("returns the OpenAI Codex port (1455) from the real callback URL the BI cites", () => {
    // This is the exact value the BI body documents — guard against future
    // edits that would cause the detector to silently miss the Codex flow.
    expect(
      parseRequiredOAuthPort("http://localhost:1455/auth/callback"),
    ).toBe(1455);
  });

  it("handles non-standard schemes by returning null rather than guessing", () => {
    expect(parseRequiredOAuthPort("ftp://example.com/cb")).toBeNull();
  });
});
