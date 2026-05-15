import { describe, expect, it } from "vitest";

import {
  resolveSubnetAllowlist,
  type SubnetAllowlistAdapter,
} from "../collectors/subnet-allowlist";

function makeAdapter(
  overrides: Partial<SubnetAllowlistAdapter> = {},
): SubnetAllowlistAdapter {
  return {
    networkInterfaces: () => ({}),
    env: {},
    ...overrides,
  };
}

// ─── Env override path ──────────────────────────────────────────────────────

describe("resolveSubnetAllowlist — env override", () => {
  it("uses DPF_EDGE_DISCOVERY_SUBNETS verbatim when set", () => {
    const result = resolveSubnetAllowlist(
      makeAdapter({
        env: { DPF_EDGE_DISCOVERY_SUBNETS: "10.0.0.0/24,192.168.1.0/24" },
        // NICs would otherwise produce a different answer — proves env wins.
        networkInterfaces: () => ({
          eth0: [
            {
              address: "172.16.5.1",
              netmask: "255.255.255.0",
              family: "IPv4",
              mac: "aa:bb:cc:dd:ee:ff",
              internal: false,
              cidr: "172.16.5.1/24",
            },
          ],
        }),
      }),
    );
    expect(result.source).toBe("env");
    expect(result.subnets).toEqual(["10.0.0.0/24", "192.168.1.0/24"]);
  });

  it("normalizes a host-IP-with-mask into the canonical network form", () => {
    // Operator typo: wrote the host IP instead of the network address.
    const result = resolveSubnetAllowlist(
      makeAdapter({
        env: { DPF_EDGE_DISCOVERY_SUBNETS: "192.168.1.42/24" },
      }),
    );
    expect(result.subnets).toEqual(["192.168.1.0/24"]);
  });

  it("dedupes repeated entries in the env list", () => {
    const result = resolveSubnetAllowlist(
      makeAdapter({
        env: {
          DPF_EDGE_DISCOVERY_SUBNETS:
            "10.0.0.0/24, 10.0.0.0/24 , 10.0.0.5/24",
        },
      }),
    );
    expect(result.subnets).toEqual(["10.0.0.0/24"]);
  });

  it("warns about garbage CIDRs but continues with the rest", () => {
    const result = resolveSubnetAllowlist(
      makeAdapter({
        env: {
          DPF_EDGE_DISCOVERY_SUBNETS: "10.0.0.0/24,not-a-cidr,192.168.1.0/24",
        },
      }),
    );
    expect(result.subnets).toEqual(["10.0.0.0/24", "192.168.1.0/24"]);
    expect(result.warnings[0]).toMatch(/ignored invalid CIDR.*not-a-cidr/);
  });

  it("ignores the minCidrBits cap on operator-explicit paths", () => {
    // /16 would be filtered from auto-detect, but env override is
    // operator-explicit opt-in — we trust their judgment.
    const result = resolveSubnetAllowlist(
      makeAdapter({
        env: {
          DPF_EDGE_DISCOVERY_SUBNETS: "10.0.0.0/16",
          DPF_EDGE_DISCOVERY_MIN_CIDR_BITS: "20",
        },
      }),
    );
    expect(result.subnets).toEqual(["10.0.0.0/16"]);
  });

  it("returns empty + source=empty when env list contains only garbage", () => {
    const result = resolveSubnetAllowlist(
      makeAdapter({
        env: { DPF_EDGE_DISCOVERY_SUBNETS: "not-a-cidr, also-not-a-cidr" },
      }),
    );
    expect(result.subnets).toEqual([]);
    expect(result.source).toBe("empty");
    expect(result.warnings).toHaveLength(2);
  });
});

// ─── Auto-derive path ────────────────────────────────────────────────────────

describe("resolveSubnetAllowlist — auto-derive", () => {
  it("derives the subnet from a single LAN NIC", () => {
    const result = resolveSubnetAllowlist(
      makeAdapter({
        networkInterfaces: () => ({
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
      }),
    );
    expect(result.source).toBe("auto");
    expect(result.subnets).toEqual(["192.168.1.0/24"]);
    expect(result.warnings).toEqual([]);
  });

  it("dedupes across multiple NICs on the same subnet", () => {
    const result = resolveSubnetAllowlist(
      makeAdapter({
        networkInterfaces: () => ({
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
          eth1: [
            {
              address: "192.168.1.43",
              netmask: "255.255.255.0",
              family: "IPv4",
              mac: "00:11:22:33:44:55",
              internal: false,
              cidr: "192.168.1.43/24",
            },
          ],
        }),
      }),
    );
    expect(result.subnets).toEqual(["192.168.1.0/24"]);
  });

  it("filters subnets larger than the default /20 cap", () => {
    // docker0 typically presents a 172.17.0.1/16 — that's 65k addresses.
    // Auto-detect must NOT scan it; the /20 default catches this.
    const result = resolveSubnetAllowlist(
      makeAdapter({
        networkInterfaces: () => ({
          docker0: [
            {
              address: "172.17.0.1",
              netmask: "255.255.0.0",
              family: "IPv4",
              mac: "aa:bb:cc:dd:ee:ff",
              internal: false,
              cidr: "172.17.0.1/16",
            },
          ],
        }),
      }),
    );
    expect(result.subnets).toEqual([]);
    expect(result.source).toBe("empty");
    expect(result.warnings[0]).toMatch(
      /larger than \/20 cap.*DPF_EDGE_DISCOVERY_SUBNETS/i,
    );
  });

  it("respects DPF_EDGE_DISCOVERY_MIN_CIDR_BITS override", () => {
    // Operator widens the cap to /16 to include their bridge net.
    const result = resolveSubnetAllowlist(
      makeAdapter({
        env: { DPF_EDGE_DISCOVERY_MIN_CIDR_BITS: "16" },
        networkInterfaces: () => ({
          br0: [
            {
              address: "172.17.0.1",
              netmask: "255.255.0.0",
              family: "IPv4",
              mac: "aa:bb:cc:dd:ee:ff",
              internal: false,
              cidr: "172.17.0.1/16",
            },
          ],
        }),
      }),
    );
    expect(result.subnets).toEqual(["172.17.0.0/16"]);
  });

  it("invalid MIN_CIDR_BITS values fall back to the safe default", () => {
    const result = resolveSubnetAllowlist(
      makeAdapter({
        env: { DPF_EDGE_DISCOVERY_MIN_CIDR_BITS: "garbage" },
        networkInterfaces: () => ({
          eth0: [
            {
              address: "10.0.0.5",
              netmask: "255.255.0.0",
              family: "IPv4",
              mac: "aa:bb:cc:dd:ee:ff",
              internal: false,
              cidr: "10.0.0.5/16",
            },
          ],
        }),
      }),
    );
    // /16 is still rejected because default cap is /20.
    expect(result.subnets).toEqual([]);
  });

  it("ignores internal interfaces (loopback marked internal by node)", () => {
    const result = resolveSubnetAllowlist(
      makeAdapter({
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
      }),
    );
    expect(result.subnets).toEqual([]);
  });

  it("ignores IPv4 link-local 169.254/16 explicitly", () => {
    const result = resolveSubnetAllowlist(
      makeAdapter({
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
      }),
    );
    expect(result.subnets).toEqual([]);
  });

  it("ignores IPv6 addresses (Phase 0 is IPv4-only)", () => {
    const result = resolveSubnetAllowlist(
      makeAdapter({
        networkInterfaces: () => ({
          eth0: [
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
        }),
      }),
    );
    expect(result.subnets).toEqual([]);
  });
});
