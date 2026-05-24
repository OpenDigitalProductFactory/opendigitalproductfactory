# Marisol, Merchandiser at a two-location specialty retail shop - DPF persona

## Snapshot

- **Business**: Specialty retail shop selling curated home goods through two physical locations plus a small online storefront.
- **Size**: Small multi-location shop with store associates, a back-room receiving rhythm, and owner/operator oversight. Exact revenue and geography are not specified.
- **Tech baseline**: Comfortable with POS, ecommerce orders, spreadsheets, barcode/stock tools, and text/email follow-up, but not with platform administration or software delivery terms.
- **What they don't have**: One workboard that combines open order tasks, low stock, incoming inventory, return exceptions, and location-level sales signals before customers discover the gap first.
- **Archetype**: Seeded leaf `retail-goods`; category `retail-goods`.
- **IT4IT value streams they care about**: `request-to-fulfill`, `detect-to-correct`, `deploy-to-operate`.

## The narrative (marketing-grade)

Marisol's work is a constant negotiation between what the system says is available and what the shelf actually looks like. A product can sell out in one location while sitting untouched in another. A delivery can arrive without being received cleanly. A return can create a resale question. An online order can look simple until the item is on the wrong shelf in the wrong store.

She does not need a beautiful analytics page at 8 a.m. She needs a merchandising board that says what needs action now: which orders are waiting, which SKUs are low, what arrived today, which returns need a decision, and whether one location's demand should move stock from the other. The value is in turning retail noise into a short, trusted action list.

DPF works for Marisol when it respects the floor. The system should speak in products, SKUs, locations, stockroom, orders, returns, receiving, and restock - not platform language. If the board is right, the shop feels less reactive by noon.

## What they ask DPF to build (the first feature)

"I want one home screen that tells me which orders need action, what's running low, and what arrived today."

First-feature smoke scope:

- Show open order tasks by location.
- Highlight low-stock SKUs and suggested restock actions.
- Show incoming inventory that needs receiving or count confirmation.
- Flag return exceptions that need a resale, refund, or vendor decision.
- Show simple location-level sales signals without turning the home into a finance report.

Primary workspace-home backlog item: `BI-3F3B535D`.

## What the platform needs to be like for them

- **Vocabulary** they expect: products, SKUs, variants, stock, low stock, back room, receiving, orders, pickup, shipping, returns, restock, transfers, locations, register, sales today.
- **Coworkers** they need active: a merchandising or inventory coworker for low-stock and receiving exceptions, plus a customer follow-up coworker for order/return messages. A Dispatcher coworker is irrelevant unless the store later adds local delivery. Verify the seed state in `packages/db/src/seed.ts` before a dogfood run and simulate missing roles through the generic Build Studio coworker. Note: the seeded `inventory-specialist` slug renders as **"Digital Product Estate Specialist"** (a platform/EA role) — Marisol's merchandising-inventory helper is not this slug.
- **Features** that are critical vs irrelevant: critical features are order task queues, low-stock thresholds, receiving tasks, return exceptions, location-level signals, manual count adjustments, and archetype-aware applicability. Irrelevant at first touch: clinic appointment readiness, technician load, warehouse-truck stock, platform architecture, raw model/provider details, and GearInterface terminology.
- **Surfaces** they'll touch first and what should be on them: `/workspace` should open to a merchandising board; `/build` should accept the first-feature request in retail language; any generated feature should preview inventory/order behavior against the active build.
- **Surfaces** they should NEVER see: schema fields, tool traces, Git branches, model IDs, MCP/tool names, raw autonomy labels, gear/ring/torque/slip/cockpit language, or unrelated admin backlog mechanics.

## Marketing extractables

- "Marisol does not need another report. She needs the store to tell her what needs action before the customer does."
- "Low stock is not just an inventory metric; it is a missed sale waiting to happen."
- "DPF turns a messy retail morning into a short list: orders, stock, receiving, returns."
- **Before/after hero block**: Before DPF, Marisol checks POS, ecommerce, stock counts, and receiving notes separately. After DPF, the home screen shows the orders, low-stock items, incoming inventory, returns, and location signals that matter today.
- **Feature soundbites**: Open order tasks stay visible until resolved; low-stock exceptions become restock actions; receiving work is part of the daily board; returns are treated as decisions, not clutter; location signals help small teams move stock before demand shifts.
- **Permission to use?** Pseudonym/synthetic persona. Not a real customer story unless replaced with a customer-approved case study.

## Test scenarios (re-runnable dogfood)

- With substrate BI `BI-1CCC6264` complete, configure a `retail-goods` install and confirm `/workspace` resolves to the retail contribution rather than the platform fallback.
- With projection BI `BI-3E8D2CF5` complete, render low-stock and return-exception signals as retail-native needs-review items, not GearInterface or Governor copy.
- Drive `BI-3F3B535D` on the Live portal with fixture-backed data: one open pickup order, one shipping task, one low-stock SKU, one incoming inventory receipt, one return exception, and one location-level sales signal.
- Confirm the first viewport prioritizes order tasks, low-stock exceptions, receiving, and returns before generic business KPIs.
- On mobile, confirm the most urgent retail slots stay ahead of lower-priority cards and do not collapse into unreadable summary text.
- Start Marisol's first-feature Build Studio request only after `BI-4396EFEC` has been functionally verified against Dale's flow; confirm the feature contribution is not recommended to clinic or field-service archetypes by default.

## Dogfood history

| Date | Phase reached | Deficiencies surfaced | Outcome |
| ---- | ------------- | --------------------- | ------- |
| 2026-05-24 | Persona defined from vertical-home design | None yet; not dogfooded | Ready as a peer-story and future Build Studio smoke once Dale's D38 blocker is cleared. |

## Open BIs from this persona's dogfooding

No Marisol-specific dogfood deficiencies yet.

Related live backlog anchors:

- `BI-3F3B535D` - Retail merchandiser workspace home; live status `open`.
- `BI-1CCC6264` - Vertical workspace home substrate; live status `open`.
- `BI-3E8D2CF5` - Vertical workspace home projection service; live status `open`.
- `BI-4396EFEC` - Dale D38 plan-iteration divergence; live status `triaging`, gating new peer-persona Build Studio sessions.

## Source evidence

- Workspace-home anchor: [Vertical Workspace Home design](../superpowers/specs/2026-05-24-vertical-workspace-home-design.md).
- Archetype seed reality: `packages/storefront-templates/src/archetypes/retail-goods.ts`.
- Vocabulary grounding: `apps/web/lib/storefront/archetype-vocabulary.ts`.
- Live backlog source at creation: MCP `get_backlog_item("BI-3F3B535D")`, `get_backlog_item("BI-1CCC6264")`, `get_backlog_item("BI-3E8D2CF5")`, and `get_backlog_item("BI-4396EFEC")` on 2026-05-24.
