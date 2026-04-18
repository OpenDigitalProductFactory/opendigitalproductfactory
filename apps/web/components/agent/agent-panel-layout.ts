export const EDGE_GAP = 16;
export const DEFAULT_PANEL_WIDTH = 380;
export const DEFAULT_PANEL_HEIGHT = 480;
export const MIN_PANEL_WIDTH = 320;
export const MIN_PANEL_HEIGHT = 320;
export const DESKTOP_PANEL_RESERVE_BREAKPOINT = 1280;

export type ViewportSize = { width: number; height: number };
export type PanelSize = { width: number; height: number };
export type PanelPosition = { x: number; y: number };
export type DockedPanelFrame = { top: number; left: number; width: number; height: number };

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

export function getReservedPanelWidth({
  isOpen,
  size,
  viewport,
}: {
  isOpen: boolean;
  size: PanelSize;
  viewport: ViewportSize;
}): number {
  if (!isOpen || viewport.width < DESKTOP_PANEL_RESERVE_BREAKPOINT) {
    return 0;
  }

  return size.width + (EDGE_GAP * 2);
}

export function isDockedPanelViewport(viewport: ViewportSize): boolean {
  return viewport.width >= DESKTOP_PANEL_RESERVE_BREAKPOINT;
}

export function getDockedPanelFrame({
  size,
  viewport,
  shellTop,
}: {
  size: PanelSize;
  viewport: ViewportSize;
  shellTop: number;
}): DockedPanelFrame {
  const clampedSize = clampPanelSize(size, viewport);
  const top = Math.max(EDGE_GAP, Math.round(shellTop));

  return {
    top,
    left: Math.max(EDGE_GAP, viewport.width - clampedSize.width - EDGE_GAP),
    width: clampedSize.width,
    height: Math.max(MIN_PANEL_HEIGHT, viewport.height - top - EDGE_GAP),
  };
}
