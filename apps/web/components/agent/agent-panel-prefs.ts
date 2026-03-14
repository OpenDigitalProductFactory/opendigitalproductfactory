import {
  clampPanelPosition,
  clampPanelSize,
  DEFAULT_PANEL_HEIGHT,
  DEFAULT_PANEL_WIDTH,
  getDefaultPanelPosition,
  type PanelPosition,
  type PanelSize,
  type ViewportSize,
} from "./agent-panel-layout";

export function getAgentPanelOpenKey(userId: string): string {
  return `agent-panel-open:${userId}`;
}

export function getAgentPanelPositionKey(userId: string): string {
  return `agent-panel-position:${userId}`;
}

export function getAgentPanelSizeKey(userId: string): string {
  return `agent-panel-size:${userId}`;
}

export function loadPanelOpen(userId: string): boolean {
  try {
    return localStorage.getItem(getAgentPanelOpenKey(userId)) === "true";
  } catch {
    return false;
  }
}

export function savePanelOpen(userId: string, open: boolean): void {
  localStorage.setItem(getAgentPanelOpenKey(userId), String(open));
}

export function loadPanelSize(userId: string, viewport: ViewportSize): PanelSize {
  try {
    const raw = localStorage.getItem(getAgentPanelSizeKey(userId));
    if (raw) {
      const parsed = JSON.parse(raw) as PanelSize;
      if (typeof parsed.width === "number" && typeof parsed.height === "number") {
        return clampPanelSize(parsed, viewport);
      }
    }
  } catch {
    // ignore localStorage parsing issues
  }

  return clampPanelSize({ width: DEFAULT_PANEL_WIDTH, height: DEFAULT_PANEL_HEIGHT }, viewport);
}

export function savePanelSize(userId: string, size: PanelSize): void {
  localStorage.setItem(getAgentPanelSizeKey(userId), JSON.stringify(size));
}

export function loadPanelPosition(userId: string, viewport: ViewportSize, size: PanelSize): PanelPosition {
  try {
    const raw = localStorage.getItem(getAgentPanelPositionKey(userId));
    if (raw) {
      const parsed = JSON.parse(raw) as PanelPosition;
      if (typeof parsed.x === "number" && typeof parsed.y === "number") {
        return clampPanelPosition(parsed, size, viewport);
      }
    }
  } catch {
    // ignore localStorage parsing issues
  }

  return getDefaultPanelPosition(size, viewport);
}

export function savePanelPosition(userId: string, position: PanelPosition): void {
  localStorage.setItem(getAgentPanelPositionKey(userId), JSON.stringify(position));
}
