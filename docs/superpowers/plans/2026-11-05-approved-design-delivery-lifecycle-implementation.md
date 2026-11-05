---
status: proposed
---

# Approved Design Delivery Lifecycle Implementation Plan

- **Backlog item:** BI-AADDF8C1
- **Epic:** EP-129D11FD
- **Workroom:** WC-9765090A
- **Design:** `docs/superpowers/specs/2026-08-23-approved-design-delivery-lifecycle-design.md`
- **Kernel decision:** DI-5F1916D158B6
- **Delivery graph:** atomic

**For agentic workers:** execute this plan one independently reviewable backlog
item at a time—one BI, one branch, one PR. Use `dpf-tdd` for red-green
implementation, `dpf-local-merge-ci-before-push` plus this plan's completion
gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Atomic rationale

This BI has one independently shippable platform concern: a preservation
boundary that remains truthful across delivery, projection, cleanup, and
recovery. A relation without cleanup protection can still lose the only approved
branch; a badge without recovery can advertise state that installation loss
erases; recovery without the writer can preserve fabricated facts. These seams
must land together. Future design documents and their successor implementations
are separate BIs created by this feature, not child deliverables of this build.

## Requirement and evidence map

| Requirement | Contract refs | Flow refs | Verification refs |
| --- | --- | --- | --- |
| R-ADL-001 provider-verified document delivery | AC-ADL-001, AC-ADL-002 | F-ADL-001 | V-ADL-001, V-ADL-002 |
| R-ADL-002 successor lifecycle projection | AC-ADL-003, AC-ADL-004 | F-ADL-002 | V-ADL-003, V-ADL-004 |
| R-ADL-003 cleanup protection | AC-ADL-005 | F-ADL-003 | V-ADL-005, V-ADL-006 |
| R-ADL-004 recovery after origin deletion | AC-ADL-006 | F-ADL-004 | V-ADL-007 |
| R-ADL-005 cross-surface governed process | AC-ADL-007 | F-ADL-005 | V-ADL-008 |
| R-ADL-006 touched-seam consolidation | AC-ADL-008 | F-ADL-001, F-ADL-002, F-ADL-003, F-ADL-004, F-ADL-005 | V-ADL-009 |

## Flow definitions

**F-ADL-001 — prepare and finalize.** Resolve two BIs, Workroom source, current
baseline, independent approval, retention pin, and provider facts; write one
durable relation and paired audit activities transactionally; make retries
idempotent and conflicts explicit.

**F-ADL-002 — discover.** Project the relation once and expose it through MCP
and the portal beside ordinary scheduling status.

**F-ADL-003 — protect.** Resolve prepared undelivered branches once and feed the
same typed set to the Workroom reaper, worktree classifier, and branch deletion.

**F-ADL-004 — recover.** Capture the durable relation and supporting approved
design chain; remove origin records; reconcile and query the successor.

**F-ADL-005 — converge surfaces.** Publish one MCP contract and one portal
adapter; verify definitions and grants for every supported executor.

## Phase 1 — durable model and pure projector

1. RED: schema/contract tests for the retained `ApprovedDesignDelivery`
   relation, distinct BIs, unique successor, delivered field set, restricted
   evidence deletion, and fleet-safe migration.
2. Add the Prisma model and expand-only migration with explicit data-safety
   attestation; no backfill exists because no live record exists yet.
3. RED: pure projector tests for prepared, delivered, implemented, malformed,
   and conflict states.
4. Implement one dependency-free projector and public result type.

Paths: `packages/db/prisma/schema/work-coordination.prisma`,
`packages/db/prisma/migrations/<timestamp>_approved_design_delivery/migration.sql`,
`packages/db/src/initiative-readiness-schema.test.ts`, and
`apps/web/lib/backlog/approved-design-delivery{,.test}.ts`.

Verification: V-ADL-002, V-ADL-003 and affected schema guards.

## Phase 2 — governed writer and MCP contract

1. RED: repository tests for prepare/finalize success, restored finalization
   without a Workroom row, idempotency, atomicity, and every F-ADL-001 denial.
2. Refactor repository artifact/provider compare logic behind a narrow injectable
   adapter instead of reimplementing GitHub reads.
3. Implement the transactional writer using baseline, receipt, pin, Workroom,
   docs-only classifier, and provider facts.
4. Add `record_approved_design_delivery` to the backlog pack and shared grants;
   expose identical definitions to all executor kinds.

Paths: `apps/web/lib/backlog/approved-design-delivery-repository{,.test}.ts`,
`apps/web/lib/mcp/packs/backlog-pack.ts`, and focused definition/grant tests.

Verification: V-ADL-001, V-ADL-002, V-ADL-008.

## Phase 3 — backlog read projection and operator UI

1. RED: list/get backlog tests require the same structured projection.
2. Extend loaders with a batched relation query; no N+1 reads.
3. RED: component tests require operator label, ordinary status, accessible next
   action, and labeled evidence disclosure.
4. Implement a compact theme-aware badge/disclosure in the existing ops backlog
   row; add no route or workflow control.
5. Exercise desktop 1280x900 and mobile 390x844, light and dark.

Paths: `apps/web/lib/mcp/packs/backlog-pack-read-tools.ts`,
`apps/web/lib/explore/backlog-data.ts`,
`apps/web/components/ops/BacklogItemRow.tsx`, and focused tests.

Verification: V-ADL-003, V-ADL-004 and UX-fit evidence.

## Phase 4 — cleanup enforcement

1. RED: protection resolver selects only prepared/undelivered records.
2. RED: Workroom reaper keeps a protected room.
3. RED: worktree janitor returns KEEP before stale tiers and fails closed when
   unmerged protection inventory is unknown.
4. Implement one resolver/inventory; adapt both cleanup systems. Never
   manufacture `.worktree-pinned`.

Paths: `apps/web/lib/backlog/approved-design-protection.ts`,
`apps/web/lib/work-capsules/liveness-inventory.ts`,
`apps/web/lib/work-capsules/work-capsule-reaper.ts`,
`scripts/lib/worktree-janitor-core.mjs`, and `scripts/worktree-janitor.mjs`.

Verification: V-ADL-005, V-ADL-006.

## Phase 5 — recovery and doctrine

1. RED: recovery fixture with done design, unfinished successor, relation,
   approval/baseline evidence, and origin records.
2. Capture without `--all`; remove Workroom/client-task/worktree fixture rows;
   reconcile into an empty store; query through the shared projector.
3. Extend schema and ordering without changing unfinished-item count.
4. Update planning/finishing skills and recovery/contributor doctrine only at
   the split point.
5. Add definition/grant/result fixtures for Codex, Claude, Grok, Antigravity,
   and portal callers.

Paths: `packages/db/src/backlog-recovery-bundle.ts`,
`packages/db/scripts/capture-backlog-bundle.ts`,
`packages/db/test/backlog-recovery-{bundle,capture}.test.ts`,
`packages/db/recovery/backlog/README.md`, architecture runbooks, and existing
DPF planning/finishing skills.

Verification: V-ADL-007, V-ADL-008.

## Phase 6 — governed completion

1. Run every focused suite and affected package typecheck from this exact
   compile-ready worktree.
2. Run `pnpm gate:context` and satisfy its impact contract.
3. Run blast-radius review and full local merged-code gate.
4. Use a governed nonproduction lease for portal verification; capture
   desktop/mobile and light/dark evidence.
5. Commit with DCO, record independent semantic review, push, open one regular
   non-draft PR, and wait for `pnpm pr:health` to prove every check and review
   thread is terminal.

## Verification catalog

- **V-ADL-001:** provider/writer rejection matrix.
- **V-ADL-002:** transaction, idempotency, and immutable-link assertions.
- **V-ADL-003:** pure lifecycle projection and conflict diagnostics.
- **V-ADL-004:** MCP/UI parity and accessible operator text.
- **V-ADL-005:** janitor classification and branch deletion protection.
- **V-ADL-006:** Workroom reaper protection and unavailable-inventory fail-close.
- **V-ADL-007:** capture/delete/reconcile/query end-to-end recovery proof.
- **V-ADL-008:** Codex/Claude/Grok/Antigravity/portal contract parity.
- **V-ADL-009:** one relation, one projector, one protection resolver, no
  parallel blob/backlog, and at least twenty percent touched-seam refactoring.

## Backlog coverage

- Parent: BI-AADDF8C1
- Decision: atomic
- Receipt: pending immutable-plan commit and governed coverage write
- Dependencies: BI-0996913C is provenance only; it neither owns nor blocks this
  implementation.

## Risks and rollback

| Risk | Control | Rollback |
| --- | --- | --- |
| Relation/activity drift | Relation is canonical; one writer/projector | Disable exposure; retained rows stay inert |
| Provider facts fabricated | Server derives facts through adapter | No finalize write; prepared protection remains |
| Migration wedges installs | Expand-only table, data-safe attestation | Revert application use; table remains harmless |
| Cleanup loses work during outage | Known prepared is KEEP; unknown unmerged cleanup fails closed | Restore old adapters; no branch deleted by rollback |
| Recovery inflates unfinished count | Done designs are dependency-only | Ignore v2 section in v1 reader; items remain intact |
| UI hides scheduling | Evidence badge is adjacent and secondary | Remove badge; MCP projection remains |

## Completion gate

AC-ADL-001 through AC-ADL-008 need deterministic evidence; the origin-deletion
recovery demonstration must pass; UI must be exercised on the served target;
independent review, DCO, local merged-code evidence, cloud checks, and
`pr:health` must all be green. Unrun gates are reported as unrun.
