"use client";

// Universal Grid & Workbooks — the Grid component (EP-GRID-WORKBOOKS)
// Library-agnostic wrapper around react-data-grid. Everything above this file
// speaks the spec's ColumnDefinition / GridRow contract; react-data-grid is an
// implementation detail contained here, so it can be swapped without touching
// the data layer, server, or pages.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ClipboardEvent as ReactClipboardEvent,
} from "react";
import {
  DataGrid,
  TreeDataGrid,
  SelectColumn,
  renderTextEditor,
  type Column,
  type RowsChangeData,
  type SortColumn,
  type RenderSummaryCellProps,
  type RenderGroupCellProps,
  type CellCopyArgs,
  type CellPasteArgs,
  type CellMouseArgs,
  type CellMouseEvent,
  type CellSelectArgs,
  type CellKeyDownArgs,
  type CellKeyboardEvent,
} from "react-data-grid";
import "react-data-grid/lib/styles.css";
import "./dpf-grid.css";
import {
  type ColumnDefinition,
  type GridRow,
  type CellValue,
  type ReferenceValue,
  type GridCapabilities,
  type ProvenanceKind,
  PROVENANCE_LABELS,
} from "@/lib/workbooks/types";
import {
  type GridRowData,
  NumberEditor,
  makeDateEditor,
  makeSelectEditor,
  makeCheckboxRenderer,
  makeSelectRenderer,
  makeMultiSelectRenderer,
  renderUrlCell,
  renderEmailCell,
  renderImageCell,
  ImageEditor,
  renderAttachmentCell,
  AttachmentEditor,
  renderDateCell,
  renderReferenceCell,
  renderComputedCell,
  renderLinkCell,
  makeReferenceEditor,
  makeLinkEditor,
  makeCurrencyRenderer,
  makePercentRenderer,
  makeDurationRenderer,
  makeRatingRenderer,
  renderProgressCell,
  renderPhoneCell,
} from "./cell-editors";
import {
  createRowAction,
  updateCellsAction,
  deleteRowAction,
  reorderRowsAction,
  listViewsAction,
  saveViewAction,
  deleteViewAction,
  setDefaultViewAction,
} from "@/lib/actions/workbooks";
import { updatePlatformCellsAction } from "@/lib/actions/platform-grid";
import {
  type GridHistory,
  EMPTY_HISTORY,
  recordEdit,
  peekUndo,
  peekRedo,
  commitUndo,
  commitRedo,
} from "./grid-history";
import { quickFilterRows, cellSearchText } from "./grid-filter";
import {
  applyFilterGroup,
  activeConditionCount,
  EMPTY_FILTER_GROUP,
  type FilterGroup,
} from "./grid-filter-builder";
import { rowsToCsv } from "./grid-csv";
import {
  type ConditionalRule,
  rowColor,
  rowColorClass,
} from "./grid-conditional-format";
import {
  GridFilterPanel,
  GridSummaryPanel,
  GridFormatPanel,
  GridGroupPanel,
  GridColumnsPanel,
} from "./GridPanels";
import {
  viewStorageKey,
  serializeViewState,
  parseViewState,
  type GridViewState,
} from "./grid-view-state";
import {
  type NamedView,
  localViewsKey,
  parseNamedViews,
  serializeNamedViews,
  upsertNamedView,
  removeNamedView,
  setDefaultNamedView,
  defaultNamedView,
  normalizeViewState,
} from "./grid-named-views";
import { GridViewsMenu } from "./GridViewsMenu";
import { type PivotAgg, type SummaryMode } from "./grid-pivot";
import {
  type CellRange,
  singleCell,
  rangeRect,
  isMultiCell,
  extendFocus,
  rangeToTsv,
  parseTsv,
  pasteWrites,
} from "./grid-range";
import { GridCalendar } from "./GridCalendar";
import { dateColumns } from "./grid-calendar";
import {
  reorderColumnIds,
  applyColumnOrder,
  reorderRowsByDrag,
  groupRowsByColumn,
  groupKeys,
  expandedGroupSet,
  splitExpandedGroupIds,
} from "./grid-reorder-group";
import {
  visibleColumns as computeVisibleColumns,
  clampFrozenCount,
  rowHeightPx,
  type RowHeight,
} from "./grid-view-options";
import {
  computeFooter,
  computeFooterRow,
  availableAggs,
  toFooterAgg,
  FOOTER_AGG_LABELS,
  type FooterAgg,
} from "./grid-footer-summary";
import { RecordDetailModal } from "./RecordDetailModal";
import {
  Download,
  Filter,
  Palette,
  BarChart3,
  Layers,
  SlidersHorizontal,
  Info,
  Table as TableIcon,
  LayoutGrid,
  Calendar as CalendarIcon,
} from "lucide-react";

export interface WorkbookGridProps {
  /** custom WorkbookTable id (TBL-*) or, for platform data, the entity type. */
  tableId: string;
  columns: ColumnDefinition[];
  rows: GridRow[];
  capabilities: GridCapabilities;
  /**
   * "custom" = user-defined WorkbookTable (default).
   * "platform" = a live grid over platform records (e.g. backlog); edits route
   * through the domain's validated update action, not the workbook store.
   */
  source?: "custom" | "platform";
}

function toRowData(rows: GridRow[]): GridRowData[] {
  return rows.map((r) => ({ rowId: r.rowId, ...r.cells }));
}

// The footer summary row is a plain columnId -> display-string map (see
// grid-footer-summary.ts); react-data-grid renders it as a pinned bottom row.
type SummaryRow = Record<string, string>;

// Arrow-key → [dRow, dCol] for Shift+Arrow range extension (module-stable).
const ARROW: Record<string, [number, number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};

function buildColumn(
  col: ColumnDefinition,
  canEdit: boolean,
  showProvenance: boolean,
  frozen: boolean,
): Column<GridRowData> {
  const options = col.config?.options ?? [];
  const label = col.required ? `${col.name} *` : col.name;
  const kind: ProvenanceKind = col.provenanceKind ?? "manual";
  const base: Column<GridRowData> = {
    key: col.columnId,
    name: label,
    resizable: true,
    sortable: true,
    // Drag the header to reorder columns (onColumnsReorder on the grid).
    draggable: true,
    // Pinned: the leftmost N columns stay put on horizontal scroll.
    frozen,
    width: col.width,
    minWidth: 80,
    // Progressive disclosure (Dale review): provenance is hidden until the user
    // turns on "Show data sources" — the grid reads as an ordinary spreadsheet.
    renderHeaderCell: showProvenance
      ? () => (
          <div className="dpf-grid-header">
            <span className="dpf-grid-header-name">{label}</span>
            <span className={`dpf-prov dpf-prov-${kind}`}>{PROVENANCE_LABELS[kind]}</span>
          </div>
        )
      : undefined,
  };
  const editable = canEdit && col.editable;

  switch (col.fieldType) {
    case "text":
      return { ...base, renderEditCell: editable ? renderTextEditor : undefined };
    case "url":
      return {
        ...base,
        renderCell: renderUrlCell,
        renderEditCell: editable ? renderTextEditor : undefined,
      };
    case "email":
      return {
        ...base,
        renderCell: renderEmailCell,
        renderEditCell: editable ? renderTextEditor : undefined,
      };
    case "image":
      return {
        ...base,
        renderCell: renderImageCell,
        renderEditCell: editable ? ImageEditor : undefined,
      };
    case "attachment":
      return {
        ...base,
        renderCell: renderAttachmentCell,
        renderEditCell: editable ? AttachmentEditor : undefined,
      };
    case "number":
      return { ...base, renderEditCell: editable ? NumberEditor : undefined };
    case "date":
      return {
        ...base,
        renderCell: renderDateCell(false),
        renderEditCell: editable ? makeDateEditor(false) : undefined,
      };
    case "datetime":
      return {
        ...base,
        renderCell: renderDateCell(true),
        renderEditCell: editable ? makeDateEditor(true) : undefined,
      };
    case "checkbox":
      return { ...base, renderCell: makeCheckboxRenderer(editable) };
    case "select":
      return {
        ...base,
        renderCell: makeSelectRenderer(options),
        renderEditCell: editable ? makeSelectEditor(options) : undefined,
      };
    case "multi_select":
      // Phase 1: rendered read-only in the grid; edit via API/MCP.
      return { ...base, renderCell: makeMultiSelectRenderer(options) };
    case "reference": {
      // Phase 2: editable in-cell typeahead over a live platform entity.
      const referenceType = col.config?.referenceType;
      return {
        ...base,
        renderCell: renderReferenceCell,
        renderEditCell:
          editable && referenceType ? makeReferenceEditor(referenceType) : undefined,
        // The typeahead's result list is a floating element; without this,
        // react-data-grid treats a click on it as an outside-click and commits
        // the (empty) draft before onSelect runs, so the picked reference is lost.
        editorOptions: { commitOnOutsideClick: false },
      };
    }
    case "formula":
    case "lookup":
    case "rollup":
      // Computed read-only columns (derived server-side). rollup = reverse-FK aggregate.
      return { ...base, renderCell: renderComputedCell };
    case "link": {
      // Link-to-many: chips per linked record + multi-select typeahead editor.
      const linkConfig = col.config?.link;
      return {
        ...base,
        renderCell: renderLinkCell,
        renderEditCell: editable && linkConfig ? makeLinkEditor(linkConfig) : undefined,
        editorOptions: { commitOnOutsideClick: false },
      };
    }
    // Numeric-backed display types — edit as a number, render specially.
    case "currency":
      return {
        ...base,
        renderCell: makeCurrencyRenderer(col.config?.currencySymbol ?? "$", col.config?.precision),
        renderEditCell: editable ? NumberEditor : undefined,
      };
    case "percent":
      return {
        ...base,
        renderCell: makePercentRenderer(col.config?.precision),
        renderEditCell: editable ? NumberEditor : undefined,
      };
    case "progress":
      return {
        ...base,
        renderCell: renderProgressCell,
        renderEditCell: editable ? NumberEditor : undefined,
      };
    case "duration":
      return {
        ...base,
        renderCell: makeDurationRenderer(col.config?.durationUnit ?? "minutes"),
        renderEditCell: editable ? NumberEditor : undefined,
      };
    case "rating":
      return {
        ...base,
        renderCell: makeRatingRenderer(col.config?.max ?? 5),
        renderEditCell: editable ? NumberEditor : undefined,
      };
    case "phone":
      return {
        ...base,
        renderCell: renderPhoneCell,
        renderEditCell: editable ? renderTextEditor : undefined,
      };
    default:
      return base;
  }
}

function compareValues(a: CellValue, b: CellValue): number {
  const norm = (v: CellValue): string | number => {
    if (v === null || v === undefined) return "";
    if (Array.isArray(v)) {
      // link cell = array of references; sort by their labels/ids
      if (v.length > 0 && typeof v[0] === "object" && v[0] !== null && "referenceId" in v[0]) {
        return v.map((it) => (it as ReferenceValue).label ?? (it as ReferenceValue).referenceId).join(", ");
      }
      return v.join(",");
    }
    if (typeof v === "object") {
      if ("referenceId" in v) return v.referenceId ?? "";
      if ("url" in v) return v.name ?? v.url;
      return "";
    }
    if (typeof v === "boolean") return v ? 1 : 0;
    return v;
  };
  const av = norm(a);
  const bv = norm(b);
  if (av === bv) return 0;
  return av < bv ? -1 : 1;
}

export function WorkbookGrid({
  tableId,
  columns,
  rows,
  capabilities,
  source = "custom",
}: WorkbookGridProps) {
  const [rowData, setRowData] = useState<GridRowData[]>(() => toRowData(rows));
  const [sortColumns, setSortColumns] = useState<readonly SortColumn[]>([]);
  const [selectedRows, setSelectedRows] = useState<ReadonlySet<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showProvenance, setShowProvenance] = useState(false);
  // Client view mode: the data grid, the gallery cards, or the calendar.
  const [viewMode, setViewMode] = useState<"grid" | "gallery" | "calendar">("grid");
  const gallery = viewMode === "gallery";
  const [filterQuery, setFilterQuery] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [showFormat, setShowFormat] = useState(false);
  const [cfRules, setCfRules] = useState<ConditionalRule[]>([]);
  const cfIdRef = useRef(0);
  const fcIdRef = useRef(0);
  const [showSummary, setShowSummary] = useState(false);
  const [summaryGroupBy, setSummaryGroupBy] = useState("");
  const [summaryValue, setSummaryValue] = useState("");
  const [summaryMode, setSummaryMode] = useState<SummaryMode>("table");
  // Pivot (2-D summary): the "across" column + the aggregate applied to cells.
  const [summaryPivotCol, setSummaryPivotCol] = useState("");
  const [summaryAgg, setSummaryAgg] = useState<PivotAgg>("count");
  const [filterGroup, setFilterGroup] = useState<FilterGroup>(EMPTY_FILTER_GROUP);
  const activeFilterCount = activeConditionCount(filterGroup);
  // Drag-to-reorder column order (column ids) + in-grid collapsible grouping.
  const [columnOrder, setColumnOrder] = useState<string[]>([]);
  const [groupBy, setGroupBy] = useState<string[]>([]);
  const [showGroup, setShowGroup] = useState(false);
  // Table ergonomics: hidden fields, pinned leftmost columns, row density.
  const [hiddenColumns, setHiddenColumns] = useState<string[]>([]);
  const [frozenCount, setFrozenCount] = useState(0);
  const [rowHeight, setRowHeight] = useState<RowHeight>("medium");
  const [showColumns, setShowColumns] = useState(false);
  // Per-column footer aggregate (Airtable-style summary bar): columnId → agg.
  const [footerAgg, setFooterAgg] = useState<Record<string, FooterAgg>>({});
  const [showFooter, setShowFooter] = useState(false);
  // Which row is expanded into the record detail modal (null = closed).
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  // Group expansion (session-scoped), split so nested grouping behaves like
  // Smartsheet/Airtable: top-level groups open by default (collapses tracked in
  // `collapsedGroups`), deeper levels closed by default (opens tracked in
  // `extraExpanded`). TreeDataGrid reports the full expanded set on every toggle,
  // so we split it back into these two intents rather than storing it verbatim —
  // that keeps freshly-appeared top groups (from a filter/edit) open by default.
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<unknown>>(() => new Set());
  const [extraExpanded, setExtraExpanded] = useState<ReadonlySet<unknown>>(() => new Set());
  // Multi-step undo/redo of cell edits (distinct from the audit history). Each
  // entry's inverse replays through the same validated dispatch as a normal edit.
  const [history, setHistory] = useState<GridHistory>(EMPTY_HISTORY);

  // --- Named/saved views ---------------------------------------------------
  // A named snapshot of the full grid view-state. Custom tables persist views
  // server-side (WorkbookView, shared across table users); platform grids persist
  // to localStorage (personal). Same UI (GridViewsMenu); backend chosen by source.
  const serverBacked = source === "custom";
  const [views, setViews] = useState<NamedView[]>([]);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);

  const buildCurrentViewState = useCallback(
    (): GridViewState => ({
      filterQuery,
      filterGroup,
      sort: sortColumns.map((s) => ({ columnKey: s.columnKey, direction: s.direction })),
      cfRules,
      showProvenance,
      columnOrder,
      groupBy,
      hiddenColumns,
      frozenCount,
      rowHeight,
      footerAgg,
      showFooter,
    }),
    [
      filterQuery,
      filterGroup,
      sortColumns,
      cfRules,
      showProvenance,
      columnOrder,
      groupBy,
      hiddenColumns,
      frozenCount,
      rowHeight,
      footerAgg,
      showFooter,
    ],
  );

  // Apply a full saved view-state to the grid (every field, so a view is a clean
  // reset — not a merge). Group expansion resets to the default for the new grouping.
  const applyViewState = useCallback((s: GridViewState) => {
    setFilterQuery(s.filterQuery);
    setFilterGroup(s.filterGroup);
    setSortColumns(s.sort);
    setCfRules(s.cfRules);
    setShowProvenance(s.showProvenance);
    setColumnOrder(s.columnOrder);
    setGroupBy(s.groupBy);
    setHiddenColumns(s.hiddenColumns);
    setFrozenCount(s.frozenCount);
    setRowHeight(s.rowHeight);
    const coerced: Record<string, FooterAgg> = {};
    for (const [k, v] of Object.entries(s.footerAgg)) coerced[k] = toFooterAgg(v);
    setFooterAgg(coerced);
    setShowFooter(s.showFooter);
    setCollapsedGroups(new Set());
    setExtraExpanded(new Set());
  }, []);

  const loadViews = useCallback(async (): Promise<NamedView[]> => {
    if (serverBacked) {
      const res = await listViewsAction(tableId);
      if (!res.ok) return [];
      return res.data.map((sv) => {
        const parsed = parseViewState(
          typeof sv.config === "string" ? sv.config : JSON.stringify(sv.config),
        );
        return {
          viewId: sv.viewId,
          name: sv.name,
          state: normalizeViewState(parsed ?? {}),
          isDefault: sv.isDefault,
        };
      });
    }
    try {
      return parseNamedViews(localStorage.getItem(localViewsKey(tableId)));
    } catch {
      return [];
    }
  }, [serverBacked, tableId]);

  const persistLocalViews = useCallback(
    (next: NamedView[]) => {
      if (serverBacked) return;
      try {
        localStorage.setItem(localViewsKey(tableId), serializeNamedViews(next));
      } catch {
        // ignore quota / unavailable storage
      }
    },
    [serverBacked, tableId],
  );

  const handleApplyView = useCallback(
    (v: NamedView) => {
      applyViewState(v.state);
      setActiveViewId(v.viewId);
    },
    [applyViewState],
  );

  const handleSaveView = useCallback(
    async (name: string) => {
      const state = buildCurrentViewState();
      const match = (v: NamedView) => v.name.trim().toLowerCase() === name.trim().toLowerCase();
      if (serverBacked) {
        const res = await saveViewAction(tableId, { name, config: state });
        if (!res.ok) return setError(res.error);
        const loaded = await loadViews();
        setViews(loaded);
        setActiveViewId(loaded.find(match)?.viewId ?? null);
      } else {
        const id = `lv-${globalThis.crypto?.randomUUID?.() ?? String(views.length + 1)}`;
        const next = upsertNamedView(views, name, state, id);
        setViews(next);
        persistLocalViews(next);
        setActiveViewId(next.find(match)?.viewId ?? null);
      }
    },
    [serverBacked, tableId, views, buildCurrentViewState, loadViews, persistLocalViews],
  );

  const handleDeleteView = useCallback(
    async (viewId: string) => {
      if (serverBacked) {
        const res = await deleteViewAction(tableId, viewId);
        if (!res.ok) return setError(res.error);
        setViews(await loadViews());
      } else {
        const next = removeNamedView(views, viewId);
        setViews(next);
        persistLocalViews(next);
      }
      setActiveViewId((cur) => (cur === viewId ? null : cur));
    },
    [serverBacked, tableId, views, loadViews, persistLocalViews],
  );

  const handleSetDefaultView = useCallback(
    async (viewId: string | null) => {
      if (serverBacked) {
        const res = await setDefaultViewAction(tableId, viewId);
        if (!res.ok) return setError(res.error);
        setViews(await loadViews());
      } else {
        const next = setDefaultNamedView(views, viewId);
        setViews(next);
        persistLocalViews(next);
      }
    },
    [serverBacked, tableId, views, loadViews, persistLocalViews],
  );

  // Persist the per-grid view (filters/sort/formatting/provenance) per tableId so
  // it survives reloads. Client-only (localStorage); hydrate once, then save on change.
  const viewHydratedRef = useRef(false);
  useEffect(() => {
    viewHydratedRef.current = false;
    let cancelled = false;
    void (async () => {
      const loaded = await loadViews();
      if (cancelled) return;
      setViews(loaded);
      // A saved default view wins over the last-used layout; else restore the
      // last-used single-view state (field-by-field, so absent fields are kept).
      const def = defaultNamedView(loaded);
      if (def) {
        applyViewState(def.state);
        setActiveViewId(def.viewId);
      } else {
        try {
          const parsed = parseViewState(localStorage.getItem(viewStorageKey(tableId)));
          if (parsed) {
            if (parsed.filterQuery !== undefined) setFilterQuery(parsed.filterQuery);
            if (parsed.filterGroup) setFilterGroup(parsed.filterGroup);
            if (parsed.sort) setSortColumns(parsed.sort);
            if (parsed.cfRules) setCfRules(parsed.cfRules);
            if (parsed.showProvenance !== undefined) setShowProvenance(parsed.showProvenance);
            if (parsed.columnOrder) setColumnOrder(parsed.columnOrder);
            if (parsed.groupBy) setGroupBy(parsed.groupBy);
            if (parsed.hiddenColumns) setHiddenColumns(parsed.hiddenColumns);
            if (parsed.frozenCount !== undefined) setFrozenCount(parsed.frozenCount);
            if (parsed.rowHeight) setRowHeight(parsed.rowHeight);
            if (parsed.footerAgg) {
              const coerced: Record<string, FooterAgg> = {};
              for (const [k, v] of Object.entries(parsed.footerAgg)) coerced[k] = toFooterAgg(v);
              setFooterAgg(coerced);
            }
            if (parsed.showFooter !== undefined) setShowFooter(parsed.showFooter);
          }
        } catch {
          // ignore unreadable storage
        }
      }
      if (!cancelled) viewHydratedRef.current = true;
    })();
    return () => {
      cancelled = true;
    };
  }, [tableId, loadViews, applyViewState]);

  useEffect(() => {
    if (!viewHydratedRef.current) return;
    try {
      localStorage.setItem(viewStorageKey(tableId), serializeViewState(buildCurrentViewState()));
    } catch {
      // ignore quota / unavailable storage
    }
  }, [tableId, buildCurrentViewState]);

  // Columns in the user's saved drag order; new columns append, stale ids drop.
  const orderedColumns = useMemo(
    () => applyColumnOrder(columns, columnOrder),
    [columns, columnOrder],
  );

  // Visible = ordered minus hidden. This is the set the grid, gallery, and CSV
  // export all render, so hiding a field hides it everywhere the view is shown.
  const visibleCols = useMemo(
    () => computeVisibleColumns(orderedColumns, hiddenColumns),
    [orderedColumns, hiddenColumns],
  );

  // The calendar view is only offered when a date/datetime column exists to plot.
  const hasDateColumn = useMemo(() => dateColumns(columns).length > 0, [columns]);

  // Pin the leftmost N visible columns (clamped to leave one scrollable).
  const effectiveFrozen = clampFrozenCount(frozenCount, visibleCols.length);

  // In-grid grouping. Drop stale ids so a deleted grouping column can't wedge the
  // grid into an empty TreeDataGrid. Declared before gridColumns because the
  // column builder reads `grouping`/`effectiveGroupBy` to render per-group
  // subtotals. Grouping is grid-only; gallery renders flat cards regardless.
  const effectiveGroupBy = useMemo(
    () => groupBy.filter((id) => columns.some((c) => c.columnId === id)),
    [groupBy, columns],
  );
  const groupColumnId = effectiveGroupBy[0];
  const grouping = Boolean(groupColumnId) && viewMode === "grid" && columns.length > 0;

  // Manual row reordering (drag a row to a new slot). Optimistic: reorder the
  // local rows immediately, then persist the new order to WorkbookRow.position
  // (custom tables only — platform grids have no stored row order). Declared
  // before gridColumns because the drag column's cell calls it.
  const onReorderRow = useCallback(
    (dragId: string, dropId: string) => {
      const next = reorderRowsByDrag(rowData, dragId, dropId);
      setRowData(next);
      if (source === "custom") {
        void reorderRowsAction(
          tableId,
          next.map((r) => r.rowId),
        ).then((res) => {
          if (!res.ok) setError(res.error);
        });
      }
    },
    [rowData, source, tableId],
  );

  const sortedRows = useMemo<GridRowData[]>(() => {
    const filtered = applyFilterGroup(
      quickFilterRows(rowData, columns, filterQuery),
      filterGroup,
    );
    if (sortColumns.length === 0) return filtered;
    const sorted = [...filtered];
    sorted.sort((ra, rb) => {
      for (const sc of sortColumns) {
        const cmp = compareValues(ra[sc.columnKey], rb[sc.columnKey]);
        if (cmp !== 0) return sc.direction === "DESC" ? -cmp : cmp;
      }
      return 0;
    });
    return sorted;
  }, [rowData, columns, filterQuery, filterGroup, sortColumns]);

  // --- Cell range selection (Excel-grade: select a rectangle, then block
  // copy/paste or clear). react-data-grid v7 has no native range, so we track an
  // anchor+focus cell (indices into the displayed rows/cols) and highlight the
  // rectangle via `cellClass`. Flat grid only. Pure range math in grid-range.ts.
  const [range, setRange] = useState<CellRange | null>(null);
  const rangeCellSet = useMemo(() => {
    if (!range || !isMultiCell(range)) return null;
    const rect = rangeRect(range);
    const set = new Set<string>();
    for (let r = rect.top; r <= Math.min(rect.bottom, sortedRows.length - 1); r++) {
      const rowId = sortedRows[r]?.rowId;
      if (!rowId) continue;
      for (let c = rect.left; c <= Math.min(rect.right, visibleCols.length - 1); c++) {
        const colId = visibleCols[c]?.columnId;
        if (colId) set.add(`${rowId}:${colId}`);
      }
    }
    return set;
  }, [range, sortedRows, visibleCols]);

  const gridColumns = useMemo<Column<GridRowData, SummaryRow>[]>(() => {
    const cols = visibleCols.map((c, i) => {
      const built = buildColumn(
        c,
        capabilities.canEditCell,
        showProvenance,
        i < effectiveFrozen,
      ) as Column<GridRowData, SummaryRow>;
      // Highlight cells inside the selected range (Excel-style rectangle).
      const base: Column<GridRowData, SummaryRow> = rangeCellSet
        ? {
            ...built,
            cellClass: (row: GridRowData) =>
              rangeCellSet.has(`${row.rowId}:${c.columnId}`) ? "dpf-cell-range" : undefined,
          }
        : built;
      // Inline per-group subtotal: when grouping is active, a non-group-by column
      // with a chosen aggregate shows that aggregate over the group's rows on the
      // group header row — the same `footerAgg` selection that drives the footer
      // bar, so one summary function reads as both subtotal and grand total
      // (Excel/Smartsheet behavior). Group-by columns are left alone so
      // TreeDataGrid keeps rendering their toggle + value + child count.
      const agg = footerAgg[c.columnId] ?? "none";
      const showsGroupSubtotal =
        grouping && agg !== "none" && !effectiveGroupBy.includes(c.columnId);
      const withGroupCell: Column<GridRowData, SummaryRow> = showsGroupSubtotal
        ? {
            ...base,
            renderGroupCell: ({ childRows }: RenderGroupCellProps<GridRowData, SummaryRow>) => {
              const value = computeFooter(childRows, c.columnId, agg);
              return value ? (
                <span className="dpf-grid-group-subtotal" title={`${FOOTER_AGG_LABELS[agg]} of ${c.name}`}>
                  <span className="dpf-grid-group-subtotal-label">{FOOTER_AGG_LABELS[agg]}</span>
                  {value}
                </span>
              ) : null;
            },
          }
        : base;
      if (!showFooter) return withGroupCell;
      // Footer cell: an aggregate picker + the computed value (Airtable-style).
      return {
        ...withGroupCell,
        renderSummaryCell: ({ row }: RenderSummaryCellProps<SummaryRow, GridRowData>) => (
          <div className="dpf-grid-footer-cell">
            <select
              className="dpf-grid-footer-select"
              value={footerAgg[c.columnId] ?? "none"}
              onChange={(e) =>
                setFooterAgg((prev) => ({ ...prev, [c.columnId]: toFooterAgg(e.target.value) }))
              }
              aria-label={`Summarize ${c.name}`}
              title={`Summarize ${c.name}`}
            >
              {availableAggs(c.fieldType).map((a) => (
                <option key={a} value={a}>
                  {FOOTER_AGG_LABELS[a]}
                </option>
              ))}
            </select>
            <span className="dpf-grid-footer-value">{row[c.columnId] ?? ""}</span>
          </div>
        ),
      } as Column<GridRowData, SummaryRow>;
    });
    // Leading "expand" column: opens the full-record modal for its row.
    const expandCol: Column<GridRowData, SummaryRow> = {
      key: "__expand__",
      name: "",
      width: 36,
      minWidth: 36,
      maxWidth: 36,
      frozen: true,
      resizable: false,
      sortable: false,
      renderCell: ({ row }) => (
        <button
          type="button"
          className="dpf-grid-expand"
          onClick={() => setOpenRowId(row.rowId)}
          aria-label="Expand record"
          title="Expand record"
        >
          ⤢
        </button>
      ),
    };
    // Leading "drag" column: manual row reordering. Only meaningful on a custom
    // table whose rows have a stored order, and only while the displayed order is
    // the manual one — a sort or grouping overrides it, so hide the handle then.
    const canReorderRows =
      source === "custom" && capabilities.canEditCell && sortColumns.length === 0 && !grouping;
    const dragCol: Column<GridRowData, SummaryRow> = {
      key: "__drag__",
      name: "",
      width: 28,
      minWidth: 28,
      maxWidth: 28,
      frozen: true,
      resizable: false,
      sortable: false,
      renderCell: ({ row }) => (
        <div
          className="dpf-grid-drag-handle"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData("text/plain", row.rowId);
            e.dataTransfer.effectAllowed = "move";
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const src = e.dataTransfer.getData("text/plain");
            if (src && src !== row.rowId) onReorderRow(src, row.rowId);
          }}
          title="Drag to reorder"
          aria-label="Drag to reorder row"
        >
          ⠿
        </div>
      ),
    };
    const lead: Column<GridRowData, SummaryRow>[] = [];
    if (capabilities.canDeleteRow) lead.push(SelectColumn as Column<GridRowData, SummaryRow>);
    if (canReorderRows) lead.push(dragCol);
    lead.push(expandCol);
    return [...lead, ...cols];
  }, [
    visibleCols,
    capabilities,
    showProvenance,
    effectiveFrozen,
    showFooter,
    footerAgg,
    grouping,
    effectiveGroupBy,
    source,
    sortColumns.length,
    onReorderRow,
    rangeCellSet,
  ]);

  const onColumnsReorder = useCallback(
    (sourceKey: string, targetKey: string) => {
      setColumnOrder((prev) =>
        reorderColumnIds(prev.length ? prev : columns.map((c) => c.columnId), sourceKey, targetKey),
      );
    },
    [columns],
  );

  // Footer summary bar: one pinned bottom row of per-column aggregates over the
  // filtered rows. Empty object when off; react-data-grid still needs a row so
  // the picker cells render, so we always pass one row when showFooter is on.
  const footerRow = useMemo<SummaryRow>(
    () => (showFooter ? computeFooterRow(sortedRows, visibleCols, footerAgg) : {}),
    [showFooter, sortedRows, visibleCols, footerAgg],
  );
  // Footer bar renders on the flat grid only; the tree (grouped) grid's row model
  // does not support summary rows, so it always receives undefined.
  const bottomSummaryRows = showFooter && !grouping ? [footerRow] : undefined;

  const rowGrouper = useCallback(
    (rows: readonly GridRowData[], columnKey: string) => groupRowsByColumn(rows, columnKey),
    [],
  );

  // Top-level group ids (the first group-by column's keys). These open by
  // default; the user's collapses are remembered as a subtraction so new groups
  // (from edits/filtering) still open. Deeper nested levels are closed by default
  // and opened on demand — those opens live in `extraExpanded`.
  const topGroupIds = useMemo(
    () => (groupColumnId ? groupKeys(sortedRows, groupColumnId) : []),
    [sortedRows, groupColumnId],
  );
  const expandedGroupIds = useMemo(
    () => expandedGroupSet(topGroupIds, collapsedGroups, extraExpanded),
    [topGroupIds, collapsedGroups, extraExpanded],
  );
  const onExpandedGroupIdsChange = useCallback(
    (ids: Set<unknown>) => {
      // TreeDataGrid hands back the full expanded set (all levels); split it back
      // into the collapse/expand intents we track.
      const split = splitExpandedGroupIds(ids, topGroupIds);
      setCollapsedGroups(split.collapsedGroups);
      setExtraExpanded(split.extraExpanded);
    },
    [topGroupIds],
  );
  // Reset expansion intents when the group-by columns change so a new grouping
  // starts fully at its default (top open, deeper closed).
  const resetGroupExpansion = useCallback(() => {
    setCollapsedGroups(new Set());
    setExtraExpanded(new Set());
  }, []);

  const persistCell = useCallback(
    async (
      rowId: string,
      columnId: string,
      value: CellValue,
      prevValue: CellValue,
    ): Promise<boolean> => {
      setError(null);
      const res =
        source === "platform"
          ? await updatePlatformCellsAction(tableId, rowId, { [columnId]: value })
          : await updateCellsAction(tableId, rowId, { [columnId]: value });
      if (!res.ok) {
        setError(res.error);
        // Revert the optimistic edit so the grid doesn't show an unsaved value.
        setRowData((prev) =>
          prev.map((r) => (r.rowId === rowId ? { ...r, [columnId]: prevValue } : r)),
        );
        return false;
      }
      return true;
    },
    [tableId, source],
  );

  // Persist one field edited in the record modal, through the same validated
  // dispatch (+ optimistic update + undo history) as an in-grid edit.
  const onModalSave = useCallback(
    (columnId: string, value: CellValue) => {
      const rid = openRowId;
      if (!rid) return;
      const prevRow = rowData.find((r) => r.rowId === rid);
      const prevValue: CellValue = prevRow ? prevRow[columnId] ?? null : null;
      setRowData((prev) =>
        prev.map((r) => (r.rowId === rid ? { ...r, [columnId]: value } : r)),
      );
      void persistCell(rid, columnId, value, prevValue).then((ok) => {
        if (ok) {
          setHistory((h) => recordEdit(h, { rowId: rid, columnId, prevValue, nextValue: value }));
        }
      });
    },
    [openRowId, rowData, persistCell],
  );

  const onRowsChange = useCallback(
    (newRows: GridRowData[], data: RowsChangeData<GridRowData, SummaryRow>) => {
      // newRows are in sorted order; map back into the canonical rowData by rowId.
      const byId = new Map(newRows.map((r) => [r.rowId, r]));
      const columnId = data.column.key;
      for (const idx of data.indexes) {
        const changed = newRows[idx];
        if (!changed) continue;
        const prevRow = rowData.find((r) => r.rowId === changed.rowId);
        const prevValue: CellValue = prevRow ? prevRow[columnId] ?? null : null;
        const nextValue: CellValue = changed[columnId] ?? null;
        void persistCell(changed.rowId, columnId, nextValue, prevValue).then((ok) => {
          // Only a committed edit is undoable; a rejected one is already reverted.
          if (ok) {
            setHistory((h) => recordEdit(h, { rowId: changed.rowId, columnId, prevValue, nextValue }));
          }
        });
      }
      setRowData((prev) => prev.map((r) => byId.get(r.rowId) ?? r));
    },
    [persistCell, rowData],
  );

  // Single-cell copy/paste (Ctrl+C / Ctrl+V on the selected cell). Copy writes
  // the cell's display text to the clipboard; paste routes the new value back
  // through onRowsChange → persistCell, so it hits the same validation + optimistic
  // revert as a normal edit. Only editable cells accept a paste.
  // Map a react-data-grid column key to its index in the visible data columns
  // (-1 for leading select/drag/expand columns, which never anchor a range).
  const dataColIndex = useCallback(
    (key: string) => visibleCols.findIndex((c) => c.columnId === key),
    [visibleCols],
  );

  // Copy: a multi-cell range writes an Excel-compatible TSV block; a single cell
  // writes its text. Native clipboard event, so Ctrl+C round-trips with Excel.
  const onCellCopy = useCallback(
    ({ row, column }: CellCopyArgs<GridRowData, SummaryRow>, event: ReactClipboardEvent<HTMLDivElement>) => {
      if (range && isMultiCell(range)) {
        const rect = rangeRect(range);
        event.clipboardData.setData(
          "text/plain",
          rangeToTsv(rect, (r, c) =>
            cellSearchText(sortedRows[r]?.[visibleCols[c]?.columnId ?? ""] ?? null),
          ),
        );
      } else {
        event.clipboardData.setData("text/plain", cellSearchText(row[column.key] ?? null));
      }
    },
    [range, sortedRows, visibleCols],
  );

  // Paste: a 1×1 clipboard fills the selection; a TSV block lays out from the
  // selected cell (Excel behavior). Every written cell goes through the same
  // validated persistCell as a manual edit; the origin row is returned unchanged
  // because we persist it ourselves along with the rest of the block.
  const onCellPaste = useCallback(
    (
      { row, column }: CellPasteArgs<GridRowData, SummaryRow>,
      event: ReactClipboardEvent<HTMLDivElement>,
    ): GridRowData => {
      const originCol = dataColIndex(column.key);
      if (originCol < 0 || !capabilities.canEditCell) return row;
      const originRow = sortedRows.findIndex((r) => r.rowId === row.rowId);
      if (originRow < 0) return row;
      const block = parseTsv(event.clipboardData.getData("text/plain"));
      const targetRect = rangeRect(range ?? singleCell(originRow, originCol));
      const writes = pasteWrites(
        block,
        originRow,
        originCol,
        targetRect,
        sortedRows.length - 1,
        visibleCols.length - 1,
      );
      // Persist every written cell EXCEPT the origin ourselves; return the origin
      // updated so react-data-grid's own onRowsChange persists it (avoids the
      // origin being double-written / reverted to its old value).
      const originColId = visibleCols[originCol]?.columnId;
      let originValue: string | undefined;
      for (const w of writes) {
        if (w.row === originRow && w.col === originCol) {
          originValue = w.value;
          continue;
        }
        const gr = sortedRows[w.row];
        const cd = visibleCols[w.col];
        if (!gr || !cd?.editable) continue;
        void persistCell(gr.rowId, cd.columnId, w.value, gr[cd.columnId] ?? null);
      }
      return originValue !== undefined && originColId
        ? { ...row, [originColId]: originValue }
        : row;
    },
    [range, sortedRows, visibleCols, dataColIndex, capabilities.canEditCell, persistCell],
  );

  // Clear every editable cell in the range (Delete over a multi-cell selection).
  const clearRange = useCallback(
    (r: CellRange) => {
      const rect = rangeRect(r);
      for (let row = rect.top; row <= Math.min(rect.bottom, sortedRows.length - 1); row++) {
        const gr = sortedRows[row];
        if (!gr) continue;
        for (let col = rect.left; col <= Math.min(rect.right, visibleCols.length - 1); col++) {
          const cd = visibleCols[col];
          if (!cd?.editable) continue;
          const prev = gr[cd.columnId] ?? null;
          if (prev === null || prev === "") continue;
          void persistCell(gr.rowId, cd.columnId, null, prev);
        }
      }
    },
    [sortedRows, visibleCols, persistCell],
  );

  // Click a cell → start a range there; Shift+click → extend to it.
  const onCellClick = useCallback(
    (args: CellMouseArgs<GridRowData, SummaryRow>, event: CellMouseEvent) => {
      const col = dataColIndex(args.column.key);
      if (col < 0) return;
      if (event.shiftKey) {
        event.preventGridDefault();
        setRange((prev) =>
          prev ? { ...prev, focusRow: args.rowIdx, focusCol: col } : singleCell(args.rowIdx, col),
        );
      } else {
        setRange(singleCell(args.rowIdx, col));
      }
    },
    [dataColIndex],
  );

  // Arrow-key / click navigation collapses the range to the newly-active cell.
  const onSelectedCellChange = useCallback(
    (args: CellSelectArgs<GridRowData, SummaryRow>) => {
      const col = dataColIndex(args.column.key);
      if (col >= 0) setRange(singleCell(args.rowIdx, col));
    },
    [dataColIndex],
  );

  // Shift+Arrow extends the range; Delete clears a multi-cell selection. (Copy /
  // paste ride the native onCellCopy/onCellPaste above.)
  const onCellKeyDown = useCallback(
    (args: CellKeyDownArgs<GridRowData, SummaryRow>, event: CellKeyboardEvent) => {
      if (args.mode === "EDIT") return;
      const col = dataColIndex(args.column.key);
      if (col < 0) return;
      const cur = range ?? singleCell(args.rowIdx, col);
      const maxRow = sortedRows.length - 1;
      const maxCol = visibleCols.length - 1;
      const delta = event.shiftKey ? ARROW[event.key] : undefined;
      if (delta) {
        event.preventGridDefault();
        setRange(extendFocus(cur, delta[0], delta[1], maxRow, maxCol));
      } else if ((event.key === "Delete" || event.key === "Backspace") && isMultiCell(cur)) {
        event.preventGridDefault();
        clearRange(cur);
      }
    },
    [range, sortedRows, visibleCols, dataColIndex, clearRange],
  );

  // Replay a cell to a target value through the validated dispatch; on success
  // commit the stack transition. A failed persist leaves history unchanged
  // (persistCell already reverted the optimistic cell).
  const undo = useCallback(() => {
    const entry = peekUndo(history);
    if (!entry) return;
    setRowData((prev) =>
      prev.map((r) => (r.rowId === entry.rowId ? { ...r, [entry.columnId]: entry.prevValue } : r)),
    );
    void persistCell(entry.rowId, entry.columnId, entry.prevValue, entry.nextValue).then((ok) => {
      if (ok) setHistory((h) => commitUndo(h));
    });
  }, [history, persistCell]);

  const redo = useCallback(() => {
    const entry = peekRedo(history);
    if (!entry) return;
    setRowData((prev) =>
      prev.map((r) => (r.rowId === entry.rowId ? { ...r, [entry.columnId]: entry.nextValue } : r)),
    );
    void persistCell(entry.rowId, entry.columnId, entry.nextValue, entry.prevValue).then((ok) => {
      if (ok) setHistory((h) => commitRedo(h));
    });
  }, [history, persistCell]);

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (!capabilities.canEditCell) return;
      // Don't hijack a cell editor's own text undo while editing.
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (key === "y" || (key === "z" && e.shiftKey)) {
        e.preventDefault();
        redo();
      }
    },
    [capabilities.canEditCell, undo, redo],
  );

  const onAddRow = useCallback(async () => {
    setBusy(true);
    setError(null);
    const res = await createRowAction(tableId, {});
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const blank: GridRowData = { rowId: res.data.rowId };
    for (const c of columns) blank[c.columnId] = c.fieldType === "multi_select" ? [] : null;
    setRowData((prev) => [...prev, blank]);
  }, [tableId, columns]);

  const onDeleteSelected = useCallback(async () => {
    if (selectedRows.size === 0) return;
    setBusy(true);
    setError(null);
    const ids = [...selectedRows];
    for (const id of ids) {
      const res = await deleteRowAction(tableId, id);
      if (!res.ok) {
        setError(res.error);
        setBusy(false);
        return;
      }
    }
    setRowData((prev) => prev.filter((r) => !selectedRows.has(r.rowId)));
    setSelectedRows(new Set());
    setBusy(false);
  }, [tableId, selectedRows]);

  const onExportCsv = useCallback(() => {
    if (typeof document === "undefined") return;
    const csv = rowsToCsv(visibleCols, sortedRows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${tableId}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [columns, sortedRows, tableId]);

  return (
    <div className="flex h-full flex-col gap-2" onKeyDown={onKeyDown}>
      <div className="flex items-center gap-2">
        <input
          type="search"
          value={filterQuery}
          onChange={(e) => setFilterQuery(e.target.value)}
          placeholder="Filter…"
          aria-label="Filter rows"
          className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-1.5 text-sm text-[var(--dpf-text)]"
        />
        {filterQuery.trim() && (
          <span className="text-xs text-[var(--dpf-muted)]">
            {sortedRows.length} of {rowData.length}
          </span>
        )}
        {capabilities.canAddRow && (
          <button
            type="button"
            onClick={onAddRow}
            disabled={busy || columns.length === 0}
            className="rounded-md bg-[var(--dpf-accent)] px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            + Add row
          </button>
        )}
        {capabilities.canDeleteRow && selectedRows.size > 0 && (
          <button
            type="button"
            onClick={onDeleteSelected}
            disabled={busy}
            className="rounded-md border border-[var(--dpf-border)] px-3 py-1.5 text-sm text-[var(--dpf-error)]"
          >
            Delete {selectedRows.size} selected
          </button>
        )}
        {capabilities.canEditCell && (
          <>
            <button
              type="button"
              onClick={undo}
              disabled={history.undo.length === 0}
              className="rounded-md border border-[var(--dpf-border)] px-3 py-1.5 text-sm text-[var(--dpf-text)] disabled:opacity-40"
              title="Undo (Ctrl+Z)"
            >
              Undo
            </button>
            <button
              type="button"
              onClick={redo}
              disabled={history.redo.length === 0}
              className="rounded-md border border-[var(--dpf-border)] px-3 py-1.5 text-sm text-[var(--dpf-text)] disabled:opacity-40"
              title="Redo (Ctrl+Y)"
            >
              Redo
            </button>
          </>
        )}
        <div className="ml-auto">
          <GridViewsMenu
            views={views}
            activeViewId={activeViewId}
            shared={serverBacked}
            onApply={handleApplyView}
            onSaveAs={handleSaveView}
            onDelete={handleDeleteView}
            onSetDefault={handleSetDefaultView}
          />
        </div>
        <button
          type="button"
          onClick={onExportCsv}
          disabled={columns.length === 0}
          className="inline-flex items-center gap-1.5 rounded-md border border-[var(--dpf-border)] px-3 py-1.5 text-sm text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] disabled:opacity-40"
          title="Export the current view to CSV"
        >
          <Download size={15} aria-hidden />
          Export CSV
        </button>
        <button
          type="button"
          onClick={() => setShowFilters((v) => !v)}
          aria-pressed={showFilters}
          className="inline-flex items-center gap-1.5 rounded-md border border-[var(--dpf-border)] px-3 py-1.5 text-sm text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] aria-pressed:text-[var(--dpf-text)]"
          title="Filter by column"
        >
          <Filter size={15} aria-hidden />
          {showFilters ? "Hide filters" : "Filters"}
          {activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
        </button>
        <button
          type="button"
          onClick={() => setShowFormat((v) => !v)}
          aria-pressed={showFormat}
          className="inline-flex items-center gap-1.5 rounded-md border border-[var(--dpf-border)] px-3 py-1.5 text-sm text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] aria-pressed:text-[var(--dpf-text)]"
          title="Highlight rows by a condition"
        >
          <Palette size={15} aria-hidden />
          {showFormat ? "Hide formatting" : "Format"}
          {cfRules.length > 0 ? ` (${cfRules.length})` : ""}
        </button>
        <button
          type="button"
          onClick={() => setShowSummary((v) => !v)}
          aria-pressed={showSummary}
          className="inline-flex items-center gap-1.5 rounded-md border border-[var(--dpf-border)] px-3 py-1.5 text-sm text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] aria-pressed:text-[var(--dpf-text)]"
          title="Summarize / pivot the rows into a report"
        >
          <BarChart3 size={15} aria-hidden />
          {showSummary ? "Hide summary" : "Summary"}
        </button>
        <button
          type="button"
          onClick={() => setShowGroup((v) => !v)}
          aria-pressed={showGroup}
          className="inline-flex items-center gap-1.5 rounded-md border border-[var(--dpf-border)] px-3 py-1.5 text-sm text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] aria-pressed:text-[var(--dpf-text)]"
          title="Collapse the rows themselves into groups by a column"
        >
          <Layers size={15} aria-hidden />
          {showGroup ? "Hide grouping" : "Group"}
          {groupColumnId ? ` (1)` : ""}
        </button>
        <button
          type="button"
          onClick={() => setShowColumns((v) => !v)}
          aria-pressed={showColumns}
          className="inline-flex items-center gap-1.5 rounded-md border border-[var(--dpf-border)] px-3 py-1.5 text-sm text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] aria-pressed:text-[var(--dpf-text)]"
          title="Hide fields, pin columns, and set row height"
        >
          <SlidersHorizontal size={15} aria-hidden />
          {showColumns ? "Hide options" : "Columns"}
          {hiddenColumns.length > 0 ? ` (${hiddenColumns.length} hidden)` : ""}
        </button>
        <button
          type="button"
          onClick={() => setShowProvenance((v) => !v)}
          aria-pressed={showProvenance}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-[var(--dpf-border)] px-3 py-1.5 text-sm text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] aria-pressed:text-[var(--dpf-text)]"
          title="Show where each column's values come from"
        >
          <Info size={15} aria-hidden />
          {showProvenance ? "Hide data sources" : "Show data sources"}
        </button>
        <div className="inline-flex overflow-hidden rounded-md border border-[var(--dpf-border)] text-sm">
          {(hasDateColumn
            ? (["grid", "gallery", "calendar"] as const)
            : (["grid", "gallery"] as const)
          ).map((m) => {
            const ModeIcon = m === "grid" ? TableIcon : m === "gallery" ? LayoutGrid : CalendarIcon;
            return (
              <button
                key={m}
                type="button"
                onClick={() => setViewMode(m)}
                className={
                  viewMode === m
                    ? "inline-flex items-center gap-1 bg-[var(--dpf-surface-1)] px-2 py-1 font-medium capitalize text-[var(--dpf-text)]"
                    : "inline-flex items-center gap-1 px-2 py-1 capitalize text-[var(--dpf-muted)]"
                }
              >
                <ModeIcon size={14} aria-hidden />
                {m}
              </button>
            );
          })}
        </div>
        {error && <span className="text-sm text-[var(--dpf-error)]">{error}</span>}
      </div>

      {showFilters && columns.length > 0 && (
        <GridFilterPanel
          columns={columns}
          filterGroup={filterGroup}
          setFilterGroup={setFilterGroup}
          fcIdRef={fcIdRef}
        />
      )}

      {showFormat && columns.length > 0 && (
        <GridFormatPanel columns={columns} cfRules={cfRules} setCfRules={setCfRules} cfIdRef={cfIdRef} />
      )}

      {showSummary && columns.length > 0 && (
        <GridSummaryPanel
          columns={columns}
          sortedRows={sortedRows}
          summaryGroupBy={summaryGroupBy}
          setSummaryGroupBy={setSummaryGroupBy}
          summaryValue={summaryValue}
          setSummaryValue={setSummaryValue}
          summaryMode={summaryMode}
          setSummaryMode={setSummaryMode}
          summaryPivotCol={summaryPivotCol}
          setSummaryPivotCol={setSummaryPivotCol}
          summaryAgg={summaryAgg}
          setSummaryAgg={setSummaryAgg}
        />
      )}

      {showGroup && columns.length > 0 && (
        <GridGroupPanel
          columns={columns}
          effectiveGroupBy={effectiveGroupBy}
          setGroupBy={setGroupBy}
          resetGroupExpansion={resetGroupExpansion}
          grouping={grouping}
          topGroupIds={topGroupIds}
          setCollapsedGroups={setCollapsedGroups}
          setExtraExpanded={setExtraExpanded}
          visibleCols={visibleCols}
          footerAgg={footerAgg}
          setFooterAgg={setFooterAgg}
        />
      )}

      {showColumns && columns.length > 0 && (
        <GridColumnsPanel
          orderedColumns={orderedColumns}
          visibleColsCount={visibleCols.length}
          rowHeight={rowHeight}
          setRowHeight={setRowHeight}
          effectiveFrozen={effectiveFrozen}
          setFrozenCount={setFrozenCount}
          showFooter={showFooter}
          setShowFooter={setShowFooter}
          hiddenColumns={hiddenColumns}
          setHiddenColumns={setHiddenColumns}
        />
      )}

      {columns.length === 0 ? (
        <div className="rounded-md border border-dashed border-[var(--dpf-border)] p-8 text-center text-[var(--dpf-muted)]">
          This table has no columns yet. Add a column to start entering data.
        </div>
      ) : viewMode === "calendar" && hasDateColumn ? (
        <GridCalendar rows={sortedRows} columns={visibleCols} onOpenRow={setOpenRowId} />
      ) : gallery ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3 p-1">
            {sortedRows.map((row) => {
              const color = rowColor(row, cfRules);
              return (
                <div
                  key={row.rowId}
                  className={`dpf-gallery-card rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3 ${
                    color ? rowColorClass(color) : ""
                  }`}
                >
                  <dl className="flex flex-col gap-1">
                    {visibleCols.map((col) => (
                      <div key={col.columnId} className="flex justify-between gap-2 text-sm">
                        <dt className="shrink-0 text-[var(--dpf-muted)]">{col.name}</dt>
                        <dd className="truncate text-right text-[var(--dpf-text)]" title={cellSearchText(row[col.columnId] ?? null)}>
                          {cellSearchText(row[col.columnId] ?? null)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              );
            })}
            {sortedRows.length === 0 && (
              <div className="text-sm text-[var(--dpf-muted)]">No rows.</div>
            )}
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1">
          {grouping ? (
            <TreeDataGrid
              className="dpf-workbook-grid"
              columns={gridColumns}
              rows={sortedRows}
              rowKeyGetter={(row) => row.rowId}
              onRowsChange={onRowsChange}
              onCellCopy={onCellCopy}
              onCellPaste={onCellPaste}
              sortColumns={sortColumns}
              onSortColumnsChange={setSortColumns}
              selectedRows={selectedRows}
              onSelectedRowsChange={setSelectedRows}
              onColumnsReorder={onColumnsReorder}
              groupBy={effectiveGroupBy}
              rowGrouper={rowGrouper}
              expandedGroupIds={expandedGroupIds}
              onExpandedGroupIdsChange={onExpandedGroupIdsChange}
              rowClass={(row) => {
                const color = rowColor(row, cfRules);
                return color ? rowColorClass(color) : undefined;
              }}
              rowHeight={rowHeightPx(rowHeight)}
              bottomSummaryRows={bottomSummaryRows}
              defaultColumnOptions={{ resizable: true, sortable: true }}
            />
          ) : (
            <DataGrid
              className="dpf-workbook-grid"
              columns={gridColumns}
              rows={sortedRows}
              rowKeyGetter={(row) => row.rowId}
              onRowsChange={onRowsChange}
              onCellCopy={onCellCopy}
              onCellPaste={onCellPaste}
              onCellClick={onCellClick}
              onSelectedCellChange={onSelectedCellChange}
              onCellKeyDown={onCellKeyDown}
              sortColumns={sortColumns}
              onSortColumnsChange={setSortColumns}
              selectedRows={selectedRows}
              onSelectedRowsChange={setSelectedRows}
              onColumnsReorder={onColumnsReorder}
              rowClass={(row) => {
                const color = rowColor(row, cfRules);
                return color ? rowColorClass(color) : undefined;
              }}
              rowHeight={rowHeightPx(rowHeight)}
              bottomSummaryRows={bottomSummaryRows}
              defaultColumnOptions={{ resizable: true, sortable: true }}
            />
          )}
        </div>
      )}

      {openRowId &&
        (() => {
          const openRow = rowData.find((r) => r.rowId === openRowId);
          return openRow ? (
            <RecordDetailModal
              row={openRow}
              columns={columns}
              canEdit={capabilities.canEditCell}
              onClose={() => setOpenRowId(null)}
              onSave={onModalSave}
            />
          ) : null;
        })()}
    </div>
  );
}
