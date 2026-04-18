import { describe, expect, it } from "vitest";
import {
  DEFAULT_PANEL_HEIGHT,
  DEFAULT_PANEL_WIDTH,
  DESKTOP_PANEL_RESERVE_BREAKPOINT,
  EDGE_GAP,
  MIN_PANEL_HEIGHT,
  MIN_PANEL_WIDTH,
  clampPanelPosition,
  clampPanelSize,
  getDockedPanelFrame,
  getDefaultPanelPosition,
  isDockedPanelViewport,
  getReservedPanelWidth,
} from "./agent-panel-layout";

describe("agent panel layout helpers", () => {
  it("clamps panel size to configured minimums", () => {
    expect(clampPanelSize({ width: 100, height: 120 }, { width: 1440, height: 900 })).toEqual({
      width: MIN_PANEL_WIDTH,
      height: MIN_PANEL_HEIGHT,
    });
  });

  it("clamps panel size to the viewport minus edge gap", () => {
    expect(clampPanelSize({ width: 2000, height: 2000 }, { width: 900, height: 700 })).toEqual({
      width: 900 - 32,
      height: 700 - 32,
    });
  });

  it("clamps panel position using the active panel size", () => {
    expect(
      clampPanelPosition(
        { x: 2000, y: 2000 },
        { width: DEFAULT_PANEL_WIDTH, height: DEFAULT_PANEL_HEIGHT },
        { width: 1200, height: 900 },
      ),
    ).toEqual({
      x: 1200 - DEFAULT_PANEL_WIDTH,
      y: 900 - DEFAULT_PANEL_HEIGHT,
    });
  });

  it("returns a bottom-right default position that respects the current size", () => {
    expect(
      getDefaultPanelPosition(
        { width: DEFAULT_PANEL_WIDTH, height: DEFAULT_PANEL_HEIGHT },
        { width: 1600, height: 1000 },
      ),
    ).toEqual({
      x: 1600 - DEFAULT_PANEL_WIDTH - 16,
      y: 1000 - DEFAULT_PANEL_HEIGHT - 16,
    });
  });

  it("reserves space for an open panel on desktop viewports", () => {
    expect(
      getReservedPanelWidth({
        isOpen: true,
        size: { width: DEFAULT_PANEL_WIDTH, height: DEFAULT_PANEL_HEIGHT },
        viewport: { width: 1365, height: 900 },
      }),
    ).toBe(DEFAULT_PANEL_WIDTH + (EDGE_GAP * 2));
  });

  it("does not reserve space when the panel is closed or the viewport is narrow", () => {
    expect(
      getReservedPanelWidth({
        isOpen: false,
        size: { width: DEFAULT_PANEL_WIDTH, height: DEFAULT_PANEL_HEIGHT },
        viewport: { width: 1440, height: 900 },
      }),
    ).toBe(0);

    expect(
      getReservedPanelWidth({
        isOpen: true,
        size: { width: DEFAULT_PANEL_WIDTH, height: DEFAULT_PANEL_HEIGHT },
        viewport: { width: 1024, height: 900 },
      }),
    ).toBe(0);
  });

  it("detects desktop viewports for docked panel mode", () => {
    expect(isDockedPanelViewport({ width: DESKTOP_PANEL_RESERVE_BREAKPOINT, height: 900 })).toBe(true);
    expect(isDockedPanelViewport({ width: DESKTOP_PANEL_RESERVE_BREAKPOINT - 1, height: 900 })).toBe(false);
  });

  it("returns a right-aligned docked frame that fills the remaining viewport height", () => {
    expect(
      getDockedPanelFrame({
        size: { width: DEFAULT_PANEL_WIDTH, height: DEFAULT_PANEL_HEIGHT },
        viewport: { width: 1440, height: 900 },
        shellTop: 96,
      }),
    ).toEqual({
      top: 96,
      left: 1440 - DEFAULT_PANEL_WIDTH - EDGE_GAP,
      width: DEFAULT_PANEL_WIDTH,
      height: 900 - 96 - EDGE_GAP,
    });
  });
});
