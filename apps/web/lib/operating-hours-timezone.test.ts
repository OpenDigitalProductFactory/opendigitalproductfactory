import { describe, it, expect } from "vitest";
import { resolveOperatingHoursTimezone } from "./operating-hours-types";

describe("resolveOperatingHoursTimezone", () => {
  it("returns a confirmed profile timezone verbatim", () => {
    expect(resolveOperatingHoursTimezone("America/New_York")).toBe("America/New_York");
  });

  it("falls back to UTC when no profile timezone is set", () => {
    // Mirrors what the Operating Hours settings page shows on a fresh install —
    // the booking calendar must agree, never the stale Europe/London default.
    expect(resolveOperatingHoursTimezone(null)).toBe("UTC");
    expect(resolveOperatingHoursTimezone(undefined)).toBe("UTC");
    expect(resolveOperatingHoursTimezone("   ")).toBe("UTC");
  });

  it("keeps the UTC placeholder when no suggestion is offered", () => {
    expect(resolveOperatingHoursTimezone("UTC")).toBe("UTC");
  });

  it("prefers an import-suggested timezone only while the profile is the UTC placeholder", () => {
    expect(resolveOperatingHoursTimezone("UTC", "Europe/Paris")).toBe("Europe/Paris");
    // A real confirmed timezone always wins over the suggestion.
    expect(resolveOperatingHoursTimezone("Asia/Tokyo", "Europe/Paris")).toBe("Asia/Tokyo");
  });

  it("trims surrounding whitespace on a real timezone", () => {
    expect(resolveOperatingHoursTimezone("  America/Chicago  ")).toBe("America/Chicago");
  });
});
