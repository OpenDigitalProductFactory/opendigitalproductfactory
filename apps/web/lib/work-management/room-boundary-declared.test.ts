import { describe, expect, it } from "vitest";

import { buildWorkroomBoundary, projectDeclaredBoundary } from "./room-boundary";
import {
  readWorkroomBoundaryClaim,
  withWorkroomBoundaryClaim,
} from "./workroom-boundary-claim";
import type { WorkCaseDetail } from "./case-types";

// The regression this whole slice exists to prevent: the room's gap list was
// UNSATISFIABLE. Every boundary field was hardcoded null in the loader, so
// "Outcome not defined" and "Accountable owner not assigned" stood forever on
// every room on every install and the header asked for a next action nothing
// could perform. These assert the loop actually closes — declare it, and the
// gap goes away.

const detail = {
  summary: { dueAt: null, sourceRefs: [] },
} as unknown as WorkCaseDetail;

function boundaryFor(claimSource: unknown) {
  return buildWorkroomBoundary({
    detail,
    boundary: projectDeclaredBoundary({
      claim: readWorkroomBoundaryClaim(claimSource),
      fallbackPurpose: null,
      dueAt: null,
      sourceRefs: [],
    }),
    participants: [],
    context: { refs: [], digest: null, sensitivityCeiling: null },
    contextProvided: false,
  });
}

describe("a declared boundary reaches the room's gap list", () => {
  it("an unbounded room still reports every gap — nothing is inferred", () => {
    const view = boundaryFor(null);
    expect(view.gaps).toContain("outcome");
    expect(view.gaps).toContain("accountable");
    expect(view.outcome).toBeNull();
  });

  it("declaring the two fields the repair sentence names clears exactly those two gaps", () => {
    const claims = withWorkroomBoundaryClaim([], {
      outcome: "The licence register is current for every location",
      accountablePrincipalRef: "role:compliance-owner",
    });
    const view = boundaryFor(claims);

    expect(view.gaps).not.toContain("outcome");
    expect(view.gaps).not.toContain("accountable");
    // Still honest about the rest — clearing one gap must not clear the others.
    expect(view.gaps).toContain("scope");
    expect(view.gaps).toContain("measures");
    expect(view.outcome).toBe("The licence register is current for every location");
    expect(view.accountablePrincipalRef).toBe("role:compliance-owner");
  });

  it("a fully declared boundary leaves only the gaps this claim cannot speak to", () => {
    const claims = withWorkroomBoundaryClaim([], {
      purpose: "Keep operating licences current",
      outcome: "Every location holds a valid licence",
      accountablePrincipalRef: "role:compliance-owner",
      scopeIncluded: ["renewals"],
      scopeExcluded: ["new-site applications"],
      authoritySummary: ["file a renewal under GBP 500"],
      sensitivityCeiling: "internal",
      measures: ["zero expired licences at month end"],
      closureRuleSummary: "Reviewed quarterly; stops if the estate is sold",
    });
    const view = boundaryFor(claims);

    // participants and context come from the room's own substrate, not the
    // claim — they must remain gaps rather than be falsely satisfied.
    expect(view.gaps).toEqual(["participants", "context"]);
  });

  it("clearing the claim puts the gaps back", () => {
    const declared = withWorkroomBoundaryClaim([], { outcome: "Shipped" });
    const cleared = withWorkroomBoundaryClaim(declared, { outcome: "" });
    expect(boundaryFor(cleared).gaps).toContain("outcome");
  });
});

describe("the room's own objective answers the outcome gap", () => {
  function withObjective(claimSource: unknown, objective: string | null) {
    return buildWorkroomBoundary({
      detail,
      boundary: projectDeclaredBoundary({
        claim: readWorkroomBoundaryClaim(claimSource),
        fallbackPurpose: null,
        fallbackOutcome: objective,
        sourceRefs: [],
      }),
      participants: [],
      context: { refs: [], digest: null, sensitivityCeiling: null },
      contextProvided: false,
    });
  }

  it("stops asking a question the room's creator already answered", () => {
    // Workroom.objective is a required column whose creation prompt is
    // "Outcome this workroom coordinates". Reporting "Outcome not defined"
    // against a room that has one was the gap list asking twice.
    const view = withObjective(null, "Every supplier invoice is approved within five days");
    expect(view.gaps).not.toContain("outcome");
    expect(view.outcome).toBe("Every supplier invoice is approved within five days");
  });

  it("an explicit claim still wins over the objective", () => {
    const claims = withWorkroomBoundaryClaim([], { outcome: "The corrected outcome" });
    expect(withObjective(claims, "The original objective").outcome).toBe("The corrected outcome");
  });

  it("a room with no objective still reports the gap honestly", () => {
    expect(withObjective(null, null).gaps).toContain("outcome");
  });
});
