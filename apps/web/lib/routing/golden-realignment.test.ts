/**
 * EP-INF-006: Golden test realignment policy tests (TDD).
 */

import { describe, expect, it } from "vitest";
import { shouldRunGoldenTests } from "./golden-realignment";

describe("shouldRunGoldenTests", () => {
  it("returns false for 'high' confidence", () => {
    expect(shouldRunGoldenTests("high")).toBe(false);
  });

  it("returns false for 'medium' confidence", () => {
    expect(shouldRunGoldenTests("medium")).toBe(false);
  });

  it("returns true for 'low' confidence", () => {
    expect(shouldRunGoldenTests("low")).toBe(true);
  });

  it("returns false for empty string (safety)", () => {
    expect(shouldRunGoldenTests("")).toBe(false);
  });
});
