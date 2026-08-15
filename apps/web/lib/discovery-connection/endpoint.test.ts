import { describe, expect, it } from "vitest";

import {
  endpointForCollector,
  normalizeDiscoveryEndpoint,
} from "./endpoint";

describe("normalizeDiscoveryEndpoint", () => {
  it.each([
    ["192.168.0.1", "https://192.168.0.1"],
    ["  HTTPS://gateway.local:8443/  ", "https://gateway.local:8443"],
    ["http://192.168.0.1", "https://192.168.0.1"],
  ])("normalizes common UniFi recovery input %s", (input, expected) => {
    expect(normalizeDiscoveryEndpoint(input, "unifi")).toEqual({
      ok: true,
      value: expected,
    });
  });

  it.each([
    "file:///etc/passwd",
    "https://user:password@192.168.0.1",
    "https://192.168.0.1/proxy/network",
    "https://0.0.0.0",
    "https://169.254.169.254/latest/meta-data",
    "https://8.8.8.8",
    "https://example.com",
    "https://192.168.0.1\r\nHost: example.test",
  ])("rejects unsafe or non-controller UniFi input %s", (input) => {
    expect(normalizeDiscoveryEndpoint(input, "unifi")).toMatchObject({ ok: false });
  });

  it("accepts private physical-network addresses and local hostnames", () => {
    expect(normalizeDiscoveryEndpoint("10.20.30.1", "unifi")).toMatchObject({ ok: true });
    expect(normalizeDiscoveryEndpoint("172.20.0.1", "unifi")).toMatchObject({ ok: true });
    expect(normalizeDiscoveryEndpoint("gateway.local", "unifi")).toMatchObject({ ok: true });
  });

  it("accepts a host or IP for SNMP and removes accidental URL syntax", () => {
    expect(normalizeDiscoveryEndpoint("https://core-switch.local/status", "snmp")).toEqual({
      ok: true,
      value: "core-switch.local",
    });
    expect(normalizeDiscoveryEndpoint("192.168.0.2", "snmp")).toEqual({
      ok: true,
      value: "192.168.0.2",
    });
  });

  it("returns field-specific guidance instead of throwing", () => {
    expect(normalizeDiscoveryEndpoint("not a host", "snmp")).toEqual({
      ok: false,
      error: "Enter a valid IP address or hostname, for example 192.168.0.1.",
    });
    expect(normalizeDiscoveryEndpoint("192.168.0.1", "arp_scan")).toEqual({
      ok: false,
      error: "Enter a subnet in CIDR notation, for example 192.168.0.0/24.",
    });
    expect(normalizeDiscoveryEndpoint("8.8.8.0/24", "arp_scan")).toEqual({
      ok: false,
      error: "Enter a private-network subnet in CIDR notation, for example 192.168.0.0/24.",
    });
  });

  it("canonicalizes valid ARP subnets", () => {
    expect(normalizeDiscoveryEndpoint(" 192.168.0.0/24 ", "arp_scan")).toEqual({
      ok: true,
      value: "192.168.0.0/24",
    });
    expect(normalizeDiscoveryEndpoint("192.168.44.27/24", "arp_scan")).toEqual({
      ok: true,
      value: "192.168.44.0/24",
    });
  });
});

describe("endpointForCollector", () => {
  it("derives collector-specific endpoints without asking for URL syntax", () => {
    expect(endpointForCollector("unifi", "192.168.44.1")).toBe("https://192.168.44.1");
    expect(endpointForCollector("snmp", "192.168.44.1")).toBe("192.168.44.1");
    expect(endpointForCollector("arp_scan", "192.168.44.1")).toBe("192.168.44.0/24");
  });
});
