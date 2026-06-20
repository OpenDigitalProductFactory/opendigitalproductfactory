import { describe, expect, it } from "vitest";
import { resolveTimezoneFromAddress, resolveTimezoneFromLocation } from "./timezone-from-location";

describe("resolveTimezoneFromLocation", () => {
  it("resolves US states to their predominant zone (state-accurate, six US zones)", () => {
    expect(resolveTimezoneFromLocation({ stateCode: "IL" })).toBe("America/Chicago");
    expect(resolveTimezoneFromLocation({ stateCode: "TX" })).toBe("America/Chicago");
    expect(resolveTimezoneFromLocation({ stateCode: "CA" })).toBe("America/Los_Angeles");
    expect(resolveTimezoneFromLocation({ stateCode: "NY" })).toBe("America/New_York");
    expect(resolveTimezoneFromLocation({ stateCode: "CO" })).toBe("America/Denver");
    expect(resolveTimezoneFromLocation({ stateCode: "AZ" })).toBe("America/Phoenix");
  });

  it("normalizes case and accepts ISO 'US-IL' subdivision form", () => {
    expect(resolveTimezoneFromLocation({ stateCode: "il" })).toBe("America/Chicago");
    expect(resolveTimezoneFromLocation({ stateCode: "US-IL" })).toBe("America/Chicago");
  });

  it("prefers the state code over the country code (state is more precise)", () => {
    // A US store with country=US would resolve to Eastern via country alone; the
    // Illinois state code must win and yield Central — the exact operator case.
    expect(resolveTimezoneFromLocation({ stateCode: "IL", countryCode: "US" })).toBe(
      "America/Chicago",
    );
  });

  it("falls back to the country zone when there is no usable state", () => {
    expect(resolveTimezoneFromLocation({ countryCode: "GB" })).toBe("Europe/London");
    expect(resolveTimezoneFromLocation({ countryCode: "US" })).toBe("America/New_York");
    expect(resolveTimezoneFromLocation({ stateCode: "ZZ", countryCode: "DE" })).toBe(
      "Europe/Berlin",
    );
  });

  it("returns null when nothing resolves, so callers can fall back safely", () => {
    expect(resolveTimezoneFromLocation({})).toBeNull();
    expect(resolveTimezoneFromLocation({ stateCode: "ZZ" })).toBeNull();
    expect(resolveTimezoneFromLocation({ stateCode: "", countryCode: "" })).toBeNull();
    expect(resolveTimezoneFromLocation({ countryCode: "ZZ" })).toBeNull();
  });
});

describe("resolveTimezoneFromAddress", () => {
  it("resolves a US address to its state-accurate zone (the precise source)", () => {
    expect(
      resolveTimezoneFromAddress({ city: "Chicago", region: "Illinois", stateCode: "IL", countryCode: "US" }),
    ).toBe("America/Chicago");
  });

  it("falls back to the country zone for a non-US address with no usable state", () => {
    expect(resolveTimezoneFromAddress({ city: "London", countryCode: "GB" })).toBe("Europe/London");
  });

  it("returns null for an address carrying no location codes", () => {
    expect(resolveTimezoneFromAddress({ line1: "1 Main St", city: "Anytown" })).toBeNull();
    expect(resolveTimezoneFromAddress({})).toBeNull();
  });
});
