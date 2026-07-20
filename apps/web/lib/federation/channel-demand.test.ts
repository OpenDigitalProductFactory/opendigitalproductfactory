import { describe, expect, it, vi } from "vitest";

import {
  bindPeerInstallationIdentity,
  decodeChannelDemandPolicy,
} from "./channel-demand";

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
