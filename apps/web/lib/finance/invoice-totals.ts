/**
 * Invoice money arithmetic, in one place.
 *
 * createInvoice owned this inline. Once editing could also rewrite line items,
 * a second copy would have been two implementations of "what does this invoice
 * total" — the exact drift that makes an edited invoice disagree with the PDF a
 * customer already holds. Both callers go through here instead.
 */

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface LineItemTotals {
  lineSubtotal: number;
  lineDiscount: number;
  lineAfterDiscount: number;
  lineTax: number;
  lineTotal: number;
}

export function calcLineItem(
  quantity: number,
  unitPrice: number,
  taxRate: number,
  discountPercent: number,
): LineItemTotals {
  const lineSubtotal = round2(quantity * unitPrice);
  const lineDiscount = round2(lineSubtotal * (discountPercent / 100));
  const lineAfterDiscount = round2(lineSubtotal - lineDiscount);
  const lineTax = round2(lineAfterDiscount * (taxRate / 100));
  const lineTotal = round2(lineAfterDiscount + lineTax);
  return { lineSubtotal, lineDiscount, lineAfterDiscount, lineTax, lineTotal };
}

export interface InvoiceLineItemInput {
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate?: number;
  discountPercent?: number;
  accountCode?: string;
}

export interface InvoiceLineItemRow {
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  taxAmount: number;
  discountPercent: number;
  lineTotal: number;
  accountCode: string | null;
  sortOrder: number;
}

export interface InvoiceTotals {
  lineItemsData: InvoiceLineItemRow[];
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
}

/**
 * Turn a line-item input array into persistable rows plus the invoice-level
 * totals they imply. Rounding is applied per running total (not once at the end)
 * so the stored header always equals the sum of the stored lines.
 */
export function buildInvoiceTotals(lineItems: readonly InvoiceLineItemInput[]): InvoiceTotals {
  let subtotal = 0;
  let discountAmount = 0;
  let taxAmount = 0;
  let totalAmount = 0;

  const lineItemsData = lineItems.map((item, idx) => {
    const { lineSubtotal, lineDiscount, lineTax, lineTotal } = calcLineItem(
      item.quantity,
      item.unitPrice,
      item.taxRate ?? 0,
      item.discountPercent ?? 0,
    );

    subtotal = round2(subtotal + lineSubtotal);
    discountAmount = round2(discountAmount + lineDiscount);
    taxAmount = round2(taxAmount + lineTax);
    totalAmount = round2(totalAmount + lineTotal);

    return {
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      taxRate: item.taxRate ?? 0,
      taxAmount: lineTax,
      discountPercent: item.discountPercent ?? 0,
      lineTotal,
      accountCode: item.accountCode ?? null,
      sortOrder: idx,
    };
  });

  return { lineItemsData, subtotal, discountAmount, taxAmount, totalAmount };
}
