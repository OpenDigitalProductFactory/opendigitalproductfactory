---
status: draft
backlog_item: BI-B3D87B06
workroom: WC-6EFDA731
parent: 2026-10-27-work-atlas-design.md
---

# Work Atlas: tailoring the picture to the business

| | |
|---|---|
| Parent | [Work Atlas design](2026-10-27-work-atlas-design.md) §3.8 |
| Backlog / Workroom | BI-B3D87B06 / WC-6EFDA731 |
| Requested by | Owner, 2026-10-27: the condensed Atlas is right, but every business should see its work in a shape it recognizes. That shape is further refined by where the business operates, which animals a vet treats, what food a restaurant serves and how it serves it. Some of this is defined, some is not. |
| Prototype | [`assets/2026-10-27-work-atlas-prototype.html`](assets/2026-10-27-work-atlas-prototype.html), with an archetype switch and refinement chips |

## 1. Answer in brief

- **Arrangement changes per business, meaning never does.** The Atlas keeps one state grammar everywhere:
  - grey: moving
  - amber diamond: needs a person
  - red bar: stuck
  - hatching: no signal

  What changes per business is how the squares are arranged:
  - restaurant: along the service day
  - HVAC: across a map of the service area
  - vet: in an appointment book beside a ward or a farm round
  - software house: by portfolio
- **The arrangement is derived, not hand-drawn for 107 businesses.** DPF already sorts every archetype into one of 13 operational twin templates (`deriveTwinProfile`, `packages/storefront-templates/src/twin-profile.ts`). The Atlas reuses that choice: one Atlas layout per template, with nouns from the leaf vocabulary. A leaf override exists for genuine exceptions.
- **Refinements change the picture through what they do to operations, not their labels.**
  - "Sushi" and "barbecue" are not layouts. Cook-to-order versus long, timed cooks are.
  - "Exotics" is not a layout. Long appointments and enclosure checks are.
  - "Large animal" is not a layout. Farm rounds with herds as the unit are.
- **Location shapes three things:** the map (drawn service areas), the standing checks (what the jurisdiction requires) and the season (what the day's question asks first).
- **Most refinements are not recorded yet.** There is no organization-level place to say which animals a practice treats or how a restaurant serves. Section 6 proposes one that extends the existing facet registry rather than adding fields per archetype. It needs an owner decision.

## 2. What exists today

| Input | Status | Where |
|---|---|---|
| 107 leaf archetypes in 25 categories | Defined | `packages/storefront-templates/src/archetypes/*.ts` |
| Twin template per archetype (13) | Defined, derived | `twin-profile.ts` `deriveTwinProfile` |
| Leaf vocabulary (items, team, stakeholder nouns) | Defined | `ArchetypeVocabularyOverride`, `archetype-vocabulary.ts` |
| Primary plus up to two secondary archetypes | Defined | `StorefrontArchetypeComposition` |
| Operating-model axes | Defined | `OperatingModelAxes` (`types.ts:316`) |
| Field-dispatch profile and compliance overlays (EPA 608, HIPAA clinical, pesticide applicator, DOT hours) | Defined, derived | `field-dispatch.ts` |
| Standing rooms (operating rhythms) | Defined, derived | `standing-rooms.ts` |
| Jurisdiction (`operatesIn`, `stateCode`, `geographicScope`) | Defined | `BusinessContext` |
| Drawn service areas | Defined | `OperationalSceneLayout` (TERRITORY), `lib/twin/service-area-layout.ts` |
| Sites (work, care, customer) | Partial: rows exist, no "how many sites" signal | `WorkLocation`, `CareLocation`, `CustomerSite` |
| Clinic vs mobile | Defined as separate leaves | `veterinary-clinic` / `mobile-vet`, `hair-salon` / `mobile-beauty` |
| Facet registry (commercial, delivery, resource, workforce, trust) | Partial: documented, no leaf-to-facet table in code | `docs/architecture/four-portfolio-archetype-standard-profile-catalog.md` §2 |
| Vet practice focus (companion, exotics, equine, production animal, mixed) | **Absent.** Species is a per-booking select only; the vet spec scopes v1 to companion animals | `2026-08-08-veterinary-clinic-operating-system-design.md` |
| Food service channels (dine-in, takeout, delivery, catering, truck) | **Absent.** Catering is a leaf or adjacent product line; dine-in vs takeaway order binding is planned | `2026-08-05-viral-walkup-consumer-front-door-design.md` |
| Kitchen production pattern / cuisine | **Absent** | — |
| Trades customer segment (residential, commercial) | **Absent** at organization level; per-request `propertyType` only | `trades-maintenance.ts` |
| Seasonality | Partial: marketing notes and the `seasonal-operations-read` skill, no operating field | `strategy-grounding.ts` |

The workroom surfaces themselves have no archetype branching today (`components/ops/workrooms/*`). Archetype reaches rooms only as data, through the value-stream projection.

## 3. The rule: one grammar, many arrangements

The parent spec (§6, rule 1) fixes one health vocabulary. Tailoring must not break it:

- **State is never re-encoded.** Colour, the diamond, the bar and the hatching mean the same for every business. An operator who looks after a vet practice and an HVAC firm, or an MSP watching many customers, reads both without relearning. Shape-plus-colour also keeps the map usable without colour vision.
- **Kind is shown by position, not by a new mark.** A catering order and a dine-in party are both squares; the catering one sits in the catering lane. Squares stay 14px and identical. Kind-specific icons inside cells were rejected: at 300 cells they become noise, and they would compete with the state marks.
- **Tailoring may change:**
  - the arrangement (lanes, columns, zones, beds);
  - the time axis (service periods, arrival windows, appointment hours, days ahead);
  - the nouns (vocabulary);
  - the day's question;
  - which standing checks appear;
  - which group leads.
- **Layouts compose.** A vet clinic is an appointment book and a ward. A mixed practice adds a farm round. As with archetype composition, there is one primary arrangement and at most two secondary panels.
- **The stage lens and the room checklist are the same everywhere.** Every business can still ask "where is work and how long has it sat there" in the same form.

## 4. Thirteen Atlas layouts, one per twin template

| Twin template | Who gets it (examples) | Primary arrangement | Time axis | Typical question |
|---|---|---|---|---|
| TENANTS | software platform, banks, credit unions | groups by portfolio, then shape (the parent design) | age vs usual | What is waiting on a person, and for how long? |
| PIPELINE | legal, accounting, consulting, agencies, media | stage lens leads; groups by client or matter | age vs usual | Which matters will miss their date? |
| PROGRAMS | charities, cooperatives, sports clubs | groups by program or fund | days to deadline | Which programs are behind on what they promised? |
| FLOOR | restaurant, bakery, catering | lanes by service channel × service periods today; an "ahead" strip for booked events | service clock | Are we ready for the next service? |
| TERRITORY | HVAC, plumbing, electrical, pest, roofing, moving, security, mobile vet, agriculture, property, construction | zones of the drawn service area; a technician board by arrival window below | arrival windows today | What has to be dispatched or rescued today? |
| BOOK | vet clinic, dental, medical, physio, salons, pet grooming, classes | providers × hours of the day | appointment hours | Is the day running to time, and who is waiting? |
| ROOMS | boarding, kennels, inpatient wards, shelters (as a secondary panel) | one tile per bed, kennel, stall or enclosure | length of stay | Who is due out, and is every patient checked? |
| YARD | equipment, self-storage, production gear rental | bays: in yard, out, due back, in inspection | due-back time | What is due back, and what is not ready to go out? |
| BAYS | auto repair, fabric care, manufacturing (interim) | work centres or bays × stations | promised-by time | Which bay is holding up promised work? |
| STORE | retail, florist, artisan, wholesale | lanes: stock, orders to fulfil, returns | order promise | What will not ship or restock in time? |
| VENUE | event venues, promoters, booking agencies | run-of-show timeline per event | event countdown | Is every event on track for its date? |
| COUNTER | municipality, utility, public services | counters or case queues | statutory clock | Which cases are near their legal deadline? |
| DOCK | 3PL, fulfilment, cold chain, cross-dock | dock doors and pick waves | cut-off times | Will today's waves make their cut-off? |

Mapping by category, from `deriveTwinProfile`:

| Category | Atlas layout |
|---|---|
| software-platform | TENANTS |
| banking-financial-services | TENANTS (portfolio) |
| professional-services, media-production | PIPELINE (field professions such as surveying go to TERRITORY) |
| nonprofit-community | PROGRAMS (shelter and rescue add a ROOMS panel for animals or beds) |
| food-hospitality | FLOOR |
| trades-maintenance, moving-and-logistics, security-services, mobile automotive, hoa-property-management, real-estate-construction, agriculture-ranching | TERRITORY |
| healthcare-wellness | BOOK, or ROOMS when inpatient |
| pet-services | BOOK, or ROOMS when boarding |
| beauty-personal-care, fitness-recreation, education-training | BOOK |
| asset-rental | YARD |
| automotive-services (fixed), fabric-care-services, manufacturing | BAYS |
| retail-goods | STORE |
| live-events-venues | VENUE |
| public-sector | COUNTER |
| warehousing-fulfilment | DOCK |

Nothing in this table is new data. Each Atlas layout is a renderer of the same atlas projection (parent spec §4) with one added field: each room's **lane** and **slot** in the business's arrangement. Section 7 covers where those come from.

## 5. Refinements: what each one changes in the picture

A refinement is admitted only if it changes something an operator sees. For each one below: what it changes, and the evidence for it.

### 5.1 Restaurant and food service: how the food is served

The service channels decide the FLOOR lanes. A business picks one or more; the first is its primary channel.

| Channel | Lane shows | Time measured against | Question when primary | Standing checks it adds |
|---|---|---|---|---|
| Dine-in | parties and tables per service period | seat time, course pacing | Are we ready for the next service? | opening checklist, floor walk |
| Takeout | orders by promised pickup time | promised time, not usual time | Will every order be ready when promised? | pickup shelf check |
| Delivery | orders and courier handoffs | promised time and courier arrival | Which orders will reach the door late? | third-party tablet check, packaging stock |
| Catering and events | an "ahead" strip: today, tomorrow, the next seven days | days to event, against the prep plan | Is every booked event on track for its date? | deposit chase, event prep list |
| Food truck | stops through the day, with commissary prep before the first stop | stop times | Are we stocked and on time for each stop? | commissary log, permit for each location |

**Cuisine is not a lane.** What cuisine changes is the kitchen's production pattern and its food-safety load, and both show up in the rhythm strip and the prep lane:

| Production pattern | Example | What changes |
|---|---|---|
| Cook to order | bistro, diner | ticket times; prep is a morning lane |
| Bake or batch ahead | bakery, café | an overnight production column before opening |
| Long timed cooks | barbecue, braises, stocks | start times hours before service become standing checks ("smoker lit by 04:00") |
| Raw or high-allergen | sushi, raw bar, nut-heavy menus | extra temperature and allergen logs; a missed log is a red tick |

### 5.2 Veterinary: which animals, and where they are seen

Practice focus decides the layout composition. The unit of work changes with it.

| Focus | Primary | Secondary panels | Unit of work | Standing checks it adds |
|---|---|---|---|---|
| Companion animal (dogs, cats) | BOOK: vets × hours | ROOMS: ward kennels | one patient | controlled-drug count, surgery list, fridge temperature |
| Exotics (reptiles, birds, small mammals) | BOOK, with longer slots | ROOMS: enclosures, each with environment checks | one patient | enclosure temperature, humidity, UV lamp hours |
| Equine | TERRITORY: the yard and stable round | ROOMS: hospital stalls | one horse, or one yard visit | vaccination and passport due, truck stock |
| Production animal (cattle, sheep, pigs) | TERRITORY: the farm round | none, or a campaign strip for herd tests | one farm visit, with head count | biosecurity log, medicine withdrawal records, testing campaigns |
| Mixed | BOOK for the clinic | TERRITORY farm round and ROOMS ward | either | the union of the above |

The `mobile-vet` leaf already exists with horse and livestock species. A clinic that also goes out is a composition (`veterinary-clinic` primary, `mobile-vet` secondary), not a new leaf.

### 5.3 Trades (HVAC and the TERRITORY family): who the customer is

| Segment | What changes |
|---|---|
| Residential | Arrival windows lead. "No heat" and "no cooling" calls sort first. The question names households waiting. |
| Commercial | Each contract's response time replaces "usual" as the yardstick. A planned-maintenance lane by site appears. After-hours calls get their own column. |
| Both | Two lanes on the technician board, so contract work is not hidden behind household calls. |

### 5.4 Location

| Location input | Status | What it changes |
|---|---|---|
| Drawn service areas | Defined | The TERRITORY zones are the business's own drawn areas, in its own names. Jobs outside every area are grouped under "Outside our area", which is itself a signal. |
| Jurisdiction | Defined | Which standing checks are required, and how they are named. Examples: EPA 608 refrigerant logs for US HVAC, the controlled-drug register for vets, health-inspection cadence by county. These come from compliance overlays, never hard-coded per archetype. |
| Several sites | Partial | With more than one site, **site becomes the outer group** ahead of portfolio or lane. A site with no recent signal is as visible as a stuck room. |
| Season and climate | Partial | The question and the sort order change with the season: heating season puts no-heat calls first; lambing season puts farm calls first. Hemisphere comes from the address. |

## 6. Gap: where refinements are recorded

**The gap.** Nothing records an organization's practice focus, service channels, production pattern or customer segment. Seasonality has no operating field. The facet registry already describes the right kind of thing (`DEL-FIELD` vs `DEL-FACILITY`, `RES-PERISHABLE`, `TRU-CLINICAL`), but it is documentation only.

**Proposal: extend, do not invent.**

1. **Select facets for the organization.** Add an organization-level facet selection to `BusinessContext`. It is a list of facet IDs from the existing registry, seeded from the archetype's defaults and confirmable by the owner. Selection never weakens a core requirement, as the registry already states.
2. **Add the missing axes to the registry itself.** Add three facet axes to the registry document and its typed mirror, rather than new columns per archetype:
   - `CHN-` service channel: dine-in, takeout, delivery, catering, mobile/truck
   - `SEG-` customer segment: household, commercial, public, agricultural
   - `SUB-` served subject: companion animal, exotic, equine, production animal (reusable later for, say, paediatric vs adult care)

   Production pattern fits under the existing `DEL-PRODUCTION` facet, as sub-values.
3. **Derive layouts from facets.** The Atlas derives lanes, panels, checks and questions from archetype + selected facets + location, through one pure `deriveAtlasProfile()`. It sits beside `deriveTwinProfile()`, follows the same derive-with-override pattern, and is tested the same way.
4. **Derive first, ask last.** Where the platform already knows a refinement, it proposes it and the owner confirms. This matches BI-0902BAE9, which stops setup from asking what is already known. Refinements can be derived from:
   - catalogue items: a "Farm call" item implies production animals;
   - booking species;
   - order channels;
   - the business's website, through the existing public-web classifier, which already recognizes cafés, pubs and food trucks.

   Setup asks only for what cannot be derived.

**Why not per-archetype fields.** One "practice type" field on the vet leaf, a "service model" on restaurant and a "segment" on trades would give 107 leaves their own fields, with no shared meaning. Facets keep one vocabulary, which the parent spec's §6 rule 1 requires.

**Decision needed (owner, kernel-scored).** Adopt organization-level facet selection plus the three new axes; or keep refinements out of scope and tailor by archetype only. This is new substrate, so it goes through `principle_decide` with the verify-substrate-first check before any schema work. The work is filed as **BI-7EE5681A** (see §8).

## 7. Where each room's lane and slot come from

| Layout | Lane source | Slot source | Status |
|---|---|---|---|
| FLOOR | the order or event's channel | service period from the promised or booked time | Partial: order binding planned; channel absent until §6 |
| TERRITORY | service-area zone from the job address; technician from assignment | arrival window | Defined: geocoding, service areas, dispatch assignment |
| BOOK | provider from the appointment | appointment hour | Defined for bookings |
| ROOMS | bed, kennel, stall or enclosure | length of stay | Defined where the archetype has resource kinds |
| YARD, BAYS, DOCK, STORE, VENUE, COUNTER | the twin's own resource | the twin's promise time | Defined per twin; read from the same scene data the twin uses |
| TENANTS, PIPELINE, PROGRAMS | portfolio, client or matter, program | stage | Defined |

A room that cannot be placed lands in a visible "Not yet placed" group, as unportfolioed rooms already do. It never silently disappears.

## 8. Delivery

The parent delivery outline (§9) gains two steps, replacing A6:

- **A6a: layouts from the twin template.** Needs no new data.
  - Ship TENANTS (already designed), FLOOR, TERRITORY, BOOK and ROOMS first. These cover software, food, trades and field services, healthcare and pets: the archetypes with live acceptance fixtures (restaurant, HVAC, vet, pet rescue).
  - Ship the other eight after, each behind its archetype's readiness row.
  - Each layout gets a fixture test asserting that the state glyphs are identical to TENANTS.
- **A6b: refinements.** Starts after the §6 decision. Facet selection, `deriveAtlasProfile()`, onboarding choices, and the location effects in §5.4.

The UX Design Critic reviews A6a per layout. The owner's verdicts on the first layout calibrate the rest (parent spec §7).

**Backlog.** BI-7EE5681A is filed under the Work Atlas work, for organization-level refinement facets (§6).

## 9. Owner decisions

1. **Adopt organization-level facet selection for refinements, plus the three new axes (§6)?** Recommended. Without it the Atlas tailors by archetype alone, and a large-animal vet sees a companion-animal clinic's book.
2. **Which secondary-panel limit?** Two is recommended, matching archetype composition. A mixed vet practice uses both slots.
