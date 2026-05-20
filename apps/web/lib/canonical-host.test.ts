import { describe, expect, it } from "vitest";
import { decideHostMatch } from "./canonical-host";

const path = "/foo";
const search = "?bar=1";

describe("decideHostMatch", () => {
  it("passthrough when canonicalUrl is undefined (bootstrap-before-DNS)", () => {
    const result = decideHostMatch({
      host: "localhost:3000",
      path,
      search,
      config: { canonicalUrl: undefined, aliases: "" },
    });
    expect(result).toEqual({ kind: "passthrough", reason: "no-canonical-configured" });
  });

  it("passthrough when canonicalUrl is empty string", () => {
    const result = decideHostMatch({
      host: "localhost:3000",
      path,
      search,
      config: { canonicalUrl: "", aliases: "" },
    });
    expect(result).toEqual({ kind: "passthrough", reason: "no-canonical-configured" });
  });

  it("passthrough when host header is missing", () => {
    const result = decideHostMatch({
      host: null,
      path,
      search,
      config: { canonicalUrl: "https://portal.example.com", aliases: "" },
    });
    expect(result).toEqual({ kind: "passthrough", reason: "no-host-header" });
  });

  it("passthrough when host matches canonical exactly", () => {
    const result = decideHostMatch({
      host: "portal.example.com",
      path,
      search,
      config: { canonicalUrl: "https://portal.example.com", aliases: "" },
    });
    expect(result).toEqual({ kind: "passthrough", reason: "host-matches-canonical" });
  });

  it("passthrough is case-insensitive on host comparison", () => {
    const result = decideHostMatch({
      host: "PORTAL.EXAMPLE.COM",
      path,
      search,
      config: { canonicalUrl: "https://portal.example.com", aliases: "" },
    });
    expect(result).toEqual({ kind: "passthrough", reason: "host-matches-canonical" });
  });

  it("passthrough when host:port matches canonical:port", () => {
    const result = decideHostMatch({
      host: "portal.example.com:3000",
      path,
      search,
      config: { canonicalUrl: "https://portal.example.com:3000", aliases: "" },
    });
    expect(result).toEqual({ kind: "passthrough", reason: "host-matches-canonical" });
  });

  it("redirect when port mismatches (different origin per browser)", () => {
    const result = decideHostMatch({
      host: "portal.example.com",
      path,
      search,
      config: { canonicalUrl: "https://portal.example.com:3000", aliases: "" },
    });
    expect(result).toEqual({
      kind: "redirect",
      targetUrl: "https://portal.example.com:3000/foo?bar=1",
    });
  });

  it("passthrough when host matches alias entry", () => {
    const result = decideHostMatch({
      host: "192.168.1.10:3000",
      path,
      search,
      config: {
        canonicalUrl: "https://portal.example.com",
        aliases: "192.168.1.10:3000",
      },
    });
    expect(result).toEqual({ kind: "passthrough", reason: "host-matches-alias" });
  });

  it("alias entries are trimmed and case-insensitive", () => {
    const result = decideHostMatch({
      host: "192.168.1.10:3000",
      path,
      search,
      config: {
        canonicalUrl: "https://portal.example.com",
        aliases: " 192.168.1.10:3000 , portal.local ",
      },
    });
    expect(result).toEqual({ kind: "passthrough", reason: "host-matches-alias" });
  });

  it("redirect preserves path and query string", () => {
    const result = decideHostMatch({
      host: "localhost:3000",
      path: "/foo",
      search: "?bar=1&baz=2",
      config: { canonicalUrl: "https://portal.example.com", aliases: "" },
    });
    expect(result).toEqual({
      kind: "redirect",
      targetUrl: "https://portal.example.com/foo?bar=1&baz=2",
    });
  });

  it("redirect to root path when path is /", () => {
    const result = decideHostMatch({
      host: "localhost:3000",
      path: "/",
      search: "",
      config: { canonicalUrl: "https://portal.example.com", aliases: "" },
    });
    expect(result).toEqual({
      kind: "redirect",
      targetUrl: "https://portal.example.com/",
    });
  });

  it("passthrough on malformed canonicalUrl (graceful — do not crash app on env typo)", () => {
    const result = decideHostMatch({
      host: "localhost:3000",
      path,
      search,
      config: { canonicalUrl: ":://broken", aliases: "" },
    });
    expect(result).toEqual({ kind: "passthrough", reason: "no-canonical-configured" });
  });

  it("passthrough for IPv6 literal hosts matching canonical", () => {
    const result = decideHostMatch({
      host: "[::1]:3000",
      path,
      search,
      config: { canonicalUrl: "http://[::1]:3000", aliases: "" },
    });
    expect(result).toEqual({ kind: "passthrough", reason: "host-matches-canonical" });
  });

  it("normalizes trailing slash in canonicalUrl when building redirect target", () => {
    const result = decideHostMatch({
      host: "localhost:3000",
      path: "/foo",
      search: "",
      config: { canonicalUrl: "https://portal.example.com/", aliases: "" },
    });
    expect(result).toEqual({
      kind: "redirect",
      targetUrl: "https://portal.example.com/foo",
    });
  });
});
