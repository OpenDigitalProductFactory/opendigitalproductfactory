---
title: Capability lane — inventory and procurement admin (audit + design)
date: 2026-05-24
status: proposal — awaiting operator review
owner: Mark Bodman (CEO) — proposed by agent
backlog-item: BI-E1CFC8FB
epic: EP-BIZ-CAP
relates-to:
  - apps/web/lib/finance/accountant-work-lane.ts (precedent: typed work-lane shape)
  - packages/db/prisma/schema.prisma (Supplier, PurchaseOrder, FixedAsset, ExpenseClaim, StorefrontItem)
  - apps/web/app/(shell)/inventory/page.tsx (legacy alias for IT discovery operations — terminology collision)
  - apps/web/app/(shell)/finance/{suppliers,purchase-orders,assets,expense-claims,bills,my-expenses}/
  - apps/web/app/(shell)/storefront/items/page.tsx
  - apps/web/app/(shell)/platform/tools/integrations/quickbooks/page.tsx
  - apps/web/lib/integrate/quickbooks/readiness.ts (QuickBooks coverage matrix consumed by lanes)
---

# Capability lane — inventory and procurement admin

## 1. The question

BI-E1CFC8FB (priority 3, medium, triaged-for-build, EP-BIZ-CAP) asks:

> Define the inventory/procurement admin lane for small businesses across **suppliers, purchase orders, assets, inventory, storefront items, expense claims, and finance integration touchpoints**. Acceptance: the lane identifies existing models/routes, missing supplier/item/asset links, coworker ownership, integration anchors, and the next buildable procurement/inventory slice.

This document is the audit deliverable. It mirrors the typed precedent in `apps/web/lib/finance/accountant-work-lane.ts` (the bookkeeper/accountant lane) so the follow-on slice has a clear target shape.

## 2. Repo truth (verified 2026-05-24 in this worktree)

### 2.1 Existing Prisma models

| Model | Schema line | Owns | Status |
| --- | --- | --- | --- |
| `Supplier` | 7400 | Vendor record (name, contact, payment terms, currency, bank details) | Stable. Links to `Bill[]`, `PurchaseOrder[]`, `SupplierContract[]`. |
| `SupplierContract` | 7452 | Subscription-style supplier agreements | **Currently scoped to AI-provider finance profiles** (`profileId` references `AiProviderFinanceProfile`). A general supplier-contract (non-AI) shape would need either a profile-shaped pivot or a new model. |
| `PurchaseOrder` | 7610 | PO header (number, supplier, status, totals, delivery date) | Stable; no link to received-quantity / inventory effect. |
| `PurchaseOrderLineItem` | 7636 | PO line (description, quantity, unit price, tax) | **No `itemId`** column — lines are free-text descriptions; cannot reference `StorefrontItem`, `FixedAsset`, or any stock record. |
| `Bill` / `BillLineItem` | 7559 / 7592 | Supplier bill (AP) with line items | Stable; line items have `accountCode` but no `itemId` link. |
| `BillApproval` | 7666 | Token-based bill approval workflow | Stable. |
| `ApprovalRule` | 7653 | Amount-threshold approver routing | Stable. |
| `FixedAsset` | 7908 | Asset register (cost, depreciation, location, `assignedToId`) | Stable; **no `supplierId` or `purchaseOrderId`** — assets cannot trace origin. |
| `ExpenseClaim` / `ExpenseItem` | 7860 / 7886 | Employee expense reimbursement claims | Stable. |
| `StorefrontItem` | 7003 | Sellable storefront catalog entry (name, price, CTA, booking config) | **Catalog-only** — no on-hand quantity, no `supplierId`, no `purchaseOrderId`. |

### 2.2 Existing routes

| Route | Purpose | Notes |
| --- | --- | --- |
| `/inventory` | **Legacy alias for `DiscoveryOperationsPage`** (IT estate discovery) | Terminology collision — see §4. |
| `/inventory/entity/[entityId]` | IT entity detail | Same collision. |
| `/finance/suppliers` (+ `new`, `[id]`) | Supplier list / create / detail | OK. |
| `/finance/purchase-orders` (+ `new`, `[id]`) | PO list / create / detail | OK. |
| `/finance/assets` (+ `new`, `[id]`) | Asset register | OK. |
| `/finance/expense-claims` (+ `[id]`) | Admin expense-claim review | OK. |
| `/finance/my-expenses` (+ `new`) | Employee expense submission | Adjacent surface; the lane should distinguish admin review from employee submission. |
| `/finance/bills` (+ `new`, `[id]`) | Supplier bill list / create / detail | Adjacent to POs. |
| `/storefront/items` | Storefront catalog manager | Catalog-only; no procurement link. |
| `/platform/tools/integrations/quickbooks` | QuickBooks Online integration page | Used by accountant lane via `buildQuickBooksReadinessDescriptor`. |

### 2.3 Coworkers and roles

- **`inventory-specialist`** — referenced in `apps/web/components/workspace/CalendarAgentScheduler.tsx` and used as `currentAgentId`/`actorAgentId` in `lib/ai-operations-map/project-events.test.ts`. **Routes to `/inventory`** — but `/inventory` is the IT estate page, so this coworker's named home matches a route whose meaning has drifted. Worth flagging (see §4).
- **`finance-agent`** — owned by accountant lane handoffs: "Prepare invoice, payment, bill, and report evidence for review. Proposal mode only for accounting-impacting actions until write gates exist."
- **`finance-controller`** — owned by accountant lane handoffs: "Own controls, reconciliation posture, approval thresholds, and close readiness."
- **`bookkeeper_accountant`** (employee role) — typed work lane already exists.
- **`inventory_procurement_admin`** (employee role) — named in BI as the lane owner. **No typed lane exists today.**
- **`owner_operator`** — approves provider connections and cash-sensitive actions in the accountant lane.

### 2.4 Integration anchors

- **QuickBooks Online** — wired via `apps/web/lib/integrate/quickbooks/readiness.ts`. The accountant lane consumes its capability matrix (`buildQuickBooksReadinessDescriptor`). Posture today: `import-staging`. Source-attributed, non-editable, no write-back.
- **Stripe Billing & Payments** — wired; posture `reconciliation-anchor`. Not directly inventory/procurement, but supplier payments may pass through it.
- **Vendor/supplier systems** (per BI: "vendor/supplier systems later") — **not wired**.
- **Inventory provider** (per BI: "inventory provider later") — **not wired**.

## 3. Missing links / gaps

These are the structural absences the audit surfaces. Each is named so a follow-on slice can choose which to close first.

1. **No on-hand quantity / stock model.** Neither `StorefrontItem` nor any sibling model carries `onHandQuantity`, `reservedQuantity`, or `reorderPoint`. There is no `StockMovement` / `InventoryLevel` table. Result: receiving a PO line cannot affect stock; selling a `StorefrontItem` cannot decrement stock; there is no "do we need to reorder" signal.
2. **No `PurchaseOrderLineItem.itemId` link.** PO lines are free-text descriptions. A PO for "10× widget A" cannot reference the widget-A `StorefrontItem` or a stock record, so received quantity cannot flow into catalog state.
3. **No `FixedAsset.supplierId` or `FixedAsset.purchaseOrderId`.** Capital purchases cannot trace their origin. Audit answers like "who supplied this laptop?" require manual lookup.
4. **No supplier-side document trail beyond `Bill` and `PurchaseOrder`.** No `GoodsReceipt`, no `SupplierStatement`, no `ReturnAuthorization`. Reconciling supplier bills against received goods has no substrate.
5. **`SupplierContract` is AI-provider-shaped.** Currently requires an `AiProviderFinanceProfile` (`profileId`). A general supplier service-contract (e.g. "cleaning every Tuesday") cannot use this model without scaffolding a synthetic AI-provider profile. Either pivot the FK or add a parallel `SupplierServiceContract` shape.
6. **No `StorefrontItem.supplierId` (or supplier link on catalog items).** Cannot answer "which supplier provides this item?" without external bookkeeping.
7. **No `ExpenseClaim.purchaseOrderId` or `ExpenseClaim.supplierId`.** Employee expenses billed against a supplier engagement (e.g. travel for a vendor meeting) cannot link to the supplier or PO without manual category coding.
8. **No `inventory_procurement_admin` typed work lane.** The accountant lane has one (`apps/web/lib/finance/accountant-work-lane.ts`); this BI is the cue to add a parallel `inventory-procurement-work-lane.ts`.
9. **No QuickBooks capability matrix entry for "items" / "inventory levels".** `buildQuickBooksReadinessDescriptor` covers accountant capabilities; inventory side has no entries.

## 4. Terminology collision — `/inventory`

`/inventory` is **a legacy alias for `DiscoveryOperationsPage`** (IT estate / discovered devices, services, network operations). It is NOT a product inventory / stock-keeping route.

This matters for this lane because:

- The BI's surface list includes `/inventory` as if it were the procurement-inventory page. It is not.
- The `inventory-specialist` coworker's route in `CalendarAgentScheduler.tsx` points at `/inventory` — that coworker today fronts IT-estate work, not product-stock work.
- An operator looking for "where do I see my widget stock?" today lands on the IT estate page and finds nothing.

**Recommendation:** the inventory/procurement lane should NOT claim `/inventory` as its home until either (a) the IT-estate page moves to a dedicated route (e.g. `/platform/estate`) and `/inventory` is repurposed, or (b) the procurement-inventory home picks a non-colliding route (e.g. `/inventory/stock`, `/storefront/stock`, or `/finance/stock`). Section §7 picks one as the proposed home.

## 5. Proposed lane shape

Mirror `apps/web/lib/finance/accountant-work-lane.ts` exactly. The follow-on slice (named in §8) implements:

```ts
// apps/web/lib/inventory/inventory-procurement-work-lane.ts (proposed — NOT in this PR)

export const INVENTORY_PROCUREMENT_WORK_LANE: InventoryProcurementWorkLane = {
  roleId: "inventory_procurement_admin",
  roleLabel: "Inventory and Procurement Admin",
  taxonomyNodeId: "for_employees/supply_chain_or_procurement",
  posture: "hybrid",
  maturityTarget: "observe",
  workstreams: [
    {
      key: "supplier-engagement",
      label: "Suppliers and contracts",
      dailyWork: "Onboard suppliers, maintain payment terms, track contract renewals and supplier health.",
      routes: [
        { label: "Suppliers", href: "/finance/suppliers" },
        // Future: supplier-contract general view (currently AI-provider-shaped).
      ],
      handoffRule:
        "Finance Agent prepares supplier evidence; Inventory/Procurement Admin owns supplier relationships and purchasing authority.",
    },
    {
      key: "purchasing",
      label: "Purchase orders and bills",
      dailyWork: "Raise POs, track delivery, match bills to receipts, approve payment.",
      routes: [
        { label: "Purchase orders", href: "/finance/purchase-orders" },
        { label: "Bills", href: "/finance/bills" },
        { label: "Payment runs", href: "/finance/payment-runs" },
      ],
      handoffRule:
        "Finance Controller owns approval thresholds; PO-to-bill reconciliation evidence must exist before write-back gates open.",
    },
    {
      key: "asset-register",
      label: "Capital assets",
      dailyWork: "Record fixed assets, track location, manage depreciation, retire assets.",
      routes: [
        { label: "Assets", href: "/finance/assets" },
      ],
      handoffRule:
        "Finance Controller owns depreciation method and useful-life assumptions; physical custody handoffs stay with the Inventory/Procurement Admin.",
    },
    {
      key: "stock-and-catalog",
      label: "Stock and storefront catalog",
      dailyWork: "Keep storefront items current; reconcile what was ordered, received, and is available to sell.",
      routes: [
        { label: "Storefront items", href: "/storefront/items" },
        // Future: a stock/on-hand view once the stock model exists (see §8).
      ],
      handoffRule:
        "Catalog and stock state are separate today — flag this in the lane until a stock model lands.",
    },
    {
      key: "expense-pass-through",
      label: "Employee expense pass-through",
      dailyWork: "Review expense claims that touch supplier engagements (travel for vendor meetings, supplier-related per diems).",
      routes: [
        { label: "Expense claims (admin)", href: "/finance/expense-claims" },
        { label: "My expenses (employee)", href: "/finance/my-expenses" },
      ],
      handoffRule:
        "Bookkeeper/Accountant owns claim approval; this lane handles supplier-attribution on claims.",
    },
  ],
  handoffs: [
    {
      actorId: "finance-agent",
      actorKind: "ai-coworker",
      label: "Finance Agent",
      responsibility: "Prepare supplier, PO, bill, and asset evidence for review.",
      boundary: "Proposal mode only for procurement-impacting actions until write gates exist.",
    },
    {
      actorId: "finance-controller",
      actorKind: "ai-coworker",
      label: "Finance Controller",
      responsibility: "Own PO approval thresholds, bill-to-PO reconciliation discipline, asset depreciation policy.",
      boundary: "Escalates ambiguous procurement ownership rather than silently writing.",
    },
    {
      actorId: "inventory-specialist",
      actorKind: "ai-coworker",
      label: "Inventory Specialist",
      responsibility: "Prepare stock-position, reorder, and catalog-vs-warehouse-reconciliation evidence.",
      boundary:
        "Cannot operate against the IT-estate `/inventory` page — that surface is a different domain. Route assignment must be re-pointed once §4 terminology collision resolves.",
    },
    {
      actorId: "owner_operator",
      actorKind: "employee-role",
      label: "Owner / Operator",
      responsibility: "Approve supplier connections, cash-sensitive PO actions, asset disposal, and inventory write-down decisions.",
      boundary: "Keeps purchasing authority separate from preparation work.",
    },
    {
      actorId: "future-inventory-procurement-admin-specialist",
      actorKind: "missing-coworker",
      label: "Future inventory/procurement admin specialist",
      responsibility: "Review supplier evidence packets, propose reorder points, surface contract-renewal risk.",
      boundary: "Missing coworker; track as a later capability once the lane is visible.",
    },
  ],
  providerBoundaries: [
    {
      provider: "quickbooks",
      label: "QuickBooks Online (suppliers/items posture)",
      href: "/platform/tools/integrations/quickbooks",
      posture: "import-staging",
      currentCoverage: [], // To be filled by a QuickBooks inventory-capability matrix entry (gap §3 #9).
      missingCoverage: ["Items master", "Inventory levels", "Vendor bills source-of-truth"],
      writeBoundary:
        "No write-back to QuickBooks for items or stock until reconciliation evidence and rollback/export exist.",
      nextBacklogItemId: "(open) — Add QuickBooks inventory capability matrix entries",
    },
    {
      provider: "supplier-system",
      label: "Supplier portals (vendor systems)",
      href: "/finance/suppliers",
      posture: "not-mapped",
      currentCoverage: [],
      missingCoverage: ["Supplier portal authentication", "Order acknowledgement ingest", "Shipping/tracking sync"],
      writeBoundary: "DPF should not place external orders until per-supplier custody rules are decided.",
      nextBacklogItemId: "(open) — Decide native-first vs provider-led per archetype",
    },
    {
      provider: "inventory-provider",
      label: "External inventory provider (when archetype warrants)",
      href: "/storefront/items",
      posture: "not-mapped",
      currentCoverage: [],
      missingCoverage: ["Stock-level source-of-truth", "Movement events", "Multi-location reconciliation"],
      writeBoundary: "Replacement gate (BI §header) — archetype decides native-first vs provider-led.",
      nextBacklogItemId: "(open) — Archetype-driven decision",
    },
  ],
  promotionGuardrail:
    "DPF does not become the inventory system of record until a stock model exists, PO-line-to-item links exist, asset origin can be traced to supplier/PO, and the archetype-level replacement gate decision is on record.",
  nextWorkflow: {
    backlogItemId: "(see §8)",
    title: "Smallest next buildable slice — see §8",
    route: "/finance/purchase-orders",
    reason:
      "PO-line-to-item linkage is the highest-leverage substrate gap; closing it unblocks both asset-origin and stock-effect work.",
  },
};
```

## 6. Coworker ownership map

| Workstream | Primary AI coworker | Approver / employee role | Notes |
| --- | --- | --- | --- |
| Supplier engagement | Finance Agent (prep) | Inventory/Procurement Admin (decision) | Lane-owning role; today no typed lane file exists. |
| Purchasing (POs + bills) | Finance Agent (prep) | Finance Controller (threshold approval) | Crosses the accountant lane — keep the two lanes adjacent, not overlapping. |
| Asset register | Finance Controller (policy) | Inventory/Procurement Admin (custody) | Depreciation policy is accountant-side; asset custody is procurement-side. |
| Stock + catalog | Inventory Specialist (prep) | Inventory/Procurement Admin (decision) | Coworker route mismatch — see §4. |
| Expense pass-through | Bookkeeper/Accountant (approval) | Inventory/Procurement Admin (supplier attribution) | This is a lane handoff back to the accountant lane. |

## 7. Integration anchors

| Anchor | Today | Lane consumes |
| --- | --- | --- |
| QuickBooks Online | Wired via `apps/web/lib/integrate/quickbooks/readiness.ts`. Accountant lane consumes accountant capabilities. | Lane should consume an inventory-side capability projection (currently empty — gap §3 #9). |
| Stripe | Wired; reconciliation anchor for payments. | Not directly inventory; supplier payment evidence may flow through. |
| Supplier portals | Not wired. | Lane names this as `posture: "not-mapped"` until archetype decides custody. |
| External inventory provider | Not wired. | Replacement gate: archetype-driven decision before integration. |

## 8. Smallest next buildable slice

Three candidates considered; one recommended.

### Candidate A — Add `PurchaseOrderLineItem.itemId` + supplier→storefront-item link

- **Scope:** add `itemId String?` to `PurchaseOrderLineItem` referencing `StorefrontItem` (or a future `InventoryItem` if/when it exists); add `supplierId String?` to `StorefrontItem`. Update PO line UI to optionally pick an item; surface "supplier" on the storefront item detail.
- **Pro:** unblocks two downstream gaps (#2 and #6 in §3) with one Prisma migration. Lays the foundation for stock-effect work without committing to the stock model yet.
- **Pro:** small, additive, no behavioral change for existing POs (column is nullable).
- **Con:** does not yet create a stock model — so PO receipt still cannot affect on-hand quantity.
- **Verdict:** Recommended as the smallest next slice.

### Candidate B — Add `FixedAsset.supplierId` + `FixedAsset.purchaseOrderId`

- **Scope:** two nullable FKs on `FixedAsset` so capital purchases trace origin. Update `/finance/assets/new` form.
- **Pro:** closes gap #3.
- **Con:** narrower leverage than Candidate A — useful but only for capital assets.
- **Verdict:** Park as the follow-on to A.

### Candidate C — Land the typed lane module + Platform Development index entry

- **Scope:** implement `apps/web/lib/inventory/inventory-procurement-work-lane.ts` (the TypeScript shape this audit proposed) + a small index page that lists known lanes (mirrors how the accountant lane surfaces today).
- **Pro:** makes the lane operator-visible immediately.
- **Con:** is governance/visibility work, not substrate-fixing — closes zero structural gaps.
- **Verdict:** worthwhile after A. Both could ship in the same PR if Mark prefers, since neither touches the other's surface.

**Recommendation:** ship Candidate A as the smallest next slice; file Candidates B and C as follow-on BIs (or stack C on top of A in the same slice if review bandwidth allows).

## 9. Out of scope (carry to follow-on BIs if surfaced)

- The full `InventoryItem` / `StockMovement` / `StockLevel` model design. The acceptance gate per the BI is "smallest buildable slice" — committing to a stock model is a bigger architecture decision and needs its own spec.
- `/inventory` route repurposing. Either the IT-estate page moves (and `/inventory` repurposes) or the procurement-inventory home picks a different route. Decided by a separate effort.
- QuickBooks inventory capability matrix entries (gap §3 #9). Belongs in the QuickBooks readiness work, not this audit.
- Supplier portal integrations and inventory-provider integrations. Replacement gate must fire first (archetype-driven decision).
- Pivoting `SupplierContract` away from being AI-provider-shaped, or adding `SupplierServiceContract` (gap §3 #5).

## 10. Open decisions

1. **Approve the proposed lane shape (§5)?** Recommendation: yes — mirrors the accountant precedent exactly.
2. **Approve Candidate A as the smallest next slice (§8)?** Recommendation: yes — small, additive, highest leverage.
3. **Stack Candidate C on Candidate A in the same PR, or split them?** Recommendation: split. Substrate change (A) wants its own review; lane module + index page (C) can land second.
4. **Where does the procurement-inventory route home live?** Defer to a separate decision per §9; the lane today exposes `/finance/*` and `/storefront/items` and explicitly does not claim `/inventory`.
5. **Promote `inventory-specialist` to a separate Inventory/Procurement coworker definition, or keep the single coworker that fronts both IT-estate and procurement contexts?** Recommendation: defer to a routing/coworker-taxonomy follow-on.

## 11. Definition of done

- This audit doc is reviewed and accepted or revised.
- Either:
  - **Candidate A is filed as a new BI** with a pointer back to this audit (recommended path), OR
  - The audit is left in place as the substrate map for whichever effort touches inventory/procurement next.
- BI-E1CFC8FB acceptance criteria all met:
  - existing models/routes ✓ (§2)
  - missing supplier/item/asset links ✓ (§3)
  - coworker ownership ✓ (§6)
  - integration anchors ✓ (§7)
  - next buildable procurement/inventory slice ✓ (§8)
- BI-E1CFC8FB closes on merge.
