import { describe, expect, it } from "vitest";

import {
  EDGE_HEARTBEAT_DEGRADED_AFTER_MS,
  EDGE_HEARTBEAT_OFFLINE_AFTER_MS,
  deriveNearbyDiscoveryHealth,
  deriveEdgeNodeReadiness,
  selectMainInstallationNode,
  type EdgeReadinessNode,
} from "./readiness";

const NOW = new Date("2026-08-13T18:00:00.000Z");

function node(overrides: Partial<EdgeReadinessNode> = {}): EdgeReadinessNode {
  return {
    id: "row-local",
    nodeId: "edge_local",
    platform: "darwin",
    installMode: "native",
    version: "1.2.3",
    storedStatus: "active",
    trustState: "trusted",
    lastSeenAt: new Date(NOW.getTime() - 60_000),
    enrolledAt: new Date(NOW.getTime() - 3_600_000),
    customerAccountId: null,
    customerSiteId: null,
    installerManaged: true,
    capabilities: [
      {
        capability: "federation.discovery",
        mode: "enabled",
        status: "healthy",
        reportedAt: new Date(NOW.getTime() - 60_000),
      },
    ],
    ...overrides,
  };
}

describe("deriveEdgeNodeReadiness", () => {
  it("does not report a months-stale stored active row as healthy", () => {
    const result = deriveEdgeNodeReadiness(
      node({ lastSeenAt: new Date("2026-06-10T12:00:00.000Z") }),
      { now: NOW, requiredCapabilities: ["federation.discovery"] },
    );

    expect(result.health).toBe("offline");
    expect(result.heartbeatAgeMs).toBeGreaterThan(EDGE_HEARTBEAT_OFFLINE_AFTER_MS);
    expect(result.nextAction).toBe("repair-service");
    expect(result.checks.find((check) => check.key === "heartbeat")?.status).toBe("fail");
  });

  it("reports a fresh trusted node with healthy accepted discovery as healthy", () => {
    const result = deriveEdgeNodeReadiness(node(), {
      now: NOW,
      requiredCapabilities: ["federation.discovery"],
    });

    expect(result.health).toBe("healthy");
    expect(result.nextAction).toBe("none");
    expect(result.checks.every((check) => check.status === "pass")).toBe(true);
  });

  it("keeps trust separate from health and asks for approval", () => {
    const result = deriveEdgeNodeReadiness(node({ trustState: "pending" }), {
      now: NOW,
      requiredCapabilities: ["federation.discovery"],
    });

    expect(result.health).toBe("starting");
    expect(result.trust).toBe("pending");
    expect(result.nextAction).toBe("approve-node");
    expect(result.checks.find((check) => check.key === "trust")?.status).toBe("waiting");
  });

  it("marks a heartbeat in the soft-fail window as degraded", () => {
    const result = deriveEdgeNodeReadiness(
      node({ lastSeenAt: new Date(NOW.getTime() - EDGE_HEARTBEAT_DEGRADED_AFTER_MS - 1) }),
      { now: NOW, requiredCapabilities: ["federation.discovery"] },
    );

    expect(result.health).toBe("degraded");
    expect(result.nextAction).toBe("investigate-node");
  });

  it("marks missing, disabled, failing, and stale required capability evidence as degraded", () => {
    const cases: EdgeReadinessNode["capabilities"][] = [
      [],
      [{ capability: "federation.discovery", mode: "disabled", status: "healthy", reportedAt: NOW }],
      [{ capability: "federation.discovery", mode: "enabled", status: "failing", reportedAt: NOW }],
      [{
        capability: "federation.discovery",
        mode: "enabled",
        status: "healthy",
        reportedAt: new Date(NOW.getTime() - EDGE_HEARTBEAT_OFFLINE_AFTER_MS - 1),
      }],
    ];

    for (const capabilities of cases) {
      const result = deriveEdgeNodeReadiness(node({ capabilities }), {
        now: NOW,
        requiredCapabilities: ["federation.discovery"],
      });
      expect(result.health).toBe("degraded");
      expect(result.nextAction).toBe("repair-capability");
    }
  });

  it("gives quarantine and revocation precedence without calling either healthy", () => {
    const quarantined = deriveEdgeNodeReadiness(node({ trustState: "quarantined" }), { now: NOW });
    const revoked = deriveEdgeNodeReadiness(node({ trustState: "revoked" }), { now: NOW });

    expect(quarantined.health).toBe("quarantined");
    expect(quarantined.nextAction).toBe("review-quarantine");
    expect(revoked.health).toBe("revoked");
    expect(revoked.nextAction).toBe("replace-node");
  });

  it("returns setup-required when the enabled installation has no node", () => {
    const result = deriveEdgeNodeReadiness(null, {
      now: NOW,
      edgeEnabled: true,
      requiredCapabilities: ["federation.discovery"],
    });

    expect(result.health).toBe("setup-required");
    expect(result.nextAction).toBe("repair-service");
  });

  it("returns an explicit activation action when Edge was not enabled", () => {
    const result = deriveEdgeNodeReadiness(null, { now: NOW, edgeEnabled: false });

    expect(result.health).toBe("setup-required");
    expect(result.nextAction).toBe("activate-edge");
  });
});

describe("selectMainInstallationNode", () => {
  it("selects the single installer-managed node ahead of remote nodes", () => {
    const result = selectMainInstallationNode([
      node({ id: "remote", nodeId: "edge_remote", installerManaged: false, customerAccountId: "customer-1" }),
      node(),
    ]);

    expect(result.status).toBe("found");
    expect(result.node?.nodeId).toBe("edge_local");
    expect(result.basis).toBe("installer-managed");
  });

  it("uses one unscoped legacy node only when it is unambiguous", () => {
    const result = selectMainInstallationNode([node({ installerManaged: false })]);

    expect(result.status).toBe("found");
    expect(result.basis).toBe("legacy-unscoped");
  });

  it("refuses to guess between multiple installer-managed or legacy candidates", () => {
    const managed = selectMainInstallationNode([
      node({ id: "one", nodeId: "one" }),
      node({ id: "two", nodeId: "two" }),
    ]);
    const legacy = selectMainInstallationNode([
      node({ id: "one", nodeId: "one", installerManaged: false }),
      node({ id: "two", nodeId: "two", installerManaged: false }),
    ]);

    expect(managed.status).toBe("ambiguous");
    expect(legacy.status).toBe("ambiguous");
  });

  it("does not treat customer-scoped nodes as the main installation", () => {
    const result = selectMainInstallationNode([
      node({ installerManaged: false, customerAccountId: "customer-1", customerSiteId: "site-1" }),
    ]);

    expect(result.status).toBe("missing");
  });
});

describe("deriveNearbyDiscoveryHealth", () => {
  it("reports an installer enrollment conflict instead of claiming discovery was never registered", () => {
    const nodes = [
      node({ id: "current", nodeId: "edge_current" }),
      node({
        id: "historical",
        nodeId: "edge_historical",
        platform: "linux",
        installMode: "container-host",
        lastSeenAt: new Date("2026-07-20T12:00:00.000Z"),
      }),
    ];
    const selection = selectMainInstallationNode(nodes);

    const result = deriveNearbyDiscoveryHealth({
      selection,
      readiness: null,
      discoveryCapability: null,
    });

    expect(result).toEqual({
      status: "unavailable",
      label: "Enrollment conflict",
      detail:
        "Multiple installer-managed Edge Nodes claim this installation. One that has been silent for a week beside a live one retires itself within the hour; two live ones need a person to review Edge Nodes.",
    });
  });
});
