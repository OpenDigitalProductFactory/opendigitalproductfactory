import { describe, expect, it } from "vitest";

import { deriveFederationAuthorityUrl } from "./self-authority";

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
