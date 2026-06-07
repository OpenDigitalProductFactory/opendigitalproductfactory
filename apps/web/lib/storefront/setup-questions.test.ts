import { describe, expect, it } from "vitest";
import { ALL_ARCHETYPES } from "@dpf/storefront-templates";
import { setupQuestionsFor } from "./setup-questions";

function profileFor(archetypeId: string): unknown {
  return ALL_ARCHETYPES.find((a) => a.archetypeId === archetypeId)?.activationProfile;
}

describe("setupQuestionsFor", () => {
  it("asks the partner question for an archetype that recommends a partner program", () => {
    const questions = setupQuestionsFor(profileFor("wholesale-distribution"));
    const partner = questions.find((q) => q.capabilityKey === "partner-program");
    expect(partner).toBeDefined();
    expect(partner?.question).toBe("Do you sell through partners or resellers?");
  });

  it("asks no capability questions for a direct-to-consumer archetype", () => {
    expect(setupQuestionsFor(profileFor("hair-salon"))).toEqual([]);
  });

  it("returns nothing when there is no activation profile", () => {
    expect(setupQuestionsFor(undefined)).toEqual([]);
    expect(setupQuestionsFor(null)).toEqual([]);
  });
});
