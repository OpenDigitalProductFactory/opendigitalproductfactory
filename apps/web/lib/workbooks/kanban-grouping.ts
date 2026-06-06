// Universal Grid & Workbooks — kanban grouping (EP-GRID-WORKBOOKS, Phase 1d)
// Pure helpers that turn a flat row set into kanban lanes grouped by a select
// column. No React/DOM here so it is unit-testable; the board component renders
// the result and wires drag-and-drop.

import type { ColumnDefinition, GridRow, CellValue } from "./types";

export interface KanbanLane {
  key: string; // the group-by value ("" for unset)
  label: string;
  rows: GridRow[];
}

const UNSET_KEY = "";
const UNSET_LABEL = "(unset)";

function cellKey(value: CellValue): string {
  if (value === null || value === undefined) return UNSET_KEY;
  if (Array.isArray(value)) return value[0] ?? UNSET_KEY;
  if (typeof value === "object") return value.referenceId ?? UNSET_KEY;
  return String(value);
}

/**
 * Group rows into lanes keyed by the group-by column's select options, in option
 * order, with a trailing "(unset)" lane only when some row has no/unknown value.
 * Rows whose value isn't a known option fall into the unset lane.
 */
export function groupRowsByColumn(
  rows: GridRow[],
  columns: ColumnDefinition[],
  groupByColumnId: string,
): KanbanLane[] {
  const groupCol = columns.find((c) => c.columnId === groupByColumnId);
  const options = groupCol?.config?.options ?? [];
  const optionByKey = new Map(options.map((o) => [o.key, o.label]));

  const lanes: KanbanLane[] = options.map((o) => ({ key: o.key, label: o.label, rows: [] }));
  const laneByKey = new Map(lanes.map((l) => [l.key, l]));
  const unset: KanbanLane = { key: UNSET_KEY, label: UNSET_LABEL, rows: [] };

  for (const row of rows) {
    const k = cellKey(row.cells[groupByColumnId] ?? null);
    const lane = k !== UNSET_KEY && optionByKey.has(k) ? laneByKey.get(k)! : unset;
    lane.rows.push(row);
  }

  return unset.rows.length > 0 ? [...lanes, unset] : lanes;
}

/** First column eligible to group a board by (a select column flagged groupable). */
export function defaultGroupByColumn(columns: ColumnDefinition[]): string | null {
  const col = columns.find((c) => c.groupable && c.fieldType === "select");
  return col?.columnId ?? null;
}

/**
 * Choose which columns to show on a card: a primary "title" (first editable text
 * column, else first text column) plus up to `maxMeta` other non-group columns.
 */
export function cardFieldLayout(
  columns: ColumnDefinition[],
  groupByColumnId: string,
  maxMeta = 3,
): { titleColumnId: string | null; metaColumnIds: string[] } {
  const candidates = columns.filter((c) => c.columnId !== groupByColumnId);
  const titleCol =
    candidates.find((c) => c.fieldType === "text" && c.editable) ??
    candidates.find((c) => c.fieldType === "text") ??
    candidates[0];
  const titleColumnId = titleCol?.columnId ?? null;
  const metaColumnIds = candidates
    .filter((c) => c.columnId !== titleColumnId)
    .slice(0, maxMeta)
    .map((c) => c.columnId);
  return { titleColumnId, metaColumnIds };
}
