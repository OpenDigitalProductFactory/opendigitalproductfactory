# Stock Coverage Starter — first slice of BI-SPEND-003

| Field | Value |
| --- | --- |
| Date | 2026-07-31 |
| Parent backlog item | BI-SPEND-003 (xlarge — "Inventory, stock, and cost-of-goods starter capability") |
| Epic | EP-SPEND-PROCUREMENT-ASSETS |
| Driving evidence | Restaurant archetype exercise, 2026-07-29 → 07-31 |

## Why this slice exists

The restaurant exercise set every AI coworker to assertive proactivity and asked
one question nightly: *what sold, and what should we reorder?* Five platform
defects were fixed getting the coworker to the point where it could ask that
question honestly (#3725, #3733, #3740, #3763, #3805). The last run
(TR-SCHED-1F1147E8) called its sales-read tool successfully and then reported
the truth: **the platform cannot link a dish to its ingredients or hold a stock
level**, so no restocking proposal is possible.

BI-SPEND-003 is the parent capability (receipts, adjustments, valuation, COGS
posting) and is sized xlarge. This plan carves the smallest slice that closes
the operator's loop — *"we are about to run out of the thing our best seller
needs"* — without pulling in accounting.

## Decomposition decision

BI-SPEND-003 stays open as the parent. This slice ships:

1. **Two persistent models.**
   - `StockItem` — a supply the operator counts: unit, on-hand quantity,
     reorder point, reorder quantity, optional supplier.
   - `StorefrontItemComponent` — one recipe line: selling one unit of a
     `StorefrontItem` consumes `quantityPerUnit` of a `StockItem`.
2. **A pure coverage engine** (`apps/web/lib/stock/stock-coverage.ts`):
   consumption derived from actual sales × recipe, days of cover, below-reorder
   flag, suggested order quantity, urgency ordering.
3. **One read tool** (`list_stock_coverage`, grant `stock_read`) so a coworker
   can propose a restock with a quantity and a supplier.
4. **One operator door** (`POST/GET /api/storefront/admin/stock-items`) so a
   human can enter and see what they stock — a coworker-only capability the
   owner cannot inspect would be a governance defect, not a feature.

Explicitly **out** of this slice, remaining in BI-SPEND-003: goods receipts,
stock adjustments/wastage, valuation, COGS posting to the ledger, purchase-order
generation, and multi-location stock.

## The load-bearing design decision

**Consumption is derived from sales, not from a decrement ledger.**

`onHandQuantity` is a stocktake number the operator maintains; the engine
multiplies units actually sold (from `StorefrontOrder.items`) by the recipe
lines to derive a consumption rate. Consequences, accepted deliberately:

- No partial-fulfilment, cancellation-reversal, or double-decrement semantics —
  the class of bug that makes naive inventory features untrustworthy.
- The number degrades honestly: with no sales in the window the engine returns
  `daysOfCover: null` ("no usage to project from"), never a comfortable
  infinity.
- It matches how a small operator actually works: count on Monday, sell all
  week, reorder before it runs out.

A decrement ledger becomes correct once goods receipts and wastage exist —
i.e. inside the parent BI, not before it.

## Verification

- Unit tests for the pure engine (derivation, multi-item stock, null-projection,
  reorder fallback, urgency ordering, malformed input, zero window) and for the
  pack contract (capability, grant gating, provenance-free description).
- Live acceptance on the restaurant install: seed the eight-dish menu's
  ingredients, then let the daily restocking task run and produce a proposal
  naming the supply, the quantity, and the supplier.

## Follow-ups this slice deliberately leaves open

- Operator UI for stock levels (the API is the door; a page is not in scope).
- Purchase-order generation from a proposal (`PurchaseOrder` already exists).
- The parent BI-SPEND-003 accounting surface.
