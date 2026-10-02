// Drawing a service area by clicking corners (BI-6CC10E4C, WWMD DI-4D6FA8193950).
// Pure state machine: idle -> drawing(points) -> naming(points) -> idle.
// "Finish" needs at least three corners; the ring is closed on finish.

import type { GeographicCoordinate, GeographicSceneZone, GeographicZoneCoverage } from "@dpf/storefront-templates";

export const MIN_AREA_CORNERS = 3;

export type DrawingState =
  | { mode: "idle" }
  | { mode: "drawing"; points: GeographicCoordinate[] }
  | { mode: "naming"; points: GeographicCoordinate[] };

export type DrawingAction =
  | { type: "start" }
  | { type: "add"; point: GeographicCoordinate }
  | { type: "undo" }
  | { type: "finish" }
  | { type: "cancel" };

export const IDLE: DrawingState = { mode: "idle" };

export function drawingReducer(state: DrawingState, action: DrawingAction): DrawingState {
  switch (action.type) {
    case "start":
      return state.mode === "idle" ? { mode: "drawing", points: [] } : state;
    case "add":
      return state.mode === "drawing" ? { mode: "drawing", points: [...state.points, action.point] } : state;
    case "undo":
      return state.mode === "drawing" ? { mode: "drawing", points: state.points.slice(0, -1) } : state;
    case "finish":
      return state.mode === "drawing" && state.points.length >= MIN_AREA_CORNERS
        ? { mode: "naming", points: state.points }
        : state;
    case "cancel":
      return IDLE;
  }
}

export function canFinish(state: DrawingState): boolean {
  return state.mode === "drawing" && state.points.length >= MIN_AREA_CORNERS;
}

/** The corners as a closed ring, or null while there are too few to show an area. */
export function closedRing(points: readonly GeographicCoordinate[]): GeographicCoordinate[] | null {
  if (points.length < MIN_AREA_CORNERS) return null;
  return [...points, points[0]!];
}

export function newServiceAreaZone(input: {
  id: string;
  label: string;
  points: readonly GeographicCoordinate[];
  coveredBy: GeographicZoneCoverage | null;
}): GeographicSceneZone | null {
  const ring = closedRing(input.points);
  const label = input.label.trim();
  if (!ring || !label) return null;
  return {
    id: input.id,
    label,
    geometry: { kind: "polygon", rings: [ring] },
    ...(input.coveredBy ? { coveredBy: input.coveredBy } : {}),
  };
}
