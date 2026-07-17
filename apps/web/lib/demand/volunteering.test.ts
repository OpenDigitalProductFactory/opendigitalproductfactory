import { describe, expect, it } from "vitest";

import { decideVolunteering, resolveVolunteeringAutonomy, shouldOfferToCoworker } from "./volunteering";

describe("decideVolunteering", () => {
  it("auto-claims only when the autonomy envelope grants autonomous-action", () => {
    expect(decideVolunteering("autonomous-action")).toBe("auto_claim");
  });

  it("asks first for supervised modes (human stays at the lead)", () => {
    expect(decideVolunteering("propose-for-approval")).toBe("ask_first");
    expect(decideVolunteering("supervised-action")).toBe("ask_first");
  });

  it("observes (no claim, no ask) when shadow-only", () => {
    expect(decideVolunteering("shadow-only")).toBe("observe");
  });
});

describe("resolveVolunteeringAutonomy", () => {
  it("auto-claims when a fully-trusted coworker takes a low-risk (reversible) bet", () => {
    const r = resolveVolunteeringAutonomy({ trustLevel: "autopilot", risk: "internal-reversible" });
    expect(r.effectiveTrustLevel).toBe("autopilot");
    expect(r.decisionMode).toBe("autonomous-action");
    expect(r.decision).toBe("auto_claim");
  });

  it("caps even a fully-trusted coworker to ask-first on a high-risk (floor) bet", () => {
    // outbound-or-floor ceiling is `propose` — autopilot is capped down to it.
    const r = resolveVolunteeringAutonomy({ trustLevel: "autopilot", risk: "outbound-or-floor" });
    expect(r.effectiveTrustLevel).toBe("propose");
    expect(r.decision).toBe("ask_first");
  });

  it("observes when no trust is established (shadow), regardless of risk", () => {
    expect(resolveVolunteeringAutonomy({ trustLevel: "shadow", risk: "internal-reversible" }).decision).toBe(
      "observe",
    );
  });

  it("asks first for a supervised coworker on a reversible bet", () => {
    expect(resolveVolunteeringAutonomy({ trustLevel: "supervised", risk: "internal-reversible" }).decision).toBe(
      "ask_first",
    );
  });

  it("lets a regulatory ceiling cap autonomy below the risk ceiling", () => {
    const r = resolveVolunteeringAutonomy({
      trustLevel: "autopilot",
      risk: "internal-reversible", // risk ceiling autopilot…
      regulatoryCeiling: "propose", // …but regulation caps to propose.
    });
    expect(r.effectiveTrustLevel).toBe("propose");
    expect(r.decision).toBe("ask_first");
  });
});

describe("shouldOfferToCoworker", () => {
  it("offers a funded item that has an associated coworker and no prior claim", () => {
    expect(shouldOfferToCoworker({ agentId: "build-specialist", claimStatus: null })).toBe(true);
  });

  it("does not offer when no coworker is associated", () => {
    expect(shouldOfferToCoworker({ agentId: null, claimStatus: null })).toBe(false);
  });

  it("is idempotent — never re-offers an already offered or claimed item", () => {
    expect(shouldOfferToCoworker({ agentId: "build-specialist", claimStatus: "offered" })).toBe(false);
    expect(shouldOfferToCoworker({ agentId: "build-specialist", claimStatus: "claimed" })).toBe(false);
  });
});
