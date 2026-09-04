import { describe, expect, it } from "vitest";

import { placeAnimal, returnAnimal, transitionAdoptionApplication } from "./adoption";

describe("adoption and return continuity", () => {
  it("requires an approved application and no active legal hold", () => {
    expect(() => placeAnimal({
      animalProfileId: "animal-1",
      applicationId: "application-1",
      applicationStatus: "screening",
      legalHoldActive: false,
      placedAt: new Date("2026-09-04T12:00:00Z"),
    })).toThrow("approved application");
    expect(() => placeAnimal({
      animalProfileId: "animal-1",
      applicationId: "application-1",
      applicationStatus: "approved",
      legalHoldActive: true,
      placedAt: new Date("2026-09-04T12:00:00Z"),
    })).toThrow("legal hold");
  });

  it("closes placement and opens a new return custody episode", () => {
    const approved = transitionAdoptionApplication("home-check", "approved");
    const placement = placeAnimal({
      animalProfileId: "animal-1",
      applicationId: "application-1",
      applicationStatus: approved,
      legalHoldActive: false,
      placedAt: new Date("2026-09-04T12:00:00Z"),
    });
    const result = returnAnimal(placement, {
      returnedAt: new Date("2026-09-10T12:00:00Z"),
      reason: "Adopter could no longer provide care",
      organizationId: "org-rescue",
      actorPrincipalId: "principal-1",
    });

    expect(result.placement.status).toBe("returned");
    expect(result.custodyEpisode.intakeType).toBe("return");
    expect(result.custodyEpisode.events).toHaveLength(1);
  });
});
