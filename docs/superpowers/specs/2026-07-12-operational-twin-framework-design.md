# Operational Twin Framework — one grammar, every archetype (design spec)

**Status:** draft · 2026-07-12
**Epic:** EP-LIVING-BUSINESS-VIZ (proposed in the parent spec)
**Author:** platform (via Claude Code, operator Mark)
**Parent:** [The Living Business — value-stream workforce visualization](2026-07-11-living-business-workforce-visualization-design.md) — §3.1–3.3 established the two-lens model (value stream ⇄ operational twin), the physical/non-physical taxonomy, and the operating-twin doctrine (shared human + AI awareness surface). This spec answers the follow-on question: **how does DPF accommodate ALL archetypes** — 21 categories, 95 seeded archetypes as of the 2026-07-18 source catalog sweep — **without building 95 bespoke twins?**

---

## 1. Problem

Three operational twins exist as prototypes (restaurant floor, field-service dispatch map, rental yard). Each was hand-built, yet all three converged on the same skeleton: capacity chips → an entity surface arranged spatially → one or more queues → an AI "cog" that proposes an allocation → tap-to-confirm → presence + attributed activity. That convergence is the design signal: **the twins are one grammar with different nouns.** But nothing in the platform yet encodes that grammar, decides *which* twin an archetype gets, or names the entities it binds. Left implicit, every new archetype means a bespoke build — exactly the multi-population drift the coworker lifecycle and field-dispatch work eliminated elsewhere.

DPF already solved this class of problem three times, the same way: a **pure derivation from the archetype's operating-model axes, with a leaf override for genuine exceptions** — `deriveOperationalValueStream` (OVSM), `deriveMediaProfile`, `deriveFieldDispatchProfile` (ADR-4). The twin framework must be the fourth member of that family, not a new mechanism.

## 2. Goal

A **Twin Framework** with three parts:

1. **A twin grammar** — the ~10 shared primitives every twin is composed from (proven by the three prototypes).
2. **A template registry** — ~12 twin templates (8 physical, 4 board-family) that arrange the grammar for a class of business.
3. **A derived `TwinProfile`** — `deriveTwinProfile(archetype)` picks the template and binds its nouns from the axes, `schedulingDefaults`, `fieldDispatch`, and vocabulary already on the archetype; a `twinProfile` leaf override mirrors the ADR-4 escape hatch. **Derive, never author** (OVSM rule), with authoring reserved for the exception.

So: 95 current archetypes ÷ 12 templates ÷ 1 grammar — and a new archetype gets a working twin *by derivation* on day one.

## 3. The twin grammar (shared primitives)

Every twin — floor, map, yard, or board — composes these primitives. All are `--dpf-*` token-driven, report-kit-aligned, reduced-motion-safe, and render statically with interactivity as progressive enhancement (prototype-proven):

| Primitive | What it is | Restaurant / Dispatch / Yard instance |
|---|---|---|
| **Capacity chips** | the archetype's real constraints as live counters | tables·seats·6-tops / techs available·queue·emergencies / assets out·utilization·overdue |
| **Zones** | named regions of the operation | kitchen·dining·entrance / territory zones·yard / ready line·returns·maintenance |
| **Resource units** | the countable physical or logical units, each with state + owner | tables+seats / vans+techs (yard-vs-home based) / assets in bays |
| **Work items** | the units of demand being processed, each with owner + progress | tickets on the pass / jobs+appointments / rental agreements |
| **Queues** | ordered demand awaiting allocation | waitlist+reservations / dispatch queue / reservations to fill |
| **The cog** | an AI coworker's allocation proposal over live state (constraint → proposal → confirm) | seat-from-dwell-time / nearest-tech-by-travel / best-asset-by-readiness |
| **Utility band** | supporting activities as meters (bills, tax, compliance, improve) | identical across all three |
| **Presence row** | who inhabits the twin now — humans + AI coworkers, each with what they're attending to | operator+AI host+AI expo+staff |
| **Attributed feed** | who did what, human or AI, on one shared event plane | seat/dispatch/allocate actions + AI reactions |
| **Needs-you quests** | the attention queue pinned to twin context | 6-top blocked / emergencies unassigned / overdue return |

Grammar rules carried from the parent spec: **staff = work owned, not decorative headcount** (§3.1); units evolve as they mature; one bottleneck, not analyst density; every dynamic write via `textContent` (CodeQL-clean); HITL on every cog action.

## 4. The template registry

Templates arrange the grammar for a class of operation. Physical templates render *space*; board templates render *portfolio state*. Twelve cover all 21 categories:

| # | Template | Entity surface | Primary queue | Cog decision |
|---|---|---|---|---|
| T1 | **FLOOR** | tables/stations + seats on a floor plan | waitlist + reservations | seat party from dwell/turn times |
| T2 | **TERRITORY** | fleet/techs on a zone map (yard- or home-based) | dispatch queue | nearest resource by travel + skill |
| T3 | **YARD** | pooled assets in bays (ready/returns/maintenance/out) | reservations to fill | best asset by class + readiness |
| T4 | **BAYS** | work orders on lifts/bays/benches | intake + promised-by | bay + tech scheduling |
| T5 | **BOOK** | providers × chairs/rooms on a day grid | appointment requests + walk-ins | provider/room match, gap-fill |
| T6 | **ROOMS** | rooms/beds/kennels occupancy board | check-ins + waitlist | room assignment by need + turnover |
| T7 | **STORE** | shelves/stock + POS lanes + fulfilment | pickup/online orders + restock | replenish + pick-queue priority |
| T8 | **VENUE** | seat/space map + run-of-show timeline | holds + ticket sales | space/date allocation, hold expiry |
| T9 | **COUNTER** | service counters/case stations | citizen/customer queue + case backlog | next-in-line routing, SLA triage |
| T10 | **TENANTS** *(board)* | accounts/tenants × health/usage/seats | renewals at risk + incidents | route at-risk account to owner |
| T11 | **PIPELINE** *(board)* | matters/engagements/productions × stage | deadlines + review queue | assign by utilization/skill |
| T12 | **PROGRAMS** *(board)* | programs/funds/donors/campaigns | grant deadlines + volunteer shifts | allocate people/funds to programs |

**Variants configure a template, they don't add one:** TERRITORY carries `fleet` (trades/logistics), `posts` (security), `job-sites` (construction), and `unit-portfolio` (property management) variants; BOOK carries `provider-chair` (salon), `provider-x-room` dual-resource (healthcare — the Jane App pattern), and `class-grid` (fitness/education) variants; ROOMS covers kennels/suites/operatory-recovery as well as lodging; TENANTS carries a `portfolio` variant (banking/advisory: accounts + date-driven renewal ticklers); PIPELINE carries a `timeline` variant (media production). One market-driven amendment to the grammar: YARD, ROOMS, and VENUE default to *now* but carry a **short forward-availability horizon** (the Gingr/Point of Rental/Tripleseat occupancy-calendar pattern) — an allocation against a date range is still a "now" decision for those businesses.

## 5. `TwinProfile` — derive, never author

```ts
// packages/storefront-templates/src/twin-profile.ts (proposed; pure, DB-free)
export interface TwinProfile {
  template: TwinTemplate;                    // T1..T12
  variant?: TwinVariant;                     // e.g. "timeline" | "portfolio"
  physical: boolean;                         // spatial twin vs board paradigm
  zones: TwinZoneSpec[];                     // named regions w/ vocabulary nouns
  capacityZoneKey: string;                   // which zone holds the countable units (FLOOR → "floor"/dining room, not "kitchen"); a single-region consumer renders capacity here instead of blindly taking zones[0]
  resourceNoun: { singular: string; plural: string };   // "table" | "van" | "bay" | "chair" | "room" | "seat(license)"
  workItemNoun: { singular: string; plural: string };   // "ticket" | "job" | "agreement" | "matter"
  queues: TwinQueueSpec[];                   // waitlist / dispatch / reservations / intake / renewals…
  cog: TwinCogSpec;                          // decision kind + signals (dwell-time, travel-time, readiness, utilization)
  capacityChips: string[];                   // which live constraints headline
  hybridBoard?: TwinTemplate;                // secondary board for hybrid archetypes (STORE + online, BOOK + telehealth)
}
export function deriveTwinProfile(archetype: ArchetypeDefinition): TwinProfile;
```

Derivation rules (in priority order), all from substrate that already exists:

1. `fieldDispatch.enabled` (derived per ADR-4) → **TERRITORY**, nouns/signals/routeMode straight from `FieldDispatchProfile` (`resource`, `siteModel`, `assignmentSignals`, `inventoryModel`).
2. `axes.provisioning === "reservation-and-return"` → **YARD** (the rental pool axis that already gates `rental-fleet`/`rental-agreements`).
3. `axes.delivery === "digital"` → board family: `platform !== "no"` or subscription → **TENANTS**; engagement/recurring-agreement services → **PIPELINE**; governance `member-owned`/nonprofit tags → **PROGRAMS**.
4. `axes.commercialModel === "point-of-sale"` → **STORE**; `"statutory-fees-and-levies"` + `primaryConsumer: "resident"` → **COUNTER**.
5. `schedulingDefaults.schedulingPattern` disambiguates the service-floor family: `slot` + provider-chair vocabulary → **BOOK**; `slot` + party/table vocabulary (food-hospitality) → **FLOOR**; `class` (fitness/education) → **BOOK** class-grid variant; overnight/occupancy categories (boarding, lodging, healthcare rooms) → **ROOMS**.
6. Category backstops the remainder: automotive → **BAYS**; live-events-venues → **VENUE**; real-estate-construction → TERRITORY job-site variant.
7. `axes.delivery === "hybrid"` sets `hybridBoard` (STORE+TENANTS for retail-with-online, BOOK+PIPELINE for telehealth, etc.).
8. `archetype.twinProfile` (new optional leaf field, `TwinProfileOverride`) partially overrides any of the above — the ADR-4 escape hatch, used only for genuine exceptions.

Nouns resolve through the existing vocabulary system (`resolveVocabularyKey`, `customVocabulary`), so a credit union's board says Members and a clinic's rooms respect the PHI privacy class already modeled on `FieldDispatchProfile.privacyClass`.

### 5.1 The cog is governed by the org's WWWD stance — and the stance is a sibling archetype derivation

*(Added 2026-07-12 to reconcile with the shipped company-stance onboarding — [2026-07-11-wwwd-stance-onboarding-design.md](2026-07-11-wwwd-stance-onboarding-design.md), EP-0AF96937. Additive: it does not change this spec's grammar, templates, or derivation rules.)*

Two connections make the twin's cog and quests concrete rather than hand-waved:

**(a) The stance-vector derivation is a fourth-family member — at a different layer.** The
`deriveTwinProfile`/`deriveOperationalValueStream`/`deriveMediaProfile`/`deriveFieldDispatchProfile`
family lives in `packages/storefront-templates` and derives from `ArchetypeDefinition`. The WWWD
**stance-vector** derivation (`resolveStanceVectors`, `apps/web/lib/onboarding/archetype-business-context.ts`,
shipped in PR #2800) is the same *shape* — a pure derivation from the archetype (keyed off `archetypeId`
+ storefront `category`) with per-industry overrides and a confirm-not-author UX — but it runs one layer
up, at onboarding, and its output is org-overlay WikiPages + `PerspectiveMaterial` (the WWWD corpus), not
a render profile. It answers a question the twin doesn't: **for this kind of business, how much of the
cog's judgment may run without asking, and where is the ceiling.** Treat it as a peer of `schedulingDefaults`
in the "what an archetype carries" catalog — derived config, editable starter, no bespoke authoring.

**(b) The cog's tap-to-confirm and the needs-you-quest primitive bind to the WWWD gate.** The grammar
rule "HITL on every cog action" (§3) has a substrate now. A cog proposal splits by whether the allocation
carries a **business judgment**:
- Pure operational allocations (seat this party, route the nearest tech) — confirm as specified; no WWWD call.
- Allocations that carry a business call the org has a stance on (comp/waive a charge, spend against a
  ceiling, prioritize existing-customer quality over new work) route the confirm through
  `evaluate_org_business_decision` (`domainClass` from the decision kind, `riskTier` from the amount/reach).
  A `recommend`/`arbitrate` lets the cog present the pre-cleared action; an `escalate`/`defer` becomes a
  **needs-you quest** pinned to twin context — answerable in place with the *same* capture pattern the
  `/wiki/review` "Waiting on your call" cards use (`captureOrgDecisionOutcome`), so the operator's answer
  can be remembered as standing doctrine (ruled A/1.0) and the equivalent cog action self-clears next time.

Net: the twin is where WWWD decisions are *made in context*, the stance corpus is what lets the cog make
the common ones without asking, and the needs-you quest is the escalation surface — one loop, already
shipped. Nothing in this framework needs to re-implement decision governance; P3+ template work should
pass cog actions that carry a business judgment through the gate and render escalations as quests. See the
stance spec §13 for the reciprocal reference; incorporation shape kernel-routed (`principle_decide` →
additive cross-reference, high confidence, margin 3.59, DI-4E2943E733A7).

## 6. Research & Benchmarking — the vertical-market evidence

Per §10, each category was benchmarked against its market-leading vertical solutions (what their live-operations surface centers on, and the signature allocation decision it assists). Full briefs in §6.1; the synthesis:

- **The market already builds exactly one "now" surface per vertical** — Toast's KDS + floor, ServiceTitan's dispatch board, Point of Rental's availability calendar, Shopmonkey's workflow board, Mindbody/Vagaro's provider day-grid, Gingr's kennel board, Tripleseat's function diary, Gainsight's health board, Karbon/Clio's work pipeline. That is strong external validation of the one-template-per-class registry: DPF is not inventing categories, it is *unifying* the per-vertical surfaces the market proves against one grammar + one data plane.
- **Every anchor product pairs the surface with one high-frequency allocation assist** — table from turn time, nearest tech, best asset, next appointment gap, at-risk account routing. That is the cog, generalized.
- **What the market does NOT have** (the gap DPF fills): the AI coworker as a *present, attributed teammate* on the surface (they offer suggestions, not inhabitants); one grammar across verticals (each anchor is a silo); and the value-stream lens behind every twin (their flow analytics are separate reporting modules, not a paired lens).

### 6.1 Category briefs (market anchors → twin binding)

Compiled 2026-07-12 from four parallel research sweeps (web-verified; anchor products named, open-source noted where one credibly exists). Each row: what the vertical leaders center their live-ops screen on, the signature allocation decision they assist, and the DPF template that binding lands on.

| Category | Market anchors (OSS) | Their "now" surface → signature decision | DPF template |
|---|---|---|---|
| food-hospitality | Toast, Square for Restaurants, OpenTable/SevenRooms (Odoo POS) | status-colored floor plan + KDS ticket rail → table assignment from turn-time + section load | **T1 FLOOR** |
| trades-maintenance | ServiceTitan, Housecall Pro, Jobber (OCA Field Service) | dispatch board (techs×time) + live truck map, unassigned queue always visible → best tech by skill/proximity/availability | **T2 TERRITORY** `fleet` |
| moving-and-logistics | SmartMoving, Supermove, Onfleet, OptimoRoute (CoopCycle) | crew/truck day board + ETA-forward live driver map with exception flags → crew-to-job / min-detour stop assignment | **T2 TERRITORY** `fleet` |
| security-services | TrackTik, Silvertrac, Belfry (Resgrid≈) | sites/posts map + guard GPS + checkpoint compliance-by-exception + incident feed → fill open post w/ licensed, site-cleared guard | **T2 TERRITORY** `posts` |
| hoa-property-management | AppFolio, Buildium, Vantaca, CINC (Odoo≈) | unit/association board + work-order & violation queues, everything-a-ticket-with-owner → dispatch work order to vendor by priority/SLA | **T2 TERRITORY** `unit-portfolio` |
| real-estate-construction | Procore, Buildertrend, JobTread (ERPNext) | per-job dashboard: schedule + daily-log heartbeat + RFI/change-order exception queues → crew/sub allocation across job-phases when delays cascade | **T2 TERRITORY** `job-sites` (+ PIPELINE `timeline` board) |
| asset-rental | Point of Rental, Booqable, EZRentOut, Quipli (Snipe-IT≈) | availability calendar (assets×dates) + pickups/due-back/overdue queues → allocate serialized unit to booking window, suggest substitutes | **T3 YARD** |
| automotive-services | Tekmetric, Shopmonkey, Shop-Ware, AutoLeap | kanban RO pipeline (estimate→approved→in-progress→done) + tech/bay calendar, awaiting-parts/approval blockers surfaced → RO into tech+bay by labor-hours/skill/parts arrival | **T4 BAYS** |
| beauty-personal-care | Fresha, Vagaro, Boulevard, GlossGenius (Easy!Appointments≈) | provider-column day calendar w/ processing-time gap-fill → slot/provider matching ("precision scheduling") | **T5 BOOK** `provider-chair` |
| healthcare-wellness | Jane App, SimplePractice, Dentrix, athenahealth (OpenEMR) | provider×room/operatory grid + patient-flow state board (arrived→roomed→treating→checkout) → dual-resource provider+room co-scheduling | **T5 BOOK** `provider-x-room` |
| fitness-recreation | Mindbody, Mariana Tek, Glofox, Rock Gym Pro | class schedule w/ capacity bars + named-spot maps + check-in feed → waitlist promotion into canceled spots by eligibility | **T5 BOOK** `class-grid` |
| education-training | TutorCruncher, Teachworks, Pike13 (openSIS) | week grid (sessions×instructor/room) + attendance-drives-billing, expiring-package queue → student↔instructor/timeslot matching, fill cancellations | **T5 BOOK** `class-grid` |
| pet-services | Gingr, PetExec, Goose, DaySmart Pet | kennel/run occupancy grid over dates (hotel-style) + arrivals/pickups queues + safety flags → run assignment by size/temperament/multi-pet family | **T6 ROOMS** (BOOK for grooming) |
| retail-goods | Shopify POS, Square for Retail, Lightspeed (Odoo POS) | register + catalog grid; inventory as the single live truth across floor/back-room/online; pickup + low-stock queues → reorder/restock + pick-queue priority | **T7 STORE** (hybrid TENANTS-lite for online) |
| live-events-venues | Tripleseat, Perfect Venue, Eventbrite, Momentus (pretix) | one space/date calendar where sales pipeline and event readiness converge; leads/contracts/BEO queues → space-and-date fit without double-booking | **T8 VENUE** |
| public-sector | Tyler EnerGov, Accela, OpenGov, Cloudpermit (CiviForm) | permit/case workload by status & reviewer + inspections-today, applicant portal mirroring internal state → route application to reviewer, slot inspections vs SLA clocks | **T9 COUNTER** |
| software-platform | Gainsight, ChurnZero, Vitally/Planhat (PostHog signals) | account health board (red/amber/green w/ drill-down to raw signal); renewals≤90d + at-risk + open-CTA queues → route at-risk/renewal account to CSM by health-drop + load | **T10 TENANTS** |
| banking-financial-services | nCino, Applied Epic/AgencyBloc, Redtail/Wealthbox (Fineract) | stage pipeline (loans/policies) + date-driven renewal/maturity ticklers as the heartbeat → assign application/renewal by workload + licensing authority | **T10 TENANTS** `portfolio` |
| professional-services | Clio, Karbon, Canopy, Kantata (OpenProject) | matter/engagement pipeline + utilization board side-by-side; deadline/review/unbilled-WIP queues → assign matter by utilization/skill/deadline | **T11 PIPELINE** |
| media-production | Frame.io, StudioBinder, Farmerswife (Kitsu) | production timeline/kanban (shoot→edit→review→deliver) + version-centric review queue w/ explicit waiting-on-client state → editor/suite assignment by availability + deadline | **T11 PIPELINE** `timeline` |
| nonprofit-community | Blackbaud NXT, Bonterra, Bloomerang, Neon (CiviCRM) | goal thermometer + moves-management pipeline + lapse-risk/grant-deadline queues → route lapse-risk or major-gift-ready donor to staff outreach | **T12 PROGRAMS** |

**Cross-cutting patterns the research adds to the grammar:** (a) *exception queues are the heartbeat* everywhere — due-backs, renewals, missed checkpoints, awaiting-parts, waiting-on-client — confirming queues + needs-you quests as first-class primitives, with an explicit **blocked-on-external state** (waiting on customer/parts/client) added to the work-item primitive; (b) *the unassigned queue must always be visible* (ServiceTitan's board rule); (c) the consistent **rejects** are enterprise config sprawl, module mazes, and marketplace-first designs that subordinate the operator — which is precisely the §17 hide-complexity doctrine and the ≤6-zone/≤5-quest progressive-disclosure ceiling; (d) attendance/usage-drives-billing linkages (Teachworks, Toast) confirm the twin must emit to the finance spine, not merely display.

## 7. Plan

- **P1 — the derivation (pure).** `twin-profile.ts` + `deriveTwinProfile` + tests asserting every seeded archetype in the current source catalog derives a template with bound nouns (the OVSM test pattern). No UI. Leaf override type wired into `ArchetypeDefinition`.
- **P2 — the grammar kit.** The ten primitives as React components on the existing token/report-kit substrate (`apps/web/components/twin/`), each one lifted from the prototypes (capacity chips, zone, resource unit, queue, cog banner, utility band, presence, feed, quests). Storybook-style fixture page per primitive.
- **P3 — first templates live.** FLOOR, TERRITORY, YARD land as template compositions bound via `TwinProfile` — replacing the three hand-built prototypes with framework-rendered equivalents, wired to `LivingBusinessSnapshot` + `agent-event-bus` (parent spec P1–P2).
- **P4 — coverage by demand.** Remaining templates (BOOK, BAYS, ROOMS, STORE, VENUE, COUNTER, boards) in install-demand order; each is a template + bindings, not a bespoke build. Certification: a golden-journey per template exercising queue→cog→confirm.
- **P5 — simulator coverage.** Business Activity Simulator archetype factories (its P2) emit per-template scenarios so every twin can be demonstrated live on a test install.

## 8. Non-goals
- No new domain tables — `TwinProfile` is derived config; twin state remains a projection (`LivingBusinessSnapshot`).
- No 53 bespoke twins, and no editor for arranging twins by hand.
- No game engine / 3D (parent spec §5 stands).
- Board templates are not BI dashboards — they keep the grammar (queues, cog, presence), not chart walls.

## 9. Open questions
1. Should `TwinProfile` also drive the *mobile* twin layout (capacity chips + queues only, surface collapsed) or is that a render-kit concern? (Leaning: render-kit breakpoint, not profile.)
2. PHI-class twins (healthcare ROOMS): does the presence/feed primitive need a redaction mode keyed off `privacyClass`? (Leaning: yes — feed shows role, not patient identity.)
3. Multi-archetype compositions (`StorefrontArchetypeComposition`, primary + 2 secondaries): render the primary's twin with secondary queues folded in, or tabbed twins? (Defer to first real composed install.)

## 10. Verification & docs impact
- P1 is source-only (pure derivation + tests → worktree gates). P2+ are UI-bearing: UX-Fit decision required per template family (§12), docs in `docs/user-guide/` per landed template, evidence via the shared local-CI sandbox per §5.
- This spec + the parent satisfy the Spec/Plan/Doc gate for the design phase of EP-LIVING-BUSINESS-VIZ.
