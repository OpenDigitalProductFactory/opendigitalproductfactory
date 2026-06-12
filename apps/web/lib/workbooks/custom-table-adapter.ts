// Universal Grid & Workbooks — CustomTableAdapter (EP-GRID-WORKBOOKS)
//
// The dataSource="custom" adapter: reads/writes user-defined rows stored EAV-style
// in WorkbookRow/WorkbookCell. All adapter methods operate on the internal
// WorkbookTable.id (cuid); the server/API/MCP layers resolve semantic TBL-* ids
// to internal ids before calling in. GridRow.cells are keyed by the semantic
// columnId (COL-*) so the UI/API/MCP share one stable key.

import { prisma } from "@dpf/db";
import {
  gridRegistry,
  type DataSourceAdapter,
  type AdapterContext,
} from "./adapter";
import {
  type ColumnDefinition,
  type GridRow,
  type CellValue,
  type FieldType,
  type FieldConfig,
  type ReferenceValue,
  type DataSourceFilter,
  type SortSpec,
  type Pagination,
  type PagedRows,
  type GridCapabilities,
} from "./types";
import {
  validateCell,
  storageToCellValue,
  type CellStorage,
} from "./cell-validation";
import { applyFilters, applySort, paginate } from "./grid-query";
import { resolveReferenceLabels, referenceKey } from "./reference-resolver";
import { genSemanticId } from "./ids";

function asReference(value: CellValue): ReferenceValue | null {
  if (value && typeof value === "object" && !Array.isArray(value) && "referenceId" in value) {
    return value as ReferenceValue;
  }
  return null;
}

/** Hydrate live display labels for every reference cell (labels are not persisted). */
async function hydrateReferenceLabels(rows: GridRow[]): Promise<void> {
  const refs: { referenceType: string; referenceId: string }[] = [];
  for (const row of rows) {
    for (const value of Object.values(row.cells)) {
      const ref = asReference(value);
      if (ref?.referenceId && ref.referenceType) {
        refs.push({ referenceType: ref.referenceType, referenceId: ref.referenceId });
      }
    }
  }
  if (refs.length === 0) return;
  const labels = await resolveReferenceLabels(refs);
  for (const row of rows) {
    for (const [colId, value] of Object.entries(row.cells)) {
      const ref = asReference(value);
      if (!ref?.referenceId || !ref.referenceType) continue;
      const label = labels.get(referenceKey(ref.referenceType, ref.referenceId));
      if (label) row.cells[colId] = { ...ref, label };
    }
  }
}

interface ColumnMeta {
  internalId: string;
  columnId: string; // semantic COL-*
  name: string;
  fieldType: FieldType;
  required: boolean;
  config: FieldConfig | undefined;
}

async function loadColumnMeta(internalTableId: string): Promise<ColumnMeta[]> {
  const cols = await prisma.workbookColumn.findMany({
    where: { tableId: internalTableId },
    orderBy: { position: "asc" },
  });
  return cols.map((c) => ({
    internalId: c.id,
    columnId: c.columnId,
    name: c.name,
    fieldType: c.fieldType as FieldType,
    required: c.required,
    config: (c.fieldConfig as FieldConfig | null) ?? undefined,
  }));
}

function toColumnDefinition(meta: ColumnMeta, position: number, width: number | null): ColumnDefinition {
  return {
    columnId: meta.columnId,
    name: meta.name,
    fieldType: meta.fieldType,
    position,
    required: meta.required,
    width: width ?? undefined,
    config: meta.config,
    editable: true,
    groupable: meta.fieldType === "select",
  };
}

/** Storage object -> the Prisma update/create payload (only cell scalar fields). */
function storagePayload(storage: CellStorage) {
  return {
    textValue: storage.textValue,
    numberValue: storage.numberValue,
    dateValue: storage.dateValue,
    boolValue: storage.boolValue,
    selectValue: storage.selectValue,
    multiSelectValue: storage.multiSelectValue,
    referenceId: storage.referenceId,
    referenceType: storage.referenceType,
  };
}

class CustomTableAdapter implements DataSourceAdapter {
  readonly entityType = "custom";

  async getColumns(internalTableId: string): Promise<ColumnDefinition[]> {
    const cols = await prisma.workbookColumn.findMany({
      where: { tableId: internalTableId },
      orderBy: { position: "asc" },
    });
    return cols.map((c, i) =>
      toColumnDefinition(
        {
          internalId: c.id,
          columnId: c.columnId,
          name: c.name,
          fieldType: c.fieldType as FieldType,
          required: c.required,
          config: (c.fieldConfig as FieldConfig | null) ?? undefined,
        },
        c.position ?? i,
        c.width,
      ),
    );
  }

  private async materializeRows(internalTableId: string): Promise<GridRow[]> {
    const metas = await loadColumnMeta(internalTableId);
    const byInternal = new Map(metas.map((m) => [m.internalId, m]));
    const rows = await prisma.workbookRow.findMany({
      where: { tableId: internalTableId },
      orderBy: { position: "asc" },
      include: { cells: true },
    });
    const gridRows = rows.map((row) => {
      const cells: Record<string, CellValue> = {};
      // default every column to null so the grid renders empty cells
      for (const m of metas) cells[m.columnId] = m.fieldType === "multi_select" ? [] : null;
      for (const cell of row.cells) {
        const meta = byInternal.get(cell.columnId);
        if (!meta) continue;
        cells[meta.columnId] = storageToCellValue(meta.fieldType, cell);
      }
      return { rowId: row.rowId, cells };
    });
    await hydrateReferenceLabels(gridRows);
    return gridRows;
  }

  async queryRows(
    internalTableId: string,
    opts: { filters: DataSourceFilter; sort: SortSpec[]; pagination: Pagination },
  ): Promise<PagedRows> {
    const all = await this.materializeRows(internalTableId);
    const filtered = applyFilters(all, opts.filters);
    const sorted = applySort(filtered, opts.sort);
    return paginate(sorted, opts.pagination.cursor, opts.pagination.limit);
  }

  async getRow(internalTableId: string, rowId: string): Promise<GridRow | null> {
    const all = await this.materializeRows(internalTableId);
    return all.find((r) => r.rowId === rowId) ?? null;
  }

  async createRow(
    internalTableId: string,
    input: Record<string, CellValue>,
    ctx: AdapterContext,
  ): Promise<GridRow> {
    const metas = await loadColumnMeta(internalTableId);

    // Validate every column (required checks included, even if absent from input).
    const writes: { internalColumnId: string; storage: CellStorage }[] = [];
    for (const meta of metas) {
      const value = meta.columnId in input ? input[meta.columnId] : null;
      const result = validateCell(meta, value);
      if (!result.ok) throw new Error(result.error);
      writes.push({ internalColumnId: meta.internalId, storage: result.storage });
    }

    const maxPos = await prisma.workbookRow.aggregate({
      where: { tableId: internalTableId },
      _max: { position: true },
    });

    const row = await prisma.workbookRow.create({
      data: {
        rowId: genSemanticId("ROW"),
        tableId: internalTableId,
        position: (maxPos._max.position ?? -1) + 1,
        createdById: ctx.userId,
        cells: {
          create: writes.map((w) => ({
            columnId: w.internalColumnId,
            ...storagePayload(w.storage),
          })),
        },
      },
    });

    const created = await this.getRow(internalTableId, row.rowId);
    if (!created) throw new Error("Row created but could not be read back");
    return created;
  }

  async updateCells(
    internalTableId: string,
    rowId: string,
    changes: Record<string, CellValue>,
    _ctx: AdapterContext,
  ): Promise<GridRow> {
    const metas = await loadColumnMeta(internalTableId);
    const bySemantic = new Map(metas.map((m) => [m.columnId, m]));
    const row = await prisma.workbookRow.findUnique({ where: { rowId } });
    if (!row || row.tableId !== internalTableId) {
      throw new Error("Row not found");
    }

    await prisma.$transaction(async (tx) => {
      for (const [semanticColId, value] of Object.entries(changes)) {
        const meta = bySemantic.get(semanticColId);
        if (!meta) throw new Error(`Unknown column: ${semanticColId}`);
        const result = validateCell(meta, value);
        if (!result.ok) throw new Error(result.error);
        await tx.workbookCell.upsert({
          where: { rowId_columnId: { rowId: row.id, columnId: meta.internalId } },
          create: {
            rowId: row.id,
            columnId: meta.internalId,
            ...storagePayload(result.storage),
          },
          update: storagePayload(result.storage),
        });
      }
      await tx.workbookRow.update({
        where: { id: row.id },
        data: { updatedAt: new Date() },
      });
    });

    const updated = await this.getRow(internalTableId, rowId);
    if (!updated) throw new Error("Row updated but could not be read back");
    return updated;
  }

  async deleteRow(internalTableId: string, rowId: string, _ctx: AdapterContext): Promise<void> {
    const row = await prisma.workbookRow.findUnique({ where: { rowId } });
    if (!row || row.tableId !== internalTableId) throw new Error("Row not found");
    await prisma.workbookRow.delete({ where: { id: row.id } });
  }

  getCapabilities(ctx: AdapterContext): GridCapabilities {
    const canWrite = ctx.workbookRole === "owner" || ctx.workbookRole === "editor";
    return {
      canAddRow: canWrite,
      canAddColumn: canWrite,
      canEditCell: canWrite,
      canDeleteRow: canWrite,
    };
  }
}

export const customTableAdapter = new CustomTableAdapter();

// Self-register on module load.
gridRegistry.register(customTableAdapter);
