import { describe, expect, it, vi } from "vitest";

import { daysBetween, loadWardCareContext, photoUrl } from "./care-context";

const NOW = new Date("2026-09-03T12:00:00Z");

function client(over: Record<string, unknown> = {}) {
  return {
    adoptableAnimal: {
      findMany: vi.fn(async () => [
        { animalRef: "a1", name: "Ranger", status: "available", primaryPhotoAssetId: "asset-1", animalProfileId: "p1" },
        { animalRef: "a2", name: "Saffron", status: "hold", primaryPhotoAssetId: null, animalProfileId: "p2" },
        { animalRef: "a3", name: "Marbles", status: "adopted", primaryPhotoAssetId: "asset-3", animalProfileId: "p3" },
      ]),
    },
    animalCustodyEpisode: {
      findMany: vi.fn(async () => [
        { animalProfileId: "p1", openedAt: new Date("2026-01-03T12:00:00Z"), closedAt: null, legalHoldActive: false, currentStage: "care" },
        { animalProfileId: "p2", openedAt: new Date("2026-08-30T12:00:00Z"), closedAt: null, legalHoldActive: false, currentStage: "care" },
      ]),
    },
    animalAdoptionApplication: {
      findMany: vi.fn(async () => [
        { animalProfileId: "p2", applicantName: "Dana Whitlock", status: "approved", submittedAt: new Date("2026-09-01T00:00:00Z") },
      ]),
    },
    ...over,
  };
}

describe("loadWardCareContext", () => {
  it("gives a photo URL only for animals that actually have one", async () => {
    const context = await loadWardCareContext({ organizationId: "org-1", db: client(), freeUnits: 1, now: NOW });

    expect(context.photos.get("a1")).toBe("/api/media/asset-1");
    expect(context.photos.has("a2")).toBe(false);
    // Adopted animals are not in care, so they are not on the board at all.
    expect(context.photos.has("a3")).toBe(false);
  });

  it("names the person coming, so the board can show a happy ending", async () => {
    const context = await loadWardCareContext({ organizationId: "org-1", db: client(), freeUnits: 1, now: NOW });

    expect(context.interest.get("a2")?.level).toBe("scheduled");
    expect(context.interest.get("a2")?.applicantName).toBe("Dana Whitlock");
    expect(context.interest.has("a1")).toBe(false);
  });

  it("offers no review while the shelter still has room", async () => {
    const context = await loadWardCareContext({ organizationId: "org-1", db: client(), freeUnits: 2, now: NOW });
    expect(context.review.underPressure).toBe(false);
    expect(context.review.candidates).toEqual([]);
  });

  it("reviews only the animal nobody is waiting for once the building is full", async () => {
    const context = await loadWardCareContext({ organizationId: "org-1", db: client(), freeUnits: 0, now: NOW });

    expect(context.review.underPressure).toBe(true);
    expect(context.review.candidates.map((c) => c.name)).toEqual(["Ranger"]);
    expect(context.review.candidates[0]?.daysInCare).toBe(243);
    expect(context.review.excluded.map((e) => e.reason)).toContain("adopter-coming");
  });

  it("treats a stay it never recorded as unassessed rather than as a candidate", async () => {
    const context = await loadWardCareContext({
      organizationId: "org-1",
      db: client({ animalCustodyEpisode: { findMany: vi.fn(async () => []) } }),
      freeUnits: 0,
      now: NOW,
    });

    expect(context.review.candidates).toEqual([]);
    expect(context.review.excluded.map((e) => e.reason)).toContain("under-assessment");
  });

  it("counts time in the current stay, not a closed earlier one", async () => {
    const context = await loadWardCareContext({
      organizationId: "org-1",
      db: client({
        animalCustodyEpisode: {
          findMany: vi.fn(async () => [
            { animalProfileId: "p1", openedAt: new Date("2020-01-01T12:00:00Z"), closedAt: new Date("2020-06-01T12:00:00Z"), legalHoldActive: false, currentStage: "care" },
            { animalProfileId: "p1", openedAt: new Date("2026-09-01T12:00:00Z"), closedAt: null, legalHoldActive: false, currentStage: "care" },
          ]),
        },
      }),
      freeUnits: 0,
      now: NOW,
    });

    expect(context.review.candidates[0]?.daysInCare).toBe(2);
  });

  it("returns an honest empty context when nothing can be read", async () => {
    const context = await loadWardCareContext({ organizationId: "org-1", db: {}, freeUnits: 0, now: NOW });
    expect(context.photos.size).toBe(0);
    expect(context.review.candidates).toEqual([]);
  });
});

describe("photoUrl / daysBetween", () => {
  it("builds the media route and never returns negative days", () => {
    expect(photoUrl("asset-9")).toBe("/api/media/asset-9");
    expect(daysBetween(new Date("2026-09-05T00:00:00Z"), NOW)).toBe(0);
  });
});
