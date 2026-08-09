import { describe, expect, it } from "vitest";

import {
  introductionId,
  parseIntroductionEnvelope,
  selectIntroductionsForPeer,
} from "./introductions";

const localInstallationId = `inst_${"a".repeat(32)}`;
const requesterInstallationId = `inst_${"b".repeat(32)}`;
const candidateInstallationId = `inst_${"c".repeat(32)}`;

describe("federation introductions", () => {
  it("offers only eligible trusted peers and never includes secrets or backlog payloads", () => {
    const offered = selectIntroductionsForPeer({
      localInstallationId,
      requesterInstallationId,
      requesterRole: "channel-downstream",
      offersIntroductions: true,
      links: [
        {
          linkId: "FL-CANDIDATE",
          installationId: candidateInstallationId,
          deviceId: `did_${"d".repeat(64)}`,
          displayName: "Founder hub",
          authorityUrl: "https://founder-hub.example",
          role: "channel-upstream",
          trusted: true,
          tokenHash: "must-not-cross",
          payload: { backlog: "must-not-cross" },
        },
      ],
    });

    expect(offered).toHaveLength(1);
    expect(offered[0]).toMatchObject({
      installationId: candidateInstallationId,
      displayName: "Founder hub",
      authorityUrl: "https://founder-hub.example",
      introducedByPath: [localInstallationId],
      hopCount: 1,
    });
    expect(JSON.stringify(offered)).not.toMatch(/token|backlog|payload/i);
  });

  it("does not transfer trust and rejects loops, insecure endpoints, and overlong paths", () => {
    expect(parseIntroductionEnvelope({
      installationId: candidateInstallationId,
      deviceId: `did_${"d".repeat(64)}`,
      displayName: "Candidate",
      authorityUrl: "http://candidate.local",
      relationshipHint: "channel-upstream",
      introducedByPath: [localInstallationId],
      hopCount: 1,
    }, { localInstallationId }).ok).toBe(false);

    expect(parseIntroductionEnvelope({
      installationId: candidateInstallationId,
      deviceId: `did_${"d".repeat(64)}`,
      displayName: "Candidate",
      authorityUrl: "https://candidate.example",
      relationshipHint: "channel-upstream",
      introducedByPath: [localInstallationId, candidateInstallationId],
      hopCount: 2,
    }, { localInstallationId }).ok).toBe(false);
  });

  it("derives a stable provenance id", () => {
    expect(introductionId("FL-INTRODUCER", candidateInstallationId))
      .toBe(introductionId("FL-INTRODUCER", candidateInstallationId));
  });
});
