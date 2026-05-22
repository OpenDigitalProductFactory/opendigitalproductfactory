// apps/web/lib/security/safe-fetch.test.ts
//
// BI-5E53A265 regression tests. Written BEFORE the implementation per
// the kernel principle `security-fix-needs-regression-test-first`
// (PR #953). These tests pin the contract of assertSafeOutboundUrl()
// so the same SSRF class CAN'T regress: user-controlled URLs that
// reach an outbound fetch() must clear scheme + host + private-network
// checks. The catalogue of "bad" cases is the lived experience of every
// SSRF advisory class for the last decade — cloud metadata, link-local,
// loopback, RFC1918, file://, hostname containing newline, etc.

import { describe, expect, it } from "vitest";
import { assertSafeOutboundUrl } from "./safe-fetch";

describe("assertSafeOutboundUrl — scheme gating", () => {
  it("accepts https by default", () => {
    const url = assertSafeOutboundUrl("https://example.com/feed.ics");
    expect(url.protocol).toBe("https:");
    expect(url.hostname).toBe("example.com");
  });

  it("rejects http by default", () => {
    expect(() => assertSafeOutboundUrl("http://example.com/")).toThrow(/scheme/i);
  });

  it("rejects file://", () => {
    expect(() => assertSafeOutboundUrl("file:///etc/passwd")).toThrow();
  });

  it("rejects gopher://, ftp://, and other unusual schemes", () => {
    expect(() => assertSafeOutboundUrl("gopher://example.com/")).toThrow();
    expect(() => assertSafeOutboundUrl("ftp://example.com/")).toThrow();
    expect(() => assertSafeOutboundUrl("javascript:alert(1)")).toThrow();
  });

  it("accepts http when explicitly allowed", () => {
    const url = assertSafeOutboundUrl("http://example.com/", {
      allowedSchemes: ["http:", "https:"],
    });
    expect(url.protocol).toBe("http:");
  });
});

describe("assertSafeOutboundUrl — private-network blocks", () => {
  it("blocks IPv4 loopback (127.0.0.1)", () => {
    expect(() => assertSafeOutboundUrl("https://127.0.0.1/")).toThrow(/private|loopback/i);
  });

  it("blocks IPv4 loopback range (127.x.x.x)", () => {
    expect(() => assertSafeOutboundUrl("https://127.0.0.5/")).toThrow();
  });

  it("blocks 0.0.0.0", () => {
    expect(() => assertSafeOutboundUrl("https://0.0.0.0/")).toThrow();
  });

  it("blocks RFC1918 10.0.0.0/8", () => {
    expect(() => assertSafeOutboundUrl("https://10.0.0.25/")).toThrow();
    expect(() => assertSafeOutboundUrl("https://10.255.255.255/")).toThrow();
  });

  it("blocks RFC1918 172.16.0.0/12", () => {
    expect(() => assertSafeOutboundUrl("https://172.16.0.1/")).toThrow();
    expect(() => assertSafeOutboundUrl("https://172.31.255.255/")).toThrow();
  });

  it("blocks RFC1918 192.168.0.0/16", () => {
    expect(() => assertSafeOutboundUrl("https://192.168.1.10/")).toThrow();
  });

  it("blocks the AWS / GCP / Azure metadata IP (169.254.169.254)", () => {
    // This is the textbook SSRF target — the one calendar-sync was vulnerable to.
    expect(() => assertSafeOutboundUrl("https://169.254.169.254/latest/meta-data/")).toThrow(
      /private|metadata|link-local/i,
    );
  });

  it("blocks link-local 169.254.0.0/16 broadly", () => {
    expect(() => assertSafeOutboundUrl("https://169.254.0.1/")).toThrow();
    expect(() => assertSafeOutboundUrl("https://169.254.255.255/")).toThrow();
  });

  it("blocks 'localhost' (string literal)", () => {
    expect(() => assertSafeOutboundUrl("https://localhost/")).toThrow(/private|loopback/i);
  });

  it("blocks .local mDNS suffixes", () => {
    expect(() => assertSafeOutboundUrl("https://myprinter.local/")).toThrow();
  });

  it("blocks IPv6 loopback (::1)", () => {
    expect(() => assertSafeOutboundUrl("https://[::1]/")).toThrow();
  });

  it("blocks IPv6 link-local (fe80::/10)", () => {
    expect(() => assertSafeOutboundUrl("https://[fe80::1]/")).toThrow();
  });

  it("blocks IPv6 unique-local (fc00::/7)", () => {
    expect(() => assertSafeOutboundUrl("https://[fc00::1]/")).toThrow();
    expect(() => assertSafeOutboundUrl("https://[fd00::1]/")).toThrow();
  });

  it("accepts a public-looking IP (8.8.8.8)", () => {
    expect(() => assertSafeOutboundUrl("https://8.8.8.8/")).not.toThrow();
  });

  it("accepts a public hostname", () => {
    expect(() => assertSafeOutboundUrl("https://example.com/")).not.toThrow();
  });

  it("blocks private networks even when blockPrivateNetworks is set explicitly true", () => {
    expect(() =>
      assertSafeOutboundUrl("https://192.168.1.1/", { blockPrivateNetworks: true }),
    ).toThrow();
  });

  it("allows private networks ONLY when blockPrivateNetworks is set to false (escape hatch for internal tooling)", () => {
    expect(() =>
      assertSafeOutboundUrl("https://192.168.1.1/", { blockPrivateNetworks: false }),
    ).not.toThrow();
  });
});

describe("assertSafeOutboundUrl — host allowlist", () => {
  it("accepts the allowed host", () => {
    const url = assertSafeOutboundUrl("https://api.github.com/repos/foo/bar", {
      allowedHosts: ["api.github.com"],
    });
    expect(url.hostname).toBe("api.github.com");
  });

  it("rejects any other host even if it looks similar", () => {
    expect(() =>
      assertSafeOutboundUrl("https://api.github.com.evil.com/", {
        allowedHosts: ["api.github.com"],
      }),
    ).toThrow(/host/i);
  });

  it("matches host case-insensitively", () => {
    expect(() =>
      assertSafeOutboundUrl("https://API.GitHub.com/", {
        allowedHosts: ["api.github.com"],
      }),
    ).not.toThrow();
  });

  it("rejects when allowedHosts is empty array (no hosts permitted)", () => {
    expect(() => assertSafeOutboundUrl("https://example.com/", { allowedHosts: [] })).toThrow();
  });
});

describe("assertSafeOutboundUrl — input parsing", () => {
  it("rejects malformed URLs", () => {
    expect(() => assertSafeOutboundUrl("not-a-url")).toThrow();
    expect(() => assertSafeOutboundUrl("")).toThrow();
    expect(() => assertSafeOutboundUrl("   ")).toThrow();
  });

  it("rejects URLs with embedded newlines (header-injection vector)", () => {
    expect(() => assertSafeOutboundUrl("https://example.com/\r\nHost: evil.com")).toThrow();
  });

  it("returns a URL object (not a string) so the caller passes a sanitized value", () => {
    // The pattern is `fetch(assertSafeOutboundUrl(input).href)`. Returning
    // URL (not string) makes CodeQL's sanitizer modeling cleaner: the
    // input flows through a function whose return type carries the
    // "validated" signal.
    const url = assertSafeOutboundUrl("https://example.com/path?q=1");
    expect(url).toBeInstanceOf(URL);
    expect(url.pathname).toBe("/path");
  });
});
