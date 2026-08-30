// BI-C35F1FED — waiting on the owner is not the platform going quiet.

import { describe, expect, it } from "vitest";

import { isAwaitingOwnerDecision } from "./owner-decision-pending";

describe("isAwaitingOwnerDecision", () => {
  it("recognises a build waiting for the owner to approve the start", () => {
    expect(isAwaitingOwnerDecision("approve-start")).toBe(true);
  });

  it("leaves genuine platform stalls to the quiet detector", () => {
    for (const kind of ["advance-phase", "retry-build", "resume-implementation", "decompose-now"]) {
      expect(isAwaitingOwnerDecision(kind)).toBe(false);
    }
  });
});
