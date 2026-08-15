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

const UNIFI_CANDIDATE = {
  entityId: "gw-unifi",
  entityKey: "unifi:aa:bb:cc:dd:ee:ff",
  name: "Cloud Gateway Ultra",
  address: "192.168.0.1",
  manufacturer: "Ubiquiti",
  model: "UCG-Ultra",
  confidence: 0.96,
  evidence: ["Manufacturer: Ubiquiti", "Model: UCG-Ultra", "Identification confidence 96%"],
  recommendedCollector: "unifi" as const,
  recommendation: "DPF identified UniFi/Ubiquiti evidence for this gateway.",
  canonicalEndpoint: "https://192.168.0.1",
  matchesDetectedGateway: true,
  usable: true,
};

describe("ConfigureConnectionInline", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfigureDiscoveryConnection.mockResolvedValue({ ok: true, connectionId: "conn-1" });
    mockTestDiscoveryConnection.mockResolvedValue({ ok: true, status: "ok", deviceCount: 1 });
  });

  it("uses an identified gateway as the primary target without rendering an editable URL", () => {
    render(
      <ConfigureConnectionInline
        gatewayCandidates={[UNIFI_CANDIDATE]}
        gatewayName="Network Gateway"
        onComplete={vi.fn()}
      />,
    );

    expect(screen.getByText("Cloud Gateway Ultra")).toBeTruthy();
    expect(screen.getByText(/Ubiquiti.*UCG-Ultra/i)).toBeTruthy();
    expect(screen.getByText(/Local address/i)).toBeTruthy();
    expect(screen.getByText("192.168.0.1")).toBeTruthy();
    expect(screen.queryByLabelText(/controller url/i)).toBeNull();
    expect(screen.getByText(/DPF identified UniFi/i)).toBeTruthy();
  });

  it("submits the selected gateway identity and canonical endpoint", async () => {
    render(
      <ConfigureConnectionInline
        gatewayCandidates={[UNIFI_CANDIDATE]}
        gatewayName="Network Gateway"
        onComplete={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText(/^API Key/i), {
      target: { value: "unifi-api-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(mockConfigureDiscoveryConnection).toHaveBeenCalledTimes(1));
    expect(mockConfigureDiscoveryConnection).toHaveBeenCalledWith(expect.objectContaining({
      gatewayEntityId: "gw-unifi",
      name: "Cloud Gateway Ultra",
      collectorType: "unifi",
      endpointUrl: "https://192.168.0.1",
    }));
  });

  it("requires a deliberate choice when discovered gateways are ambiguous", async () => {
    render(
      <ConfigureConnectionInline
        gatewayCandidates={[
          { ...UNIFI_CANDIDATE, matchesDetectedGateway: false },
          {
            ...UNIFI_CANDIDATE,
            entityId: "gw-second",
            entityKey: "unifi:11:22:33:44:55:66",
            name: "Second Cloud Gateway",
            address: "192.168.9.1",
            canonicalEndpoint: "https://192.168.9.1",
            matchesDetectedGateway: false,
          },
        ]}
        gatewayName="Network Gateway"
        onComplete={vi.fn()}
      />,
    );

    expect(screen.getByRole("option", {
      name: /Cloud Gateway Ultra.*Ubiquiti.*UCG-Ultra.*192\.168\.0\.1/i,
    })).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/^API Key/i), {
      target: { value: "unifi-api-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(await screen.findByText("Choose a gateway before saving this connection.")).toBeTruthy();
    expect(mockConfigureDiscoveryConnection).not.toHaveBeenCalled();
  });

  it("keeps manual endpoint entry behind recovery and preserves invalid input", async () => {
    render(
      <ConfigureConnectionInline
        gatewayCandidates={[UNIFI_CANDIDATE]}
        gatewayName="Network Gateway"
        onComplete={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText(/^manual gateway$/i));
    const recoveryInput = screen.getByLabelText(/gateway address/i) as HTMLInputElement;
    fireEvent.change(recoveryInput, { target: { value: "file:///etc/passwd" } });
    fireEvent.change(screen.getByLabelText(/^API Key/i), {
      target: { value: "unifi-api-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(await screen.findByText(/HTTP or HTTPS gateway address/i)).toBeTruthy();
    expect(recoveryInput.value).toBe("file:///etc/passwd");
    expect(mockConfigureDiscoveryConnection).not.toHaveBeenCalled();
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
    fireEvent.click(screen.getByRole("checkbox", { name: /allow self-signed certificate/i }));
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
