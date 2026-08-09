import type { SurfaceDefinition } from "@dpf/types";

import type { SurfaceLoaderResult } from "../authorized-surface-runtime";

export const DISCOVERY_OPERATIONS_LOADER_ID = "estate-discovery.view-model";

export type DiscoverySurfaceModel = {
  productsLinked: number;
  needsReview: number;
  latestRun: {
    runKey: string;
    status: string;
    itemCount: number;
    relationshipCount: number;
  } | null;
  openIssues: Array<{ issueType: string; count: number }>;
  detectedGateway: string | null;
  connections: Array<{
    id: string;
    name: string;
    collectorType: string;
    status: string;
    endpointUrl: string;
    configuration: Record<string, unknown>;
    hasApiKey: boolean;
    lastTestedAt: string | null;
    lastTestStatus: string | null;
    lastTestMessage: string | null;
  }>;
};

export const DISCOVERY_OPERATIONS_SURFACE: SurfaceDefinition = {
  contractVersion: "1.0",
  surfaceId: "platform.estate-discovery",
  label: "Estate Discovery",
  purpose: "Understand discovery evidence and configure, test, and operate authorized network discovery connections.",
  supportedModes: ["browser", "headless", "workroom", "scheduled", "background", "external", "mobile"],
  entryPoints: [
    { kind: "route", pattern: "/platform/tools/discovery" },
    { kind: "route", pattern: "/inventory" },
    { kind: "mobile-view", viewId: "estate-discovery" },
    { kind: "workroom", workroomType: "platform-operations" },
    { kind: "resource", resourceType: "discovery-connection" },
    { kind: "task-intent", intent: "configure network discovery" },
  ],
  loaderId: DISCOVERY_OPERATIONS_LOADER_ID,
  nodes: [
    { nodeId: "surface", kind: "surface", accessibleName: "Estate Discovery", valuePolicy: "none", sensitivity: "internal" },
    { nodeId: "metric.products-linked", parentId: "surface", kind: "metric", accessibleName: "Products linked", valuePolicy: "read", sensitivity: "internal" },
    { nodeId: "metric.needs-review", parentId: "surface", kind: "metric", accessibleName: "Needs review", valuePolicy: "read", sensitivity: "internal" },
    { nodeId: "issues.gateway-connections", parentId: "surface", kind: "alert", accessibleName: "Gateway connections needed", valuePolicy: "read", sensitivity: "internal" },
    { nodeId: "connection.form", parentId: "surface", kind: "form", accessibleName: "Configure Discovery Connection", valuePolicy: "none", sensitivity: "internal" },
    { nodeId: "connection.id", parentId: "connection.form", kind: "record", accessibleName: "Existing Connection", valuePolicy: "read", sensitivity: "confidential", rendered: false },
    { nodeId: "connection.name", parentId: "connection.form", kind: "field", accessibleName: "Connection Name", fieldType: "text", valuePolicy: "read", sensitivity: "internal", rendered: false },
    { nodeId: "connection.method", parentId: "connection.form", kind: "field", accessibleName: "Discovery Method", fieldType: "select", valuePolicy: "read", sensitivity: "internal" },
    { nodeId: "connection.target", parentId: "connection.form", kind: "field", accessibleName: "Target IP or Hostname", fieldType: "text", valuePolicy: "read", sensitivity: "internal" },
    { nodeId: "connection.community", parentId: "connection.form", kind: "field", accessibleName: "Connection Credential", fieldType: "password", valuePolicy: "write-only", sensitivity: "secret", when: { nodeId: "connection.method", oneOf: ["unifi", "snmp"] } },
    { nodeId: "connection.site", parentId: "connection.form", kind: "field", accessibleName: "UniFi Site", fieldType: "text", valuePolicy: "read", sensitivity: "internal", when: { nodeId: "connection.method", equals: "unifi" } },
    { nodeId: "connection.tls-insecure", parentId: "connection.form", kind: "field", accessibleName: "Allow self-signed controller certificate", fieldType: "checkbox", valuePolicy: "read", sensitivity: "internal", when: { nodeId: "connection.method", equals: "unifi" } },
    { nodeId: "connection.save-and-test", parentId: "connection.form", kind: "action", accessibleName: "Save & Test", valuePolicy: "none", sensitivity: "internal" },
  ],
  actions: [
    { actionId: "connection.set-name", label: "Set Connection Name", actionClass: "ui-local", localEffect: { kind: "set-value", targetNodeId: "connection.name" }, risk: "low", confirmation: "none" },
    { actionId: "connection.set-method", label: "Set Discovery Method", actionClass: "ui-local", localEffect: { kind: "set-value", targetNodeId: "connection.method" }, risk: "low", confirmation: "none" },
    { actionId: "connection.set-target", label: "Set Target IP or Hostname", actionClass: "ui-local", localEffect: { kind: "set-value", targetNodeId: "connection.target" }, risk: "low", confirmation: "none" },
    { actionId: "connection.set-community", label: "Set Community String", actionClass: "ui-local", localEffect: { kind: "set-value", targetNodeId: "connection.community" }, risk: "low", confirmation: "none" },
    { actionId: "connection.set-site", label: "Set UniFi Site", actionClass: "ui-local", localEffect: { kind: "set-value", targetNodeId: "connection.site" }, risk: "low", confirmation: "none" },
    { actionId: "connection.set-tls-insecure", label: "Set self-signed certificate posture", actionClass: "ui-local", localEffect: { kind: "set-value", targetNodeId: "connection.tls-insecure" }, risk: "low", confirmation: "none" },
    {
      actionId: "connection.save-and-test",
      label: "Save & Test",
      description: "Save the authorized discovery connection and immediately test the real collector.",
      actionClass: "domain",
      tool: "configure_and_test_discovery_connection",
      risk: "medium",
      confirmation: "policy",
      idempotent: true,
      argMap: {
        id: "connection.id",
        name: "connection.name",
        collectorType: "connection.method",
        endpointUrl: "connection.target",
        apiKey: "connection.community",
        "configuration.site": "connection.site",
        "configuration.tlsInsecure": "connection.tls-insecure",
      },
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          gatewayEntityId: { type: "string" },
          configuration: { type: "object" },
        },
      },
    },
  ],
};

export function projectDiscoveryOperationsSurface(model: DiscoverySurfaceModel): SurfaceLoaderResult {
  const selected = model.connections[0];
  const gatewayConnectionIssues = model.openIssues.find((issue) => issue.issueType === "gateway_connection_needed")?.count ?? 0;
  const method = selected?.collectorType ?? "unifi";
  const target = selected?.endpointUrl ?? model.detectedGateway ?? "";
  const name = selected?.name ?? (model.detectedGateway ? `Gateway ${model.detectedGateway}` : "Network Gateway");
  const latest = model.latestRun
    ? `${model.latestRun.runKey}:${model.latestRun.status}:${model.latestRun.itemCount}:${model.latestRun.relationshipCount}`
    : "none";

  return {
    revisionSeed: [
      latest,
      model.productsLinked,
      model.needsReview,
      gatewayConnectionIssues,
      ...model.connections.map((connection) => [
        connection.id,
        connection.status,
        connection.lastTestedAt,
        connection.lastTestStatus,
      ].join(":")),
    ].join("|"),
    summary: {
      label: "Estate Discovery",
      purpose: "Resolve discovery evidence and configure network collectors.",
      status: gatewayConnectionIssues > 0 ? "attention-needed" : "ready",
      alertCount: gatewayConnectionIssues,
      highlights: [
        `${model.connections.length} discovery connection${model.connections.length === 1 ? "" : "s"} configured; ${model.needsReview} items need review.`,
        "SNMP is the network-discovery method on this surface; SMTP configures outbound email elsewhere.",
        "For SNMP choose SNMP (Generic), enter Target IP or Hostname and the write-only Community String, then use Save & Test.",
      ],
    },
    values: {
      "metric.products-linked": model.productsLinked,
      "metric.needs-review": model.needsReview,
      "issues.gateway-connections": gatewayConnectionIssues,
      "connection.name": name,
      "connection.id": selected?.id ?? null,
      "connection.method": method,
      "connection.target": target,
      "connection.community": undefined,
      "connection.site": typeof selected?.configuration.site === "string" ? selected.configuration.site : "default",
      "connection.tls-insecure": selected?.configuration.tlsInsecure === true,
    },
    states: {
      "connection.form": {
        configured: !!selected,
        hasStoredCredential: selected?.hasApiKey ?? false,
        connectionStatus: selected?.status ?? "unconfigured",
        lastTestStatus: selected?.lastTestStatus ?? null,
      },
      "connection.method": {
        choices: ["unifi", "snmp", "arp_scan"],
        labels: ["Ubiquiti UniFi", "SNMP (Generic)", "Network Scan (ARP)"],
      },
    },
    accessibleNames: {
      "connection.target": method === "unifi" ? "Controller URL" : method === "arp_scan" ? "Subnet to scan" : "Target IP or Hostname",
      "connection.community": method === "unifi" ? "API Key" : "Community String",
    },
    help: {
      "connection.method": "SNMP discovers network devices. SMTP sends outbound email and is configured on the email-provider surface, not Estate Discovery.",
      "connection.target": "For SNMP, enter the device IP address or hostname reachable over UDP port 161.",
      "connection.community": "Enter the SNMP community string. It is write-only, encrypted at rest, and never returned to a coworker or renderer.",
      "connection.save-and-test": "Saves the connection, runs the actual collector test, and reports status and discovered item count.",
    },
  };
}
