# Construction Field Operations Archetype Design

**Status:** Proposed - BI inventory filed 2026-07-24
**Owner surface:** Real estate and construction vertical readiness
**Primary epic:** `EP-VERTICAL-CONSTRUCTION`
**Reusable substrate epic:** `EP-FIELD-OPS-SUBSTRATE`

## Purpose

DPF's real-estate/construction backlog already covered residential builder flows: model-home tours, design consultations, selections, deposits, draws, change orders, and warranty queues. A construction-company operating pass showed a second load-bearing mode: active jobsite execution.

The jobsite mode is more chaotic and more expensive when coordination fails. A construction operator must know who is expected onsite, whether they are allowed to perform the work, which trucks/equipment/materials are committed, whether suppliers and subcontractors are on track, what work actually happened today, and whether field evidence supports payroll, billing, compliance, or change-order decisions.

This spec extends the archetype without creating construction-only primitives where the same capability applies across other field-heavy archetypes.

## Design Grounding

Existing specs/plans reviewed:

- `docs/architecture/backlog-archetype-scope.md`
- `docs/architecture/archetype-business-value-streams.md`
- `docs/superpowers/plans/2026-07-24-backlog-archetype-scope-metadata.md`
- `docs/superpowers/specs/2026-05-11-licensing-permit-jurisdiction-readiness-design.md`
- `docs/superpowers/specs/2026-05-29-vehicle-equipment-rental-archetype-design.md`
- `docs/superpowers/research/2026-06-13-field-dispatch-archetype-gap-analysis.md`
- `packages/storefront-templates/src/archetypes/real-estate-construction.ts`
- Live DPF backlog via `query_backlog(archetypeCategory="real-estate-construction")`

Current source-of-truth decisions:

- `StorefrontConfig.archetypeId` remains the portal industry source of truth.
- `Epic` and `BacklogItem` scope metadata are the planning source of truth for platform/common/category/leaf/multi-archetype investment analysis.
- `EP-FIELD-OPS-SUBSTRATE` owns reusable presence, credential, dispatch, asset-assignment, daily-log, and evidence-packet primitives.
- `EP-VERTICAL-CONSTRUCTION` owns construction-specific projections, vocabulary, acceptance fixtures, and compliance variants.

## Research And Benchmarking

Regulatory and operational source themes reviewed during the construction pass:

- OSHA construction standards and construction-specific training/evidence expectations, including fall protection, excavation, confined spaces, hazard communication, severe injury reporting, recordkeeping, PPE fit, and the multi-employer jobsite doctrine.
- DOL/FLSA construction wage and recordkeeping guidance, including hourly time capture, payroll evidence, and worker classification concerns.
- DOL/IRS independent-contractor classification context for employees vs contingent workers.
- Davis-Bacon/certified payroll readiness for public-work applicability, including payroll evidence and WH-347-style reporting needs.
- FMCSA hours-of-service relevance where company trucks and covered drivers enter regulated motor-carrier operations.
- Commercial construction field-management patterns from Procore/Raken-style daily logs, time cards, photos, RFIs, submittals, supplier/subcontractor coordination, and change-order workflows.

Adopted patterns:

- Treat field evidence as reusable substrate, not as a construction-only attachment pile.
- Separate employee time/payroll evidence from subcontractor/vendor proof-of-presence.
- Keep public-work/certified-payroll logic behind applicability gates so private residential jobs are not burdened.
- Make AI-generated claims, change orders, backcharges, or compliance attestations reviewable drafts with cited evidence.

Rejected patterns:

- A standalone construction credential table.
- A jobsite dashboard that only reads manually typed statuses instead of expected-vs-actual commitments.
- A generic "notes" field for OSHA, payroll, incident, or change-order evidence.
- Rebuilding truck inventory separate from the existing truck inventory BI and Field Ops asset-assignment substrate.

## Operating Model

Construction field operations revolve around six repeating questions:

1. What should be true at this jobsite today?
2. Who and what actually showed up?
3. Is every person, subcontractor, truck, tool, material, and supplier commitment eligible and ready?
4. What changed, blocked, slipped, or created extra cost?
5. What evidence proves the work, incident, delay, delivery, or cost exposure?
6. Which payroll, billing, change-order, compliance, warranty, or dispute packet should be reviewed?

DPF should model these as a projection over shared Field Ops capabilities:

| Layer | Reusable substrate | Construction projection |
|---|---|---|
| Expected presence | `BI-FIELDOPS-001` | Jobsite/project/phase/crew/truck/subcontractor/supplier commitments |
| Eligibility | `BI-FIELDOPS-002` | OSHA/safety training, PPE, toolbox talks, subcontractor compliance, task/site eligibility |
| Daily work record | `BI-FIELDOPS-003` | Foreman daily log with manpower, subcontractors, weather, materials, equipment, photos, incidents |
| Evidence packet | `BI-FIELDOPS-004` | Payroll, certified payroll, billing, change-order, backcharge, warranty, incident, dispute packets |
| Manager console | `BI-FIELDOPS-005` | PM/foreman console for schedule risk, cost leakage, exceptions, and evidence completeness |

## Live BI Inventory

Reusable BIs filed under `EP-FIELD-OPS-SUBSTRATE`:

- `BI-FIELDOPS-001` - Expected presence for people, assets, external parties, and site/route commitments.
- `BI-FIELDOPS-002` - Credential, training, license, and task-eligibility evidence engine.
- `BI-FIELDOPS-003` - Mobile daily log and field evidence capture.
- `BI-FIELDOPS-004` - Evidence packet generator for payroll, billing, compliance, claims, and disputes.
- `BI-FIELDOPS-005` - Operations manager console pattern for sites, routes, crews, assets, exceptions, and cost leakage.

Construction-specific BIs filed under `EP-VERTICAL-CONSTRUCTION`:

- `BI-CON-FIELD-001` - Jobsite readiness model for project, phase, crew, truck, equipment, supplier, subcontractor, and inspection state.
- `BI-CON-FIELD-002` - Jobsite presence, time clock, cost-code, and payroll evidence capture.
- `BI-CON-FIELD-003` - Safety, OSHA training, PPE, toolbox talk, incident, and site eligibility evidence workflow.
- `BI-CON-FIELD-004` - Crew, truck, equipment, tool, and material assignment against schedule and job phase.
- `BI-CON-FIELD-005` - Subcontractor and supplier coordination cockpit.
- `BI-CON-FIELD-006` - Foreman daily log and photo/file evidence capture.
- `BI-CON-FIELD-007` - Cost leakage and change-order candidate detector.
- `BI-CON-FIELD-008` - Public-work certified payroll and compliance readiness.

Existing BIs cross-referenced:

- `EP-TRADES-FIELD-SERVICE` was retagged as multi-archetype because field-dispatch primitives apply beyond trades.
- `BI-69A992A4` was retagged as reusable FieldDispatchProfile substrate.
- `EP-E2866100` and `BI-5FE4FA8A` were retagged as multi-archetype truck inventory/asset-assignment substrate.

## Acceptance Direction

The construction projection is satisfactory when:

- A PM or foreman can see today's expected jobsite commitments by project/phase/site area.
- Hourly employees can clock in/out against project and cost-code contexts while salary workers and subcontractors can still be represented correctly.
- Contingent worker/subcontractor presence does not accidentally become employee payroll evidence.
- OSHA/safety/training/PPE/toolbox/incident records are structured enough to form evidence packets.
- Trucks, tools, equipment, and material deliveries reconcile against expected work.
- Supplier/subcontractor misses create visible schedule-risk and backcharge/change-order candidates.
- Daily logs can be completed from a field-mobile posture and reviewed from an owner/PM posture.
- Public-work/certified-payroll evidence is generated only when the job's applicability gate requires it.
- AI coworkers draft claims, billing packets, compliance packets, and change-order candidates with citations, never silent submission.

## Refactoring Notes

This pass deliberately spent architecture effort on reuse:

- Field operations is a shared substrate, not another construction-only module.
- Truck inventory and field dispatch were retagged instead of duplicated.
- Credential evidence should extend People/HCM, licensing/permit readiness, and document evidence surfaces.
- Evidence packets should compose existing finance/payroll/compliance records, not invent a new generic blob.
- The manager console should reuse report-kit/table/status components when implemented.

## Open Implementation Questions

- Which existing work item, inventory, workforce, payroll, and document models should own each field-operation datum?
- Should jobsite areas/phases be represented as generic `Site/Location/Zone` primitives or construction-specific project phases with adapters?
- What is the smallest mobile/offline capture slice that proves foreman adoption?
- Which evidence packets belong in common Field Ops and which remain construction-only variants?
- How should certified payroll applicability be inferred or confirmed without asking non-technical users legal questions?
