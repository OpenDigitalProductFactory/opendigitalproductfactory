import { describe, expect, it } from "vitest";

import {
  buildValueStreamGroupLayout,
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

  it("positions stage nodes inside the parent value stream band", () => {
    const layout = buildValueStreamGroupLayout({
      origin: { x: 0, y: 0 },
      stageLabels: ["Plan", "Build"],
    });

    expect(layout.band.width).toBeGreaterThan(0);
    expect(layout.stages[0]?.x).toBeGreaterThan(layout.band.x);
    expect(layout.stages[1]?.x).toBeGreaterThan(layout.stages[0]?.x ?? 0);
    expect(
      (layout.stages[1]?.x ?? 0) + (layout.stages[1]?.width ?? 0),
    ).toBeLessThan(layout.band.x + layout.band.width);
  });
});
