# Vertical Workspace Home Long-Tail Queue

| Field | Value |
| --- | --- |
| Original date | 2026-05-25 |
| Recovered and updated | 2026-08-01 |
| Status | Current-state companion spec and backlog reconciliation for `EP-REDUCTION-GEAR-ARCH` |
| Parent spec | [Vertical workspace home design](2026-05-24-vertical-workspace-home-design.md) |
| Scope | Long-tail visual paradigms, reusable primitive composition, setup activation contract, and backlog queue for archetype-specific worker homes |
| Non-goal | Implementing UI, seed data, capability activation, or projection loaders in this session |

## 1. Purpose

The accepted vertical workspace home spec establishes the worker-facing substrate: in-trench workers see the language and shape of their business, while the contribution model, GearInterface, Calibrator, Governor, and platform mechanics stay behind the scenes.

This companion records the long-tail queue so the program does not stop after Dale's AC Repair, clinic scheduler, and retail merchandiser. It preserves the user's direction:

- A service business often starts from a queue of customers, jobs, or requests.
- A traveling service business needs a customer/site map, route, capacity, and readiness view.
- An MSP needs a customer estate map plus current health of customer IT systems.
- Training companies need cohort/class readiness, instructor capacity, learner progress, certification risk, and client communication.
- Every vertical must have a visual paradigm that matches its day-to-day operating question, not a generic dashboard with renamed cards.
- Primitive widgets/tiles must be reusable across archetypes and future architects. A new vertical composes primitives; it does not fork a one-off home.

The 2026-05-25 branch `doc/vertical-workspace-longtail` had this companion spec committed but never merged. This file is the recovered, current-state version, updated against the August source and backlog reality.

## 2. Current State Since The May Draft

The platform has shipped a meaningful amount of the workspace-home substrate since the original draft:

| Area | Current source or backlog state |
| --- | --- |
| Parent design BI | `BI-89C19AAF` is done. |
| Contribution substrate | `BI-1CCC6264` is done; source lives under `apps/web/lib/workspace-home/registry.ts` and `types.ts`. |
| Primitive registry | `BI-5B8FE5C1` is done at the typed registry/manifest level. Concrete renderer/projection depth remains separate. |
| Setup activation | `BI-B14D6CF6` is done; activation summaries derive from contribution manifests. |
| Worker renderer shell | `BI-683C0B9A` and `BI-8D9CA348` are done. |
| Projection service | `BI-3E8D2CF5` is deferred; this remains the major gap for translated GearInterface/Calibrator/Governor signal loading. |
| Category profile coverage | `apps/web/lib/workspace-home/profiles.ts` currently declares category or exact contributions for every seeded storefront category. |
| Exact vertical depth | Several exact/dedicated upgrades remain open or deferred; this is the long-tail queue's active frontier. |

Interpretation: the backlog is no longer "invent a workspace-home substrate." It is now "make each vertical's operating model sharper while composing the shared substrate."

## 3. Current Archetype Catalog

Source audit of `packages/storefront-templates/src/archetypes/` found 103 archetype leaves across 23 categories:

| Category | Count | Seeded archetypes |
| --- | ---: | --- |
| `asset-rental` | 3 | `equipment-rental`, `production-equipment-rental`, `self-storage` |
| `automotive-services` | 6 | `auto-glass`, `locksmith`, `mobile-detailing`, `mobile-mechanic`, `mobile-tire`, `roadside-assistance` |
| `banking-financial-services` | 3 | `community-bank`, `credit-union`, `mortgage-lending` |
| `beauty-personal-care` | 6 | `barber-shop`, `beauty-spa`, `hair-salon`, `mobile-beauty`, `nail-salon`, `personal-trainer` |
| `education-training` | 4 | `corporate-training`, `driving-school`, `music-school`, `tutoring` |
| `fabric-care-services` | 3 | `alterations-tailoring`, `dry-cleaning-plant-network`, `wash-and-fold-laundry` |
| `fitness-recreation` | 3 | `dance-studio`, `gym`, `yoga-studio` |
| `food-hospitality` | 3 | `bakery`, `catering`, `restaurant` |
| `healthcare-wellness` | 9 | `counselling`, `dental-practice`, `dme-delivery`, `home-health-care`, `medical-practice`, `mobile-phlebotomy`, `optician`, `physiotherapy`, `veterinary-clinic` |
| `hoa-property-management` | 3 | `condo-association`, `homeowners-association`, `property-management-company` |
| `live-events-venues` | 3 | `event-venue`, `talent-booking-agency`, `tour-promoter` |
| `media-production` | 3 | `event-production-staging`, `film-video-production`, `post-production-studio` |
| `moving-and-logistics` | 5 | `courier-delivery`, `freight-brokerage`, `junk-removal`, `last-mile-freight`, `moving-company` |
| `nonprofit-community` | 8 | `agricultural-cooperative`, `animal-shelter`, `charity`, `community-shelter`, `cooperative`, `meal-delivery-program`, `pet-rescue`, `sports-club` |
| `pet-services` | 5 | `dog-walking`, `mobile-pet-grooming`, `mobile-vet`, `pet-boarding`, `pet-grooming` |
| `professional-services` | 8 | `accounting`, `consulting`, `field-inspection`, `it-managed-services`, `land-surveying`, `legal-services`, `marketing-agency`, `process-serving-notary` |
| `public-sector` | 3 | `law-enforcement-agency`, `municipal-utility`, `small-town-municipality` |
| `real-estate-construction` | 2 | `custom-home-builder`, `new-home-builder` |
| `retail-goods` | 5 | `artisan-goods`, `florist`, `furniture-delivery-install`, `retail-goods`, `wholesale-distribution` |
| `security-services` | 2 | `alarm-cctv-install`, `guard-patrol` |
| `software-platform` | 1 | `software-platform` |
| `trades-maintenance` | 11 | `appliance-repair`, `cleaning-service`, `electrician`, `facilities-maintenance`, `hvac-contractor`, `landscaping`, `pest-control`, `plumber`, `pool-spa-service`, `pressure-washing`, `roofing-gutters` |
| `warehousing-fulfilment` | 4 | `cold-chain-storage`, `cross-dock-transload`, `ecommerce-fulfilment`, `third-party-logistics` |

## 4. Current Workspace-Home Profile Coverage

`apps/web/lib/workspace-home/profiles.ts` currently declares these default contributions:

| Contribution | Coverage | Operating question |
| --- | --- | --- |
| `home-care-practice` | Exact `medical-practice`, `dental-practice` | Which patient, appointment, or care-team handoff needs attention now? |
| `home-trades-maintenance` | Category `trades-maintenance` | What has to be dispatched or rescued today? |
| `home-professional-services` | Category `professional-services` | Which client commitments need a decision or follow-up today? |
| `home-media-production` | Category `media-production` | Which production or deliverable needs a decision or handoff today? |
| `home-live-events-venues` | Category `live-events-venues` | What needs attention before the next show or on-sale? |
| `home-retail-goods` | Category `retail-goods` | What is at risk of missing demand today? |
| `home-warehousing-fulfilment` | Category `warehousing-fulfilment` | What is at risk of missing cut-off or going out wrong today? |
| `home-fabric-care-services` | Category `fabric-care-services` | Which garment order is at risk of missing its ready promise today? |
| `home-food-hospitality` | Category `food-hospitality` | Are we ready for the next service period? |
| `home-healthcare-wellness` | Category `healthcare-wellness` | Which patient or client needs attention before the day slips? |
| `home-appointment-services` | Categories `beauty-personal-care`, `fitness-recreation`, `pet-services`, `education-training` | Which bookings, clients, or supplies need attention today? |
| `home-msp-it-services` | Exact `it-managed-services`, `managed-service-provider`, `msp` | What is red on the customer estate? |
| `home-fractional-cxo` | Exact fractional executive archetype ids | Which client leadership decision needs me next? |
| `home-software-platform` | Category `software-platform` | What customer-impacting platform issue needs action? |
| `home-nonprofit-community` | Category `nonprofit-community` | Which mission commitment needs attention today? |
| `home-property-governance` | Categories `hoa-property-management`, `real-estate-construction`, `asset-rental` | Which property, resident, or board issue needs action? |
| `home-civic-public-sector` | Category `public-sector` | Which resident service or civic obligation needs action? |
| `home-banking-financial-services` | Category `banking-financial-services` | Which customer or member decision needs compliant follow-up? |
| `home-field-mobility` | Categories `automotive-services`, `moving-and-logistics`, `security-services` | Which route, vehicle, or field exception needs action now? |
| `home-waste-management` | Exact `waste-management`, `waste-hauling`, `junk-removal`, `sanitation-services` | Which route or missed pickup needs dispatch attention now? |

This is category coverage, not final vertical craft. Category coverage prevents unconfigured generic dashboards. Exact archetype work still has to prove the visual paradigm, vocabulary, fixtures, actions, and mobile behavior for the business.

## 5. Reusable Primitive Families

The current canonical primitive keys are in `apps/web/lib/workspace-home/types.ts`:

| Primitive key | Reusable contract | Typical verticals |
| --- | --- | --- |
| `decision-queue` | Ordered work/customer/request list with urgency, owner, blocker, and next action | service, clinic, legal, nonprofit, property |
| `geo-map` | Sites/customers/properties/routes with health, urgency, assignment, and travel context | field service, MSP, property, dog walking, moving, security |
| `capacity-lanes` | Load by person, crew, room, truck, instructor, practitioner, or other constrained resource | nearly all service and appointment verticals |
| `health-board` | Entity health rollup with severity, last signal, and drill-in | MSP, software, banking/compliance, equipment-heavy service |
| `inventory-watch` | Stock, parts, supplies, perishables, custody, and reorder exceptions | retail, trades, restaurant, florist, vet, warehousing, fabric care |
| `case-board` | Matters, projects, patients, learners, properties, animals, or beneficiaries grouped by stage/risk | legal, accounting, care, education, nonprofit |
| `service-period-board` | Orders, reservations, prep stages, holds, and readiness inside a service window | restaurant, catering, bakery, events, live operations |
| `communication-exceptions` | Failed, overdue, or required messages with channel and audience context | every vertical |
| `handoff-queue` | PAR acknowledgements, HITL approvals, coworker proposals, and team handoffs | every vertical |
| `appointment-schedule` | Appointments, classes, lessons, visits, bookings, and attendee/slot readiness | clinics, beauty, fitness, education, pet care |
| `volunteer-program-board` | Recurring shifts, hour tracking, role pairing, program/event coverage | nonprofits, shelters, clubs, civic/community |

Implementation rules:

- A primitive may accept vocabulary, projection mappings, sorting, grouping, and actions.
- A primitive must not import an archetype contribution directly.
- A vertical contribution composes primitives; primitives do not know verticals.
- If a new visual need cannot be expressed by an existing primitive, the implementation BI must first propose a primitive extension with evidence from at least two verticals or a clear exact-archetype exception.
- Each implementation slice reserves at least 20% of its capacity for shared cleanup/refactoring of the primitive, projection, activation, or fixture surface it touches.

## 6. Visual Paradigm Queue

Each vertical worker home starts with one first-viewport operating question and one primary visual metaphor:

| Operating family | Visual paradigm | Archetype examples | First viewport must show |
| --- | --- | --- | --- |
| Dale / trades dispatch | Dispatch board plus customer/site map | `hvac-contractor`, `plumber`, `electrician`, `appliance-repair`, `pool-spa-service` | Today's jobs, unassigned work, crew load, route timing, parts/site readiness, customer update failures |
| Field mobility | Route map plus capacity lanes | `mobile-mechanic`, `roadside-assistance`, `courier-delivery`, `guard-patrol`, `moving-company` | Route/vehicle/crew status, urgent field exceptions, customer/site access issues, ETA or dispatch handoffs |
| MSP | Customer estate health map | `it-managed-services` | Customer health, critical alerts/tickets, endpoint or configuration context, agreement/SLA risk, approval queue |
| Education and training | Cohort/class readiness board | `corporate-training`, `tutoring`, `music-school`, `driving-school` | Upcoming classes/lessons, registration or learner progress risk, instructor capacity, venue/material readiness, certification/compliance deadlines |
| Appointment businesses | Appointment book plus waitlist/capacity rail | salons, spas, fitness, clinics, pet grooming, counselling | Today's appointments/classes, waitlists or cancellation gaps, provider capacity, client/patient readiness, communication exceptions |
| Food and hospitality | Service-period rail plus prep board | `restaurant`, `catering`, `bakery` | Active orders/reservations, prep stages, holds/late items, stock/perishable exceptions, staffing/capacity |
| Property and asset operations | Property/site work board plus map | HOA, property management, asset rental, construction | Resident/unit requests, vendor work, recurring maintenance, inspections, violations, board/owner decisions |
| Pet and animal care | Animal care board plus owner updates | pet boarding, dog walking, vet, rescue/shelter | Animal identity, owner identity, care instructions, medication/vaccination, occupancy/route, owner communications |
| Nonprofit/community | Mission operations board | charity, shelter, cooperative, sports club, meal delivery | Program/campaign progress, volunteer coverage, beneficiary/member queue, donations/supporter follow-up, compliance/grant deadlines |
| Professional services | Client matter/project board | legal, accounting, agency, consulting | Matters/projects by deadline/risk, document/input requests, approvals, workload, client communication |
| Retail and goods | Inventory/order production board | retail, florist, artisan, wholesale | Stockout risk, open orders, returns, replenishment/supplier exceptions, pickup/delivery or production deadlines |
| Warehousing and custody | Dock/space/stock accuracy board | 3PL, fulfilment, cold chain, cross-dock | Inbound bookings, outbound cut-offs, count variances, space/dock capacity, client exceptions |
| Fabric care | Claim-ticket and ready-promise board | dry cleaning, wash/fold, alterations | Orders due today, garment exceptions, plant/counter/workroom capacity, route timing, ready notices |
| Banking/financial services | Compliant decision/case board | community bank, credit union, mortgage lending | Applications/requests awaiting review, member follow-up, compliance-sensitive decisions, required notices |
| Public sector | Civic service board | municipality, utility, law-enforcement agency | Resident services, permits/inspections, incidents, statutory deadlines, public communication |
| Media and events | Production/show-day board | production studio, staging, venue, promoter | Shoots/events, deliverables, crew/vendor handoffs, capacity, client/guest communication |
| Software operator | Product operations health board | software platform | Customer-impacting incidents, release readiness, onboarding/support queue, service health, coworker approvals |

## 7. Research Checkpoints

The pattern is grounded in current product/operator references, not invented from DPF internals:

- Training companies: [Arlo](https://www.arlo.co/) centers training providers on course creation/scheduling, registrations/payments, reporting, CRM, and delivery; [Moodle Workplace](https://docs.moodle.org/502/en/Moodle_Workplace) adds programs/certifications/audiences/reporting.
- MSPs: [NinjaOne PSA](https://www.ninjaone.com/msp/psa/) frames MSP work around ticketing, billing, documentation, and IT asset management; [NetBox tenancy](https://netbox.readthedocs.io/en/stable/features/tenancy/) is a tenant-scoped infrastructure precedent.
- Field service: [Jobber Schedule](https://help.getjobber.com/hc/en-us/articles/6766253760279-Schedule-in-the-Jobber-App) validates schedule/list/map views for appointments and tasks.
- Appointment and class businesses: [Square Appointments waitlist](https://squareup.com/help/us/en/article/7923-waitlist-with-square-appointments) and [Mindbody scheduling](https://www.mindbodyonline.com/en-au/business/scheduling) validate waitlists, class capacity, staff/provider scheduling, cancellation/no-show behavior, and reminders.
- Food/hospitality: [Toast order management](https://support.toasttab.com/en/article/New-POS-Experience-Ordering-Screens) validates service/order flow rather than a field-service map.
- Property operations: [Buildium maintenance management](https://www.buildium.com/features/property-management-maintenance-software/) validates resident/owner work orders, attachments, vendor performance, recurring items, emergency dispatch, and status updates.
- Nonprofit: [Givebutter](https://help.givebutter.com/en/articles/1726586-what-is-givebutter-and-how-does-it-work) validates campaigns, events, donor CRM, email/communications, payments, and reporting as one mission operations surface.
- Pet/vet: [Gingr dashboards](https://support.gingrapp.com/hc/en-us/articles/27197477970829-Dashboards-Feature-Overview) validates reservation, cancellation, waitlist, pet-parent, and staff action widgets; [Covetrus Pulse](https://covetrus.com/covetrus-platform/workflow-and-productivity-tools/covetrus-pulse/) validates pre-visit to post-appointment clinic workflow.
- Professional services: [Clio matters](https://help.clio.com/hc/en-us/articles/9285920226075-Clio-Manage-Matters-Overview) validates matter-centered legal work; [Karbon](https://karbonhq.com/) validates accounting practice management around client work and team productivity.
- Retail: [Shopify Home](https://help.shopify.com/en/manual/shopify-admin/shopify-home) validates tasks, metrics, cards, and insights for retail operators; [Square inventory tracking](https://squareup.com/help/us/en/article/7746-tracking-your-inventory-with-square-for-retail) validates inventory actions and item availability.

Each downstream BI should add vertical-specific research before implementation. This document gives the starting frame, not a substitute for the exact archetype's worker-day research.

## 8. Backlog Queue

Live MCP state on 2026-08-01:

| Queue | Current state |
| --- | --- |
| Parent spec | `BI-89C19AAF` done. |
| Foundation done | `BI-1CCC6264`, `BI-5B8FE5C1`, `BI-B14D6CF6`, `BI-683C0B9A`, `BI-8D9CA348`. |
| Proving/category homes done | `BI-CE6AF925`, `BI-3F3B535D`, `BI-52E4939B`, `BI-FB7FD753`, `BI-EF03E915`, `BI-02845133`, `BI-CB8EE2D0`, `BI-204CE2D6`, `BI-25AFC2BC`, `BI-FE74CD4A`, `BI-FA3294E0`, `BI-ED0153CA`, `BI-336FC845`. |
| Stale item cleaned up in this pass | `BI-1F7731E5` closed as verified-existing because `home-trades-maintenance` now provides the category fallback it described. |
| Open/dedicated upgrades | `BI-134B247A` education-specific classes/learners/instructors/certification home; `BI-96A3C7A9` property/HOA/community operations; `BI-57BC53E0` professional services; `BI-43A682A2` pet and animal care. |
| Open research/design items | `BI-F30DF062` tutoring; `BI-D66B5585` pet rescue; `BI-C0B632D5` HOA; `BI-BC882DAC` facilities maintenance; `BI-84FD0420` legal; `BI-67DF65E7` pet boarding; `BI-7AB7C2D8` marketing agency; `BI-40F16F19` dog walking; `BI-391A5557` animal shelter. |
| Deferred | `BI-3E8D2CF5` projection service; `BI-8954667A` clinic exact scheduler variant. |

Backlog rule for future additions:

- Do not create a new EP item merely because a category exists. Every current category has a contribution fallback.
- Create or split a BI only when the work is a specific exact-variant upgrade, a missing primitive/projection, or a research/design pass that changes the implementation plan.
- Link exact-variant BIs to this companion spec and to the shared primitive spine. Avoid parallel dashboards.
- If a vertical's main work belongs in an `EP-VERTICAL-*` epic, cross-link that epic instead of duplicating the same work under `EP-REDUCTION-GEAR-ARCH`.

## 9. Setup Activation Requirements

When an archetype is selected, setup must show:

- Whether an exact workspace-home contribution exists.
- Whether a category fallback exists.
- Which primitive widgets will activate.
- Which canonical data and signals are required.
- Which capability activation item owns missing modules or seed records.
- Which follow-on BI owns a missing exact contribution.
- Whether the worker home renders an empty state, platform fallback, or hidden widget when data is missing.

The activation summary must be generated from the same contribution manifest used by `/workspace`, not copied into setup text. The setup surface, worker surface, and backlog queue must stay aligned.

## 10. Visual Artifact Options

Every archetype research/design BI should produce at least one visual artifact before Build Studio implements UI:

- Required: Markdown wireframe/content map in the BI or linked spec/plan.
- Recommended for spatial or dense boards: static HTML prototype under `docs/superpowers/specs/assets/`, with desktop and mobile screenshots.
- Recommended for implemented UI: Playwright screenshot evidence and a text-fit/overlap pass.
- Optional: generated bitmap for mood or domain feel, but not as the source of truth for operational UI.

Visuals are design evidence. The implemented UI must still use DPF components, DPF tokens, semantic HTML, primitive registry contracts, and real loaders.

## 11. UX Fit Contract

Long-tail workspace-home work fits the platform UX with guardrails:

- Owning area: internal workspace home, not customer portal, admin setup, or marketing surface.
- Route family: `/workspace`; setup may summarize activation, but setup does not own a duplicate home renderer.
- Primary persona: the in-trench worker for the archetype, such as dispatcher, scheduler, merchandiser, instructor coordinator, property manager, case owner, or field lead.
- Source truth: the workspace-home contribution manifest plus canonical business records and projection loaders. Do not hardcode separate setup text, seed-only tile state, or archetype-specific renderer forks.
- Navigation layer: no new global navigation group. The archetype changes the first viewport composition, labels, actions, and empty states within the existing workspace-home shell.
- Empty and failure behavior: each primitive must have a domain-native empty state, loading state, and degraded state when the required capability, integration, or projection is missing.
- AI boundary: coworker proposals and approvals appear through `handoff-queue` or a domain-specific primitive action. Worker UI must not expose gear-language, prompt plumbing, hidden contribution stages, or internal reasoning labels.
- Visual evidence: wireframes, static HTML prototypes, and screenshots are review artifacts. Production UI remains on DPF components, DPF tokens, semantic HTML, accessibility contracts, primitive registry types, and governed loaders.

Each downstream BI should record an explicit UX fit decision: `fits`, `fits-with-guardrails`, `defer-for-source-truth`, or `reject-duplicate-surface`.

## 12. Verification Pattern

Every long-tail implementation BI must include:

- At least one persona file or persona smoke case for the target worker.
- Fixture data with one normal item, one urgent item, one missing-readiness item, one communication exception, and one coworker handoff where relevant.
- Desktop and mobile verification against the governed runtime or approved sandbox.
- Banned-copy tests inherited from the parent spec: no gear/ring/torque/slip/wear/cockpit language in worker UI.
- Primitive reuse check: no new one-off tile if an existing primitive can express the state.
- Capability dependency check: no parallel seed fields introduced by the workspace-home BI.
- Refactoring evidence: roughly 20% of implementation effort spent on shared primitive, projection, fixture, activation, or renderer cleanup.

## 13. Recommended Next Execution Order

1. Unblock or re-scope `BI-3E8D2CF5` if concrete projection/rendering depth is required by the next UI slice.
2. Take `BI-134B247A` next for the user's explicit training-company concern: build the education-specific classes/learners/instructors/certification home on top of the existing appointment fallback.
3. Continue the open exact-category upgrades: property/HOA, professional services, pet/animal care.
4. Resolve or re-open the deferred clinic scheduler once projection depth is ready.
5. For new categories added after this document, first add a category contribution and activation summary, then file exact research/design only where the category fallback fails the worker-day fit test.

This keeps the long tail queued without turning the backlog into 103 unrelated dashboard builds.
