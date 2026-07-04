// lib/finance/po-match-service.ts — DB read for PO ↔ bill matching (SAP MM verification)
//
// Loads a bill and the purchase order it was raised from and runs the pure two-way
// match (./po-match). Read-only; the accounting decision (flag / require approval)
// stays with the caller.

import { prisma } from "@dpf/db";
import {
  matchBillToPurchaseOrder,
  type BillPoMatch,
  type MatchTolerance,
} from "./po-match";

export type BillMatchResult =
  | { hasPurchaseOrder: false }
  | { hasPurchaseOrder: true; poNumber: string; match: BillPoMatch };

/**
 * Match a bill against its linked purchase order. Returns `hasPurchaseOrder: false`
 * when the bill was not raised from a PO (nothing to verify against).
 */
export async function getBillPoMatch(
  billId: string,
  tolerance?: MatchTolerance,
): Promise<BillMatchResult> {
  const bill = await prisma.bill.findUnique({
    where: { id: billId },
    select: {
      subtotal: true,
      taxAmount: true,
      totalAmount: true,
      purchaseOrder: {
        select: { poNumber: true, subtotal: true, taxAmount: true, totalAmount: true },
      },
    },
  });
  if (!bill || !bill.purchaseOrder) return { hasPurchaseOrder: false };

  const match = matchBillToPurchaseOrder(
    {
      subtotal: Number(bill.subtotal),
      taxAmount: Number(bill.taxAmount),
      totalAmount: Number(bill.totalAmount),
    },
    {
      subtotal: Number(bill.purchaseOrder.subtotal),
      taxAmount: Number(bill.purchaseOrder.taxAmount),
      totalAmount: Number(bill.purchaseOrder.totalAmount),
    },
    tolerance,
  );
  return { hasPurchaseOrder: true, poNumber: bill.purchaseOrder.poNumber, match };
}
