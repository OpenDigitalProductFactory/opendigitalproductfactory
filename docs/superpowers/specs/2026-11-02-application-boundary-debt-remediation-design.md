# Application boundary debt remediation

Status: proposed design; design authoring allowed, implementation not admitted.

Backlog: BI-9BEB3D56. Epic: EP-413F2602. Delivery room: WC-6BEA0CEF. Branch: `fix/application-boundary-debt`. Source inspected: `36b46866870694dab1763e691862da38dc577e76`.

## Problem and observed evidence

The unchanged application-boundary guard rejected 43 expired exception reviews on November 2. Each has `reviewBy: 2026-11-01`. The overall registry budget expires November 16. The fresh source-reference preflight ended before a sandbox lease: 84 of 85 host guards passed; this guard failed. The same registry validation failed on protected main. This blocks current source qualification for the source-reference, scorecard and routing-wording repairs; it is not evidence of a regression in those repairs.

The read-only inquiry WC-150C55A7 reached native `stop:success` with both required stage receipts (activity `cmvzyug2h0zuv01n2y1tztjpr`). All 43 exact keys are accounted for: 42 imports are live; the tool-fidelity-harness to TAK intent-taxonomy exception is obsolete. The chat-adapter queue-lock re-export is live with one legacy test-file consumer; it is not the obsolete entry.

Registry blob: `1fd8d62165a9250de8c0cc1bf57990a74058872c`; registry SHA-256: `e674a8263314dad44232ffd91e8b1250cc62d258b97a971928abdb63afac2314`. Guard blob: `ea83709278a244c20eb2611d205bae669b478355`. Findings packet SHA-256: `cfd4ce3d836cb9801643a50ec17c7247e4141fffd4a797d9749c8894c66921d4`. The packet combines 22 native source/usage findings and the existing routing owner's 21-edge external advisory; that advisory is not a native EA approval.

## Research and approach

This is repair research against an existing architecture contract, not a new feature or external dependency selection. The canonical direction and refactoring rules are in [application boundaries](../../architecture/application-boundaries.md). The actual guard checks exact imports, stale exceptions, owned budgets and expired reviews. Its baseline serializer is not authority to accept debt.

Three existing implementations ground the design:

- `actions/agent-skills.ts:9-27` already delegates skill resolution to `skills/runtime`; TAK should use that canonical runtime directly.
- `queue/scheduled-owner.ts:21-30` already delegates to `portfolio/accountable-owner`. Four non-queue callers can reuse that policy through their existing dependency seams rather than duplicate owner fallback.
- `build/plan-to-build-transition.ts` already exposes `PlanToBuildActivityLogger`; the persistence implementation in `mcp/build-tool-helpers.ts:12-14` belongs with Build, with MCP reusing it.

Platform decision `DI-89A4F66AE1D7`, profile `mark-dpf-platform`, recommends `repair-first` with verdict `proceed`. It compares source repair with first seeking an accountable bounded-retention decision. This ranks the approach only; it is not spec approval, implementation admission, a retained-debt budget, or permission to replay a review.

Chosen approach: remove or invert the reverse dependencies through their actual owners, then remove only exceptions whose imports have disappeared. No date extension is proposed. Seeking a separately approved retention budget is a possible later scope change, requiring an explicit per-edge owner, reason, shrink schedule and review date. Blanket date changes, a second guard engine and a neutral shared dumping ground are rejected.

## Objectives and acceptance

**OBJ-BND-1:** Restore publication through the unchanged application-boundary guard by removing the expired reverse dependencies.

**OBJ-BND-2:** Preserve existing identity, authorization, privacy, resource admission, execution attribution and public behavior while moving responsibilities to their canonical owners.

**OBJ-BND-3:** Return current qualification to the existing feature owners with truthful evidence and preserved historical outcomes.

| Acceptance ID | Objective IDs | Statement |
| --- | --- | --- |
| AC-BND-001 | OBJ-BND-1 | All 43 initial exception keys have an evidence-backed source disposition; the 42 live reverse dependencies are removed or inverted and the one absent exception is removed. No replacement exception or expiry extension is added. |
| AC-BND-002 | OBJ-BND-1, OBJ-BND-2 | The unchanged application-boundary guard and its tests pass on the final exact source at the actual current date, with no new reverse imports, outer-layer violations, stale exceptions or cycles introduced by the refactor. |
| AC-BND-003 | OBJ-BND-2 | Existing public entry points retain compatible behavior and share single canonical implementations; characterization verifies ownership fallback, tool attachment, screening, session scope, resource locks, telemetry, scheduling, replay parsing and error identity for the affected closures. |
| AC-BND-004 | OBJ-BND-2 | No new table, state store, worker, provider, grant, permission, public response shape or dependency is introduced. Sensitive writes and dispatch remain behind their existing gates, and original UNKNOWN attempts remain immutable and unreplayed. |
| AC-BND-005 | OBJ-BND-2 | Affected test/guard obligations from each implementation scope claim are resolved, package typechecks and the required exact-tree gate pass, and any served-path checks use an ordinarily admitted shared environment. Unit/source checks are not described as a live journey pass. |
| AC-BND-006 | OBJ-BND-3 | After protected publication, the source-reference, scorecard and wording owners receive the actual containing source and unchanged-guard result, then qualify their own current heads. Their feature acceptance and the original seven-scenario campaign remain separate obligations. |

## Contracts and ownership

Contract BND-C1 is the existing DAG: MCP to actions to queue to integrations/Build to TAK to inference to routing. New typed ports are owned by the inner policy they describe; outer composition supplies side effects. Existing wrappers may remain for compatibility but may not retain the same reverse edge under a different alias.

Contract BND-C2 preserves transport at the edge: session authentication, HTTP/MCP serialization, Next revalidation, credentials and process/file operations stay in outer adapters. Moving an action to another action module does not fix its direction.

Contract BND-C3 preserves one owner per policy and state. Reuse Principal/User/portfolio ownership, the existing grant intersection, shared resource lane, queue telemetry and TaskRun/engagement records. No schema, read model or denormalized ledger is added.

Contract BND-C4 preserves execution uncertainty. No investigation fixture dispatches real finance work, experiments, tasks or provider inference. Existing original-result recovery and human approvals are not altered by this refactor.

## Ordered implementation design

These groups sequence one guard-restoration deliverable. They are not new runtime stages or independent work ledgers. Obtain current implementation admission and exact edit claims before code; consume the returned impact contract for every affected path.

| Group | Responsibility and required check |
| --- | --- |
| BND-G1 | Retire the absent fidelity exception. Migrate the chat-adapter test consumer to canonical queue before removing its live compatibility export. Verify actual imports with the guard extractor and run the existing adapter/guard tests. |
| BND-G2 | Reuse skills/runtime and portfolio/accountable-owner. Preserve real User identity, creator-first behavior, portfolio/Foundation/organization/fallback order, null-owner parking and current review deduplication. Run affected resolver, shipping and pattern tests. |
| BND-G3 | Move attachment policy into agent-runtime ownership and supply MCP core-name metadata from outer composition. Repair both directions together. Preserve context/fidelity caps, required tools, load_tools reservation and authorized/deferred sets; run coworker-tool-budget and autonomous-run characterization. |
| BND-G4 | Move the single pure inference-failure classifier/type closure to inference ownership. Preserve matcher order, zero-tool rules, transient kinds and overflow exclusions; run inference-failure and scheduled-task-runs tests. |
| BND-G5 | Move one persisted work-pattern request parser/type contract below Build; promotion, scheduling and runtime reuse it. Preserve profile/oracle/resource/fixture identities, null-on-invalid behavior and actual result provenance; run runtime, scheduler, store and promotion tests. |
| BND-G6 | Move the one build-activity persistence function into Build and reuse it from MCP through the existing logger seam. Preserve event names, build identity, phase ordering and best-effort behavior; run transition characterization and single-path tests. |
| BND-G7 | Extract contributor-readiness facts below transport and keep its MCP probe outer. Supply thread creation, scoped token issuance and sandbox execution through owned application ports. Preserve caller/agent/thread identity, delegation/clearance, read-only scope narrowing, feature gates, limits and unconditional cleanup. |
| BND-G8 | Compose queue/resource capabilities outward: shared local-inference lock, sandbox telemetry and experiment enqueue. Preserve lock coverage across the whole CLI run, routing recheck after waiting, started/finished identity/durations and duplicate-free queue admission. |
| BND-G9 | Place deliberation, scheduled execution, legacy ingest and recurring-invoice operations in their actual application owners. Preserve cadence/acceptance leases, quiescence, task failure isolation, review authority, period idempotency and existing financial gates. Inspect legacy ingest consumers before retiring the shim. Finance boundedness is an explicit review point below. |
| BND-G10 | Move first-run/onboarding and Build model/execution composition outward, retaining existing canonical config readers and setup transactions. Verify first-run and model-routing behavior without activating a provider. |
| BND-G11 | Repair one inner screening-receipt contract closure across routing/inference before changing semantic-memory sensitivity reuse. Preserve development sensitivity, rawPayloadStored:false, payload hashes, current policy, transformations, sensitivity floors and fail-closed dispatch. Run provenance/drift and routed-screening tests. |
| BND-G12 | Keep one owned pure token estimator, cache protocol marker and inner activity-input contract. Preserve rounding, cache TTL/marker identity and required work-case facts. No generic shared bucket or duplicate constants. |
| BND-G13 | Move credential, sandbox, session and grant composition outward from routing through narrow capabilities. Preserve account/version binding, refresh, secret transport, actual grants and execution attribution. Run CLI, Codex and capability tests; no credential copying or provider activation. |
| BND-G14 | Move the canonical reconciliation error/predicate closure inward and retain retry orchestration outward. Keep one error identity and bounded retry behavior; run provider-reconciliation and first-boot tests. |

Flow BND-F1: characterize existing boundary; identify inner owner; move the canonical responsibility or add its typed port; compose effects outward; verify public behavior; prove the reverse import absent; remove its exact exception. Work on each coupled closure as a unit.

Flow BND-F2: after all groups, run the unchanged guard against the entire final tree before any full gate. A remaining violation is work to fix, not a reason to regenerate fresh exceptions. The registry's existing November 16 budget is retained; no claim is made that evidence remains current after a future budget or gate expiry.

## Exact initial edge inventory

Paths below are relative to `apps/web/lib`. Each source link binds the inspected commit. Recorded owner labels are context ownership, not proof that a particular principal approved retention.

| ID | File | Imported specifier | Target | Recorded context owner | Group | Presence | Source |
| --- | --- | --- | --- | --- | --- | --- | --- |
| BND-E01 | `actions/coworker-tool-budget.ts` | `@/lib/mcp/tool-tier` | mcp | web-application | BND-G3 | live | [L24](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/36b46866870694dab1763e691862da38dc577e76/apps/web/lib/actions/coworker-tool-budget.ts#L24) |
| BND-E02 | `actions/mcp-tokens.ts` | `@/lib/mcp/contributor-readiness` | mcp | web-application | BND-G7 | live | [L18](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/36b46866870694dab1763e691862da38dc577e76/apps/web/lib/actions/mcp-tokens.ts#L18) |
| BND-E03 | `build/build-orchestrator.ts` | `@/lib/actions/deliberation` | actions | integration-platform | BND-G9 | live | [L468](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/36b46866870694dab1763e691862da38dc577e76/apps/web/lib/build/build-orchestrator.ts#L468) |
| BND-E04 | `build/opencode-dispatch.ts` | `@/lib/queue/resource-lane` | queue | integration-platform | BND-G8 | live | [L45](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/36b46866870694dab1763e691862da38dc577e76/apps/web/lib/build/opencode-dispatch.ts#L45) |
| BND-E05 | `build/plan-to-build-transition.ts` | `@/lib/mcp/build-tool-helpers` | mcp | integration-platform | BND-G6 | live | [L41](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/36b46866870694dab1763e691862da38dc577e76/apps/web/lib/build/plan-to-build-transition.ts#L41) |
| BND-E06 | `build/sandbox/sandbox-pool.ts` | `@/lib/queue/queue-telemetry` | queue | integration-platform | BND-G8 | live | [L8](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/36b46866870694dab1763e691862da38dc577e76/apps/web/lib/build/sandbox/sandbox-pool.ts#L8) |
| BND-E07 | `build/ship-on-review-approval.ts` | `@/lib/queue/scheduled-owner` | queue | integration-platform | BND-G2 | live | [L499](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/36b46866870694dab1763e691862da38dc577e76/apps/web/lib/build/ship-on-review-approval.ts#L499) |
| BND-E08 | `inference/bootstrap-first-run.ts` | `../actions/setup-progress` | actions | ai-platform | BND-G10 | live | [L4](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/36b46866870694dab1763e691862da38dc577e76/apps/web/lib/inference/bootstrap-first-run.ts#L4) |
| BND-E09 | `inference/phase-model-resolution.ts` | `@/lib/build/build-studio-config` | build | ai-platform | BND-G10 | live | [L57](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/36b46866870694dab1763e691862da38dc577e76/apps/web/lib/inference/phase-model-resolution.ts#L57) |
| BND-E10 | `inference/phase-model-resolution.ts` | `@/lib/build/opencode-dispatch` | build | ai-platform | BND-G10 | live | [L62](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/36b46866870694dab1763e691862da38dc577e76/apps/web/lib/inference/phase-model-resolution.ts#L62) |
| BND-E11 | `inference/semantic-memory.ts` | `@/lib/tak/agent-sensitivity` | tak | ai-platform | BND-G11 | live | [L20](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/36b46866870694dab1763e691862da38dc577e76/apps/web/lib/inference/semantic-memory.ts#L20) |
| BND-E12 | `inference/utility-inference.ts` | `@/lib/tak/context-arbitrator` | tak | ai-platform | BND-G12 | live | [L8](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/36b46866870694dab1763e691862da38dc577e76/apps/web/lib/inference/utility-inference.ts#L8) |
| BND-E13 | `queue/functions/agent-task-dispatch.ts` | `@/lib/actions/agent-task-scheduler` | actions | runtime-execution | BND-G9 | live | [L91](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/36b46866870694dab1763e691862da38dc577e76/apps/web/lib/queue/functions/agent-task-dispatch.ts#L91) |
| BND-E14 | `queue/functions/hive-scout-ingest.ts` | `@/lib/actions/hive-scout/ingest-500-agents` | actions | runtime-execution | BND-G9 | live | [L3](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/36b46866870694dab1763e691862da38dc577e76/apps/web/lib/queue/functions/hive-scout-ingest.ts#L3) |
| BND-E15 | `queue/functions/recurring-invoice-dispatch.ts` | `@/lib/actions/recurring` | actions | runtime-execution | BND-G9 | live | [L24](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/36b46866870694dab1763e691862da38dc577e76/apps/web/lib/queue/functions/recurring-invoice-dispatch.ts#L24) |
| BND-E16 | `routing/activity-package.ts` | `@/lib/tak/work-pattern-types` | tak | ai-platform | BND-G12 | live | [L1](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/36b46866870694dab1763e691862da38dc577e76/apps/web/lib/routing/activity-package.ts#L1) |
| BND-E17 | `routing/anthropic-cache.ts` | `../tak/prompt-boundary` | tak | ai-platform | BND-G12 | live | [L30](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/36b46866870694dab1763e691862da38dc577e76/apps/web/lib/routing/anthropic-cache.ts#L30) |
| BND-E18 | `routing/chat-adapter.ts` | `@/lib/queue/resource-lane` | queue | ai-platform | BND-G1 | live | [L51](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/36b46866870694dab1763e691862da38dc577e76/apps/web/lib/routing/chat-adapter.ts#L51) |
| BND-E19 | `routing/cli-adapter.ts` | `@/lib/build/sandbox/agent-cli-runtime` | build | ai-platform | BND-G13 | live | [L28](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/36b46866870694dab1763e691862da38dc577e76/apps/web/lib/routing/cli-adapter.ts#L28) |
| BND-E20 | `routing/cli-adapter.ts` | `@/lib/inference/ai-provider-internals` | inference | ai-platform | BND-G13 | live | [L25](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/36b46866870694dab1763e691862da38dc577e76/apps/web/lib/routing/cli-adapter.ts#L25) |
| BND-E21 | `routing/cli-adapter.ts` | `@/lib/mcp/session-token` | mcp | ai-platform | BND-G13 | live | [L30](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/36b46866870694dab1763e691862da38dc577e76/apps/web/lib/routing/cli-adapter.ts#L30) |
| BND-E22 | `routing/cli-adapter.ts` | `@/lib/tak/agent-grants` | tak | ai-platform | BND-G13 | live | [L31](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/36b46866870694dab1763e691862da38dc577e76/apps/web/lib/routing/cli-adapter.ts#L31) |
| BND-E23 | `routing/codex-cli-adapter.ts` | `@/lib/inference/ai-provider-internals` | inference | ai-platform | BND-G13 | live | [L28](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/36b46866870694dab1763e691862da38dc577e76/apps/web/lib/routing/codex-cli-adapter.ts#L28) |
| BND-E24 | `routing/eval-runner.ts` | `@/lib/inference/ai-provider-internals` | inference | ai-platform | BND-G13 | live | [L7](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/36b46866870694dab1763e691862da38dc577e76/apps/web/lib/routing/eval-runner.ts#L7) |
| BND-E25 | `routing/fallback.ts` | `@/lib/inference/data-screening/screen-inference-payload` | inference | ai-platform | BND-G11 | live | [L53](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/36b46866870694dab1763e691862da38dc577e76/apps/web/lib/routing/fallback.ts#L53) |
| BND-E26 | `routing/fallback.ts` | `@/lib/inference/provider-reconciliation` | inference | ai-platform | BND-G14 | live | [L44](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/36b46866870694dab1763e691862da38dc577e76/apps/web/lib/routing/fallback.ts#L44) |
| BND-E27 | `routing/inference-dispatch-guard.ts` | `@/lib/inference/data-screening/types` | inference | ai-platform | BND-G11 | live | [L1](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/36b46866870694dab1763e691862da38dc577e76/apps/web/lib/routing/inference-dispatch-guard.ts#L1) |
| BND-E28 | `routing/task-dispatcher.ts` | `@/lib/inference/data-screening/screen-inference-payload` | inference | ai-platform | BND-G11 | live | [L25](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/36b46866870694dab1763e691862da38dc577e76/apps/web/lib/routing/task-dispatcher.ts#L25) |
| BND-E29 | `routing/task-router-types.ts` | `@/lib/inference/data-screening/types` | inference | ai-platform | BND-G11 | live | [L136](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/36b46866870694dab1763e691862da38dc577e76/apps/web/lib/routing/task-router-types.ts#L136) |
| BND-E30 | `routing/tool-fidelity-harness.ts` | `@/lib/tak/intent-taxonomy` | tak | ai-platform | BND-G1 | absent | [L1](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/36b46866870694dab1763e691862da38dc577e76/apps/web/lib/routing/tool-fidelity-harness.ts) |
| BND-E31 | `routing/types.ts` | `@/lib/inference/data-screening/types` | inference | ai-platform | BND-G11 | live | [L237](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/36b46866870694dab1763e691862da38dc577e76/apps/web/lib/routing/types.ts#L237) |
| BND-E32 | `tak/agent-routing-server.ts` | `@/lib/actions/agent-skills` | actions | agent-runtime | BND-G2 | live | [L12](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/36b46866870694dab1763e691862da38dc577e76/apps/web/lib/tak/agent-routing-server.ts#L12) |
| BND-E33 | `tak/autonomous-work-run.ts` | `@/lib/actions/coworker-tool-budget` | actions | agent-runtime | BND-G3 | live | [L311](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/36b46866870694dab1763e691862da38dc577e76/apps/web/lib/tak/autonomous-work-run.ts#L311) |
| BND-E34 | `tak/coworker-collaboration.ts` | `@/lib/actions/agent-coworker` | actions | agent-runtime | BND-G7 | live | [L23](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/36b46866870694dab1763e691862da38dc577e76/apps/web/lib/tak/coworker-collaboration.ts#L23) |
| BND-E35 | `tak/pattern-observer/periodic-review.ts` | `@/lib/queue/scheduled-owner` | queue | agent-runtime | BND-G2 | live | [L6](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/36b46866870694dab1763e691862da38dc577e76/apps/web/lib/tak/pattern-observer/periodic-review.ts#L6) |
| BND-E36 | `tak/scheduled-task-runs.ts` | `@/lib/build/inference-failure` | build | agent-runtime | BND-G4 | live | [L15](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/36b46866870694dab1763e691862da38dc577e76/apps/web/lib/tak/scheduled-task-runs.ts#L15) |
| BND-E37 | `tak/tool-script.ts` | `@/lib/build/sandbox/sandbox` | build | agent-runtime | BND-G7 | live | [L38](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/36b46866870694dab1763e691862da38dc577e76/apps/web/lib/tak/tool-script.ts#L38) |
| BND-E38 | `tak/tool-script.ts` | `@/lib/mcp/session-token` | mcp | agent-runtime | BND-G7 | live | [L37](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/36b46866870694dab1763e691862da38dc577e76/apps/web/lib/tak/tool-script.ts#L37) |
| BND-E39 | `tak/work-pattern-experiment-promotion.ts` | `@/lib/build/work-pattern-experiment-runtime` | build | agent-runtime | BND-G5 | live | [L6](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/36b46866870694dab1763e691862da38dc577e76/apps/web/lib/tak/work-pattern-experiment-promotion.ts#L6) |
| BND-E40 | `tak/work-pattern-experiment-scheduler.ts` | `@/lib/build/work-pattern-experiment-runtime` | build | agent-runtime | BND-G5 | live | [L7](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/36b46866870694dab1763e691862da38dc577e76/apps/web/lib/tak/work-pattern-experiment-scheduler.ts#L7) |
| BND-E41 | `tak/work-pattern-experiment-scheduler.ts` | `@/lib/queue/functions/work-pattern-experiment` | queue | agent-runtime | BND-G8 | live | [L8](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/36b46866870694dab1763e691862da38dc577e76/apps/web/lib/tak/work-pattern-experiment-scheduler.ts#L8) |
| BND-E42 | `tak/work-pattern-experiment-store.ts` | `@/lib/queue/scheduled-owner` | queue | agent-runtime | BND-G2 | live | [L3](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/36b46866870694dab1763e691862da38dc577e76/apps/web/lib/tak/work-pattern-experiment-store.ts#L3) |
| BND-E43 | `tak/work-pattern-profile-review.ts` | `@/lib/queue/scheduled-owner` | queue | agent-runtime | BND-G2 | live | [L251](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/36b46866870694dab1763e691862da38dc577e76/apps/web/lib/tak/work-pattern-profile-review.ts#L251) |

## Verification and limits

BND-V1: reproduce the initial failure from `scripts/application-boundaries.json` with the unchanged guard, distinguish expired registry reviews from a feature regression, then prove all initial exact keys absent after repair. Run `node --test scripts/check-application-boundaries.test.mjs` and `node scripts/check-application-boundaries.mjs`. Use the actual current date for the final result.

BND-V2: reuse affected existing characterization tests rather than tests that merely mirror imports. Confirmed starting files include `apps/web/lib/build/plan-to-build-transition.characterization.test.ts`, `apps/web/lib/build/opencode-dispatch-admission.test.ts`, `apps/web/lib/build/sandbox/sandbox-pool.test.ts`, `apps/web/lib/tak/scheduled-task-runs.test.ts`, `apps/web/lib/tak/tool-script.test.ts`, `apps/web/lib/mcp/contributor-readiness.test.ts` and `apps/web/lib/inference/data-screening/screen-receipt-provenance.test.ts`. Exact claimed-path impact contracts expand this set before implementation.

BND-V3: check type compatibility in both affected packages and use the repository's normal exact-tree integration gate. Do not repeat an unchanged full gate while the named guard still fails. Runtime-bound checks use ordinary shared admission and retain actual command/cleanup outcomes.

BND-V4: record immutable source review, normal DCO publication, protected CI and containing merge. Notify existing feature owners; no competing publisher or install advance is part of this item.

Scale and data architecture: the initial inventory is a finite 43-key set. This design adds no polling, query fan-out, subscription, collection, table or cache. Existing dispatch lane limits, review windows, output/time caps and admission remain unchanged. `actions/recurring.ts:151` currently loads all due schedules; this is a pre-existing scalability finding, not a proven bounded reader. Before approving BND-G9, identify and reuse the canonical Finance canary's bounded operation or explicitly resolve that dependency in the same design review; do not introduce a second finance worker or silently claim the scan is bounded.

Desktop web is the campaign target. No extra narrow-browser matrix is required. Native iOS is separate: assess applicability from the actual changed backend contract and record native evidence if affected or a reasoned not-applicable conclusion otherwise. Neither narrow web checks nor typechecks count as native iOS validation.

No functional checks, new exact-tree gate, source repair or review result are claimed by this proposed document. Current source-edit scope is this document only. Its resolved impact contract has no testImpact/guardObligation rows and requires doc-index regeneration/check when publishing. Source-code scope claims and their impact contracts are still owed.

## Delivery boundary, coverage and rollback

The proposed atomic outcome is restoration of the one unchanged publication guard. Partial groups leave other expired entries failing, so they do not independently restore publication. The ordered groups are internal sequencing, with final cross-context identity and policy checks before one protected change. If review establishes an independently shippable deliverable, reuse its live existing owner/item or record decomposition before implementation; do not hide independent work in this document.

Live plan coverage is NOT recorded. This draft must receive the independent scope/architecture decisions required by its actual shape, then immutable coverage must bind BND-C1 through BND-C4, flows BND-F1/BND-F2 and verification BND-V1 through BND-V4 to BI-9BEB3D56 and AC-BND-001 through AC-BND-006. A Markdown assertion is not a coverage receipt.

Rollback uses a normal protected revert of the source change; it does not rewrite history or replay work. Reverting code that restores a forbidden import must preserve the guard's truthful failure until an accountable disposition is actually approved. No automatic re-addition of fresh exceptions or expiry dates is permitted.

Existing f71 source-reference, scorecard and wording repairs remain with their original owners. This item does not absorb their acceptance criteria, the broad 23-behavior consolidation, the original seven-scenario conjunction, Critic fulfillment or E27 original-review settlement.
