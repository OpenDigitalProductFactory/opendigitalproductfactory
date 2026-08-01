// Universal Grid & Workbooks — Invoice grid mapping (EP-GRID-WORKBOOKS, Phase 1c)
// Pure (no server imports) column schema + row mapping for the Finance invoice grid.

import { INVOICE_STATUSES } from "@/lib/finance/finance-validation";
import type { ColumnDefinition, GridRow } from "./types";
import { toOptions } from "./option-helpers";

export const INVOICE_ENTITY_TYPE = "invoice";

/**
 * Invoice grid columns. Only `status` is editable in the grid (it routes through
 * the validated updateInvoiceStatus action); amounts/dates/refs are read-only —
 * editing those belongs to the invoice form / line-item flow.
 */
export const INVOICE_COLUMNS: ColumnDefinition[] = [
  { columnId: "invoiceRef", name: "Invoice", fieldType: "text", position: 0, required: false, editable: false, width: 150 },
  {
    columnId: "status",
    name: "Status",
    fieldType: "select",
    position: 1,
    required: true,
    editable: true,
    width: 150,
    groupable: true,
    config: { options: toOptions(INVOICE_STATUSES) },
  },
  { columnId: "account", name: "Account", fieldType: "text", position: 2, required: false, editable: false, width: 220 },
  { columnId: "totalAmount", name: "Total", fieldType: "number", position: 3, required: false, editable: false, width: 120 },
  { columnId: "amountDue", name: "Due", fieldType: "number", position: 4, required: false, editable: false, width: 120 },
  { columnId: "currency", name: "Currency", fieldType: "text", position: 5, required: false, editable: false, width: 90 },
  { columnId: "issueDate", name: "Issued", fieldType: "date", position: 6, required: false, editable: false, width: 130 },
  { columnId: "dueDate", name: "Due date", fieldType: "date", position: 7, required: false, editable: true, width: 130 },
  { columnId: "type", name: "Type", fieldType: "text", position: 8, required: false, editable: false, width: 130 },
];

export interface InvoicePlain {
  invoiceRef: string;
  status: string;
  accountName: string | null;
  totalAmount: number;
  amountDue: number;
  currency: string;
  issueDate: Date;
  dueDate: Date;
  type: string;
}

export function invoiceToGridRow(item: InvoicePlain): GridRow {
  return {
    rowId: item.invoiceRef,
    cells: {
      invoiceRef: item.invoiceRef,
      status: item.status,
      account: item.accountName,
      totalAmount: item.totalAmount,
      amountDue: item.amountDue,
      currency: item.currency,
      issueDate: item.issueDate.toISOString(),
      dueDate: item.dueDate.toISOString(),
      type: item.type,
    },
  };
}
