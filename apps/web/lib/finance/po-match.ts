// lib/finance/po-match.ts — purchase-order ↔ bill matching (SAP MM invoice verification)
//
// The AP-integrity control SAP calls invoice verification: before a supplier bill is
// paid, check it against the purchase order it was raised from, so you never pay more
// than you agreed to buy. DPF has PurchaseOrder + Bill (Bill.purchaseOrderId links
// them) but no goods-receipt record, so this is a **two-way match** (PO ↔ Bill) with a
// tolerance; a full three-way match (adding goods receipt) is a follow-up once a
// GoodsReceipt model exists.
//
// Pure and DB-free so the whole comparison is unit-testable; the DB read that loads a
// bill and its PO lives in apps/web/lib/finance/po-match-service.ts.

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** How far a bill may diverge from its PO before it needs review. */
export type MatchTolerance = {
  /** Absolute currency amount always allowed (covers rounding, small fees). */
  absolute: number;
  /** Percentage of the PO total also allowed; the larger of the two applies. */
  percent: number;
};

/** Default: the greater of 1 currency unit or 2% of the PO total. */
export const DEFAULT_MATCH_TOLERANCE: MatchTolerance = { absolute: 1, percent: 2 };

/** The minimal document shape the match needs (a bill or a purchase order). */
export type MatchDocument = {
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
};

export type MatchStatus = "matched" | "over" | "under";

export type BillPoMatch = {
  /** True when the bill is within tolerance of the PO. */
  matched: boolean;
  status: MatchStatus;
  poTotal: number;
  billTotal: number;
  /** bill − PO. Positive means the supplier billed MORE than was ordered. */
  variance: number;
  variancePct: number;
  /** The absolute tolerance actually applied (the larger of absolute / percent). */
  toleranceAmount: number;
  /** Plain-language verdict for the approver / finance coworker. */
  message: string;
};

/**
 * Two-way match a supplier bill against its purchase order on the header total.
 * `matched` is true when |bill − PO| is within tolerance (the greater of the
 * absolute allowance and `percent`% of the PO). An over-tolerance bill is flagged
 * `over` (billed more than ordered — the case that protects cash) or `under`.
 */
export function matchBillToPurchaseOrder(
  bill: MatchDocument,
  po: MatchDocument,
  tolerance: MatchTolerance = DEFAULT_MATCH_TOLERANCE,
): BillPoMatch {
  const billTotal = round2(bill.totalAmount);
  const poTotal = round2(po.totalAmount);
  const variance = round2(billTotal - poTotal);
  const variancePct =
    poTotal !== 0 ? round2((variance / Math.abs(poTotal)) * 100) : billTotal === 0 ? 0 : 100;

  const toleranceAmount = round2(
    Math.max(Math.max(tolerance.absolute, 0), (Math.abs(poTotal) * Math.max(tolerance.percent, 0)) / 100),
  );
  const matched = Math.abs(variance) <= toleranceAmount + 1e-9;
  const status: MatchStatus = matched ? "matched" : variance > 0 ? "over" : "under";

  const message = matched
    ? `Bill matches the purchase order within tolerance (variance ${variance}).`
    : status === "over"
      ? `Bill exceeds the purchase order by ${round2(Math.abs(variance))} (${round2(Math.abs(variancePct))}%) — review before paying.`
      : `Bill is ${round2(Math.abs(variance))} (${round2(Math.abs(variancePct))}%) under the purchase order.`;

  return { matched, status, poTotal, billTotal, variance, variancePct, toleranceAmount, message };
}
