const MIN_STAGE_WIDTH = 120;
const MAX_STAGE_WIDTH = 220;
const APPROX_CHAR_WIDTH = 7;
const STAGE_HORIZONTAL_PADDING = 42;
const STAGE_GAP = 22;
const BAND_INSET_LEFT = 56;
const BAND_INSET_RIGHT = 72;
const BAND_END_CLEARANCE = 36;

export function estimateStageWidth(label: string): number {
  return Math.max(
    MIN_STAGE_WIDTH,
    Math.min(
      MAX_STAGE_WIDTH,
      label.trim().length * APPROX_CHAR_WIDTH + STAGE_HORIZONTAL_PADDING,
    ),
  );
}

export function buildValueStreamLayout(labels: string[]) {
  const stageWidths = labels.map(estimateStageWidth);
  const bandWidth =
    BAND_INSET_LEFT +
    BAND_INSET_RIGHT +
    BAND_END_CLEARANCE +
    stageWidths.reduce((sum, width) => sum + width, 0) +
    Math.max(labels.length - 1, 0) * STAGE_GAP;

  return {
    stageWidths,
    stageGap: STAGE_GAP,
    bandInsetLeft: BAND_INSET_LEFT,
    bandInsetRight: BAND_INSET_RIGHT,
    bandEndClearance: BAND_END_CLEARANCE,
    bandWidth,
  };
}
