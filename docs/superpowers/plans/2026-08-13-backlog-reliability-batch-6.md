# Backlog Reliability Batch 6 Implementation Plan

**Goal:** Complete ten architecturally related platform reliability and security backlog items in one governed batch: six source fixes and four evidence-backed reconciliations of work already delivered on `main`.

**Work Capsule:** `WC-437EEE15`

**Branch:** `fix/backlog-reliability-batch-6`

## Design grounding

- Existing specs/plans reviewed: `docs/superpowers/plans/2026-08-13-backlog-reliability-batch-6.md` plus the live backlog and plan-coverage receipt for all ten selected items.
- Current code substrate reviewed: `apps/web/lib/mcp/packs/backlog-pack.ts`, `apps/web/lib/tak/agent-grants.ts`, the established Inngest queue/catalog, A2A sibling routes, and the existing index-integrity core.
- Source of truth: the live PostgreSQL backlog for lifecycle, the canonical grant registry for tool authority, the established queue catalog for schedules, and existing shared helpers for duplicate resolution and issue reporting.
- Decision: extend those existing contracts in place and add no parallel identity, scheduling, authorization, or evidence store.
- The live PostgreSQL backlog remains the status authority; the four reconciliation items close only after their merged source and current regression tests are re-verified.
- Existing coordination-plane, queue, authentication, and grant-registry substrates are extended in place. This batch adds no parallel identity, scheduling, authorization, or evidence store.
- The six code changes are independently testable but form one reliability concern: prevent platform-control paths from silently exposing data, killing concurrent work, corrupting references, hiding intended tools, or failing to detect/verify integrity drift.
- No user-facing UI is added. Documentation impact is this execution plan plus source-local contract comments where needed.

## Deliverables

1. **BI-D9C20A97 — live index-integrity sweep.** Wrap the existing exact-key guard in the established Inngest scheduled-function substrate, register it in the scheduled-jobs catalog and function export list, and route failures to the existing platform quality/attention sink. Add unit tests for success and drift/failure behavior.
2. **BI-DBAD1A1B — session-reaper boundary safety.** Replace raw worktree substring matching with a boundary-aware matcher that admits the worktree itself and true descendants but rejects sibling prefixes. Add shell-level regression coverage for root clone, sibling worktree, and shared local-CI paths.
3. **BI-F998BCE8 — self-scoped coworker grants.** Represent the seven intentionally self-scoped tools explicitly in the single grant registry, preserving deny-by-default for genuinely unknown tools. Extend the registry-wide coverage tests.
4. **BI-DC6BE37C — large semantic diff handling.** Give binary `git diff` a bounded 256 MiB buffer and surface spawn/ENOBUFS failures distinctly from nonzero git exits. Unit-test a payload over Node's historical 1 MiB default without creating a giant repository fixture.
5. **BI-C1FCFAA3 — semantic duplicate resolution.** Resolve a triage duplicate target from `BI-*` to the canonical internal row id before writing the foreign key, matching the already-correct retirement path. Add success and missing-target tests without growing the baselined modules.
6. **BI-07BD42FC — authenticated A2A task reads.** Reuse the sibling A2A offer-route authentication/authorization boundary and reject anonymous task reads. Audit sibling A2A routes and add route tests for anonymous and authorized requests.
7. **BI-F8808EDA — time-bomb detector false-positive contract.** Re-run the merged detector/shim tests and confirm the documentation now names subprocess clock skew instead of promising a judgment-free result.
8. **BI-32426CA0 — endpoint auto-retire guard.** Re-run the merged endpoint-retirement regression tests and verify the current source preserves the last eligible data-class endpoint.
9. **BI-46544737 — quarantine visibility.** Re-run the merged quarantine-filter tests and inspect the live installation's workforce projection before marking done.
10. **BI-108602C0 — legacy install-state migration.** Re-run the merged v1 `antigravityWired` migration regression and schema validation before marking done.

BI-321FA58B was considered and rejected from this batch: the page is present in the live database, but focused `wiki_query` calls cannot retrieve it, so its stated acceptance contract is not complete.

## TDD and verification sequence

1. Add focused failing tests for each of the six source changes and capture Red output.
2. Implement the smallest substrate-aligned change for each failure, then run focused Green tests.
3. Run all graph-linked and colocated tests found by repository search for the affected source paths; the MCP related-test helper was unavailable after dynamic loading, so verification is intentionally expanded.
4. Run the impact-contract guards: prose lint tests/check and style-drift check.
5. Run `pnpm run pregate:preflight`, the affected package unit suites, and `pnpm --filter web build`.
6. Run the governed exact-tree local merge gate before publication, obtain independent semantic review for the stable commit, push, open a ready PR, and verify `pnpm pr:health` before merge-queue enrollment.
7. After merge and canonical deployment, attach typed evidence and close only BIs whose complete acceptance criteria are demonstrated. Items with partial or superseded acceptance remain open with the evidence recorded.

## Rollback

The six changes are source-local and migration-free. Revert the squash commit if any control path regresses; no data rollback is required.
