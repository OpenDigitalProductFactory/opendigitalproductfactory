import { describe, expect, it } from "vitest";

import { deriveFederationAuthorityUrl, isLoopbackAuthorityHost, selfAuthorityUnreachableReason } from "./self-authority";

describe("deriveFederationAuthorityUrl", () => {
  it("explicit configured base URL wins over the request host", () => {
    expect(
      deriveFederationAuthorityUrl({
        configuredBaseUrl: "https://portal.example.com",
        host: "192.168.0.152:3000",
        forwardedProto: "http",
      }),
    ).toBe("https://portal.example.com");
  });

  it("falls back to the request Host header when nothing is configured (the LAN case)", () => {
    expect(
      deriveFederationAuthorityUrl({
        configuredBaseUrl: null,
        host: "192.168.0.152:3000",
        forwardedProto: null,
      }),
    ).toBe("http://192.168.0.152:3000");
  });

  it("honors x-forwarded-proto when present (reverse proxy terminating TLS)", () => {
    expect(
      deriveFederationAuthorityUrl({
        configuredBaseUrl: null,
        host: "portal.example.com",
        forwardedProto: "https",
      }),
    ).toBe("https://portal.example.com");
  });

  it("takes the first hop of a comma-listed x-forwarded-proto", () => {
    expect(
      deriveFederationAuthorityUrl({
        configuredBaseUrl: null,
        host: "portal.example.com",
        forwardedProto: "https, http",
      }),
    ).toBe("https://portal.example.com");
  });

  it("trims a trailing slash from the configured URL", () => {
    expect(
      deriveFederationAuthorityUrl({
        configuredBaseUrl: "https://portal.example.com/",
        host: null,
        forwardedProto: null,
      }),
    ).toBe("https://portal.example.com");
  });

  it("returns null when neither config nor host is available", () => {
    expect(
      deriveFederationAuthorityUrl({
        configuredBaseUrl: null,
        host: null,
        forwardedProto: null,
      }),
    ).toBeNull();
  });

  it("ignores an empty configured URL and uses the host", () => {
    expect(
      deriveFederationAuthorityUrl({
        configuredBaseUrl: "",
        host: "10.0.0.5:3000",
        forwardedProto: null,
      }),
    ).toBe("http://10.0.0.5:3000");
  });
});

describe("isLoopbackAuthorityHost", () => {
  it.each(["http://localhost:3000", "http://127.0.0.1:3000", "http://127.5.5.5", "http://[::1]:3000"])(
    "is true for loopback host %s",
    (u) => expect(isLoopbackAuthorityHost(u)).toBe(true),
  );
  it.each([
    "http://192.168.0.152:3000",
    "http://10.0.0.4:3000",
    "http://172.16.0.9:3000",
    "https://peer.example.com",
    "not a url",
  ])("is false for LAN/public/invalid host %s", (u) =>
    expect(isLoopbackAuthorityHost(u)).toBe(false),
  );
});

describe("selfAuthorityUnreachableReason", () => {
  it("refuses a loopback self-URL advertised to a remote LAN peer", () => {
    const reason = selfAuthorityUnreachableReason({
      selfAuthorityUrl: "http://localhost:3000",
      peerAuthorityUrl: "http://192.168.0.152:3000",
    });
    expect(reason).toContain("http://localhost:3000");
    expect(reason).toContain("LAN address");
  });

  it("allows a loopback self-URL when the peer is also loopback (same-host dev)", () => {
    expect(
      selfAuthorityUnreachableReason({
        selfAuthorityUrl: "http://localhost:3000",
        peerAuthorityUrl: "http://127.0.0.1:4000",
      }),
    ).toBeNull();
  });

  it("allows a LAN self-URL advertised to a remote peer (the good case)", () => {
    expect(
      selfAuthorityUnreachableReason({
        selfAuthorityUrl: "http://192.168.0.200:3000",
        peerAuthorityUrl: "http://192.168.0.152:3000",
      }),
    ).toBeNull();
  });
});
