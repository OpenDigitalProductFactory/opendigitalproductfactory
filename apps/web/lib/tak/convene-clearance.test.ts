import { describe, it, expect } from "vitest";
import {
  decideConveneClearance,
  clearanceForPrincipal,
  conveneDenialAuditReason,
  CONVENE_DENIED_MESSAGE,
} from "./convene-clearance";

const ALL = ["public", "internal", "confidential", "restricted"];

describe("decideConveneClearance", () => {
  it("permits an ordinary specialist for an ordinary employee", () => {
    expect(
      decideConveneClearance({
        askingHumanClearance: ["public", "internal"],
        targetAgentSensitivity: "internal",
      }),
    ).toEqual({ permitted: true });
  });

  it("refuses a confidential peer to an internal-only human — the layoff case", () => {
    expect(
      decideConveneClearance({
        askingHumanClearance: ["public", "internal"],
        targetAgentSensitivity: "confidential",
      }),
    ).toEqual({ permitted: false, reason: "insufficient-clearance" });
  });

  it("refuses a restricted peer — the M&A case", () => {
    expect(
      decideConveneClearance({
        askingHumanClearance: ["public", "internal", "confidential"],
        targetAgentSensitivity: "restricted",
      }),
    ).toEqual({ permitted: false, reason: "insufficient-clearance" });
  });

  it("permits when the human holds every level", () => {
    for (const level of ALL) {
      expect(
        decideConveneClearance({ askingHumanClearance: ALL, targetAgentSensitivity: level }),
      ).toEqual({ permitted: true });
    }
  });

  it("is SET MEMBERSHIP, not rank — a gap in the middle still denies", () => {
    // Mirrors the tool gate's `.includes()` exactly. A rank comparison would
    // wrongly permit this and let a convene succeed where every subsequent tool
    // call is denied.
    expect(
      decideConveneClearance({
        askingHumanClearance: ["public", "internal", "restricted"],
        targetAgentSensitivity: "confidential",
      }),
    ).toEqual({ permitted: false, reason: "insufficient-clearance" });
  });

  it("FAILS CLOSED on an unlabelled coworker", () => {
    for (const value of [null, undefined, "", "not-a-level"]) {
      expect(
        decideConveneClearance({ askingHumanClearance: ALL.slice(0, 3), targetAgentSensitivity: value }),
      ).toEqual({ permitted: false, reason: "insufficient-clearance" });
    }
  });

  it("fails closed on an empty clearance list", () => {
    expect(
      decideConveneClearance({ askingHumanClearance: [], targetAgentSensitivity: "public" }),
    ).toEqual({ permitted: false, reason: "insufficient-clearance" });
  });
});

describe("clearanceForPrincipal", () => {
  it("matches the principal path for an employee with nothing explicit", () => {
    // normalizePrincipalSensitivities returns ["public"] for empty/absent. The
    // first version of this clamp hardcoded ["public","internal"], which made an
    // UNLINKED user more cleared than a LINKED one — an inversion on every
    // fresh install, in the wrong direction for a disclosure clamp.
    expect(clearanceForPrincipal(undefined)).toEqual(["public"]);
    expect(clearanceForPrincipal(null)).toEqual(["public"]);
    expect(clearanceForPrincipal([])).toEqual(["public"]);
  });

  it("an unlinked user is never MORE cleared than a linked one — the inversion regression", () => {
    const linkedWithNothingExplicit = clearanceForPrincipal([]);
    const unlinked = clearanceForPrincipal(undefined);
    expect(unlinked).toEqual(linkedWithNothingExplicit);
    // and neither can convene a merely-internal coworker
    expect(
      decideConveneClearance({ askingHumanClearance: unlinked, targetAgentSensitivity: "internal" }),
    ).toEqual({ permitted: false, reason: "insufficient-clearance" });
  });

  it("passes through a granted clearance in canonical order", () => {
    expect(clearanceForPrincipal(["confidential", "public", "internal"])).toEqual([
      "public",
      "internal",
      "confidential",
    ]);
  });

  it("FAILS CLOSED on corrupt stored clearance — empty, denying even public", () => {
    // normalizePrincipalSensitivities throws on an unknown member. On the
    // convene path that must not become a 500 and must not widen access.
    expect(clearanceForPrincipal(["public", "not-a-level"])).toEqual([]);
    expect(
      decideConveneClearance({
        askingHumanClearance: clearanceForPrincipal(["public", "not-a-level"]),
        targetAgentSensitivity: "public",
      }),
    ).toEqual({ permitted: false, reason: "insufficient-clearance" });
  });

  it("the installation-owner floor still convenes a confidential coworker", () => {
    // Fresh-install path: superusers receive INSTALLATION_OWNER_SENSITIVITY_FLOOR,
    // and workforce-seed creates tier-2 coworkers at "confidential". If this
    // fails, every seeded confidential coworker is unconvenable on a new box.
    const owner = clearanceForPrincipal(["public", "internal", "confidential"]);
    expect(
      decideConveneClearance({ askingHumanClearance: owner, targetAgentSensitivity: "confidential" }),
    ).toEqual({ permitted: true });
    expect(
      decideConveneClearance({ askingHumanClearance: owner, targetAgentSensitivity: "restricted" }),
    ).toEqual({ permitted: false, reason: "insufficient-clearance" });
  });
});

describe("CONVENE_DENIED_MESSAGE", () => {
  // The refusal is load-bearing for disclosure. A refusal that names the peer,
  // the level, or the subject — or that proposes "ask an admin for confidential
  // clearance" per the limitation-response contract — discloses the very thing
  // the clamp exists to protect.
  it("names no sensitivity level", () => {
    for (const level of ALL) {
      expect(CONVENE_DENIED_MESSAGE.toLowerCase()).not.toContain(level);
    }
  });

  it("names no peer, role, or subject and proposes no clearance enabler", () => {
    for (const leak of ["hr", "layoff", "merger", "acquisition", "clearance", "permission", "authority", "admin"]) {
      expect(CONVENE_DENIED_MESSAGE.toLowerCase()).not.toContain(leak);
    }
  });

  it("does not reveal that a restricted matter exists", () => {
    for (const leak of ["confidential", "restricted", "not allowed", "denied", "cleared"]) {
      expect(CONVENE_DENIED_MESSAGE.toLowerCase()).not.toContain(leak);
    }
  });

  it("still offers a way forward, so it is a refusal and not a dead end", () => {
    expect(CONVENE_DENIED_MESSAGE).toMatch(/help with what I can see myself/);
  });
});

describe("conveneDenialAuditReason", () => {
  it("keeps the specifics for the audit row, which the user never sees", () => {
    const reason = conveneDenialAuditReason({
      targetAgentId: "AGT-HR-001",
      requiredSensitivity: "confidential",
    });
    expect(reason).toContain("AGT-HR-001");
    expect(reason).toContain("confidential");
  });

  it("is not the string shown to the user", () => {
    expect(
      conveneDenialAuditReason({ targetAgentId: "AGT-HR-001", requiredSensitivity: "confidential" }),
    ).not.toEqual(CONVENE_DENIED_MESSAGE);
  });
});
