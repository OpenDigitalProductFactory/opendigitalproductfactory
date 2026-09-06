---
status: active
---

# Portal UX Simplification Closeout Execution Plan

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

- The live install still needs a sanctioned self-upgrade/readiness check before
  source-level delivery is equal to platform-level delivery.
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
- Link-count reduction against the May baseline.
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
