import { describe, expect, it, vi } from "vitest";

import { syncFederationIntroductions, type IntroductionExchangeDb } from "./introduction-exchange";

const localInstallationId = `inst_${"a".repeat(32)}`;
const peerInstallationId = `inst_${"b".repeat(32)}`;
const candidateInstallationId = `inst_${"c".repeat(32)}`;

describe("syncFederationIntroductions", () => {
  it("persists reviewed candidates with provenance and withdraws omissions", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const db = {
      platformConfig: { findUnique: vi.fn(), upsert: vi.fn() },
      federationLink: { findUnique: vi.fn(), findMany: vi.fn().mockResolvedValue([{
        linkId: "FL-INTRODUCER", role: "channel-upstream", peerAuthorityUrl: "https://reseller.example",
        peerTokenEnc: "encrypted", peerInstallationId, peerDeviceId: `did_${"e".repeat(64)}`,
        linkState: "trusted", offersIntroductions: false, acceptsIntroductions: true,
        revokedAt: null, quarantinedAt: null, principal: { displayName: "Reseller" },
      }]) },
      federationIntroductionCandidate: { upsert, updateMany },
    } as unknown as IntroductionExchangeDb;
    const now = new Date("2026-08-09T02:00:00.000Z");
    const post = vi.fn().mockResolvedValue({ ok: true, status: 200, body: { introductions: [{
      installationId: candidateInstallationId,
      deviceId: `did_${"d".repeat(64)}`,
      displayName: "Founder hub",
      authorityUrl: "https://founder-hub.example",
      relationshipHint: "channel-upstream",
      introducedByPath: [peerInstallationId],
      hopCount: 1,
    }] } });

    const result = await syncFederationIntroductions(db, {
      now,
      resolveIdentity: vi.fn().mockResolvedValue({ installationId: localInstallationId, projectionSecret: "x" }),
      decryptToken: () => "dpflink_token",
      post,
    });

    expect(result).toEqual({ linksChecked: 1, candidates: 1, rejected: 0, failed: 0 });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { introducerLinkId_installationId: { introducerLinkId: "FL-INTRODUCER", installationId: candidateInstallationId } },
      create: expect.objectContaining({ introducerLinkId: "FL-INTRODUCER", displayName: "Founder hub" }),
    }));
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ introducerLinkId: "FL-INTRODUCER", installationId: { notIn: [candidateInstallationId] } }),
      data: { withdrawnAt: now },
    }));
  });
});
