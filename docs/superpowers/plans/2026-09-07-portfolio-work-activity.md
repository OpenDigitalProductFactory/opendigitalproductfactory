---
status: active
---

# Portfolio work activity refactoring plan

Date: 2026-09-07 · Umbrella: BI-8DACBA07 · Epic: EP-WORK-CONVERGENCE

Canonical design: [Portfolio work activity and human accountability](../specs/2026-09-07-portfolio-work-activity-design.md).

Delivery shape: decomposed, xlarge. This PR publishes the accepted visual direction and delivery plan. It does not implement the refactoring or declare the delivery BIs complete. Implementation claims require the platform's design/plan reviews and readiness receipts.

## Backlog coverage

Requirements, contracts, flows and verification IDs below are sections in the canonical design. Existing items retain their broader scope and status. Dependencies are delivery keys, not copied workrooms.

| Key | Deliverable / live backlog | Depends on | Requirements | Contracts | Flows | Verification |
| --- | --- | --- | --- | --- | --- | --- |
| D1 | Portfolio placement derivation and reconciliation — BI-FB6389E0 (existing) | — | PWA-01 | C1 | F1 | V1 |
| D2 | Inherited human accountability — BI-571093CC (new) | — | PWA-04, PWA-05 | C2 | F3 | V3 |
| D3 | Bounded portfolio activity projection — BI-66F3E9E5 (new) | D1 | PWA-01, PWA-02, PWA-03, PWA-06, PWA-07 | C1, C3, C4 | F1, F2, F4 | V1, V2, V4 |
| D4 | Named sessions and delegated workers — BI-C41AB195 (existing) | — | PWA-03, PWA-06 | C3 | F2 | V2 |
| D5 | Dense tree, inspector and consolidated navigation — BI-9DC43E17 (existing) | D1, D2, D3, D4 | PWA-01 through PWA-08 | C1 through C4 | F1 through F4 | V1 through V4 |

These are independently shippable deliverables: source placement, responsibility resolution, read API, session adapters and operator UI can each be released with their own tests and rollback. D3 can expose existing activity before D4 enrichment; D5's final acceptance requires all dependencies. This document is not a separate execution ledger; live status and formal coverage receipts belong in PostgreSQL through DPF MCP.

## Phase 1: establish trusted placement and responsibility

### D1 — reuse BI-FB6389E0

Inspect current portfolio taxonomy/source links, creation paths and observed Workroom metadata. Amend source derivation and seed/install paths, then reconcile existing rooms with provenance and a repair report. Reuse `apps/web/lib/ea/workroom-architecture.ts`, source registry and `packages/db/src/portfolio-sources/`. Preserve canonical root identities and actual taxonomy; remove silent fallback from the new projection contract. Missing data remains explicit until reconciled.

Validate V1 against existing populated data, not only a new install. If persistence changes are needed, use forward-only migrations with inline backfill and test incomplete/conflicting records. Never relabel rooms based on illustrative mockup fixtures. Completion requires evidence of the canonical creation path and live reconciliation, not historical backlog percentages.

### D2 — BI-571093CC

Audit organization ownership, role bindings and setup before choosing persistence. Extend the canonical responsibility resolver and Workroom participant projection. Record the authoritative reporting/delegation lineage and override semantics; ownership must not follow a dependency graph. The resolver returns effective human principal, source binding/path and resolution state, filtered under existing authorization.

Implement setup validation and source correction for solo-owner defaults across installs, then populated-state reconciliation. Keep `room-coordinator.ts` execution selection independent. V3 is the acceptance suite. An unexpressible binding is a precise schema-design gap to resolve before implementation, not permission to create a parallel owner registry.

BI-24E7D59F covers the separate AI coordinator ladder; its configuration blockers remain its own work. Do not close it because human responsibility becomes visible.

## Phase 2: project activity and correlate workers

### D3 — BI-66F3E9E5

Extend canonical readers under `apps/web/lib/work-management/` and existing Workroom inventory loaders. Return typed branch pages with unique room identity, canonical targets, bounded representative actions, aggregate completeness and freshness. Authorization precedes aggregation. Use indexed queries, cursors and stable ordering; do not reuse the architecture reader's 200-row cap as a complete inventory.

Separate branch summaries from selected room/worker details. Define event invalidation, coalescing, cancellation and gap refresh using the current subscription transport. Do not fan out to external providers from the list request. Test V1/V2 query and event behavior, and record PWA-07 performance measurements with the test profile. UI wiring can follow independently.

### D4 — reuse BI-C41AB195

Extend existing AgentSession/task and source adapters so one room rolls up named executors with scoped delegated-worker detail. Preserve existing parentage and identity; unknown relationships remain unknown. Provide state, current task and last observed progress without exposing raw private deliberation. Test deduplication across surfaces, 100 agents, permission filtering, paging and stale/gapped streams (V2).

This refactoring consumes the existing session initiative; it does not replace it with a client-specific registry. Share its canonical activity projection with D3 when enrichment is available.

## Phase 3: deliver the operator experience

### D5 — reuse BI-9DC43E17

Build on PR #5167's process inspection and the existing Workroom components. Recheck its merged state and surviving acceptance before implementing; its recovery/evidence changes are not duplicated here. Extend `WorkroomInventory.tsx` with the compact four-root tree and add the adjacent shared inspector. Separate expansion from selection and preserve navigation state. Render concrete activity and truthful symbols with reduced-motion support.

Expose all rooms through expansion/search and direct activity targets. Integrate D2 effective accountability and D4 worker detail. Reuse the existing Shape/Overview/Details components; do not create a second process graph. Implement the PWA-08 navigation map centrally in `portal-navigation-model.ts`, including compatibility links and authorization checks. Workforce business scope and coworker directory scope remain distinct.

Run V1–V4 against the canonical nonproduction environment with the shared lease. Cover 360/736/1024-pixel viewports and large-fixture behavior. Update the user guide, route discovery documentation and relevant coworker guidance in the same implementation branch. Final acceptance is an operator walkthrough from a collapsed portfolio to an active agent and its evidence, plus inherited ownership inspection, without a second activity dashboard.

## Rollout and rollback

First ship canonical data/resolver changes with their own evidence. Then ship projection and session enrichment through existing versioned contracts. Introduce the activity presentation under the existing feature rollout mechanism after inspecting its current implementation; do not invent a new flag store. Keep old bookmarks resolving during rollout. Compare aggregate completeness and authorization results before making Work the main entry.

Rollback presentation/routing independently while retaining canonical data and bookmarks. Schema changes are forward-only; any repair migration requires its own acceptance. Keep an explicit compatibility window in the implementing PR rather than deleting legacy routes on launch. Remove duplicate activity navigation only after consumers and redirects are verified.

## Gates and completion

For this documentation PR: validate Markdown links, visual reference, prose/source policy and exact signed diff through the docs gate. Runtime tests, production build and migration execution are not applicable because no application or schema bytes change. Mockup checks are not live-product UX evidence.

For implementation: affected unit/contract tests and cheap local checks precede push; cloud build and canonical-runtime UX/migration gates follow the current AGENTS.md. Attach runtime evidence to the delivering workroom and keep unavailable gates inconclusive. Do not mark the umbrella complete until all five deliverables and their cross-flow acceptance pass.

Publish an immutable signed plan blob, synchronize the design workroom's head, and record `record_plan_backlog_coverage` with the five rows above. Design approval, architecture review and plan approval remain distinct governed receipts; this plan does not self-certify them. Live backlog bodies point here and to the canonical requirements; status changes occur through DPF tools.

Publication-time condition: no initiative scope baseline exists for BI-8DACBA07, so the platform refused formal coverage registration. Its prescribed recovery through an implementation claim was also refused because an xlarge initiative never enters implementation. The five live mappings above remain the delivery plan; obtain independent initiative scope approval and approved shaped decomposition before execution. Do not bypass the refusal or reclassify the initiative to make the gate pass.

## Overlap and deferred work

- PR #5167: process inspection/evidence prerequisite; no changes to its files in this docs PR.
- BI-06AE6833: PR convergence/recovery loop; remains separate.
- BI-3EDEA0D8: completed coworker utilization work; consume its existing readers, do not reopen it as missing.
- PAAW definitions, occurrences and R0–R5 refinement remain canonical. No replacement organizational taxonomy or engine is planned.
- Workforce renaming is deferred by the operator. Finance, hiring and other supporting activities are already in scope under that label.
