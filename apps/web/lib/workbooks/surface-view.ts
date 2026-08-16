// apps/web/lib/workbooks/surface-view.ts
// Pure helper for the surfacing layer (EP-GRID-WORKBOOKS): narrow a raw ?view=
// query value to a grid/board view, or null for the default list. Kept DB/React-free
// so it is unit-testable and importable by both server pages and the grid section.

export type SurfaceView = "list" | "grid" | "board";
export type SurfaceDataScope = "default" | "all";

export function parseSurfaceView(raw: string | undefined | null): "grid" | "board" | null {
  return raw === "grid" || raw === "board" ? raw : null;
}

/** Unknown/absent values fail closed to the domain's default dataset. */
export function parseSurfaceDataScope(
  raw: string | undefined | null,
): SurfaceDataScope {
  return raw === "all" ? "all" : "default";
}

export function resolveSurfaceDataFilter<T>(
  defaultFilter: T | undefined,
  scope: SurfaceDataScope,
): T | undefined {
  return scope === "all" ? undefined : defaultFilter;
}

/** Stable, server-readable links shared by every embedded domain grid. */
export function buildSurfaceViewHref(
  path: string,
  view: SurfaceView,
  scope: SurfaceDataScope,
): string {
  if (view === "list") return path;
  const params = new URLSearchParams({ view });
  if (scope === "all") params.set("dataScope", "all");
  return `${path}?${params.toString()}`;
}
