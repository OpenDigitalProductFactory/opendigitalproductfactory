// Server-side parity test for isDockerOriginEntityKey. Mirrors the
// client-side helper test at apps/web/lib/graph/docker-filter.test.ts.

import { describe, expect, it } from "vitest";

import { isDockerOriginEntityKey, isDockerOriginRelationshipKey } from "./docker-origin";

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

describe("isDockerOriginRelationshipKey", () => {
  it("matches Docker-internal relationship shapes from the dpf_bootstrap self-scan", () => {
    expect(
      isDockerOriginRelationshipKey("dpf_bootstrap:MEMBER_OF:container:94d702333fd2->docker-net:dpf_default"),
    ).toBe(true);
    expect(
      isDockerOriginRelationshipKey("dpf_bootstrap:hosts:docker_runtime:/var/run/docker.sock->container:bd02d3f03235"),
    ).toBe(true);
    expect(
      isDockerOriginRelationshipKey("dpf_bootstrap:monitors:container:07c16aa103f0->container:ff075a384b4b"),
    ).toBe(true);
    expect(
      isDockerOriginRelationshipKey("dpf_bootstrap:RUNS_ON:container:abc123->docker_host:linux:node1"),
    ).toBe(true);
    expect(
      isDockerOriginRelationshipKey("dpf_bootstrap:HOSTS:runtime:docker:engine->container:abc123"),
    ).toBe(true);
  });

  it("matches a container endpoint on either side of the arrow, or at key start", () => {
    expect(isDockerOriginRelationshipKey("container:abc123->service:x")).toBe(true); // start
    expect(isDockerOriginRelationshipKey("src:REL:service:x->container:abc123")).toBe(true); // after arrow
    // A relationshipType literally containing the word must not false-match without
    // the `container:` token shape.
    expect(isDockerOriginRelationshipKey("src:CONTAINERIZES:host:arp:192.168.0.5->host:arp:192.168.0.9")).toBe(false);
  });

  it("matches Docker 172.16/12 bridge-network topology (arp-host / subnet endpoints)", () => {
    expect(
      isDockerOriginRelationshipKey("dpf_bootstrap:MEMBER_OF:arp-host:172.18.0.10->subnet:172.18.0.0/16"),
    ).toBe(true);
    expect(
      isDockerOriginRelationshipKey("dpf_bootstrap:MEMBER_OF:arp-host:172.31.255.254->subnet:172.31.0.0/16"),
    ).toBe(true);
    // Outside the 172.16/12 range → not the Docker bridge.
    expect(
      isDockerOriginRelationshipKey("dpf_bootstrap:MEMBER_OF:arp-host:172.15.0.1->subnet:172.15.0.0/16"),
    ).toBe(false);
    expect(
      isDockerOriginRelationshipKey("dpf_bootstrap:MEMBER_OF:arp-host:172.32.0.1->subnet:172.32.0.0/16"),
    ).toBe(false);
  });

  it("matches quarantined-run wrappers of the bootstrap self-scan", () => {
    expect(
      isDockerOriginRelationshipKey(
        "__dpf_quarantined__cmqoiqd9200cb01nsn764nlw8__dpf_bootstrap:MEMBER_OF:container:94d70233->docker-net:dpf_default",
      ),
    ).toBe(true);
  });

  it("returns false for real-estate relationships (UniFi/arp LAN devices)", () => {
    expect(
      isDockerOriginRelationshipKey("organization:internal:edge_node:MEMBER_OF:arp:192.168.0.58->unifi:fc:ec:da:bc:a5:49"),
    ).toBe(false);
    expect(
      isDockerOriginRelationshipKey("organization:internal:edge_node:HOSTS:unifi:ac:8b:a9:58:3e:8d->service:reolink-nvr"),
    ).toBe(false);
    expect(
      isDockerOriginRelationshipKey("arp_scan:CONNECTS:host:arp:192.168.0.5->host:arp:192.168.0.9"),
    ).toBe(false);
  });
});
