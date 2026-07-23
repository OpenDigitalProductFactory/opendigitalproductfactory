# Fabric Care Services Archetype - Dry Cleaning Plant and Store Network

**Date:** 2026-07-22
**Status:** Proposed for implementation
**Backlog anchor:** `BI-7CFFC421`
**Area:** `packages/storefront-templates` archetype taxonomy + profession corpus
**Decision surface:** `archetype-taxonomy-design` (`principle_decide`, ledger `DI-A32448993543`)

## Goal

Add DPF coverage for dry-cleaning and fabric-care operators whose work depends
on customer-owned garment custody, claim-ticket control, central plant
processing, satellite stores, pickup/drop-off, ready estimates, and ready
notifications.

The keystone model is a multi-location dry cleaner: satellite counters receive
garments, issue claim tickets, route the work to a central cleaning plant, and
notify the customer when the order is ready or when the promised date changes.
The category leaves room for adjacent fabric-care services such as wash-and-fold
laundry, alterations, shoe/bag cleaning, and seasonal textile storage.

## Business landscape

Fabric care is neither ordinary retail nor ordinary appointment checkout. The
unit of work is a **customer-owned garment or order lot** that enters the
operator's custody, receives a ticket/tag identity, moves through one or more
locations, and must be returned to the right customer in the right condition.

Typical operating loop:

1. Customer drops off garments at a store, locker, hotel desk, route pickup, or
   delivery collection.
2. Counter staff create an order, inspect garments, record service instructions,
   apply tags, price the work, and issue a claim ticket.
3. Orders are sorted and routed to the plant or specialty station.
4. Staff clean, wet-clean, launder, press, fold, repair, or package items.
5. Finished garments are assembled back to the order, exceptioned when missing
   or delayed, and routed back to the pickup location or delivery route.
6. Customers receive ready, delayed, or estimated-ready notifications.
7. Pickup or delivery closes the chain of custody and the point-of-sale/payment
   loop.

The plant/store topology creates distinctive control problems:

- **Garment identity:** tags, barcodes, lot/order membership, color/fabric/care
  instructions, stains, alterations, and customer notes.
- **Custody:** the operator holds goods it does not own and is accountable for
  loss, mix-ups, delays, damage, and customer claims.
- **Location routing:** work flows among drop stores, central plant, specialty
  stations, route vehicles, lockers, and customer pickup points.
- **Promise management:** ready dates are estimates until the plant clears the
  order; the customer-facing system must distinguish promised, estimated,
  delayed, ready, picked up, and delivered.
- **Counter efficiency:** claim tickets, order lookup, payment, reprint,
  exception handling, and customer communication must be fast at the front desk.
- **Service mix:** dry cleaning, wash-and-fold, laundry by pound, press-only,
  alterations, wedding gown preservation, household textiles, shoe/bag service,
  and pickup/delivery subscriptions.

## Market benchmark

Incumbent dry-cleaning systems converge on the same functional spine:

| Player | Capabilities emphasized | DPF lesson |
| --- | --- | --- |
| [CleanCloud](https://cleancloudapp.com/) | POS, pickup and delivery, routes, barcode tagging, plant/multi-store workflows, assembly, automated communication, marketing, and reporting. | The archetype must treat garment tracking and plant/store flow as first-class, not a generic service inquiry. |
| [Xplor Spot](https://www.xplorspot.com/) | Dry-cleaning POS, customer communication, route management, payments, and reporting for cleaners. | Counter POS, messaging, and route operations are one operating system. |
| [SMRT Systems](https://www.smrtapp.com/) | Cloud dry-cleaning software with route management, plant production, lockers, customer app, texting, and multi-store controls. | Store, plant, route, locker, and customer app are one custody network. |
| [Geelus](https://www.geelus.com/) | Dry-cleaning and laundry POS with garment tracking, pickup/delivery, orders, tags, invoices, and customer notifications. | Claim-ticket and tag identity are the join between physical garments and customer communication. |

The official service taxonomy also groups these activities together. The Census
NAPCS 8123 product list includes dry-cleaning agency drop-off and pick-up
services, dry-cleaning services, garment alteration and repair, shoe repair, and
seasonal fur/fabric storage in the dry-cleaning/laundry service family. Source:
[Census NAPCS 8123 product list](https://www2.census.gov/library/reference/napcs/product-list/web-8123-final-reformatted-edited-us052709.pdf).

## Standards and compliance baseline

The initial archetype does not implement compliance workflows, but the WSID
corpus and future coworkers need grounded professional doctrine.

- The [FTC Care Labeling Rule guidance](https://www.ftc.gov/business-guidance/resources/clothes-captioning-complying-care-labeling-rule)
  makes care-label interpretation a real operational input.
- [OSHA dry-cleaning guidance](https://www.osha.gov/dry-cleaning) covers worker
  hazards such as solvents, fire, ergonomics, slips, and machine/pressing risks.
- EPA's [perchloroethylene risk management rule](https://www.epa.gov/assessing-and-managing-chemicals-under-tsca/risk-management-perchloroethylene-pce)
  creates a regulatory transition context for cleaners that still use PCE.
- Garment identification can reuse standard barcode/QR/RFID concepts, but the
  first archetype should not claim GS1/RFID execution depth. That belongs to a
  future plant-execution capability.

## Taxonomy decision

`ArchetypeCategory` is a closed union read by the storefront, finance,
profession-corpus, workspace, marketing, and demo systems. The shape was routed
through `principle_decide` for `ring-3-archetype` and `universal-ring`.

Options considered:

1. **New category: `fabric-care-services`** - customer-owned garment custody,
   processing, notification, and plant/store routing.
2. **Leaf under `beauty-personal-care`** - treat dry cleaning as a consumer
   service counter.
3. **Leaf under `warehousing-fulfilment`** - treat garments as goods in custody.
4. **Axis-only existing category** - avoid a category and express the business
   as a variant of existing physical service templates.

Result: `principle_decide` recommended **new-category-fabric-care** with high
confidence, composite **5.999**, margin **2.111**, no commandment conflict.

The rejected options fail for concrete reasons:

- `beauty-personal-care` centers appointment checkout and provider time. Dry
  cleaning centers order custody and plant flow.
- `warehousing-fulfilment` is B2B storage/fulfilment for inventory clients. Dry
  cleaning is household or local-business garment service with customer pickup
  and claim-ticket control.
- Axis-only reuse would hide the plant/store topology behind a generic service
  label, increasing long-term vocabulary and capability debt.

## Design

### Category

Add `fabric-care-services` as a new `ArchetypeCategory`.

Discriminator: the operator takes temporary custody of customer-owned fabric,
garments, textiles, shoes, or bags; performs a service on those items; then
returns the same items to the customer.

### Initial leaves

Ship three leaves in the first pass:

- `dry-cleaning-plant-network` - the keystone leaf for central plant plus
  satellite/drop stores, claim tickets, garment tags, pickup/drop-off, ready
  notification, and value-added garment care.
- `wash-and-fold-laundry` - consumer or commercial laundry by bag/pound, folded
  or packaged for pickup/delivery.
- `alterations-tailoring` - garment alteration and repair, with fittings as a
  bookable sub-flow but order custody as the primary work.

Defer specialty leaves unless the implementation remains small after the three
core leaves:

- `shoe-bag-cleaning-repair`
- `wedding-gown-preservation`
- `household-textile-cleaning`

### Activation profile

Initial profile should use existing substrate first:

- `form`: `services`
- `delivery`: `physical`
- `primaryConsumer`: `individual`
- `consumptionChannel`: `multi-channel`
- `commercialModel`: `point-of-sale`
- `provisioning`: reuse `account-with-billing` for the first pass
- `modules`: `customer-estate`, `service-operations`, `billing-readiness`, and
  `integrations`
- `customerGraph`: `separate-customer-projection`
- `estateSeparation`: `strict`

The profile intentionally does **not** add a schema enum in this first slice.
The honest long-term model is a future provisioning value such as
`custody-and-return-service`, but adding it now would require capability,
value-stream, finance, and twin decisions larger than the first archetype needs.
Instead, the design records the gap and keeps the first pass additive.

### Value stream

The archetype defaults should emphasize:

- commercial model: point-of-sale with prepared billing readiness for accounts,
  subscriptions, hotels, and commercial laundry customers;
- demand: neighborhood repeat demand with peaks around weekends, holidays,
  weather, weddings/events, and hotel/commercial cycles;
- capacity: plant throughput, counter queue, route capacity, and garment
  assembly/exception work.

No new `CapacityUnitType` is required in the first pass. A later plant-execution
capability can introduce garment-piece, bag-pound, press-station, or route-stop
capacity units once the runtime actually models those queues.

### Storefront UX

The public storefront should seed:

- locations and hours as prominent information, since customers decide by
  convenience and pickup windows;
- services and value-added care lines;
- pickup and delivery inquiry;
- alterations/fitting or repair request forms;
- customer instructions for stains, fabrics, deadlines, and special handling;
- gallery/facility photos where helpful, without relying on dark stock imagery.

Vocabulary should use **Customers**, **Garments**, **Services**, **Orders**, and
**Fabric Care Team** rather than generic "items" where the category can tailor
copy.

### Customer communication

The archetype should prime later workflow features for:

- claim ticket issued;
- order received at plant;
- delayed/exception;
- ready for pickup;
- out for delivery;
- picked up/delivered;
- customer claim or rework.

The first pass can express these in corpus and seeded service descriptions; it
does not need a new notification engine.

## Four-dimension provisioning plan

### 1. Template substrate

Add the category, module registration, initial leaves, and category-keyed
consumer entries required by the archetype completeness gate:

- `packages/storefront-templates/src/types.ts`
- `packages/storefront-templates/src/archetypes/fabric-care-services.ts`
- `packages/storefront-templates/src/archetypes/index.ts`
- `packages/db/src/wiki-taxonomy.ts`
- `apps/web/lib/storefront/industries.ts`
- `packages/finance-templates/src/profiles.ts`
- `packages/storefront-templates/src/operational-value-stream.ts`
- `packages/storefront-templates/src/twin-profile.ts`

Populate graceful-default consumers where they materially improve UX:

- `apps/web/lib/storefront/archetype-vocabulary.ts`
- `apps/web/lib/tak/marketing-playbooks.ts`
- `apps/web/lib/onboarding/archetype-business-context.ts`
- `apps/web/lib/workspace-home/profiles.ts`
- `packages/db/src/portfolio-sources/archetype-supply-manifest.ts`
- `packages/storefront-templates/src/demo-flavor.ts`

### 2. Profession corpus

Add at least one WSID page under `docs/professions/operations/wiki/` with
`professionArchetype: ["fabric-care-services"]`.

Initial page:

- `fabric-care-garment-custody-and-ready-promise.md` - garment intake, care
  label check, claim-ticket/tag discipline, plant/store routing, ready estimate,
  delay notification, and pickup/delivery closure.

The page cites open-class sources only: Census NAPCS, FTC care-label guidance,
OSHA dry-cleaning guidance, EPA PCE rule, and incumbent public product pages.

### 3. AI coworker decision

Record this decision in `scripts/archetype-coworker-decisions.txt`:

`fabric-care-services    extends:dispatcher`

Rationale: the existing operations/dispatcher coworker is the closest fit for
intake, queue, route, and exception coordination. A dedicated Fabric Care
Operations Coordinator is warranted only after DPF has native plant-production
and garment-status tools for it to operate. File a future BI if implementation
reveals the existing dispatcher vocabulary is too generic.

### 4. Skills and tools

No new executable skill is required in the first pass. The WSID corpus gives the
existing dispatcher/customer-success coworkers grounded fabric-care practice.

File follow-up BIs rather than premature tools for:

- garment tag/claim-ticket workflow;
- plant production board;
- pickup/delivery route notifications;
- customer claim/rework handling;
- PCE/solvent transition checklist.

## Touchpoints expected

Required by gate or tests:

- `packages/storefront-templates/src/types.ts` - category union.
- `packages/storefront-templates/src/archetypes/fabric-care-services.ts` -
  three leaves and shared activation profile.
- `packages/storefront-templates/src/archetypes/index.ts` - module registration.
- `packages/storefront-templates/src/archetypes/archetypes.test.ts` - catalog
  assertion for leaves and dry-cleaning operating model.
- `packages/db/src/wiki-taxonomy.ts` - profession archetype axis.
- `apps/web/lib/storefront/industries.ts` - industry option.
- `packages/db/test/seed-storefront-archetypes.test.ts` if category-count or
  seed assertions need adjustment.
- `scripts/archetype-coworker-decisions.txt` - recorded coworker decision.
- `docs/professions/operations/wiki/fabric-care-garment-custody-and-ready-promise.md`.

Likely graceful-default touchpoints:

- `packages/finance-templates/src/profiles.ts`
- `packages/storefront-templates/src/operational-value-stream.ts`
- `packages/storefront-templates/src/twin-profile.ts`
- `apps/web/lib/storefront/archetype-vocabulary.ts`
- `apps/web/lib/tak/marketing-playbooks.ts`
- `apps/web/lib/onboarding/archetype-business-context.ts`
- `apps/web/lib/workspace-home/profiles.ts`
- `packages/storefront-templates/src/demo-flavor.ts`
- `packages/db/src/portfolio-sources/archetype-supply-manifest.ts`

## Non-goals

- Full dry-cleaning POS or plant-production execution.
- Barcode/RFID inventory engine.
- Delivery route optimizer.
- Solvent compliance management system.
- PCE remediation or legal advice.
- A claim-liability adjudication engine.
- A schema migration for garment entities.
- A new AI coworker lifecycle in this PR.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Template-only archetype ships shallow. | Use the four-dimension provisioning playbook; run `node scripts/check-archetype-completeness.mjs`. |
| Category duplicates warehousing custody semantics. | Keep `fabric-care-services` scoped to service-and-return of household/local garments, not B2B inventory storage. |
| Existing `account-with-billing` hides a future custody axis. | Record `custody-and-return-service` as future substrate; avoid schema churn until a plant-execution capability needs it. |
| Compliance content becomes invented advice. | WSID page cites official sources and frames regulatory notes as operational awareness, not legal advice. |
| Storefront UX stays generic. | Add category vocabulary, realistic service templates, location/hours prominence, and dry-cleaning-specific form fields. |
| Worktree cannot prove runtime gates locally. | Use source-local tests here and route runtime-bound build/UX gates through governed shared sandbox/canonical install before merge-ready claims. |

## Verification

Minimum source-local evidence:

- `pnpm --filter @dpf/storefront-templates exec vitest run src/archetypes/archetypes.test.ts`
- `pnpm --filter @dpf/db exec vitest run test/seed-storefront-archetypes.test.ts src/portfolio-sources/project-archetype-supply.test.ts`
- targeted web tests for industry/vocabulary/onboarding files touched
- `node scripts/check-archetype-completeness.mjs`

Completion evidence before PR readiness:

- source-local targeted tests pass;
- production build passes in the governed shared sandbox or canonical path;
- any UI-facing route touched has UX verification;
- no migration is added unless a later plan explicitly approves it;
- docs/user-guide impact is either updated or recorded as no-docs-needed because
  this change only exposes a new setup archetype option.
