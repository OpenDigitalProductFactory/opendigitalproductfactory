// Server-side parity test for isDockerOriginEntityKey. Mirrors the
// client-side helper test at apps/web/lib/graph/docker-filter.test.ts.

import { describe, expect, it } from "vitest";

import { isDockerOriginEntityKey } from "./docker-origin";

describe("isDockerOriginEntityKey (server-side)", () => {
  it("matches docker discovery collector key shapes", () => {
    expect(isDockerOriginEntityKey("subnet:docker-bridge")).toBe(true);
    expect(isDockerOriginEntityKey("gateway:docker-gw:bridge:172.17.0.1")).toBe(true);
    expect(isDockerOriginEntityKey("container:dpf-portal-1")).toBe(true);
    expect(isDockerOriginEntityKey("runtime:docker:engine")).toBe(true);
    expect(isDockerOriginEntityKey("docker_host:linux:abc123")).toBe(true);
  });

  it("matches 12-hex container hostnames via host:hostname:", () => {
    expect(isDockerOriginEntityKey("host:hostname:5ce3e0f1cfd6")).toBe(true);
    expect(isDockerOriginEntityKey("host:hostname:a9d8ef4fb717")).toBe(true);
    expect(isDockerOriginEntityKey("host:hostname:DESKTOP-A290QNG")).toBe(false);
    expect(isDockerOriginEntityKey("host:hostname:iphone-mark")).toBe(false);
  });

  it("matches 172.16/12 bridge IPs and vpnkit gateway via host:arp:", () => {
    expect(isDockerOriginEntityKey("host:arp:172.18.0.5")).toBe(true);
    expect(isDockerOriginEntityKey("host:arp:172.17.0.10")).toBe(true);
    expect(isDockerOriginEntityKey("host:arp:172.31.255.254")).toBe(true);
    expect(isDockerOriginEntityKey("host:arp:172.15.0.1")).toBe(false); // outside /12
    expect(isDockerOriginEntityKey("host:arp:172.32.0.1")).toBe(false); // outside /12
    expect(isDockerOriginEntityKey("host:arp:192.168.65.1")).toBe(true);
    expect(isDockerOriginEntityKey("host:arp:192.168.65.4")).toBe(false); // outside the known vpnkit triplet
    expect(isDockerOriginEntityKey("host:arp:192.168.0.49")).toBe(false); // real LAN
  });

  it("uses optional name fallback when entityKey doesn't match a known shape", () => {
    expect(isDockerOriginEntityKey("unknown:key:1", "5ce3e0f1cfd6")).toBe(true);
    expect(isDockerOriginEntityKey("unknown:key:1", "Docker: my_app (172.20.0.0/16)")).toBe(true);
    expect(isDockerOriginEntityKey("unknown:key:1", "Real Router")).toBe(false);
    expect(isDockerOriginEntityKey("unknown:key:1", null)).toBe(false);
  });

  it("returns false for genuine InventoryEntity keys", () => {
    expect(isDockerOriginEntityKey("access_point:unifi:ac:8b:a9:58:3e:8d")).toBe(false);
    expect(isDockerOriginEntityKey("switch:unifi:d0:21:f9:df:56:92")).toBe(false);
    expect(isDockerOriginEntityKey("network_client:arp:192.168.0.49")).toBe(false);
    expect(isDockerOriginEntityKey("host:arp:192.168.0.5")).toBe(false);
  });
});
