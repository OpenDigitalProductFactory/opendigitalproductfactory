import { describe, expect, it, vi } from "vitest";
import { journeyHealthHeadline, loadJourneyHealth } from "./journey-health";
import { applicableJourneys, BUSINESS_JOURNEYS } from "./registry";
import type { InstallJourneyContext } from "./types";

function dbWith(summary: unknown, startedAt = new Date("2026-07-28T06:00:00.000Z")) {
  return {
    assuranceRun: {
      findFirst: vi.fn(async () => ({
        runId: "run_1",
        startedAt,
        completedAt: startedAt,
        summary,
      })),
    },
  } as never;
}

const BARE_INSTALL: InstallJourneyContext = {
  organizationId: null,
  organizationSlug: null,
  baseUrl: "",
  storefrontId: null,
  storefrontPublished: false,
  archetypeIds: [],
  bookableItemId: null,
  hasInquirySurface: false,
  hasPaymentConfiguration: false,
};

describe("registry applicability", () => {
  it("applies no storefront journey to an install with no published storefront", () => {
    expect(applicableJourneys(BARE_INSTALL)).toEqual([]);
  });

  it("applies only the journeys an install actually has switched on", () => {
    const ids = applicableJourneys({
      ...BARE_INSTALL,
      organizationSlug: "acme",
      storefrontId: "sf_1",
      storefrontPublished: true,
      archetypeIds: ["field-service"],
    }).map((j) => j.journeyId);

    expect(ids).toContain("storefront-front-door");
    expect(ids).toContain("customer-sign-in");
    // Nothing bookable, nothing to enquire about, nothing priced.
    expect(ids).not.toContain("storefront-booking");
    expect(ids).not.toContain("storefront-enquiry");
    expect(ids).not.toContain("storefront-checkout");
  });

  it("writes every outcome in owner language, never as a mechanism", () => {
    for (const journey of BUSINESS_JOURNEYS) {
      expect(journey.outcome).not.toMatch(/probe|step|endpoint|adapter|http/i);
      expect(journey.businessImpact.length).toBeGreaterThan(20);
    }
  });
});

describe("loadJourneyHealth", () => {
  it("shows a journey the last sweep never reached rather than silently omitting it", async () => {
    const health = await loadJourneyHealth(dbWith({ journeys: [] }));

    expect(health.rows).toHaveLength(BUSINESS_JOURNEYS.length);
    expect(health.neverRun).toBe(BUSINESS_JOURNEYS.length);
    for (const row of health.rows) {
      expect(row.status).toBe("never-run");
      // A run that never happened says so plainly. Enumerating all four depths
      // here would be technically true and useless — the short form is the
      // honest one, and it keeps five repeated cards off the word budget.
      expect(row.notCheckedSentence).toBe("Not checked yet.");
      expect(row.checkedSentence).toBeNull();
    }
  });

  it("never presents a reachability-only pass as functionally verified", async () => {
    const health = await loadJourneyHealth(
      dbWith({
        journeys: [
          {
            journeyId: "storefront-front-door",
            status: "passed",
            achievedDepth: "reachability",
            steps: [],
            durationMs: 5,
          },
        ],
      }),
    );

    const row = health.rows.find((r) => r.journeyId === "storefront-front-door");
    expect(row?.checkedSentence).toBe("Checked: the page opens.");
    expect(row?.notCheckedSentence).toContain("a real record can be saved");
    expect(row?.notCheckedSentence).toContain("a customer doing this in a browser");
  });

  it("leaves nothing unchecked for a journey that does not apply", async () => {
    const health = await loadJourneyHealth(
      dbWith({
        journeys: [
          {
            journeyId: "storefront-booking",
            status: "not-applicable",
            achievedDepth: null,
            notApplicableReason: "No bookable service.",
            steps: [],
          },
        ],
      }),
    );

    const row = health.rows.find((r) => r.journeyId === "storefront-booking");
    expect(row?.status).toBe("not-applicable");
    expect(row?.notCheckedSentence).toBeNull();
    expect(row?.notApplicableReason).toBe("No bookable service.");
  });

  it("survives a malformed summary payload", async () => {
    const health = await loadJourneyHealth(dbWith("garbage"));
    expect(health.rows).toHaveLength(BUSINESS_JOURNEYS.length);
  });
});

describe("journeyHealthHeadline", () => {
  const base = { lastRunAt: new Date(), runId: "r", rows: [], notApplicable: 0, neverRun: 0 };

  it("counts failures in plain language", () => {
    expect(journeyHealthHeadline({ ...base, failing: 1, passing: 3 })).toBe(
      "1 critical business journey is not working.",
    );
    expect(journeyHealthHeadline({ ...base, failing: 2, passing: 3 })).toBe(
      "2 critical business journeys are not working.",
    );
  });

  it("says so honestly when nothing has been checked yet", () => {
    expect(journeyHealthHeadline({ ...base, lastRunAt: null, failing: 0, passing: 0 })).toContain(
      "have not been checked yet",
    );
  });

  it("qualifies an all-green headline with 'checked', never 'all healthy'", () => {
    const headline = journeyHealthHeadline({ ...base, failing: 0, passing: 4 });
    expect(headline).toBe("All 4 checked journeys were working at the last check.");
  });
});
