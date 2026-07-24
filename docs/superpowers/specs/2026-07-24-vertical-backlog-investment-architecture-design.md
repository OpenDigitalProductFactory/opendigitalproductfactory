# Vertical Backlog Investment Architecture — shared spine, archetype config, and the connector surface

| Field | Value |
|-------|-------|
| **Date** | 2026-07-24 |
| **Status** | Draft for founder review — analysis, architecture direction, and backlog-optimization mechanism. No implementation. |
| **Author** | Claude (Opus 4.8) with founder direction (Mark Bodman) |
| **Scope** | Cross-cutting optimization of the vertical/archetype readiness backlog (`EP-VERTICAL-*`, ~215 BIs across 20 verticals). Identifies where the recurring work collapses onto shared architecture already in the platform, tiers the external-provider integration surface, and defines how to enrich the backlog so investment concentrates on shared engines, not 19× duplication. |
| **Kernel decision** | `DI-A80D7C589EEB` — shared-spine, config-driven (composite 17.51, margin 2.48, high confidence, no commandment conflict) |
| **Companion thread** | A separate thread is researching each archetype and filing the per-vertical gap BIs. **This document is the horizontal counterpart:** it does not add vertical gaps; it optimizes how the vertical gaps compose onto shared architecture. |
| **Primary inputs (verified live, 2026-07-24)** | Live backlog via `admin_query_db` (the ~215 `EP-VERTICAL-*` BIs and their bodies); `packages/storefront-templates/src/{types.ts,applicability-rules.ts,capability-activation.ts,activation-profile.ts,composition.ts}`; `EP-PLATFORM-SUBSTRATE-CONVERGENCE` (`BI-PSC-001..011`), `EP-FIELD-OPS-SUBSTRATE` (`BI-FIELDOPS-001..005`), `EP-ECOSYSTEM-ABSORPTION-ARCH` (`BI-ECO-001..007`); the incumbent-application coverage spec (2026-07-23) and its shipped D0. |

---

## 1. The question

The vertical readiness backlog is large and growing: ~215 open BIs across 20 industry verticals today, with more arriving as the companion archetype-research thread files each vertical's gaps. Read naively, each vertical looks like an independent build.

The founder's charge to this thread: **maximize the investment on shared vs unique features.** Concretely —

1. Find the architectures that can accommodate the shared or similar functionality across verticals, so a capability is built once and configured per archetype rather than rebuilt 19 times.
2. Recognize that the four *portfolios* share common solutions, while the *vertical* space is more nuanced and fragmented with bespoke incumbents.
3. Surface the external software/service providers named in the BIs — they enhance the replacement story per vertical and are shared data, not per-vertical trivia.
4. Enrich the current backlog with this context and steer the higher-priority, well-architected opportunities into specs and plans.

This document answers all four, and its central finding is that **most of the shared architecture already exists** — the optimization is composition and enrichment, not greenfield building.

---

## 2. Method

Every claim here is grounded in the live backlog and the current code substrate, queried 2026-07-24:

- Enumerated all `EP-VERTICAL-*` epics (20) and classified their ~215 BIs by title shape.
- Read the full body of all 19 `integration and replacement-boundary map` BIs to extract the named external providers and integration categories.
- Verified the shared substrate for each recurring shape in code and in prior specs before asserting it exists (per `verify-substrate-before-proposing-new`).
- Routed the core architecture choice through `principle_decide` (§5) rather than asserting it.

No new vertical gaps were invented. Where this document proposes work, it references existing epics and BIs.

---

## 3. Finding 1 — the vertical backlog is ~95% eleven repeating shapes

Classifying the ~215 BIs by title shape yields a near-perfect grid: **eleven recurring shapes, each appearing once per vertical**, plus a small genuinely-bespoke tail.

| # | Recurring shape | Instances | What it is |
|---|---|---|---|
| 1 | integration / replacement-boundary map | 19 | buy/build/integrate boundary vs named incumbents |
| 2 | employee-facing owner cockpit | 19 | the owner's home surface for the vertical's work |
| 3 | vertical request lifecycle | 19 | intake → work → completion → follow-up |
| 4 | finance / billing-readiness model | 19 | how money is captured for the vertical |
| 5 | resource / capacity model | 19 | people/assets/schedule the vertical commits |
| 6 | marketing proof / retention workflow | 19 | reactivation, renewal, proof |
| 7 | master-data context | 19 | the canonical entities of the vertical |
| 8 | proactive coworker actions | 19 | the work-around-the-work the coworker does |
| 9 | occupation homes / coworker roster | ~20 | role-specific coworkers for the vertical |
| 10 | keystone / readiness pack + acceptance | ~20 | the vertical's acceptance definition |
| 11 | top-10 gap fixture / market-proof pack | ~20 | the test corpus proving the vertical works |

That is **~210 templated BIs**. The genuinely bespoke remainder is small: Construction field operations (~8 BIs: crew/truck/equipment assignment, foreman log, jobsite time-clock, certified payroll, OSHA safety, subcontractor cockpit, cost-leakage detector), Warehousing (~2: ops cockpit, inbound→ship lifecycle), Food & hospitality (~2: no-show fee, booking-prefilled invoices).

**The implication is the entire thesis.** If these eleven shapes are built per-vertical, the platform builds the same eleven engines up to twenty times. If they are built once as archetype-parameterized engines and *configured* per vertical, each new vertical is mostly configuration plus its bespoke tail. The kernel (§5) scores the second path more than twice as high.

---

## 4. Finding 2 — the shared spine already largely exists

The critical discovery of this analysis: **DPF has already been building the shared spine.** The eleven shapes are not eleven greenfield engines to design — each maps to substrate that is built, in-flight, or specified. The risk the vertical backlog encodes is not "we lack the architecture"; it is "the 215 vertical BIs do not *reference* the architecture, so a builder could duplicate it."

| Shape | Existing shared substrate | State |
|---|---|---|
| owner cockpit (2) | Workspace-home primitive registry + vertical projections — specs `2026-05-24-workspace-home-primitive-registry`, `2026-05-24-vertical-workspace-home`, `2026-06-04-vertical-workspace-home-projections`, `2026-06-06-main-portal-workspace-home-redesign` | built / iterating |
| request lifecycle (3) | Work Case architecture (governed Actions, receipt envelope, coverage guard) | built |
| finance / billing (4) | `packages/finance-templates` + `ActivationProfile.billingReadinessMode`; `EP-COMPANY-OPS-PARITY` (Workday/QuickBooks roadmap) | built / iterating |
| resource / capacity (5) | `2026-07-17-organization-workforce-staffing-scheduling`; **`EP-FIELD-OPS-SUBSTRATE` `BI-FIELDOPS-001`** (expected-presence for people/assets/parties) | in-flight |
| marketing / retention (6) | Marketing Execution Loop (`2026-05-26`) + `apps/web/lib/tak/marketing-playbooks.ts` | built |
| master-data context (7) | `EP-MDM` — `2026-05-31-mdm-alignment`, `2026-07-04-mdm-write-time-dedup-and-lifecycle` | built / iterating |
| proactive coworker actions (8) | `EP-PROACTIVE-OPS` | in-flight |
| integration / boundary map (1) | **`EP-PLATFORM-SUBSTRATE-CONVERGENCE` `BI-PSC-002` (DONE): unified connector manifest + lifecycle kernel** (credential/auth/refresh/callback/health/audit/retry/sync); `EP-ECOSYSTEM-ABSORPTION-ARCH`; `BI-ECO-001` absorption posture matrix | **kernel done**, matrix open |
| occupation / coworker roster (9) | `EP-EMPLOYEE-OCCUPATION` + `2026-06-04-workspace-home-contribution-roster` | built / iterating |
| keystone / readiness (10) | `EP-ARCHETYPE-DEMO`; `2026-07-21-archetype-provisioning-playbook`; `2026-07-15-archetype-demo-factory` | in-flight |
| gap fixture / market-proof (11) | acceptance-test packs — folded into `BI-PSC-010`'s "acceptance tests" contract | specified |
| **the config contract binding all of them** | **`BI-PSC-010` (OPEN): typed archetype contribution registry** unifying finance/storefront templates, activation logic, seed contributions, navigation, **applicability rules**, and acceptance tests behind one narrow typed archetype contract; plus `applicability-rules.ts`, `ActivationProfile`, `OperatingModelAxes`, `capability-activation.ts`, `composition.ts` | **open — the keystone** |
| bespoke field-ops tail | **`EP-FIELD-OPS-SUBSTRATE` `BI-FIELDOPS-001..005`** — reusable expected-presence, credential/eligibility, daily-log/evidence, evidence-packet generator, ops-manager console, explicitly "composable across field-work archetypes" | in-flight |

Two facts change the shape of the whole program:

- **`BI-PSC-002` is done.** The provider-neutral connector kernel — the shared home for all 19 integration/boundary-map BIs — already exists. No vertical needs its own connector plumbing.
- **`BI-PSC-010` is the single keystone.** It is the typed archetype contract through which *every* vertical shape contributes (templates, activation, seeds, navigation, applicability, acceptance). It is open. Hardening it is the highest-leverage investment in the entire vertical program (§7), because it is what turns "build the shape" into "register the vertical's config for the shape."

Even the "bespoke" tail is mostly shared: Construction's eight field-ops BIs and Warehousing's two are consumers of `EP-FIELD-OPS-SUBSTRATE`'s five reusable engines. The truly-irreducible bespoke surface across twenty verticals is a handful of items.

---

## 5. Kernel decision — shared-spine, config-driven (`DI-A80D7C589EEB`)

The architecture choice was routed through `principle_decide` (population `external_coding_agent`, profile `mark-dpf-platform`, fully structured — zero semantic fallback):

| Option | Composite |
|---|---|
| **shared-spine, config-driven** — harden the shared spine + archetype-config contract once; redirect the vertical BIs to compose over it; ~12 bespoke items stay per-vertical | **17.51** ✅ |
| hybrid two-tier — shared spine for low-variance shapes, per-vertical bespoke for high-variance shapes | 15.03 |
| per-vertical slice — build each vertical end-to-end, accept up-to-19× duplication, refactor later | **7.48** ❌ |

Margin **2.48** against tieMargin 0.2, high confidence, **no commandment conflict**. The discriminating contributions between the winner and the per-vertical loser were *Architecture Over Shortcuts* (0.64 vs 0.08), *Optimize for the Whole* (0.63 vs 0.06), *Ground New Work in Existing Platform* (0.63 vs 0.06), *Single Source of Truth* (0.60 vs 0.05), and *Proper Fix Over Quick Fix* (0.46 vs −0.08) — precisely the axes that punish rebuilding an engine that already exists nineteen times.

**Hybrid is the ratified escape hatch.** At 15.03 it is a legitimate second. The binding reading: default to shared-spine composition, and drop a specific shape to per-vertical bespoke *only* when that shape's cross-vertical variance genuinely defeats parameterization (§6.4). That exception is earned per shape with evidence, not assumed.

> Reviewer reading note: the `reasoning` one-liner names top *absolute* contributors ("No Hardcoded Colors", "Research and Use Standards") — noise, near-equal across options. The signal is the per-option deltas above.

---

## 6. Finding 3 — the connector surface: ~100 named providers, tiered

The 19 integration/boundary-map BIs name roughly **100 distinct external providers** — the incumbents each vertical coexists with or displaces. These are not per-vertical trivia; they are shared, structured data with three uses:

1. **Seed data for `BI-ECO-001`** (the absorption posture matrix — classify each provider `native-now | adapter-bridge | generic-connector | provider-led | do-not-absorb`).
2. **Per-archetype prefill for the incumbent-application coverage lane** — specifically the onboarding step `BI-E4162824` (D5), whose spec already says the intake list is "prefilled from the archetype's replacement-boundary list." *That list is exactly these providers.* This is the connective tissue between this thread and the incumbent-coverage thread.
3. **The prioritized target list for connector work** on the `BI-PSC-002` kernel.

### 6.1 The integration categories tier cleanly

Grouping the named providers by the integration *category* they occupy (not by vendor) reveals the shared-vs-unique split the founder anticipated — portfolios share, verticals fragment:

**Tier 1 — shared connectors (recur across ≥5 verticals; build once, highest leverage):**
`payments` · `calendar / scheduling` · `messaging (SMS / email)` · `documents` · `accounting` · `CRM` · `inventory`.

**Tier 2 — semi-shared connectors (2–4 verticals):**
`POS / KDS` (food, retail) · `maps / routing` (automotive, moving) · `telematics` (asset-rental, moving) · `access control` (fitness, security) · `PSA / RMM` (MSP, professional).

**Tier 3 — vertical-bespoke connectors (1 vertical):**
`core-banking / LOS` (banking) · `LMS` (education) · `ticketing` (events) · `feature-flags / product-analytics` (software) · `permitting / 311` (public sector) · `donor-CRM specifics` (nonprofit).

Every tier flows through the *same* `BI-PSC-002` connector kernel; the tiers are a build-*order*, not separate architectures. Tier 1 is where shared investment concentrates; Tier 3 is where per-vertical connector cost is legitimately incurred.

### 6.2 The provider inventory (appendix, per vertical)

Asset-rental: Point of Rental, RentalMan, EZRentOut, Quipli, Rentle, StoragePug. Automotive: Shopmonkey, Tekmetric, AutoLeap, RepairShopr. Banking: Banno, Alkami, Backbase, Q2, nCino, Blend. Construction: Buildertrend, Procore, JobTread, CoConstruct, Houzz Pro. Education: TutorCruncher, Teachworks, Jackrabbit, Sawyer, Thinkific, Arlo. Events: Tripleseat, Event Temple, Planning Pod, Prism, Eventbrite, Momentus. Fitness: Mindbody, WellnessLiving, Glofox, PushPress, ClubReady. Food: Toast, Square Restaurants, OpenTable, Resy, CaterZen, Craftybase. HOA: AppFolio, Buildium, Enumerate, Condo Control, DoorLoop. MSP: ConnectWise, Autotask, HaloPSA, NinjaOne, Datto, N-able, Hudu, IT Glue. Media: StudioBinder, Frame.io, Yamdu, Celtx, Monday, ShotGrid. Moving: Onfleet, Routific, Samsara, Moverbase, Supermove, Shipday. Nonprofit: Bloomerang, Blackbaud, Givebutter, Little Green Light, EveryAction. Pet: Gingr, MoeGo, Time To Pet, Pawfinity, PetExec. Professional: Clio, Karbon, Teamwork, Accelo, HoneyBook, ConnectWise PSA. Public sector: Tyler Technologies, OpenGov, CivicPlus, Granicus, Accela, SeeClickFix. Retail: Shopify POS, Lightspeed, Square Retail, Cin7, Faire, ShipStation. Security: TrackTik, Silvertrac, Guardhouse, Simpro, SecurityTrax. Software: Productboard, Jira Product Discovery, Linear, Intercom, LaunchDarkly, PostHog.

This inventory should be captured as structured data feeding `BI-ECO-001`, not left in prose BI bodies (§8).

### 6.4 When to drop a shape to bespoke (the hybrid exception)

The kernel authorized hybrid as an exception. A shape earns per-vertical bespoke treatment only when its cross-vertical variance is irreducible. Applying that test to the eleven shapes: the *integration/boundary map* stays shared (one kernel, tiered connectors); *finance/billing* stays shared (activation modes already parameterize it); the *resource/capacity model* is the one shape with the most legitimate variance (a fitness class roster, a moving-truck route, and a construction crew-against-phase differ structurally) — and even there, `EP-FIELD-OPS-SUBSTRATE`'s expected-presence engine already absorbs most of it. Net: no shape currently justifies a full bespoke drop; the exception is documented so it can be *invoked with evidence*, not assumed.

---

## 7. Prioritization — the higher-leverage shared investments

Ranking the shared investments by leverage = recurrence (how many verticals) × current gap (how unbuilt) × downstream unlock (how much it enables):

1. **`BI-PSC-010` — typed archetype contribution registry (THE keystone).** Every one of the eleven shapes contributes through it. Until it is hardened, each vertical shape has no single typed door to register its config, so builders reinvent the wiring. Highest leverage in the entire vertical program. **Harden first.**
2. **Tier-1 connectors on the `BI-PSC-002` kernel** (payments, calendar, messaging, documents, accounting, CRM, inventory). Recur across nearly every vertical *and* feed the incumbent-coverage sales loop. Build-once, used-everywhere.
3. **`BI-ECO-001` absorption posture matrix, seeded from §6.2.** Turns the ~100 providers into the classification that drives both the boundary-map BIs and the incumbent-coverage prefill. Cheap (data + doctrine), high connective value.
4. **The owner-cockpit and request-lifecycle spines** (workspace-home primitive registry; Work Case). Every vertical's surface and workflow. Already built — the investment is *config-contract coverage*, not new engines.
5. **`EP-FIELD-OPS-SUBSTRATE` `BI-FIELDOPS-001..005`.** Unlocks the largest bespoke cluster (Construction) plus Moving, Security, Warehousing, Automotive field work — several verticals collapse onto these five engines.

Everything below this line is per-vertical *configuration* against the above, plus the small irreducible bespoke tail.

---

## 8. The backlog-optimization mechanism

The goal is not to rewrite 215 BIs. It is to make the composition **legible and enforced** so investment lands on the spine. Three moves, in increasing cost:

**Move A — enrich (this pass, low cost, high clarity).** Annotate each vertical BI with a *"composes over"* cross-reference to the shared spine it configures, plus (for boundary-map BIs) the tiered provider context from §6. This converts 215 apparently-independent builds into 215 legible configs-of-a-spine. Done via `update_backlog_item` on a representative high-value set now, with the pattern defined for the companion thread to apply as it files new verticals. **This is the "enrich the current backlog with additional context" deliverable.**

**Move B — reference the keystone (near-term).** Ensure `BI-PSC-010` (and the Tier-1 connector work) are sequenced *ahead* of broad vertical execution, and that vertical shape-BIs declare a dependency on the relevant spine. This is what prevents the 19× duplication the kernel warns against; it needs no new epic — `EP-PLATFORM-SUBSTRATE-CONVERGENCE` already owns the keystone.

**Move C — consolidate (optional, per shape, later).** For a shape whose 19 instances are pure config, the instances can be recast as one shared "spine-hardening + config-contract" enabler under `EP-PLATFORM-SUBSTRATE-CONVERGENCE` plus 19 thin per-vertical config items. This is a larger backlog surgery and should be done one shape at a time, only after Move B proves the spine covers that shape. Not proposed for immediate execution.

### 8.1 What this pass enriches

This pass applies Move A to the highest-value slice: the 19 integration/boundary-map BIs (the connector surface, tied to the incumbent-coverage lane) and the owner-cockpit + request-lifecycle BIs for a representative set of verticals, establishing the enrichment pattern. The companion thread inherits the pattern for the verticals it is still filing.

---

## 9. Non-goals

- **Not adding vertical gaps.** The companion thread owns per-vertical gap discovery; this thread optimizes composition.
- **Not a new epic or a new architecture.** The shared spine exists across `EP-PLATFORM-SUBSTRATE-CONVERGENCE`, `EP-FIELD-OPS-SUBSTRATE`, `EP-ECOSYSTEM-ABSORPTION-ARCH`, and the per-mechanism specs. This document is the map and the enrichment, per `single-source-of-truth`.
- **Not a mass rewrite of 215 BIs.** Move A enriches; Move C consolidation is deferred and per-shape.
- **Not auto-classifying providers.** `BI-ECO-001` classification stays governed; §6.2 is the seed list, not a verdict.

---

## 10. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | The companion thread files new vertical BIs faster than enrichment can annotate them, so the "independent build" reading persists. | Publish the *"composes over"* enrichment pattern (§8) so new BIs are born with the cross-reference; make the spine reference part of the vertical-BI template. |
| R2 | Over-abstraction: forcing a genuinely-variable shape (resource/capacity) into the shared spine produces a config surface more complex than a bespoke build. | §6.4 documents the earned-with-evidence hybrid exception; `EP-FIELD-OPS-SUBSTRATE` already absorbs most resource-model variance. |
| R3 | `BI-PSC-010` slips, and vertical execution proceeds without the keystone, duplicating wiring 19×. | §7 ranks `BI-PSC-010` first; §8 Move B sequences it ahead of broad vertical execution. |
| R4 | The provider inventory rots in prose BI bodies and is never structured. | §8.1 routes §6.2 into `BI-ECO-001` seed data + the incumbent-coverage prefill (`BI-E4162824`). |
| R5 | Consolidation (Move C) is attempted prematurely and churns the backlog before the spine is proven to cover a shape. | Move C is explicitly deferred, per-shape, and gated on Move B evidence. |

---

## 11. Open questions for founder review

1. **Sequencing authority.** Should `BI-PSC-010` + Tier-1 connectors be made a hard predecessor of *all* broad vertical execution (strongest anti-duplication), or only advisory (faster flagship-vertical demos, some duplication risk)? §7/§8 assume hard predecessor.
2. **Flagship vertical.** Which one vertical should be driven end-to-end first as the proof that the spine + config path works before the pattern is applied broadly? (MSP is the deepest substrate and the channel GTM; Fitness/Food are the simplest configs.)
3. **Consolidation appetite.** Is Move C (recast a shape's 19 BIs into 1 enabler + 19 configs) desired for any shape now, or should the backlog stay as-is-but-enriched until the spine is proven per shape?
4. **Provider data home.** Confirm `BI-ECO-001` as the canonical home for the §6.2 provider inventory, feeding both the boundary maps and the incumbent-coverage prefill.

---

## 12. Sign-off gate

This is analysis + direction + an enrichment mechanism. It requires no implementation to land. Before Move C (consolidation) or any change to `EP-PLATFORM-SUBSTRATE-CONVERGENCE` sequencing, the §11 questions should be answered. Move A (enrichment) and the kernel-ratified direction (§5) can proceed immediately, as they add context and legibility without changing scope.
