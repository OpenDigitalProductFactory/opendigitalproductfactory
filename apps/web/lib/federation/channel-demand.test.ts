import { describe, expect, it, vi } from "vitest";

vi.mock("./demand-delivery", () => ({
  queueDemandProjection: vi.fn(),
  queueDemandWithdrawal: vi.fn(),
  queueForwardedDemand: vi.fn(),
}));
vi.mock("./demand-identity", () => ({ resolveFederationIdentity: vi.fn() }));
vi.mock("./demand-reconciliation", () => ({
  relationshipPresetForRole: (role: string) => role.startsWith("channel-") ? "channel" : "service-provider",
}));

import {
  bindPeerInstallationIdentity,
  decodeChannelDemandPolicy,
  isOutboundDemandSharingRole,
  selectLocalDemandForLink,
} from "./channel-demand";

describe("isOutboundDemandSharingRole", () => {
  it("allows only the local relationship faces that point toward the distributor or Founder Hub", () => {
    expect(isOutboundDemandSharingRole("managed-by")).toBe(true);
    expect(isOutboundDemandSharingRole("channel-downstream")).toBe(true);
    expect(isOutboundDemandSharingRole("manages")).toBe(false);
    expect(isOutboundDemandSharingRole("channel-upstream")).toBe(false);
    expect(isOutboundDemandSharingRole("peer")).toBe(false);
  });
});

describe("selectLocalDemandForLink direction", () => {
  it.each(["manages", "channel-upstream"])(
    "rejects the reverse-facing %s relationship at the service boundary",
    async (role) => {
      const db = {
        federationLink: { findUnique: vi.fn().mockResolvedValue({
          linkId: "FL-REVERSE",
          role,
          linkState: "trusted",
          peerAuthorityUrl: "https://peer.example",
          peerTokenEnc: "token",
          peerInstallationId: "inst_peer",
          projectionContractId: null,
          revokedAt: null,
          quarantinedAt: null,
        }) },
        backlogItem: { findUnique: vi.fn().mockResolvedValue({
          itemId: "BI-LOCAL",
          title: "Local need",
          body: null,
          workType: "feature",
          occurrenceCount: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
          digitalProduct: null,
        }) },
        projectionContract: { findFirst: vi.fn().mockResolvedValue(null) },
      };

      await expect(selectLocalDemandForLink(db as never, {
        linkId: "FL-REVERSE",
        itemId: "BI-LOCAL",
      })).rejects.toThrow("Local demand can only be shared toward your distributor or Founder Hub.");
    },
  );

  it("does not attach transitive consent when a distributor shares directly with Founder Hub", async () => {
    const db = {
      federationLink: { findUnique: vi.fn().mockResolvedValue({
        linkId: "FL-FOUNDER",
        role: "channel-downstream",
        linkState: "trusted",
        peerAuthorityUrl: "https://arcamanus.example",
        peerTokenEnc: "token",
        peerInstallationId: "inst_founder",
        projectionContractId: null,
        revokedAt: null,
        quarantinedAt: null,
      }) },
      backlogItem: { findUnique: vi.fn().mockResolvedValue({
        itemId: "BI-LOCAL",
        title: "Distributor need",
        body: null,
        workType: "feature",
        occurrenceCount: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        digitalProduct: null,
      }) },
      projectionContract: { findFirst: vi.fn().mockResolvedValue(null) },
    };

    await expect(selectLocalDemandForLink(db as never, {
      linkId: "FL-FOUNDER",
      itemId: "BI-LOCAL",
      allowForwardToFounder: true,
    })).rejects.toThrow("Founder forwarding consent applies only when sharing with a distributor.");
  });
});

describe("decodeChannelDemandPolicy", () => {
  it("defaults partner exchange to explicit selection and pseudonymous attribution", () => {
    expect(decodeChannelDemandPolicy(null)).toEqual({
      mode: "explicit",
      selectedRecordRefs: [],
      attribution: "pseudonymous",
      allowTransitiveForwarding: false,
      forwardingAudiences: [],
    });
  });

  it("bounds, deduplicates, and narrows persisted policy values", () => {
    expect(decodeChannelDemandPolicy({ demandChannelPolicy: {
      mode: "automatic",
      selectedRecordRefs: ["BI-A", "BI-A", 42],
      attribution: "organization",
      allowTransitiveForwarding: true,
      forwardingAudiences: ["founder", "community"],
    } })).toEqual({
      mode: "explicit",
      selectedRecordRefs: ["BI-A"],
      attribution: "organization",
      allowTransitiveForwarding: true,
      forwardingAudiences: ["founder"],
    });
  });
});

describe("bindPeerInstallationIdentity", () => {
  it("learns an authenticated digest sender once", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    await expect(bindPeerInstallationIdentity(
      { federationLink: { updateMany } },
      "FL-1",
      "inst_peer_opaque",
    )).resolves.toEqual({ peerInstallationId: "inst_peer_opaque" });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        linkId: "FL-1",
        OR: [{ peerInstallationId: null }, { peerInstallationId: "inst_peer_opaque" }],
      },
      data: { peerInstallationId: "inst_peer_opaque" },
    });
  });

  it("rejects an authenticated link that changes installation identity", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    await expect(bindPeerInstallationIdentity(
      { federationLink: { updateMany } },
      "FL-1",
      "inst_different",
    )).rejects.toThrow("Peer installation identity does not match this connection.");
  });
});
