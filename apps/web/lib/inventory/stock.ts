// lib/inventory/stock.ts — weighted-average inventory valuation (SAP MM-IM / WM stock)
//
// The substantive, hard part of inventory accounting: what a unit is worth as stock
// moves, and the cost of goods when it leaves. Pure and DB-free so the costing rules
// are unit-testable; the StockItem / StockMovement persistence and the movement → GL
// posting (Dr Inventory / Cr GRNI on receipt, Dr COGS / Cr Inventory on issue) are
// separate follow-ups.
//
// Costing method: perpetual **weighted average** — the SMB-friendly default (no lot
// tracking, no FIFO layer maths). Each receipt re-averages the unit cost; each issue
// leaves at the current average, so cost of goods sold is deterministic.

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** An item's current stock position: how many units and their weighted-average cost. */
export type StockState = {
  quantity: number;
  /** Weighted-average cost per unit. */
  unitCost: number;
};

export type StockMovement =
  /** Goods in at a purchase cost (re-averages the unit cost). */
  | { type: "receipt"; quantity: number; unitCost: number }
  /** Goods out (sale / consumption) — leaves at the current average cost. */
  | { type: "issue"; quantity: number }
  /** Stock-take correction: a signed quantity delta valued at the current average. */
  | { type: "adjustment"; quantity: number };

export type StockMovementResult = {
  /** The item's new position after the movement. */
  state: StockState;
  /** Units in (+) or out (−). */
  quantityDelta: number;
  /** Change in total inventory value (drives the Dr/Cr Inventory posting). */
  valueDelta: number;
  /** Cost of goods issued (an `issue`), else 0 — drives the Dr COGS posting. */
  cogs: number;
};

/**
 * Apply one stock movement to an item's position under perpetual weighted-average
 * costing:
 *   receipt:    qty += in; unitCost = (oldValue + inQty×inCost) / newQty
 *   issue:      cogs = min(qty, out) × unitCost; qty −= issued (never below 0)
 *   adjustment: qty += delta (valued at the current average), never below 0
 *
 * Quantities never go negative — an over-issue is capped at what is on hand (the
 * shortfall is surfaced by the caller, not booked as negative stock).
 */
export function applyStockMovement(prev: StockState, m: StockMovement): StockMovementResult {
  const prevQty = Math.max(prev.quantity, 0);
  const prevCost = Math.max(prev.unitCost, 0);
  const prevValue = round2(prevQty * prevCost);

  if (m.type === "receipt") {
    const inQty = Math.max(m.quantity, 0);
    const inCost = Math.max(m.unitCost, 0);
    const inValue = round2(inQty * inCost);
    const newQty = prevQty + inQty;
    const newUnitCost = newQty > 0 ? round2((prevValue + inValue) / newQty) : prevCost;
    return {
      state: { quantity: newQty, unitCost: newUnitCost },
      quantityDelta: inQty,
      valueDelta: inValue,
      cogs: 0,
    };
  }

  if (m.type === "issue") {
    const issued = Math.min(Math.max(m.quantity, 0), prevQty);
    const cogs = round2(issued * prevCost);
    return {
      state: { quantity: prevQty - issued, unitCost: prevCost },
      quantityDelta: -issued,
      valueDelta: -cogs,
      cogs,
    };
  }

  // adjustment: signed quantity delta valued at the current average.
  const delta = m.quantity;
  const newQty = Math.max(prevQty + delta, 0);
  const appliedDelta = newQty - prevQty; // clamped if it would go negative
  return {
    state: { quantity: newQty, unitCost: prevCost },
    quantityDelta: appliedDelta,
    valueDelta: round2(appliedDelta * prevCost),
    cogs: 0,
  };
}
