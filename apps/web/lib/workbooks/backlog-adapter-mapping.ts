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
  BACKLOG_SCOPE_KIND_VALUES,
  type BacklogStatus,
  type BacklogWorkType,
  type BacklogSource,
  type BacklogScopeKind,
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
  {
    columnId: "scopeKind",
    name: "Scope",
    fieldType: "select",
    position: 8,
    required: false,
    editable: true,
    width: 170,
    groupable: true,
    config: { options: options(BACKLOG_SCOPE_KIND_VALUES) },
  },
  { columnId: "archetypeCategories", name: "Archetype categories", fieldType: "text", position: 9, required: false, editable: true, width: 240 },
  { columnId: "archetypeIds", name: "Archetypes", fieldType: "text", position: 10, required: false, editable: true, width: 240 },
  { columnId: "lifecycleTags", name: "Lifecycle tags", fieldType: "text", position: 11, required: false, editable: true, width: 220 },
  { columnId: "scopeRationale", name: "Scope rationale", fieldType: "text", position: 12, required: false, editable: true, width: 300 },
  { columnId: "body", name: "Details", fieldType: "text", position: 13, required: false, editable: true, width: 360, config: { multiline: true } },
  { columnId: "updatedAt", name: "Updated", fieldType: "datetime", position: 14, required: false, editable: false, width: 170 },
];

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
  scopeKind?: string | null;
  archetypeCategories?: string[];
  archetypeIds?: string[];
  scopeRationale?: string | null;
  lifecycleTags?: string[];
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
      scopeKind: item.scopeKind ?? null,
      archetypeCategories: (item.archetypeCategories ?? []).join(", "),
      archetypeIds: (item.archetypeIds ?? []).join(", "),
      lifecycleTags: (item.lifecycleTags ?? []).join(", "),
      scopeRationale: item.scopeRationale ?? null,
      body: item.body,
      updatedAt: item.updatedAt instanceof Date ? item.updatedAt.toISOString() : String(item.updatedAt),
    },
  };
}

/** Patch of only the backlog fields a grid edit changed. Structurally matches
 *  BacklogFieldPatch in lib/actions/backlog.ts (kept separate so this stays pure). */
export interface BacklogPatch {
  title?: string;
  status?: BacklogStatus;
  priority?: number | null;
  type?: "product" | "portfolio";
  workType?: BacklogWorkType;
  source?: BacklogSource;
  body?: string | null;
  scopeKind?: BacklogScopeKind | null;
  archetypeCategories?: string[];
  archetypeIds?: string[];
  scopeRationale?: string | null;
  lifecycleTags?: string[];
}

function asNumber(v: CellValue): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

function asStr(v: CellValue): string {
  if (typeof v === "string") return v;
  return v == null ? "" : String(v);
}

function asStringList(v: CellValue): string[] {
  if (Array.isArray(v)) {
    return [...new Set(v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean))];
  }
  return [...new Set(asStr(v).split(",").map((x) => x.trim()).filter(Boolean))];
}

/**
 * Build a partial patch from the grid's changed cells (keyed by field name).
 * Only includes fields actually present in `changes`, and only the changed
 * fields are touched — untouched required fields (e.g. a null workType on a
 * legacy item) are left alone, so editing one cell no longer requires the whole
 * record to be valid. Empty values for the required selects (status/type/
 * workType/source) are treated as no-ops rather than invalid writes.
 */
export function buildBacklogPatch(changes: Record<string, CellValue>): BacklogPatch {
  const patch: BacklogPatch = {};
  if ("title" in changes) {
    const t = asStr(changes.title).trim();
    if (!t) throw new Error("Title cannot be empty");
    patch.title = t;
  }
  if ("status" in changes) {
    const s = asStr(changes.status);
    if (s) patch.status = s as BacklogStatus;
  }
  if ("type" in changes) {
    const t = asStr(changes.type);
    if (t) patch.type = t as "product" | "portfolio";
  }
  if ("workType" in changes) {
    const w = asStr(changes.workType);
    if (w) patch.workType = w as BacklogWorkType;
  }
  if ("source" in changes) {
    const s = asStr(changes.source);
    if (s) patch.source = s as BacklogSource;
  }
  if ("scopeKind" in changes) {
    const s = asStr(changes.scopeKind);
    patch.scopeKind = s ? s as BacklogScopeKind : null;
  }
  if ("archetypeCategories" in changes) {
    patch.archetypeCategories = asStringList(changes.archetypeCategories);
  }
  if ("archetypeIds" in changes) {
    patch.archetypeIds = asStringList(changes.archetypeIds);
  }
  if ("lifecycleTags" in changes) {
    patch.lifecycleTags = asStringList(changes.lifecycleTags);
  }
  if ("scopeRationale" in changes) {
    const s = asStr(changes.scopeRationale).trim();
    patch.scopeRationale = s || null;
  }
  if ("priority" in changes) {
    patch.priority = asNumber(changes.priority);
  }
  if ("body" in changes) {
    const b = asStr(changes.body).trim();
    patch.body = b || null;
  }
  return patch;
}
