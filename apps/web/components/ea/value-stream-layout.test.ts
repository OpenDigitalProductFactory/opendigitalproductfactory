import { describe, expect, it } from "vitest";

import {
  buildValueStreamLayout,
  estimateStageWidth,
} from "./value-stream-layout";

describe("estimateStageWidth", () => {
  it("grows with label length within bounds", () => {
    expect(estimateStageWidth("Plan")).toBeGreaterThanOrEqual(120);
    expect(estimateStageWidth("Longer Stage Label")).toBeGreaterThan(
      estimateStageWidth("Plan"),
    );
    expect(
      estimateStageWidth(
        "A label so long that it should clamp before taking over the layout",
      ),
    ).toBeLessThanOrEqual(220);
  });
});

describe("buildValueStreamLayout", () => {
  it("expands the parent band as stages are added", () => {
    const short = buildValueStreamLayout(["Plan", "Build"]);
    const longer = buildValueStreamLayout(["Plan", "Build", "Run", "Improve"]);

    expect(longer.bandWidth).toBeGreaterThan(short.bandWidth);
  });

  it("adds explicit end clearance so the final stage does not clip", () => {
    const layout = buildValueStreamLayout(["Plan", "Build", "Run"]);
    const rawStageSpan =
      layout.stageWidths.reduce((sum, width) => sum + width, 0) +
      layout.stageGap * 2 +
      layout.bandInsetLeft +
      layout.bandInsetRight;

    expect(layout.bandWidth).toBeGreaterThan(rawStageSpan);
  });
});
