---
status: active
---

# Portal UX Simplification Execution Plan

September outcome-framework revision: `BI-D09EE31E`, `WC-302E3E59`, branch
`doc/portal-ux-outcome-framework`. The closeout packet below merged in PR #5120
at `8d1057e0208fe55caf63c01738ad0961d5ea4d3f` on 2026-09-06. Its backlog
closeout remains separately owned; source merge is not served verification.

Use the [evaluation framework](../../architecture/portal-ux-evaluation-framework.md)
and [scorecard](../../testing/portal-ux-scorecard-template.md) for every slice.
They define the rubric, measurement protocol, workroom disclosure and standing
feature-fit gate. WWMD `DI-BED2443DAD54` ratifies reuse of existing page-purpose
and UX-budget contracts; this revision introduces no new runtime scoring system.

## Revised priority and PR boundaries

Phase numbers below remain stable scope identifiers. Execute by the priority
table, not numerical phase order. Live MCP on 2026-09-06 confirms the six visible
implementation BIs remain open; this is a recommended queue, not a claim that
their research/readiness gates have passed. Recheck ownership before claiming.

| Priority | Existing BI / slice | Accepted finding and smallest outcome | Dependency and evidence |
| --- | --- | --- | --- |
| P0 evidence | `BI-5A1A3C13`, phase 1 | Reconcile merged delegate source with served runtime | Sanctioned readiness/upgrade only; record CAN-TEST or exact blocker. Do not block documentation on this operational stream |
| P0 trust | `BI-36A2CF08`, phase 3 | Workspace transcript hides setup/prompt/provider internals and gives one recoverable failure state, tied to the relevant work | Reproduce current defect, then greeting + work request + unavailable provider/retry; verify launch preview/confirmation and receipt on existing action path |
| P0 truth | `BI-FFCE0D22`, phase 6 | Reconcile one grant/governance discrepancy through the existing read boundary and its immediate summary/detail surfaces | Prove equal scope/denominator/freshness before comparing counts; repair or explicit partial/stale warning before operator grouping |
| P1 daily work | `BI-971D6F22`, phase 2 | Workspace lets founder/operator find and act on the highest relevant exception, then return from its canonical room | Current baseline, trustworthy state and configured worker sentinel; first useful action visible, completion oracle and parent/child return pass |
| P1 discovery | `BI-1F0B4184`, phase 4 | Business labels lead to the expected existing home, preserving external/internal separation | Test headings, navigation, breadcrumbs and return paths together; no route migration or global feature promotion |
| P1 fresh install | `BI-CEB3FDF8`, phase 5 | Reuse report-kit empty/loading/failure treatment on Documents with matching Knowledge/Compliance instances only where the same contract applies | One next step per empty context; permission/provider state tests and valid CTA destination; no new setup model |
| P2 feature flow | `BI-D8E00326`, phase 7 | One accepted Customer marketing job from local entry through preview, existing coworker work and receipt | Fit gate and purpose contract before adding surface; a broad campaign/funnel/automation build requires decomposition into live BIs before implementation |

Each row is **one BI, one branch, one PR** for its bounded accepted outcome.
The broader BI body is an upper bound, not permission to grow a PR. If source
reproduction shows a row requires independently shippable outcomes, record the
decomposition, create/reuse successor BIs and obtain coverage before code. Do not
reuse the same BI for a train of unrelated PRs or leave residual accepted work
only in this table. No new implementation BIs are created by this framework pass.

Within each slice reserve roughly **20% of implementation effort for refactoring**:
Workspace converges duplicate launch/readiness projection; trust converges message
classification and failure presentation; AI removes duplicate grant/status joins;
Business converges label definitions; empty states remove copied panels; Customer
reuses existing launcher and receipt context. Verify exact files and duplication
in the source before committing to removal. Record planned/actual effort and the
removed pattern in the scorecard; unused allocation does not justify unrelated
cleanup. In this documentation pass, refactoring means consolidating measurement
rules in the framework and replacing competing first-view instructions with links.

### Workroom and cross-cutting findings

The first parent -> child -> evidence -> return audit is an acceptance task of
`BI-971D6F22`, not authorization to rewrite all Workroom screens. Existing
`/ops/workrooms` operational inventory and `/ea/workrooms` definitions have
different purpose contracts; retain them. Audit the canonical case detail reached
from a real permitted room. If it exposes an independent defect, query the live
backlog for overlap and file under its owning epic before accepting implementation.
Shared trust findings stay with `BI-36A2CF08`; source-truth findings stay with
`BI-FFCE0D22`. Unobserved workroom redesign hypotheses are **pending audit**, not
accepted build work with invented BI coverage.

Architecture and missing-route recovery remain sampling sentinels. Existing May
findings UX-09/UX-10 require current reproduction and owning-stream reconciliation;
do not silently bundle Build Studio or a platform-wide 404 rewrite into the empty
state PR. The framework itself is one atomic documentation outcome under
`BI-D09EE31E`: rubric + template + spine + queue must stay internally consistent.

## Route-audit sampling plan

Build the current denominator from the canonical route/audience and purpose
registries at the audited SHA. Reconcile the budget baseline's covered, excluded
and unmeasured routes; the September counts are not a new inventory. Select
representatives by job, density, state and risk, not whichever page looks worst.

| Family | Initial route/task sentinels | Primary persona and contrast | Required adverse state |
| --- | --- | --- | --- |
| Workspace | `/workspace` -> priority exception -> actual work object/case -> next action -> return | Founder/operator plus configured worker/volunteer | No work, blocked work, provider failure, permission-limited user |
| Business/Customer | `/customer`, existing customer detail and `/customer/marketing`; Business People/Storefront entries | Customer operator plus dispatcher or rescue director | Empty pipeline, unauthorized action, direct-link/return-state check |
| Platform AI | `/platform`, `/platform/ai/overview`, `/platform/ai/runtime-health`, relevant governance/provider detail | Platform operator plus denied ordinary worker | Contradictory or stale counts, unavailable provider, missing configuration |
| Workrooms | `/ops/workrooms` -> `/workspace/cases/[caseKey]`; one parent/child/evidence path; `/ea/workrooms` as definition-home contrast | Operator and participant with limited visibility | No live rooms, blocked child, stale room, restricted child/evidence |
| Documents/Knowledge/Compliance | `/workspace/documents`, `/wiki`, `/compliance` and one existing obligation/detail; `/ea` as empty-state regression sentinel | Document owner/compliance worker plus normal reader | Fresh install, loading, upload/connect failure, read-only permission |
| Storefront/Portal | `/storefront` internal management; `/s/[slug]` and `/portal` customer entry and one supported request/status flow | Internal operator and external customer/applicant | Unpublished/unconfigured, request failure, another customer's inaccessible data |
| Build Studio, separate | `/build` and the current owning build/work detail | Contributor | Null/unknown states, interrupted stream, missing runtime evidence |

For each of the six main families start with two task scorecards (primary and
adverse/recovery), yielding **12 initial task scorecards**, each at desktop and
narrow viewport. These are task samples, not 12 distinct URLs; one flow may cross
several routes. Add keyboard, zoom/reflow and permission checks to each affected
flow. Rotate a contrasting archetype through Workspace, Customer and Portal;
use rescue as one sentinel, not a universal business default. Mark unsupported
fixture paths pending rather than manufacturing work to fit the script.

Then expand every confirmed important failure to its shared primitive consumers,
one sibling route and its return/destination path. Audit every changed route in an
implementation PR, even if it was absent from the initial sample. Stop expansion
when the shared defect boundary is explained and each affected route has an owner;
do not infer estate-wide quality from the initial sample. Publish
tested/failed/unmeasured/excluded counts by family and reason. Exclusions do not
count as passes. Refresh after shared navigation/component changes and before
slice acceptance; rotate untouched families during the next planned audit.

Build Studio has its own scorecards and `EP-BUILD-STUDIO-UX` stream. Its return to
this execution path requires named served-SHA readiness, a successful end-to-end
build/UX evidence path and an interruption/failure recovery check. Until then,
external surfaces use the same MCP workroom and evidence gates.

## Verification and limits of this revision

This revision produces documents, not live UX verdicts or an install upgrade.
Run the repository docs-only preflight and applicable index/link/status/coverage
and UX-fit checks. The existing human comprehension, timing and manual accessibility
checks remain human review requirements; this commit does not add automation.
Keep immutable initiative coverage and independent review receipts separate from
Markdown mapping. Missing receipts leave implementation readiness pending even
when every planned slice has a BI. The historical coverage section below records
the closeout packet's original gap and is not a receipt for this revision.

Rollback: revert this documentation PR as one unit; it changes no routes,
permissions, schema or runtime state. Later UI slices need their own route and
data compatibility/rollback plan; preserve canonical work identity and existing
deep links, with explicit redirect/return tests if a route move is approved.

- **Backlog item:** `BI-436A9466`
- **Workroom:** `WC-1183CC5B`
- **Epic:** `EP-4FF5273F`
- **Audit:** [`2026-09-06-portal-ux-simplification-thread-audit.md`](../audits/2026-09-06-portal-ux-simplification-thread-audit.md)
- **Prior spine:** [`2026-05-26-portal-ux-simplification-spine.md`](2026-05-26-portal-ux-simplification-spine.md)
- **WWMD decision:** `DI-6E3E979EC8CE` selected `auditable-packet-plus-slices` with high confidence.

## Outcome

Turn the long-running UX simplification thread into a circulatable audit packet
and a governed execution queue. The outcome is not a big-bang UI rewrite. It is
a set of smaller implementation slices that each hide complexity for a named
persona, touch one route family at a time, and carry live evidence before being
called done.

## Delivery Principles

1. One independently reviewable backlog item, branch, and PR at a time.
2. Source truth before presentation cleanup. Do not group contradictory data
   into prettier cards until the backing record is reconciled or honestly
   labelled as uncertain.
3. First viewport before deep IA. If a founder/operator cannot tell what needs
   attention now, the route has not been simplified.
4. Feature fit before new surface area. Every UI-impacting plan must answer the
   owner area, route family, persona, nav layer, component convergence, source
   truth, empty/failure state, AI boundary, and verification evidence questions.
5. Refactor inside each slice. Reserve about 20% of the work for removing mixed
   concepts, duplicated patterns, or leaky abstractions discovered by the slice.
6. Build Studio remains out of this execution path until its own UX/runtime
   evidence is reliable enough to own UX refactors.

## Current State

Delivered:

- PR #5091 added `delegate` to the interaction shape graph and updated flow-load
  behavior so handing work to a coworker terminates the human traversal instead
  of inflating `stepsToOutcome`.
- CRM/marketing Slice 1 has already been reconciled into Business > Customer.
  The historical Pipedrive plan is not an executable checklist for new workers.
- The DPF-native `dpf-ux-fit-review` discipline exists and is the gate for
  future UI feature fit.

Open:

- The September audit left served verification open. Re-check readiness on the
  current install before equating source-level and platform-level delivery.
- The visible UX simplification work remains open and is split below.

## Phase 0: Closeout Packet

Backlog: `BI-436A9466`

Scope:

- Publish the September audit packet.
- Publish this execution plan.
- Update the May UX spine so it points to current evidence and backlog items.
- Mark the Pipedrive Slice 1 plan as historical/superseded so old process
  instructions do not steer future work.
- Commit a UX-fit/WWMD manifest for the delivery-shape choice.

Verification:

- `node scripts/gen-doc-index.mjs --check`
- `node scripts/check-doc-links.mjs`
- `node scripts/check-spec-status-frontmatter.mjs`
- `node scripts/check-plan-backlog-coverage.mjs`
- `node scripts/check-ux-fit-decision.mjs`

## Phase 1: Live Delivery Reconciliation

Backlog: use `BI-5A1A3C13` for delegate-source closeout evidence unless a
separate operational item is filed by release coordination.

Scope:

- Use only the sanctioned self-upgrade route when the live readiness tool returns
  `MUST-ADVANCE`.
- Re-check served SHA and feature SHA after the upgrade settles.
- Verify the current source behavior is present on the served platform before
  saying PR #5091 is delivered into the platform.

Verification:

- `verify_live_install_readiness` returns `CAN-TEST` for the feature SHA, or the
  exact blocker is recorded.
- The self-upgrade run ID and served SHA are recorded as evidence.

## Phase 2: Workspace First Viewport

Backlog: `BI-971D6F22`

Primary persona: founder/operator, with one configured worker acceptance pass.

Scope:

- Reduce `/workspace` from dashboard plus site map into attention, readiness,
  and work in motion.
- Keep KPI drilldowns valid, or render them inert with an explanation.
- Move low-frequency launchers below the first decision surface or behind a
  clearer grouped launcher.
- Make readiness labels understandable in place.

Verification:

- Desktop and narrow browser evidence.
- Comparable before/after scorecard with task completion and reduced avoidable
  traversal/choice cost. Do not compare first-viewport counts with May full-page
  link counts or call historical counts current measurements.
- First useful action and top exception visible without scrolling.
- No overlapping text, no horizontal overflow, and no duplicate local/global nav
  layer for the same choice.

## Phase 3: Workspace Coworker Trust

Backlog: `BI-36A2CF08`

Scope:

- Stop setup/system prompt text from rendering as assistant transcript content.
- Collapse repeated provider-unavailable turns into one honest state, or fail
  over before user-visible failure.
- Add receipt/confidence/why-this-answer affordance where coworker work affects
  business work.

Verification:

- Browser exercise of a greeting and a work-oriented request on `/workspace`.
- No hidden orchestration text appears in transcript.
- Provider failure state appears once, with retry/fallback context.

## Phase 4: Business Navigation Terminology

Backlog: `BI-1F0B4184`

Scope:

- Align People/Employee naming.
- Align Portal/Storefront naming so internal management does not borrow
  customer-facing `/portal` vocabulary.
- Check headings, AppRail labels, section labels, tab labels, and breadcrumbs.

Verification:

- Nav-model unit coverage where constants are changed.
- Browser crawl of the affected Business routes.
- External-customer routes remain distinct from internal Storefront management.

## Phase 5: Empty-State Orchestration

Backlog: `BI-CEB3FDF8`

Scope:

- Reuse or extend existing primitives such as `report-kit/EmptyState`; do not
  create another parallel empty-state family.
- Start with Documents, Compliance, Knowledge, and Architecture surfaces.
- Normalize setup decisions to create, upload, connect, import, configure, learn
  why unavailable, or not applicable yet.
- Hide zero-only KPI rows until data makes the metric useful.

Verification:

- Fresh-install browser evidence.
- No dead CTAs.
- Every empty state offers one clear next step or one honest unavailable reason.

## Phase 6: Platform AI Source Truth

Backlog: `BI-FFCE0D22`

Scope:

- Reconcile the mismatch where `/platform` reports standing grants but
  `/platform/ai` renders coworker cards as unassigned, governance pending, and
  zero grants.
- Only after reconciliation, group AI Operations by operator questions: who is
  working, what is blocked, what needs approval, what lacks capability, and what
  changed.
- Preserve dense diagnostics behind drill-ins.

Verification:

- Browser evidence for `/platform/ai/overview`, `/platform/ai/runtime-health`,
  and provider/governance detail routes.
- Displayed counts reconcile to backing records or render an explicit
  data-quality warning.

## Phase 7: CRM Marketing Feature Fit

Backlog: `BI-D8E00326`

Scope:

- Keep agentic sales and marketing operations inside Business > Customer.
- Do not add global AppRail entries, Workspace cards, Platform nav, or vendor
  branded visible copy.
- Use the feature-fit gate before any new campaign, funnel, automation, or
  coworker-launching surface.

Verification:

- `dpf-ux-fit-review` recorded for the slice.
- UI changes carry a measured `docs/ux-fit/*.ux-fit.json` manifest when
  required by the gate.
- Metric cards navigate or filter only; any coworker action uses preview and
  confirmation.

## Backlog coverage

- Decision: decomposed
- Parent: `BI-436A9466`
- Receipt: blocked-by: no initiative scope baseline exists for BI-436A9466 because spec-approval and objective-baseline receipts have not been recorded for this doc-only closeout packet
- Dependencies: phase-1 -> self-upgrade readiness; phases-2-through-7 -> phase-0 closeout packet
- Deliverables:
  - phase-0-closeout-packet -> `BI-436A9466`; depends on: none
  - phase-1-live-reconciliation -> `BI-5A1A3C13`; depends on: sanctioned self-upgrade readiness
  - phase-2-workspace-first-viewport -> `BI-971D6F22`; depends on: phase-0-closeout-packet
  - phase-3-workspace-coworker-trust -> `BI-36A2CF08`; depends on: phase-0-closeout-packet
  - phase-4-business-terminology -> `BI-1F0B4184`; depends on: phase-0-closeout-packet
  - phase-5-empty-state-orchestration -> `BI-CEB3FDF8`; depends on: phase-0-closeout-packet
  - phase-6-platform-ai-source-truth -> `BI-FFCE0D22`; depends on: phase-0-closeout-packet
  - phase-7-crm-marketing-feature-fit -> `BI-D8E00326`; depends on: phase-0-closeout-packet

| Deliverable | Requirements | Contracts | Flow | Verification |
| --- | --- | --- | --- | --- |
| `phase-0-closeout-packet` | `UX-THREAD-CLOSEOUT`, `UX-AUDIT-CIRCULATION`, `UX-PLAN-MAPPING` | docs corpus, Workroom evidence, DCO PR | thread findings to audit packet to execution queue | doc index, doc links, spec status, plan coverage, UX-fit gate |
| `phase-1-live-reconciliation` | `UX-SOURCE-TO-SERVED` | self-upgrade, live readiness, served SHA | source merge to served platform | `CAN-TEST` or recorded blocker |
| `phase-2-workspace-first-viewport` | `UX-WORKSPACE-ATTENTION` | AppRail, workspace view model, route budget | landing page to next action | desktop/mobile browser evidence and link-count reduction |
| `phase-3-workspace-coworker-trust` | `UX-COWORKER-TRUST` | coworker transcript, provider fallback, action receipt | user request to trusted answer or safe failure | prompt-leak absence and one failure state |
| `phase-4-business-terminology` | `UX-BUSINESS-LEXICON` | nav model, shell labels, breadcrumbs | Business navigation to route identity | nav tests and browser crawl |
| `phase-5-empty-state-orchestration` | `UX-FRESH-INSTALL-ACTION` | report-kit empty state, setup CTAs | zero-data surface to next setup action | no dead CTAs, fresh-install evidence |
| `phase-6-platform-ai-source-truth` | `UX-AI-STATE-TRUST` | AI workforce grant/governance read models | summary count to backing record | reconciled counts or explicit warning |
| `phase-7-crm-marketing-feature-fit` | `UX-CRM-FIT` | Business > Customer IA, customer marketing routes | feature plan to customer operation | recorded UX-fit review and measured manifest |
