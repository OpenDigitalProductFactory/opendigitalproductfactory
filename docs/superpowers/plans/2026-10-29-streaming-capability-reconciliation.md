---
status: active
backlog_item: BI-AF6DDF01
workroom: WC-8A42FBA2
---

# Streaming capability reconciliation plan

Backlog: BI-AF6DDF01. Design: `docs/superpowers/specs/2026-10-29-streaming-capability-reconciliation-design.md`.

One atomic delivery: `streaming-projection`. Neither tests nor capability reconciliation is independently useful without the other.

1. **RED:** `loader.test.ts` loads an unknown-streaming subscription profile and applies the real interactive hard filter. It must reproduce `Missing required capability: streaming` on base `4718cd4f1c5418ab2eba819dd47d5cb839f8eca0`.
2. **GREEN:** Extend `loader.ts` to reconcile provider/model streaming at the existing manifest boundary. Preserve explicit false and non-text classes. This implements AC-STREAM-1 and AC-STREAM-2 under OBJ-STREAM.
3. **CHECK:** Run loader, pipeline capability, fallback and MCP reassessment tests (the latter two are graph-linked impact); run web typecheck, style guard, generated document-index check, preflight and exact-tree canonical build gate. AC-STREAM-3 preserves privacy, quota and policy gates. No unavailable check counts as passed.
4. **RELEASE:** Independent review, signed commits, protected PR/merge queue, canonical upgrade and served routing verification. Reconcile the prior unsettled execution before another coworker execution. Remaining quota/quality/policy blocks are reported honestly.

## Traceability

- Requirement: AC-STREAM-1, AC-STREAM-2, AC-STREAM-3.
- Contract: resolved-endpoint-streaming, existing EndpointManifest and RequestContract.
- Flow: interactive-loader-hard-filter, existing loader → getExclusionReasonV2 → eligible preference selection.
- Verification: loader-streaming-regression, source red/green plus canonical served read-only acceptance.

No new substrate or runtime repair by direct database edits. Existing source: `apps/web/lib/routing/loader.ts`, `apps/web/lib/routing/pipeline-v2.ts`, `apps/web/lib/routing/request-contract.ts`. Rollback: reviewed source revert.

## Backlog coverage

Atomic delivery `streaming-projection` maps to BI-AF6DDF01. Initial immutable coverage receipt `cmvuau37g341u01o20nz1ktnm` binds the published plan at `7af5ab40fff02f8e10afa9667a98bb0d30174ece` (blob `1409a281bb4e7ca527cecd9e4a094a900f9634c4`). Implementation admission `IRD-ACC52D129D6E` was allowed after that receipt.
