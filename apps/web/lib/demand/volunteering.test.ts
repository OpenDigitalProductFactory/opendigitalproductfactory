import { describe, expect, it } from "vitest";

import { decideVolunteering, shouldOfferToCoworker } from "./volunteering";

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
