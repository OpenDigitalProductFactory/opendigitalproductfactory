// Universal Grid & Workbooks — InvoiceAdapter (EP-GRID-WORKBOOKS, Phase 1c)
// Finance invoices as a grid. Status edits route through the canonical
// updateInvoiceStatus action (enforces manage_finance, the transition map, and
// status timestamps); the non-economic fields route through updateInvoice, which
// enforces the same edit-scope rule the invoice surface uses. Amounts and line
// items stay read-only here. No raw prisma writes.

import { prisma } from "@dpf/db";
import { updateInvoice, updateInvoiceStatus } from "@/lib/actions/finance";
import { POST_DRAFT_EDITABLE_FIELDS } from "@/lib/finance/invoice-lifecycle";
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

    // The grid edits the same safe field set an invoice exposes after it has been
    // sent: status plus the fields carrying no economic claim. Amounts and line
    // items stay off the grid entirely — they are edited on the invoice itself,
    // where the totals recompute and the operator can see what changed.
    const GRID_EDITABLE = new Set<string>(["status", ...POST_DRAFT_EDITABLE_FIELDS]);
    const keys = Object.keys(changes);
    const rejected = keys.filter((k) => !GRID_EDITABLE.has(k));
    if (rejected.length > 0) {
      throw new Error(
        `Cannot edit ${rejected.join(", ")} from the grid. Editable here: ${[...GRID_EDITABLE].join(", ")}. ` +
          `Amounts and line items are edited on the invoice itself.`,
      );
    }

    const contentKeys = keys.filter((k) => k !== "status");
    if (contentKeys.length > 0) {
      const content: Record<string, unknown> = {};
      for (const k of contentKeys) content[k] = changes[k];
      const result = await updateInvoice(inv.id, content as Parameters<typeof updateInvoice>[1]);
      if (!result.ok) throw new Error(result.message);
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
