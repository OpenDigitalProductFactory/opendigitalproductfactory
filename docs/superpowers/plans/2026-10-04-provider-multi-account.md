# Provider multi-account delivery plan

Independent design/spec and architecture approval passed. Live coverage and plan review remain pending; implementation prohibited until those gates pass.

Umbrella BI-71ABBD95; Workroom WC-B617B5DD. Canonical [design](../specs/2026-10-04-provider-multi-account-design.md) and [interactive prototype](../specs/2026-10-04-provider-multi-account-prototype.html).

For agentic workers: execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use dpf-tdd for red-green implementation, dpf-local-merge-ci-before-push plus the plan's completion gate before any success claim, and dpf-pr-with-dco for handoff.

## Backlog coverage

Decision: decomposed. Live children and approved parent scope baseline exist; the governed coverage receipt remains pending. No coverage receipt is claimed by this document. Research receipt: initiative-07b8ef54-dd47-408b-8ce4-988eee5dc195. Design receipt: initiative-aa109bd6-77db-401c-8aad-92e1e27650e9. Spec approval: initiative-c2f0c407-8a5e-463a-8561-bebedafbb3a1. Architecture review: initiative-379c6cf3-62fb-4097-8f0c-7da225b31d3d.

| Deliverable | Live BI | Depends on | Requirements | Contracts | Flow | Verification |
| --- | --- | --- | --- | --- | --- | --- |
| Account identity/authentication foundation | BI-1914A351 | None | OBJ-ACCOUNTS, OBJ-CONVERGENCE | AiProviderConnection, CredentialEntry, encrypted secret boundary | Add account → authenticate → discover → reconnect | AC-IDENTITY, AC-MIGRATION: Two-account auth isolation, migration fixtures, affected unit tests/typechecks |
| Account capacity/execution routing | BI-385C0357 | BI-1914A351 | OBJ-ROUTING | ProviderCapacityStatus, CliPoolStatus, provider-suitability compiler, execution adapter | Filter eligible account/model → reserve capacity → execute → checkpoint retry | AC-QUOTA, AC-SUITABILITY, AC-CONTINUITY: Shared-pool quota, concurrent API/CLI identity, suitability negatives, side-effect replay fixtures |
| Compact provider UX / complete disclosure | BI-7AA4EB6B | BI-1914A351, BI-385C0357 | OBJ-UX, OBJ-CONVERGENCE | Shared account projection, authorized surface/governed actions, report-kit density | Setup/catalog → account row → account disclosure → action → rehydrate | AC-DISCLOSURE, AC-PRESERVATION, AC-REFACTOR: Preservation matrix, keyboard/light/dark/narrow served tests, measured UX-fit |

Each boundary is separately shippable: foundation retains legacy defaults; routing can activate only for proven channels; UI consumes completed account facts without owning selection policy. Refactoring is concentrated in these contracts, with caller migration and deletion of redundant singleton paths rather than unrelated cleanup.

## Phase 0: design and scope baseline

1. Push DCO-signed design/prototype/plan draft to the work branch. Bind exact branch/head through external evidence.
2. Record research and route server-issued design-spec, spec-approval and architecture-review packets to eligible independent coworkers; resolve findings against immutable source.
3. Mint parent scope baseline and record schema-v2 decomposed plan coverage mapping all live children above. Copy valid receipt identity into this section. Do not replace approval with author-only prototype review.
4. Before each child, bind its own branch/worktree/Workroom and exact edit scope. Consume verificationState.changeImpactContract and add all testImpact/guardObligations. If unresolved, use exhaustive affected package verification and resolve impact explicitly.

## Phase 1: account identity and authentication foundation

Touched owners: packages/db/prisma/schema/ai-providers.prisma, integrations.prisma and migrations; apps/web/lib/inference/ai-provider-data.ts, ai-provider-internals.ts and their actual callers; existing provider connection/auth/OAuth actions and governed tool contracts; finance and usage owners discovered by caller inventory.

Inventory provider-keyed credential findUnique/upsert/token caches/callbacks and every default-connection assumption before edits. Add account identity to canonical action arguments and refresh/discovery paths. Preserve provider-only calls strictly as default compatibility. Expand schema with nullable/additive fields, inline safe backfill and indexes, then regenerate Prisma/data-impact manifests and review classifications/retention. Do not contract constraints until caller compatibility is complete. API action rights remain manage_provider_connections.

Verify two same-provider accounts cannot share callback state, cached refresh token, status or discovery entitlements accidentally. Test cross-account callback rejection, reconnect, disabled accounts, existing credential defaults and partial migration state. Confirm masked projections contain no secrets. Run affected db/web unit and typecheck gates; apply migrations against governed local-CI fixtures. Rollback: default-only execution with added rows retained.

## Phase 2: capacity, candidate selection and execution

Touched owners: apps/web/lib/routing/provider-capacity/store.ts, cli-pool-status.ts, weekly-quota.ts, provider-routing-eligibility.ts, provider-suitability/compile.ts and types, the canonical routeAndCall/dispatch and CLI adapter callers found by inventory, attempt/usage attribution owners.

Separate provider outage, account authentication and upstream quota-pool state. Extend existing capacity projection, not a UI-only estimate. Compile account/model candidates from existing suitability and model profiles; filter sensitivity/workload/region/evidence/context/tools/capability before ranking quota/budget. Preserve provider-level profile sharing with account entitlements. Add soft task affinity and explain selections through durable attempt evidence.

Prove isolated auth homes/profile selection for each supported CLI adapter; unsupported isolation is explicit and excluded from pooled dispatch. Checkpoint only where adapter replay is safe, retaining action identities. Verify concurrent account execution, shared-key pool exhaustion, account cooldown vs provider outage, expired evidence, capabilities/context mismatches, unknown quota and ambiguous side-effect retries. Run source gates and shared served execution tests. Rollback: default candidate, no destruction of account/pool history.

## Phase 3: compact UX and preservation

Touched owners: apps/web/app/(shell)/platform/ai/providers/page.tsx and [providerId]/page.tsx; existing provider components under apps/web/components; inference account read model; authorized surface projector; existing install setup-state owner; navigation/report-kit only where required.

First enumerate component fields/actions/warnings/permissions and routes in a preservation matrix using the design's table. Add regression checks for actual destination rendering and action rights. Convert singleton detail loading to explicit account selection with stable default deep links. Shared projection supplies auth, clearance/workload, accessible models/capabilities, capacity/reset/provenance and actionable problems.

Build configured-provider/account rows with compact density. Retain Local and disabled/disconnected/waiting/exhausted accounts. Add provider opens searchable catalog; Add account preselects provider. Persist initial setup completion independently from account count in the existing setup owner. Move detail groups intact before consolidating duplicates; keep critical errors and clearance visible. Retain global budgets, local-only policy, scheduled maintenance, finance distinctions, model dimensions, local management, recipes, phase resolver and service-specific controls.

Exercise read-only/write principals and old deep links. On governed served target verify initial setup, local-only completion, add/reconnect/disable account, model selection and all disclosure destinations; keyboard/focus/light/dark/narrow layouts with measured route-budget UX evidence. A preservation matrix entry without functional evidence blocks completion.

## Completion gate

Each child ships through a DCO-signed non-draft PR only after required local source tests/typecheck and shared local-CI evidence. Run gate:context on the actual diff and include process/design/docs/data-impact/UX/convergence evidence it requires. Resolve all review threads and verify pr:health. No hand-built runtime, manual image tag or install-file edits. Use self-upgrade for live deployment and record exact canonical evidence. No completion claim until every acceptance item has durable proof or the server's established deployment closure applies with remaining acceptance obligations recorded truthfully.

## Risks and rollback

Cross-account credential resolution is the highest risk; forbid ambiguous lookup. Shared quota uncertainty is conservative. Regional/business evidence must not transfer with provider metadata. Existing singleton callers can globally disable accounts; inventory plus isolation tests guard them. Disclosure can hide urgent failures; visible-warning assertions and preservation matrix guard that.

Use additive migrations and default compatibility; disable extra candidates to roll back runtime selection while preserving new records. Do not rewrite historical usage evidence or delete credentials. Migration contraction is a later compatibility decision. Source-only readiness is not a passing verification result.
