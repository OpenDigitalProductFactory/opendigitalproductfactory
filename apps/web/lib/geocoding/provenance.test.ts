import { describe, expect, it } from "vitest";
import {
  PERSON_CONFIRMED_SOURCES,
  locationProvenance,
  replaceableByDeviceWhere,
  replaceableByProviderWhere,
} from "./provenance";

describe("locationProvenance", () => {
  it.each(["manual-pin", "nominatim", "device-confirmed"])("treats %s as person-confirmed", (source) => {
    expect(locationProvenance(source)).toBe("person-confirmed");
  });

  it.each(["census", "opencage", "self-hosted"])("treats %s as provider-derived", (source) => {
    expect(locationProvenance(source)).toBe("provider-derived");
  });

  it("treats a missing source as none and an unknown source as person-confirmed", () => {
    expect(locationProvenance(null)).toBe("none");
    expect(locationProvenance("")).toBe("none");
    // An unrecognized source is protected rather than overwritten: failing safe
    // keeps a person's correction from being erased by a future provider.
    expect(locationProvenance("some-future-source")).toBe("person-confirmed");
  });
});

describe("write guards", () => {
  it("lets a provider fill only empty coordinates", () => {
    expect(replaceableByProviderWhere()).toEqual({ latitude: null });
  });

  it("lets a device confirmation replace empty or provider-derived coordinates only", () => {
    expect(replaceableByDeviceWhere()).toEqual({
      OR: [
        { latitude: null },
        { validationSource: { in: ["census", "opencage", "self-hosted"] } },
      ],
    });
    expect(PERSON_CONFIRMED_SOURCES).toContain("device-confirmed");
  });
});
