import { describe, expect, it } from "vitest";

import { decideSiteLocationConfirmation, roundSitePoint } from "./site-location-confirmation";

const FIX = { latitude: 30.267153, longitude: -97.743061, accuracyMeters: 12 };
const BASE = {
  job: { assignedToCaller: true, status: "in-progress" },
  siteOnJob: true,
  address: { exists: true, latitude: null, longitude: null, validationSource: null },
  fix: FIX,
  confirmFar: false,
};

describe("decideSiteLocationConfirmation (AC-ALC-VISIT-2, AC-ALC-VISIT-3)", () => {
  it("accepts an accurate fix from the assigned, checked-in staff member for a site with no location", () => {
    expect(decideSiteLocationConfirmation(BASE)).toEqual({ status: "confirmed", latitude: 30.26715, longitude: -97.74306 });
  });

  it("replaces a provider-derived point near the fix", () => {
    const address = { exists: true, latitude: 30.2675, longitude: -97.7428, validationSource: "census" };
    expect(decideSiteLocationConfirmation({ ...BASE, address }).status).toBe("confirmed");
  });

  it.each([
    ["not-assigned", { job: { assignedToCaller: false, status: "in-progress" } }],
    ["not-checked-in", { job: { assignedToCaller: true, status: "claimed" } }],
    ["site-not-on-job", { siteOnJob: false }],
    ["no-address", { address: { exists: false, latitude: null, longitude: null, validationSource: null } }],
    ["inaccurate", { fix: { ...FIX, accuracyMeters: 65 } }],
    ["invalid-position", { fix: { ...FIX, latitude: 91 } }],
    ["invalid-position", { fix: { ...FIX, accuracyMeters: Number.NaN } }],
  ] as const)("refuses %s", (reason, override) => {
    expect(decideSiteLocationConfirmation({ ...BASE, ...override })).toEqual({ status: "refused", reason });
  });

  it.each(["manual-pin", "nominatim", "device-confirmed"])("never replaces a %s point", (validationSource) => {
    const address = { exists: true, latitude: 30.2, longitude: -97.7, validationSource };
    expect(decideSiteLocationConfirmation({ ...BASE, address })).toEqual({ status: "refused", reason: "already-confirmed" });
  });

  it("asks before accepting a fix more than 1,000 m from the provider point, then accepts with confirmFar", () => {
    const address = { exists: true, latitude: 30.3, longitude: -97.7431, validationSource: "census" };
    const refused = decideSiteLocationConfirmation({ ...BASE, address });
    expect(refused.status).toBe("refused");
    expect(refused).toMatchObject({ reason: "far-from-address" });
    expect((refused as { distanceMeters: number }).distanceMeters).toBeGreaterThan(3_500);
    expect(decideSiteLocationConfirmation({ ...BASE, address, confirmFar: true }).status).toBe("confirmed");
  });
});

describe("roundSitePoint", () => {
  it("rounds to 5 decimal places (about 1 m)", () => {
    expect(roundSitePoint({ latitude: 30.1234567, longitude: -97.9876543 })).toEqual({ latitude: 30.12346, longitude: -97.98765 });
  });
});
