// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { mockSetDiscovery } = vi.hoisted(() => ({ mockSetDiscovery: vi.fn() }));

vi.mock("@/lib/actions/federation-links", () => ({
  approveFederationLinkAction: vi.fn(),
  enrollWithPeerAction: vi.fn(),
  issueFederationBootstrapAction: vi.fn(),
  quarantineFederationLinkAction: vi.fn(),
  revokeFederationLinkAction: vi.fn(),
  setFederationDiscoveryEnabledAction: mockSetDiscovery,
}));

import { FederationLinksAdminClient } from "./FederationLinksAdminClient";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const secureCandidate = {
  discoveryId: "yM4sS9VcH0rW2nQ8",
  endpoint: "https://peer-one.local",
  protocol: "1" as const,
  capabilityDigest: "8f31c9a2",
  pairPath: "/connect/pair" as const,
  observedAt: "2026-07-20T03:00:00.000Z",
  expiresAt: "2026-07-20T03:02:00.000Z",
  automaticPairing: "tls-validation-required" as const,
};

describe("FederationLinksAdminClient nearby setup", () => {
  it("shows nearby candidates without treating them as trusted", () => {
    render(<FederationLinksAdminClient rows={[]} nearbyCandidates={[secureCandidate]} />);

    expect(screen.getByText("DPF found nearby")).toBeTruthy();
    expect(screen.getByText("Not connected")).toBeTruthy();
    expect(screen.getByText(/TLS will be verified before any invitation is sent/)).toBeTruthy();
  });

  it("prefills the peer endpoint and same-organization preset", () => {
    render(<FederationLinksAdminClient rows={[]} nearbyCandidates={[secureCandidate]} />);

    fireEvent.click(screen.getByRole("button", { name: "Set up this DPF" }));

    expect((screen.getByLabelText("Peer URL") as HTMLInputElement).value).toBe("https://peer-one.local");
    expect((screen.getByLabelText("Relationship preset") as HTMLSelectElement).value).toBe("same-organization");
    expect(screen.getByText(/Shared platform demand and dispositions/)).toBeTruthy();
  });

  it("blocks automatic setup for an HTTP candidate", () => {
    render(
      <FederationLinksAdminClient
        rows={[]}
        nearbyCandidates={[
          {
            ...secureCandidate,
            endpoint: "http://peer-two.local:3000",
            automaticPairing: "blocked-insecure-transport",
          },
        ]}
      />,
    );

    expect(screen.getByRole("button", { name: "Secure setup required" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/Automatic pairing is blocked because this endpoint is not HTTPS/)).toBeTruthy();
  });

  it("offers an Authority-owned enable action when discovery is paused", async () => {
    mockSetDiscovery.mockResolvedValue({ ok: true, updated: 1, enabled: true });
    render(
      <FederationLinksAdminClient
        rows={[]}
        nearbyDiscoveryHealth={{
          status: "disabled",
          label: "Paused",
          detail: "Nearby discovery is disabled by the Authority.",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Enable nearby discovery" }));

    await waitFor(() => expect(mockSetDiscovery).toHaveBeenCalledWith(true));
  });
});
