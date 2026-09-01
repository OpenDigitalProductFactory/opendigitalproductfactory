# Governed initiative reviewer immutable reader grant fix plan

**Backlog item:** BI-0E663867

**Design:** `docs/superpowers/specs/2026-09-01-ea-immutable-reader-grant-fix.md`

## Delivery sequence

1. Preserve the four live authority refusals and add a failing table-driven registry regression test.
2. Add `file_read` to the canonical `AGT-WS-EA`, `AGT-902`, `AGT-190`, and `AGT-905` grant lists
   without changing any packet or policy contract.
3. Run the targeted grant tests, repository guards, exact-tree gate, PR health gate, and merge queue.
4. Canonically deploy and replay the exact blocked architecture, data, security, and compliance
   review TaskRuns.

This is one atomic deliverable: the test and grant must ship together, and live replay cannot succeed before the canonical registry change is deployed.

## Verification

- Four-case RED/GREEN proof in `packages/db/src/coworker-grant-consistency.test.ts`.
- Existing `coworker-grant-consistency` suite remains green.
- Exact-tree `pnpm run pregate` passes.
- `pnpm pr:health` reports all checks terminal and green with zero unresolved review threads.
- Phase D TaskRun `...-2AEEDFB97877` and Phase E TaskRuns `...-6B8DDA851C0E`,
  `...-8D5819036EA9`, and `...-84E45A41F551` no longer return
  `terminal_writer_context_reader_failed` after canonical deployment.

## Backlog coverage

Pending the live atomic coverage receipt for BI-0E663867.

## Risks and rollback

The change widens only four canonical reviewer reader grants to match their existing immutable-review
obligations and the successful reviewer precedent. Roll back by reverting the four registry entries
and their table-driven regression test.
