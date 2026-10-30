import { describe, expect, it, vi } from "vitest";
import { loadCanonicalAnimalPopulation, countCanonicalAdoptions } from "./operating-facts";

describe("canonical custody facts", () => {
  it("shares the cockpit's organization-scoped population and legal-hold semantics", async () => {
    const animalProfile = { count: vi.fn(async (args: unknown) => (args as { where: { lifecycleStatus: unknown } }).where.lifecycleStatus === "placement_ready" ? 2 : 5) };
    const animalCustodyEpisode = { count: vi.fn(async (args: unknown) => (args as { where: { legalHoldActive?: boolean } }).where.legalHoldActive ? 1 : 3) };
    expect(await loadCanonicalAnimalPopulation({ animalProfile, animalCustodyEpisode }, "org-1")).toEqual({ inCare: 5, placementReady: 2, intakeReview: 3, legalHold: 1 });
    for (const call of [...animalProfile.count.mock.calls, ...animalCustodyEpisode.count.mock.calls]) expect(call[0]).toMatchObject({ where: { organizationId: "org-1" } });
    expect(animalCustodyEpisode.count).toHaveBeenCalledWith({ where: { organizationId: "org-1", closedAt: null, legalHoldActive: true } });
  });
  it("counts historical adoption episodes, including a returned animal's prior adoption", async () => {
    const count = vi.fn(async () => 2); const since = new Date("2026-07-01");
    expect(await countCanonicalAdoptions({ animalCustodyEpisode: { count } }, "org-1", since)).toBe(2);
    expect(count).toHaveBeenCalledWith({ where: { organizationId: "org-1", outcomeType: "adoption", closedAt: { gte: since } } });
  });
  it("preserves a verified zero and refuses unavailable scope or canonical sources", async () => {
    const count = vi.fn(async () => 0);
    expect(await loadCanonicalAnimalPopulation({ animalProfile: { count }, animalCustodyEpisode: { count } }, "org-1")).toEqual({ inCare: 0, placementReady: 0, intakeReview: 0, legalHold: 0 });
    await expect(loadCanonicalAnimalPopulation({}, "org-1")).rejects.toThrow("Canonical custody");
    count.mockClear(); await expect(loadCanonicalAnimalPopulation({ animalProfile: { count }, animalCustodyEpisode: { count } }, "")).rejects.toThrow(); expect(count).not.toHaveBeenCalled();
  });
});
