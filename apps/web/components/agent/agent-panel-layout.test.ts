import { describe, expect, it } from "vitest";
import {
  DEFAULT_PANEL_HEIGHT,
  DEFAULT_PANEL_WIDTH,
  MIN_PANEL_HEIGHT,
  MIN_PANEL_WIDTH,
  clampPanelPosition,
  clampPanelSize,
  getDefaultPanelPosition,
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
});
