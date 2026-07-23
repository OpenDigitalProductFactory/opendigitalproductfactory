import { describe, expect, it } from "vitest";

import {
  classifyEntityObservation,
  classifyRelationshipObservation,
} from "./estate-observation-class";

describe("classifyEntityObservation", () => {
  it("classifies UniFi infrastructure devices as managed", () => {
    // These are the operator's owned/administered network gear — an AP or
    // switch going missing is real, actionable signal.
    expect(classifyEntityObservation("organization:internal:access_point:unifi:ac:8b:a9:3f:1b:29")).toBe("managed");
    expect(classifyEntityObservation("organization:internal:switch:unifi:d0:21:f9:df:56:92")).toBe("managed");
    expect(classifyEntityObservation("organization:internal:router:unifi:fc:ec:da:bc:a5:49")).toBe("managed");
  });

  it("classifies servers, services and databases as managed", () => {
    expect(classifyEntityObservation("host:hostname:dpf-dev")).toBe("managed");
    expect(classifyEntityObservation("service:mystery-engine")).toBe("managed");
    expect(classifyEntityObservation("database:postgres-primary")).toBe("managed");
  });

  it("classifies ARP neighbours as observed (transient, IP-seen hosts)", () => {
    expect(classifyEntityObservation("organization:internal:host:arp:192.168.0.58")).toBe("observed");
    expect(classifyEntityObservation("host:arp-host:192.168.0.58")).toBe("observed");
    expect(classifyEntityObservation("arp:00A0C9123456")).toBe("observed");
  });

  it("classifies UniFi clients as observed but UniFi devices as managed", () => {
    // The distinction that matters: `unifi-client:` is a phone/laptop passing
    // through; `unifi:` is the AP it connected to.
    expect(classifyEntityObservation("organization:internal:host:unifi-client:aa:bb:cc:dd:ee:ff")).toBe("observed");
    expect(classifyEntityObservation("organization:internal:access_point:unifi:aa:bb:cc:dd:ee:ff")).toBe("managed");
  });

  it("classifies platform Prometheus scrape targets as observed", () => {
    expect(classifyEntityObservation("application:prom:portal:portal:3000")).toBe("observed");
    expect(classifyEntityObservation("service:prom:adp:adp:8600")).toBe("observed");
    expect(classifyEntityObservation("database:prom:postgres:postgres-exporter:9187")).toBe("observed");
  });

  it("only matches observed tokens positionally — never as a substring", () => {
    // A managed product legitimately containing these letters must not be
    // misclassified; a false "observed" would hide real signal.
    expect(classifyEntityObservation("service:sharp-imaging")).toBe("managed");
    expect(classifyEntityObservation("application:promotions-engine")).toBe("managed");
    expect(classifyEntityObservation("service:warp:gateway")).toBe("managed");
  });
});

describe("classifyRelationshipObservation", () => {
  it("keeps managed<->managed topology managed", () => {
    // AP uplink to switch — if that link disappears, the operator wants to know.
    expect(
      classifyRelationshipObservation(
        "organization:internal:edge_node:HOSTS:unifi:9c:05:d6:de:8d:3f->unifi:d0:21:f9:df:56:92",
      ),
    ).toBe("managed");
  });

  it("classifies a relationship touching ANY observed endpoint as observed", () => {
    // Transient client attached to a managed AP — vanishes when the client leaves.
    expect(
      classifyRelationshipObservation(
        "organization:internal:edge_node:MEMBER_OF:arp:192.168.0.58->unifi:fc:ec:da:bc:a5:49",
      ),
    ).toBe("observed");
    expect(
      classifyRelationshipObservation(
        "dpf_bootstrap:monitors:prom-target:prometheus:localhost:9090->prom-target:adp:adp:8600",
      ),
    ).toBe("observed");
  });

  it("does not false-match an observed token inside another segment", () => {
    expect(
      classifyRelationshipObservation("org:internal:HOSTS:service:promotions->service:sharp-imaging"),
    ).toBe("managed");
  });
});
