// Universal Grid & Workbooks — authored views (BI-FE8DF004).
//
// A WorkbookView's config is the grid's opaque view-state blob when a person saves
// it from the grid. A coworker-authored view is either a plain grid view (an empty
// state: the grid's defaults) or a kanban board, stored as ViewConfig.kanban
// { groupByColumnId, cardFields } (./types). The board groups by a select column
// with options, the same rule the board itself uses (kanban-grouping.ts), so a
// view that saves is a view that renders.
//
// resolveBoardView decides, for the workbook page, whether a board is open:
// `?view=<viewId>` of a kanban view, else a kanban view marked default, unless the
// person asked for the grid (`?view=grid`). A stale board (its group-by column
// deleted) falls back to the grid rather than rendering an empty board.

import { cardFieldLayout } from "./kanban-grouping";
import type { ColumnDefinition } from "./types";

export const AUTHORED_VIEW_TYPES = ["grid", "kanban"] as const;
export type AuthoredViewType = (typeof AUTHORED_VIEW_TYPES)[number];

export interface ViewAuthoringInput {
  viewType: AuthoredViewType;
  groupByColumnId?: string;
  cardFields?: string[];
}

export interface StoredView {
  viewId: string;
  name: string;
  viewType: string;
  config: unknown;
  isDefault: boolean;
}

/** The group-by problem for a board over this column, or null when it is a valid lane source. */
function groupByProblem(columns: readonly ColumnDefinition[], columnId: string | undefined): string | null {
  if (!columnId) return "A kanban view needs a group-by column (a select column)";
  const col = columns.find((c) => c.columnId === columnId);
  if (!col) return `${columnId} is not a column of this table`;
  if (col.fieldType !== "select") return `A kanban view groups by a select column; "${col.name}" is ${col.fieldType}`;
  if (!col.config?.options?.length) return `"${col.name}" has no options to make lanes from`;
  return null;
}

/** Validate an authored view against the table and produce what WorkbookView stores. */
export function buildViewConfig(
  input: ViewAuthoringInput,
  columns: readonly ColumnDefinition[],
): { viewType: AuthoredViewType; config: Record<string, unknown> } {
  if (!AUTHORED_VIEW_TYPES.includes(input.viewType)) {
    throw new Error(`A view is grid or kanban, not ${String(input.viewType)}`);
  }
  if (input.viewType === "grid") return { viewType: "grid", config: {} };

  const problem = groupByProblem(columns, input.groupByColumnId);
  if (problem) throw new Error(problem);
  const groupByColumnId = input.groupByColumnId!;

  let cardFields: string[];
  if (input.cardFields && input.cardFields.length > 0) {
    const unknown = input.cardFields.find((id) => !columns.some((c) => c.columnId === id));
    if (unknown) throw new Error(`${unknown} is not a column of this table`);
    cardFields = input.cardFields;
  } else {
    const layout = cardFieldLayout([...columns], groupByColumnId);
    cardFields = [layout.titleColumnId, ...layout.metaColumnIds].filter((id): id is string => Boolean(id));
  }
  return { viewType: "kanban", config: { kanban: { groupByColumnId, cardFields } } };
}

function kanbanConfig(view: StoredView): { groupByColumnId: string; cardFields: string[] } | null {
  if (view.viewType !== "kanban") return null;
  const config = view.config as { kanban?: { groupByColumnId?: unknown; cardFields?: unknown } } | null;
  const id = config?.kanban?.groupByColumnId;
  if (typeof id !== "string") return null;
  const fields = config?.kanban?.cardFields;
  const cardFields = Array.isArray(fields) ? fields.filter((f): f is string => typeof f === "string") : [];
  return { groupByColumnId: id, cardFields };
}

/** The kanban board the workbook page should open, or null for the grid. */
export function resolveBoardView(
  views: readonly StoredView[],
  viewParam: string | undefined,
  columns: readonly ColumnDefinition[],
): { view: StoredView; groupByColumnId: string; cardFields: string[] } | null {
  if (viewParam === "grid") return null;
  const view = viewParam
    ? views.find((v) => v.viewId === viewParam)
    : views.find((v) => v.isDefault && v.viewType === "kanban");
  if (!view) return null;
  const kanban = kanbanConfig(view);
  if (!kanban || groupByProblem(columns, kanban.groupByColumnId)) return null;
  return { view, ...kanban };
}
