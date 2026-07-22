import { describe, expect, it } from "vitest";
import {
  isNonRoutableHost,
  normalizeAuthRedirect,
  resolveVisibleBase,
} from "./auth-redirect";

describe("isNonRoutableHost", () => {
  it("flags bind-only / unspecified addresses", () => {
    expect(isNonRoutableHost("0.0.0.0")).toBe(true);
    expect(isNonRoutableHost("::")).toBe(true);
    expect(isNonRoutableHost("[::]")).toBe(true);
    expect(isNonRoutableHost("0000:0000:0000:0000:0000:0000:0000:0000")).toBe(true);
  });

  it("treats routable hosts as fine", () => {
    expect(isNonRoutableHost("localhost")).toBe(false);
    expect(isNonRoutableHost("127.0.0.1")).toBe(false);
    expect(isNonRoutableHost("192.168.1.10")).toBe(false);
    expect(isNonRoutableHost("portal.example.com")).toBe(false);
  });
});

describe("resolveVisibleBase", () => {
  it("prefers a routable PUBLIC_URL", () => {
    const base = resolveVisibleBase("http://0.0.0.0:3000", "https://portal.example.com");
    expect(base.origin).toBe("https://portal.example.com");
  });

  it("ignores a non-routable PUBLIC_URL and repairs the request base", () => {
    const base = resolveVisibleBase("http://0.0.0.0:3000", "http://0.0.0.0:3000");
    expect(base.hostname).toBe("localhost");
    expect(base.port).toBe("3000");
    expect(base.protocol).toBe("http:");
  });

  it("rewrites a non-routable request base to localhost, keeping the port", () => {
    const base = resolveVisibleBase("http://0.0.0.0:3000");
    expect(base.origin).toBe("http://localhost:3000");
  });

  it("passes a routable request base through unchanged", () => {
    const base = resolveVisibleBase("http://localhost:3000");
    expect(base.origin).toBe("http://localhost:3000");
  });
});

describe("normalizeAuthRedirect", () => {
  it("resolves a relative redirectTo against a repaired localhost base (the login bug)", () => {
    // The exact failing case: Auth.js base derived as 0.0.0.0, relative /workspace.
    const out = normalizeAuthRedirect({
      url: "/workspace",
      baseUrl: "http://0.0.0.0:3000",
    });
    expect(out).toBe("http://localhost:3000/workspace");
  });

  it("rewrites an absolute 0.0.0.0 target to the visible host", () => {
    const out = normalizeAuthRedirect({
      url: "http://0.0.0.0:3000/workspace",
      baseUrl: "http://0.0.0.0:3000",
    });
    expect(out).toBe("http://localhost:3000/workspace");
  });

  it("preserves query strings on relative OAuth-flow redirects", () => {
    const out = normalizeAuthRedirect({
      url: "/customer-link-account?token=abc123",
      baseUrl: "http://0.0.0.0:3000",
    });
    expect(out).toBe("http://localhost:3000/customer-link-account?token=abc123");
  });

  it("routes through PUBLIC_URL when configured", () => {
    const out = normalizeAuthRedirect({
      url: "/workspace",
      baseUrl: "http://0.0.0.0:3000",
      publicUrl: "https://portal.example.com",
    });
    expect(out).toBe("https://portal.example.com/workspace");
  });

  it("leaves a healthy localhost flow untouched", () => {
    const out = normalizeAuthRedirect({
      url: "/workspace",
      baseUrl: "http://localhost:3000",
    });
    expect(out).toBe("http://localhost:3000/workspace");
  });

  it("collapses a foreign absolute origin to the safe base (open-redirect guard)", () => {
    const out = normalizeAuthRedirect({
      url: "https://evil.example.com/steal",
      baseUrl: "http://localhost:3000",
    });
    expect(out).toBe("http://localhost:3000/");
  });

  it("keeps a same-origin absolute target", () => {
    const out = normalizeAuthRedirect({
      url: "http://localhost:3000/build",
      baseUrl: "http://localhost:3000",
    });
    expect(out).toBe("http://localhost:3000/build");
  });
});
