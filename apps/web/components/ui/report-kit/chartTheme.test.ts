import { describe, expect, it } from "vitest";

import {
  DEFAULT_SERIES_PALETTE,
  resolveSeriesColor,
  axisTick,
  gridStroke,
  tooltipStyle,
} from "./chartTheme";

describe("chartTheme", () => {
  it("palette + shared styles are token-backed (no raw hex)", () => {
    for (const c of DEFAULT_SERIES_PALETTE) expect(c).toMatch(/var\(--dpf-/);
    expect(axisTick.fill).toMatch(/var\(--dpf-/);
    expect(gridStroke).toMatch(/var\(--dpf-/);
    expect(tooltipStyle.background).toMatch(/var\(--dpf-/);
    expect(JSON.stringify({ DEFAULT_SERIES_PALETTE, axisTick, gridStroke, tooltipStyle }))
      .not.toMatch(/#[0-9a-f]{3,6}/i);
  });

  it("resolves an explicit color first", () => {
    expect(resolveSeriesColor({ key: "a", color: "var(--dpf-success)" }, 3)).toBe(
      "var(--dpf-success)",
    );
  });

  it("resolves an intent to its token color", () => {
    expect(resolveSeriesColor({ key: "a", intent: "danger" }, 0)).toBe("var(--dpf-error)");
  });

  it("falls back to the palette by index (wrapping)", () => {
    expect(resolveSeriesColor({ key: "a" }, 0)).toBe(DEFAULT_SERIES_PALETTE[0]);
    expect(resolveSeriesColor({ key: "a" }, 1)).toBe(DEFAULT_SERIES_PALETTE[1]);
    // wraps past the end
    const n = DEFAULT_SERIES_PALETTE.length;
    expect(resolveSeriesColor({ key: "a" }, n)).toBe(DEFAULT_SERIES_PALETTE[0]);
  });
});
