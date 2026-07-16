import { describe, it, expect } from "vitest";
import {
  toNumber,
  formatCurrency,
  formatPercent,
  formatDuration,
  clampRating,
  ratingStars,
  clampProgress,
} from "./grid-field-format";

describe("toNumber", () => {
  it("coerces numerics and rejects the rest", () => {
    expect(toNumber(5)).toBe(5);
    expect(toNumber("12.5")).toBe(12.5);
    expect(toNumber("")).toBeNull();
    expect(toNumber(null)).toBeNull();
    expect(toNumber(true)).toBeNull();
    expect(toNumber("abc")).toBeNull();
  });
});

describe("formatCurrency", () => {
  it("prefixes the symbol and groups thousands", () => {
    expect(formatCurrency(1234.5)).toBe("$1,234.50");
    expect(formatCurrency(1000000, "€")).toBe("€1,000,000.00");
    expect(formatCurrency(-42, "$", 0)).toBe("$-42");
    expect(formatCurrency(null)).toBe("");
  });
});

describe("formatPercent", () => {
  it("appends % with the given precision", () => {
    expect(formatPercent(50)).toBe("50%");
    expect(formatPercent(33.333, 1)).toBe("33.3%");
    expect(formatPercent("")).toBe("");
  });
});

describe("formatDuration", () => {
  it("formats minutes into h/m", () => {
    expect(formatDuration(150)).toBe("2h 30m");
    expect(formatDuration(45)).toBe("45m");
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(60)).toBe("1h");
  });

  it("formats seconds when the unit is seconds", () => {
    expect(formatDuration(90, "seconds")).toBe("1m 30s");
    expect(formatDuration(45, "seconds")).toBe("45s");
    expect(formatDuration(60, "seconds")).toBe("1m");
    expect(formatDuration(3661, "seconds")).toBe("1h 1m");
  });

  it("clamps negatives to zero and rejects non-numbers", () => {
    expect(formatDuration(-30)).toBe("0m");
    expect(formatDuration(null)).toBe("");
  });
});

describe("clampRating / ratingStars", () => {
  it("clamps to an integer within [0, max]", () => {
    expect(clampRating(3)).toBe(3);
    expect(clampRating(9, 5)).toBe(5);
    expect(clampRating(-2)).toBe(0);
    expect(clampRating(2.6)).toBe(3);
    expect(clampRating(null)).toBe(0);
  });

  it("splits filled/total for stars", () => {
    expect(ratingStars(3, 5)).toEqual({ filled: 3, total: 5 });
    expect(ratingStars(10, 5)).toEqual({ filled: 5, total: 5 });
  });
});

describe("clampProgress", () => {
  it("clamps to [0,100]", () => {
    expect(clampProgress(50)).toBe(50);
    expect(clampProgress(150)).toBe(100);
    expect(clampProgress(-5)).toBe(0);
    expect(clampProgress(null)).toBe(0);
  });
});
