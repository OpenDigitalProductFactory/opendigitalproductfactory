import { describe, expect, it } from "vitest";
import { isSimpleNavMode, resolveNavModeFromCookie } from "./nav-mode";

describe("resolveNavModeFromCookie", () => {
  it("defaults missing/unknown values to operator (full rail)", () => {
    expect(resolveNavModeFromCookie(undefined)).toBe("operator");
    expect(resolveNavModeFromCookie(null)).toBe("operator");
    expect(resolveNavModeFromCookie("")).toBe("operator");
    expect(resolveNavModeFromCookie("full")).toBe("operator");
    expect(resolveNavModeFromCookie("operator")).toBe("operator");
  });

  it("accepts worker and the Simple UI alias", () => {
    expect(resolveNavModeFromCookie("worker")).toBe("worker");
    expect(resolveNavModeFromCookie(" worker ")).toBe("worker");
    expect(resolveNavModeFromCookie("Simple")).toBe("worker");
    expect(resolveNavModeFromCookie("SIMPLE")).toBe("worker");
  });
});

describe("isSimpleNavMode", () => {
  it("is true only for worker", () => {
    expect(isSimpleNavMode("worker")).toBe(true);
    expect(isSimpleNavMode("operator")).toBe(false);
    expect(isSimpleNavMode("customer")).toBe(false);
  });
});
