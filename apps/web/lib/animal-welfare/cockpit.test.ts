import { describe, expect, it } from "vitest";

import { buildRescueCockpit, sourceAvailable, sourceUnavailable } from "./cockpit";

describe("Pet Rescue cockpit projection", () => {
  it("keeps unavailable source state distinct from an honest zero", () => {
    const cockpit = buildRescueCockpit({
      animals: sourceAvailable({ inCare: 12, intakeReview: 2, legalHold: 1, placementReady: 4 }),
      capacity: sourceUnavailable("capacity service unavailable"),
      care: sourceAvailable({ dueToday: 8, missed: 1, exceptions: 2 }),
      adoptions: sourceAvailable({ activeApplications: 5, readyWithoutInterest: 1 }),
      stewardship: sourceUnavailable("finance permission required"),
    });

    expect(cockpit.sources.capacity.state).toBe("unavailable");
    expect(cockpit.sources.capacity.data).toBeNull();
    expect(cockpit.attention[0]?.href).toBe("/workspace/rescue/care?filter=missed");
    expect(cockpit.attention.every((item) => item.href.startsWith("/workspace/rescue/"))).toBe(true);
  });
});
