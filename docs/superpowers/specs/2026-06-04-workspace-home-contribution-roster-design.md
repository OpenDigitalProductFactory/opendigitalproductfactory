---
title: Workspace-home contribution roster — per-category + per-archetype delivery sequencing across the canonical 12 industries
date: 2026-06-04
status: proposal — awaiting operator review
owner: Mark Bodman (CEO) — proposed by agent
epic: EP-REDUCTION-GEAR-ARCH
implements-coverage-for:
  - 4 already-filed category-level workspace-home BIs (BI-EF03E915, BI-43A682A2, BI-96A3C7A9, BI-02845133)
  - 1 implicit cross-category category-level BI (BI-FE002675 MSP, sits inside professional-services)
  - 1 in-flight exact-archetype BI (BI-CE6AF925 HVAC, sits inside trades-maintenance)
  - 37 already-filed per-archetype "workspace-home research/design" BIs (small effort each)
identifies-gaps:
  - 7 categories without a consolidating category-level BI (trades-maintenance, healthcare-wellness, beauty-personal-care, education-training, food-hospitality, retail-goods, fitness-recreation)
extends:
  - docs/superpowers/specs/2026-05-24-vertical-workspace-home-design.md §5.3 (resolver: exact → category → unconfigured)
  - docs/superpowers/specs/2026-05-24-workspace-home-primitive-registry-design.md (11 primitive families)
  - docs/superpowers/specs/2026-06-04-vertical-workspace-home-projections-design.md (signal projection — PR #1452)
relates-to:
  - docs/superpowers/plans/2026-06-04-hvac-dispatcher-workspace-home.md (Dale HVAC plan — PR #1442; the trades-maintenance proving install)
  - docs/superpowers/plans/2026-06-04-workspace-home-primitive-registry.md (primitive registry plan — PR #1453)
  - PR #1456 (substrate primitive-key rename — BI-5B8FE5C1 Phase 1)
---

# Workspace-home contribution roster — sequencing across the 12 industries

## 1. The question

The substrate is on main. The architect amendments are merged. The telemetry counter ships the silent-fallback signal. The primitive registry has a plan. The HVAC dispatcher home has a plan. The projection service has a spec.

**Today, every install renders the platform fallback regardless of archetype**, because the `defaultWorkspaceHomeRegistry` is empty by design (substrate-only delivery). The 12 industry categories holding 45 archetypes all match no contribution at resolve time.

This doc continues the workspace-home work past the substrate boundary: it enumerates the **contribution roster** — which archetypes need a vertical worker home registered (vs. staying on the platform fallback), what proving install ships first per category, which existing BIs become the per-archetype-override layer, and where consolidating category-level BIs are missing.

It is scoped at "what to build, in what order, against what archetypes" — not "how to build it." The how lives in [the primitive registry plan](../plans/2026-06-04-workspace-home-primitive-registry.md), the [Dale plan](../plans/2026-06-04-hvac-dispatcher-workspace-home.md), and the per-category implementation plans this doc unlocks.

## 2. Substrate behavior — install-time and runtime

The substrate's `resolveWorkspaceHomeContribution` already supports both surfaces Mark named:

**Initial install / config (`/storefront/setup`).** The setup wizard calls `buildWorkspaceHomeActivationSummaries(archetypes)` per page render. Each archetype gets an activation summary projecting one of three outcomes:

- `mode: "vertical", match: "exact"` — an exact semantic `archetypeId` contribution exists.
- `mode: "vertical", match: "category"` — a category-fallback contribution exists.
- `mode: "unconfigured", match: "none"` — no contribution matches; platform fallback + the honest "no worker home yet" notice.

`ArchetypeActivationSummary` (in the wizard's preview step) renders the worker-home panel with `primaryOperatingQuestion` (architect amendment), primitive widgets, and the activation status. Admins see the outcome **before committing**.

**Later as needed (`/storefront/settings/*`, archetype reconfiguration).** The resolver re-evaluates per page load — no caching (parent spec §5.3 "Archetype change behavior"). When an install changes its `StorefrontArchetype`, the next `/workspace` render uses the new contribution. No code change is needed in the substrate to support runtime archetype switching; what's missing is **contributions to switch to**.

Both paths are wired. Filling them requires contributions.

## 3. Industry inventory — 12 categories, 45 archetypes

Source: `apps/web/lib/storefront/industries.ts` (canonical industry slugs) + `StorefrontArchetype` rows seeded on the live install (verified via DB query 2026-06-04).

| Category slug | Archetype count | Archetypes |
| --- | --- | --- |
| `beauty-personal-care` | 5 | barber-shop, beauty-spa, hair-salon, nail-salon, personal-trainer |
| `education-training` | 4 | corporate-training, driving-school, music-school, tutoring |
| `fitness-recreation` | 3 | dance-studio, gym, yoga-studio |
| `food-hospitality` | 3 | bakery, catering, restaurant |
| `healthcare-wellness` | 5 | counselling, dental-practice, optician, physiotherapy, veterinary-clinic |
| `hoa-property-management` | 3 | condo-association, homeowners-association, property-management-company |
| `nonprofit-community` | 5 | animal-shelter, charity, community-shelter, pet-rescue, sports-club |
| `pet-services` | 3 | dog-walking, pet-boarding, pet-grooming |
| `professional-services` | 5 | accounting, consulting, it-managed-services, legal-services, marketing-agency |
| `retail-goods` | 3 | artisan-goods, florist, retail-goods |
| `software-platform` | 1 | software-platform |
| `trades-maintenance` | 5 | cleaning-service, electrician, facilities-maintenance, landscaping, plumber |

`software-platform` is the **DPF-on-DPF install** — the platform itself. Per parent spec §5.5 audience layering, the platform operator's surface is the Cockpit (gear/ring vocabulary, BI-19D40BE7 territory); the platform-platform install should keep using `PlatformWorkspaceHome` as its day-to-day worker home. **`software-platform` does not need a vertical contribution.** The remaining 11 categories (44 archetypes) need worker-home functionality.

## 4. Coverage strategy — category-first, archetype-override-as-evidence-justifies

The substrate's resolver does `exact archetype slug` → `category fallback` → `unconfigured`. This gives the contribution roster a free **two-tier layering**:

- **Tier 1 — category-level contributions** (1 per category, 11 total) provide a useful, archetype-flavored worker home for *every* archetype in their category by default. Vocabulary is category-generic ("Trades worker" / "Clinic worker" / "Member program" rather than "HVAC dispatcher" / "Dental hygienist" / "Yoga studio coach").
- **Tier 2 — exact-archetype overrides** (filed as needed) sharpen vocabulary and primitive composition for the highest-evidence archetypes within a category. Dale's HVAC home (BI-CE6AF925) is exactly this pattern: it overrides the trades-maintenance category-level contribution for the `hvac-contractor` archetype with HVAC-specific labels, slot priorities, and primitive bindings.

This is the architecturally-honest path: it covers the 44 archetypes with 11 contributions, then lets evidence (per-archetype usage rates, vocabulary-gap complaints, customer-flagged unhappy paths) drive which archetypes deserve their own override. **It does NOT require 44 separate implementations to deliver workspace-home value to all archetypes.**

The kernel principle `Specialization Over Generalization` could be read as pulling toward 44 per-archetype implementations, but reads against the substrate resolver's explicit category-fallback design: the substrate IS asking the contribution layer to generalize where the operating model is shared and specialize where it diverges. Per-category contributions ARE the right specialization granularity for "operating model"; per-archetype contributions are over-specialization until evidence shows otherwise.

## 5. Existing-BI inventory

### 5.1 Per-archetype "workspace-home research/design" BIs (37 filed)

Each is `effortSize: "small"`, `triageOutcome: "build"`, `epic: EP-REDUCTION-GEAR-ARCH`, no plan or spec doc yet. These are the **Tier 2 exact-override candidate BIs** — they exist as future-evidence buckets, not as a commitment to ship 37 separate homes.

| Category | Per-archetype BIs filed |
| --- | --- |
| `beauty-personal-care` | BI-3CC9384A (spa), BI-0D12DEB6 (nail), BI-BD1773FA (barber), BI-98813778 (hair), BI-05C55B52 (personal-trainer) |
| `education-training` | BI-572BDBE4 (corporate-training), BI-84F46F0D (driving-school), BI-AE977E94 (music-school), BI-F30DF062 (tutoring) |
| `fitness-recreation` | BI-547E39F8 (dance-studio), BI-30704992 (yoga-studio), BI-4B0F6455 (gym) |
| `food-hospitality` | BI-180EAAD8 (bakery), BI-6017DF76 (catering), BI-4C7FA801 (restaurant) |
| `healthcare-wellness` | BI-3C6037CD (counselling), BI-91886EB8 (dental-practice), BI-3244D9B0 (optician), BI-137A513E (physiotherapy), BI-7E07A94B (veterinary-clinic) |
| `hoa-property-management` | BI-099F3296 (condo-association), BI-C0B632D5 (HOA), BI-5669629A (property-mgmt-co) |
| `nonprofit-community` | BI-391A5557 (animal-shelter), BI-A94BC7A2 (charity), BI-2271E940 (community-shelter), BI-D66B5585 (pet-rescue), BI-C3C3CFA9 (sports-club) |
| `pet-services` | BI-40F16F19 (dog-walking), BI-67DF65E7 (pet-boarding), BI-83E500FB (pet-grooming) |
| `professional-services` | BI-F15D5BAE (accounting), BI-B4907969 (consulting), BI-FE002675 (it-managed-services / MSP — sized medium, slightly different shape), BI-84FD0420 (legal-services), BI-7AB7C2D8 (marketing-agency) |
| `retail-goods` | BI-48600D03 (artisan-goods), BI-0745D356 (florist), BI-E0D7B790 (retail-goods) |
| `trades-maintenance` | BI-74A87B91 (cleaning), BI-36BC9F15 (electrician), BI-BC882DAC (facilities-maintenance), BI-E2D576A8 (landscaping), BI-DB764C3E (plumber) + the in-flight **BI-CE6AF925 HVAC dispatcher** (the proving install, sized large) |
| `software-platform` | BI-62BF330F (software-platform research/design) + BI-02845133 (operator workspace home — feature, medium, see §5.2) |

### 5.2 Category-level "workspace home" BIs (4 filed)

These are `effortSize: "medium"`, `workType: "feature"` — sized for category-level implementation:

| BI | Title |
| --- | --- |
| BI-EF03E915 | Nonprofit and community program workspace home — programs, volunteers, cases, donations, and outreach |
| BI-43A682A2 | Pet and animal care workspace home — appointments, animals, carers, boarding, and rescue cases |
| BI-96A3C7A9 | Property, HOA, and community operations workspace home — requests, violations, vendors, and board work |
| BI-02845133 | Software platform operator workspace home — releases, customers, incidents, and roadmap execution |

### 5.3 Gap — 7 categories without a consolidating BI

The remaining 7 categories need a category-level consolidating BI before per-archetype Tier 2 work makes sense:

| Category | Proving install candidate | Consolidating BI status |
| --- | --- | --- |
| `trades-maintenance` | Dale HVAC (BI-CE6AF925, in-flight) | **NEEDED** — proving install is exact-override; the category needs a fallback contribution for the other 4 trade archetypes |
| `healthcare-wellness` | dental-practice (BI-91886EB8) | **NEEDED** |
| `beauty-personal-care` | hair-salon (BI-98813778) | **NEEDED** |
| `education-training` | tutoring (BI-F30DF062) or music-school (BI-AE977E94) | **NEEDED** |
| `food-hospitality` | restaurant (BI-4C7FA801) | **NEEDED** |
| `retail-goods` | retail-goods (BI-E0D7B790) | **NEEDED** |
| `fitness-recreation` | gym (BI-4B0F6455) or yoga-studio (BI-30704992) | **NEEDED** |

Proving install picks are an architect default — they're the highest-evidence archetype within each category based on operating-model representativeness. The design pass on each consolidating BI can override the default.

The `pet-services` category appears to fold under BI-43A682A2 (pet and animal care workspace home), which spans both `pet-services` (3 archetypes) AND parts of `nonprofit-community` (pet-rescue, animal-shelter); this cross-category bundle is intentional per its BI body.

The `professional-services` category has BI-FE002675 (MSP, sized medium) which acts as an exact-archetype-AND-research BI but doesn't consolidate the other 4 professional-services archetypes (accounting, consulting, legal, marketing-agency). **A consolidating professional-services category-level BI is also needed** — but a thinner one, since the 4 non-MSP archetypes share less operating-model commonality (case-board for legal/accounting; work-queue for marketing/consulting). Could split: legal-and-accounting category-fallback + marketing-and-consulting category-fallback. Architect to decide.

## 6. Per-category contribution sketches

Each sketch lists the **default category-fallback contribution shape** — what every archetype in the category gets if no exact-archetype override is registered. Drawn from the primitive registry spec §6 applicability tables + the parent spec §5.6 wireframe shapes.

The sketches are intentionally lean: each is the seed of a category-level implementation BI's design doc. They do NOT fully replace per-category design specs; they give every category-level BI a known starting shape so the design-pass starts at the same architecture point.

### 6.1 `trades-maintenance` — proving install: Dale HVAC

- **Primary operating question:** "What's on the board today?"
- **Slot covenant + zone:**
  - today-now (`primary` zone) — capacity-lanes + today-schedule (technician roster, current/next job)
  - exceptions-needs-review (`critical-strip` zone) — decision-queue (unassigned + emergency + parts-blocked + unconfirmed jobs)
  - coworker-handoffs (`briefing` zone) — handoff-queue (PAR + Governor `require-hitl`)
- **Enrichment:** geo-map (customer/route), inventory-watch (truck stock), communication-exceptions (ETA texts).
- **Required canonical data:** WorkItem (sourceType = field-service-job), CalendarEvent, CustomerConfigurationItem, CommunicationDeliveryAttempt, WorkSchedule.
- **Required signals:** Governor require-hitl, Calibrator trust degrade, communication failed.
- **Vocabulary:** Job / service call / technician / customer / site / unit / customer update / dispatcher handoff.
- **Per-archetype override candidates:** cleaning-service (route-density focus, no parts), electrician (permits + safety), facilities-maintenance (multi-property asset health → adds health-board), landscaping (weather risk), plumber (emergency-service ratio higher).

### 6.2 `healthcare-wellness` — proving install: dental-practice

- **Primary operating question:** "Who's coming in today, what do they need before they arrive, what's open in the room schedule?"
- **Slot covenant + zone:**
  - today-now (`primary`) — appointment-schedule (today's bookings, room/chair assignment) + capacity-lanes (provider availability)
  - exceptions-needs-review (`critical-strip`) — decision-queue (missing forms, lab-result wait, late confirmations, no-show risk)
  - coworker-handoffs (`briefing`) — handoff-queue (front-desk-to-clinician escalations)
- **Enrichment:** case-board (longer-running patient cases — for physiotherapy / counselling); communication-exceptions (reminder text failures).
- **Vocabulary:** Appointment / patient / provider / room / chart / clinical note / front-desk handoff.
- **Per-archetype overrides:** counselling (risk-sensitive handoff styling, BI-3C6037CD); optician (lab-status + retail-replenishment inventory-watch, BI-3244D9B0); physiotherapy (treatment progress over multi-visit cases, BI-137A513E); veterinary-clinic (multi-species + boarding overlap with pet-services, BI-7E07A94B).

### 6.3 `beauty-personal-care` — proving install: hair-salon

- **Primary operating question:** "Who's in the chair next, what supplies are running low?"
- **Slot covenant + zone:**
  - today-now (`primary`) — appointment-schedule (booking grid, stylist/chair assignment)
  - exceptions-needs-review (`critical-strip`) — decision-queue (walk-in waitlist, late arrivals, missing intake)
  - coworker-handoffs (`briefing`) — handoff-queue (front-desk to stylist)
- **Enrichment:** capacity-lanes (stylist load by hour), inventory-watch (color, supplies), communication-exceptions (rebooking reminders).
- **Vocabulary:** Booking / client / stylist / chair / service / rebooking.
- **Per-archetype overrides:** barber-shop (walk-in-first vs appointment-first ratio); beauty-spa (room-based instead of chair-based capacity); nail-salon (technician capacity + station-supplies); personal-trainer (single-practitioner case-board over capacity-lanes, BI-05C55B52).

### 6.4 `education-training` — proving install: tutoring

- **Primary operating question:** "Which learners are in today, who's behind, what's coming due?"
- **Slot covenant + zone:**
  - today-now (`primary`) — appointment-schedule (today's lessons/cohorts) + capacity-lanes (instructor load)
  - exceptions-needs-review (`critical-strip`) — case-board (learners falling behind, test prep gaps)
  - coworker-handoffs (`briefing`) — handoff-queue (parent communications, certification approvals)
- **Enrichment:** communication-exceptions (parent-reminder failures); service-period-board for recital/test windows (music-school, driving-school).
- **Vocabulary:** Lesson / learner / instructor / cohort / progress.
- **Per-archetype overrides:** corporate-training (cohort-scale + certification queue, BI-572BDBE4); driving-school (route-map + car capacity, BI-84F46F0D); music-school (recital service-period-board, BI-AE977E94); tutoring (single-learner case-board, BI-F30DF062).

### 6.5 `food-hospitality` — proving install: restaurant

- **Primary operating question:** "What's happening in this service period?"
- **Slot covenant + zone:**
  - today-now (`primary`) — service-period-board (current service window, prep status) + capacity-lanes (kitchen / front-of-house staffing)
  - exceptions-needs-review (`critical-strip`) — decision-queue (guest issues, allergen flags, table-wait)
  - coworker-handoffs (`briefing`) — handoff-queue (BOH-FOH escalations)
- **Enrichment:** inventory-watch (ingredients, allergens), communication-exceptions (reservation confirms).
- **Vocabulary:** Service / cover / guest / station / pass / table.
- **Per-archetype overrides:** bakery (bake schedule, BI-180EAAD8); catering (event pipeline + delivery, BI-6017DF76); restaurant (reservation + service-period focus, BI-4C7FA801).

### 6.6 `retail-goods` — proving install: retail-goods

- **Primary operating question:** "What's selling, what's out, what needs to ship?"
- **Slot covenant + zone:**
  - today-now (`primary`) — decision-queue (open orders, pickup-ready, returns)
  - exceptions-needs-review (`critical-strip`) — inventory-watch (stock-out + restock thresholds)
  - coworker-handoffs (`briefing`) — handoff-queue (clerk-to-manager approvals)
- **Enrichment:** communication-exceptions (order-status reminders), capacity-lanes (clerk availability for service desks).
- **Vocabulary:** Order / customer / SKU / restock / pickup / shipment.
- **Per-archetype overrides:** artisan-goods (production-queue + bespoke-order case-board, BI-48600D03); florist (delivery-route + perishables, BI-0745D356); retail-goods (general retail, BI-E0D7B790).

### 6.7 `fitness-recreation` — proving install: gym

- **Primary operating question:** "Who's coming in, what classes are at capacity, who's at retention risk?"
- **Slot covenant + zone:**
  - today-now (`primary`) — appointment-schedule (today's classes/sessions) + capacity-lanes (instructor coverage, room capacity)
  - exceptions-needs-review (`critical-strip`) — decision-queue (waitlist, instructor sub needed, retention-risk members)
  - coworker-handoffs (`briefing`) — handoff-queue (front-desk to trainer)
- **Enrichment:** case-board (member retention cases), communication-exceptions (class-cancel notifications).
- **Vocabulary:** Class / member / instructor / session / retention.
- **Per-archetype overrides:** dance-studio (recital service-period-board, BI-547E39F8); gym (membership churn + capacity peak focus, BI-4B0F6455); yoga-studio (instructor scheduling + member waitlist, BI-30704992).

### 6.8 `nonprofit-community` — proving install: charity (covered by BI-EF03E915 + BI-43A682A2 split)

- **Primary operating question:** "What programs are running, who needs help today, what's the donor/volunteer pipeline?"
- **Slot covenant + zone:**
  - today-now (`primary`) — case-board (active cases by program) + service-period-board (today's program windows)
  - exceptions-needs-review (`critical-strip`) — decision-queue (intake, urgent client needs)
  - coworker-handoffs (`briefing`) — handoff-queue (staff/volunteer routing)
- **Enrichment:** volunteer-program-board (shift sign-ups, hour tracking), communication-exceptions (donor outreach), capacity-lanes (staff coverage).
- **Vocabulary:** Program / client / volunteer / donor / case / shift / outreach.
- **Existing category-level BIs cover this:**
  - BI-EF03E915 → general nonprofit + community-program shape (charity, community-shelter, sports-club)
  - BI-43A682A2 → animal-care subset (pet-rescue, animal-shelter) ALSO spans `pet-services` (dog-walking, pet-boarding, pet-grooming)

### 6.9 `pet-services` — covered by BI-43A682A2

- **Primary operating question:** "Whose animal is coming in today, who's boarding, who needs care?"
- **Slot composition** — uses appointment-schedule + case-board + capacity-lanes (carer availability) + inventory-watch (food, supplies); for dog-walking adds geo-map (route).
- **Per-archetype overrides:** dog-walking (geo-map prominence, BI-40F16F19); pet-boarding (occupancy + animal-care queue, BI-67DF65E7); pet-grooming (booking-prep + groomer capacity, BI-83E500FB).

### 6.10 `hoa-property-management` — covered by BI-96A3C7A9

- **Primary operating question:** "What's open for residents/owners, what's the board's queue, where are vendors?"
- **Slot composition** — case-board (resident requests, violations) + decision-queue (board approvals, vendor-scheduling decisions) + handoff-queue (board-staff escalation) + geo-map (unit/property map, BI-C0B632D5 / BI-5669629A) + communication-exceptions (owner notifications).
- **Per-archetype overrides:** condo-association (unit-level focus, BI-099F3296); HOA (resident + violations, BI-C0B632D5); property-management-company (lease + rent + tenant-request mix, BI-5669629A).

### 6.11 `professional-services` — needs a consolidating BI (or two)

- **Primary operating question** — varies by sub-shape:
  - **Knowledge work (legal, accounting):** "What matters / clients need attention today, what's coming due?" — case-board + decision-queue + communication-exceptions.
  - **Project work (consulting, marketing-agency):** "What deliverables ship this week, what's blocked, who's at capacity?" — case-board (engagements) + decision-queue (approvals) + capacity-lanes.
  - **Service work (IT-managed-services / MSP):** Covered separately by BI-FE002675 — health-board (customer estate health) + decision-queue (open tickets) + capacity-lanes (engineer load) + handoff-queue (SLA escalations) + communication-exceptions.
- **Recommended split:**
  - BI-FE002675 stays as MSP exact-archetype implementation.
  - File a new consolidating BI for `professional-services` minus MSP, covering accounting + consulting + legal + marketing-agency with case-board-led layout.

## 7. Sequencing

The contribution-shipping queue ordered by ROI (substrate coverage breadth × proving-install evidence quality):

| Order | Category | Proving install | Status |
| --- | --- | --- | --- |
| 1 | `trades-maintenance` | Dale HVAC | Plan in PR #1442 (in-flight) |
| 2 | `healthcare-wellness` | dental-practice | Needs consolidating BI + plan |
| 3 | `professional-services` (MSP slice) | it-managed-services | BI-FE002675 exists; needs plan |
| 4 | `beauty-personal-care` | hair-salon | Needs consolidating BI + plan |
| 5 | `food-hospitality` | restaurant | Needs consolidating BI + plan |
| 6 | `nonprofit-community` | charity | BI-EF03E915 exists; needs plan |
| 7 | `retail-goods` | retail-goods | Needs consolidating BI + plan |
| 8 | `fitness-recreation` | gym | Needs consolidating BI + plan |
| 9 | `pet-services` + animal-care cross-cat | pet-grooming / animal-shelter | BI-43A682A2 exists; needs plan |
| 10 | `education-training` | tutoring | Needs consolidating BI + plan |
| 11 | `hoa-property-management` | property-mgmt-co | BI-96A3C7A9 exists; needs plan |
| 12 | `professional-services` (knowledge-work slice) | legal-services or accounting | Needs consolidating BI + plan |

Ordering rationale: trades-maintenance ships first because Dale's HVAC plan is the in-flight proving install and the BI-1CCC6264 substrate ADR explicitly names HVAC as the validation surface. Healthcare and professional-services next because they cover high-archetype-count categories and exercise multiple primitive families end-to-end (appointment-schedule + capacity-lanes + case-board + handoff-queue). Categories with existing consolidating BIs (#6, #9, #11) move up if their architect-pass design lands earlier than the BI-less categories' new BIs can be filed. The order is advisory — design-pass evidence overrides.

## 8. Open questions

1. **Per-archetype BI lifecycle for the 37 already-filed small BIs.** Should they remain `open` as exact-override evidence buckets, or be `deferred` until the category-level proving install lands and per-archetype evidence accumulates? **Default: leave open as evidence buckets**; deferral introduces a "did I look at this?" gap when the evidence finally lands. Each per-archetype BI's eventual triage outcome can flip based on category-fallback adequacy.
2. **Cross-category bundle BIs (BI-43A682A2 spans pet-services + animal-care).** Should the substrate registry support contributions that match *multiple categories*, or should the bundle BI ship two separate contributions sharing components? **Default: two contributions, one per category** — the resolver matches by category, so a single contribution with `archetypeCategories: ["pet-services", "nonprofit-community"]` works today (substrate `WorkspaceHomeContribution.archetypeCategories` is `string[]`). Bundle BIs ship the same contribution literal registered against both category slugs. No substrate change needed; verify at impl time.
3. **`professional-services` split** — one consolidating BI, or two (knowledge-work + project-work)? **Default: two**, per §6.11. The operating models diverge enough that a single consolidating contribution would either (a) over-generalize and feel useless to both halves, or (b) be heavy with conditional rendering. The recommendation: ship BI-FE002675 (MSP) as a separate exact-archetype contribution + file two new consolidating BIs.
4. **`software-platform` worker home — register a contribution or stay on fallback?** BI-02845133 (operator workspace home) is filed and category-medium-feature. **Default: do NOT register a contribution for `software-platform`** — the platform itself is best served by the existing `PlatformWorkspaceHome` (which is exactly the platform-operator's day-to-day) plus the Cockpit diagnostic surface (BI-19D40BE7). BI-02845133's deliverables (releases, customers, incidents, roadmap) are platform-operator surfaces that belong in the Cockpit's drill-out layer, not in the worker-home registry. Architect to override if the evidence says otherwise.
5. **HVAC's category-fallback question** — Dale ships as `archetypeId: "hvac-contractor"` exact match. Does the trades-maintenance category-level contribution (when it lands) need to cover the other 4 archetypes (cleaning, electrician, facilities-maintenance, landscaping, plumber)? **Default: yes**, all 5 trade archetypes get the category-level fallback. The HVAC override only fires when `archetype = hvac-contractor`; the others get the generic trades-board.

## 9. Substrate behavior under the roster

With the roster delivered:

- **Install-time** (`/storefront/setup` archetype selection): the activation summary projects `mode: "vertical", match: "exact"` for archetypes with overrides (Dale's `hvac-contractor`, MSP's `it-managed-services`); `mode: "vertical", match: "category"` for the other 39 archetypes (covered by category-fallback contributions); `mode: "unconfigured"` only for `software-platform` (intentional). The 11 category contributions provide 100% non-platform-archetype coverage.
- **Runtime archetype change**: same substrate behavior; resolver re-runs per page load. No substrate change required.
- **Per-archetype override deferral**: an archetype can opt into category-fallback for years; when evidence justifies the override, file (or pick up an already-filed) per-archetype BI, ship a contribution at the archetype level, and the resolver picks it on the next page load.

### 9.1 Cross-cutting orchestrator — BI-B14D6CF6

Resolver routing + activation-summary projection are automatic, but per the operator direction 2026-06-04:

> "These differences are installed / established when the archetypes are chosen. The portal configuration needs to follow the needs of these business archetypes with little effort." — Mark Bodman

…**install-time + runtime alignment of canonical data, signals, setup tasks, and empty-state behavior** with each contribution's `setupActivation` declarations is NOT yet implemented. The parent spec §5.5 promises that setup will "create setup tasks, seed safe demo records in test installs, or show honest empty states" from those declarations; no BI on main owns delivering that promise universally.

**[BI-B14D6CF6](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/issues?q=BI-B14D6CF6)** — *Archetype-driven workspace-home setup activation orchestrator* — is filed as the cross-cutting BI that closes this gap. It extends the existing `StorefrontArchetype.activationProfile` activation pipeline to honor `WorkspaceHomeContribution.setupActivation` for every contribution. One orchestrator. Consumed by every BI in this roster.

Universal, not per-archetype: every category-level + exact-archetype contribution gets archetype-driven setup-task generation, signal binding, empty-state coordination, and (on test installs only, gated by `DPF_SEED_DEMO_DATA=true`) declaration-derived demo-data seeding through the same code path. No per-BI orchestration code.

Continuous tracking, not one-shot: activation runs at archetype selection, at archetype change, AND on a reconciliation cadence so the install's state stays aligned with the contribution's declarations over time. Drift surfaces as setup tasks the admin can act on.

**Sequencing implication**: BI-B14D6CF6 is a hard dependency for "little-effort" archetype-driven install configuration. Every category-level BI in §7 implicitly consumes it. Once BI-B14D6CF6 ships, each consolidating BI's implementation simplifies — the orchestrator owns the setup-activation mechanics; the per-category BI ships the contribution literal + per-category vocabulary + slot composition only.

**Dale HVAC plan (PR #1442) Phase 9 simplifies**: the orchestrator owns auto-seed; the plan's per-BI fixture file disappears. The same simplification applies to every other consolidating BI.

## 10. Standing rules audit

- **Mirror, don't migrate.** Pure roster doc. No code, no schema, no migration.
- **Schema honesty.** The roster maps existing BIs by their semantic ids and category slugs. No invented BIs; no invented categories.
- **Verify substrate before proposing new.** Every BI cited was verified via `mcp__dpf__list_backlog_items` 2026-06-04. Every category slug verified against `industries.ts`. Archetype counts verified against the live `StorefrontArchetype` table.
- **Make silent failures observable.** The roster identifies the gap (7 categories without a consolidating BI) so it surfaces as a tracked governance item, not as a silent omission when implementation starts.
- **Consult specs first.** Anchors to parent substrate spec §5.3, primitive registry spec §6, projection spec; uses architect amendments (`primaryOperatingQuestion`, `zone`) per PR #1438.
- **Specialization over generalization.** Per-category specialization, with per-archetype overrides as evidence justifies. Not all-archetype-flat (which would over-specialize 44 ways) and not single-platform-fallback (which would under-specialize). The substrate's `exact → category → unconfigured` resolver design IS this principle in code.

## 11. Definition of done

This doc is "done" when:

1. Operator review accepts (or rejects with revisions) the §4 coverage strategy (category-first vs per-archetype-first).
2. Operator review accepts (or rejects) the §5.3 list of 7 missing consolidating BIs and the proposed default proving installs.
3. Operator review accepts (or rejects with overrides) the §7 sequencing.
4. The §8 open questions are either decided here or punted explicitly to the design pass on each category's consolidating BI.

Once accepted, follow-on actions:

- File the 7 missing consolidating category-level BIs (or commission an agent to file them via `mcp__dpf__create_backlog_item`).
- File (or commission) the `professional-services` split (§6.11) — one consolidating non-MSP BI.
- Each category-level BI gets its own design-doc PR followed by an implementation plan, the same pattern HVAC and the projection service used.
- Dale HVAC's plan (PR #1442) implementation moves first in the queue once the primitive registry implementation (BI-5B8FE5C1 Phase 2+) and the projection service implementation (BI-3E8D2CF5) ship.

This roster does NOT implement any contribution. It is the bird's-eye view that lets per-category implementation plans land against a known landscape instead of being designed in isolation.
