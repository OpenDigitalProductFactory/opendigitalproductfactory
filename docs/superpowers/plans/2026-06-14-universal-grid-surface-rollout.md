# Universal Grid — surface rollout plan (every list is also a grid)

**Epic**: EP-GRID-WORKBOOKS
**Date**: 2026-06-14
**Status**: In progress — mechanism shipped, 8 surfaces done, remaining surfaces enumerated below.

The grid **engine** is complete and the **systematic surfacing block** (`PlatformGridSection`)
is in place. This plan tracks making the grid the alternative form for entry /
manipulation / export on **every** multi-item list surface — the Smartsheet/Supabase
"every list is also an editable grid" experience.

## The recipe (per surface)

Three integration shapes, all proven:

1. **Registered platform entity, simple list page** (suppliers, customers, invoices):
   add `searchParams.view` → `parseSurfaceView` → `<PlatformGridSection entityType view />`
   + wrap the existing list in `{!view && (…)}`. ~3 lines.
2. ~~**Tabbed page** where `?view=` is already used for tabs (people): add a **"Grid" tab**
   to the page's tab-nav and render `<SurfacePlatformGrid entityType view="grid" />`
   when that tab is active (avoids the `?view=` collision).~~
   **RETIRED 2026-08-05 (BI-00CB9CCC).** Operator review of `/employee`: a Grid tab
   sitting next to Directory reads as a separate destination for the same records —
   "in its own tab, vs being part of the main workforce list. Seems unorthodox."
   That is the outcome §4's WWMD rejected; shape 2 only existed to dodge a query-param
   collision, which turned out not to need dodging. **Use shape (1) even on a tabbed
   page**: `grid`/`board` are simply not tab values, so the tab-nav resolves them to
   the list tab and the same `?view=` param serves both. See
   `EmployeeTabNav.tsx` (`rawView === "grid" || rawView === "board"` → Directory).
3. **Unregistered entity** (compliance controls): first add a `GenericTableConfig`
   (safe field allow-list — **no PII**; select options must match the page's own facet
   keys so board/grouping align) + `registerGenericReadTable(...)` + a `PLATFORM_TABLES`
   entry, *then* shape (1) or (2).

Per-entity judgement is the **allow-list**: expose useful scalar fields only; never
expose PII or sensitive columns (the people/suppliers configs are the reference for
the discipline; relation ids like `ownerEmployeeId` are omitted). Set
`homeSurface.board: true` only when a column is a `select` with known option keys
(otherwise the Board tab has nothing to group).

## Done (8 surfaces)

| Surface | Entity | Shape | Where |
|---|---|---|---|
| /ops | backlog_item, epic | 1 | merged |
| /finance/invoices | invoice | 1 | merged (refactored to the block in #1895) |
| /compliance/risks | risk_assessment | 1 | merged |
| /finance/suppliers | supplier | 1 | #1893 |
| /customer | customer_account | 1 | #1895 |
| /portfolio | digital_product | 1 | #1895 |
| /employee | employee_profile | ~~2 (Grid tab)~~ → **1** (in-place toggle, BI-00CB9CCC) | #1895, then BI-00CB9CCC |
| /compliance/controls | compliance_control (new config) | 3 | #1895 |

## Remaining (~19 surfaces — mechanical, one small PR per domain batch)

Each row = a new `GenericTableConfig` (read-only, safe allow-list) + `PLATFORM_TABLES`
entry + the block on its page. Models confirmed present in `schema.prisma`.

**Compliance** (`view_compliance`):
- `obligation` → /compliance/obligations — obligationId, title, category, frequency, applicability, reviewDate, status
- `complianceIncident` → /compliance/incidents — incidentId, title, severity, category, status, regulatoryNotifiable, occurredAt, notificationDeadline
- `correctiveAction` → /compliance/actions
- `policy` → /compliance/policies
- `regulation` → /compliance/regulations
- `complianceEvidence` → /compliance/evidence
- `audit` → /compliance/audits

**CRM** (`view_customer`):
- `opportunity` → /customer/(crm)/opportunities — opportunityId, name, stage (select), expectedValue, isDormant
- `quote` → /customer/(crm)/quotes — status (select)
- `salesOrder` → /customer/(crm)/sales-orders — status (select)
- `engagement` → /customer/(crm)/engagements — status (select)

**Finance** (`view_finance`):
- `asset` → /finance/assets — status, category (selects)
- `bill` → /finance/bills — status (select)
- `bankAccount` → /finance/banking (no PII: omit account numbers)
- `expenseClaim` → /finance/expense-claims — status (select)
- `fund` → /finance/funds

**Other domains:**
- inventory items → /inventory
- rentals → /rental
- storefront items → /storefront

## Sequencing

Land #1893 + #1895 first (the block + the 8 done surfaces), then execute the
remaining as **one small PR per domain batch** off clean main (Compliance batch,
CRM batch, Finance batch, then the singletons). Each PR: configs + entries + page
wiring + `pnpm --filter web typecheck` green. Functional acceptance rides the single
archetype-rebuild path (a `W-SURFACE` checklist line: every domain list offers
List/Grid/Board and the grid reads the same records).
