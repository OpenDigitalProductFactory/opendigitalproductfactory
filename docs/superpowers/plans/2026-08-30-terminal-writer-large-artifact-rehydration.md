---
status: active
---

# Terminal-writer large-artifact rehydration

**Backlog item:** `BI-8B8731EE`
**Epic:** `EP-129D11FD`
**Workroom:** `WC-D8BEE5C9`
**Design:** `docs/superpowers/specs/2026-08-30-terminal-writer-large-artifact-rehydration-design.md`
**Decision:** `DI-2C90F0EF92B2`
**Related async delivery:** `BI-2014236E`

## Outcome

The same governed initiative-review TaskRun can rehydrate a complete immutable artifact up to 64,000 characters and reach its independently controlled terminal writer. Exact repository, commit, path, blob, page continuity, audit, and fail-closed requirements remain unchanged.

## Backlog coverage

- Decision: atomic
- Parent: `BI-8B8731EE`
- Bounded hydration policy, exact large-artifact regression, fail-closed ceiling regression, protected delivery, and same-TaskRun live proof -> `BI-8B8731EE`
- Dependencies: none
- Receipt: pending governed `record_plan_backlog_coverage`
- Rationale: the bounded policy change and its positive and negative proofs are one independently meaningful repair; neither is safe or useful to ship alone.
- Independently shippable async TaskRun return/push/reconciliation work is mapped to `BI-2014236E` and is not part of this atomic receipt.

## Related asynchronous delivery

The preserved reviewer also proved that inline `tasks/submit` can outlive the initiating HTTP deadline while its TaskRun continues correctly. Child `BI-2014236E` owns the separate clean revert that will return the durable TaskRun immediately, execute through the existing queue, publish native MCP task notifications/subscriptions after committed transitions, and retain adaptive `tasks/list`/`tasks/get` reconciliation for offline or restarted hosts. Optional signed webhooks are delivery projections for separately registered external hosts; they never replace TaskRun state or accept arbitrary per-request callback URLs.

## Ordered implementation

1. Add the failing 24,493-character, 452-line, eight-page regression described in the design.
2. Extend the truncation regression to exercise the complete 20-page ceiling.
3. Raise only the server-owned aggregate hydration ceiling to 64,000 characters and derive the page count from the unchanged 3,200-character page size.
4. Run the focused suite, graph-linked tests, web typecheck, style guard, and pregate preflight.
5. Obtain semantic review and exact-tree local CI, then ship a DCO-signed protected PR.
6. Release and upgrade the canonical development install.
7. Replay preserved TaskRun `TR-MCP-Y210Nmg3bjg3MDBnYTAxbXhheDU2MXV2aQ-47E477394386` once with its original request identity and verify a real terminal writer execution and receipt on that same row.

## Verification matrix

| Requirement | Contract/flow | Verification |
|---|---|---|
| `AC-LARGE-COMPLETE` | `hydrateTerminalWriterContext` bounded deterministic reread | 24,493-character / eight-page regression and live preserved replay |
| `AC-IDENTITY` | `TerminalToolPolicy.immutableReaderArguments` and same-TaskRun resume | Existing binding/cursor/order tests and unchanged live TaskRun id |
| `AC-FAIL-CLOSED` | Explicit page, aggregate, and pagination ceilings | Existing negative suite and 20-page truncation regression |
| `AC-AUDIT` | Existing `TaskRun` and `ToolExecution` persistence | Live exact reader/writer execution inspection |
| `AC-SEPARATION` | Existing governed terminal writer | Real independently selected writer arguments and receipt; no proxy write |

## Risks and rollback

- Worst-case deterministic recovery grows from six to twenty sequential pages, still capped at 64,000 characters.
- Content larger than the cap remains explicitly resumable-but-blocked; it is never silently truncated into a receipt decision.
- Reverting the constant restores the prior ceiling without a migration or data rewrite.
- No work or receipt on `feat/workroom-definition-roster-contracts` is changed.
