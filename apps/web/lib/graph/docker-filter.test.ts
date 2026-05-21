// Tests for isDockerOriginNode + isDockerOriginEntityKey.
//
// Both helpers feed the topology-view Show-Docker toggle + the
// server-side quality-issue suppression. A regression here re-floods
// the operator view with container hex hostnames + docker bridge IPs,
// so the matrix below is the canonical contract.

import { describe, expect, it } from "vitest";

import {
  isDockerOriginEntityKey,
  isDockerOriginNode,
  stripDockerOrigin,
} from "./docker-filter";

// Test fixture is intentionally minimal — only the fields the helper
// reads are populated. The broader GraphData Node shape isn't relevant
// for these unit tests, so we cast through to the parameter type.
type Node = { id: string; name: string; label?: string; color?: string; size?: number; ciType?: string };
const isDocker = (n: Node) =>
  isDockerOriginNode(n as unknown as Parameters<typeof isDockerOriginNode>[0]);

describe("isDockerOriginNode", () => {
  it("matches by ciType", () => {
    expect(isDocker({ id: "1", name: "x", ciType: "container" })).toBe(true);
    expect(isDocker({ id: "1", name: "x", ciType: "docker_runtime" })).toBe(true);
    expect(isDocker({ id: "1", name: "x", ciType: "docker_host" })).toBe(true);
    expect(isDocker({ id: "1", name: "x", ciType: "host" })).toBe(false);
  });

  it("matches by docker-discovery name prefixes", () => {
    expect(isDocker({ id: "1", name: "Docker: dpf_default (172.18.0.0/16)" })).toBe(true);
    expect(isDocker({ id: "2", name: "Docker GW dpf_default (172.18.0.1)" })).toBe(true);
    expect(isDocker({ id: "3", name: "Real Router" })).toBe(false);
  });

  it("matches 12-hex-char container hostnames", () => {
    expect(isDocker({ id: "1", name: "5ce3e0f1cfd6" })).toBe(true);
    expect(isDocker({ id: "2", name: "a9d8ef4fb717" })).toBe(true);
    // Real hostnames must not match
    expect(isDocker({ id: "3", name: "DESKTOP-A290QNG" })).toBe(false);
    expect(isDocker({ id: "4", name: "iphone-mark" })).toBe(false);
    // Not exactly 12 hex chars (boundary): 11 / 13 / mixed
    expect(isDocker({ id: "5", name: "5ce3e0f1cfd" })).toBe(false);
    expect(isDocker({ id: "6", name: "5ce3e0f1cfd60" })).toBe(false);
    expect(isDocker({ id: "7", name: "g5ce3e0f1cfd" })).toBe(false);
  });

  it("matches LAN Host 172.x bridge IPs (ARP-discovered Docker containers)", () => {
    expect(isDocker({ id: "1", name: "LAN Host 172.18.0.5" })).toBe(true);
    expect(isDocker({ id: "2", name: "LAN Host 172.17.0.1" })).toBe(true);
    expect(isDocker({ id: "3", name: "LAN Host 172.31.255.254" })).toBe(true);
    // Boundaries
    expect(isDocker({ id: "4", name: "LAN Host 172.15.0.1" })).toBe(false); // below /12
    expect(isDocker({ id: "5", name: "LAN Host 172.32.0.1" })).toBe(false); // above /12
    expect(isDocker({ id: "6", name: "LAN Host 192.168.0.10" })).toBe(false); // real LAN
  });

  it("matches Docker Desktop vpnkit gateway IPs", () => {
    expect(isDocker({ id: "1", name: "LAN Host 192.168.65.1" })).toBe(true);
    expect(isDocker({ id: "2", name: "LAN Host 192.168.65.2" })).toBe(true);
    expect(isDocker({ id: "3", name: "LAN Host 192.168.65.3" })).toBe(true);
    // Adjacent IPs in the same /24 must NOT match — could be a real
    // user LAN.
    expect(isDocker({ id: "4", name: "LAN Host 192.168.65.4" })).toBe(false);
  });

  it("stripDockerOrigin removes matching nodes + dangling edges", () => {
    const graph = {
      nodes: [
        { id: "real", name: "Cloud Gateway Ultra" },
        { id: "ctr1", name: "5ce3e0f1cfd6" },
        { id: "br1", name: "LAN Host 172.18.0.5" },
        { id: "dock", name: "Docker: dpf_default (172.18.0.0/16)" },
      ],
      links: [
        { source: "real", target: "ctr1", type: "HOSTS" },
        { source: "real", target: "real", type: "SELF" },
      ],
    };
    const stripped = stripDockerOrigin(graph as never);
    expect(stripped.nodes.map((n) => n.id)).toEqual(["real"]);
    // Edge to ctr1 dropped, self-edge preserved.
    expect(stripped.links).toEqual([
      { source: "real", target: "real", type: "SELF" },
    ]);
  });
});

describe("isDockerOriginEntityKey", () => {
  it("matches docker discovery collector key shapes", () => {
    expect(isDockerOriginEntityKey("subnet:docker-bridge")).toBe(true);
    expect(isDockerOriginEntityKey("gateway:docker-gw:bridge:172.17.0.1")).toBe(true);
    expect(isDockerOriginEntityKey("container:dpf-portal-1")).toBe(true);
    expect(isDockerOriginEntityKey("runtime:docker:engine")).toBe(true);
    expect(isDockerOriginEntityKey("docker_host:linux:abc123")).toBe(true);
  });

  it("matches 12-hex container hostnames seen by the ARP collector", () => {
    expect(isDockerOriginEntityKey("host:hostname:5ce3e0f1cfd6")).toBe(true);
    expect(isDockerOriginEntityKey("host:hostname:a9d8ef4fb717")).toBe(true);
    // Real hostnames are preserved
    expect(isDockerOriginEntityKey("host:hostname:DESKTOP-A290QNG")).toBe(false);
    expect(isDockerOriginEntityKey("host:hostname:iphone-mark")).toBe(false);
  });

  it("matches 172.16/12 bridge IPs and vpnkit gateways via host:arp:", () => {
    expect(isDockerOriginEntityKey("host:arp:172.18.0.5")).toBe(true);
    expect(isDockerOriginEntityKey("host:arp:172.17.0.10")).toBe(true);
    expect(isDockerOriginEntityKey("host:arp:192.168.65.1")).toBe(true);
    expect(isDockerOriginEntityKey("host:arp:192.168.0.49")).toBe(false); // real LAN
    expect(isDockerOriginEntityKey("host:arp:10.0.0.1")).toBe(false); // real LAN
  });

  it("falls back to name when entityKey is unrecognized", () => {
    expect(isDockerOriginEntityKey("unknown:key:1", "5ce3e0f1cfd6")).toBe(true);
    expect(isDockerOriginEntityKey("unknown:key:1", "Real Router")).toBe(false);
  });

  it("returns false for genuine InventoryEntity keys", () => {
    expect(isDockerOriginEntityKey("access_point:unifi:ac:8b:a9:58:3e:8d")).toBe(false);
    expect(isDockerOriginEntityKey("switch:unifi:d0:21:f9:df:56:92")).toBe(false);
    expect(isDockerOriginEntityKey("network_client:arp:192.168.0.49")).toBe(false);
    expect(isDockerOriginEntityKey("host:arp:192.168.0.5")).toBe(false);
  });
});
