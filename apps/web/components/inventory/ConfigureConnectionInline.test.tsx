// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockConfigureDiscoveryConnection, mockTestDiscoveryConnection } = vi.hoisted(() => ({
  mockConfigureDiscoveryConnection: vi.fn(),
  mockTestDiscoveryConnection: vi.fn(),
}));

vi.mock("@/lib/actions/discovery", () => ({
  configureDiscoveryConnection: mockConfigureDiscoveryConnection,
  testDiscoveryConnection: mockTestDiscoveryConnection,
}));

import { ConfigureConnectionInline } from "./ConfigureConnectionInline";
import { compareAuthorizedSurfaceToDom } from "@/lib/coworker/authorized-surface-dom-conformance";
import { compileSurfaceDefinitions } from "@/lib/coworker/authorized-surface-compiler";
import { createAuthorizedSurfaceRuntime } from "@/lib/coworker/authorized-surface-runtime";
import {
  DISCOVERY_OPERATIONS_LOADER_ID,
  DISCOVERY_OPERATIONS_SURFACE,
  projectDiscoveryOperationsSurface,
} from "@/lib/coworker/surfaces/discovery-operations-surface";

describe("ConfigureConnectionInline", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfigureDiscoveryConnection.mockResolvedValue({ ok: true, connectionId: "conn-1" });
    mockTestDiscoveryConnection.mockResolvedValue({ ok: true, status: "ok", deviceCount: 1 });
  });

  it("sends the closed-LAN TLS choice with the UniFi connection configuration", async () => {
    render(
      <ConfigureConnectionInline
        gatewayName="Network Gateway"
        gatewayAddress="192.168.0.1"
        onComplete={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText(/^API Key/i), {
      target: { value: "unifi-api-key" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /allow self-signed controller certificate/i }));
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(mockConfigureDiscoveryConnection).toHaveBeenCalledTimes(1));
    expect(mockConfigureDiscoveryConnection.mock.calls[0][0].configuration).toMatchObject({
      site: "default",
      discoverClients: true,
      tlsInsecure: true,
    });
  });

  it("turns raw TLS test failures into an actionable message", async () => {
    mockTestDiscoveryConnection.mockResolvedValue({
      ok: true,
      status: "unifi_tls_error",
      message: "unifi_tls_error",
    });

    render(
      <ConfigureConnectionInline
        gatewayName="Network Gateway"
        gatewayAddress="192.168.0.1"
        onComplete={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText(/^API Key/i), {
      target: { value: "unifi-api-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(await screen.findByText(/self-signed certificate/i)).toBeTruthy();
    expect(screen.queryByText("unifi_tls_error")).toBeNull();
  });

  it("resets a gateway URL to a subnet when switching to ARP scan", async () => {
    render(
      <ConfigureConnectionInline
        gatewayName="Network Gateway"
        gatewayAddress="https://192.168.0.1"
        onComplete={vi.fn()}
        existing={{
          id: "conn-1",
          collectorType: "unifi",
          site: "default",
          hasApiKey: true,
        }}
      />,
    );

    fireEvent.change(screen.getByLabelText(/discovery method/i), {
      target: { value: "arp_scan" },
    });
    expect((screen.getByLabelText(/subnet to scan/i) as HTMLInputElement).value).toBe("192.168.0.0/24");

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(mockConfigureDiscoveryConnection).toHaveBeenCalledTimes(1));
    expect(mockConfigureDiscoveryConnection.mock.calls[0][0]).toMatchObject({
      id: "conn-1",
      collectorType: "arp_scan",
      endpointUrl: "192.168.0.0/24",
      configuration: { subnet: "192.168.0.0/24" },
    });
  });

  it("projects stable ASC node ids and explains SNMP versus SMTP in the rendered UX", () => {
    const { container } = render(
      <ConfigureConnectionInline
        gatewayName="Network Gateway"
        gatewayAddress="192.168.0.1"
        onComplete={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText(/discovery method/i), {
      target: { value: "snmp" },
    });

    expect(screen.getByText(/SNMP discovers network devices.*SMTP sends outbound email/i)).toBeTruthy();
    for (const nodeId of [
      "connection.form",
      "connection.method",
      "connection.target",
      "connection.community",
      "connection.save-and-test",
    ]) {
      expect(container.querySelector(`[data-surface-node-id="${nodeId}"]`)).toBeTruthy();
    }
  });

  it("matches the compiled browser graph with no unmapped interactive control", async () => {
    const { container } = render(
      <ConfigureConnectionInline
        gatewayName="Network Gateway"
        gatewayAddress="192.168.0.1"
        onComplete={vi.fn()}
      />,
    );
    const catalog = compileSurfaceDefinitions([DISCOVERY_OPERATIONS_SURFACE], {
      toolNames: new Set(["configure_and_test_discovery_connection"]),
      loaderIds: new Set([DISCOVERY_OPERATIONS_LOADER_ID]),
    });
    const runtime = createAuthorizedSurfaceRuntime({
      catalog,
      loaders: new Map([[DISCOVERY_OPERATIONS_LOADER_ID, async () => projectDiscoveryOperationsSurface({
        productsLinked: 0,
        needsReview: 0,
        latestRun: null,
        openIssues: [],
        detectedGateway: "192.168.0.1",
        connections: [],
      })]]),
      authorizeSurface: async () => true,
      authorizeAction: async () => true,
      authorityDigest: async () => "authority",
      executeDomainAction: async () => ({ success: true, message: "ok" }),
    });
    const context = {
      delegatingUserId: "user-1", actingAgentId: "agent-1", mode: "browser" as const,
      locale: "en-US", timezone: "America/Chicago", route: "/platform/tools/discovery",
    };
    const opened = await runtime.open({ context, selector: { surfaceId: DISCOVERY_OPERATIONS_SURFACE.surfaceId } });
    if (!opened.ok) throw new Error(opened.message);
    const snapshot = await runtime.snapshot({ sessionId: opened.session.sessionId, caller: context });
    if (!snapshot.ok || !("graph" in snapshot)) throw new Error("snapshot unavailable");

    expect(compareAuthorizedSurfaceToDom({
      definition: DISCOVERY_OPERATIONS_SURFACE,
      graph: snapshot.graph,
      root: container,
    })).toEqual({
      ok: true, missingRenderedNodeIds: [], duplicateNodeIds: [], unmappedControlDescriptions: [], inaccessibleNodeIds: [],
    });
  });
});
