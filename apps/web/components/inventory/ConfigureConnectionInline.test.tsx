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
});
