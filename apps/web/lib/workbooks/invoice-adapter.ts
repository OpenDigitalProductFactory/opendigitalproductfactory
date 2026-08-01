// Universal Grid & Workbooks — InvoiceAdapter (EP-GRID-WORKBOOKS, Phase 1c)
// Finance invoices as a grid. Status edits route through the canonical
// updateInvoiceStatus action (enforces manage_finance + status timestamps);
// other fields are read-only here. No raw prisma writes.

import { prisma } from "@dpf/db";
import { updateInvoiceStatus } from "@/lib/actions/finance";
import {
  gridRegistry,
  type DataSourceAdapter,
  type AdapterContext,
} from "./adapter";
import {
  INVOICE_ENTITY_TYPE,
  INVOICE_COLUMNS,
  invoiceToGridRow,
  type InvoicePlain,
} from "./invoice-adapter-mapping";
import {
  type ColumnDefinition,
  type GridRow,
  type CellValue,
  type DataSourceFilter,
  type SortSpec,
  type Pagination,
  type PagedRows,
  type GridCapabilities,
} from "./types";
import { applyFilters, applySort, paginate } from "./grid-query";

function decimalToNumber(d: unknown): number {
  if (d == null) return 0;
  return Number((d as { toString(): string }).toString());
}

const INVOICE_SELECT = {
  invoiceRef: true,
  status: true,
  totalAmount: true,
  amountDue: true,
  currency: true,
  issueDate: true,
  dueDate: true,
  type: true,
  account: { select: { name: true } },
} as const;

function toPlain(inv: {
  invoiceRef: string;
  status: string;
  totalAmount: unknown;
  amountDue: unknown;
  currency: string;
  issueDate: Date;
  dueDate: Date;
  type: string;
  account: { name: string } | null;
}): InvoicePlain {
  return {
    invoiceRef: inv.invoiceRef,
    status: inv.status,
    accountName: inv.account?.name ?? null,
    totalAmount: decimalToNumber(inv.totalAmount),
    amountDue: decimalToNumber(inv.amountDue),
    currency: inv.currency,
    issueDate: inv.issueDate,
    dueDate: inv.dueDate,
    type: inv.type,
  };
}

class InvoiceAdapter implements DataSourceAdapter {
  readonly entityType = INVOICE_ENTITY_TYPE;

  async getColumns(): Promise<ColumnDefinition[]> {
    return INVOICE_COLUMNS.map((c) => ({ ...c, provenanceKind: "system" as const }));
  }

  async queryRows(
    _entityType: string,
    opts: { filters: DataSourceFilter; sort: SortSpec[]; pagination: Pagination },
  ): Promise<PagedRows> {
    const invoices = await prisma.invoice.findMany({
      orderBy: { createdAt: "desc" },
      select: INVOICE_SELECT,
    });
    const rows = invoices.map((i) => invoiceToGridRow(toPlain(i)));
    const filtered = applyFilters(rows, opts.filters);
    const sorted = applySort(filtered, opts.sort);
    return paginate(sorted, opts.pagination.cursor, opts.pagination.limit);
  }

  async getRow(_entityType: string, rowId: string): Promise<GridRow | null> {
    const inv = await prisma.invoice.findUnique({ where: { invoiceRef: rowId }, select: INVOICE_SELECT });
    return inv ? invoiceToGridRow(toPlain(inv)) : null;
  }

  async updateCells(
    _entityType: string,
    rowId: string,
    changes: Record<string, CellValue>,
    _ctx: AdapterContext,
  ): Promise<GridRow> {
    const inv = await prisma.invoice.findUnique({ where: { invoiceRef: rowId }, select: { id: true } });
    if (!inv) throw new Error("Invoice not found");

    const keys = Object.keys(changes);
    const nonStatus = keys.filter((k) => k !== "status");
    if (nonStatus.length > 0) {
      throw new Error("Only status is editable for invoices from the grid");
    }
    if ("status" in changes) {
      const status = changes.status;
      if (typeof status !== "string") throw new Error("Invalid invoice status");
      // updateInvoiceStatus enforces manage_finance, the transition map, and
      // status-driven timestamps. Surface its rejection rather than reporting
      // a successful edit the grid never actually made.
      const result = await updateInvoiceStatus(
        inv.id,
        status as Parameters<typeof updateInvoiceStatus>[1],
      );
      if (!result.ok) throw new Error(result.message);
    }

    const updated = await this.getRow(_entityType, rowId);
    if (!updated) throw new Error("Invoice updated but could not be read back");
    return updated;
  }

  getCapabilities(ctx: AdapterContext): GridCapabilities {
    return {
      canAddRow: false,
      canAddColumn: false,
      canEditCell: ctx.canManage === true,
      canDeleteRow: false,
    };
  }
}

export const invoiceAdapter = new InvoiceAdapter();
gridRegistry.register(invoiceAdapter);
