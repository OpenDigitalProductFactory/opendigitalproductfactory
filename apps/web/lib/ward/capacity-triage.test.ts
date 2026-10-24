import { describe, expect, it } from "vitest";

import type { AdoptionInterest } from "./adoption-interest";
import { reviewCapacity, type TriageAnimal } from "./capacity-triage";

function animal(over: Partial<TriageAnimal> & { animalRef: string; name: string }): TriageAnimal {
  return {
    daysInCare: 10,
    legalHold: false,
    outcomeRecorded: false,
    underAssessment: false,
    interest: undefined,
    ...over,
  };
}

const scheduled: AdoptionInterest = {
  level: "scheduled",
  applicantName: "Dana Whitlock",
  since: new Date("2026-08-01T00:00:00Z"),
};
const interested: AdoptionInterest = {
  level: "interested",
  applicantName: null,
  since: new Date("2026-08-20T00:00:00Z"),
};

describe("reviewCapacity", () => {
  it("produces no list at all while the shelter still has room", () => {
    const review = reviewCapacity({
      animals: [animal({ animalRef: "a1", name: "Ranger", daysInCare: 400 })],
      freeUnits: 1,
    });

    expect(review.underPressure).toBe(false);
    expect(review.candidates).toEqual([]);
    expect(review.ask).toContain("still room");
  });

  it("ranks the longest-waiting first and says why, in words a person can repeat", () => {
    const review = reviewCapacity({
      animals: [
        animal({ animalRef: "a1", name: "Ranger", daysInCare: 12 }),
        animal({ animalRef: "a2", name: "Saffron", daysInCare: 200 }),
      ],
      freeUnits: 0,
    });

    expect(review.candidates.map((c) => c.name)).toEqual(["Saffron", "Ranger"]);
    expect(review.candidates[0]?.reasons).toContain("In care 200 days.");
    expect(review.candidates[0]?.reasons).toContain("Longer than three months without a placement.");
    expect(review.ask).toContain("A person decides.");
  });

  // Each of these is a hard exclusion. A protected animal must not be reachable
  // by any combination of factors — so each is tested with the worst possible
  // ranking profile (waited longest of anyone).
  it.each([
    ["a legal hold", { legalHold: true }, "legal-hold"],
    ["an approved adopter", { interest: scheduled }, "adopter-coming"],
    ["an unanswered applicant", { interest: interested }, "applicant-waiting"],
    ["an open assessment", { underAssessment: true }, "under-assessment"],
    ["an outcome already recorded", { outcomeRecorded: true }, "already-left-care"],
  ])("never lists an animal with %s, however long it has waited", (_label, over, reason) => {
    const review = reviewCapacity({
      animals: [
        animal({ animalRef: "protected", name: "Willow", daysInCare: 9999, ...over }),
        animal({ animalRef: "a2", name: "Ranger", daysInCare: 5 }),
      ],
      freeUnits: 0,
    });

    expect(review.candidates.map((c) => c.animalRef)).not.toContain("protected");
    expect(review.excluded.find((e) => e.animalRef === "protected")?.reason).toBe(reason);
  });

  it("names the person who is coming, so the exclusion can be checked", () => {
    const review = reviewCapacity({
      animals: [animal({ animalRef: "a1", name: "Willow", interest: scheduled })],
      freeUnits: 0,
    });

    expect(review.excluded[0]?.explanation).toBe("Dana Whitlock is coming for Willow.");
  });

  it("says so plainly when everyone is protected rather than offering nobody", () => {
    const review = reviewCapacity({
      animals: [animal({ animalRef: "a1", name: "Willow", legalHold: true })],
      freeUnits: 0,
    });

    expect(review.candidates).toEqual([]);
    expect(review.ask).toContain("Find room another way.");
  });

  it("keeps the shortlist small, and settles ties by name rather than by chance", () => {
    const review = reviewCapacity({
      animals: [
        animal({ animalRef: "a1", name: "Ranger", daysInCare: 50 }),
        animal({ animalRef: "a2", name: "Bramble", daysInCare: 50 }),
        animal({ animalRef: "a3", name: "Saffron", daysInCare: 50 }),
        animal({ animalRef: "a4", name: "Pepper", daysInCare: 50 }),
      ],
      freeUnits: 0,
    });

    expect(review.candidates).toHaveLength(3);
    expect(review.candidates.map((c) => c.name)).toEqual(["Bramble", "Pepper", "Ranger"]);
  });
});
