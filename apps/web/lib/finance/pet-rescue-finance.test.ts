import { describe, expect, it } from "vitest";
import { projectRescueFinance } from "./pet-rescue-finance";

describe("Pet Rescue finance projection", () => {
  it("derives animal cost from posted line dimensions without inventing fund allocation", () => {
    const result = projectRescueFinance([
      { fundId: "medical", subjectKindSlug: "animal-profile", debit: 120, credit: 0 },
      { fundId: null, subjectKindSlug: "animal-profile", debit: 30, credit: 0 },
      { fundId: "medical", subjectKindSlug: "customer-account", debit: 500, credit: 0 },
      { fundId: "medical", subjectKindSlug: "animal-profile", debit: 0, credit: 20 },
    ]);
    expect(result.postedAnimalCost).toBe(130);
    expect(result.unassignedAnimalCost).toBe(30);
    expect(result.byFund).toEqual([{ fundId: "medical", amount: 100 }]);
  });
});
