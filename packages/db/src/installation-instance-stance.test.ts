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
    expect(stanceFor("production", { pairedRef: "operator-production" }).peerWrite).toBe(
      "governed-write",
    );
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
    expect(briefing).toContain("Paired installation: operator-production.");
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
});
