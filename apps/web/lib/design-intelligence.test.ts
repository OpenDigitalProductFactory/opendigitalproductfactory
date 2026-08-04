// BI-018AE129 — the design-intelligence data plane must load, and must fail
// LOUD when it cannot. Every prod build ran with silently-empty design
// guidance because nothing asserted these domains load >0 rows; this test is
// the repo-side capability probe (the boot-side probe reads
// designIntelligenceHealth()).
import { describe, expect, it } from "vitest";
import {
  designIntelligenceHealth,
  generateDesignSystem,
  getOperationalPrecedents,
  searchDesignDomain,
} from "./design-intelligence";

describe("design-intelligence data plane (BI-018AE129)", () => {
  it("loads every domain with at least one row", () => {
    const health = designIntelligenceHealth();
    for (const [domain, rows] of Object.entries(health)) {
      expect(rows, `domain "${domain}" loaded 0 rows — data dir unresolvable or file missing`).toBeGreaterThan(0);
    }
  });

  it("answers plain corpus-word queries (the live-repro case)", () => {
    // "hierarchy" (7 rows in ui-reasoning.csv) returned nothing on the live
    // install — the data-plane repro. NOTE: pick words that exist in the
    // corpus; e.g. "dashboard" has zero ux-guidelines rows, so an empty
    // result for it is corpus shape, not a loading failure.
    expect(searchDesignDomain("hierarchy", "reasoning", 5).length).toBeGreaterThan(0);
    expect(searchDesignDomain("navigation", "ux", 5).length).toBeGreaterThan(0);
  });

  it("assembles a data-backed design system recommendation", () => {
    const system = generateDesignSystem("SaaS analytics dashboard");
    // With empty domains the generator still emits the title + static
    // checklist — the data-dependent sections are the discriminator.
    expect(system, "recommendation carries no data-backed style section").toContain("## Recommended Style");
  });

  it("loads source-cited operational precedents for every priority physical-space pack", () => {
    const precedents = getOperationalPrecedents();
    const packIds = new Set(precedents.map((precedent) => precedent.packId));

    expect(packIds).toEqual(new Set([
      "restaurant-floor",
      "salon-chair-book",
      "hotel-room-occupancy",
      "equipment-rental-yard",
      "hoa-property-priorities",
      "hvac-dispatch-territory",
    ]));

    for (const precedent of precedents) {
      expect(precedent.officialSourceUrl).toMatch(/^https:\/\//);
      expect(precedent.accessedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(precedent.recheckOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(["adopt", "adapt", "reject"]).toContain(precedent.dpfDecision);
      expect(precedent.accessibilityAlternative).toBeTruthy();
    }
    expect(
      precedents
        .filter((precedent) => precedent.incumbentProviderName)
        .map((precedent) => precedent.incumbentProviderName)
        .sort(),
    ).toEqual(["AppFolio", "OpenTable", "Toast"]);
  });

  it("queries precedents by archetype, space kind, and operator job", () => {
    expect(getOperationalPrecedents({
      archetypeId: "restaurant",
      spaceKind: "floor",
      operatorJob: "seat-party",
    }).length).toBeGreaterThanOrEqual(2);

    const search = searchDesignDomain("restaurant floor seat party waitlist", "precedent", 5);
    expect(search.length).toBeGreaterThanOrEqual(2);
    expect(search[0]?.data["Official Source URL"]).toMatch(/^https:\/\//);
  });

  it("retrieves current room-assignment and drive-time routing precedents", () => {
    const hotel = searchDesignDomain(
      "room assignment housekeeping attendant inspection",
      "precedent",
      5,
    );
    expect(hotel.some((result) => result.data["Provider Name"] === "Oracle OPERA Cloud")).toBe(true);

    const hvac = searchDesignDomain(
      "drive time route optimization technician schedule conflict",
      "precedent",
      5,
    );
    expect(hvac.some((result) => result.data["Provider Name"] === "Housecall Pro")).toBe(true);

    const hotelRack = searchDesignDomain(
      "room condition housekeeper maintenance unassigned accommodation",
      "precedent",
      5,
    );
    expect(hotelRack.some((result) => result.data["Provider Name"] === "Cloudbeds")).toBe(true);

    const dispatchBoard = searchDesignDomain(
      "job tray teams skills zones priority route technician",
      "precedent",
      5,
    );
    expect(dispatchBoard.some((result) => result.data["Provider Name"] === "ServiceTitan")).toBe(true);
  });

  it("retrieves current provider-resource, room-timeline, and serialized-inventory precedents", () => {
    const salonResources = searchDesignDomain(
      "staff resource chair machine availability assignment double booking",
      "precedent",
      5,
    );
    expect(salonResources.some((result) => result.data["Provider Name"] === "Mangomint")).toBe(true);

    const hotelTimeline = searchDesignDomain(
      "room timeline locked reservation housekeeping out of service",
      "precedent",
      5,
    );
    expect(hotelTimeline.some((result) => result.data["Provider Name"] === "Mews")).toBe(true);

    const rentalInventory = searchDesignDomain(
      "serialized equipment location movement repair shortage subrental",
      "precedent",
      5,
    );
    expect(rentalInventory.some((result) => result.data["Provider Name"] === "Rentman")).toBe(true);

    const hoaMap = searchDesignDomain(
      "association property map violation work order architectural request past cure",
      "precedent",
      5,
    );
    expect(hoaMap.some((result) => result.data["Provider Name"] === "Vantaca")).toBe(true);
  });
});
