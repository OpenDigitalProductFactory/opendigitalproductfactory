# Workroom-bound toolset implementation plan

BI-687E7D81 · WC-EA8680B0 · Approved scope baseline `baseline-0ade529a-9401-47ad-b22b-48b0c082e6b9`

Implements the [Workroom-bound toolset design](../specs/2026-11-25-workroom-bound-toolset-design.md), approved at `e1801fbdb6ff31c3e82ff9108a5e55c5a0f2b7e9`. This file does not authorize implementation. Start code only after independent plan approval and the implementation claim.

## Backlog coverage

**Atomic delivery, `s5-bound-toolset` → BI-687E7D81.** The declaration, composition, enforcement and launch restrictions are internal phases of one independently reviewable change. None alone delivers a safe workroom-bound coding session. Source may be exercised in the shared verification profile, but deployment cannot expose the new launch mode until all its fences are present. There is no partial activation via the legacy broad token. Record immutable coverage and review evidence on WC-EA8680B0 against this plan blob.

| Requirements | Contracts | Flow | Verification |
| --- | --- | --- | --- |
| OBJ-S5-REGISTRY, AC-1 | CT-S5-REGISTRY | FL-S5-CLASSIFY | V-S5-REGISTRY |
| OBJ-S5-AUTHORITY, AC-2, AC-5 | CT-S5-COMPOSITION | FL-S5-ADMIT | V-S5-INTERSECTION |
| OBJ-S5-BOUNDARY, AC-3, AC-5 | CT-S5-BROKER | FL-S5-INVOKE | V-S5-JOINED |
| OBJ-S5-LIFECYCLE, AC-4, AC-5 | CT-S5-RELEASE | FL-S5-RELEASE | V-S5-REVOKE |
| OBJ-S5-HOOKS, AC-5 | CT-S5-HOOKS | FL-S5-VERIFY | V-S5-HOOKS |

### Dependencies already tracked outside S5

| Live item | Owner boundary | Proof required before qualified rollout |
| --- | --- | --- |
| BI-6DB95601 | Canonical TAK-JSI issuance/binding after assessment and material-change revalidation. It must provide or name the canonical persisted issuer, not ask S5 to add a private qualification ledger. | Resolve a current record for each pilot subject keyed to GAID, job/profile version, activity, data/risk scope and deployment context. Show missing, stale and changed evidence narrowing or refusing. No such persisted producer was found in the current checkout. |
| BI-B62B218E | Room engine admits the assigned member and owns dispatch/release. | Same launch path receives two independently active assignments and stops the released member without a client callback. |
| BI-5A866218 | DPF owns host identity/routing and downstream narrowing. DPF2 enforces its native-tool boundary from DPF's launch projection. | The joined path consumes the compatible projection, verifies its host/worktree binding and fails closed if it cannot enforce the mode. |
| BI-75AB446B | Existing descriptive T3 thread binding. | Regression: harness metadata still identifies the thread and grants no authority. |

These dependencies do not gate development or defensive fixture tests of the producer. A fixture satisfying a typed qualification input does not demonstrate a deployed credential. Keep qualified launch unavailable until all producer and host evidence is recorded. Do not mark AC-5 complete based on no-scheme or fixture-only operation.

## Phase 1 · Registry contract and tests first

**CT-S5-REGISTRY / FL-S5-CLASSIFY / V-S5-REGISTRY.** Start with a negative type fixture and a complete pack/dynamic-ingress test. Use `apps/web/lib/mcp-tool-types.ts`, `apps/web/lib/mcp/tool-registry.ts`, `apps/web/lib/mcp/packs/`, and the existing DPF external-tool policy ingress. Add one mandatory DPF-owned access declaration per static entry. Types, packs, synthetic entries and aliases must agree. Unknown or undeclared dynamic access fails closed, and a mixed-action tool is classified conservatively or has a typed per-action declaration. Do not infer access from side-effect hints. Verify typecheck rejects missing classifications and that registry/list/call parity tests fail on missing, broadened and disallowed access. Preserve existing PAT, OAuth and restricted task-JWT behavior.

## Phase 2 · One composition producer

**CT-S5-COMPOSITION / FL-S5-ADMIT / V-S5-INTERSECTION.** Depend on phase 1. Use `apps/web/lib/work-management/coordinator-eligibility.ts`, `apps/web/lib/work-management/workroom-agent-access.server.ts`, `apps/web/lib/workroom-runtime/supervisor.ts`, and the existing authority binding and subject tables. Add a single composition module at the Workroom runtime boundary. Take a persisted stage assignment, inspect the current subject's binding and JSI evidence through the shared resolver, and intersect job, stage, live authority, registry and runtime mode. Use `getAgentGaidMap` from `apps/web/lib/identity/principal-linking.ts` without editing its source, signature or map shape. Start with failing tests for two jobs in the same stage, missing GAID, binding pinned to the wrong subject, no scheme vs. disqualified vs. unavailable, changed binding/qualification, and no widening by forwarding. Per-coworker set differences must arise from inputs, not a coordinator exception. Publish a versioned projection schema for DPF2 and a compatibility fixture. No T3 or DPF2 code in this worktree.

## Phase 3 · Mint, invoke and release with a live fence

**CT-S5-BROKER / FL-S5-INVOKE / CT-S5-RELEASE / FL-S5-RELEASE / V-S5-REVOKE.** Depend on phases 1–2. Use `apps/web/lib/auth/workroom-session-token.ts`, `apps/web/lib/mcp/transport-auth.ts`, `apps/web/app/api/mcp/v1/route.ts`, and the existing supervised session and durable worker in `apps/web/lib/workroom-runtime/`. Persist a versioned, runtime-validated room-only JSON authorization projection on the existing `McpApiToken` row in `packages/db/prisma/schema/core-identity.prisma`. Reuse the token's `authorityBindingId`, audience, hashed secret, room/run, dates and revocation. The projection records the exact admission/attempt and issuance bound, with immutable references rather than copying current job or qualification records. An additive nullable migration is backward compatible for unrelated tokens. Enable scoped issuance only after migration and old governed session drain. An old row with no projection is not a scoped credential. Data review the migration and classification before deployment.

Extract the shared server policy from the route, so the route only applies it to each relevant method. Reuse the exact tool-surface type where appropriate without changing JWT meaning. Stop at the correct resource after resolving implicit, nested and opaque identifiers. Revalidate at approved/deferred effect admission, subscription delivery, and before starting native broker effects. Use an exact attempt/epoch fence, with release linearizing before any newly accepted effect. Preserve GPP and required approvals. If a method lacks a complete target check it remains unavailable. Write route and durable supervisor tests first for stale stage, stage round trip, revoked/re-admitted member, foreign room, lost link, sibling isolation, failed start, late effect, reconnect, revoked subscriptions and timeout. Test that every denial is before handler or effect execution.

The trusted launcher exposes only source read/search, worktree-bounded editing, constrained test profiles, governed gate/evidence/PR, and admitted room operations. Launch with no passthrough shell or owner credential. Run mutable repository code in the constrained test worker without shared service sockets, host credentials or arbitrary egress. Check both supported provider adapters through the same launch contract. Do not enable an adapter that cannot actually enforce the profile. BI-5A866218 owns deployed host routing and DPF2 integration, not the DPF server decision.

## Phase 4 · Governed verification and convergence

**CT-S5-HOOKS / FL-S5-VERIFY / V-S5-JOINED / V-S5-HOOKS.** Complete phases 1–3 locally, then use the shared governed runtime and representative execution host. Show two distinct GAIDs and job qualifications, the same workroom and launch path, differing tool lists and allowed calls. With all client hooks disabled, capture four distinct server refusal receipts for out-of-job, stale stage, revoked member and cross-room. Match all 35 design matrix rows by event, matcher and command multiplicity, placing hook-free receipts or diagnostics beside the owning component. Do not retire any external hook until that specific path passes. Repeat positive flow at the configured host admission limit and confirm no room-wide authorization scan on call. Record tests by target and SHA. Roll back by stopping scoped launches, revoking affected sessions and retaining external hooks. Do not restore a broad token.

Before Red, expand Workroom edit claims only to the exact files the implementation needs. Resolve the two existing test-impact rows with related/colocated tests for the MCP route and token module. Include route OAuth/resources/write-safety/permit-meta/disclosure tests, token lifecycle tests, restricted-session tests and the runtime-supervisor durable/Postgres suites. Add qualification and browser-free joined-path coverage where no existing suite exercises the contract. Run package typecheck and current guard context, including prose-lint and style-drift obligations. Regenerate or verify doc-index, doc-impact and route-derived artifacts selected by the contract. Update `docs/architecture/ai-agent-meta-model.md` and `docs/architecture/mcp-tool-authorization-runbook.md`. Include reviewed data-impact and convergence evidence for the migration. Use the canonical documentation/runtime gates according to changed substrate, request semantic review from the Workroom on the exact signed implementation commit, and publish through the protected lane.
