# Work Case Wave 0 Implementation Plan

Date: 2026-06-27
Status: Proposed implementation plan
Epic: EP-2984B02B - Work Case / Company Work Management
Backlog item: BI-40EE7AFD - Wave 0: Work Case source registry, status projection, and read-model skeleton
Spec: docs/superpowers/specs/2026-06-27-work-management-architecture-design.md

## Objective

Create the executable foundation for Work Case before governed write-path, receipt enforcement, sponsor/authority-mode migrations, or Workspace UI work begins.

Wave 0 ships three things:

- A canonical Work Case / WorkItem source registry that replaces split source knowledge.
- Typed, explainable Work Case status projection helpers over existing substrate.
- The initial `apps/web/lib/work-management/*` read-model skeleton with pure tests.
- A slice-local EA/SysML grounding manifest with stable `REQ`/`ACT`/`PART`/`VC` IDs and code allocations, so the implementation can be registered/refreshed in the EA substrate without inventing a parallel architecture model.

No UI, Prisma migration, external A2A interface, governed write-path enforcement, receipt-enforcement guard, or EA database mutation belongs in this BI.

## Substrate Grounding

The plan is grounded in:

- `apps/web/lib/queue/queue-types.ts`
  Current source type and status constants: `WORK_ITEM_SOURCE_TYPES`, `WORK_ITEM_STATUSES`.
- `apps/web/lib/api/work-item-account-resolution.ts`
  Current resolver map: `RESOLVERS` and `__RESOLVER_KEYS_FOR_TESTS`.
- `apps/web/lib/api/work-item-account-resolution.test.ts`
  Existing characterization coverage for account resolution.
- `apps/web/lib/api/work-items.ts` and `apps/web/lib/api/work-items.test.ts`
  Existing WorkItem API behavior to avoid breaking.
- `apps/web/lib/work-capsules.ts`, `apps/web/lib/work-capsules.test.ts`, and `apps/web/lib/work-capsules-enum-parity.test.ts`
  Existing WorkCapsule status vocabulary and invariants.
- `packages/db/prisma/schema.prisma`
  Existing `WorkItem`, `WorkCapsule`, `DecisionInteraction`, `RuntimeVerification`, `ExternalEvidenceRecord`, `Principal`, `AuthorityBinding`, and `DelegationChain` models.
- `apps/web/lib/golden-triangle/receipt.ts`
  Existing receipt concept to be preserved for Wave 1 receipt-envelope work.
- `packages/db/prisma/schema.prisma`
  Existing EA/SysML substrate: `EaElement`, `EaRelationship`, `EaView`, `EaConformanceIssue`, notation registry, `CoworkerActionEnvelope`, `ToolExecutionReceipt`, `AgentGovernanceProfile`, and `DelegationGrant`.
- `docs/architecture/2026-06-14-ai-cockpit-sysml-architecture-note.md`, `docs/Reference/sysml-v2.md`, and `docs/architecture/ai-agent-meta-model.md`
  Existing modeling conventions for SysML `requirement`, `action`, `part_definition`, `interface_definition`, and `verification_case` projections over DPF runtime substrate.

The code graph was available, but the compound planning query did not return hits. Local grep provided the authoritative file-level grounding for this slice.

## Phase 1 - Characterize Current Source Behavior

Deliverable:

- Add or extend tests that enumerate every current WorkItem source type and every current account resolver key.
- Confirm the current mismatch explicitly: source types include `task-node`, `backlog-item`, `approval`, `manual-task`, and `scheduled`; account resolvers currently cover business source keys such as engagement/opportunity/booking shapes.

Likely files:

- `apps/web/lib/api/work-item-account-resolution.test.ts`
- New fixture helpers under `apps/web/lib/work-management/__tests__` only if they remove duplication.

Verification:

- `pnpm --filter web exec vitest run apps/web/lib/api/work-item-account-resolution.test.ts`

Ship value:

- Establishes a behavioral baseline before moving source knowledge.

## Phase 2 - Add The Canonical Source Registry

Deliverable:

- Create `apps/web/lib/work-management/source-registry.ts`.
- Define a registry entry for each current WorkItem source type and the business source resolver shapes currently handled by account resolution.
- Each entry should declare:
  - source key
  - display label
  - owning area/route
  - domain category
  - account/customer resolver
  - case title projection
  - case summary projection
  - default decision scope
  - supported transitions
  - receipt-policy defaults
- Keep the registry as pure TypeScript. Do not add database enum values in this BI.

Likely files:

- `apps/web/lib/work-management/source-registry.ts`
- `apps/web/lib/work-management/source-registry.test.ts`
- `apps/web/lib/queue/queue-types.ts`
- `apps/web/lib/api/work-item-account-resolution.ts`

Verification:

- Registry tests prove every existing `WORK_ITEM_SOURCE_TYPES` value has a registry entry.
- Resolver parity tests prove current account-resolution outputs are unchanged.
- `pnpm --filter web exec vitest run apps/web/lib/work-management/source-registry.test.ts apps/web/lib/api/work-item-account-resolution.test.ts`

Ship value:

- First independently shippable slice if the old exports re-export registry-derived constants and all old behavior remains stable.

## Phase 3 - Migrate Account Resolution To Registry Adapters

Deliverable:

- Route `resolveWorkItemAccount` through the canonical registry instead of the local `RESOLVERS` object.
- Preserve `__RESOLVER_KEYS_FOR_TESTS` or replace it with a registry-derived test helper.
- Keep all outward API behavior stable.

Likely files:

- `apps/web/lib/api/work-item-account-resolution.ts`
- `apps/web/lib/api/work-item-account-resolution.test.ts`
- `apps/web/lib/work-management/source-registry.ts`

Verification:

- Existing resolver tests pass unchanged except for intentional fixture updates.
- Add a negative test for unknown source type behavior.

## Phase 4 - Define Work Case Types And Status Projection

Deliverable:

- Create `apps/web/lib/work-management/case-types.ts`.
- Create `apps/web/lib/work-management/status-projection.ts`.
- Define the Work Case states from the spec:
  - `intake`
  - `triage`
  - `active`
  - `waiting-on-person`
  - `waiting-on-system`
  - `awaiting-decision`
  - `verifying`
  - `resolved`
  - `closed`
  - `cancelled`
- Projection must not merge underlying enums. It maps and explains them.
- Every projection result includes:
  - `state`
  - `reason`
  - `sourceRef`
  - optional `blockingActorKind`
  - optional `confidence`

Likely files:

- `apps/web/lib/work-management/case-types.ts`
- `apps/web/lib/work-management/status-projection.ts`
- `apps/web/lib/work-management/status-projection.test.ts`

Verification:

- Tests cover representative combinations:
  - WorkItem queued/open intake
  - WorkItem in progress with no capsule
  - WorkCapsule working
  - WorkCapsule blocked/provider blocked
  - DecisionInteraction pending/human outcome required
  - RuntimeVerification passed/failed
  - completed/cancelled source state

## Phase 5 - Add Read-Model Skeleton

Deliverable:

- Create `apps/web/lib/work-management/case-read-model.ts`.
- Expose pure projection helpers that can turn loaded records into a `WorkCaseSummary` and `WorkCaseDetail`.
- Do not add route loaders or UI in this BI unless needed to compile the library.
- Include stable source references so later receipt and detail views can drill into authoritative rows.

Likely files:

- `apps/web/lib/work-management/case-read-model.ts`
- `apps/web/lib/work-management/case-read-model.test.ts`
- `apps/web/lib/work-management/index.ts`

Verification:

- Pure read-model tests build summaries/details from fixtures without a database.
- Typecheck catches drift between Prisma payload assumptions and exported view-model types.

## Phase 6 - Add EA/SysML Grounding Manifest

Deliverable:

- Create `apps/web/lib/work-management/architecture-grounding.ts`.
- Define stable descriptors for Wave 0's current-state and target-state architecture commitments:
  - `REQ-WC-4` A2A lifecycle alignment, allocated to `status-projection.ts`.
  - `REQ-WC-5` decision routing as a deferred invariant, allocated to the future governed write path.
  - `ACT-WC-derive-summary`, `ACT-WC-project-status`, and source-registry registration actions.
  - `PART-WC-case-projection` and `PART-WC-source-registry`.
  - `VC-WC-1` through `VC-WC-5`, with Wave 0 providing current-state evidence for the source registry, lifecycle/A2A projection, and read-model skeleton while marking governed-write, receipt-coverage, sponsor, and decision-routing guards as planned.
- Include `sysml_allocates` relationships to the realizing source files and `itValueStream` anchors for company work (`operate`/`consume`) and platform-development work (`integrate`/`deploy`/`release`).
- Expose the manifest as pure TypeScript so later EA seed/refresh tooling can upsert `EaElement`/`EaRelationship` rows and detect `EaConformanceIssue` drift.

Likely files:

- `apps/web/lib/work-management/architecture-grounding.ts`
- `apps/web/lib/work-management/architecture-grounding.test.ts`
- `apps/web/lib/work-management/index.ts`

Verification:

- Tests prove every Wave 0 work-management source file has at least one allocation.
- Tests prove each `REQ` has a matching `VC`.
- Tests prove the manifest uses existing EA relationship vocabulary (`sysml_allocates`) and does not require new modeling tables.

## Phase 7 - Documentation And Evidence

Deliverable:

- Update the Work Case spec if implementation finds a substrate mismatch.
- Keep the Wave 0 plan aligned with reviewed spec changes, especially the SysML/EA grounding section and the sibling governed-adaptive-playbooks dependency.
- Record BI evidence with test commands and results.
- Leave later-wave BIs unstarted until Wave 0 is green.

Verification:

- `git diff --check`
- `pnpm --filter web exec vitest run apps/web/lib/work-management/*.test.ts apps/web/lib/api/work-item-account-resolution.test.ts apps/web/lib/work-capsules.test.ts apps/web/lib/work-capsules-enum-parity.test.ts`
- `pnpm --filter web typecheck`
- `pnpm --filter web build`

## Risks

- Registry becomes another source of truth instead of the source of truth.
  Mitigation: derive old constants from the registry where possible and add parity tests.
- Projection hides why a case is in a state.
  Mitigation: every projected state carries a source reference and reason.
- Wave 0 accidentally starts Wave 1 enforcement.
  Mitigation: no governed write-path wrappers or receipt guards in this BI.
- Type imports pull Prisma payloads into inappropriate shared modules.
  Mitigation: keep view-model types narrow and use existing API-layer patterns.
- EA grounding becomes a second architecture source of truth.
  Mitigation: keep Wave 0 to a code-local manifest with stable IDs and allocations; the EA graph remains the model of record once seed/refresh tooling upserts it.

## Rollback

Rollback should be straightforward:

- Revert the `apps/web/lib/work-management/*` module.
- Restore direct resolver lookup in `work-item-account-resolution.ts` if Phase 3 landed.
- Keep characterization tests if they document existing behavior and still pass.
- Remove the Wave 0 EA grounding manifest without touching persisted EA rows, because this BI does not mutate the EA database.

No migration rollback is needed because Wave 0 does not change the database schema.

## Definition Of Done

- `BI-40EE7AFD` has a passing registry, status projection, and read-model test suite.
- Existing account-resolution behavior is preserved.
- Existing WorkCapsule enum/parity tests pass.
- Wave 0 exposes test-covered EA/SysML grounding IDs and allocations for later EA substrate refresh.
- The production web build passes.
- The implementation records evidence on the BI and links back to the Work Case spec.
