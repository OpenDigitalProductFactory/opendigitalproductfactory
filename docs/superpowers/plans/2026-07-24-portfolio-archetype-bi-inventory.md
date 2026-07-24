# Portfolio Archetype BI Inventory And Cross-Archetype Investment Plan

> **For agentic workers:** This is a planning and BI-governance document, not an implementation checklist. Use the live backlog as source of truth before executing any item.

**Goal:** Ensure every archetype category has enough scoped BI inventory to see investment needed by category and collectively, then identify reusable bets with the largest cross-archetype return.

**Date:** 2026-07-24
**Branch:** `doc/archetype-bi-inventory`
**Primary docs:** `docs/architecture/backlog-archetype-scope.md`, `docs/architecture/archetype-business-value-streams.md`

## Current State

The live backlog now has explicit scope metadata for archetype planning. Most categories have a mature vertical-readiness scaffold:

- Keystone readiness pack and acceptance tests.
- Vertical request lifecycle.
- Resource and capacity model.
- Master-data context.
- Employee-facing owner cockpit.
- Integration and replacement-boundary map.
- Finance and billing-readiness model.
- Marketing proof and retention workflow.
- Proactive coworker actions.
- Occupation homes and role-specific coworker roster.
- Top-10 gap acceptance fixture and market-proof test pack.

The scaffolds are useful. They are not yet sufficient by themselves because many long-tail needs repeat across multiple archetypes but require vocabulary and compliance variants. The new planning layer should therefore use three categories of investment:

| Investment class | Meaning | Example |
|---|---|---|
| Common substrate | Used across most businesses | Payroll, IAM, finance, workforce, document management |
| Multi-archetype substrate | Used by a named cluster of categories | Field Ops for mobile/site/route work |
| Category/leaf projection | Specific vertical vocabulary, rules, and acceptance fixtures | Construction certified payroll, fabric-care claim ticket, restaurant food-safety packet |

## Category Coverage Snapshot

| Category | Leaf count | Current BI inventory status | New action in this pass |
|---|---:|---|---|
| `asset-rental` | 3 | 10-item readiness scaffold | Cross-referenced to Field Ops where delivery/return/assets apply |
| `automotive-services` | 6 | 10-item readiness scaffold | Cross-referenced to Field Ops mobile/service variants |
| `banking-financial-services` | 3 | 10-item BIAN readiness scaffold | No new BI; category is less field-ops dependent |
| `beauty-personal-care` | 6 | 10-item readiness scaffold | No new BI; mobile beauty can later reuse Field Ops if prioritized |
| `education-training` | 4 | 10-item readiness scaffold | No new BI |
| `fabric-care-services` | 3 | Deep leaf pack for dry-cleaning plant network | Cross-referenced to Field Ops route/evidence where applicable |
| `fitness-recreation` | 3 | 10-item readiness scaffold | No new BI |
| `food-hospitality` | 3 | 10-item scaffold plus restaurant-specific UX/compliance BIs | Cross-referenced to Field Ops for catering/delivery and evidence packets |
| `healthcare-wellness` | 9 | 10-item readiness scaffold | Cross-referenced to Field Ops home-health/mobile-care credential and visit evidence |
| `hoa-property-management` | 3 | 10-item readiness scaffold | No new BI; vendor/site work can later map to Field Ops |
| `live-events-venues` | 3 | 10-item readiness scaffold | Cross-referenced to Field Ops event-production/site-readiness variants |
| `media-production` | 3 | 10-item readiness scaffold | Cross-referenced to Field Ops crew/location/gear variants |
| `moving-and-logistics` | 5 | 10-item readiness scaffold | Cross-referenced to Field Ops route/crew/truck/proof variants |
| `nonprofit-community` | 8 | 10-item readiness scaffold | No new BI |
| `pet-services` | 5 | 10-item readiness scaffold | Cross-referenced to Field Ops mobile pet/vet variants |
| `professional-services` | 8 | 10-item scaffold plus IT-MSP leaf pack | Field inspection and land surveying mapped to Field Ops |
| `public-sector` | 3 | 10-item readiness scaffold | Cross-referenced to Field Ops public works/inspection evidence |
| `real-estate-construction` | 2 | 10-item residential builder scaffold | Added 8 construction field-ops BIs |
| `retail-goods` | 5 | 10-item readiness scaffold | Cross-referenced to Field Ops delivery/install evidence |
| `security-services` | 2 | 10-item readiness scaffold | Cross-referenced to Field Ops guard patrol/post/incident variants |
| `software-platform` | 1 | 10-item readiness scaffold | No new BI |
| `trades-maintenance` | 11 | 10-item scaffold plus field-service dispatch epic | Retagged field-service dispatch as multi-archetype substrate |
| `warehousing-fulfilment` | 4 | Missing category readiness epic before this pass | Added `EP-VERTICAL-WAREHOUSING` and 10 scoped BIs |

## Live BI Changes Made

New multi-archetype epic:

- `EP-FIELD-OPS-SUBSTRATE` - Field Operations Substrate: presence, credentials, dispatch, assets, daily log, and evidence packets across mobile work archetypes.

New multi-archetype BIs:

- `BI-FIELDOPS-001` - Expected presence for people, assets, external parties, and site/route commitments.
- `BI-FIELDOPS-002` - Credential, training, license, and task-eligibility evidence engine.
- `BI-FIELDOPS-003` - Mobile daily log and field evidence capture.
- `BI-FIELDOPS-004` - Evidence packet generator for payroll, billing, compliance, claims, and disputes.
- `BI-FIELDOPS-005` - Operations manager console pattern for sites, routes, crews, assets, exceptions, and cost leakage.

Construction BIs added under `EP-VERTICAL-CONSTRUCTION`:

- `BI-CON-FIELD-001` - Jobsite readiness model.
- `BI-CON-FIELD-002` - Jobsite presence, time clock, cost-code, and payroll evidence capture.
- `BI-CON-FIELD-003` - Safety, OSHA training, PPE, toolbox talk, incident, and site eligibility evidence workflow.
- `BI-CON-FIELD-004` - Crew, truck, equipment, tool, and material assignment.
- `BI-CON-FIELD-005` - Subcontractor and supplier coordination cockpit.
- `BI-CON-FIELD-006` - Foreman daily log and photo/file evidence capture.
- `BI-CON-FIELD-007` - Cost leakage and change-order candidate detector.
- `BI-CON-FIELD-008` - Public-work certified payroll and compliance readiness.

Warehousing/fulfilment BIs added:

- `EP-VERTICAL-WAREHOUSING` - Industry Vertical Readiness - Warehousing and fulfilment.
- `BI-WH-READY-001` through `BI-WH-READY-010` - Keystone, lifecycle, capacity, master data, cockpit, integration map, finance/billing, proactive actions, marketing proof, and occupation/coworker roster.

Existing items retagged as reusable:

- `EP-TRADES-FIELD-SERVICE` - metadata broadened to `multi-archetype`.
- `BI-69A992A4` - FieldDispatchProfile retagged as reusable dispatch substrate.
- `BI-FS-004` - Dispatcher coworker seed retagged as reusable field-operations coworker pattern.
- `BI-FS-007` - Running-late cascade retagged as reusable commitment-management action.
- `EP-E2866100` and `BI-5FE4FA8A` - truck inventory retagged as multi-archetype field/site/route asset-assignment work.
- `BI-72617848` - merged into `BI-WH-READY-001` after the warehousing readiness lane was created.

## Biggest Bang For Buck

Ranked investments by cross-archetype reach:

| Rank | Investment | Why it matters | Archetype reach |
|---:|---|---|---|
| 1 | `BI-FIELDOPS-001` Expected Presence | Most field chaos starts when expected people/assets/external parties are not represented as commitments | Construction, trades, logistics, healthcare mobile, pet mobile, auto mobile, security, events, media, public works, warehousing, rentals, catering, retail delivery/install, fabric-care routes |
| 2 | `BI-FIELDOPS-004` Evidence Packet Generator | Converts operational records into billing, payroll, compliance, dispute, and claim packets | All regulated, mobile, delivery, rental, service, construction, and route-heavy categories |
| 3 | `BI-FIELDOPS-002` Credential Eligibility | Prevents unqualified work and enables compliance-aware routing | Construction, healthcare, public sector, security, food, mobile services, professional field inspection/survey |
| 4 | `BI-FIELDOPS-003` Daily Log/Evidence Capture | Creates the raw evidence stream for proof, payroll, billing, quality, and dispute flows | Construction, service, logistics, security, events, healthcare visits, warehouse shifts, rentals |
| 5 | Truck/asset assignment (`EP-E2866100`, `BI-5FE4FA8A`, `BI-FIELDOPS-001`) | Company-owned mobile assets are expensive, scarce, and operationally invisible without assignment and reconciliation | Construction, trades, moving/logistics, auto mobile, security, rental, warehousing, fabric-care routes |
| 6 | `BI-FIELDOPS-005` Manager Console Pattern | Avoids one-off dashboards while giving owners the scan view they actually need | Site/route/crew/asset-heavy categories |
| 7 | Existing field-dispatch BIs (`EP-TRADES-FIELD-SERVICE`) | Dispatch, ETA, late cascade, and customer notification reuse well beyond trades | Mobile service categories and public works |

## Remaining Portfolio Gaps

The inventory is now satisfactory for budgeting, but not complete implementation scope. Next refinement should target:

- Leaf-specific compliance variants for high-risk leaves: `home-health-care`, `mobile-phlebotomy`, `guard-patrol`, `restaurant`, `municipal-utility`, `law-enforcement-agency`, `community-bank`, and `credit-union`.
- Leaf-specific acceptance fixtures where generic category fixtures hide material differences: `freight-brokerage`, `cold-chain-storage`, `cross-dock-transload`, `field-inspection`, `land-surveying`, `mobile-vet`, `production-equipment-rental`, and `custom-home-builder`.
- Common-substrate crosswalks from Field Ops into People/HCM, Payroll, Finance, Procurement/Suppliers, IAM/AuthZ, Document Management, Licensing/Permits, and Planning/Analytics.
- UI architecture for a reusable operations manager console based on report-kit primitives and archetype vocabulary, not one dashboard per category.

## Execution Plan

- [ ] Implement `BI-FIELDOPS-001` first as the shared commitment/presence spine.
- [ ] Implement or align truck inventory (`BI-5FE4FA8A`) with the presence/asset assignment spine.
- [ ] Implement `BI-FIELDOPS-003` for daily log/evidence capture with construction foreman and warehouse supervisor as the first two projections.
- [ ] Implement `BI-FIELDOPS-004` evidence packets after daily-log capture emits stable source records.
- [ ] Implement construction `BI-CON-FIELD-002`, `BI-CON-FIELD-006`, and `BI-CON-FIELD-007` as the first construction value slice.
- [ ] Implement warehousing `BI-WH-READY-002` and `BI-WH-READY-005` after Field Ops commitment/presence is stable.
- [ ] Run an archetype acceptance fixture sweep and update each category's keystone BI with leaf-specific fixture requirements.

## Design Grounding Decision

Design-Grounding-Decision: reviewed `docs/architecture/backlog-archetype-scope.md`, `docs/architecture/archetype-business-value-streams.md`, `docs/superpowers/plans/2026-07-24-backlog-archetype-scope-metadata.md`, `packages/storefront-templates/src/archetypes/*`, live `query_backlog` results for all archetype categories, `EP-TRADES-FIELD-SERVICE`, and `EP-E2866100`. Decision: create one multi-archetype Field Ops substrate and category projections for construction and warehousing rather than adding isolated feature items to each vertical scaffold.
