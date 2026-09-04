import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { sourceAvailable, sourceEmpty, sourceUnavailable } from "@/lib/animal-welfare/cockpit";
import { RescueCockpit } from "./RescueCockpit";

describe("RescueCockpit", () => {
  it("names the three rescue value streams and never hides unavailable sources as zero", () => {
    const html = renderToStaticMarkup(<RescueCockpit data={{
      attention: [],
      queue: null,
      presentation: {
        asOf: "2026-09-04T12:00:00.000Z",
        currency: "GBP",
        locale: "en-GB",
        timeZone: "Europe/London",
      },
      sources: {
        animals: sourceAvailable({ inCare: 4, intakeReview: 1, legalHold: 0, placementReady: 2 }),
        capacity: sourceEmpty({ free: 0, blocked: 0 }),
        care: sourceUnavailable("care source offline"),
        adoptions: sourceAvailable({ activeApplications: 3, readyWithoutInterest: 1 }),
        stewardship: sourceAvailable({ restrictedFunds: 1, postedAnimalCost: 220 }),
      },
    }} />);
    expect(html).toContain("Intake and protect");
    expect(html).toContain("Maintain health and welfare");
    expect(html).toContain("Place and support");
    expect(html).toContain("Unavailable");
    expect(html).toContain("No records yet");
    expect(html).toContain("£220");
    expect(html).toContain("As of");
  });

  it("shows a validated drill-in filter and bounded factual rows without pretending they have detail routes", () => {
    const asOf = "2026-09-04T12:00:00.000Z";
    const html = renderToStaticMarkup(<RescueCockpit
      area="care"
      filter="missed"
      data={{
        attention: [],
        presentation: { asOf, currency: "USD", locale: "en-US", timeZone: "America/Chicago" },
        queue: sourceAvailable({
          title: "Missed care work",
          description: "Showing up to 25 dated animal work items.",
          limit: 25,
          action: null,
          rows: [{
            id: "work-1",
            reference: "ANIMAL-001",
            primary: "Give morning medication",
            detail: "ANIMAL-001",
            status: "in-progress",
            occurredAt: "2026-09-04T11:00:00.000Z",
          }],
        }, asOf),
        sources: {
          animals: sourceAvailable({ inCare: 1, intakeReview: 0, legalHold: 0, placementReady: 0 }, asOf),
          capacity: sourceAvailable({ free: 1, blocked: 0 }, asOf),
          care: sourceAvailable({ dueToday: 0, missed: 1, exceptions: 0 }, asOf),
          adoptions: sourceEmpty({ activeApplications: 0, readyWithoutInterest: 0 }, asOf),
          stewardship: sourceUnavailable("Finance access is required.", asOf),
        },
      }}
    />);

    expect(html).toContain("Missed care work");
    expect(html).toContain("Give morning medication");
    expect(html).toContain("Showing up to 25");
    expect(html).toContain('href="/workspace/rescue/care?filter=missed"');
    expect(html).not.toContain('href="/workspace/rescue/care/work-1"');
  });
});
