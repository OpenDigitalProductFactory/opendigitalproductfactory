---
status: active
backlogItem: BI-6A5AB570
workroom: WC-CE5EB2E7
design: docs/superpowers/specs/2026-08-25-immutable-gate-single-flight-design.md
dependsOn: BI-B2E9FC9D
---

# Immutable Gate Single-Flight Implementation Plan

## Outcome

Coalesce equivalent local-CI and semantic-review requests around one
server-derived immutable identity. Reuse valid pass/fail receipts and prevent a
subscriber from starting, renewing, releasing, or completing the canonical
executor's work.

Implementation begins after `BI-B2E9FC9D` / PR #4647 is in the branch baseline
because its authoritative evidence-plan digest is an input to `gateKey`.

## Delivery contract

This is one atomic medium slice. Local CI and semantic review must ship together
because `REQ-SF-4` promises one cross-surface identity contract. Shipping only
one adapter would leave callers with two definitions of equivalent immutable
work.

| Requirement | Flow | Verification |
| --- | --- | --- |
| `REQ-SF-1`, `REQ-SF-2` | Claim → admit/queue or subscribe | `VC-SF-1`, `VC-SF-5` |
| `REQ-SF-3` | Claim → resolve linked terminal evidence → reuse | `VC-SF-2`, `VC-SF-3`, `VC-SF-6` |
| `REQ-SF-4` | Normalize components → derive server key | `VC-SF-4`, `VC-SF-7` |
| `REQ-SF-5` | Execute → record → bind evidence → emit metric | `VC-SF-8` |
| `REQ-SF-6` | New tree → distinct key → bounded supersession | `VC-SF-7` |

## Phase 1: baseline and identity contract

1. Merge or rebase the protected #4647 result and confirm the evidence planner
   exposes the integration tree, `planDigest`, and toolchain fingerprint before
   lease admission.
2. Add a pure server helper for component validation, canonical JSON, semantic
   review component mapping, and SHA-256 `gateKey` derivation.
3. Write failing unit tests for stable normalization, component drift, invalid
   hashes, closed gate kinds, and semantic-review mapping.
4. Keep the helper independent of Prisma, MCP, and Build Studio.

Expected files:

- `apps/web/lib/gates/gate-run-identity.ts`
- `apps/web/lib/gates/gate-run-identity.test.ts`

## Phase 2: local-CI single-flight

1. Extend the nonproduction claim input with validated gate identity
   components. The server derives `gateKey`; legacy `claimKey` remains only for
   non-gate callers and compatibility tests.
2. Change cross-owner matching claims from `owner_mismatch` to a read-shaped
   `subscribed` disposition. Do not refresh their TTL or owner heartbeat.
3. Preserve the unique-claim transaction and FIFO reconciliation. Add a race
   test proving one lease row under parallel claims.
4. Extend local-integration result recording with `gateKey`; validate executor
   session and bind the created evidence id to the canonical lease.
5. Return `reused` only for linked, valid pass/fail evidence. Return `blocked`
   for missing, inconclusive, expired, or mismatched evidence.
6. Update `gate-worktree` to send the evidence-plan/toolchain identity, execute
   only when it owns `admitted`, observe when `subscribed`, and stop without
   recomputation when `reused`.
7. Remove the caller session from base execution identity. Keep it only in
   attribution and executor authority.

Expected files:

- `apps/web/lib/nonprod/environment-lease.ts`
- `apps/web/lib/nonprod/environment-lease.test.ts`
- `apps/web/lib/nonprod/environment-lease.pg.test.ts`
- `apps/web/lib/nonprod/local-integration.ts`
- `apps/web/lib/nonprod/local-integration.test.ts`
- `apps/web/lib/mcp/packs/nonprod-lease-pack.ts`
- `apps/web/lib/mcp/packs/nonprod-lease-pack.dispatch.test.ts`
- `apps/web/lib/mcp/packs/build-evidence-pack.ts`
- `apps/web/lib/mcp/packs/build-evidence-pack.test.ts`
- `scripts/gate-worktree.mjs`
- `scripts/gate-worktree-lease.test.mjs`

## Phase 3: semantic-review single-flight

1. Add a persistence adapter that uses `TaskRun` as the existing in-flight
   execution record. Use `repeatedPatternKey=gate:<gateKey>` and deterministic
   per-attempt `taskRunId` values.
2. Query only a bounded recent attempt set. A terminal receipt id is read from
   `progressPayload` and revalidated with the existing receipt-freshness
   function.
3. Create the first attempt transactionally. On unique conflict, read the
   winner and return `subscribed`.
4. Let only the creator call the pure `runSemanticChangeReview` operation.
5. Complete the TaskRun after the existing ExternalEvidenceRecord and Workroom
   activity writes succeed. Store the evidence id, gate key, disposition, and
   result class in the task payload.
6. Route both the MCP `review_semantic_change` adapter and Build Studio assembled
   change review through this coordinator. Preserve their current user-facing
   pass/fail semantics.
7. Treat infrastructure-inconclusive output as retryable; reuse semantic pass
   and fail while identity is fresh.

Expected files:

- `apps/web/lib/change-review/semantic-review-single-flight.ts`
- `apps/web/lib/change-review/semantic-review-single-flight.test.ts`
- `apps/web/lib/change-review/semantic-change-review.ts`
- `apps/web/lib/change-review/semantic-change-review.test.ts`
- `apps/web/lib/change-review/build-studio-semantic-review.ts`
- `apps/web/lib/change-review/build-studio-semantic-review.test.ts`
- `apps/web/lib/mcp/packs/change-review-pack.ts`
- `apps/web/lib/mcp/packs/change-review-pack.test.ts`

## Phase 4: telemetry, docs, and compatibility

1. Add low-cardinality counters for `admitted`, `queued`, `subscribed`,
   `reused`, and `blocked`, split only by gate kind and result class.
2. Include the exact `gateKey` and canonical task/lease/evidence refs in
   structured activity and evidence payloads.
3. Update the pre-PR gate guide with subscriber/reuse behavior and the explicit
   boundary between this slice and durable wait/resume.
4. Regenerate the documentation index required by the change-impact contract.
5. Retain compatibility for preview leases and non-gate callers that use a
   caller-provided claim key.

Expected files:

- `apps/web/lib/operate/metrics.ts`
- `docs/testing/pre-pr-gate.md`
- `apps/web/lib/docs/doc-index.generated.json`

## TDD sequence

1. Red: identity test for deterministic key and per-component drift.
2. Green: pure server identity helper.
3. Red: parallel lease claims from different owners expect one executor and
   subscribers.
4. Green: transactional lease projection and MCP response.
5. Red: result binding and terminal pass/fail reuse.
6. Green: evidence link and gate-worktree reuse path.
7. Red: concurrent semantic-review requests expect one TaskRun/dispatch.
8. Green: TaskRun coordinator and both adapters.
9. Red: authority tests prove subscribers cannot renew/release/record.
10. Green: enforce executor checks and bounded telemetry.
11. Refactor only after all focused tests are green.

## Verification

Focused tests:

```text
pnpm --filter web test --run lib/gates/gate-run-identity.test.ts
pnpm --filter web test --run lib/nonprod/environment-lease.test.ts
pnpm --filter web test --run lib/nonprod/local-integration.test.ts
pnpm --filter web test --run lib/change-review/semantic-review-single-flight.test.ts
pnpm --filter web test --run lib/mcp/packs/nonprod-lease-pack.dispatch.test.ts
pnpm --filter web test --run lib/mcp/packs/change-review-pack.test.ts
node --test scripts/gate-worktree-lease.test.mjs
```

Functional verification:

- Run the Postgres claim race test when the governed test database is
  available.
- Run web typecheck and all affected unit suites.
- Run `pnpm run pregate:preflight`.
- Preserve GitHub CI as the publication authority if the internal semantic
  review or local pregate control plane remains unavailable.
- Inspect PR review findings and required checks before merge.

## Migration, UX, and rollback

- Migration: not applicable; no schema change.
- UX: no route or component changes. MCP responses become more actionable by
  naming `subscribed` and `reused` states.
- Rollback: stop sending gate identity components and restore the legacy
  caller claim key. Existing leases, TaskRuns, and evidence remain readable.
- Data cleanup: none. Completed evidence is immutable and terminal coordination
  rows remain audit history.

## Handoff evidence

The final PR must include:

- immutable design and plan blob ids;
- focused test commands and results;
- concurrency race evidence;
- exact branch/head/base identity;
- migration and UX dispositions;
- PR URL and GitHub required-check result.
