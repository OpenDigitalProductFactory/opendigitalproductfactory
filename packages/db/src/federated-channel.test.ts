import { describe, expect, it } from "vitest";

import type { DemandEnvelopeV1 } from "./federated-demand-contract";
import {
  audienceForOutboundRole,
  channelPolicySelectsRecord,
  forwardDemandEnvelope,
  forwardingGrantFromPolicy,
  validateChannelForwarding,
  type ChannelDemandPolicy,
} from "./federated-channel";

const envelope: DemandEnvelopeV1 = {
  specVersion: "dpf.demand/1",
  envelopeId: "dem_origin",
  originInstallationId: "inst_customer",
  originRecordRef: "ref_opaque_customer",
  originVersion: 7,
  route: [],
  audience: "partner",
  title: "Customer-approved demand",
  summary: "A minimized need the customer elected to share.",
  signal: { occurrenceCount: 3, affectedOrganizations: 1 },
  attribution: "pseudonymous",
  forwarding: {
    permitted: true,
    audiences: ["founder"],
    expiresAt: "2026-08-01T00:00:00.000Z",
  },
  createdAt: "2026-07-20T00:00:00.000Z",
  updatedAt: "2026-07-20T00:00:00.000Z",
  payloadDigest: "sha256:pending",
};

describe("channel demand selection", () => {
  const policy: ChannelDemandPolicy = {
    mode: "explicit",
    selectedRecordRefs: ["local-a"],
    attribution: "pseudonymous",
    allowTransitiveForwarding: false,
    forwardingAudiences: [],
  };

  it("keeps each partner link independently scoped", () => {
    expect(channelPolicySelectsRecord(policy, "local-a")).toBe(true);
    expect(channelPolicySelectsRecord(policy, "local-b")).toBe(false);
    expect(channelPolicySelectsRecord({ ...policy, selectedRecordRefs: ["local-b"] }, "local-a"))
      .toBe(false);
  });

  it("never treats an automatic policy as valid for a partner link", () => {
    expect(channelPolicySelectsRecord({ ...policy, mode: "automatic" } as unknown as ChannelDemandPolicy, "local-a"))
      .toBe(false);
  });

  it("maps directional roles to the least-privilege audience", () => {
    expect(audienceForOutboundRole("managed-by")).toBe("partner");
    expect(audienceForOutboundRole("manages")).toBe("partner");
    expect(audienceForOutboundRole("channel-downstream")).toBe("founder");
    expect(audienceForOutboundRole("channel-upstream")).toBe("partner");
  });

  it("omits transitive permission unless the source explicitly grants it", () => {
    expect(forwardingGrantFromPolicy(policy)).toBeUndefined();
    expect(forwardingGrantFromPolicy({
      ...policy,
      allowTransitiveForwarding: true,
      forwardingAudiences: ["founder", "founder"],
      forwardingExpiresAt: "2026-08-01T00:00:00.000Z",
    })).toEqual({
      permitted: true,
      audiences: ["founder"],
      expiresAt: "2026-08-01T00:00:00.000Z",
    });
  });
});

describe("transitive channel forwarding", () => {
  it("requires explicit, current consent for the target audience", () => {
    expect(validateChannelForwarding({
      envelope,
      targetAudience: "founder",
      forwardingInstallationId: "inst_reseller",
      receivingInstallationId: "inst_founder",
      now: new Date("2026-07-20T01:00:00.000Z"),
    })).toEqual([]);

    expect(validateChannelForwarding({
      envelope: { ...envelope, forwarding: { ...envelope.forwarding!, permitted: false } },
      targetAudience: "founder",
      forwardingInstallationId: "inst_reseller",
      receivingInstallationId: "inst_founder",
    })).toContain("forwarding:not-permitted");

    expect(validateChannelForwarding({
      envelope,
      targetAudience: "community",
      forwardingInstallationId: "inst_reseller",
      receivingInstallationId: "inst_founder",
    })).toContain("forwarding:audience-not-consented");

    expect(validateChannelForwarding({
      envelope,
      targetAudience: "founder",
      forwardingInstallationId: "inst_reseller",
      receivingInstallationId: "inst_founder",
      now: new Date("2026-08-02T00:00:00.000Z"),
    })).toContain("forwarding:consent-expired");
  });

  it("preserves origin and pseudonymity while adding an intermediary attestation", () => {
    const forwarded = forwardDemandEnvelope({
      envelope,
      targetAudience: "founder",
      forwardingInstallationId: "inst_reseller",
      receivingInstallationId: "inst_founder",
      relationshipKind: "channel",
      linkId: "FL-RESELLER-FOUNDER",
      now: new Date("2026-07-20T01:00:00.000Z"),
    });

    expect(forwarded.originInstallationId).toBe("inst_customer");
    expect(forwarded.originRecordRef).toBe("ref_opaque_customer");
    expect(forwarded.attribution).toBe("pseudonymous");
    expect(forwarded.audience).toBe("founder");
    expect(forwarded.route).toHaveLength(1);
    expect(forwarded.route[0]).toMatchObject({
      installationId: "inst_reseller",
      relationshipKind: "channel",
      receivedAt: "2026-07-20T01:00:00.000Z",
    });
    expect(forwarded.route[0]?.attestationDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(forwarded.payloadDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("rejects cycles and self-forwarding", () => {
    expect(validateChannelForwarding({
      envelope: {
        ...envelope,
        route: [{
          installationId: "inst_founder",
          relationshipKind: "channel",
          receivedAt: "2026-07-20T00:30:00.000Z",
          attestationDigest: `sha256:${"a".repeat(64)}`,
        }],
      },
      targetAudience: "founder",
      forwardingInstallationId: "inst_reseller",
      receivingInstallationId: "inst_founder",
    })).toContain("forwarding:receiver-already-in-route");
  });
});
