// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { mockSetDiscovery, mockIssueInvitation, mockSetEnvironment, mockStartPairing, mockPollPairing, mockApprovePairing, mockDenyPairing } = vi.hoisted(() => ({
  mockSetDiscovery: vi.fn(),
  mockIssueInvitation: vi.fn(),
  mockSetEnvironment: vi.fn(),
  mockStartPairing: vi.fn(),
  mockPollPairing: vi.fn(),
  mockApprovePairing: vi.fn(),
  mockDenyPairing: vi.fn(),
}));

vi.mock("@/lib/actions/federation-links", () => ({
  approveFederationLinkAction: vi.fn(),
  enrollWithPeerAction: vi.fn(),
  issueFederationBootstrapAction: mockIssueInvitation,
  quarantineFederationLinkAction: vi.fn(),
  revokeFederationLinkAction: vi.fn(),
  setFederationDiscoveryEnabledAction: mockSetDiscovery,
  setFederationLinkEnvironmentAction: mockSetEnvironment,
  startNearbyPairingAction: mockStartPairing,
  pollNearbyPairingAction: mockPollPairing,
  approveNearbyPairingAction: mockApprovePairing,
  denyNearbyPairingAction: mockDenyPairing,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
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

  it("shows an incoming request with the matching code and canonical projection summary", () => {
    render(<FederationLinksAdminClient rows={[]} nearbyPairings={[{
      pairingId: "pair_123", direction: "incoming", status: "pending", matchingCode: "ABCD-EFGH",
      peerDisplayName: "Arcamanus Mac", peerAuthorityUrl: "https://peer-one.local",
      expiresAt: "2026-07-20T12:15:00.000Z", sharedSlices: ["demand"], retentionClass: "standard",
      staysLocal: ["local backlog details", "work capsules"],
    }]} />);

    expect(screen.getByText("ABCD-EFGH")).toBeTruthy();
    expect(screen.getByText(/Arcamanus Mac is asking to connect/)).toBeTruthy();
    expect(screen.getByText((_, element) => element?.tagName === "P" && element.textContent?.includes("Shares: demand") === true)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Approve this installation" })).toBeTruthy();
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

describe("FederationLinksAdminClient channel setup", () => {
  it("offers a reseller/founder channel without implying exclusivity", () => {
    render(<FederationLinksAdminClient rows={[]} />);

    fireEvent.change(screen.getByLabelText("Relationship preset"), {
      target: { value: "channel" },
    });

    expect((screen.getByLabelText("Relationship preset") as HTMLSelectElement).value).toBe("channel");
    expect(screen.getByRole("option", { name: "channel-upstream (we receive curated demand)" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "channel-downstream (we share curated demand)" })).toBeTruthy();
    expect(screen.getByText(/Each installation independently chooses what demand crosses this link/)).toBeTruthy();
    expect(screen.getByText(/does not make this partner exclusive/i)).toBeTruthy();
  });

  it("lets an operator classify each link environment explicitly", async () => {
    mockSetEnvironment.mockResolvedValue({ ok: true, environmentClass: "production" });
    render(<FederationLinksAdminClient rows={[{
      linkId: "FL-1", displayName: "Founder development peer", role: "channel-upstream", linkState: "trusted",
      peerAuthorityUrl: "https://peer.example", peerOrganizationRef: null, approvedLocal: true, approvedPeer: true,
      sharedSlices: ["demand"], sharedRetention: "standard", environmentClass: "development",
      createdAtISO: "2026-07-20T00:00:00.000Z",
    }]} />);

    fireEvent.change(screen.getByLabelText("Environment for Founder development peer"), { target: { value: "production" } });
    await waitFor(() => expect(mockSetEnvironment).toHaveBeenCalledWith("FL-1", "production"));
  });
});
