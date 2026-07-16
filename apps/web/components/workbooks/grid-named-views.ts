// Universal Grid & Workbooks — named/saved views (EP-GRID-WORKBOOKS).
//
// A "view" is a named snapshot of the full grid view-state (filters, sort,
// grouping, formatting, column order/visibility/freeze, row height, footer
// aggregates). Two backends share this shape:
//   • custom workbook tables → WorkbookView rows (server, shared across users)
//   • platform grids         → localStorage (personal, per browser)
// so the Views dropdown is identical on every grid. The array operations here
// are pure + unit-testable; the Grid owns the IO (localStorage or server action)
// and the react state.

import {
  type GridViewState,
  parseViewState,
  serializeViewState,
} from "./grid-view-state";

/** A saved view: a name over a complete grid view-state snapshot. */
export interface NamedView {
  /** Stable id — "VW-<cuid>" server-side, "lv-<n>" for local views. */
  viewId: string;
  name: string;
  /** The full grid view-state this view restores. */
  state: GridViewState;
  /** At most one default per table; applied on first load. */
  isDefault?: boolean;
}

/** localStorage key holding a table's personal saved views (distinct from the
 * single last-used view state under `viewStorageKey`). */
export function localViewsKey(tableId: string): string {
  return `dpf-workbook-views:${tableId}`;
}

/** Insert a new view or overwrite an existing one with the same (case-insensitive)
 * name — "Save view" is an upsert so re-saving a name updates it in place. */
export function upsertNamedView(
  views: readonly NamedView[],
  name: string,
  state: GridViewState,
  newId: string,
): NamedView[] {
  const trimmed = name.trim();
  const idx = views.findIndex((v) => v.name.trim().toLowerCase() === trimmed.toLowerCase());
  if (idx >= 0) {
    const next = views.slice();
    next[idx] = { ...next[idx]!, name: trimmed, state };
    return next;
  }
  return [...views, { viewId: newId, name: trimmed, state }];
}

/** Remove a view by id (and clear it as default implicitly, since it's gone). */
export function removeNamedView(views: readonly NamedView[], viewId: string): NamedView[] {
  return views.filter((v) => v.viewId !== viewId);
}

/** Mark exactly one view default (or none, if viewId is not present/​null). */
export function setDefaultNamedView(
  views: readonly NamedView[],
  viewId: string | null,
): NamedView[] {
  return views.map((v) => ({ ...v, isDefault: v.viewId === viewId }));
}

/** The default view for a table, if any. */
export function defaultNamedView(views: readonly NamedView[]): NamedView | undefined {
  return views.find((v) => v.isDefault);
}

// --- localStorage serialization (defensive; never throws on bad data) --------

interface SerializedNamedView {
  viewId: string;
  name: string;
  state: string; // serializeViewState output
  isDefault?: boolean;
}

export function serializeNamedViews(views: readonly NamedView[]): string {
  const payload: SerializedNamedView[] = views.map((v) => ({
    viewId: v.viewId,
    name: v.name,
    state: serializeViewState(v.state),
    ...(v.isDefault ? { isDefault: true } : {}),
  }));
  return JSON.stringify(payload);
}

/** Parse saved views; each field validated independently, bad entries dropped. */
export function parseNamedViews(raw: string | null | undefined): NamedView[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: NamedView[] = [];
  for (const entry of data) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof (entry as Record<string, unknown>).viewId !== "string" ||
      typeof (entry as Record<string, unknown>).name !== "string"
    ) {
      continue;
    }
    const e = entry as Record<string, unknown>;
    // `state` may be a serialized string (localStorage) or an object (server JSON).
    const rawState = typeof e.state === "string" ? e.state : JSON.stringify(e.state);
    const state = parseViewState(rawState);
    if (!state) continue;
    out.push({
      viewId: e.viewId as string,
      name: e.name as string,
      state: normalizeViewState(state),
      ...(e.isDefault === true ? { isDefault: true } : {}),
    });
  }
  return out;
}

/** Fill a partial (defensively-parsed) view-state with safe defaults so a saved
 * view always restores every field — missing fields reset to the grid's baseline
 * rather than leaving the prior view's value. */
export function normalizeViewState(partial: Partial<GridViewState>): GridViewState {
  return {
    filterQuery: partial.filterQuery ?? "",
    filterGroup: partial.filterGroup ?? { combinator: "and", conditions: [] },
    sort: partial.sort ?? [],
    cfRules: partial.cfRules ?? [],
    showProvenance: partial.showProvenance ?? false,
    columnOrder: partial.columnOrder ?? [],
    groupBy: partial.groupBy ?? [],
    hiddenColumns: partial.hiddenColumns ?? [],
    frozenCount: partial.frozenCount ?? 0,
    rowHeight: partial.rowHeight ?? "medium",
    footerAgg: partial.footerAgg ?? {},
    showFooter: partial.showFooter ?? false,
  };
}
