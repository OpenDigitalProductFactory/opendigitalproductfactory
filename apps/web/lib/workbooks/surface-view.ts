// apps/web/lib/workbooks/surface-view.ts
// Pure helper for the surfacing layer (EP-GRID-WORKBOOKS): narrow a raw ?view=
// query value to a grid/board view, or null for the default list. Kept DB/React-free
// so it is unit-testable and importable by both server pages and the grid section.

export type SurfaceView = "list" | "grid" | "board";

export function parseSurfaceView(raw: string | undefined | null): "grid" | "board" | null {
  return raw === "grid" || raw === "board" ? raw : null;
}
