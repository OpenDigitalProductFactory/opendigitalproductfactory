import { describe, it, expect } from "vitest";

import { isBlockedAddress, verifyOutboundUrl } from "./outbound-url-guard";

/** Deterministic resolver so these tests never touch real DNS. */
const resolvesTo =
  (...addresses: string[]) =>
  async () =>
    addresses;

describe("blocked address ranges", () => {
  it("blocks loopback, private, link-local and reserved IPv4", () => {
    for (const ip of [
      "127.0.0.1",
      "127.1.2.3",
      "10.0.0.1",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254", // cloud metadata — the classic SSRF target
      "0.0.0.0",
      "100.64.0.1", // carrier-grade NAT
      "224.0.0.1", // multicast
      "255.255.255.255",
    ]) {
      expect(isBlockedAddress(ip), `${ip} must be blocked`).toBe(true);
    }
  });

  it("allows ordinary public IPv4", () => {
    for (const ip of ["1.1.1.1", "8.8.8.8", "140.82.121.4", "172.32.0.1", "192.169.0.1"]) {
      expect(isBlockedAddress(ip), `${ip} should be allowed`).toBe(false);
    }
  });

  it("blocks loopback, link-local and unique-local IPv6", () => {
    for (const ip of ["::1", "::", "fe80::1", "fd00::1", "fc00::1", "ff02::1"]) {
      expect(isBlockedAddress(ip), `${ip} must be blocked`).toBe(true);
    }
  });

  it("blocks IPv4-mapped IPv6 that would smuggle a loopback address", () => {
    // ::ffff:127.0.0.1 is loopback wearing a v6 costume; a naive v6 check misses it.
    expect(isBlockedAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedAddress("::ffff:169.254.169.254")).toBe(true);
    expect(isBlockedAddress("::ffff:8.8.8.8")).toBe(false);
  });

  it("fails closed on anything that is not a parseable IP", () => {
    for (const junk of ["", "not-an-ip", "999.999.999.999", "127.0.0"]) {
      expect(isBlockedAddress(junk), `${junk} must fail closed`).toBe(true);
    }
  });
});

describe("outbound URL verification", () => {
  it("allows a public https URL", async () => {
    const v = await verifyOutboundUrl("https://client.example.com/client.json", {
      resolve: resolvesTo("140.82.121.4"),
    });
    expect(v.allowed).toBe(true);
  });

  it("REFUSES a hostname that resolves to loopback — the DNS-controlled attack", async () => {
    // The string looks innocuous; only the resolved address gives it away.
    const v = await verifyOutboundUrl("https://totally-normal.example.com/client.json", {
      resolve: resolvesTo("127.0.0.1"),
    });
    expect(v.allowed).toBe(false);
    if (!v.allowed) expect(v.reason).toContain("blocked address");
  });

  it("refuses when ANY resolved address is blocked, not just all of them", async () => {
    // A mixed record set would otherwise be a coin flip into the internal network.
    const v = await verifyOutboundUrl("https://mixed.example.com/client.json", {
      resolve: resolvesTo("8.8.8.8", "10.0.0.5"),
    });
    expect(v.allowed).toBe(false);
  });

  it("refuses a literal internal IP without needing DNS", async () => {
    for (const target of [
      "https://127.0.0.1/client.json",
      "https://169.254.169.254/latest/meta-data",
      "https://[::1]/client.json",
    ]) {
      const v = await verifyOutboundUrl(target, { resolve: resolvesTo("8.8.8.8") });
      expect(v.allowed, `${target} must be refused`).toBe(false);
    }
  });

  it("refuses non-https", async () => {
    for (const target of [
      "http://client.example.com/client.json",
      "file:///etc/passwd",
      "gopher://client.example.com/",
    ]) {
      const v = await verifyOutboundUrl(target, { resolve: resolvesTo("8.8.8.8") });
      expect(v.allowed, `${target} must be refused`).toBe(false);
    }
  });

  it("refuses credentials embedded in the URL", async () => {
    const v = await verifyOutboundUrl("https://user:pw@client.example.com/client.json", {
      resolve: resolvesTo("8.8.8.8"),
    });
    expect(v.allowed).toBe(false);
  });

  it("refuses a non-default port", async () => {
    // An internal service on an odd port is a common SSRF target.
    const v = await verifyOutboundUrl("https://client.example.com:9200/client.json", {
      resolve: resolvesTo("8.8.8.8"),
    });
    expect(v.allowed).toBe(false);
    const ok = await verifyOutboundUrl("https://client.example.com:443/client.json", {
      resolve: resolvesTo("8.8.8.8"),
    });
    expect(ok.allowed).toBe(true);
  });

  it("refuses an unresolvable host and a host with no records", async () => {
    const boom = await verifyOutboundUrl("https://nope.example.com/c.json", {
      resolve: async () => {
        throw new Error("NXDOMAIN");
      },
    });
    expect(boom.allowed).toBe(false);
    const empty = await verifyOutboundUrl("https://nope.example.com/c.json", {
      resolve: resolvesTo(),
    });
    expect(empty.allowed).toBe(false);
  });

  it("refuses garbage without throwing", async () => {
    const v = await verifyOutboundUrl("not a url", { resolve: resolvesTo("8.8.8.8") });
    expect(v.allowed).toBe(false);
  });
});
