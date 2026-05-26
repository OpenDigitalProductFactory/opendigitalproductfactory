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
});
