# Four-Portfolio Archetype Standard — Profile Catalog

**Standard:** [Four-Portfolio Archetype and AI Workforce Operating Standard](four-portfolio-archetype-ai-workforce-operating-standard.md)
**Catalog version:** Candidate 0.1.0
**Inventory snapshot:** 2026-08-08 — 25 categories, 107 unique implemented leaves
**Archetype source:** `packages/storefront-templates/src/archetypes/` at
`4b40416fefb787389a06c2afdf252764cfdffc81`
**Authority boundary:** the storefront-template archetype registry owns category and leaf identity;
this document is a dated, mechanically checkable profile projection

IT4IT™ is a trademark of The Open Group. The mark is used only for accurate editorial reference
to the IT4IT Reference Architecture; no affiliation, endorsement, certification, or trademark
license is claimed.

## 1. Purpose

This catalog makes the core standard recognizable and usable across DPF's implemented industries
without publishing 106 repetitive standards. Each organization composes:

```text
core requirements
  + reusable facet profiles
  + one or more category baselines
  + genuine leaf deltas
  + organization, jurisdiction, contract, and deployment overlays
```

The catalog is both a communication aid and a conformance target. It says what each archetype profile
must cover; it does not claim that today's implementation already has operational evidence for every
field.

## 2. Facet registry

Facet IDs are stable within the catalog major version. A leaf may select several facets on an axis.
Selection never weakens a core requirement.

### 2.1 Commercial and public-value facets

| ID | Pattern | Typical promise |
|---|---|---|
| `COM-TRANSACTION` | one-time transaction | transfer a good or complete a bounded service for payment |
| `COM-SUBSCRIPTION` | subscription/usage | continuing access or service against recurring/usage terms |
| `COM-RECURRING` | recurring agreement/retainer | repeated service under an ongoing commitment |
| `COM-APPOINTMENT` | appointment/encounter/episode | reserve qualified capacity for a person, patient, animal, asset, or site |
| `COM-PROJECT` | scoped project/case/milestone | deliver an accepted outcome through staged professional or construction work |
| `COM-MEMBERSHIP` | membership/cooperative | continuing access and shared/member governance |
| `COM-RENTAL` | temporary use/custody | grant time-bounded use of a reusable asset or space |
| `COM-DONATION` | gift/grant/program | accept funds or resources without an ordinary sale and deliver mission value |
| `COM-STATUTORY` | statutory/public entitlement or fee | provide mandated or civic value under public authority |
| `COM-HYBRID` | composed offer | combine goods, services, access, projects, and/or recurring commitments |

### 2.2 Delivery topology facets

| ID | Pattern | Load-bearing distinction |
|---|---|---|
| `DEL-DIGITAL-TENANT` | digital self-service or tenant | identity, entitlement, availability, version, support, data boundary |
| `DEL-FACILITY` | facility encounter | appointment/walk-in demand against rooms, chairs, bays, beds, or staff |
| `DEL-FIELD` | field dispatch | triage, skill/location/parts fit, assignment, travel, onsite work, closeout |
| `DEL-PRODUCTION` | production/assembly/processing | recipe/BOM, materials, equipment, quality, throughput, waste/rework |
| `DEL-RETAIL` | retail/POS/owned inventory | browse/order, owned stock, fulfillment, payment, return |
| `DEL-WAREHOUSE` | warehouse/fulfillment | dock, receive/store, pick/pack, dispatch, custody and meter evidence |
| `DEL-ROUTE` | transport/logistics route | origin/destination, capacity, chain of custody, route, proof of delivery |
| `DEL-PROFESSIONAL` | professional case/engagement | qualify, scope, analyze/create, review/approve, deliver, retain |
| `DEL-CLASS` | class/cohort/learning | enrolment, instructor/facility capacity, delivery, progress, completion |
| `DEL-EVENT` | event/media/venue | holds, schedules, rights, crews/equipment, live execution, settlement |
| `DEL-PUBLIC` | civic/member/public service | eligibility, fairness, public record, fee/benefit, accountability |

### 2.3 Resource, asset, and custody facets

| ID | Pattern | Minimum state/evidence |
|---|---|---|
| `RES-PEOPLE-TIME` | scarce qualified time | schedule, proficiency/credential, availability, workload, handoff |
| `RES-FACILITY` | scarce place/space | location, access, capacity, condition, safety, maintenance |
| `RES-OWNED-STOCK` | provider-owned goods | item/lot, quantity, cost, location, availability, transfer/return |
| `RES-PERISHABLE` | expiring/temperature-sensitive stock | lot, dates, temperature/condition, waste, recall |
| `RES-REUSABLE-ASSET` | pooled/rentable asset | identity, reservation, checkout, condition, return/inspection, re-pool |
| `RES-CLIENT-CUSTODY` | customer/member-owned item | owner, custodian, receipt, condition, location, transfer, discrepancy |
| `RES-FLEET` | vehicle/mobile inventory | vehicle, driver/operator, route, capacity, maintenance, mobile stock |
| `RES-CAPITAL-PROJECT` | site/project works | site, design/version, permits, materials, subcontractors, inspections, handover |
| `RES-REGULATED-RECORD` | protected or authoritative record | subject, purpose, classification, provenance, access, retention, correction |
| `RES-DIGITAL-SERVICE` | DigitalProduct/service dependency | product/version, instance, entitlement, SLO, dependency, incident |

### 2.4 Workforce and allocation facets

| ID | Pattern | Default intent |
|---|---|---|
| `WRK-HUMAN-LED` | human-led | people remain primary executors; AI is optional or bounded support |
| `WRK-AUGMENTED` | human-AI augmentation | shared outcomes with explicit activity split and handoffs |
| `WRK-AI-PRIMARY` | AI-primary | qualified AI executes bounded work; humans approve, handle exceptions, or oversee as required |
| `WRK-AUTONOMOUS` | bounded autonomous | AI executes within a TAK ceiling with surveillance and fallback |
| `WRK-ROBOT` | robot-enabled physical | performer identity plus asset/controller/safety and human recovery |
| `WRK-PARTNER` | partner-delivered | external execution with contract, boundary, internal accountability, and exit |
| `WRK-MIXED` | composed team | human, AI, robot, automation, and/or partner responsibilities compose |
| `WRK-ZERO-EMPLOYEE` | no employee executor | organizational/legal accountability persists; capacity and fallback remain explicit |

### 2.5 Trust and control facets

| ID | Boundary |
|---|---|
| `TRU-PRIVACY` | personal/sensitive data, consent, purpose, minimization, access, retention |
| `TRU-PROFESSIONAL` | licensed or profession-bounded work and advice |
| `TRU-SAFETY` | physical harm, hazard, emergency, equipment, site, safe-state controls |
| `TRU-CLINICAL` | clinical judgment, patient/animal safety, records, escalation, crisis boundaries |
| `TRU-FINANCIAL` | identity/KYC, credit/financial decisions, disclosures, model risk, adverse action |
| `TRU-CUSTODY` | ownership, possession, condition, segregation, loss/damage, chain of custody |
| `TRU-PUBLIC` | public authority, fairness, records, due process, universal/service obligations |
| `TRU-MEMBER` | member/cooperative rights, equitable allocation, governance, conflicts |
| `TRU-RIGHTS` | intellectual-property, likeness, usage, contract, approval, accessibility |
| `TRU-CHILD-VULNERABLE` | safeguarding, capacity/consent, crisis, beneficiary sensitivity |
| `TRU-ENVIRONMENT` | environmental license, waste, emissions, hazardous material, contamination |

### 2.6 DigitalProduct/CSDM deployment facets

| ID | Pattern |
|---|---|
| `DIG-STANDALONE` | standalone DigitalProduct/service |
| `DIG-PLATFORM-HOSTED` | capability hosted by a shared platform Product/instance |
| `DIG-MICROSERVICE` | composite of independently versioned services/components |
| `DIG-SHARED-SERVICE` | shared internal technology or employee service |
| `DIG-EDGE` | client/device/vehicle/site/edge deployment |
| `DIG-FEDERATED-AI` | external Agent/model/service with governed local boundary |
| `DIG-HYBRID-AI` | local and external agents/models/tools/data compose |
| `DIG-MULTI-INSTANCE` | one Product/version deployed into several runtime instances |

## 3. Shared value-stream overlays

The six-stage macro-backbone remains the default. These overlays express the industry-recognizable
differences that should be reused rather than reimplemented per leaf:

| Overlay | Added or refined value transitions |
|---|---|
| `OVL-APPOINTMENT-EPISODE` | eligibility/intake → reserve qualified capacity → encounter → follow-up/plan |
| `OVL-FIELD-DISPATCH` | triage → skill/location/parts match → assign → en-route → onsite → closeout |
| `OVL-CLASS-MEMBERSHIP` | enrol/join → cohort/class/resource schedule → participation/progress → renew/complete |
| `OVL-PROJECT-MILESTONE` | qualify → scope/design → commit → staged delivery/review → accept/milestone settle |
| `OVL-POS-INVENTORY` | browse/quote → reserve/pick → transfer/checkout → return/exchange |
| `OVL-DONATION-NO-INVOICE` | solicit/accept gift → acknowledge/receipt → allocate to program → report impact |
| `OVL-MEMBER-PUBLIC` | request/eligibility → fair allocation/decision → deliver statutory/member value → record/appeal |
| `OVL-KYC-DECISION` | disclose/consent → identify/verify → assess/decide → communicate/book → monitor/service |
| `OVL-RENTAL-RETURN` | reserve/verify → checkout → use → return/inspect → charge/re-pool |
| `OVL-RECEIVE-STORE` | schedule dock → receive/verify → locate/store → pick/pack → dispatch/reconcile |
| `OVL-ITEM-CUSTODY` | receive/tag/inspect → route/process → ready promise → return/claim |
| `OVL-EVENT` | hold/date/capacity → contract/ticket → produce/live execute → settle/rights close |
| `OVL-DIGITAL-TENANT` | discover/trial → provision/entitle → adopt/use → support/operate → expand/renew |

## 4. Category baselines

Each row states the base profile. Leaf deltas in Section 5 refine, but do not replace, it.

| Category (leaves) | Goods/services for sale and core flow | Delivery/capacity/resources | Trust and specialization boundary |
|---|---|---|---|
| `healthcare-wellness` (9) | episodes of human or animal care; intake → schedule → encounter → plan/follow-up | appointments, providers, rooms, patient/animal records, mobile/site variants | clinical/privacy/crisis controls; clinical decision and specimen/DME deltas |
| `beauty-personal-care` (6) | practitioner time and personal care, sometimes retail goods; book → service → checkout → rebook | providers, chairs/rooms, mobile routes, consumables | hygiene, licensing, no-show, vulnerable-client and mobile-site boundaries |
| `trades-maintenance` (11) | property repair/maintenance plus parts; triage → quote → dispatch → fix → invoice/contract | technicians/crews, vans, truck stock, sites, equipment | trade license, site safety, environmental/pesticide/fall/utility controls |
| `professional-services` (8) | expertise, engagements, retainers, projects and cases; qualify → scope → deliver/review → settle → renew | people-time, cases, documents, client estate, field inspections | regulated advice, confidentiality, conflicts, evidence and client-estate isolation |
| `software-platform` (1) | SaaS/platform access; discover/demo/pilot → provision/adopt → operate/improve → renew | tenant, DigitalProduct/service, support and provider capacity | product security, privacy, availability, change and SLA controls |
| `education-training` (4) | learning/skill acquisition; inquiry/enrol → schedule → deliver → progress/complete/renew | learners, instructors, rooms, classes, vehicles for driving | safeguarding, credentials, assessment integrity and accessibility |
| `pet-services` (5) | care for named animals; book/date/recurring/mobile → care → return/follow-up | animal record, provider, kennel/room, route | welfare, custody, veterinary/clinical and owner-consent controls |
| `food-hospitality` (3) | meals, catering and baked goods; reservation/POS/quote-project patterns coexist | tables, kitchen, perishable stock, crew, venue and delivery | allergen, food safety, sanitation, event duty and perishable evidence |
| `retail-goods` (5) | owned merchandise, trade supply, floral/artisan goods and install; browse/quote → fulfill/deliver → return | stock, store, suppliers, installers, vehicles | product safety, delivery, trade-account, installation and returns |
| `fitness-recreation` (3) | membership, classes and coached sessions; join → schedule/use → progress → renew | instructor, facility, equipment and class capacity | age, emergency/contact, health/safety, accessibility and safeguarding |
| `nonprofit-community` (8) | donations/program value or member/cooperative access; gift receipt/no invoice, program delivery, member governance | volunteers, beds, programs, donated goods, shared machinery | beneficiary sensitivity, safeguarding, donor restriction and member fairness |
| `hoa-property-management` (3) | governance/property services, dues, amenities and resident requests | properties, units, amenities, boards, vendors, maintenance | covenants, landlord/tenant and owner/board authority, equitable allocation |
| `banking-financial-services` (3) | accounts, relationships and loans; disclose/KYC → open/originate → service/monitor | customer/account/loan records, decision and review capacity | financial regulation, model risk, adverse action, privacy and no unqualified advice |
| `public-sector` (3) | statutory/civic/utility/public-safety service; request/eligibility → fee/decision → service → record/appeal | territory, infrastructure, public records, officers/crews | due process, universal service, public records, public-safety and authority boundaries |
| `asset-rental` (3) | temporary use of assets/storage; reserve → verify → checkout → use → return/inspect → re-pool | serialized/pooled fleet, units, yard, condition, deposits | identity, damage, equitable member allocation, custody and site safety |
| `real-estate-construction` (2) | built homes; discover/tour → design/contract → jobsite build → draws → handover/warranty | sites, crews, subcontractors, materials, equipment | permit/license, payroll, inspection, safety, lien/payment and handover evidence |
| `automotive-services` (6) | mobile vehicle restoration/security service; vehicle intake → part/skill match → dispatch → fix → close | technicians, vans, vehicle/VIN, parts and roadside conditions | ADAS, towing/DOT, locksmith bonding, roadside and vehicle-safety controls |
| `moving-and-logistics` (5) | moving, haul, parcel/freight delivery and brokerage; estimate/account → assign/load/route → deliver/settle | people, trucks, parcels/goods, carriers, routes | DOT/hours, custody, proof of delivery, disposal and brokerage boundaries |
| `security-services` (2) | guard/patrol/response or alarm/CCTV install/monitor | guards, technicians, sites, routes, alarm assets, evidence | licensing, incident evidence, privacy/surveillance, bonding and escalation |
| `media-production` (3) | produced creative/technical outcomes; brief/scope → schedule/produce → review/version → deliver/milestone | crews/artists, studios/suites, equipment, media assets | rights, likeness/usage, client approval, confidentiality and staging safety |
| `live-events-venues` (3) | venue/show/talent access; hold/date/capacity → ticket/booking → event → settlement | venues, talent, staff, equipment, ticket/guest capacity | event safety, accessibility, crowd/duty, contracts, rights and conflicts |
| `warehousing-fulfilment` (4) | custody, storage and handling—not client goods; dock → receive/store → pick/pack → dispatch → meter/bill | docks, racks, client stock, carriers, labor/equipment capacity | segregation, counts, cold-chain, bonded/customs, custody and discrepancy |
| `fabric-care-services` (3) | service on customer-owned garments; receive/tag → route/process → ready promise → return/claim | garments, claim tickets, plant/bays, routes, chemicals | chain of custody, care labels, damage/delay, solvent/environmental and alteration fit |
| `agriculture-ranching` (3) | crops, forage, livestock and bounded field/custom services; observe → plan → ready → execute/record → harvest/sell/service → review | land/fields/pastures, herds/animals, seasonal labor, equipment/implements, material lots, suppliers and custom operators | animal welfare/veterinary authority, pesticide/environment, withdrawal/food-feed trace, worker/machine safety, market uncertainty and human approval |
| `manufacturing` (1) | configured and standard industrial equipment, prototypes, spares and support; qualify → engineer/release → make/test → ship → support | production lines, cells, stations, people, equipment, tooling, material, WIP and suppliers | worker/machine safety, engineering release, quality disposition, traceability and no implied industrial-control authority |

## 5. Leaf-delta register

Each line records the genuine delta the leaf profile must make visible. It is not a substitute for the
category baseline or the source archetype definition.

### 5.1 Healthcare and wellness (9)

- `veterinary-clinic` — animal patient plus owner/guardian, species/weight/medication context,
  clinical encounter, welfare and veterinary authority.
- `dental-practice` — chair/provider capacity, imaging/procedure/treatment plan, sterilization and
  dentist/hygienist activity boundaries.
- `medical-practice` — human clinical encounter, diagnosis/treatment/referral boundaries, protected
  record and urgent escalation.
- `physiotherapy` — assessed plan of care, repeated sessions, progress/outcome measures, exercise and
  practitioner scope.
- `counselling` — confidential sessions, therapeutic plan, crisis/safeguarding escalation, consent
  and highly sensitive notes.
- `optician` — examination/prescription plus frames/lenses goods, clinical/retail split, fitting and
  fulfillment.
- `home-health-care` — field visits to a residence, care plan, worker/patient safety, schedule and
  visit verification.
- `mobile-phlebotomy` — dispatch, patient identity, specimen collection/label/custody/temperature,
  lab handoff and failed-draw evidence.
- `dme-delivery` — prescribed/eligible durable medical equipment, owned/serialized goods, delivery,
  setup/training, service and recovery.

### 5.2 Beauty and personal care (6)

- `hair-salon` — chair/stylist schedule, service formula/history, chemical/hygiene controls, retail
  product add-on.
- `barber-shop` — walk-in/appointment chair flow, rapid repeat service, hygiene and practitioner
  availability.
- `nail-salon` — station/technician schedule, chemical/infection controls and repeated service
  history.
- `beauty-spa` — rooms/equipment, multi-service packages, contraindication/consent and treatment
  boundaries.
- `personal-trainer` — individual/session/package commitments, facility or field delivery, health
  context, progress and safety.
- `mobile-beauty` — provider route, client-site conditions, portable stock/equipment, travel and
  worker/client safety.

### 5.3 Trades and maintenance (11)

- `facilities-maintenance` — multi-site planned/reactive work, asset register, vendor/crew assignment,
  preventive schedule and service evidence.
- `plumber` — water/gas/site isolation, parts/fixtures, code/license boundaries, leak/damage evidence.
- `electrician` — electrical isolation, permit/license, energized-work safety, inspection and test
  evidence.
- `cleaning-service` — recurring site schedule, crew, chemicals/equipment, access/security, checklist
  and quality inspection.
- `landscaping` — route/crew/equipment, seasonal plan, weather, property access and pesticide/safety
  overlays.
- `hvac-contractor` — skill/parts dispatch, refrigerant/environmental license, readings, repair/test,
  maintenance agreement.
- `pest-control` — site/pest diagnosis, regulated chemical selection/application, occupant/pet risk,
  notice and follow-up.
- `appliance-repair` — appliance/model/part fit, technician dispatch, electrical/gas safety, warranty
  and repair verification.
- `pool-spa-service` — recurring route, chemistry readings, chemical stock, site access, water/safety
  controls.
- `pressure-washing` — site/material assessment, water/chemical/environmental controls, equipment and
  damage prevention.
- `roofing-gutters` — estimate/project plus crew/material delivery, weather, fall protection,
  inspection and warranty.

### 5.4 Professional services (8)

- `it-managed-services` — client-estate isolation, recurring service commitments, alerts/incidents,
  privileged access, change and vendor dependencies.
- `legal-services` — matter/client/conflict, privilege, jurisdiction/advice boundary, deadlines,
  review/filing authority and evidence.
- `accounting` — engagement/period close, source records, reconciliation, tax/advice boundaries,
  approval and retention.
- `marketing-agency` — campaign/project, brand and audience context, content approval, channel rights,
  performance and spend evidence.
- `consulting` — qualify/scope, milestone deliverables, analysis/recommendation boundaries, client
  acceptance and knowledge transfer.
- `field-inspection` — inspector credential, site dispatch, checklist/observation, geospatial/photo
  evidence and finding escalation.
- `land-surveying` — licensed survey scope, field crew/equipment, control points, legal descriptions,
  precision and signed deliverable.
- `process-serving-notary` — identity/jurisdiction, document custody, attempt/event evidence,
  notarization/service authority and affidavit.

### 5.5 Software platform (1)

- `software-platform` — DigitalProduct/Product alignment, tenant/entitlement, version/release/service
  instance, support, telemetry, security, privacy and renewal.

### 5.6 Education and training (4)

- `corporate-training` — client/cohort engagement, curriculum/version, instructor, completion and
  organization outcome reporting.
- `tutoring` — learner/guardian, subject/level, recurring session, progress, safeguarding and
  scheduling.
- `music-school` — instructor/room/instrument, individual and class patterns, recital/performance and
  progression.
- `driving-school` — licensed instructor/vehicle, road lesson route, learner eligibility, vehicle and
  public safety, assessment evidence.

### 5.7 Pet services (5)

- `pet-grooming` — animal/owner record, appointment, grooming instructions, welfare, condition and
  handback.
- `dog-walking` — recurring/mobile schedule, key/access custody, route, animal grouping and incident
  evidence.
- `pet-boarding` — date-range occupancy, kennel/room, feeding/medication, owner instructions, welfare
  and return.
- `mobile-pet-grooming` — vehicle/route, animal appointment, water/equipment/stock, site safety and
  welfare.
- `mobile-vet` — veterinary clinical authority plus field dispatch, controlled supplies/specimens,
  urgent escalation and records.

### 5.8 Food and hospitality (3)

- `restaurant` — reservations/walk-in tables, POS, menu/recipe, kitchen/crew/perishable stock,
  allergen/sanitation and service recovery.
- `catering` — quote/project, event date/venue/guest count, production/logistics/crew, food safety and
  event acceptance.
- `bakery` — recipe/batch production, preorder/POS, perishable ingredients, allergen/label and pickup
  or delivery promise.

### 5.9 Retail goods (5)

- `retail-goods` — owned stock, store/online order, payment, fulfillment, return and supplier/product
  trace.
- `artisan-goods` — made-to-stock/made-to-order goods, craft production, customization, lead time and
  provenance.
- `florist` — perishable inventory, arrangement production, occasion/date, route delivery and
  substitution approval.
- `wholesale-distribution` — account/pricing/credit, bulk order, warehouse/pick/ship, supplier and
  trade commitment.
- `furniture-delivery-install` — bulky serialized goods, route/crew, site access, installation,
  condition/damage and customer acceptance.

### 5.10 Fitness and recreation (3)

- `gym` — membership/entitlement, facility/equipment access, capacity, safety, class/PT add-ons and
  renewal.
- `yoga-studio` — membership/class pass, instructor/room capacity, ability/health context,
  safeguarding and attendance.
- `dance-studio` — learner/guardian, classes/levels, instructors/rooms, performance/recital and
  safeguarding.

### 5.11 Nonprofit and community (8)

- `pet-rescue` — animal intake/custody, foster/adoption, donations, volunteer capacity, welfare and
  adopter suitability.
- `animal-shelter` — public/contract intake, occupancy, care, reclaim/adoption, medical/welfare and
  records.
- `community-shelter` — bed/room capacity, beneficiary intake/eligibility, safeguarding, services,
  privacy and exit planning.
- `charity` — donor restriction/receipt, campaign, program allocation, beneficiary outcome and
  public/donor reporting.
- `sports-club` — membership, teams/fixtures/facilities, coaches/volunteers, safeguarding and member
  governance.
- `cooperative` — member ownership, equitable access/allocation, contribution, governance, surplus
  and conflicts.
- `agricultural-cooperative` — member/co-op governance plus pooled inputs/equipment/market access,
  seasonal capacity and traceability.
- `meal-delivery-program` — beneficiary eligibility, donation/grant funding, meal production,
  diet/allergen, route/proof and safeguarding.

### 5.12 HOA and property management (3)

- `homeowners-association` — owners/board, dues, covenants, amenities, requests/violations, vendor
  work and member governance.
- `condo-association` — unit/common-element distinction, board/owner duties, shared systems,
  assessment/dues and access.
- `property-management-company` — landlord/client portfolio, tenants/leases, maintenance/vendors,
  rent/accounting and dual-party authority.

### 5.13 Banking and financial services (3)

- `community-bank` — deposit/account and loan relationships, branch/community channel, KYC, credit
  decision, servicing and regulatory evidence.
- `credit-union` — member eligibility/ownership, deposit/loan services, equitable member governance,
  KYC and regulation.
- `mortgage-lending` — application/disclosures, verification, underwriting, appraisal/title,
  approval/adverse action, closing and servicing handoff.

### 5.14 Public sector (3)

- `small-town-municipality` — resident requests, permits/fees, public meetings/records, public works,
  fairness and statutory authority.
- `municipal-utility` — service territory/account, meter/usage, connect/disconnect, outage/field work,
  infrastructure and universal-service controls.
- `law-enforcement-agency` — call/incident/case/evidence, dispatch/officer activity, public-safety
  authority, due process, CJIS/records and critical escalation.

### 5.15 Asset rental (3)

- `equipment-rental` — asset availability, reservation, identity/deposit, checkout, condition,
  return/inspect, damage and maintenance.
- `self-storage` — unit availability/access, agreement/recurring payment, customer custody, facility
  security and delinquency/legal boundary.
- `production-equipment-rental` — specialized equipment packages, availability, logistics/setup,
  condition/maintenance, operator/safety and return.

### 5.16 Real estate and construction (2)

- `new-home-builder` — model/community sales, selection/design, standardized build plan, jobsite,
  inspections/draws, handover and warranty.
- `custom-home-builder` — client-specific design/allowances/change, contract, subcontractors,
  materials, milestone acceptance and warranty.

### 5.17 Automotive services (6)

- `auto-glass` — VIN/glass/ADAS fit, mobile dispatch, removal/install, calibration, safety and
  insurance/acceptance.
- `mobile-mechanic` — vehicle symptom/part/skill match, site dispatch, diagnose/approve/repair/test and
  roadside/site safety.
- `mobile-detailing` — route/site, package, water/power/chemicals, vehicle condition, service and
  damage prevention.
- `mobile-tire` — tire/vehicle fit, mobile stock, dispatch, roadside lifting/safety, install/torque
  evidence.
- `roadside-assistance` — urgent location/vehicle triage, dispatch, towing/service authority, public
  road safety and proof.
- `locksmith` — identity/ownership authorization, key/access security, dispatch, bonding/license and
  incident evidence.

### 5.18 Moving and logistics (5)

- `moving-company` — survey/estimate, crew/truck, item inventory/custody, load/route/unload, damage and
  acceptance.
- `junk-removal` — estimate, crew/vehicle, custody/ownership, sort/disposal/donation manifests and
  site safety.
- `courier-delivery` — parcel identity, pickup/custody, route, delivery attempt/proof, exception and
  loss.
- `last-mile-freight` — shipment/pallet, dock/appointment, vehicle/crew, route, delivery/condition and
  carrier evidence.
- `freight-brokerage` — shipper/carrier contract, capacity sourcing, tender, tracking, documentation,
  settlement and no implied physical custody.

### 5.19 Security services (2)

- `guard-patrol` — licensed guard, site/post orders, roster/route, incident/escalation, presence and
  evidence.
- `alarm-cctv-install` — survey/design, equipment/technician, install/configure/test, privacy,
  monitoring handoff and maintenance.

### 5.20 Media production (3)

- `film-video-production` — brief/script/rights, cast/crew/location/equipment, shoot, review/version,
  delivery and safety.
- `post-production-studio` — media custody, edit/VFX/audio workflow, suite/artist capacity,
  review/version, rights and secure delivery.
- `event-production-staging` — show design, equipment/crew/logistics, build/rehearse/live/strike,
  venue coordination and safety.

### 5.21 Live events and venues (3)

- `event-venue` — date/space hold, capacity/package/contract, setup/event/strike, accessibility,
  safety and settlement.
- `tour-promoter` — show/tour plan, venue/talent contracts, marketing/ticketing, production,
  settlements and rights.
- `talent-booking-agency` — buyer/talent fit, availability/hold, negotiation/contract, itinerary,
  performance and commission settlement.

### 5.22 Warehousing and fulfilment (4)

- `third-party-logistics` — client/account, dock/receive/store/pick/ship, client inventory custody,
  meter/SLA and carrier integrations.
- `ecommerce-fulfilment` — order ingestion, inventory allocation, pick/pack/label, carrier handoff,
  returns and merchant evidence.
- `cold-chain-storage` — temperature-zone capacity, monitored lot custody, excursion response,
  traceability and validated handoff.
- `cross-dock-transload` — inbound/outbound appointment, dock/door/equipment, rapid custody transfer,
  count/condition and reconciliation.

### 5.23 Fabric care services (3)

- `dry-cleaning-plant-network` — store/route/plant custody chain, garment/care label, batch/chemical
  process, ready promise, damage and environmental controls.
- `wash-and-fold-laundry` — weight/bag/customer custody, wash/dry/fold, route/pickup, ready promise and
  loss/damage evidence.
- `alterations-tailoring` — garment custody, measurements/fitting, scoped alteration, skilled labor,
  approval, completion and fit evidence.

### 5.24 Agriculture and ranching (3)

- `mixed-farm-ranch` — whole-operation coordination across land, forage/crops, cattle, working
  animals, equipment, inputs, outside providers and several seasonal horizons.
- `crop-hay-farm` — field/stand and fertility readiness, weather and pest evidence, regulated inputs,
  equipment/custom-operator dependencies, harvest windows, quality/lots and storage.
- `cattle-ranch` — herd/group and individual identity, breeding/calving, health/treatment/withdrawal,
  movement, forage/water, working-animal support and evidence-bounded market readiness.

### 5.25 Manufacturing (1)

- `industrial-equipment-oem` — configured and standard equipment, engineering release, material and
  production readiness, routed work, inspection/test, serialized delivery, spares and lifecycle
  support; operational visibility never implies PLC, robot, safety-system, or machine-control authority.

## 6. Shared and specialized AI-coworker families

The unit of reuse is a stable DigitalProduct/profile-family activity/authority/evidence contract, not a
generic persona label. Every `CW-*` key in this catalog identifies a design/profile family. It is
never a GAID AgentSubject ID, a deployed coworker, or evidence that an implementation exists. GAID
alone governs subject identity creation and lifecycle.

Each row below is a stable family identifier and design skeleton, not a complete `Profile`. To
`bind` a family means resolve that key to a separately versioned Profile satisfying `FPAW-PROF-001`
and `FPAW-CAT-006`, including its exact activities, authority ceiling, evidence contract, owner, and
effective period. The table row alone cannot satisfy a coworker claim.

| Shared family | Reusable activity core | Common profile facets | Specialize or split when |
|---|---|---|---|
| `CW-DEMAND-MARKET` | research demand, qualify inquiries, draft campaigns/offers, observe conversion | industry vocabulary, channel, Product catalog, consumer and claim controls | regulated solicitation, protected audiences, or professional claims change authority/evidence |
| `CW-CUSTOMER-CARE` | intake, retrieve context, answer bounded questions, create/route service work | Product/offer, entitlement, language, accessibility, escalation | clinical/financial/legal/public-safety advice or crisis decisions are involved |
| `CW-SCHEDULE-DISPATCH` | match demand to time/skill/location/resource, propose or execute assignment | appointment, field, route, class, facility, capacity, notification | license verification, emergency priority, clinical acuity, officer dispatch, or safety logic differs |
| `CW-OPERATIONS` | monitor queues/capacity, detect exceptions, recommend improvements, coordinate recovery | value-stream stages, measures, thresholds, continuity | physical control or irreversible operational authority is delegated |
| `CW-FINANCE` | invoice/reconcile/forecast/report and prepare bounded financial work | commercial model, account taxonomy, approvals, retention | credit, regulated advice, payment release, tax/legal conclusion, or fiduciary authority differs |
| `CW-LEGAL-COMPLIANCE` | retrieve obligations, compare evidence, draft checklists/findings, route review | jurisdiction, policy, control, evidence, privilege | legal advice, filing, waiver, enforcement, protected investigation, or public authority differs |
| `CW-SUPPLY` | forecast needs, compare availability, propose replenishment, monitor supplier/stock risk | owned stock, perishable, custody, BOM/recipe, supplier and lead time | controlled substances, cold-chain release, dangerous goods, or procurement authority differs |
| `CW-WORKFORCE` | skills/capacity visibility, learning recommendations, shift/assignment assistance | occupation, job, skill, schedule, labor/contract, privacy | employment decision, credential adjudication, clinical/public-safety staffing, or union/legal scope differs |
| `CW-RECORDS-DATA` | classify, extract, reconcile, retain, retrieve, and produce traceable records | data domain, schema, purpose, provenance, retention, access | evidence custody, privileged/clinical/CJIS record, identity proof, or legal hold differs |
| `CW-PRODUCT-PORTFOLIO` | connect outcomes, Products, investments, dependencies, evidence, and Gaps | four portfolios, Product/offer, IT4IT/CSDM mapping, industry profile | investment or release authority is delegated beyond advisory scope |

Candidate specialized families include:

- `CW-CLINICAL-COORDINATION` for clinical workflow boundaries without autonomous diagnosis by default
- `CW-FINANCIAL-REGULATORY` for KYC, credit/model-risk, disclosure, and adverse-action evidence
- `CW-CIVIC-PUBLIC-SAFETY` for due process, public records, emergency priority, and state authority
- `CW-CUSTODY` for ownership, possession, item/lot identity, condition, transfer, discrepancy, and handoff
- `CW-COLD-CHAIN`, specializing `CW-CUSTODY`, for temperature, excursion, release, and regulated handoff
- `CW-LICENSED-CRAFT` for trade/site/license/safety/inspection boundaries
- `CW-PROFESSIONAL-ADVICE` only where the profession, jurisdiction, qualification, authority, and
  relying-party evidence justify a distinct DigitalProduct/profile family
- `CW-AGRICULTURAL-OPERATIONS` for the seasonal, biological, geographic whole-operation loop across
  land, crops/forage, animals, equipment, materials, outside services and cited external signals

### 6.1 Controlled activity-applicability and AI-realization states

The category matrix uses exactly four activity-applicability states. It says whether the business
activity and a reusable design boundary are material; it does not require an organization to deploy
AI or assert that a production coworker exists.

| State | Deterministic meaning |
|---|---|
| `required` | The activity is material to every leaf in the category and the shared family contract is an acceptable starting design boundary. The organization profile **MUST** record an AI-realization decision; it binds the family only when AI participates. |
| `recommended` | The activity is common but depends on the leaf, offer, or operating model. A profile **MUST** assess it and record an evidence-backed applicability/omission rationale. |
| `not-applicable` | The category baseline contains no material activity for the family. A leaf or organization may override this only from explicit work, resource, supplier, or authority evidence. |
| `specialized-profile-required` | The activity is material, but the shared contract is insufficient if AI participates because domain authority, safety, rights, or evidence changes its meaning. A versioned specialized profile **MUST** be bound before an AI coworker can be claimed. |

Every non-`not-applicable` cell is resolved separately through exactly one AI-realization state:

| AI-realization state | Deterministic meaning |
|---|---|
| `profile-bound` | AI participates; the organization binds the shared or required specialized profile and complete activity/authority/evidence contract. |
| `human-only-no-ai-needed` | The activity is intentionally human-only for this scope; rationale, accountable owner, evidence, and review date are recorded. This is not an implementation Gap. |
| `not-yet-assessed` | The organization has not made the realization decision; it cannot claim R4/R5 catalog conformance for the cell. |
| `implementation-gap` | The organization selected or promised AI participation, but the required profile, implementation, qualification, control, or evidence is missing. |

`required` never grants decision authority or makes AI preferable to human work. `human-only` in the
core allocation vocabulary remains a valid target realization. When `profile-bound` is selected,
the profile may still constrain the coworker to retrieval, recommendation, drafting, or routing.
`specialized-profile-required` never implies autonomous execution: its profile must state the TAK
ceiling, human handoff, prohibited actions, and evidence contract.

### 6.2 Category applicability matrix

The following is one logical matrix, with one row for each canonical category and one column for
each reusable shared family defined above. Column keys are aliases only; the family IDs remain the
authoritative identifiers.

| Category | `DM` `CW-DEMAND-MARKET` | `CC` `CW-CUSTOMER-CARE` | `SD` `CW-SCHEDULE-DISPATCH` | `OP` `CW-OPERATIONS` | `FI` `CW-FINANCE` | `LC` `CW-LEGAL-COMPLIANCE` | `SU` `CW-SUPPLY` | `WF` `CW-WORKFORCE` | `RD` `CW-RECORDS-DATA` | `PP` `CW-PRODUCT-PORTFOLIO` |
|---|---|---|---|---|---|---|---|---|---|---|
| `healthcare-wellness` | `specialized-profile-required` | `specialized-profile-required` | `specialized-profile-required` | `specialized-profile-required` | `required` | `specialized-profile-required` | `recommended` | `specialized-profile-required` | `specialized-profile-required` | `required` |
| `beauty-personal-care` | `required` | `required` | `required` | `required` | `required` | `required` | `required` | `required` | `required` | `required` |
| `trades-maintenance` | `required` | `required` | `specialized-profile-required` | `specialized-profile-required` | `required` | `specialized-profile-required` | `required` | `specialized-profile-required` | `required` | `required` |
| `professional-services` | `specialized-profile-required` | `specialized-profile-required` | `recommended` | `required` | `required` | `specialized-profile-required` | `recommended` | `specialized-profile-required` | `specialized-profile-required` | `required` |
| `software-platform` | `required` | `required` | `recommended` | `required` | `required` | `required` | `recommended` | `required` | `required` | `required` |
| `education-training` | `required` | `specialized-profile-required` | `specialized-profile-required` | `specialized-profile-required` | `required` | `specialized-profile-required` | `recommended` | `specialized-profile-required` | `specialized-profile-required` | `required` |
| `pet-services` | `required` | `required` | `required` | `specialized-profile-required` | `required` | `specialized-profile-required` | `recommended` | `specialized-profile-required` | `required` | `required` |
| `food-hospitality` | `required` | `required` | `recommended` | `specialized-profile-required` | `required` | `specialized-profile-required` | `specialized-profile-required` | `specialized-profile-required` | `specialized-profile-required` | `required` |
| `retail-goods` | `required` | `required` | `recommended` | `required` | `required` | `required` | `required` | `required` | `required` | `required` |
| `fitness-recreation` | `specialized-profile-required` | `specialized-profile-required` | `specialized-profile-required` | `specialized-profile-required` | `required` | `specialized-profile-required` | `recommended` | `specialized-profile-required` | `specialized-profile-required` | `required` |
| `nonprofit-community` | `specialized-profile-required` | `specialized-profile-required` | `recommended` | `specialized-profile-required` | `specialized-profile-required` | `specialized-profile-required` | `recommended` | `specialized-profile-required` | `specialized-profile-required` | `required` |
| `hoa-property-management` | `recommended` | `specialized-profile-required` | `required` | `specialized-profile-required` | `specialized-profile-required` | `specialized-profile-required` | `recommended` | `required` | `specialized-profile-required` | `required` |
| `banking-financial-services` | `specialized-profile-required` | `specialized-profile-required` | `recommended` | `specialized-profile-required` | `specialized-profile-required` | `specialized-profile-required` | `recommended` | `specialized-profile-required` | `specialized-profile-required` | `required` |
| `public-sector` | `specialized-profile-required` | `specialized-profile-required` | `specialized-profile-required` | `specialized-profile-required` | `specialized-profile-required` | `specialized-profile-required` | `recommended` | `specialized-profile-required` | `specialized-profile-required` | `required` |
| `asset-rental` | `required` | `required` | `required` | `required` | `required` | `required` | `recommended` | `required` | `specialized-profile-required` | `required` |
| `real-estate-construction` | `required` | `required` | `specialized-profile-required` | `specialized-profile-required` | `specialized-profile-required` | `specialized-profile-required` | `specialized-profile-required` | `specialized-profile-required` | `specialized-profile-required` | `required` |
| `automotive-services` | `required` | `required` | `specialized-profile-required` | `specialized-profile-required` | `required` | `specialized-profile-required` | `required` | `specialized-profile-required` | `specialized-profile-required` | `required` |
| `moving-and-logistics` | `required` | `required` | `specialized-profile-required` | `specialized-profile-required` | `required` | `specialized-profile-required` | `recommended` | `specialized-profile-required` | `specialized-profile-required` | `required` |
| `security-services` | `specialized-profile-required` | `specialized-profile-required` | `specialized-profile-required` | `specialized-profile-required` | `required` | `specialized-profile-required` | `recommended` | `specialized-profile-required` | `specialized-profile-required` | `required` |
| `media-production` | `required` | `required` | `required` | `required` | `required` | `specialized-profile-required` | `recommended` | `required` | `specialized-profile-required` | `required` |
| `live-events-venues` | `required` | `required` | `specialized-profile-required` | `specialized-profile-required` | `specialized-profile-required` | `specialized-profile-required` | `required` | `specialized-profile-required` | `specialized-profile-required` | `required` |
| `warehousing-fulfilment` | `required` | `required` | `required` | `specialized-profile-required` | `required` | `specialized-profile-required` | `specialized-profile-required` | `specialized-profile-required` | `specialized-profile-required` | `required` |
| `fabric-care-services` | `required` | `required` | `recommended` | `specialized-profile-required` | `required` | `specialized-profile-required` | `specialized-profile-required` | `specialized-profile-required` | `specialized-profile-required` | `required` |
| `agriculture-ranching` | `specialized-profile-required` | `required` | `specialized-profile-required` | `specialized-profile-required` | `specialized-profile-required` | `specialized-profile-required` | `specialized-profile-required` | `specialized-profile-required` | `specialized-profile-required` | `required` |
| `manufacturing` | `required` | `required` | `recommended` | `specialized-profile-required` | `required` | `specialized-profile-required` | `required` | `specialized-profile-required` | `specialized-profile-required` | `required` |

### 6.3 Activity, authority, and evidence rationale

This rationale is the minimum category-level reason for the matrix state. A specialized profile may
derive from a candidate family listed above or from the affected shared family, but it must remain a
versioned category/leaf contract rather than an ungoverned persona prompt.

| Category | Decisive activity | Authority ceiling or specialization anchor | Minimum category evidence |
|---|---|---|---|
| `healthcare-wellness` | clinical intake, capacity matching, episode coordination, and protected records | `CW-CLINICAL-COORDINATION`; no autonomous diagnosis, treatment, or clinical release by default | patient/animal identity, consent, qualified provider, encounter, escalation, and clinical-record provenance |
| `beauty-personal-care` | booking, service preparation, consumables, checkout, and repeat-service history | shared families remain bounded below practitioner judgment and chemical/hygiene controls | practitioner/room schedule, service instructions/history, consumable use, checklist, and acceptance |
| `trades-maintenance` | skill/parts dispatch, site work coordination, test, and closeout | `CW-LICENSED-CRAFT`; no permit, isolation, regulated application, or safety acceptance without named authority | credential, site condition, parts, safe-state, readings/tests, inspection, and customer closeout |
| `professional-services` | qualify, scope, analyze, review, deliver, and retain a client case | `CW-PROFESSIONAL-ADVICE`; advice, filing, attestation, and signed deliverable remain profession/jurisdiction bounded | engagement, conflicts, sources, reviewer, versioned deliverable, approval, privilege, and retention |
| `software-platform` | provision tenants, operate service, handle support, and govern change | shared families; release or production-change authority requires a narrower deployment profile | Product/version, entitlement, instance, SLO, incident/change, dependency, and approval evidence |
| `education-training` | enrol, schedule qualified capacity, deliver learning, assess progress, and complete | education/safeguarding specializations of `CC`, `SD`, `OP`, `LC`, `WF`, and `RD`; no unsupported credential award | learner/guardian, consent, instructor qualification, attendance, assessment provenance, completion, and safeguarding event |
| `pet-services` | schedule and coordinate care, custody, welfare, and owner handback | animal-welfare specializations; `CW-CLINICAL-COORDINATION` is additionally required for the `mobile-vet` leaf | animal/owner identity, instructions, condition, custody transfers, incident/escalation, and return acceptance |
| `food-hospitality` | plan production/service, replenish perishables, execute food controls, and recover exceptions | `CW-COLD-CHAIN` where lot/temperature/release applies; no autonomous allergen or unsafe-food release | recipe/menu, lot/date, allergen, temperature/condition, sanitation, waste, delivery/service, and acceptance |
| `retail-goods` | generate demand, fulfill owned stock, settle, return, and support customers | shared families; credit, regulated goods, or installation safety creates a leaf specialization | item/lot, availability, order, payment, transfer, return, supplier, and customer acceptance |
| `fitness-recreation` | manage membership/classes, health context, instructor capacity, progress, and incidents | health/safeguarding specializations; no diagnosis or unqualified exercise/safety decision | member/guardian, consent, instructor, capacity, attendance, incident, progress, and emergency handoff |
| `nonprofit-community` | raise/restrict funds, allocate scarce program capacity, serve beneficiaries, and govern volunteers/members | beneficiary, donor, volunteer, and member-governance specializations; no autonomous eligibility denial or restricted-fund release | donor restriction, eligibility, allocation rationale, volunteer check, safeguarding, outcome, and governance record |
| `hoa-property-management` | route resident work, allocate amenities/vendors, administer dues/rent, and apply governance | property/board/landlord specializations; no autonomous violation, eviction, covenant ruling, or protected-fund release | party/role, property/unit, request, board/owner authority, vendor work, ledger, notice, and decision record |
| `banking-financial-services` | solicit, identify, assess, decide, book, service, and monitor financial products | `CW-FINANCIAL-REGULATORY`; no unqualified advice, credit decision, adverse action, or funds release | identity/KYC, disclosures, model/input provenance, decision reason, approval, adverse action, and audit trail |
| `public-sector` | determine eligibility/priority, dispatch public capacity, deliver statutory value, and preserve public record | `CW-CIVIC-PUBLIC-SAFETY`; statutory, coercive, emergency, enforcement, and appeal authority stays explicit | legal mandate, jurisdiction, identity, fairness/priority rationale, officer/crew authority, action, record, and appeal |
| `asset-rental` | reserve, issue, monitor, return, inspect, charge, maintain, and re-pool assets | custody specialization of `RD`; no autonomous identity exception, damage conclusion, or unsafe re-release | serialized asset/unit, party, agreement, checkout/return, condition, custody, damage, maintenance, and release |
| `real-estate-construction` | sell/design, schedule trades/materials, build, inspect, draw, hand over, and warrant | `CW-LICENSED-CRAFT` plus `CW-PROFESSIONAL-ADVICE`; no permit, inspection, draw, lien, or safety acceptance without authority | site, design/version, contract/change, credential, material, inspection, draw approval, handover, and warranty |
| `automotive-services` | identify vehicle/part/skill, dispatch, diagnose, repair/install, test, and close | `CW-LICENSED-CRAFT`; towing, access, ADAS calibration, roadside safety, and vehicle release stay bounded | VIN, authorization, part fit, technician, site safe-state, readings/calibration, condition, test, and acceptance |
| `moving-and-logistics` | estimate/tender, assign capacity, take custody, route, deliver, and settle | custody and transport specializations; no autonomous carrier qualification, dangerous movement, loss ruling, or disposal | item/shipment, owner/custodian, carrier/driver, route, hours, transfers, condition, proof, exception, and settlement |
| `security-services` | qualify a site, roster/dispatch, monitor, respond, install, and preserve incident evidence | security/licensing specializations of `CC`, `SD`, `OP`, `LC`, `WF`, and `RD`; public authority is never implied | license, post order/design, roster, site/route, alarm/incident, escalation, surveillance purpose/access, and evidence custody |
| `media-production` | scope rights, schedule creators/equipment, produce/version, approve, deliver, and settle | rights/approval specializations of `LC` and `RD`; live staging additionally invokes licensed-craft/safety boundaries | brief, contract/right, consent/likeness, asset custody, version, reviewer approval, delivery, and settlement |
| `live-events-venues` | hold capacity, contract/ticket, schedule talent/crew/equipment, execute live work, and settle | event-safety, rights, and settlement specializations; no autonomous crowd-safety release, performance commitment, or final settlement | date/capacity, contract/right, ticket/guest, crew/equipment, safety plan, incident, performance, and settlement approval |
| `warehousing-fulfilment` | schedule docks, receive/store, allocate/pick/pack, transfer custody, and meter/bill | `CW-CUSTODY`, specialized by `CW-COLD-CHAIN` for temperature-controlled work; no autonomous discrepancy, customs/bonded, or unsafe-temperature release | client/item/lot, quantity, location, custody event, temperature/condition, pick/ship, discrepancy, carrier proof, and meter |
| `fabric-care-services` | receive/tag, route/process, monitor chemicals/condition, promise readiness, and return/resolve claims | `CW-CUSTODY` plus process/chemical controls; cold-chain semantics do not apply by default | garment/owner, receipt/condition, process/batch, chemical control, route, ready promise, return, damage, and acceptance |
| `agriculture-ranching` | observe and compare seasonal land, crop/forage, animal, equipment, material, provider, weather, market and obligation state; propose bounded next work | `CW-AGRICULTURAL-OPERATIONS`; no autonomous pesticide/veterinary determination, market sale, spend or service commitment, filing/message, machine command, or safety release | organization and land/field/herd/animal/equipment/material/provider identity; dated plan/actual work; source/as-of/freshness/uncertainty; qualification, approval, outcome and incident evidence |
| `manufacturing` | qualify demand, release product definition and work, coordinate constrained production flow, inspect/test, ship and support | manufacturing specialization of `CW-OPERATIONS`, `CW-LEGAL-COMPLIANCE`, `CW-WORKFORCE`, and `CW-RECORDS-DATA`; no autonomous engineering release, quality disposition, machine command, safety release, or irreversible production action | product/BOM/routing revision, released work, material/lot, equipment/station state, performer qualification, WIP/genealogy, inspection/test, deviation approval, shipment and service evidence |

### 6.4 Leaf deviations

The matrix is inherited unchanged unless Section 5 identifies a leaf semantic that adds an activity
or raises its authority/evidence boundary. A deviation record **MUST** name the family, inherited and
leaf states, activity trigger, authority ceiling, evidence, reviewer, and profile version. A leaf may
tighten `recommended` or `required` to `specialized-profile-required`. It may lift
`not-applicable` only from explicit source semantics. A relaxation requires scope-specific contrary
evidence and is not predeclared by this catalog.

The following deviations are the only leaf differences established by the current catalog evidence.
Each row contains exactly one leaf/family pair so the inherited and resulting states are
machine-checkable:

Every row inherits `profileVersion = 0.1.0`, `reviewer = DPF-FPAW candidate editorial review`, and
`reviewedAt = 2026-08-01`. It also inherits `sourceEvidence = the canonical ALL_ARCHETYPES record
for the named leaf plus its Section 5 delta`, `derivationMethod = editorial semantic projection`,
`confidence = provisional`, and `EvidenceVerificationStatus = provisional`; this is design evidence,
not proof of implementation. Its authority ceiling is determined by the resulting state:
`specialized-profile-required` means `no-execution-until-specialized-profile`; `required` or
`recommended` means `no-execution-until-complete-organization-profile`. These inherited
fields are part of each deviation record, not optional commentary.

| Leaf | Family | Category state | Leaf state | Semantic trigger and minimum evidence |
|---|---|---|---|---|
| `mobile-phlebotomy` | `CW-SUPPLY` | `recommended` | `specialized-profile-required` | specimen labels, temperature, collector-to-lab custody, failed draw, and handoff evidence |
| `optician` | `CW-SUPPLY` | `recommended` | `required` | frame/lens item, prescription linkage, fit, order/fulfilment, and handoff evidence |
| `dme-delivery` | `CW-SUPPLY` | `recommended` | `specialized-profile-required` | prescription/eligibility, serialized equipment, setup/training, service, recovery, and custody evidence |
| `beauty-spa` | `CW-CUSTOMER-CARE` | `required` | `specialized-profile-required` | contraindication, consent, treatment boundary, practitioner escalation, and acceptance |
| `beauty-spa` | `CW-RECORDS-DATA` | `required` | `specialized-profile-required` | sensitive treatment note, consent provenance, purpose/access, and retention evidence |
| `personal-trainer` | `CW-CUSTOMER-CARE` | `required` | `specialized-profile-required` | health context, bounded guidance, emergency handoff, and no diagnostic authority |
| `personal-trainer` | `CW-OPERATIONS` | `required` | `specialized-profile-required` | session safety, facility/field condition, exception, and recovery evidence |
| `personal-trainer` | `CW-RECORDS-DATA` | `required` | `specialized-profile-required` | health context, consent, progress provenance, purpose/access, and retention evidence |
| `field-inspection` | `CW-SCHEDULE-DISPATCH` | `recommended` | `specialized-profile-required` | inspector credential/site match, field conditions, geospatial/photo evidence, and finding authority |
| `land-surveying` | `CW-SCHEDULE-DISPATCH` | `recommended` | `specialized-profile-required` | surveyor/crew credential, site/equipment fit, control-point evidence, and signed deliverable authority |
| `mobile-vet` | `CW-CUSTOMER-CARE` | `required` | `specialized-profile-required` | veterinary advice boundary, urgent triage, owner communication, and clinical handoff |
| `mobile-vet` | `CW-SCHEDULE-DISPATCH` | `required` | `specialized-profile-required` | clinical priority, qualified veterinarian, route/site conditions, and urgent escalation |
| `mobile-vet` | `CW-SUPPLY` | `recommended` | `specialized-profile-required` | controlled supplies/specimens, condition, custody, release, and field handoff evidence |
| `mobile-vet` | `CW-RECORDS-DATA` | `required` | `specialized-profile-required` | clinical record provenance, owner consent, access, retention, and veterinary approval |
| `restaurant` | `CW-SCHEDULE-DISPATCH` | `recommended` | `required` | reservation commitment, table/crew capacity, production timing, and service acceptance |
| `catering` | `CW-SCHEDULE-DISPATCH` | `recommended` | `required` | event commitment, venue/crew/logistics capacity, production timing, and acceptance |
| `florist` | `CW-SCHEDULE-DISPATCH` | `recommended` | `required` | occasion/date promise, production capacity, perishable availability, route, proof, and substitution approval |
| `furniture-delivery-install` | `CW-SCHEDULE-DISPATCH` | `recommended` | `specialized-profile-required` | item/crew/vehicle/site fit, access, installation safety, condition, damage, and customer acceptance |
| `wholesale-distribution` | `CW-FINANCE` | `required` | `specialized-profile-required` | trade-account credit boundary, price/term approval, adverse exception, settlement, and reviewer evidence |
| `agricultural-cooperative` | `CW-SUPPLY` | `recommended` | `specialized-profile-required` | pooled/member inputs and equipment, equitable allocation, seasonal capacity, and traceability |
| `meal-delivery-program` | `CW-SUPPLY` | `recommended` | `specialized-profile-required` | diet/allergen, perishable custody, beneficiary route/proof, release authority, and traceability |
| `property-management-company` | `CW-DEMAND-MARKET` | `recommended` | `required` | landlord/client offer, property portfolio scope, inquiry qualification, approved claim, and conversion evidence |
| `municipal-utility` | `CW-SUPPLY` | `recommended` | `required` | infrastructure parts/material availability, supplier dependency, field-work linkage, and outage/recovery evidence |
| `equipment-rental` | `CW-SUPPLY` | `recommended` | `required` | pooled asset availability, maintenance parts, condition, reservation, and safe release evidence |
| `production-equipment-rental` | `CW-SUPPLY` | `recommended` | `required` | specialized package availability, logistics/setup, maintenance parts, condition, and safe release evidence |
| `self-storage` | `CW-LEGAL-COMPLIANCE` | `required` | `specialized-profile-required` | delinquency notice, access restriction, statutory process, approval, and immutable event evidence |
| `freight-brokerage` | `CW-SUPPLY` | `recommended` | `required` | carrier capacity sourcing, qualification, tender, substitution, tracking, and contract evidence |
| `alarm-cctv-install` | `CW-SUPPLY` | `recommended` | `required` | equipment fit/availability, supplier, installation/configuration, test, monitoring handoff, and maintenance |
| `event-production-staging` | `CW-SCHEDULE-DISPATCH` | `required` | `specialized-profile-required` | crew/equipment/site match, venue timing, qualification, and safe-state dependencies |
| `event-production-staging` | `CW-OPERATIONS` | `required` | `specialized-profile-required` | build/rehearse/live/strike control, irreversible action boundaries, incident evidence, and venue authority |
| `event-production-staging` | `CW-SUPPLY` | `recommended` | `specialized-profile-required` | show-equipment package, availability, condition, logistics, substitution, and safe-release evidence |
| `event-production-staging` | `CW-WORKFORCE` | `required` | `specialized-profile-required` | crew skill/credential, roster, workload, handoff, incident, and recovery evidence |
| `mixed-farm-ranch` | `CW-CUSTOMER-CARE` | `required` | `specialized-profile-required` | cattle/livestock sale claims about health, breeding, lineage, weight/condition and handling require identified evidence and qualified escalation; no veterinary advice |
| `cattle-ranch` | `CW-CUSTOMER-CARE` | `required` | `specialized-profile-required` | livestock health, breeding, lineage, weight/condition and handling claims require identified evidence and qualified escalation; no veterinary advice |

An archetype profile **MUST NOT** claim a shared coworker merely because a seed exists. It must bind
the coworker to activities, job/skill requirements, authority, tools/data, controls, handoffs,
evaluation, and evidence.

## 7. Profile manifest contract

The following YAML is a partial, non-conformant syntax excerpt that demonstrates the archetype and
binding portions of the logical contract. It is not a new authoritative registry, a commitment to
YAML persistence, or a complete Profile under `FPAW-PROF-001`. A conforming manifest must additionally
resolve purpose, applicability, exact requirement membership, vocabulary and mapping records, owner,
effective period, verifier, and every assertion in Section 7.1.

```yaml
profile:
  id: fpaw:leaf:hvac-contractor
  version: 0.1.0
  standard: DPF-FPAW@0.1.0
  sourceArchetype:
    id: hvac-contractor
    category: trades-maintenance
    inventorySnapshot: 2026-08-01
  inherits:
    - fpaw:category:trades-maintenance@0.1.0
    - OVL-FIELD-DISPATCH@0.1.0
  facets:
    commercial: [COM-TRANSACTION, COM-RECURRING, COM-HYBRID]
    delivery: [DEL-FIELD]
    resources: [RES-PEOPLE-TIME, RES-FLEET, RES-OWNED-STOCK, RES-REGULATED-RECORD]
    workforce: [WRK-HUMAN-LED, WRK-AUGMENTED, WRK-AI-PRIMARY]
    trust: [TRU-PRIVACY, TRU-PROFESSIONAL, TRU-SAFETY, TRU-ENVIRONMENT]
    digital: [DIG-PLATFORM-HOSTED, DIG-EDGE, DIG-HYBRID-AI]
  businessProducts:
    forms: [service, good, hybrid]
    examples: [repair visit, maintenance agreement, replacement part]
  portfolioAspects:
    products_and_services_sold: [repair and maintenance offers, parts sold]
    for_employees: [technicians, dispatcher coworker, contributor tools]
    manufacturing_and_delivery: [dispatch operation, vans, gauges, truck stock]
    foundational: [identity, finance, data, communications, model gateway]
  valueStream:
    base: [attract, capture, qualify, deliver, settle, retain]
    overlays: [triage, assign-dispatch, en-route, onsite, repair-test-close]
  aiRealizationDecisions:
    - family: CW-SCHEDULE-DISPATCH
      state: implementation-gap
      intendedProfile: CW-LICENSED-CRAFT/hvac-dispatch@0.1.0
      gapReason: no separately published versioned specialized Profile is bound
    - family: CW-PROFESSIONAL-ADVICE
      state: human-only-no-ai-needed
      rationale: regulated diagnosis and authorization remain qualified-human work in this profile
  workAllocation:
    - activity: rank-dispatch-options
      pattern: ai-primary-human-exception
    - activity: diagnose-refrigerant-system
      pattern: human-led-ai-assisted
    - activity: authorize-regulated-work
      pattern: human-only
  physicalWork:
    location: customer-site
    requires: [licensed-technician, equipment, materials, safe-state, readings, inspection]
  digitalBindings: []
  digitalBindingVerification:
    bindingState: absent
    evidenceVerificationStatus: unverified
    gap:
      id: GAP-HVAC-DIGITAL-BINDINGS
      summary: no DigitalProduct lifecycle or deployment binding is verified for this illustration
      evidenceNeeded: [owned DigitalProduct identity, lifecycle touchpoint, deployment relationship, reviewer]
  evidence:
    provenance: explicit
    readiness: template-ready
    lastReviewed: 2026-08-01
```

### 7.1 Required manifest assertions

For every leaf, the conformance check **MUST** assert:

1. the source leaf exists exactly once in the canonical registry
2. exactly one category baseline is inherited
3. Product forms and outcomes are declared
4. every portfolio root has governed aspects or justified non-applicability
5. the ValueStream and overlays satisfy the Stage contract to claimed depth
6. WorkUnitDefinitions and allocations reference jobs/skills/qualifications or explicit Gaps
7. physicality, location, resources, materials, custody, and completion evidence are declared
8. controls and outcome/flow/quality/economic/capacity/risk measures are declared
9. DigitalProduct lifecycle/external-standard bindings are explicit or absent—not defaulted
10. provenance, implementation state, readiness, reviewer, and date are present

### 7.2 Catalog requirement register

These namespaced requirements index every normative obligation introduced by this catalog. They are
selected by an `FPAW-Industry-Archetype` claim that cites Catalog Candidate 0.1.0.

| ID | Requirement | Minimum depth |
|---|---|---|
| `FPAW-CAT-001` | A `required` activity-applicability state **MUST** have exactly one Section 6.1 AI-realization decision; `human-only-no-ai-needed` with evidence is not an implementation Gap. | `R4` |
| `FPAW-CAT-002` | A `recommended` state **MUST** be assessed and record either an applicable AI-realization decision or an evidence-backed activity-omission rationale. | `R4` |
| `FPAW-CAT-003` | A `specialized-profile-required` state with AI realization `profile-bound` **MUST** bind a versioned specialized profile before a coworker implementation is claimed. | `R4` |
| `FPAW-CAT-004` | A `not-applicable` state **MUST** be overridden only from explicit leaf/organization activity, work, resource, supplier, or authority evidence. | `R4` |
| `FPAW-CAT-005` | A leaf deviation **MUST** name leaf, family, inherited/resulting states, trigger, authority ceiling, evidence, reviewer, and profile version. | `R4` |
| `FPAW-CAT-006` | A seed or family key **MUST NOT** be treated as a coworker implementation or AgentSubjectReference; a claim **MUST** bind activities, job/skill requirements, authority, tools/data, controls, handoffs, evaluation, and evidence. | `R5` |
| `FPAW-CAT-007` | Every canonical source leaf **MUST** exist exactly once in the catalog reconciliation. | `R4` |
| `FPAW-CAT-008` | Every leaf manifest **MUST** inherit exactly one category baseline. | `R4` |
| `FPAW-CAT-009` | Every leaf manifest **MUST** declare BusinessProduct forms and Outcomes. | `R4` |
| `FPAW-CAT-010` | Every leaf manifest **MUST** place governed aspects in every portfolio root or record justified non-applicability. | `R4` |
| `FPAW-CAT-011` | Every leaf manifest **MUST** provide a ValueStream and overlays satisfying the Stage contract to claimed depth. | `R5` |
| `FPAW-CAT-012` | Every leaf manifest **MUST** bind WorkUnitDefinitions/allocations to job, skill, and qualification references or explicit Gaps. | `R5` |
| `FPAW-CAT-013` | Every leaf manifest **MUST** declare physicality, location, resources, materials, custody, and completion evidence. | `R5` |
| `FPAW-CAT-014` | Every leaf manifest **MUST** declare controls and separable outcome, flow, quality, economics, capacity, and risk measures. | `R5` |
| `FPAW-CAT-015` | Every leaf manifest **MUST** keep DigitalProduct lifecycle/external-standard bindings complete and explicit or BindingState `absent`; no fallback is permitted. | `R4` |
| `FPAW-CAT-016` | Every leaf manifest **MUST** carry provenance, ImplementationState, readiness, EvidenceVerificationStatus, verifier, and date. | `R5` |
| `FPAW-CAT-017` | The category/family matrix **MUST** contain exactly one row per canonical category, one column per registered shared family, and only the four Section 6.1 states. | `R4` |
| `FPAW-CAT-018` | Every non-`not-applicable` category/leaf family cell **MUST** resolve to exactly one governed AI-realization state; only a selected or promised AI realization whose required implementation is missing **MUST** become an `implementation-gap`. | `R4` |

### 7.3 Worked profile-composition specimens (informative)

These seven specimens exercise six materially different design shapes plus agriculture. They are
**not complete Profiles**, leaf manifests, implementations, or ConformanceClaims: they summarize
composition intent while deliberately omitting the per-stage contract, complete WorkUnit/job/skill/
qualification/evidence graph, organization thresholds, and all ten family-cell decisions required by
Sections 6–7.2. A family key below remains a design skeleton; every intended AI participation is
therefore `implementation-gap` until a separately published, versioned Profile and deployment overlay
satisfy `FPAW-PROF-001`, `FPAW-CAT-003`, and `FPAW-CAT-006`.

For comparison, each specimen uses the same design metadata: Candidate 0.1.0 Core,
Four-Portfolio, Business-Offering-Value, Operational-Work, Workforce-AI, Industry-Archetype, and
Assurance-Evidence; FPAW vocabulary and canonical DPF Stage keys; prospective owner `DPF Standards
Steward`; design date `2026-08-01`; review-on-source-change; external BindingState `absent`;
`ImplementationState = defined`; `readiness = template-ready`; and
`EvidenceVerificationStatus = provisional`. These are informative design defaults, not normative
profile fields or evidence of completeness.

#### `FPAW-EX-HVAC-CONTRACTOR@0.1.0` — physical/licensed service

| Required field | Value |
|---|---|
| purpose / applicability | govern the `trades-maintenance/hvac-contractor` repair, maintenance-agreement, and replacement-part hybrid |
| inherited facets | `COM-TRANSACTION`, `COM-RECURRING`, `COM-HYBRID`; `DEL-FIELD`; people/time, fleet, owned stock, regulated record; privacy, professional, safety, environmental; hosted/edge/hybrid AI |
| Product / Outcome | repair visit, maintenance agreement, and part; restore safe comfort/equipment function with accepted test and closeout |
| four-portfolio bill | sold offers/parts; licensed technicians and bounded dispatcher coworker; vans/gauges/parts/field execution; identity, finance, communications, data, model/tool gateway |
| ValueStream / work | `attract → capture → qualify → deliver → settle → retain`; triage, dispatch, diagnose, isolate, repair, test, document, close |
| allocation / AI realization | dispatch is `implementation-gap`; intended family/profile is `CW-LICENSED-CRAFT/hvac-dispatch@0.1.0`, which is not separately published; regulated diagnosis and work authorization are `human-only-no-ai-needed` |
| controls / evidence / measures | credential and jurisdiction, access/safe-state, equipment/material state, readings/tests, inspection, approval, customer acceptance; outcome, first-time-fix, cycle time, margin/capacity, safety/environment |
| composition result / gaps | licensed-craft ceiling overrides generic dispatch; no external lifecycle binding; deployed coworker identity, qualification, and runtime evidence remain implementation Gaps if AI is claimed |

#### `FPAW-EX-COMMUNITY-BANK@0.1.0` — regulated decision work

| Required field | Value |
|---|---|
| purpose / applicability | govern `banking-financial-services/community-bank` deposit, lending, relationship, and servicing value |
| inherited facets | recurring/transaction/public-value hybrids; branch/remote delivery; people/time, regulated records, external core/payment dependencies; privacy, financial, professional, legal |
| Product / Outcome | deposit and loan products, account/service access; eligible customer receives a reasoned, authorized, disclosed and serviceable financial outcome |
| four-portfolio bill | sold/eligible financial offerings; bankers, operations, compliance and bounded coworkers; branch/contact/underwriting/servicing delivery; identity/KYC, finance, records, security and integration foundations |
| ValueStream / work | attract, capture application, qualify/KYC, assess/decide, book/deliver, settle/service/retain; adverse-action and appeal/exception paths explicit |
| allocation / AI realization | evidence preparation is `implementation-gap`; intended family is `CW-FINANCIAL-REGULATORY`, but no versioned specialized Profile is published; credit/adverse-action/funds-release authority is `human-only-no-ai-needed` unless a jurisdiction-specific governed automation profile proves otherwise |
| controls / evidence / measures | identity/KYC, disclosure, model/input provenance, segregation, decision reason, authorized approval, adverse action, audit/retention; fairness, decision quality, time, loss/risk, capacity and customer outcome |
| composition result / gaps | financial-regulatory specialization overrides generic finance/customer care; external BIAN/IT4IT claims remain absent pending complete mappings; no production AI claim is made |

#### `FPAW-EX-FURNITURE-DELIVERY-INSTALL@0.1.0` — physical goods plus service

| Required field | Value |
|---|---|
| purpose / applicability | govern `retail-goods/furniture-delivery-install` sale, delivery, assembly/installation and acceptance |
| inherited facets | transaction/hybrid; goods plus field delivery; owned stock, fleet, people/time, customer site, custody; safety/privacy; hosted/edge AI |
| Product / Outcome | furniture item plus delivery/install service; correct undamaged item installed safely at the promised place/time and accepted |
| four-portfolio bill | merchandise and service offer; sales/warehouse/crew plus bounded scheduler; inventory/pick/load/route/site install; identity, payment, data, communication and shared facilities |
| ValueStream / work | attract, capture order/site needs, qualify inventory/crew/access, pick/load/deliver/install, settle, return/support; damage and failed-access loops |
| allocation / AI realization | schedule/route AI participation is `implementation-gap`; intended families are `CW-SCHEDULE-DISPATCH` and `CW-CUSTODY`, but no composed versioned Profile is published; site safety, irreversible installation and acceptance remain qualified-human work |
| controls / evidence / measures | item/serial/condition, custody, crew/vehicle/site fit, access, safe-state, photos/scans, damage, proof and acceptance; on-time/in-full, damage, rework, margin, capacity and safety |
| composition result / gaps | custody and field-safety controls require the core merge algebra and explicit conflict findings; no external mapping; specialized Profile, connector, and runtime evidence remain missing/unverified |

#### `FPAW-EX-THIRD-PARTY-LOGISTICS@0.1.0` — custody/logistics

| Required field | Value |
|---|---|
| purpose / applicability | govern `warehousing-fulfilment/third-party-logistics` custody, storage, handling and dispatch without classifying client goods as sold Products |
| inherited facets | recurring/usage service; facility/partner delivery; custodial space, client stock, equipment, people/time, carriers; custody, privacy, safety, legal |
| Product / Outcome | custody/storage/handling service; client goods remain identifiable, segregated, available and transferred in accepted condition |
| four-portfolio bill | logistics service offer; warehouse/dispatch workforce and bounded operations coworker; docks/racks/equipment/handling/carrier handoffs; identity, finance, data, security and shared facility foundations |
| ValueStream / work | capture appointment, qualify dock/capacity, `receive-store`, allocate/pick/pack, dispatch/transfer, meter/settle, review; discrepancy/rejection/rework paths |
| allocation / AI realization | allocation and exception preparation is `implementation-gap`; intended family is `CW-CUSTODY`, but no versioned specialized Profile is published; physical move, discrepancy acceptance and unsafe-condition release remain human/engineered-control bounded |
| controls / evidence / measures | owner/custodian, item/lot, count, location, condition, scan/custody events, segregation, carrier proof, discrepancy and acceptance; accuracy, dwell, utilization, throughput, loss/damage, service level |
| composition result / gaps | custody specialization overrides generic operations/supply; cold-chain facet is not inherited unless leaf/scope evidence activates it; runtime proof absent |

#### `FPAW-EX-SMALL-TOWN-MUNICIPALITY@0.1.0` — public/member value

| Required field | Value |
|---|---|
| purpose / applicability | govern `public-sector/small-town-municipality` permits, requests, public works and community-service outcomes |
| inherited facets | public-value/appropriated funding; portal/office/field delivery; people/time, fleet/facilities, public/regulated records; civic, privacy, legal, safety, accessibility |
| Product / Outcome | permit, public request resolution, benefit/access or public-work service; resident/community receives lawful, fair, traceable and appealable value |
| four-portfolio bill | public offerings/benefits; officials/staff/crews and bounded civic coworker; intake/case/field delivery; identity, budget, records, communications, security and facilities |
| ValueStream / work | inform/attract, capture request/application, determine jurisdiction/eligibility/priority, deliver/inspect, fee/account, notify/retain trust; hearing/appeal/emergency variants |
| allocation / AI realization | intake/routing/draft-explanation AI participation is `implementation-gap`; intended family is `CW-CIVIC-PUBLIC-SAFETY`, but no jurisdiction-specific versioned Profile is published; statutory determination, coercive action, emergency command and appeal decision remain authorized-human work |
| controls / evidence / measures | mandate/jurisdiction, identity, accessibility, fairness/priority rationale, public-record/retention, officer/crew authority, action, notice, appeal; timeliness, equity, outcome, cost/capacity, safety and trust |
| composition result / gaps | public-law and due-process ceilings override shared customer-care/operations; no external NIEM/IT4IT mapping or deployment claim |

#### `FPAW-EX-SOFTWARE-PLATFORM@0.1.0` — wholly digital Product

| Required field | Value |
|---|---|
| purpose / applicability | govern `software-platform/software-platform` subscription, provisioning, operation and support |
| inherited facets | subscription/usage; portal/API delivery; digital capacity and regulated records; privacy/security/availability; platform-hosted/microservice/shared-service/hybrid AI |
| Product / Outcome | digital subscription/access; entitled consumer receives a usable, supported, measurable digital capability |
| four-portfolio bill | DigitalProduct sold as BusinessProduct realization; product/engineering/support plus coworkers; build/release/provision/operate delivery; identity, billing, data, security, observability and cloud foundations |
| ValueStream / work | attract, capture subscription, qualify entitlement, provision/use, bill, support/renew; incident/change/retirement flows; physical-work applicability recorded not-applicable with reviewer evidence |
| allocation / AI realization | support and operations preparation is `implementation-gap`; intended families are `CW-CUSTOMER-CARE` and `CW-OPERATIONS`, but no complete versioned deployment Profile is bound; production release, security exception and material account action remain policy/authority gated |
| controls / evidence / measures | version/release, entitlement, deployed instance, SLO, telemetry, incident/change, dependency, approval, usage and acceptance; adoption, availability, quality, flow, unit economics, capacity and risk |
| composition result / gaps | this profile exercises the AI-coworker DigitalProduct chain without conflating Product, release, deployment, service, offer, engagement or AgentSubject; external lifecycle binding remains `absent` |

#### `FPAW-EX-MIXED-FARM-RANCH@0.1.0` — seasonal biological/physical work

| Required field | Value |
|---|---|
| purpose / applicability | govern `agriculture-ranching/mixed-farm-ranch` crops/forage, livestock and bounded field/custom services |
| inherited facets | transaction/recurring/hybrid; farm/field/market delivery; land, herd, equipment, materials, seasonal labor/providers, regulated records; animal welfare, food/feed trace, environmental and machine safety |
| Product / Outcome | crop/forage/livestock goods and services; sale/service readiness is evidence-bounded while land, animal welfare, worker safety and traceability constraints hold |
| four-portfolio bill | sold goods/services; owner/operator/hands/providers and proposed steward; seasonal production, grazing, harvest, equipment/material readiness and market handoff; identity, finance, data, communications and shared facilities |
| ValueStream / work | observe, plan, ready, execute/record, harvest/sell/service, review across seasonal horizons; weather, animal, material, equipment and provider exceptions |
| allocation / AI realization | `CW-AGRICULTURAL-OPERATIONS` is `implementation-gap` because Farm & Ranch Steward remains draft/proposal-only; pesticide/veterinary determination, sale/spend/service commitment, filing/message, machine command and safety release remain qualified-human work |
| controls / evidence / measures | organization/land/field/herd/animal/equipment/material/provider identity; dated plan/actual, source/as-of/freshness/uncertainty, qualification/approval, treatment/withdrawal, lot/quality, incident/outcome; yield/quality, cycle, margin, capacity, welfare/safety/environment risk |
| composition result / gaps | specialized agriculture and customer-care ceilings override shared families; null governance-profile references and unshipped typed records prevent an operated coworker claim; exact external registry fields are non-admissible |

## 8. CSDM 5 and AI DigitalProduct application boundary

The specimens above remain vendor-neutral applications of DPF-owned product, deployment, service,
work, TAK, GAID, and TAK-JSI semantics. The source-validated CSDM 5 map is centralized in the
[core standard's Section 13.4](four-portfolio-archetype-ai-workforce-operating-standard.md#134-source-validated-csdm-5-and-aict-bridge);
catalog specimens **MUST NOT** create a second mapping registry.

A ServiceNow implementation profile may project Product Model, Business Application/design, SDLC or
AI Digital Assets, runtime CIs/Service Instances, services, Service Offerings, catalog and consumption
records to the core levels. It **MUST** preserve the verified gaps: CSDM 5 does not supply FPAW's
DigitalProductRelease authority, a stable concrete DeploymentPackage class/identity contract,
DeploymentIntent, attributable Deployment occurrence, enduring GAID AgentSubject,
AIProductOperatingBinding, atomic work allocation, or attributable evidence contract. The supplied
AICT publication adds a logical Package (Artifact) layer and a source `1:m:n` AI Digital
Asset-to-package-to-operational-deployment pattern; this closes the conceptual package-layer gap but
does not establish a CSDM table, immutable digest, target-compatibility, provenance, rollback, desired
configuration, or deployment-occurrence contract. Physical bindings also **MUST** carry the applicable
ServiceNow family/release, plugins, dictionary/table and relationship fingerprints; source labels
alone are not implementation evidence.

## 9. Current DPF coverage baseline

The baseline is intentionally multi-dimensional. It must not be summarized as “107 archetypes
complete.”

| Dimension | 2026-08-01 source evidence | Standard interpretation |
|---|---|---|
| identity | 25 categories / 107 unique leaves / 574 item templates | inventory exists and is test-enforced |
| activation | 69 explicit profiles; 38 missing | missing profiles are coverage Gaps, not generic conformance |
| four portfolios | 66 explicit decompositions; 41 missing/legacy | all four roots are not yet explicit for every leaf |
| Product mix | 2 explicit leaves | derived item-template Product lines are provisional evidence |
| business ValueStream | every leaf can derive a projection | Stage work/resource/actor/evidence semantics remain thin |
| lifecycle metadata | 59 leaves contain legacy Request-to-Fulfill metadata; 30 explicit decompositions contain no other lifecycle label | invalid as proof of an external lifecycle binding; requires source-authorized reassessment |
| occupation synergy | 6 occupation profiles across healthcare, trades, and agriculture | useful seed, not cross-archetype coverage; both agriculture profiles still have null governance-profile references |
| AI coworkers | 70 agent definitions: 19 active, 50 defined and one draft `farm-ranch-steward` | category applicability is defined in Section 6; an agent definition is not a conforming coworker profile or deployment |
| coworker services | 2 of 11 service seeds declare an archetype | empty coverage remains unknown, not universal |
| physical dispatch | rich typed overlay; zero built-in configured profiles | generic fallbacks are unverified |
| trust | 31 leaves derive one or more trust gates; 76 do not | absence is a control-coverage Gap, not not-applicable |
| supply/material | 12 of 25 categories covered by supplier/goods manifest | remaining categories require applicable/no-applicability evidence |
| outcomes | 6 specialized metric-pack registrations exist; 5 target current leaves and `independent-hotel` is orphaned from the current registry | generic metrics and an orphaned registration cannot prove industry outcomes or leaf deployment |
| readiness | all category caps are `template-ready` | no blanket operational, connector, regulated, or sole-platform claim |
| completeness floor | 4 of 25 categories meet the current Tier-2 floor | the current checker reports 21 grandfathered category gaps |

### 9.1 Highest-priority cross-catalog gaps

1. complete Product forms/mixes and four-portfolio placement for every leaf
2. remove legacy IT4IT fallback and create explicit DigitalProduct bindings
3. add activity/job/skill/allocation and physical work to the Stage contract
4. materialize Section 6 bindings and create specialized profiles only at genuine
   authority/safety/evidence boundaries
5. configure dispatch, trust, custody, supply/material, and metrics facets from evidence
6. join human and AI capacity through Principal-based allocation without erasing employment,
   qualification, or asset distinctions
7. turn readiness into evidence-backed implementation state rather than template presence

## 10. Application sequence

For one organization or new archetype:

1. Resolve the current canonical category/leaf composition and Product lines.
2. Classify business Product forms and intended stakeholder Outcomes.
3. Place governed aspects in all four portfolios and type their dependencies.
4. Select the category baseline and reusable commercial/delivery/resource/trust/digital facets.
5. Add genuine leaf, organization, jurisdiction, contract, and deployment deltas.
6. Refine the business ValueStream and complete every material Stage contract.
7. Define WorkUnitDefinitions, jobs/roles/skills, physical requirements, capacity, and allocation.
8. Bind AI coworkers to DigitalProduct lifecycle plus GAID/TAK-JSI/TAK performer controls.
9. Add explicit IT4IT mappings only for evidenced DigitalProduct touchpoints.
10. Record ConformanceClaims and Gaps; route remediation to one primary portfolio and canonical
    backlog work.

## Appendix A — Inventory integrity statement

The 106 leaf IDs in Section 5 are a dated projection of
`packages/storefront-templates/src/archetypes/index.ts`. A verification tool should compare the set of
backticked leaf keys in this catalog with `ALL_ARCHETYPES`, require equal cardinality and membership,
and fail when either side contains an unmatched key. The source registry always wins.

## Appendix B — Proposed future machine-readable registries

After the candidate standard is reviewed, DPF may project—not duplicate—the following versioned
registries from existing substrate:

- `ProfileFacetDefinition`
- `ArchetypeProfileComposition`
- `StageContractProjection`
- `WorkUnitDefinition`
- `WorkAllocationPolicy`
- `StandardConceptMapping`
- `ConformanceImplementationStatement`

No new table is implied. The schema audit and first consumer workflow determine whether each becomes
a relational entity, governed JSON, EA element, generated artifact, or view over current records.
