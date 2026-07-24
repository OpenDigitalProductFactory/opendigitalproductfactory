# Incumbent Application Coverage — customer application inventory, displacement verdicts, and gap-to-backlog

| Field | Value |
|-------|-------|
| **Date** | 2026-07-23 |
| **Status** | Draft for founder sign-off — spec + backlog decomposition only, no build |
| **Epic** | **EP-ASSET-INTELLIGENCE** (no new epic — see §4) |
| **Parent spec** | [2026-07-17 Software Asset Management Phase C](2026-07-17-software-asset-management-phase-c-design.md) — this document is Phase C's **front end**, not a sibling initiative |
| **Predecessor specs** | [2026-07-16 Software & Asset Intelligence Enrichment](2026-07-16-software-asset-intelligence-enrichment-design.md) · [2026-06-21 Portfolio Coverage Multi-Source Projection](2026-06-21-portfolio-coverage-multisource-projection-design.md) · [2026-03-15 Employee Tool Intake](2026-03-15-employee-tool-intake-design.md) (spec'd, never built) |
| **Kernel decisions** | `DI-B4B65B293024` (scope shape) · `DI-5C75BC6ACAFC` (onboarding placement) · `DI-41949223919C` (justification artifact depth) |
| **Primary inputs (verified live, 2026-07-23)** | `packages/db/prisma/schema.prisma`, `packages/db/src/portfolio-sources/`, `apps/web/lib/actions/setup-constants.ts`, `apps/web/lib/shared/file-parsers.ts`, `packages/storefront-templates/src/capability-registry.ts`, live Postgres via `admin_query_db` |

---

## 1. Problem statement

A business evaluating DPF already runs its business on something — a scheduling tool, an accounting package, a CRM, a shared mailbox, a pile of spreadsheets. DPF has no way to learn what that is, no way to say what it covers, and therefore no way to tell an owner (or a reseller) what adopting DPF would actually replace.

Four consequences follow:

1. **Onboarding is blind.** The setup wizard never asks what the customer runs today, so the platform's first impression is "here is a new system" rather than "here is what this does instead of what you pay for."
2. **Cost is invisible.** The incumbent stack is the customer's actual software spend. DPF tracks its own AI spend precisely and the customer's incumbent spend not at all.
3. **The gap is unnamed.** Where DPF does *not* cover an incumbent, that is the single highest-signal input the backlog could receive — a real customer, paying real money, for a capability DPF lacks. Today that signal is lost.
4. **The platform cannot show its own worth.** The value case is assembled by hand in slides, disconnected from what the install actually does.

### 1.1 The self-justification loop is a first-class objective, not a by-product

The founder's framing for this capability is **software that sells itself**: a system that can state its own value from its own operating data, rather than requiring a human to assemble the case by hand in a deck.

That is not a marketing veneer over the inventory feature — it is the same mechanism read from the other end. Once the platform knows what a business runs, what that costs, and which of those jobs it already does, the value case is a *query*, not a document. And because DPF is open source with negligible running cost, the honest version of that query is usually favourable without any need to inflate it.

Two consequences bind the design:

- **The comparison must be a live view, not a generated artifact** (§4.3, §5.7). An exported deck drifts from the install the moment it is saved; a rendered view cannot.
- **Every number must be a fact the platform already holds.** Actual incumbent spend qualifies. Projected savings do not (§7). A self-selling system that overstates is a liability, not an asset — the credibility of the mechanism *is* the mechanism.

The reseller case is the same surface with a different reader, which is why §4.3 does not build a second one.

### 1.2 What this is not

This is **not** SAM. Phase C answers *"what do you own versus what do you consume"* — an entitlement and compliance question. This document answers *"what do you run versus what could DPF replace"* — a coverage and displacement question. They are different questions over **the same identity spine**, which is exactly why this belongs inside Phase C rather than beside it (§4).

---

## 2. Substrate verification — what already exists

The DPF-first audit found that **both halves of this capability are already built and have never been joined.**

### 2.1 The "what they run" half — built

| Substrate | State (live, 2026-07-23) |
|---|---|
| `InventoryEntity` | 546 rows (543 of them in Foundational). Carries manufacturer, observed/normalized version, support status, update posture, `catalogIdentityId`, and `customerAccountId`/`customerSiteId` scoping. |
| `CatalogIdentity` | 180 rows. The normalized software-identity spine, with CPE crosswalk, lifecycle milestones, and `IdentityResolutionLog`. Phase C's designated licensable-identity anchor. |
| `DigitalProduct` | 306 rows. Carries `coverageStatus`, `sourceKind`, portfolio and taxonomy placement. |
| Portfolio projection | `packages/db/src/portfolio-sources/` — a `PortfolioSourceProjector` contract, **six** live projectors, a closed coverage axis, and a CI parity guard (`portfolio-projection-parity.test.ts`, BI-PORTCOV-P7). |
| Spreadsheet / document intake | `apps/web/lib/shared/file-parsers.ts` — `parseCsv`, `parseXlsx`, `parseDocx`, `parsePdf`, `parseFileContent`. Plus `apps/web/lib/workbooks/sheet-import.ts` for header inference and type coercion. |
| Vendor cost + payment | `Supplier` (17 rows), `SupplierContract` (14), `PurchaseOrder`, `Bill`, and the finance routes `suppliers` / `bills` / `payments` / `payment-runs` / `recurring` / `spend`. |

### 2.2 The "what DPF does" half — built

| Substrate | State |
|---|---|
| `CAPABILITY_REGISTRY` | `packages/storefront-templates/src/capability-registry.ts` — typed capability keys with portfolio role, IT4IT stage, surfaces, and optional `setupPrompt`. |
| `PlatformCapability` | 264 rows. |
| `BusinessCapability` | 28 rows, with `BusinessCapabilityTraceLink` already able to link a capability to a `digitalProductId` **and** a `backlogItemId`. |
| `TaxonomyNode` | 491 rows across the four portfolio roots, including `for_employees/.../vendor_management`. |
| `OrganizationCapabilityActivation` | Built, 0 rows. Records per-org `enabled`/`disabled` with `decidedVia: setup-wizard \| admin`. |

### 2.3 The gap — precisely three things

**(a) No incumbent provenance.** The coverage axis at [`packages/db/src/portfolio-sources/types.ts:20`](../../../packages/db/src/portfolio-sources/types.ts) is a **closed** enum:

```
used · sold · available · potential · planned · retired
```

None of these means *"the customer pays for this today and we intend to displace it."* `used` is wrong (it means the org uses it as part of its own stack), and `potential` is wrong (it means DPF could enable it). `PORTFOLIO_SOURCE_KINDS` likewise has no `incumbent_intake`.

**(b) No coverage-verdict join.** Nothing maps an incumbent application to a DPF capability with a verdict, a confidence, and evidence. This is the one genuinely new object in this design.

**(c) The Workforce portfolio is inward-facing.** Live counts:

| Portfolio | DigitalProducts | InventoryEntities |
|---|---|---|
| `for_employees` ("Workforce") | **149** | **1** |
| `foundational` | 142 | 543 |
| `manufacturing_and_delivery` | 13 | 0 |
| `products_and_services_sold` | 1 | 0 |

Of the 149 Workforce products, **108 have `sourceKind = coworker_service`** — they are DPF's own AI coworkers. The portfolio that Mark identified as the home for the customer's employee tooling currently contains almost entirely *DPF's* employee tooling, and exactly one inventory entity. The customer's real stack has never had a door.

### 2.4 Work already filed — do not duplicate

Roughly **40 backlog items** already touch this territory. This design **joins** them; it must not re-file them.

| Lane | Items | Relationship to this design |
|---|---|---|
| **EP-ASSET-INTELLIGENCE** | 14 open (BI-E454034B, BI-55756F66, BI-30151E25, BI-A19FE7A2, BI-5E850F77, BI-08A34B18, BI-4891F663, BI-068EF11F, …) | Parent. Supplies identity, entitlement, cost, and discovered-SaaS intake. |
| **EP-ECOSYSTEM-ABSORPTION-ARCH** | **BI-ECO-001** (open, **priority 1**) — vendor absorption posture matrix across Workday, QuickBooks, Rippling, Gusto, ADP, BILL, Ramp/Brex, Stripe, Xero, Shopify/Square, HubSpot/Salesforce, Zendesk, Slack/M365, Asana/Jira, Notion, MSP/RMM | **This is the answer key.** Its `native-now / adapter-bridge / generic-connector / provider-led / do-not-absorb` classification is the seed rule table for the matcher. Also BI-ECO-002 (graduation gates), BI-ECO-003 (crosswalk registry). |
| **EP-VERTICAL-\*** | ~20 open *"integration and replacement-boundary map"* items, one per vertical | Per-archetype incumbent shortlists. They become seed fixtures for the intake step, not separate builds. |
| **EP-INTAKE-UNIFY** | BI-2BB06F90 (deferred) — shared backlog-ingest front door | The gap→backlog leg (§6 D4) should file through it if revived; otherwise through `create_backlog_item`. |

The 2026-03-15 Employee Tool Intake spec already designed the three intake modes Mark named (manual, spreadsheet, folder-sync) and **was never built** — `grep` for `ToolIntake` returns no source. Its Approach A (a staging model that links imports to `InventoryEntity` + `DigitalProduct`) remains sound and is adopted here.

---

## 3. Objectives

1. Capture what a customer runs today through three intake modes — **discovered**, **spreadsheet-imported**, **manually entered** — as first-class records in the Workforce portfolio.
2. Attach real cost to each, and let the existing AP rail pay it.
3. Produce a **coverage verdict** per incumbent application against DPF's own capabilities.
4. Convert every uncovered incumbent into a **backlog item**, deduplicated against work already filed, promotable into Build Studio.
5. Ask the question during onboarding, in a way a non-technical owner can answer.
6. Make the coverage story a **rendered view of live records**, usable by an owner or a reseller, that cannot drift from what the install actually does.

---

## 4. Kernel-steered decisions

Three decisions were routed through `principle_decide` (population `external_coding_agent`, profile `mark-dpf-platform`). All returned **high confidence, strong structured coverage, no commandment conflict**.

### 4.1 Scope shape — `DI-B4B65B293024`

| Option | Composite |
|---|---|
| **`fold-into-sam`** — build this as SAM Phase C's front end | **17.04** ✅ |
| `answer-key-first` — build BI-ECO-001's posture matrix first, then UX | 14.48 |
| `thin-keystone-epic` — a new thin epic building only the join, cross-linking without blocking | **13.55** ❌ |

Margin **2.56** against `tieMargin` 0.2.

**This inverted the authoring agent's pre-decided answer.** The agent had chosen `thin-keystone-epic` on speed-to-value reasoning; it scored *worst of the three*. The discriminating contributions were *Architecture Over Shortcuts* (0.63 vs 0.46), *Optimize for the Whole* (0.63 vs 0.41), *Ship Real Functionality* (0.77 vs 0.59) and *Proper Fix Over Quick Fix* (0.43 vs 0.30) — every one of them pulling against shipping a fast join ahead of the foundation it depends on.

The binding consequence: **no new epic.** This work is filed under EP-ASSET-INTELLIGENCE, sequenced against Phase C's lanes, and its cost/entitlement leg *waits* for Phase C rather than growing a private substitute.

> Reading note for reviewers: the `reasoning` one-liner returned by `principle_decide` names top **absolute** contributors ("No Hardcoded Colors", "Research and Use Standards"), which are noise here — they score similarly for every option. The signal is in the per-option **deltas** shown above.

**Stability re-check (`DI-55E6B9CF61A8`).** This decision was re-run after [#3482](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/3482) (`fix(kernel): drop retrieval hits whose WikiPage no longer exists`, BI-6ADB019D) merged to main, because the original ledger showed the duplicate zero-contribution retrieval hits that fix targets. Result: `fold-into-sam` 16.86, `answer-key-first` 14.36, `thin-keystone-epic` 13.42, margin 2.50 — **identical ranking, margin unchanged within noise.** The duplicate-hit pattern persisted in the re-run, confirming the live install has not yet taken #3482 (self-upgrade is operator-gated), so both runs scored against the same code. The recommendation does not depend on that fix.

### 4.2 Onboarding placement — `DI-5C75BC6ACAFC`

| Option | Composite |
|---|---|
| **`optional-wizard-step`** — a 12th `SETUP_STEP`, skippable and resumable, routed to a real portal route | **15.52** ✅ |
| `post-setup-lane` — a COO-driven first-week lane on `/workspace` | 11.57 |
| `coo-conversational` — no fixed stop; the COO elicits contextually | 7.34 |

Margin **3.95**. The conversational option scored *half* the winner: auditable completeness beat conversational naturalness decisively. This was scored as an interface-surface change per `remove-avoidable-failure-opportunities`, with `human_cognitive_load` and `operator_effort` as cost axes — the step still won while carrying the highest cognitive-load score of the three.

### 4.3 Justification artifact depth — `DI-41949223919C`

| Option | Composite |
|---|---|
| **`portfolio-rendered-view`** — the Workforce portfolio itself, filtered by coverage | **16.18** ✅ |
| `defer-artifact` — inventory and coverage only, no comparison output | 12.05 |
| `exportable-business-case` — a shareable report with projected savings | 10.46 |

Margin **4.13**. The exportable business case scored **lowest**, pulled down by evidence density and *Never Fabricate* (0.28 vs 0.56) — forward-looking savings claims are assertions the substrate cannot yet evidence. The coverage story ships as a **live view of real records**, not a generated document.

---

## 5. Design

### 5.1 Where an incumbent application lives

An incumbent application is a **`DigitalProduct` in the `for_employees` portfolio**, carrying:

- `coverageStatus = "incumbent"` — a **new value on the existing closed coverage axis**
- `sourceKind = "incumbent_intake"` — a **new value on the existing closed source-kind enum**
- `catalogIdentityId` — resolved through Phase A/B's existing identity pipeline, shared with Phase C
- an optional `InventoryEntity` when the app was discovered on the estate rather than declared

Both enums are closed and guarded by `portfolio-projection-parity.test.ts`; extending them is a deliberate, tested change, not an additive free-for-all.

**Why extend rather than add a parallel `IncumbentApplication` model.** Kernel doctrine (`schema-audit-before-features`, `single-source-of-truth`) and Phase C's own ratified direction (`extend-existing-spines`, composite 9.96 / margin 4.23) both point the same way. A parallel table would fork identity resolution, re-implement portfolio placement, and duplicate the cost linkage — for a record that is, definitionally, a digital product the business uses.

**The adjacency is the product.** Placing the customer's incumbent apps in the same portfolio as DPF's own 108 coworker services is deliberate: the Workforce portfolio becomes the comparison surface, where "what you pay for" sits beside "what DPF provides" over one taxonomy. `sourceKind` keeps the two legible and filterable, so the surface can always answer *"which of these am I paying for?"* without a second data model.

### 5.2 The coverage verdict — the one new model

```
IncumbentCoverageAssessment
  digitalProductId          → the incumbent (for_employees, coverageStatus=incumbent)
  catalogIdentityId?        → normalized identity (shared with Phase C)
  verdict                   → native_now | adapter_bridge | generic_connector
                            | provider_led | do_not_absorb | gap
  coveringCapabilityKey?    → CAPABILITY_REGISTRY key that covers it
  coveringBusinessCapabilityId?
  confidence                → 0..1
  assessedVia               → posture_matrix | rule | ai | human_confirmed
  evidence                  → Json (what was matched, and on what basis)
  backlogItemId?            → set when verdict = gap
  status                    → proposed | confirmed | superseded
  assessedAt / supersededAt
```

The verdict vocabulary is **BI-ECO-001's, unchanged**, plus `gap`. That is deliberate: BI-ECO-001 classifies DPF's posture toward a *vendor family* (the doctrine); this model records the *instantiated, evidenced verdict for one customer's one application*. The posture matrix supplies the default; the assessment carries the per-org truth, its confidence, and its evidence.

`assessedVia` makes the provenance honest and enforces the platform's evidence discipline: a `posture_matrix` default is a starting position, not a claim, and must be distinguishable from `human_confirmed`.

### 5.3 Cost and payment — no new substrate

An incumbent application's cost attaches through Phase C's entitlement family and the **existing** AP rail:

```
DigitalProduct(incumbent) → SoftwareEntitlement (Phase C, C1)
                          → Supplier → SupplierContract → Bill → payment-runs
```

DPF already has `suppliers`, `bills`, `payments`, `payment-runs`, `recurring`, and `spend` routes. **Paying an incumbent vendor requires no new payment substrate** — it is an existing AP flow against a `Supplier` the intake step creates or matches. This satisfies Mark's "pay for them if SaaS or Software costs are associated" without inventing a rail.

One real dependency: `SupplierContract` is today scoped to `AiProviderFinanceProfile` (noted in both the 2026-05-24 capability-lane audit and Phase C §3). Generalizing it is **Phase C's C1 work (BI-A19FE7A2)**, not this design's. Until C1 lands, cost capture on an incumbent is limited to a declared annual/monthly figure on the intake record, and the spec must not pretend otherwise.

### 5.4 Coverage matching

Matching runs as a pipeline, cheapest and most trustworthy first:

1. **Posture matrix (BI-ECO-001).** Exact match on vendor/product family → default verdict + covering capability. Deterministic, auditable, `assessedVia = posture_matrix`.
2. **Rule.** `CatalogIdentity` → taxonomy node → capability, using the existing taxonomy the portfolio already carries. `assessedVia = rule`.
3. **AI.** For unmatched entries, an assessment proposal with an evidence trail. `assessedVia = ai`, always `status = proposed`, never auto-confirmed.
4. **Human confirmation.** An operator or the Digital Product Estate Specialist coworker confirms or overrides. `assessedVia = human_confirmed`.

An entry that survives all four with no covering capability is a **`gap`**.

### 5.5 Gap → backlog → Build Studio

A `gap` verdict is a detection, not work. The leg is:

1. **Match against existing backlog first.** This is Mark's explicit requirement — *"identify existing backlog or new backlog items."* Search open BIs by capability and vendor family before filing. Given ~40 items already exist in this territory, filing blind would produce exactly the duplicate storm the platform has repeatedly suffered.
2. **On a hit** — link the assessment to the existing BI, and increment demand signal rather than creating a rival item.
3. **On a miss** — file one BI through the governed intake path, carrying the customer's incumbent, its cost, and the capability it implies.
4. **Prioritization** — the incumbent's cost and seat count are genuine `reach`/`businessValue` inputs to the existing demand-scoring fields on `BacklogItem`. A capability multiple customers pay real money for should outrank a speculative one, and the substrate already has the columns to say so.
5. **Promotion** — unchanged, via `promote_to_build_studio`.

### 5.6 Onboarding step (§4.2)

A 12th entry in `SETUP_STEPS` at [`apps/web/lib/actions/setup-constants.ts:6`](../../../apps/web/lib/actions/setup-constants.ts), placed after `business-context` (the archetype is known by then, so the per-vertical replacement-boundary lists can prefill the candidate set) and before `ai-providers`.

- Routes to a **real portal route** per the existing doctrine that every step but `account-bootstrap` tours the actual platform.
- **Skippable and resumable** — `StepStatus` already supports `skipped`, and `SetupContext.skippedSteps` already tracks it. No new progress machinery.
- Prefilled from the archetype's replacement-boundary list, so a restaurant owner sees a short list of plausible tools rather than an empty text box.
- Accepts all three intake modes; the spreadsheet path reuses `parseXlsx`/`parseCsv`.

The step must earn its surface. Its justification under `remove-avoidable-failure-opportunities` is that it is the **only** point where the platform can explain what it replaces, it is skippable, and it is prefilled — cognitive load is bought down by archetype-derived defaults rather than paid by the owner.

### 5.7 The coverage surface (§4.3)

The Workforce portfolio route, filtered by coverage and provenance. No new route, no new navigation layer, no export.

It answers, from live records: *how many applications you pay for, what they cost, how many are covered by DPF natively, how many need an adapter, how many are genuine gaps, and where each gap sits in the backlog.* Every number drills through to the record that produced it.

This is the reseller artifact and the self-justification artifact — the same surface, because the honest version of both is the same set of facts. It cannot drift from reality because there is no second rendering path.

---

## 6. Backlog decomposition

Filed under **EP-ASSET-INTELLIGENCE**. Sizes are indicative pending triage.

| ID | Item | Lane | Depends on | Size |
|---|---|---|---|---|
| **D0** | `BI-5B2F5447` | Coverage axis + source kind: add `incumbent` / `incumbent_intake` to the closed enums, extend the parity guard | none — **shippable before Phase C** | small |
| **D1** | **`BI-ECO-001`** | Absorption posture matrix as seed data — **already open at priority 1.** Do not re-file; this lane consumes it | none | (already filed) |
| **D2** | `BI-BF12C25C` | Incumbent intake: manual entry + spreadsheet import → `DigitalProduct` in `for_employees`, identity resolution, `Supplier` match/create. Adopts 2026-03-15 Approach A staging | D0 | large |
| **D3** | `BI-548060D5` | `IncumbentCoverageAssessment` model + the four-stage matching pipeline | D0, D1, D2 | large |
| **D4** | `BI-F4EE0E48` | Gap → backlog with **dedupe against existing BIs first**, demand-signal enrichment from cost/seats | D3 | medium |
| **D5** | `BI-E4162824` | Onboarding step 12 — skippable, archetype-prefilled | D2 | medium |
| **D6** | `BI-69B957E4` | Coverage surface on the Workforce portfolio route (UX-fit review required) | D3, D4 | medium |
| **D7** | `BI-DFC5C6B7` | Cost binding: incumbent → `SoftwareEntitlement` → `SupplierContract` → `Bill` | **Phase C C1 (BI-A19FE7A2)** | medium |
| **D8** | `BI-C4D4AC30` | Discovered-mode intake: SaaS discovery signals become incumbent candidates | **Phase C C6 (BI-08A34B18)** | medium |

**Sequencing note.** D0 is a genuine enabler with no Phase C dependency and should ship first regardless. D7 and D8 are the two lanes that *must* wait for Phase C — which is precisely the dependency the kernel weighted when it rejected the thin-keystone shape.

---

## 7. Non-goals

- **DPF does not become a SaaS spend-management product.** Inherited verbatim from the 2026-06-21 portfolio-coverage spec's non-goals. Incumbent inventory serves coverage and displacement, not vendor-management-as-a-product.
- **No projected-savings claims.** Ruled out by §4.3 and by `never-fabricate`. Actual incumbent spend is a fact and may be shown; "you will save $X" is a forecast the substrate cannot evidence.
- **No automatic data migration out of incumbent applications.** Displacement is a decision, not a background job.
- **No auto-confirmation of AI-proposed verdicts.** `status = proposed` until a human or an authorized coworker confirms.
- **No new epic, no new navigation layer, no new payment rail.**
- **No parallel incumbent-application table**, and no parallel finding table (Phase C §7, carried forward).

---

## 7.1 Risks

| # | Risk | Mitigation |
|---|---|---|
| **R1** | **Portfolio aggregates become incoherent.** Placing incumbents beside DPF's 108 coworker services means any rollup computed over `for_employees` *without* filtering on `sourceKind` silently mixes "software we pay a vendor for" with "AI coworkers DPF provides". A "Workforce spend" or "Workforce product count" tile would be nonsense. §5.1 argues the adjacency is the product — that holds for the **browsable surface**, but it does **not** hold for **aggregates**. | Every aggregate over `for_employees` must declare a provenance filter. D6 carries a counter-reconciliation test (precedent: the 2026-05-21 four-portfolio spec §12.2 counter-reconciliation gate). Treat an unfiltered rollup as a defect, not a display preference. |
| **R2** | **The gap detector manufactures duplicate backlog items.** D4 automates BI creation from a detector, against a backlog that already holds ~40 items in this territory. The platform has previously merged duplicate work to main. | Dedupe-before-file is a hard acceptance criterion with a required regression test (§8). Auto-file is also the subject of open question §9 Q2 — a review queue is the fallback if dedupe confidence proves low. |
| **R3** | **Coverage verdicts overstate what DPF does.** A `native_now` verdict from a posture-matrix default is doctrine, not evidence that *this customer's* use of *that tool* is genuinely covered. Overstating coverage in a surface used for sales is the most damaging possible failure of a self-justifying system (§1.1). | `assessedVia` makes provenance explicit and un-collapsible; AI verdicts are `proposed` only; the surface must visually distinguish a default from a confirmation. `native_now` should read as a claim awaiting confirmation until `human_confirmed`. |
| **R4** | **The onboarding step gets skipped universally**, leaving the whole lane inert. | The step is prefilled from archetype replacement-boundary lists so the cheapest path is confirmation rather than data entry. Skip rate is the metric that tells us whether the framing works; if it is high, the answer is better prefill, not a mandatory step. |
| **R5** | **Cost data is stale or wrong**, because it is a figure an owner typed once. | Declared cost is explicitly interim until D7 binds to `SoftwareEntitlement`/`SupplierContract` (§5.3). Until then it must be labelled as declared, not derived, wherever it is shown. |

## 8. Verification strategy

Per implementation BI, at minimum:

- Unit tests for enum extension + parity guard, identity resolution on intake, each matching stage, and the backlog dedupe path.
- Migration tests for the new model's invariants and delete behavior.
- Production build.
- UX verification on the onboarding step and the coverage surface, through the governed live-install path.
- Canonical-runtime evidence for the matching pipeline and the gap→backlog leg.

Fixtures should cover one incumbent per intake mode and at least one of each verdict, including a `gap` that dedupes onto an existing BI. Fixtures must avoid real customer identifiers.

**Explicit anti-regression:** a test asserting that a `gap` verdict for a capability with an existing open BI does **not** create a second BI. The duplicate-work failure mode is the platform's most repeated one, and this design deliberately points a detector at the backlog.

---

## 9. Open questions for founder review

1. **Does the incumbent stack belong in `for_employees` alone**, or should incumbent *customer-facing* systems (a booking site, a storefront) project into `products_and_services_sold` as well? §5.1 assumes Workforce only.
2. **Should a `gap` verdict on a paying customer's incumbent auto-file a BI**, or land in a review queue first? §5.5 assumes auto-file *after* dedupe, on the reasoning that a paying customer's unmet need is the highest-quality demand signal DPF can receive.
3. **How much cost detail is worth capturing at onboarding?** A single annual figure per app is answerable by an owner; per-seat/per-tier modelling is not, and properly belongs to Phase C's entitlement model.
4. **Does the reseller need anything the owner does not?** §4.3 assumes one surface serves both. If resellers need a shareable artifact, that reopens the `exportable-business-case` option the kernel scored lowest — and should be re-scored with the evidence discipline that made it lose.

---

## 10. Sign-off gate

Do not start implementation until:

- **Phase C is signed off** (its own §10 gate) — D7 and D8 depend on it directly, and the kernel's `fold-into-sam` decision makes Phase C this work's foundation rather than its neighbour.
- The §9 questions are answered or the stated defaults are explicitly approved.

**D0 is the exception** and may be triaged independently: it extends two closed enums with their guard, unblocks D2/D3, and has no Phase C dependency.

Defaults proposed for §9, should review prefer them: Q1 Workforce-only for the first pass. Q2 auto-file after dedupe. Q3 one annual figure per application. Q4 one surface for both audiences.
