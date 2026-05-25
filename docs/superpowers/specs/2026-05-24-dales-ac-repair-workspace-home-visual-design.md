# Dale's AC Repair Workspace Home Visual Design

| Field | Value |
| ----- | ----- |
| Status | Reviewed by chief architect — accepted with edits |
| Date | 2026-05-24 |
| Backlog item | `BI-5656E9C3` |
| Persona | [Dale, owner of a 4-truck HVAC repair shop](../../personas/dale-hvac.md) |
| Archetype | `hvac-contractor` (category `trades-maintenance`) — **persona-validation visual for the first proving install of this archetype** |
| Substrate spec | [Vertical Workspace Home design](2026-05-24-vertical-workspace-home-design.md) — defines the resolver, contribution manifest, slot covenant, projection service, and verification protocol this spec depends on |
| Anchor spec | [Reduction Gear Architecture](2026-05-24-reduction-gear-architecture-design.md) §5.5 (audience layering), §5.6 (vertical workspace home) |
| Follow-on implementation | `BI-CE6AF925` (HVAC dispatcher workspace home — substrate spec §11.2 item 3) |
| Primitive library | `BI-5B8FE5C1` (vertical workspace primitive library from the substrate spec follow-on queue) |
| Mockup | [`docs/superpowers/mockups/2026-05-24-dales-ac-repair-workspace-home.html`](../mockups/2026-05-24-dales-ac-repair-workspace-home.html) |
| Scope | Visual paradigm validation for the HVAC dispatcher first viewport; persona/vocabulary anchoring; primitive→slot mapping |
| Out of scope | Implementation code; substrate changes; routing decisions; vocabulary catalog edits to `archetype-vocabulary.ts` (those land with the implementation BI) |

## Architect verdict

**Accepted as the first vertical-archetype visual anchor under `EP-REDUCTION-GEAR-ARCH`.** Dispatch day-board is the correct paradigm for HVAC — it matches the substrate spec's §6 wireframe, the persona vocabulary in [`dale-hvac.md`](../../personas/dale-hvac.md), and the ServiceTitan/Housecall Pro/Jobber dispatch-first conventions. The mockup uses DPF CSS tokens throughout (no hardcoded hex), and the six rendered panels map cleanly to the substrate's slot covenant.

**Corrections folded into this revision:**

1. **Substrate traceability** — explicit link to the vertical-workspace-home substrate spec; visual slots now mapped to the §5.5 **slot covenant** (today/now, exceptions, coworker-handoffs) with the rest scored as enrichment slots.
2. **Primitive→slot mapping table** added — implementer no longer has to guess which primitive from `BI-5B8FE5C1` powers which slot.
3. **Vocabulary discipline** — the "Avoided vocabulary" list is now the *single canonical reference* to the substrate spec §10 banned-copy list (not a parallel list that can drift). "Required vocabulary" is anchored to the persona doc, not re-stated here.
4. **Open design questions decided** — all three open questions have architect defaults so the implementer can proceed without a separate clarification round. The questions are preserved as alternates the design pass can override with evidence.
5. **Verification protocol added** — mockup-to-implementation acceptance criteria, mobile-collapse priority order, first-viewport density budget, accessibility floor, and D-defect alignment (which visible defects from the Dale dogfood this surface must not reintroduce).
6. **Sequencing constraint** — `BI-CE6AF925` cannot land until substrate `BI-1CCC6264` (resolver + registry) and `BI-3E8D2CF5` (projection service) ship. Spelled out in §Implementation Implications.
7. **Persona vs archetype** — clarified in the frontmatter: this is *persona-validation* for the *archetype*. Dale is the validating user; `hvac-contractor` is the routing key. Future HVAC installs reuse this contribution without inheriting Dale-specific naming.

**Not folded in (deferred to design pass):** the exact map widget (Mapbox vs. Leaflet vs. simple SVG bounding box) is a primitive-library decision under `BI-5B8FE5C1` and should not be pinned here. The visual paradigm only requires that a route-risk overlay exists; the rendering technology is the primitive library's call.

## Purpose

Dale's AC Repair should not land on a generic platform dashboard. The first screen should look like the working board of a four-truck HVAC shop: what needs dispatch, where the techs are, which customers need updates, what parts are missing, and which coworker suggestions are ready for Dale to approve.

This mockup is a browser-rendered approximation, not implementation code. It validates the visual paradigm before `BI-CE6AF925` builds the actual HVAC dispatcher home on the [vertical workspace home substrate](2026-05-24-vertical-workspace-home-design.md). It is also the **first vertical-archetype visual anchor** and a proof of reuse: clinic, retail, MSP, training, and other archetype visuals should match its structural discipline while rebinding the same primitive families to their own daily work.

## Visual Paradigm

The recommended pattern is a **dispatch day board**:

- Top summary strip: hot counts only, sized for scan speed. **Density budget: ≤6 metric chips, ≤1 line of text per chip.** No marketing hero, no oversized "Welcome back, Dale" greeting, no decorative gradients above the board.
- Left column: jobs that need a decision, especially unassigned, emergency, parts-blocked, and unconfirmed calls.
- Center: technician/truck lanes with current job, next job, load, and truck-stock hints.
- Right: customer/site map with route-risk callouts.
- Lower row: truck stock, failed customer updates, and coworker handoffs.

This intentionally puts queue, map, technician load, inventory, and communication exceptions above generic business metrics.

## Reusable Primitive Composition

The Dale screen should not create Dale-only widgets. It composes reusable primitives that can be relabeled and rebound for other archetypes:

| Dale tile | Primitive | Reuse examples |
| --------- | --------- | -------------- |
| Needs a decision | `decision-queue` | clinic missing forms, legal court deadlines, restaurant guest issues, MSP SLA risks |
| Trucks and techs | `capacity-lanes` | practitioner capacity, instructor/car capacity, barber chairs, volunteer shifts |
| Customer map | `geo-map` | dog-walking routes, property-management unit map, landscaping properties, MSP customer/site map |
| Truck stock | `inventory-watch` | retail low stock, bakery ingredients, salon supplies, optician frame/lens inventory |
| Customer updates | `communication-exceptions` | patient reminders, owner updates, donor outreach, client approval reminders |
| Coworker handoffs | `handoff-queue` | dispatcher approvals, clinic scheduler approvals, MSP escalation handoffs, campaign approval handoffs |

`BI-5B8FE5C1` should define these primitives as typed widget families with canonical data contracts, mobile behavior, empty states, action affordances, and banned-copy protection. Vertical BIs such as `BI-CE6AF925` should provide the contribution manifest, vocabulary, data binding, and layout composition.

**First-viewport budget.** On 1366×768 (the floor laptop resolution for SMB owner-operators), the summary strip, left queue column, and at least the first technician lane must fit above the fold without scrolling. The map, truck stock, customer updates, and coworker handoffs are below-fold acceptable. Mobile collapse order is specified in [Mobile Collapse Order](#mobile-collapse-order) below.

### Slot covenant mapping

Per the [substrate spec §5.5 slot covenant](2026-05-24-vertical-workspace-home-design.md#55-contribution-manifest), every vertical home MUST include three slots: today/now, exceptions/needs-review, and coworker-handoffs. The Dale visual maps as follows:

| Substrate slot (covenant) | Dale visual surface | Mockup panel |
| ------------------------- | ------------------- | ------------ |
| **today/now** (mandatory) | Technician schedule and load | "Technician schedule and load" |
| **exceptions / needs-review** (mandatory) | Jobs needing attention (unassigned + emergency + parts-blocked + unconfirmed) | "Jobs needing attention" |
| **coworker-handoffs / PAR** (mandatory) | Help waiting for Dale's go-ahead | "Coworker handoffs" |
| Enrichment | Customer & route map | "Customer and route map" |
| Enrichment | Truck stock + restock | "Truck stock and restock" |
| Enrichment | Failed customer updates | "Customer updates" |

Implementer note: the three covenant slots are non-removable. Enrichment slots may be reordered or omitted by future archetype variants (e.g., a city-center plumber install may not need the map), but the covenant trio is required by the substrate's type-level constraint.

### Primitive → slot mapping

`BI-5B8FE5C1` (vertical workspace primitive library) provides reusable display primitives. Dale's home composes them as:

| Slot | Primary primitive | Supporting primitives |
| ---- | ----------------- | --------------------- |
| Jobs needing attention | Queue | Exception chip, customer-update status |
| Technician schedule and load | Schedule/capacity lane | Load meter, current/next job card |
| Customer and route map | Map | Route-risk overlay |
| Truck stock and restock | Inventory/restock list | Low-stock badge |
| Customer updates | Communication exception list | Retry control |
| Coworker handoffs | Coworker handoff (PAR) list | Ack / reassign control |

If a required primitive does not exist in `BI-5B8FE5C1` at implementation time, the implementer files a primitive BI **and waits** — they do not invent an inline component that bypasses the primitive library. Primitive sprawl is what kills consistency across future archetype homes (clinic, retail, MSP).

## Research Anchors

- [ServiceTitan Dispatching Home](https://help.servicetitan.com/docs/dispatching) centers office staff on technician schedules, job appointments, dispatch boards, job trays, alerts, holds, and cancellations.
- [ServiceTitan Job Tray documentation](https://help.servicetitan.com/v1/docs/use-the-job-tray-on-the-new-daily-and-weekly-dispatch-board) treats unassigned appointments and alerts as high-attention tabs.
- [Housecall Pro Schedule documentation](https://help.housecallpro.com/en/articles/6367496-how-to-use-the-schedule-tab-calendar) emphasizes unscheduled jobs, dispatch/calendar views, employee availability, and map/calendar workflows.
- [Jobber routing documentation](https://help.getjobber.com/hc/en-us/articles/360033836293-How-to-Route) distinguishes master routes from daily map-based route adjustments.
- [OCA Field Service](https://github.com/OCA/field-service) shows field-service modules around orders, activities, agreements, calendar, equipment stock, recurring work, routes, skills, stock, timesheets, and vehicles.

## Implementation Implications

`BI-CE6AF925` should treat this as the target first viewport.

**Sequencing constraint.** `BI-CE6AF925` is downstream of the substrate spec's `BI-1CCC6264` (resolver + registry) and `BI-3E8D2CF5` (projection service). Per the [substrate spec §11.2](2026-05-24-vertical-workspace-home-design.md#112-follow-on-bis-filed-under-ep-reduction-gear-arch-from-this-spec-pass), HVAC dispatcher implementation cannot start Ideate until those substrate BIs ship. If the implementer reaches a phase gate and the substrate is not ready, the correct response is to escalate — not to inline a workaround that fragments the contribution registry.

**Business-archetype setup implication.** After setup selects `hvac-contractor` or the `trades-maintenance` fallback, the setup flow should show that the dispatcher home is included, list the primitive widgets being activated, and verify required setup data or honest empty states. Dale should not need to configure a dashboard after choosing the archetype.

**Required slots:** see the [slot covenant mapping table](#slot-covenant-mapping) — three covenant slots + three enrichment slots, six total.

**Required primitives from `BI-5B8FE5C1`:** see the [primitive → slot mapping table](#primitive--slot-mapping). If a required primitive is missing at implementation time, file a primitive BI and wait — do not inline-invent.

**Required vocabulary:** inherited from the [Dale persona vocabulary list](../../personas/dale-hvac.md#what-the-platform-needs-to-be-like-for-them). Do not re-state in this spec; persona is the single source of truth so future HVAC installs that override persona stay consistent.

**Avoided vocabulary:** the canonical banned-copy list lives in the [substrate spec §10](2026-05-24-vertical-workspace-home-design.md#10-verification-strategy-for-implementation). Do not maintain a parallel list here — it will drift. The substrate-spec list is enforced by vitest assertion at implementation time.

**D-defect alignment (Dale dogfood).** The Dale persona dogfood ([`dale-hvac.md`](../../personas/dale-hvac.md#dogfood-history)) surfaced visible defects the HVAC dispatcher home MUST NOT reintroduce:

- **D33 (`BI-62442F75`):** no tool names (`reviewDesignDoc`, `loadWorkspaceHomeSignals`, etc.) in any user-visible banner, slot title, or status chip.
- **D34 (`BI-EEC5A5ED`):** the dispatch board does not show stale build pointers; if a coworker handoff references a build, the link must resolve to the active build for *this* archetype install.
- **G1 / G2 / D14 / D33:** no FeatureBuild IDs, work-capsule slugs, git branch chips, schema field names, MCP tool names, or `BI-` codes leak into worker UI copy. They may appear in admin/diagnostic drawers only.

These D-defects are the bar for "doesn't feel like an engineer console" and are mandatory in the §Verification protocol.

### Mobile collapse order

Per substrate spec §5.5 `mobileCollapse` semantics, slot priority drives both desktop sort and mobile collapse order. Dale's order:

| Priority | Slot | Mobile (≤640px) |
| -------- | ---- | --------------- |
| 1 | Jobs needing attention (exceptions) | Visible |
| 2 | Technician schedule and load (today/now) — collapsed to a one-lane "current/next" card | Visible |
| 3 | Coworker handoffs (PAR) | Visible |
| 4 | Failed customer updates | Visible (compact list) |
| 5 | Truck stock and restock | Behind "More" |
| 6 | Customer & route map | Behind "Map" tab |

Mobile-first invariant: the three covenant slots are always above the fold on mobile. Enrichment slots can collapse, but workers must always see *what's broken*, *what's now*, and *what needs my ack* without scrolling.

### Accessibility floor

- Do not rely on color alone (anchor spec §5.4): every status chip carries icon + text + tone in addition to color. Restock = `low` badge + text, not just red.
- Keyboard navigation: dispatcher work is keyboard-heavy. Slots must be reachable in tab order; the queue (Jobs needing attention) must be the first interactive landmark after the topbar.
- Focus visible on every interactive control. No `:focus { outline: none }` without a replacement.
- All panels carry `aria-label` (mockup already does this — preserve in implementation).
- The map slot must remain functional with the map disabled — implementer cannot make critical state visible only through a map overlay.

## Verification

The [substrate spec §10 verification protocol](2026-05-24-vertical-workspace-home-design.md#10-verification-strategy-for-implementation) applies in full. **Visual-acceptance additions for this spec:**

- Render the implementation at `http://localhost:3000/workspace` on the live portal address from repo-root `AUTH_URL` / `APP_URL` (not Contributor preview, not `127.0.0.1`, not LAN IP) with the HVAC fixture seeded.
- Side-by-side compare against the mockup at [`docs/superpowers/mockups/2026-05-24-dales-ac-repair-workspace-home.html`](../mockups/2026-05-24-dales-ac-repair-workspace-home.html). Acceptance criteria:
  - Same six panels in the same grid topology.
  - Same density (≤6 metric chips, no marketing hero).
  - DPF CSS tokens only — confirm zero hardcoded hex/rgb values in the implementation diff.
  - Three covenant slots above the fold at 1366×768.
  - Mobile collapse order matches the table above at 375×667.
- **HVAC fixture (required, not optional):** seed 4 trucks, 4 technicians, 7 service calls (at least 1 unassigned, 1 parts-blocked, 1 unconfirmed, 1 emergency, 1 late), 1 failed customer notification, 1 Governor `require-hitl` handoff awaiting Dale's ack. The mockup's hand-crafted data is the canonical fixture shape; the implementation seed should reproduce it.
- Banned-copy assertion (substrate §10) runs against every rendered slot — fails on `cockpit`, `ring`, `torque`, `slip`, `wear`, `triple`, `shaft`, `calibration`, `contribution model`, plus the D-defect terms (`reviewDesignDoc`, `FeatureBuild`, `BI-`, `MCP`, raw git branch names).
- Dynamic-analysis report: drove the board, observed each slot rendering real fixture records, and recorded signed-off evidence per the platform QA plan — not a screenshot dump.

## Design Questions — architect defaults

The three originally-open questions are decided as defaults so implementation can proceed. The design pass may override any with evidence; absent evidence, ship the default.

1. **Technician lanes on tablet (≥768px, <1280px): default = horizontal scroll with sticky lane labels.** Collapsing to a prioritized list loses the "who's free in the next hour" scan that's the lane view's entire reason for existing. A four-truck shop fits comfortably horizontally; ten-truck shops will too with snap-points.
2. **Customer/site map on mobile: default = behind a "Map" tab after the hot queue.** Mobile dispatchers care about the queue and pending acks first; the map is decision support, not the decision surface. Always-visible map on mobile crowds the covenant slots.
3. **Truck-stock exceptions: default = surfaced first as a shared shop list (the "Truck stock and restock" panel), with per-truck stock badges inside each technician lane as secondary affordance.** A shared list catches restock-before-tomorrow patterns the dispatcher needs to act on; per-truck badges catch the in-the-moment "do we have the part" question. Both surfaces, with the shop list as the primary.

If the design pass produces a counter-recommendation, document the evidence and update this spec in the same PR that overrides the default.
