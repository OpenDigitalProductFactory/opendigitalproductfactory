# Enterprise Architect immutable reader grant fix plan

**Backlog item:** BI-0E663867

**Design:** `docs/superpowers/specs/2026-09-01-ea-immutable-reader-grant-fix.md`

## Delivery sequence

1. Preserve the live authority refusal and add a failing registry regression test.
2. Add `file_read` to the canonical `AGT-WS-EA` grant list without changing any packet or policy contract.
3. Run the targeted grant tests, repository guards, exact-tree gate, PR health gate, and merge queue.
4. Canonically deploy and replay the exact blocked architecture-review TaskRun.

This is one atomic deliverable: the test and grant must ship together, and live replay cannot succeed before the canonical registry change is deployed.

## Verification

- RED/GREEN proof in `packages/db/src/coworker-grant-consistency.test.ts`.
- Existing `coworker-grant-consistency` suite remains green.
- Exact-tree `pnpm run pregate` passes.
- `pnpm pr:health` reports all checks terminal and green with zero unresolved review threads.
- TaskRun `TR-MCP-Y21xamsxOWhsMDAwMDdwcnZzZm4ybTAzOQ-2AEEDFB97877` no longer returns `terminal_writer_context_reader_failed` after canonical deployment.

## Backlog coverage

Pending the live atomic coverage receipt for BI-0E663867.

## Risks and rollback

The change widens only the Enterprise Architect's canonical reader grant to match its existing immutable-review obligation and legacy seed. Roll back by reverting the one registry entry and its regression test.

