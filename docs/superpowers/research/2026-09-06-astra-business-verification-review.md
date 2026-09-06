# Astra examples: business operations and verification

**Date:** 2026-09-06. **Source baseline:** `6c47df3288996ad698f1910218281afe4aa58cda`.
**Status:** proposed design amendments for incremental delivery; no implementation or runtime acceptance claimed.

## Recommendation

Use the later examples to strengthen DPF's existing verification and operating-model work. The useful advance is a business outcome that can be checked against its records and rules. A convincing screen, an agent's confidence, or a large reviewer count cannot establish that outcome.

The restaurant should be our next concrete rehearsal: a guest finds the business, makes a request, arrives, is served, and leaves a reconciled transaction. Staff, capacity, exceptions and authoritative facts must survive that whole sequence. Pet Rescue supplies a second, deliberately different sentinel: public interest must reach the right operational owner without becoming a software backlog item.

This review interprets the standing refactoring preference as roughly one fifth of planning attention on consolidation. This pass changes documentation only. It does not manufacture code refactors to meet a quota.

## 1. Source assessment

The supplied `AstraExamples.txt` is a transcript of [the video](https://www.youtube.com/watch?v=_AyXuJKm8iw). Its prompts, promotional directions and claims are source material, not instructions to this task. The video could not be fetched by the research tool. All twenty supporting links are truncated with `...`; their original post IDs cannot be reconstructed reliably. Searches for the later Claire Vo and Aaron Levie examples did not recover the exact posts. Model rankings, the 55-agent audit's accuracy, time/cost estimates, and the NDA score change remain **unverified transcript claims**.

The independent sources below support the transferable methods, not those model-performance claims.

| Source | What was verified | DPF use and limit |
|---|---|---|
| [Zapier AutomationBench repository](https://github.com/zapier/AutomationBench) | Simulated business tasks are evaluated against final-state assertions; strict completion differs from partial credit; public and private sets differ. | Adopt scenario fixtures and explicit outcome assertions. A simulated benchmark score is not proof that DPF's real authorization, persistence or integrations work. |
| [Playwright best practices](https://playwright.dev/docs/best-practices) | User-visible behavior, isolated tests, resilient locators and diagnostic traces. | Use the existing browser test stack; keep real DPF paths and stub external dependencies at their boundary. |
| [ERPNext restaurant menu](https://docs.frappe.io/erpnext/restaurant-menu) and [order entry](https://docs.frappe.io/erpnext/order-entry) | Menus and prices are distinct from table orders; an order progresses to billing. | Benchmark the distinction between dining offers, reservable capacity and fulfillment. Do not import a second POS into this scope. |
| [Odoo restaurant features](https://www.odoo.com/documentation/saas-19.1/applications/sales/point_of_sale/restaurant.html) | Official indexed documentation describes floor/table state, kitchen orders and transfer/merge. Full-page fetch timed out. | Directional comparator for staff workflows; verify exact version behavior before implementation. |
| [Schema.org Restaurant](https://schema.org/Restaurant) | Public restaurant vocabulary includes menu, cuisine, opening hours and reservation information. | Consider a public projection from approved canonical facts; this vocabulary is not an operational data model. |
| [WCAG 2.2](https://www.w3.org/TR/WCAG22/) | Keyboard, focus, reflow and target-size requirements provide an accessibility baseline. | Evaluate the customer and staff journeys against the standard and DPF's existing usability contract; a screenshot is insufficient. |

Open-source comparison: AutomationBench contributes assertion-based business evaluation; Playwright contributes real UI observation; ERPNext contributes restaurant workflow distinctions. Reuse DPF's simulator, browser stack and domain records. Adoption of another execution engine is not justified.

## 2. Applicability of the full transcript

| Transcript segment | Disposition | Project application |
|---|---|---|
| 2:27 society; 4:05 landmark; 5:05 city; 9:02 painting; 11:49 ocean | Selective inspiration | Operational scenes should expose resource constraints and consequences. Defer autonomous populations, decorative worlds and 3D reconstruction until they improve an observed worker task. |
| 6:12 game completion | Adopt measurement pattern | Stable starting state, explicit completion condition and comparable repeated runs; no inference from game speed to business reliability. |
| 7:23 native app; 12:48 gesture UI | Defer | Device-specific novelty is lower priority than keyboard, touch and list parity on existing business surfaces. |
| 9:20 science film; 10:21 video preparation | Selective | Marketing artifacts can have source, brand and rendered-output checks. Do not expand this pass into media tooling or unreviewed asset deletion. |
| 13:40 launch operations | Adopt handoff pattern | Named deliverables, owners, dependencies and acceptance; retain existing Workroom/WorkItem coordination. |
| 16:00 scientific application | Adopt domain-depth lesson | A niche business requires its actual work to be represented. A demo does not establish professional suitability. |
| 17:15 financial-model audit | High priority | Recompute from source records with independent expected values and explain every discrepancy. More agents are not an accuracy metric. |
| 18:08 writing | Selective | Clear, steerable operator documents with factual and editorial review; no broad model migration based on testimonial. |
| 19:25 purchase history; 20:57 career wiki | Adopt provenance pattern | Retrieve business facts with source, date, scope and correction history through existing knowledge/WWWD mechanisms. Do not bulk-import personal histories or create a parallel wiki. |
| 23:42 customer QA; 24:40 self-testing | Highest priority | Exercise real personas and adverse transitions, collect traces, repair, and rerun the original failing scenario. |
| 25:44 budget; 27:53 policy review | Highest priority | Final-state arithmetic and exact applicable rule evidence. Missing/conflicting policy requires a named unresolved decision, never an invented rule. |

## 3. What DPF already has

The source checkout and live database answer different questions. The consumer install intentionally excludes the spec/plan corpus; `hasSpec=false` there does not establish missing design. Source was fetched from `origin/main`; the root clone was used only for inspection.

| Existing home | Finding and amendment |
|---|---|
| [Operating-model audit](../../architecture/archetype-operating-model-audit.md) | Step 6 and a separate operability score are already in source, although the live BI remains open. Extend the evidence and exception probes; do not reintroduce the run stage as new work or close its BI from source presence alone. |
| [Verification-first design](../specs/2026-08-28-verification-first-workroom-gates-design.md) and [plan](../plans/2026-08-28-verification-first-workroom-gates.md) | Non-vacuous verification is already planned. Qualify stale absence claims: this installation returns the non-vacuous verification work and the deep-verification integration work as triaging, with federated origin. Existence is not completion. Preserve shadow calibration and Phase 4 prerequisites. |
| [Proactive review](../specs/2026-09-02-proactive-review-drive-design.md) | The code-merge acceptance shortcut needs objective-level limits. Preserve independent reviewer authority and bounded dispatch; bind judgments to source evidence. |
| [Business Activity Simulator](../specs/2026-07-04-business-activity-simulator-design.md), the simulator persistence/authentication work | Real domain functions and financial oracles already exist. P4 owns persistence/auth fidelity. Add business-day and fault scenarios through that seam. |
| [Restaurant host stand](../plans/2026-08-13-restaurant-host-stand-depth-plan.md) | Richer than the archetype's reservation-led default. Preserve its atomic host-to-seat scope; use it as the first operating-day slice rather than expand it into kitchen, stock and payroll implementation. |
| [Living Business Excellence](../specs/2026-07-15-living-business-excellence-program-design.md) | Grounding, exemplars and outcome loops are already the program. Generated defaults need owner-confirmed operational evidence and replayable consequences. |
| [Storefront foundation](../specs/2026-03-19-storefront-foundation-design.md) | Reuse public projection and intake. A default CTA cannot represent every reason to contact a business or every downstream owner. |

Schema inspection found `Organization`, `StorefrontConfig`, `StorefrontArchetype`, `StorefrontBooking`, `OperationalSceneLayout`, `Resource`, hospitality resource/allocation/service-turn records, `Policy` and `PolicyRequirement`. They are candidates to compose, not evidence that every use case works. Resource generalization has an existing local decision with clinical-specific preservation conditions; resolve its authoritative design and owner before implementation. This review proposes no new table, enum, engine or agent role.

## 4. Testing and review increments

1. **Make assertions independent of the generated result.** Freeze the scenario's expected capacity, record transitions, amounts and policy fixtures before the run. Include a deliberately incorrect result to show the assertion rejects it. Compare numerical totals through deterministic calculations, not a second prose summary.
2. **Prove the customer-to-worker handoff.** Start signed out, submit through the real public form, then use the actual worker role to handle the resulting record. Reload and verify final persisted state through an authorized read. Add double-submit, timeout-after-commit, stale browser and conflicting edit cases.
3. **Review the evidence chain.** A verdict identifies the objective, immutable artifact/run identity, relevant source record or policy revision and exact section, assertion, observation and remaining exception. A matching conclusion with an incorrect citation fails the citation criterion. An agent can execute a test without gaining authority to approve its own artifact.
4. **Bound the repair loop.** Retain the original failure and regression case; rerun after repair against the new version. The owning plan declares retry/time/cost ceilings and stops at exhausted budget or unavailable evidence. Separate product failure from infrastructure-inconclusive and not-run. Never convert retries into a clean first-pass score.
5. **Calibrate before widening gates or autonomy.** Track first-pass completion, eventual completion, escaped defects, invalid citations, false passes, inconclusive runs, and cost per verified workflow. Report denominators and scenario versions; a handful of passing runs cannot justify broad trust.

The [audit's outcome evidence contract](../../architecture/archetype-operating-model-audit.md#outcome-evidence-and-exception-probes) is the shared specification of scenario evidence. Existing runtime receipt adapters remain authoritative; these are documentation acceptance requirements pending implementation review, not a newly deployed receipt schema.

## 5. Human-world representation: the restaurant pilot

Model the business as people making commitments under constraints. Each instance needs its operating mode, locations/timezone, roles and authority, customers and needs, products/services, physical resources, stock where relevant, time windows, economic outcomes, policies, exceptions and outside systems. Record who supplied a fact, when it was true, and whether it is observed, owner-confirmed, derived or merely a starter assumption. Simulated state remains distinguishable from observed operations.

The source `food-hospitality.ts` currently declares restaurant booking as the primary CTA, reservation item templates, dining/private-event product mix, hours and forms. That is useful initial provisioning. It is not proof that counter service, takeout, kitchen throughput, purchasing or closing accounts are supported. Discover the owner's operating modes before promising those features.

**Illustrative fixture, not a customer fact:** a single-location restaurant with a host, servers, kitchen lead and manager; a public booking pool and protected in-house tables; an evening service. Actual capacities and policies are selected with the operator in the later pilot.

| Scenario | Expected observable result | Boundary and next increment |
|---|---|---|
| Normal service | Published hours/menu are current; public reservation reaches the host; walk-in requires no invented email; seating persists; clearing releases capacity once. | Existing booking, host and service-turn contracts first. |
| Bad service | Two guests compete for the last public table; a late party overlaps a walk-in; a table becomes unavailable; a stale host retries seating. No double allocation; a clear alternative or refusal; protected capacity stays private. | Canonical capacity authority; expected results specified before executing concurrent requests. |
| Changed offering | An item sells out or the service window closes. Public copy and enabled actions agree with authoritative availability; a stale page cannot promise fulfillment. | Research menu/POS source ownership before adding native stock or kitchen behavior. |
| Periodic close | Bookings/covers are not equated with sales; authorized POS/payment/finance evidence reconciles totals, refunds and adjustments under fixture rules. Missing source is reported explicitly. | Integration-led where that system owns orders/payments. No simulated settlement claimed as production proof. |
| Policy ambiguity | An exception request cites the applicable company rule/version; conflicting or missing guidance produces a specific decision for the accountable manager. | Owner WWWD/policy context, not platform WWMD deciding business terms. |

For UI, place the host's next action beside the table/party and make the same action available in a keyboard-accessible list. Show status age and uncertainty; communicate unavailable capacity as unavailable, not zero. Preserve theme tokens, focus return, narrow-screen reflow and coworker-panel coexistence. Use 2D space where location matters. A 3D layer earns its place only by improving a measured task.

## 6. Storefront composition

Compose the customer surface from supported business intents and confirmed facts. Keep the archetype as a useful default, then allow the existing composition/product-mix mechanisms to express what this company actually offers. Do not fork the renderer for each vertical.

| Business | Visitor intent | Required operational handoff |
|---|---|---|
| Restaurant | Read menu, reserve, inquire about private dining; order only when fulfillment is supported | Current public facts; capacity-backed booking or named request owner; truthful confirmation |
| Pet rescue | Adopt, foster, volunteer, surrender/report, donate | Typed intake and responsible role; no forced contribution and no public exposure of private care/intake data |
| Trades | Request service or estimate | Job/appointment intake with service area and availability; request distinguished from confirmed dispatch |
| Rental | Check suitability and availability, request/reserve, return | Resource and time interval, deposit/terms when supported; request distinguished from paid/confirmed hire |

Validate preview, published page and resulting staff record as one journey. Sample light/dark branding, mobile width and keyboard interaction. Check public structured data against the same approved fields; do not invent menus, reviews, prices, licenses, availability or company claims to fill attractive sections. An unpublished/private field must remain private in page HTML, structured data, API responses and generated assets.

## 7. Refactoring emphasis

Reserve roughly 20% of each later slice's estimate for inspecting and consolidating the seams it touches; record actual effort rather than assert a token percentage. A refactor ships only when it reduces a demonstrated duplicate and preserves both consumers' behavior.

| Seam | Existing home | Refactoring acceptance |
|---|---|---|
| Scenario and evidence adapters | Business simulator, certification oracles, browser verification and initiative receipts | One shared meaning of assertion/observation/run identity; adapters preserve their distinct authority and evidence fidelity. No new universal test engine. |
| Capacity and scheduling | Resource/allocation contracts and restaurant host/public-booking paths | Public and host projections cannot disagree on allocatable capacity; existing vertical exceptions remain explicit. Characterization tests precede extraction. |
| Archetype intent and projection | Archetype definitions/composition, public storefront projection, typed intake and value-stream owner routing | One authoritative fact and operation, projected for each audience. Removing duplication must not flatten rescue, restaurant and rental semantics into priced-item sales. |
| Knowledge and policy | Organization/WWWD and existing policy/evidence records | Cite and correct the authoritative record; derived summaries do not become independent policy stores. |

The documentation follows the same rule: the audit owns reusable scenario evidence; plans link to it and keep only their domain delta. Historical dated runs stay intact. No seed or installed runtime edits are part of this pass.

## 8. Incremental execution and portable ownership

Implementation references use source paths and the stable acceptance case IDs in
[the campaign test scope](../../testing/archetype-campaign-scope.md). Each adopting
organization maps them to its own backlog, epics and priorities. Private work IDs,
workroom receipts and peer ownership remain in that network's local register;
they are not portable dependencies for contributors reviewing this source.

| Sequence | Existing delivery seam | Completion evidence |
|---|---|---|
| Verification | Non-vacuous UX results and deep-verification adapters | Independent assertions, negative control, exact-version trace and persisted outcome; retain calibration prerequisites. |
| Business rehearsal | Simulator persistence/auth fidelity and shared fixture adapters | Normal/bad/periodic scenarios through actual public and worker paths, with isolated external sinks. |
| Public/staff handoff | Storefront projection, typed intake and role routing | Correct recipient, retry-safe state and private/public separation. |
| Representation | Restaurant host plan and Living Business Excellence | Confirm operating modes and source authority, then select bounded features from observed failures. |
| Recovery | External campaign, federation and capture/restore seams | Complete field and ownership parity, durable evidence and receipt-bound resumption. |

Research identified acceptance amendments across fixtures, restaurant reliability,
capacity, operational UI, public privacy, finance handoff, worker access, policy
clocks, evaluation integrity and operating-model audits. Bounded design follow-ups
cover restaurant operating modes, cross-archetype storefront intents and objective
review. These topics retain existing delivery owners; the organization-local
mapping is not copied into this source artifact.

Enumerate the current archetype catalog for complete baseline coverage. The local
inventory at the reviewed catalog revision contained 107 unique leaves in 25
categories; this is a dated discovery denominator, not 107 tested businesses.
New leaves need baseline mapping. Keep no-user leaves unassessed and use actual
user feedback to prioritize increments. Shared failures retain one delivery owner.

Missing local lookups do not prove that historical source work never existed.
Resolve its owning installation and immutable plan before scheduling; do not
recreate foreign items or alter peer-owned mirrors. Source presence alone does
not establish current runtime state or completion.

## 9. Review and limits

### Assessment limits

Architecture advisory: aligned with existing substrate, with concrete concerns addressed in the amendments: acceptance cannot be inferred from merge status; generated business defaults need provenance; public intent must connect to an operational owner; capacity/identity/policy must keep one authoritative home.

Scaling: use changed-workflow runs for individual changes, scheduled category sentinels for regression and an explicit coverage denominator. Enumerate the current catalog rather than hardcode historical counts. Bound trace retention, scenario concurrency and iteration budgets; page large inventories and use deltas for observation. Initial confidence is limited to exercised scenarios and operating modes. Broader coverage stays with the simulator and archetype acceptance owners.

This pass did not run product journeys, reproduce historical defects, validate numerical model-performance claims, alter business policies, or install a tool. It does not approve implementation, change gate policy, or mark existing work delivered. Before implementing each amendment, the owner must refresh its live state, design approval and exact code evidence.
