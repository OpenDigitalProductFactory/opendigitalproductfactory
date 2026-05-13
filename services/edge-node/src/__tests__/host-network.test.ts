import { describe, expect, it } from "vitest";

import type { HostNetworkAdapter } from "../collectors/host-network";
import { collectHostNetworkSummary } from "../collectors/host-network";

function makeAdapter(
  overrides: Partial<HostNetworkAdapter> = {},
): HostNetworkAdapter {
  return {
    hostname: () => "test-host",
    networkInterfaces: () => ({}),
    ...overrides,
  };
}

describe("collectHostNetworkSummary", () => {
  it("returns hostname + empty IPs when the only interface is loopback", () => {
    const adapter = makeAdapter({
      networkInterfaces: () => ({
        lo: [
          {
            address: "127.0.0.1",
            netmask: "255.0.0.0",
            family: "IPv4",
            mac: "00:00:00:00:00:00",
            internal: true,
            cidr: "127.0.0.1/8",
          },
        ],
      }),
    });
    const summary = collectHostNetworkSummary(adapter);
    expect(summary.hostname).toBe("test-host");
    expect(summary.ipAddresses).toEqual([]);
  });

  it("picks up a real LAN IPv4 and ignores loopback", () => {
    const adapter = makeAdapter({
      hostname: () => "edge-warehouse-2",
      networkInterfaces: () => ({
        lo: [
          {
            address: "127.0.0.1",
            netmask: "255.0.0.0",
            family: "IPv4",
            mac: "00:00:00:00:00:00",
            internal: true,
            cidr: "127.0.0.1/8",
          },
        ],
        eth0: [
          {
            address: "192.168.1.42",
            netmask: "255.255.255.0",
            family: "IPv4",
            mac: "aa:bb:cc:dd:ee:ff",
            internal: false,
            cidr: "192.168.1.42/24",
          },
        ],
      }),
    });
    const summary = collectHostNetworkSummary(adapter);
    expect(summary.hostname).toBe("edge-warehouse-2");
    expect(summary.ipAddresses).toEqual(["192.168.1.42"]);
  });

  it("filters IPv4 link-local (169.254/16) — DHCP failure fallback", () => {
    const adapter = makeAdapter({
      networkInterfaces: () => ({
        eth0: [
          {
            address: "169.254.5.10",
            netmask: "255.255.0.0",
            family: "IPv4",
            mac: "aa:bb:cc:dd:ee:ff",
            internal: false,
            cidr: "169.254.5.10/16",
          },
        ],
      }),
    });
    const summary = collectHostNetworkSummary(adapter);
    expect(summary.ipAddresses).toEqual([]);
  });

  it("filters IPv6 link-local (fe80::/10)", () => {
    const adapter = makeAdapter({
      networkInterfaces: () => ({
        eth0: [
          {
            address: "fe80::1234:5678:9abc:def0",
            netmask: "ffff:ffff:ffff:ffff::",
            family: "IPv6",
            mac: "aa:bb:cc:dd:ee:ff",
            internal: false,
            cidr: "fe80::1234:5678:9abc:def0/64",
            scopeid: 2,
          },
        ],
      }),
    });
    const summary = collectHostNetworkSummary(adapter);
    expect(summary.ipAddresses).toEqual([]);
  });

  it("sorts IPv4 before IPv6 and de-duplicates", () => {
    const adapter = makeAdapter({
      networkInterfaces: () => ({
        eth0: [
          {
            address: "10.0.0.5",
            netmask: "255.255.255.0",
            family: "IPv4",
            mac: "aa:bb:cc:dd:ee:ff",
            internal: false,
            cidr: "10.0.0.5/24",
          },
          {
            address: "2001:db8::1",
            netmask: "ffff:ffff:ffff:ffff::",
            family: "IPv6",
            mac: "aa:bb:cc:dd:ee:ff",
            internal: false,
            cidr: "2001:db8::1/64",
            scopeid: 0,
          },
        ],
        eth1: [
          // Duplicate IP across interfaces (e.g. NIC bonding) shouldn't
          // produce two rows in the admin UI.
          {
            address: "10.0.0.5",
            netmask: "255.255.255.0",
            family: "IPv4",
            mac: "00:11:22:33:44:55",
            internal: false,
            cidr: "10.0.0.5/24",
          },
        ],
      }),
    });
    const summary = collectHostNetworkSummary(adapter);
    expect(summary.ipAddresses).toEqual(["10.0.0.5", "2001:db8::1"]);
  });

  it("ignores internal: true regardless of address family", () => {
    const adapter = makeAdapter({
      networkInterfaces: () => ({
        docker0: [
          {
            // Looks like a normal LAN address but Docker marks the
            // bridge interface as internal. We don't want bridge IPs
            // showing up as the host's LAN identity.
            address: "172.17.0.1",
            netmask: "255.255.0.0",
            family: "IPv4",
            mac: "aa:bb:cc:dd:ee:ff",
            internal: true,
            cidr: "172.17.0.1/16",
          },
        ],
      }),
    });
    const summary = collectHostNetworkSummary(adapter);
    expect(summary.ipAddresses).toEqual([]);
  });
});
