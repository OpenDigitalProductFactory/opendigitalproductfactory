import { describe, it, expect } from "vitest";
import { generatePromotionId } from "./version-tracking";

describe("generatePromotionId", () => {
  it("returns CP- prefixed ID", () => {
    const id = generatePromotionId();
    expect(id).toMatch(/^CP-[A-Z0-9]{8}$/);
  });
  it("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generatePromotionId()));
    expect(ids.size).toBe(100);
  });
});
