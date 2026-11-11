import { describe, expect, it } from "vitest";

import {
  buildInstallationOperatingProfileSnapshot,
  UNDECLARED_ENVIRONMENT_CLASS,
  type InstallationEnvironmentClass,
  type InstallationOperatingIntentV1,
  type InstallationOperatingPurpose,
} from "./installation-operating-intent";
import {
  formatInstanceStanceBriefing,
  resolveInstanceStance,
} from "./installation-instance-stance";

function intent(
  overrides: Partial<InstallationOperatingIntentV1> = {},
): InstallationOperatingIntentV1 {
  return {
    schemaVersion: 1,
    primaryPurpose: "operate-organization",
    secondaryPurposes: [],
    relationshipIntents: [],
    evidence: [],
    confidence: "high",
    confirmation: { status: "confirmed" },
    ...overrides,
  };
}

function stanceFor(
  environmentClass: InstallationEnvironmentClass,
  options: {
    sourceCapable?: boolean;
    holdsIrreplaceableWork?: boolean;
    pairedRef?: string;
    primaryPurpose?: InstallationOperatingPurpose;
    pairingIsEstablished?: boolean;
    peerEnvironmentClass?: InstallationEnvironmentClass | null;
  } = {},
) {
  const snapshot = buildInstallationOperatingProfileSnapshot({
    intent: intent({
      pairedProductionInstallationRef: options.pairedRef,
      primaryPurpose: options.primaryPurpose ?? "operate-organization",
    }),
    environmentClass,
  });
  return resolveInstanceStance(
    snapshot,
    {
      sourceCapable: options.sourceCapable ?? false,
      // Default to an established pairing so the existing cases keep asserting
      // the linked behaviour; the unestablished case is covered explicitly.
      pairingIsEstablished: options.pairingIsEstablished ?? true,
      peerEnvironmentClass: options.peerEnvironmentClass,
    },
    { holdsIrreplaceableWork: options.holdsIrreplaceableWork ?? false },
  );
}

describe("resolveInstanceStance", () => {
  it("forbids teardown and agent credential handling on production", () => {
    const stance = stanceFor("production");
    expect(stance.teardown).toBe("forbidden");
    expect(stance.credentials).toBe("operator-only");
  });

  it("keeps production teardown forbidden even when no work is at risk", () => {
    // Production is never disposable, so an empty backlog must not unlock teardown.
    expect(stanceFor("production", { holdsIrreplaceableWork: false }).teardown).toBe("forbidden");
  });

  it("requires capture before teardown when a dev instance holds uncaptured work", () => {
    const stance = stanceFor("development", { holdsIrreplaceableWork: true });
    expect(stance.teardown).toBe("capture-required");
    expect(stance.rationale.teardown).toContain("exists nowhere else");
  });

  it("permits teardown once a dev instance has no uncaptured work", () => {
    expect(stanceFor("development", { holdsIrreplaceableWork: false }).teardown).toBe("permitted");
  });

  it("permits local credential handling outside production", () => {
    expect(stanceFor("development").credentials).toBe("local-permitted");
    expect(stanceFor("test").credentials).toBe("local-permitted");
  });

  it("denies source authority on a consumer runtime install", () => {
    const stance = stanceFor("development", { sourceCapable: false });
    expect(stance.sourceAuthority).toBe("none");
    expect(stance.rationale.sourceAuthority).toContain("separate checkout");
  });

  it("grants governed-worktree source authority when a checkout is present", () => {
    expect(stanceFor("development", { sourceCapable: true }).sourceAuthority).toBe(
      "governed-worktree",
    );
  });

  it("holds a paired production peer read-only from a development instance", () => {
    const stance = stanceFor("development", { pairedRef: "operator-production" });
    expect(stance.peerWrite).toBe("read-only");
    expect(stance.rationale.peerWrite).toContain("never mutate a record it owns");
  });

  it("allows governed peer writes only between production installations", () => {
    expect(stanceFor("production", { pairedRef: "operator-production", peerEnvironmentClass: "production" }).peerWrite).toBe(
      "governed-write",
    );
  });

  // BI-0716C8A8: the peer's class is read, not assumed from our own.
  it("holds an attested development peer read-only from production (AC-1)", () => {
    const stance = stanceFor("production", { pairedRef: "Windows DEV", peerEnvironmentClass: "development" });
    expect(stance.peerWrite).toBe("read-only");
    expect(stance.rationale.peerWrite).toContain("attested development installation");
    expect(stance.rationale.peerWrite).not.toContain("Both installations are production");
  });

  it("neither writes to nor tasks a peer whose class the CA never attested", () => {
    for (const peerEnvironmentClass of [null, undefined]) {
      const stance = stanceFor("production", { pairedRef: "Windows DEV", peerEnvironmentClass });
      expect(stance.peerWrite).toBe("none");
      expect(stance.rationale.peerWrite).toContain("not attested");
    }
  });

  it("reports no peer when none is paired", () => {
    expect(stanceFor("development").peerWrite).toBe("none");
  });

  it("treats an undeclared environment as production", () => {
    expect(UNDECLARED_ENVIRONMENT_CLASS).toBe("production");
    expect(stanceFor(UNDECLARED_ENVIRONMENT_CLASS).teardown).toBe("forbidden");
  });

  it("is pure — equal inputs produce an equal profile", () => {
    expect(stanceFor("development", { pairedRef: "peer" })).toEqual(
      stanceFor("development", { pairedRef: "peer" }),
    );
  });
});

describe("formatInstanceStanceBriefing", () => {
  it("states identity, paired peer, and every brake", () => {
    const briefing = formatInstanceStanceBriefing(
      stanceFor("development", {
        pairedRef: "operator-production",
        holdsIrreplaceableWork: true,
        primaryPurpose: "evolve-dpf",
      }),
    );
    expect(briefing).toContain("development installation, purpose evolve-dpf");
    expect(briefing).toContain("Paired installation: operator-production, class not attested.");
    expect(briefing).toContain("Teardown — capture-required");
    expect(briefing).toContain("Peer — read-only");
  });

  it("omits the paired line when nothing is paired", () => {
    expect(formatInstanceStanceBriefing(stanceFor("test"))).not.toContain("Paired installation:");
  });

  it("carries no secrets or tool catalogue", () => {
    const briefing = formatInstanceStanceBriefing(stanceFor("production"));
    expect(briefing).not.toMatch(/Bearer|token|password/i);
  });
});

describe("workSync — mirroring our own work is not a peer write", () => {
  it("mirrors work to a paired organization peer even from a development install", () => {
    const stance = stanceFor("development", { pairedRef: "operator-production" });
    expect(stance.workSync).toBe("same-organization");
    // The peer brake stays on for records the PEER owns.
    expect(stance.peerWrite).toBe("read-only");
  });

  it("explains that only this side may change the mirrored records", () => {
    const stance = stanceFor("development", { pairedRef: "operator-production" });
    expect(stance.rationale.workSync).toContain("only this side may change");
    expect(stance.rationale.peerWrite).toContain("never mutate a record it owns");
  });

  it("has nothing to mirror when no peer is paired", () => {
    expect(stanceFor("development").workSync).toBe("none");
  });

  it("mirrors from a production install too", () => {
    expect(stanceFor("production", { pairedRef: "operator-production" }).workSync).toBe(
      "same-organization",
    );
  });

  it("states work sync in the briefing", () => {
    const briefing = formatInstanceStanceBriefing(
      stanceFor("development", { pairedRef: "operator-production" }),
    );
    expect(briefing).toContain("Work sync — same-organization");
  });
});

describe("workSync requires an established link, not a typed name", () => {
  it("stays off when a peer is declared but no link confirms it", () => {
    const stance = stanceFor("development", {
      pairedRef: "operator-production",
      pairingIsEstablished: false,
    });
    expect(stance.workSync).toBe("none");
    expect(stance.rationale.workSync).toContain("no established federation link");
  });

  it("turns on once a link backs the declaration", () => {
    expect(
      stanceFor("development", { pairedRef: "operator-production", pairingIsEstablished: true })
        .workSync,
    ).toBe("same-organization");
  });

  it("states the live health sentence as the rationale when one is known (EP-ZERO-CONFIG-FEDERATION §5.7)", () => {
    const line = "In step with operator-production: 1,620 items mirrored here, last copy 3 minutes ago.";
    const snapshot = buildInstallationOperatingProfileSnapshot({
      intent: intent({ pairedProductionInstallationRef: "operator-production", primaryPurpose: "evolve-dpf" }),
      environmentClass: "development",
    });
    const profile = resolveInstanceStance(snapshot, { sourceCapable: false, pairingIsEstablished: true, workSyncHealthLine: line });
    expect(profile.workSync).toBe("same-organization");
    expect(profile.rationale.workSync).toBe(line);
    // Without a link the sentence is never shown: a declared peer is intent, not evidence.
    const unlinked = resolveInstanceStance(snapshot, { sourceCapable: false, pairingIsEstablished: false, workSyncHealthLine: line });
    expect(unlinked.rationale.workSync).not.toBe(line);
  });
});

describe("formatInstanceStanceBriefing — paired installation (BI-0716C8A8 AC-3)", () => {
  it("names the peer installation, not the organization, when the link knows it", () => {
    const snapshot = buildInstallationOperatingProfileSnapshot({
      intent: intent({ pairedProductionInstallationRef: "operator-organization" }),
      environmentClass: "production",
    });
    const stance = resolveInstanceStance(
      snapshot,
      { sourceCapable: false, pairingIsEstablished: true, peerEnvironmentClass: "development", peerInstallationLabel: "Windows DEV (did_ab12…9f0c)" },
      { holdsIrreplaceableWork: false },
    );
    const briefing = formatInstanceStanceBriefing(stance);
    expect(briefing).toContain("Paired installation: Windows DEV (did_ab12…9f0c), an attested development installation.");
    expect(briefing).not.toContain("Paired installation: operator-organization");
  });
});

describe("resolveInstanceStance — authority and companion (BI-B50BE189)", () => {
  function related(
    local: InstallationEnvironmentClass,
    host: { peerEnvironmentClass?: InstallationEnvironmentClass | null; pairingIsEstablished?: boolean; peerEstateMatches?: boolean },
  ) {
    const snapshot = buildInstallationOperatingProfileSnapshot({
      intent: intent({ pairedProductionInstallationRef: "operator-organization" }),
      environmentClass: local,
    });
    return resolveInstanceStance(
      snapshot,
      { sourceCapable: false, pairingIsEstablished: true, peerEstateMatches: true, peerInstallationLabel: "Windows DEV (did_ab12…9f0c)", ...host },
      { holdsIrreplaceableWork: false },
    );
  }

  it("makes production the authority for an attested development peer of the same estate (AC-1)", () => {
    const stance = related("production", { peerEnvironmentClass: "development" });
    expect(stance.relationship).toBe("authority");
    expect(stance.rationale.relationship).toContain("Windows DEV (did_ab12…9f0c)");
  });

  it("makes a development install the companion of an attested production peer (AC-1)", () => {
    expect(related("development", { peerEnvironmentClass: "production" }).relationship).toBe("companion");
    expect(related("test", { peerEnvironmentClass: "production" }).relationship).toBe("companion");
  });

  it("derives no relationship, and says why, on a mismatch (AC-2)", () => {
    const cases: Array<[InstallationEnvironmentClass, Parameters<typeof related>[1], string]> = [
      ["production", { peerEnvironmentClass: "development", peerEstateMatches: false }, "estate"],
      ["production", { peerEnvironmentClass: null }, "not attested"],
      ["production", { peerEnvironmentClass: "production" }, "both installations are production"],
      ["development", { peerEnvironmentClass: "test" }, "neither installation is production"],
      ["production", { peerEnvironmentClass: "development", pairingIsEstablished: false }, "no trusted"],
    ];
    for (const [local, host, why] of cases) {
      const stance = related(local, host);
      expect(stance.relationship).toBe("none");
      expect(stance.rationale.relationship.toLowerCase()).toContain(why);
    }
  });

  it("states the relationship and a stale paired reference in the briefing (AC-3)", () => {
    const snapshot = buildInstallationOperatingProfileSnapshot({
      intent: intent({ pairedProductionInstallationRef: "operator-organization" }),
      environmentClass: "production",
    });
    const stance = resolveInstanceStance(snapshot, {
      sourceCapable: false, pairingIsEstablished: true, peerEstateMatches: true, peerEnvironmentClass: "development",
      peerInstallationLabel: "Windows DEV (did_ab12…9f0c)",
      stalePairedRef: { ref: "link_old", reason: "revoked", repairRef: "did_" + "a".repeat(64) },
    }, { holdsIrreplaceableWork: false });
    const briefing = formatInstanceStanceBriefing(stance);
    expect(briefing).toContain("Relationship — authority:");
    expect(briefing).toContain("link_old");
    expect(briefing).toContain("revoked");
    expect(stance.stalePairedRef).toMatchObject({ ref: "link_old", repairRef: "did_" + "a".repeat(64) });
  });
});

describe("resolveInstanceStance — organization guidance on a companion (BI-1B165D02)", () => {
  function companion(organizationGuidance?: Parameters<typeof resolveInstanceStance>[1]["organizationGuidance"]) {
    const snapshot = buildInstallationOperatingProfileSnapshot({
      intent: intent({ pairedProductionInstallationRef: "operator-organization" }),
      environmentClass: "development",
    });
    return resolveInstanceStance(snapshot, {
      sourceCapable: false, pairingIsEstablished: true, peerEstateMatches: true, peerEnvironmentClass: "production",
      ...(organizationGuidance ? { organizationGuidance } : {}),
    }, { holdsIrreplaceableWork: false });
  }

  it("states current guidance with its version and expiry", () => {
    const stance = companion({ state: "current", version: 12, expiresAt: "2026-11-25T00:00:00.000Z" });
    expect(formatInstanceStanceBriefing(stance))
      .toContain("Organization guidance — current: organization-business decisions follow the production authority's snapshot version 12, valid until 2026-11-25T00:00:00.000Z");
  });

  it("AC-PAC-04 (guidance): reports guidance expired", () => {
    const stance = companion({ state: "expired", expiresAt: "2026-11-25T00:00:00.000Z" });
    expect(formatInstanceStanceBriefing(stance)).toContain("Organization guidance — expired:");
  });

  it("reports no guidance when none is held, rather than staying silent", () => {
    expect(companion().organizationGuidance).toEqual({ state: "none" });
    expect(formatInstanceStanceBriefing(companion())).toContain("Organization guidance — none:");
  });

  it("says nothing about organization guidance on an installation that is not a companion", () => {
    const snapshot = buildInstallationOperatingProfileSnapshot({
      intent: intent({ pairedProductionInstallationRef: "operator-organization" }),
      environmentClass: "production",
    });
    const stance = resolveInstanceStance(snapshot, {
      sourceCapable: false, pairingIsEstablished: true, peerEstateMatches: true, peerEnvironmentClass: "development",
      organizationGuidance: { state: "none" },
    }, { holdsIrreplaceableWork: false });
    expect(stance.organizationGuidance).toBeUndefined();
    expect(formatInstanceStanceBriefing(stance)).not.toContain("Organization guidance");
  });
});
