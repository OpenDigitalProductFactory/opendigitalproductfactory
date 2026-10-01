import { describe, expect, it } from "vitest";

import { WORLD_COUNTRY_PATHS } from "./world-country-paths";

describe("WORLD_COUNTRY_PATHS", () => {
  it("covers the world's countries with drawable paths", () => {
    expect(WORLD_COUNTRY_PATHS.countries.length).toBeGreaterThanOrEqual(170);
    for (const country of WORLD_COUNTRY_PATHS.countries) {
      expect(country.d).toMatch(/^M/);
      expect(country.name.length).toBeGreaterThan(0);
    }
  });

  it("keys countries uniquely by ISO alpha-2 where one exists", () => {
    const codes = WORLD_COUNTRY_PATHS.countries
      .map((country) => country.isoA2)
      .filter((code): code is string => code !== null);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^[A-Z]{2}$/);
    expect(codes).toEqual(expect.arrayContaining(["US", "GB", "DE", "JP", "BR", "AU", "IN", "ZA"]));
  });

  it("declares its source and a sphere outline", () => {
    expect(WORLD_COUNTRY_PATHS.source).toContain("Natural Earth");
    expect(WORLD_COUNTRY_PATHS.sphere).toMatch(/^M/);
    expect(WORLD_COUNTRY_PATHS.viewBox).toBe("0 0 1000 487");
  });
});
