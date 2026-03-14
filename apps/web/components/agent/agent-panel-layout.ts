export const EDGE_GAP = 16;
export const DEFAULT_PANEL_WIDTH = 380;
export const DEFAULT_PANEL_HEIGHT = 480;
export const MIN_PANEL_WIDTH = 320;
export const MIN_PANEL_HEIGHT = 320;

export type ViewportSize = { width: number; height: number };
export type PanelSize = { width: number; height: number };
export type PanelPosition = { x: number; y: number };

function maxPanelWidth(viewport: ViewportSize): number {
  return Math.max(MIN_PANEL_WIDTH, viewport.width - (EDGE_GAP * 2));
}

function maxPanelHeight(viewport: ViewportSize): number {
  return Math.max(MIN_PANEL_HEIGHT, viewport.height - (EDGE_GAP * 2));
}

export function clampPanelSize(size: PanelSize, viewport: ViewportSize): PanelSize {
  return {
    width: Math.max(MIN_PANEL_WIDTH, Math.min(size.width, maxPanelWidth(viewport))),
    height: Math.max(MIN_PANEL_HEIGHT, Math.min(size.height, maxPanelHeight(viewport))),
  };
}

export function clampPanelPosition(
  position: PanelPosition,
  size: PanelSize,
  viewport: ViewportSize,
): PanelPosition {
  return {
    x: Math.max(0, Math.min(position.x, viewport.width - size.width)),
    y: Math.max(0, Math.min(position.y, viewport.height - size.height)),
  };
}

export function getDefaultPanelPosition(size: PanelSize, viewport: ViewportSize): PanelPosition {
  return {
    x: Math.max(EDGE_GAP, viewport.width - size.width - EDGE_GAP),
    y: Math.max(EDGE_GAP, viewport.height - size.height - EDGE_GAP),
  };
}
