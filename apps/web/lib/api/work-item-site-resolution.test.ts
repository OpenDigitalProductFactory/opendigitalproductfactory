import { describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {} }));

import { toWorkItemSite } from "./work-item-site-resolution";

describe("toWorkItemSite", () => {
  it("marks a site with no address", () => {
    expect(toWorkItemSite({ id: "s1", name: "Yard", primaryAddress: null })).toEqual({
      id: "s1", name: "Yard", addressLine: null, hasAddress: false, hasLocation: false, locationConfirmed: false,
    });
  });

  it("treats a provider point as a location that is not yet confirmed", () => {
    expect(toWorkItemSite({ id: "s1", name: "HQ", primaryAddress: { addressLine1: "1 Main", latitude: "30.1", validationSource: "census" } }))
      .toMatchObject({ hasLocation: true, locationConfirmed: false });
  });

  it("treats a pinned, picked or phone-confirmed point as confirmed", () => {
    for (const validationSource of ["manual-pin", "nominatim", "device-confirmed"]) {
      expect(toWorkItemSite({ id: "s1", name: "HQ", primaryAddress: { addressLine1: "1 Main", latitude: "30.1", validationSource } }))
        .toMatchObject({ locationConfirmed: true });
    }
  });

  it("has no location when the address has no point", () => {
    expect(toWorkItemSite({ id: "s1", name: "HQ", primaryAddress: { addressLine1: "1 Main", latitude: null, validationSource: null } }))
      .toMatchObject({ hasAddress: true, hasLocation: false, locationConfirmed: false });
  });
});
