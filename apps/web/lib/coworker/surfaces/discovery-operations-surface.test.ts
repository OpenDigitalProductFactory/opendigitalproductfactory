import { describe, expect, it } from "vitest";

import {
  DISCOVERY_OPERATIONS_SURFACE,
  projectDiscoveryOperationsSurface,
} from "./discovery-operations-surface";

describe("Estate Discovery Authorized Surface", () => {
  it("publishes the exact SNMP form semantics and composite Save & Test binding", () => {
    expect(DISCOVERY_OPERATIONS_SURFACE.surfaceId).toBe("platform.estate-discovery");
    expect(DISCOVERY_OPERATIONS_SURFACE.supportedModes).toEqual([
      "browser", "headless", "workroom", "scheduled", "background", "external", "mobile",
    ]);
    expect(DISCOVERY_OPERATIONS_SURFACE.entryPoints).toEqual(expect.arrayContaining([
      { kind: "route", pattern: "/platform/tools/discovery" },
      { kind: "route", pattern: "/inventory" },
      { kind: "task-intent", intent: "configure network discovery" },
      { kind: "workroom", workroomType: "platform-operations" },
      { kind: "mobile-view", viewId: "estate-discovery" },
    ]));
    expect(DISCOVERY_OPERATIONS_SURFACE.nodes.map((node) => node.accessibleName)).toEqual(
      expect.arrayContaining([
        "Discovery Method",
        "Target IP or Hostname",
        "Connection Credential",
        "Save & Test",
      ]),
    );
    const community = DISCOVERY_OPERATIONS_SURFACE.nodes.find((node) => node.nodeId === "connection.community");
    expect(community).toMatchObject({ valuePolicy: "write-only", sensitivity: "secret" });
    expect(DISCOVERY_OPERATIONS_SURFACE.actions.find((action) => action.actionId === "connection.save-and-test"))
      .toMatchObject({ actionClass: "domain", tool: "configure_and_test_discovery_connection" });
  });

  it("projects current page state and explicitly disambiguates SMTP from SNMP", () => {
    const projection = projectDiscoveryOperationsSurface({
      productsLinked: 7,
      needsReview: 3,
      latestRun: { runKey: "run-1", status: "completed", itemCount: 12, relationshipCount: 4 },
      openIssues: [{ issueType: "gateway_connection_needed", count: 3 }],
      detectedGateway: "192.168.1.1",
      connections: [{
        id: "conn-1",
        name: "Core switch",
        collectorType: "snmp",
        status: "active",
        endpointUrl: "192.168.1.2",
        configuration: {},
        hasApiKey: true,
        lastTestedAt: "2026-08-08T12:00:00.000Z",
        lastTestStatus: "ok",
        lastTestMessage: "Discovered 3 items",
      }],
    });

    expect(projection.summary.alertCount).toBe(3);
    expect(projection.summary.highlights?.join(" ")).toMatch(/SNMP.*SMTP/);
    expect(projection.values["connection.method"]).toBe("snmp");
    expect(projection.values["connection.target"]).toBe("192.168.1.2");
    expect(projection.values["connection.community"]).toBeUndefined();
    expect(projection.accessibleNames?.["connection.community"]).toBe("Community String");
    expect(projection.help?.["connection.method"]).toMatch(/SNMP.*network.*SMTP.*email/i);
  });
});
