---
status: active
backlogItem: BI-7175C7DB
design: docs/superpowers/specs/2026-08-29-build-brief-actor-handoff-design.md
---

# Build brief actor handoff implementation plan

## Atomic deliverable

One independently shippable repair maps entirely to `BI-7175C7DB`: preserve
the governed MCP actor across `update_feature_brief` while keeping the action's
existing UI authentication and fail-closed checks.

| Deliverable | Backlog item | Objectives | Acceptance criteria | Files / verification |
| --- | --- | --- | --- | --- |
| Explicit brief-write actor handoff | BI-7175C7DB | OBJ-BBAH-001, OBJ-BBAH-002 | AC-BBAH-001, AC-BBAH-002, AC-BBAH-003, AC-BBAH-004 | `apps/web/lib/mcp/build-lifecycle-handlers.ts`, `apps/web/lib/actions/build.ts`, focused handler/action tests |

## Test-first steps

1. Add a red action test proving an explicit owner actor succeeds without
   session lookup, plus a red non-owner test proving `Forbidden` remains.
2. Add a red handler test proving the governed `userId` is forwarded as the
   actor while the existing partial-brief merge remains intact.
3. Add the optional action options object and pass it only from the MCP handler.
4. Run the focused action and handler suites, adjacent build-lifecycle pack
   tests, web typecheck, source-policy/preflight guards, and documentation
   impact checks.
5. Obtain semantic review and governed exact-tree verification, create a
   DCO-signed commit, push, and open one protected PR.
6. After protected merge and canonical deployment, replay the original Pet
   Rescue brief update through the supported MCP path and verify the resulting
   brief/taxonomy state before resuming `FB-668407A5`.

## Refactoring allowance

Keep the change deliberately narrow. Use an options object rather than a third
positional identity argument so future action options remain readable, but do
not generalize authorization across unrelated build actions in this repair.

