# AI Routing Architecture & Explainability — Implementation Plan

> **For agentic workers:** execute this plan one independently reviewable backlog
> item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green
> implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate
> before any success claim, and `dpf-pr-with-dco` for handoff.

**Goal:** Produce one governed routing architecture and three synchronized
Designed/Observed/Compare views that explain LLM and AI coworker routing to owners
while giving technical users safe evidence, source links and conformance detail.

**Epic:** `EP-CFACFA9F`

**Umbrella BI:** `BI-3FA17F95`

**Design:** `docs/superpowers/specs/2026-07-26-ai-routing-architecture-explainability-design.md`

**Upstream contract:** `BI-3D210AF8` / merged PR #3602 /
`docs/superpowers/plans/2026-07-26-pre-dispatch-sensitive-llm-routing.md`

## Backlog coverage

- Decision: `decomposed`
- Receipt: `cms1zo19r04c301lhwyiplt8t`
- Parent: `BI-3FA17F95`

| Deliverable | BI | Depends on |
| --- | --- | --- |
| Canonical design and documentation authority | `BI-CC9BCFC8` | — |
| BPMN routing and linked EA projection | `BI-AA314BF4` | canonical design |
| Safe evidence correlation and conformance | `BI-758722A7` | canonical design; sensitive-routing receipt contract |
| Architecture drill-through and decision inspector | `BI-52C015D8` | canonical design |
| Operations Map Designed/Observed/Compare UX | `BI-7378E34C` | EA projection; evidence/conformance; drill-through |

Existing `BI-7E2A1DD0` owns the deployed interactive-map regression and must be
coordinated rather than duplicated.

## Delivery doctrine

- Extend the existing `/ea` and `/platform/ai/operations-map` surfaces.
- Keep routing, governance, provider-suitability and telemetry sources canonical.
- Project current state; do not hand-maintain it.
- Keep target-state facts visibly proposed.
- Never place raw prompt/tool/customer/employee/financial/secret values or token maps
  in architecture or operational evidence.
- Each BI lands through its own DCO-signed PR.
- Runtime-bound verification uses the governed shared nonprod environment.

## Phase 1 — `BI-CC9BCFC8`: canonical design and documentation authority

### Deliverable

Approve the design artifact, resolve routing-document authority and reconcile verified
current behavior.

### Work

- [x] Review the design with Enterprise Architect, Data Architect, AI Operations and
      provider-suitability ownership.
- [x] Merge or coordinate PR #3602 so the sensitive-routing contract has a stable
      repository path.
- [x] Verify the implemented pin behavior and live `AgentModelConfig` state; resolve
      the contradiction between the current-state architecture and user guide.
- [x] Classify the RIB/FIB control/data-plane document as proposed target-state until
      its implementation is resumed.
- [x] Add an architecture-document index that names current, target and historical
      routing sources.
- [x] Update the owner-facing routing lifecycle guide to point at one current
      authority and the eventual Operations Map view.
- [x] Record concrete documentation impact for operator, contributor and AI coworker
      surfaces.

### Likely files

- `docs/superpowers/specs/2026-07-26-ai-routing-architecture-explainability-design.md`
- `docs/superpowers/specs/2026-04-20-routing-architecture-current.md`
- `docs/superpowers/specs/2026-04-27-routing-control-data-plane-design.md`
- `docs/user-guide/ai-workforce/model-routing-lifecycle.md`
- `docs/user-guide/platform/ai-operations.md`
- relevant architecture index/README

### Verification

- Link/path check for all referenced artifacts.
- `git diff --check`.
- Architecture advisory contains no unresolved critical ownership duplication.
- Pinning statements are supported by code and live-state evidence.

### Rollback

Revert documentation/index changes. No runtime or schema state is changed.

## Phase 2 — `BI-AA314BF4`: BPMN routing and linked EA projection

### Deliverable

Add a deterministic AI-routing process domain to the Parity Engine.

### Work

- [ ] Define a versioned routing-stage registry or extractor input from existing
      exported routing/governance contracts.
- [ ] Write failing pure tests for the complete process from payload assembly through
      authorized response handling.
- [ ] Project stages to BPMN process, tasks, gateways, conditional/default flows and
      lanes.
- [ ] Include sensitive screen, PDP/PEP, transformation, RequestContract compilation,
      eligibility, availability/limits, ranking, fallback, dispatch, receipt and
      rehydration.
- [ ] Map requirements/constraints/verification cases to existing SysML element types.
- [ ] Materialize existing cross-notation relationships to realizing ArchiMate
      components/capabilities.
- [ ] Reuse `applySysmlModel`/shared projection and conformance reconciliation.
- [ ] Register the domain in the existing projection orchestrator and steward.
- [ ] Verify idempotency, soft removal, source-key stability and domain-isolated
      failure behavior.

### Likely files

- `apps/web/lib/ea/process-extract.ts` or a routing-specific sibling
- `apps/web/lib/ea/reconcile-process.ts` or a routing-specific sibling
- `apps/web/lib/ea/reconcile-sysml-projections.ts`
- `apps/web/lib/ea/sysml-model-seed.ts`
- `packages/db/src/seed-ea-cross-notation.ts` only if an existing validated mapping
  is insufficient
- focused EA projection tests

### Verification

- Targeted Vitest for extractor, reconciler and relationship validation.
- `pnpm check:architecture-parity`.
- A repeated reconcile produces no duplicate elements or relationships.
- Shared nonprod EA view shows the complete route with working cross-notation links.
- Missing source/version produces a conformance issue rather than silent omission.

### Rollback

Remove the routing domain from the projection orchestrator and soft-remove its stable
source-key prefix. Preserve unrelated EA views and conformance history.

## Phase 3 — `BI-758722A7`: safe evidence correlation and conformance

### Deliverable

Create one privacy-safe projection from existing route evidence into time-window
metrics and design/runtime conformance.

### Work

- [ ] Inventory existing correlation fields and write a no-new-ledger decision.
- [ ] Adopt or extend one existing identifier envelope across screen decision, route
      decision, fallback attempts, adapter outcome, usage and rehydration.
- [ ] Bind every Compare calculation to the applicable EA/projection snapshot and
      implementation source revision; do not compare historic traffic silently
      against only the latest design.
- [ ] Define a strict safe-field allowlist and forbidden-field canary fixtures.
- [ ] Build a pure aggregation model keyed by stable architecture identity and time
      window.
- [ ] Compute volume, exclusions, fallback depth, errors, latency, tokens/cost,
      capacity, freshness, attribution and correlation coverage.
- [ ] Compute designed-only, observed-only, missing-evidence and stale-design states.
- [ ] Reconcile aggregated architecture conformance issues without per-transaction
      issue rows.
- [ ] Use OpenTelemetry-compatible GenAI names when they match existing DPF contracts.
- [ ] Document retention and historical-coverage limitations.

### Likely files

- AI Operations Map projection/loaders
- routing evidence/correlation types
- existing route-decision/outcome recording seams
- EA conformance reconciler
- focused privacy and aggregation tests

### Verification

- Fixture route follows screen → decision → fallback → outcome → rehydration.
- Historical fixture is compared against its named design revision, and a missing
  revision is shown as unproven rather than drift.
- Uncorrelated and unattributed fixtures remain visible as coverage gaps.
- Canary sensitive values are absent from DB writes, serialized projections, logs,
  exports and exceptions.
- Aggregates match direct ledger queries for a controlled fixture window.
- Repeated conformance reconciliation is idempotent.

### Rollback

Disable the new evidence/conformance projection. Existing route ledgers remain
authoritative and unchanged.

## Phase 4 — `BI-52C015D8`: architecture drill-through and decision inspector

### Deliverable

Make related BPMN, SysML, ArchiMate, source and evidence viewpoints navigable.

### Work

- [ ] Derive related views from shared `EaElement` membership and existing
      `EaRelationship`/source identities.
- [ ] Add authorized SysML view creation/refresh to the existing architecture flow.
- [ ] Add related-view actions to the element inspector.
- [ ] Add a governed routing-decision inspector showing safe inputs, source/version,
      outcome vocabulary and evidence freshness.
- [ ] Decide from evidence whether the inspector is sufficient or a future DMN
      notation BI is justified.
- [ ] Keep SysML details behind architecture permissions and progressive disclosure.
- [ ] Add keyboard, screen-reader and no-color-only navigation tests.

### Likely files

- `apps/web/components/ea/EaCanvas.tsx`
- `apps/web/components/ea/ElementInspector.tsx`
- `apps/web/components/ea/CreateViewButton.tsx`
- `apps/web/lib/actions/ea.ts`
- EA view-data loader and focused tests

### Verification

- Navigate BPMN station → SysML requirement/verification → ArchiMate component →
  implementation source → Operations Map lens.
- Unauthorized users cannot enter technical architecture details.
- No new canonical view-link table exists unless the BI records substrate
  insufficiency and approved design.
- Responsive and keyboard verification in shared nonprod.

### Rollback

Remove related-view/decision-inspector UI while preserving canonical EA elements and
relationships.

## Phase 5 — `BI-7378E34C`: Operations Map Designed/Observed/Compare UX

### Deliverable

Complete the unified Operations Map as the owner-readable routing architecture and
operational picture.

### Work

- [ ] Coordinate or resolve `BI-7E2A1DD0` before relying on the current client canvas.
- [ ] Freeze provider, A2A, replay, filter, saved-view, inspector and empty-state
      parity fixtures.
- [ ] Keep `/platform/ai/operations-map` as the one canonical route and use local
      mode/time-window controls; do not add global or section navigation.
- [ ] Make the first viewport answer “How should work route?”, “Is anything unsafe
      or blocked?”, and “Is observed behavior different?” before dense diagnostics.
- [ ] Use the projected routing graph as the stable canvas geometry.
- [ ] Add Designed, Observed and Compare mode controls with a visible time window.
- [ ] Render privacy-safe volume/status evidence on the designed edges.
- [ ] Add owner-language stations and progressive technical inspection.
- [ ] Add coverage/freshness/unattributed/uncorrelated indicators.
- [ ] Preserve A2A, provider, replay and source-record honesty.
- [ ] Compose report-kit filters/status/table primitives, `statusColors`, `LocalTime`
      and existing EA/Operations Map components rather than a new visual dialect.
- [ ] Treat view/filter/inspect as read-only. Any future route simulation or coworker
      action requires context preview, expected next step and explicit confirmation.
- [ ] Verify list/table equivalence, keyboard navigation, mobile vertical layout and
      no-overlap behavior.
- [ ] Cut over only after parity; delete legacy panels, preview toggles and duplicated
      projection helpers.

### Likely files

- `apps/web/components/platform/AiOperationsMap.tsx`
- `apps/web/components/platform/OperationsTopologyCanvas.tsx`
- Operations Map projection/loaders and tests
- shared report-kit primitives only where existing components fit

### Verification

- Owner can answer how routing should work, how it did work, and what differs.
- Exercise low-risk public, sensitive blocked, sensitive transformed, local-only,
  provider unavailable, fallback and rehydration fixtures.
- Exercise honest no-traffic, unavailable-evidence and missing-permission states.
- Verify desktop and mobile screenshots plus keyboard/list equivalence.
- Run the served-DOM UX budget sweep and theme/style-drift checks.
- Targeted tests, web production build and shared-nonprod UX verification pass.
- Legacy panels are deleted only after parity evidence.

### Rollback

Restore the prior authoritative panels behind the existing projection contract. Do
not roll back the EA/evidence substrate when only presentation fails.

## Cross-phase completion gate

The umbrella is complete only when:

- all five child BIs are done through separate DCO-signed PRs;
- PR #3602 contracts are represented in the designed route;
- routing documentation has one current authority and explicit target/history labels;
- the live EA graph contains the routing BPMN process and instantiated cross-notation
  relationships;
- safe evidence correlation and coverage are visible and tested;
- Designed, Observed and Compare reuse one stable geometry;
- `BI-7E2A1DD0` is resolved or its fix is incorporated;
- legacy Operations Map panels/toggles are removed after parity;
- unit, build, UX, accessibility and privacy-canary gates pass;
- documentation impact is recorded for users, contributors and AI coworkers.

## Refactoring budget

Reserve approximately 20 percent across the child BIs:

| Refactor | Budget |
| --- | ---: |
| Shared routing-stage/stable-identity projection builders | 5% |
| Safe correlation and receipt projection consolidation | 5% |
| One Designed/Observed/Compare view-model builder | 4% |
| Shared architecture drill-through/inspector primitives | 2% |
| Delete superseded panels, toggles and duplicate helpers | 4% |

## Risks

- **Upstream-contract drift:** PR #3602 is merged, but later sensitive-routing
  implementation may refine its contracts. Each implementing BI must re-read the
  current merged contract before edits.
- **Historic evidence gaps:** do not backfill fabricated links; show coverage.
- **Sensitive observability:** allowlist safe fields and run persistence canaries.
- **Over-modeling:** extract only construction, verification, authority and
  explainability facts.
- **UI overload:** keep one stable owner map and disclose technical detail on demand.
- **Premature DMN:** use the existing rule sources plus inspector first.
- **Source-only worktrees:** runtime-bound build/UX evidence comes from the governed
  shared nonprod environment.
