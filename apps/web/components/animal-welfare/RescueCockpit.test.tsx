import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { sourceAvailable, sourceEmpty, sourceUnavailable } from "@/lib/animal-welfare/cockpit";
import { RescueCockpit } from "./RescueCockpit";

describe("RescueCockpit", () => {
  it("names the three rescue value streams and never hides unavailable sources as zero", () => {
    const html = renderToStaticMarkup(<RescueCockpit data={{
      attention: [],
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
  });
});
