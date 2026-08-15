import { describe, expect, it } from "vitest";

import {
  buildFederatedRoomMessageMirror,
  evaluateFederatedRoomAdmission,
} from "./federated-room";

describe("evaluateFederatedRoomAdmission (sovereignty gate, deny-by-default)", () => {
  it("allows only when flag + trusted link + same-org all hold", () => {
    expect(evaluateFederatedRoomAdmission({ a2aEnabled: true, linkTrusted: true, sameOrg: true })).toEqual({
      allowed: true,
      reason: "allowed",
    });
  });

  it("denies when the A2A federation flag is off", () => {
    const d = evaluateFederatedRoomAdmission({ a2aEnabled: false, linkTrusted: true, sameOrg: true });
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("a2a-federation-disabled");
  });

  it("denies an untrusted link", () => {
    const d = evaluateFederatedRoomAdmission({ a2aEnabled: true, linkTrusted: false, sameOrg: true });
    expect(d).toEqual({ allowed: false, reason: "link-not-trusted" });
  });

  it("denies cross-org in the first slice", () => {
    const d = evaluateFederatedRoomAdmission({ a2aEnabled: true, linkTrusted: true, sameOrg: false });
    expect(d).toEqual({ allowed: false, reason: "cross-org-denied" });
  });
});

describe("buildFederatedRoomMessageMirror", () => {
  it("mirrors an inbound post as an external message carrying the GAID (never a local sender)", () => {
    const m = buildFederatedRoomMessageMirror({
      foreignGaid: "gaid:priv:peer.example:agent-9",
      federationLinkId: "LINK-1",
      messageId: "a2a:LINK-1:evt-7",
      body: "Peer coworker weighs in.",
    });
    expect(m.senderType).toBe("external");
    expect(m.channel).toBe("a2a");
    expect(m.structuredPayload).toEqual({
      federated: true,
      gaid: "gaid:priv:peer.example:agent-9",
      federationLinkId: "LINK-1",
    });
    // No senderUserId / senderAgentId — external identity rides in structuredPayload.
    expect("senderUserId" in m).toBe(false);
    expect("senderAgentId" in m).toBe(false);
  });
});
