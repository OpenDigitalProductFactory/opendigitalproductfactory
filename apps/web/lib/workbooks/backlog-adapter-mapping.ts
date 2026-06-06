// Universal Grid & Workbooks — BacklogItem grid mapping (EP-GRID-WORKBOOKS, Phase 1b)
//
// Pure (no server imports) mapping between BacklogItem records and the grid's
// ColumnDefinition / GridRow contract. Isolated here so it is unit-testable
// without pulling in prisma or the "use server" update action. The adapter
// (backlog-adapter.ts) composes these with the data layer.

import {
  BACKLOG_STATUS_VALUES,
  BACKLOG_WORK_TYPE_VALUES,
  BACKLOG_SOURCE_VALUES,
  type BacklogItemInput,
  type BacklogStatus,
  type BacklogWorkType,
  type BacklogSource,
} from "@/lib/explore/backlog";
import type { ColumnDefinition, GridRow, CellValue, SelectOption } from "./types";

export const BACKLOG_ENTITY_TYPE = "backlog_item";

function humanize(key: string): string {
  return key
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function options(values: readonly string[]): SelectOption[] {
  return values.map((v) => ({ key: v, label: humanize(v) }));
}

// Status options offered for editing — omit "triaging" (an intake-only state).
const EDITABLE_STATUS = BACKLOG_STATUS_VALUES.filter((s) => s !== "triaging");

/** Fixed column schema for the Backlog grid. columnId == BacklogItem field name. */
export const BACKLOG_COLUMNS: ColumnDefinition[] = [
  { columnId: "itemId", name: "ID", fieldType: "text", position: 0, required: false, editable: false, width: 130 },
  { columnId: "title", name: "Title", fieldType: "text", position: 1, required: true, editable: true, width: 320 },
  {
    columnId: "status",
    name: "Status",
    fieldType: "select",
    position: 2,
    required: true,
    editable: true,
    width: 130,
    groupable: true,
    config: { options: options(EDITABLE_STATUS) },
  },
  { columnId: "priority", name: "Priority", fieldType: "number", position: 3, required: false, editable: true, width: 90 },
  {
    columnId: "type",
    name: "Type",
    fieldType: "select",
    position: 4,
    required: true,
    editable: true,
    width: 120,
    config: { options: options(["product", "portfolio"]) },
  },
  {
    columnId: "workType",
    name: "Work type",
    fieldType: "select",
    position: 5,
    required: true,
    editable: true,
    width: 120,
    config: { options: options(BACKLOG_WORK_TYPE_VALUES) },
  },
  {
    columnId: "source",
    name: "Source",
    fieldType: "select",
    position: 6,
    required: false,
    editable: true,
    width: 150,
    config: { options: options(BACKLOG_SOURCE_VALUES) },
  },
  { columnId: "epicId", name: "Epic", fieldType: "text", position: 7, required: false, editable: false, width: 160 },
  { columnId: "body", name: "Details", fieldType: "text", position: 8, required: false, editable: true, width: 360, config: { multiline: true } },
  { columnId: "updatedAt", name: "Updated", fieldType: "datetime", position: 9, required: false, editable: false, width: 170 },
];

/** The subset of BacklogItem fields needed to build a complete update payload. */
export interface BacklogEditableExisting {
  title: string;
  type: string;
  status: string;
  workType: string | null;
  source: string | null;
  priority: number | null;
  body: string | null;
  epicId: string | null;
  digitalProductId: string | null;
  taxonomyNodeId: string | null;
}

/** Map a backlog record (list/detail shape) into a grid row keyed by field name. */
export function backlogItemToGridRow(item: {
  itemId: string;
  title: string;
  status: string;
  type: string;
  workType: string | null;
  source: string | null;
  priority: number | null;
  epicId: string | null;
  body: string | null;
  updatedAt: Date;
}): GridRow {
  return {
    rowId: item.itemId,
    cells: {
      itemId: item.itemId,
      title: item.title,
      status: item.status,
      priority: item.priority,
      type: item.type,
      workType: item.workType,
      source: item.source,
      epicId: item.epicId,
      body: item.body,
      updatedAt: item.updatedAt instanceof Date ? item.updatedAt.toISOString() : String(item.updatedAt),
    },
  };
}

function asNumberOrUndef(v: CellValue | undefined): number | undefined {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return undefined;
}

function asStringOrUndef(v: CellValue | undefined): string | undefined {
  return typeof v === "string" && v !== "" ? v : undefined;
}

/**
 * Build a complete BacklogItemInput by overlaying grid changes (keyed by field
 * name) onto the existing record. Throws if a required field would be empty —
 * we never silently invent a workType/type/title.
 */
export function buildBacklogInput(
  existing: BacklogEditableExisting,
  changes: Record<string, CellValue>,
): BacklogItemInput {
  const pick = <T>(field: string, fallback: T): CellValue | T =>
    field in changes ? changes[field] : fallback;

  const title = String(pick("title", existing.title) ?? "").trim();
  if (!title) throw new Error("Title cannot be empty");

  const type = String(pick("type", existing.type)) as "product" | "portfolio";

  const workTypeRaw = pick("workType", existing.workType);
  const workType = (typeof workTypeRaw === "string" ? workTypeRaw : "") as BacklogWorkType;
  if (!workType) {
    throw new Error("This item is missing a work type — set it in the backlog form first");
  }

  const status = String(pick("status", existing.status)) as BacklogStatus;

  const sourceRaw = pick("source", existing.source ?? undefined);
  const source = (asStringOrUndef(sourceRaw) as BacklogSource | undefined) ?? undefined;

  return {
    title,
    type,
    workType,
    status,
    source,
    priority: asNumberOrUndef(pick("priority", existing.priority ?? undefined)),
    body: asStringOrUndef(pick("body", existing.body ?? undefined)),
    epicId: existing.epicId ?? undefined,
    digitalProductId: existing.digitalProductId ?? undefined,
    taxonomyNodeId: existing.taxonomyNodeId ?? undefined,
  };
}
