import { describe, expect, it } from "vitest";
import {
  COUNTRY_OPTIONS,
  US_STATES,
  formatOrgAddressLines,
  normalizeOrgAddress,
  orgAddressTimezoneSignal,
  parseOrgAddress,
  sanitizeOrgAddressInput,
  serializeOrgAddress,
  usStateCode,
  usStateName,
  applyCountrySelection,
  applyStateSelection,
} from "./org-address";
import { COUNTRY_TO_TIMEZONE, US_STATE_TO_TIMEZONE } from "@/lib/timezone-from-location";

describe("parseOrgAddress", () => {
  it("reads the canonical keys", () => {
    expect(
      parseOrgAddress({
        line1: "123 Main St",
        line2: "Suite 4",
        city: "Chicago",
        region: "Illinois",
        postalCode: "60601",
        country: "United States",
        stateCode: "IL",
        countryCode: "US",
      }),
    ).toEqual({
      line1: "123 Main St",
      line2: "Suite 4",
      city: "Chicago",
      region: "Illinois",
      postalCode: "60601",
      country: "United States",
      stateCode: "IL",
      countryCode: "US",
    });
  });

  it("tolerates historical key variants (street / postcode|zip / state) and uppercases codes", () => {
    expect(
      parseOrgAddress({ street: "1 High St", postcode: "EC1A 1BB", state: "Greater London", countryCode: "gb" }),
    ).toEqual({
      line1: "1 High St",
      postalCode: "EC1A 1BB",
      region: "Greater London",
      countryCode: "GB",
    });
    expect(parseOrgAddress({ zip: "94102" })).toEqual({ postalCode: "94102" });
  });

  it("ignores unknown/legacy keys and non-object input", () => {
    expect(parseOrgAddress({ location: "San Francisco, CA", timezone: "America/Los_Angeles" })).toEqual({});
    expect(parseOrgAddress(null)).toEqual({});
    expect(parseOrgAddress("nope")).toEqual({});
  });
});

describe("normalizeOrgAddress", () => {
  it("backfills the display region/country from codes and uppercases them", () => {
    expect(normalizeOrgAddress({ stateCode: "il", countryCode: "us", city: "Chicago" })).toEqual({
      city: "Chicago",
      region: "Illinois",
      country: "United States",
      stateCode: "IL",
      countryCode: "US",
    });
  });

  it("keeps an explicit display value over the code-derived one", () => {
    expect(normalizeOrgAddress({ stateCode: "TX", region: "West Texas" }).region).toBe("West Texas");
  });
});

describe("serializeOrgAddress", () => {
  it("writes canonical keys plus the street/postcode compat mirrors", () => {
    const json = serializeOrgAddress({
      line1: "123 Main St",
      city: "Chicago",
      postalCode: "60601",
      stateCode: "IL",
      countryCode: "US",
    });
    expect(json.line1).toBe("123 Main St");
    expect(json.street).toBe("123 Main St"); // mirror for StorefrontAddress reader
    expect(json.postalCode).toBe("60601");
    expect(json.postcode).toBe("60601"); // mirror
    expect(json.region).toBe("Illinois");
    expect(json.country).toBe("United States");
    expect(json.stateCode).toBe("IL");
    expect(json.countryCode).toBe("US");
  });

  it("merges non-destructively — preserves geocoding lat/lng and drops the legacy location blob", () => {
    const json = serializeOrgAddress(
      { line1: "5 Oak Ave", city: "Austin", stateCode: "TX", countryCode: "US" },
      { latitude: 30.27, longitude: -97.74, location: "Austin, TX", timezone: "America/Chicago" },
    );
    expect(json.latitude).toBe(30.27);
    expect(json.longitude).toBe(-97.74);
    expect(json.timezone).toBe("America/Chicago");
    expect(json.location).toBeUndefined(); // superseded by structured fields
    expect(json.region).toBe("Texas");
  });

  it("clears a field (and its mirror) the operator emptied", () => {
    const json = serializeOrgAddress({ city: "Denver", countryCode: "US" }, { line1: "old", street: "old", postalCode: "80202", postcode: "80202" });
    expect(json.line1).toBeUndefined();
    expect(json.street).toBeUndefined();
    expect(json.postalCode).toBeUndefined();
    expect(json.postcode).toBeUndefined();
    expect(json.city).toBe("Denver");
  });
});

describe("formatOrgAddressLines", () => {
  it("formats de-duplicated lines and matches org-identity's historical output", () => {
    expect(
      formatOrgAddressLines({ line1: "1 High St", city: "London", postalCode: "EC1A 1BB", country: "UK" }),
    ).toEqual(["1 High St", "London", "EC1A 1BB", "UK"]);
  });

  it("dedupes the street/line1 and postal mirrors so a serialized address renders cleanly", () => {
    const json = serializeOrgAddress({ line1: "1 High St", city: "London", postalCode: "EC1A 1BB", country: "United Kingdom", countryCode: "GB" });
    expect(formatOrgAddressLines(json)).toEqual(["1 High St", "London", "EC1A 1BB", "United Kingdom"]);
  });

  it("falls back to the legacy location blob and handles empties", () => {
    expect(formatOrgAddressLines({ location: "San Francisco, CA" })).toEqual(["San Francisco, CA"]);
    expect(formatOrgAddressLines(null)).toEqual([]);
    expect(formatOrgAddressLines({})).toEqual([]);
  });
});

describe("sanitizeOrgAddressInput", () => {
  it("accepts a valid US payload and backfills display names", () => {
    expect(
      sanitizeOrgAddressInput({
        line1: "123 Main St",
        city: "Chicago",
        postalCode: "60601",
        stateCode: "il",
        countryCode: "us",
      }),
    ).toEqual({
      line1: "123 Main St",
      city: "Chicago",
      region: "Illinois",
      postalCode: "60601",
      country: "United States",
      stateCode: "IL",
      countryCode: "US",
    });
  });

  it("drops an unknown state/country code but keeps the free-text display fields", () => {
    const out = sanitizeOrgAddressInput({ region: "Bavaria", country: "Germany", stateCode: "ZZ", countryCode: "DE" });
    expect(out.stateCode).toBeUndefined();
    expect(out.countryCode).toBe("DE");
    expect(out.region).toBe("Bavaria");
    expect(out.country).toBe("Germany");
  });

  it("ignores non-string fields and non-object payloads", () => {
    expect(sanitizeOrgAddressInput({ line1: 42, city: { nope: true } })).toEqual({});
    expect(sanitizeOrgAddressInput(null)).toEqual({});
  });

  it("caps absurdly long fields", () => {
    const out = sanitizeOrgAddressInput({ line1: "x".repeat(5000) });
    expect((out.line1 ?? "").length).toBe(200);
  });
});

describe("orgAddressTimezoneSignal", () => {
  it("extracts the normalized codes, nulls when absent", () => {
    expect(orgAddressTimezoneSignal({ stateCode: "IL", countryCode: "US" })).toEqual({ stateCode: "IL", countryCode: "US" });
    expect(orgAddressTimezoneSignal({ city: "Nowhere" })).toEqual({ stateCode: null, countryCode: null });
  });
});

describe("US_STATES <-> US_STATE_TO_TIMEZONE coverage guard", () => {
  it("every picker state code has a timezone mapping", () => {
    for (const { code } of US_STATES) {
      expect(US_STATE_TO_TIMEZONE[code], `missing timezone for ${code}`).toBeDefined();
    }
  });

  it("every timezone-mapped state code is offered in the picker", () => {
    const offered = new Set(US_STATES.map((s) => s.code));
    for (const code of Object.keys(US_STATE_TO_TIMEZONE)) {
      expect(offered.has(code), `state ${code} has a timezone but is not in US_STATES`).toBe(true);
    }
  });
});

describe("COUNTRY_OPTIONS resolve a timezone", () => {
  it("every offered country code is resolvable via COUNTRY_TO_TIMEZONE", () => {
    for (const { code } of COUNTRY_OPTIONS) {
      expect(COUNTRY_TO_TIMEZONE[code], `country ${code} is offered but has no timezone`).toBeDefined();
    }
  });
});

describe("usStateCode", () => {
  // IMP-066: the business form discarded a typed state when the operator picked a
  // country, because the field changes identity at that moment (free-text `region`
  // -> `stateCode` picker). Carrying the value across needs a reverse lookup that
  // accepts whatever a human actually types.
  it("accepts a code in any case", () => {
    expect(usStateCode("TX")).toBe("TX");
    expect(usStateCode("tx")).toBe("TX");
    expect(usStateCode("  Tx  ")).toBe("TX");
  });

  it("accepts a display name in any case", () => {
    expect(usStateCode("Texas")).toBe("TX");
    expect(usStateCode("texas")).toBe("TX");
    expect(usStateCode("NEW YORK")).toBe("NY");
  });

  it("returns null for a non-US region rather than inventing a code", () => {
    expect(usStateCode("Ontario")).toBeNull();
    expect(usStateCode("Bavaria")).toBeNull();
    expect(usStateCode("ZZ")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(usStateCode("")).toBeNull();
    expect(usStateCode("   ")).toBeNull();
    expect(usStateCode(null)).toBeNull();
    expect(usStateCode(undefined)).toBeNull();
  });

  it("round-trips every state in the picker list", () => {
    // Guards the pair: a state added to US_STATES must be resolvable from both its
    // code and its display name, or the carry-across silently drops it.
    for (const { code, name } of US_STATES) {
      expect(usStateCode(code)).toBe(code);
      expect(usStateCode(name)).toBe(code);
      expect(usStateName(code)).toBe(name);
    }
  });
});

describe("applyCountrySelection", () => {
  const OTHER = "__other__";

  // IMP-066: the state field changes identity when a country is picked — free-text
  // `region` before, `stateCode` picker after — and the old handler cleared both
  // unconditionally. A FIRST selection is not a switch.
  it("carries a typed state across the first country selection", () => {
    const out = applyCountrySelection({ city: "Fort Worth", region: "TX" }, "US", "", OTHER);
    expect(out.stateCode).toBe("TX");
    expect(out.region).toBe("Texas");
    expect(out.countryCode).toBe("US");
  });

  it("accepts a typed full state name too", () => {
    const out = applyCountrySelection({ region: "texas" }, "US", null, OTHER);
    expect(out.stateCode).toBe("TX");
    expect(out.region).toBe("Texas");
  });

  it("keeps an unrecognised region as free text rather than dropping it", () => {
    const out = applyCountrySelection({ region: "Bavaria" }, "DE", "", OTHER);
    expect(out.region).toBe("Bavaria");
    expect(out.stateCode).toBeUndefined();
  });

  it("still clears when switching BETWEEN countries", () => {
    // A Texas code is meaningless once the country is the UK.
    const out = applyCountrySelection(
      { region: "Texas", stateCode: "TX", countryCode: "US" },
      "GB",
      "US",
      OTHER,
    );
    expect(out.stateCode).toBeUndefined();
    expect(out.region).toBeUndefined();
    expect(out.countryCode).toBe("GB");
  });

  it("clears country fields when the selection is emptied", () => {
    const out = applyCountrySelection({ region: "Texas", stateCode: "TX", countryCode: "US" }, "", "US", OTHER);
    expect(out.countryCode).toBeUndefined();
    expect(out.country).toBeUndefined();
  });

  it("carries the region into the free-text country path", () => {
    const out = applyCountrySelection({ region: "Jalisco" }, OTHER, "", OTHER);
    expect(out.region).toBe("Jalisco");
    expect(out.countryCode).toBeUndefined();
  });
});

describe("applyStateSelection", () => {
  it("keeps code and display name in step", () => {
    const out = applyStateSelection({ city: "Austin" }, "TX");
    expect(out.stateCode).toBe("TX");
    expect(out.region).toBe("Texas");
  });

  it("clears both when the selection is emptied", () => {
    const out = applyStateSelection({ stateCode: "TX", region: "Texas" }, "");
    expect(out.stateCode).toBeUndefined();
    expect(out.region).toBeUndefined();
  });
});
