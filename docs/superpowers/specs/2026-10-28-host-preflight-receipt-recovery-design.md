---
status: draft
backlog_item: BI-10AD69D2
workroom: WC-73B1995B
---

# Host preflight receipt recovery

Extends [bounded host verification](2026-10-13-bounded-host-verification-design.md).

This continuation belongs to BI-10AD69D2 / WC-73B1995B, on
`fix/host-preflight-receipt-recovery`. It does not reopen BI-6DE5A3B6 or inherit
that item's approval or execution evidence. Source inspected:
`46f8a5ca9cb75aa871a223b70acc6dcc65d15a67`. Design admission is
IRD-71E56C33ADED; implementation admission and delivery remain pending.

### Evidence and existing boundary

The Critic owner observed two interrupted host preflights, sessions 85795 and
63162, before native lease admission. For the latter, host process 65908 and
last child 95748 were absent, with no matching native lease, queue or new gate
verdict. Its retained host receipt still said `running`, last heartbeat
2026-10-28T21:50:03.727Z. This establishes a recovery gap, not the cause of
process termination or a product-test failure. Preserve the original records.

At the inspected source, `runWithGuardReceipt` in
`scripts/lib/pregate-preflight-receipt.mjs` settles thrown execution while its
controller runs. Abrupt controller death cannot execute that catch/finally.
`classifyPriorStage` in `scripts/lib/local-ci-stage-receipt.mjs` is a read-time
PID classifier, used by other runners, not this host wrapper. The existing
`scripts/lib/local-convergence-lock.mjs` already retains an owner token and
process birth identity; `scripts/lib/local-sandbox-fence.mjs` owns process
identity. Extend these contracts rather than introducing another controller.

The earlier AC-HOST-002 promises recorded progress and detectable process death;
it does not promise an independent finalizer or survival of the foreground
executor. Queued local-CI recovery is post-admission and does not establish host
preflight recovery. BI-92EE4EC5 concerns effective PR-body identity;
BI-091A2DCF concerns uncertain host-resource admission; BI-9BDF9539 concerns
queued resume; BI-9A353411 concerns Workroom reaper rollout. Preserve those scopes.

### Recovery objectives and acceptance

**OBJ-HR-1:** An abandoned host preflight retains an attributable inconclusive outcome without inventing a child verdict.

**OBJ-HR-2:** Recovery preserves single-owner execution and the exact original receipt, source and process identity.

**OBJ-HR-3:** The responsible executor receives one supported next action and the evidence still missing before another execution.

| Acceptance ID | Objective IDs | Statement |
| --- | --- | --- |
| AC-HR-1 | OBJ-HR-1 | A real controller subprocess is abruptly terminated after the actual receipt writer persists progress; supported reconciliation records inconclusive with original identity, observations and last progress, without inventing the child's result. |
| AC-HR-2 | OBJ-HR-2 | A live controller, unreadable probe, legacy identity, reused PID or foreign lock cannot be treated as authoritative death; uncertain ownership remains UNKNOWN and cannot authorize mutation, reuse, cleanup or duplicate execution. |
| AC-HR-3 | OBJ-HR-2 | Concurrent reconciliation, late completion, receipt replacement and changed owner tokens cannot overwrite terminal or replacement evidence; repeated reconciliation is idempotent. |
| AC-HR-4 | OBJ-HR-3 | The existing status/recovery path names the exact attempt, accountable owner, missing child or ownership proof and one supported next action; disposition of an old receipt is separate from admission of a new attempt. |
| AC-HR-5 | OBJ-HR-1, OBJ-HR-2, OBJ-HR-3 | Existing successful-only reuse, input/environment identity, TTL, command budgets, queue/lease fences, authority and protected publication remain intact, and evidence distinguishes source tests, source publication and installed verification. |

### Options and selected scope

- Rerun after a timeout: rejected. Age alone cannot prove process death or safe
  replacement, and a new invocation can overwrite the only retained progress.
- Add a detached scheduler or receipt ledger: rejected for this repair. It adds
  a second execution authority without establishing the old attempt's outcome.
- Extend existing receipt observation, strong process identity and convergence
  locking: selected. This provides truthful abandonment reconciliation and
  bounded recovery eligibility. It does not provide execution survival.

The selection stays within the captured repair and existing substrate; it is
not permission to widen grants, invoke a model, clear a lease or replay a review.
Funding allocation remains unresolved; no provider spend is inferred.

### Ordered implementation and verification

1. Reproduce the gap on a named source ref in an isolated temporary fixture.
   The real writer must persist start and progress, then the fixture terminates
   only its own identified controller without allowing normal exception
   settlement. Observe the retained running receipt and lock. Never signal a
   delivery gate or infer a historical cause from this fixture.
2. Bind new host receipts to the existing convergence owner token and strong
   controller identity. Preserve original source/input/environment identities.
   Reuse process identity utilities. Do not equate the current boolean
   `isProcessAlive` false result with proven absence: it swallows probe errors.
   Permission, transport, parse and identity failures remain UNKNOWN. Bare PID,
   elapsed time or a legacy lock age is insufficient for receipt mutation.
3. Reconcile through the supported receipt/lock owner path. Before mutation,
   prove the same original owner is absent, serialize with the existing
   convergence contract, and re-read the exact receipt and ownership. Compare
   original receipt identity/version and owner token immediately before the
   atomic replacement. Every completion and reconciliation writer must use the
   same owner-fenced serialization or a real compare-and-swap; a read-check
   followed only by atomic rename is insufficient against a late writer.
   A changed, terminal, live or unprovable record is left
   untouched. The observer releases only its own acquired lock. It never kills
   a process or deletes a foreign lock; a stale-lock helper's legacy-age path
   is not sufficient authorization for receipt settlement.
4. Persist an attributable inconclusive disposition through the existing atomic
   receipt writer, retaining original observations, controller identity and
   last heartbeat. Record observer/time/reason separately from any actual child
   exit. Reuse the existing readable receipt states; no pass flag or fabricated
   result is added. Integrate this observation into existing host preflight and
   status recovery. A dead controller with unknown descendants must still name
   that missing proof and refuse duplicate execution.
5. Exercise the actual read/reconcile/write path with real abrupt loss and
   deterministic live, unreadable, PID-reuse, changed-lock, concurrent-observer,
   late-terminal and changed-source cases. Test successful receipt reuse and
   TTL/input/environment regressions. Obtain current scope coverage, research,
   implementation admission, independent review and protected source delivery;
   record installed verification separately. At least 20% of relevant repair
   effort consolidates existing identity/receipt helpers rather than adding
   parallel utilities.

Research and checks must report actual outcomes. A helper-only simulation,
handled exception or successful source test cannot establish recovery after
abrupt client loss. The real subprocess fixture should run on Windows and a
POSIX host where available; unsupported host evidence remains unrun/unknown.

### Research references and architectural fit

This is a bounded defect continuation, not adoption of another workflow product.
It reuses the existing bounded-host design and concurrent delivery contracts.
[Node.js signal documentation](https://nodejs.org/api/process.html#signal-events)
confirms that SIGKILL cannot be handled and that Windows signal behavior differs;
[process.kill documentation](https://nodejs.org/api/process.html#processkillpid-signal)
explains the signal-zero existence probe. Accordingly, a controller's own
finally block cannot be the abrupt-loss finalizer, and probe errors must retain
their actual uncertainty. No external package, service or new executor is needed.

No database migration, provider, credential, grant, container or resource-policy
change is included. No portal layout is changed; any implementation that changes
a rendered status owes that surface's existing UX verification. Older receipts
remain readable; missing strong ownership makes them unknown, never reusable
passes. Rollback removes new reconciliation eligibility while retaining old
receipts and observations. No manual receipt rewriting is a recovery procedure.

This continuation does not authorize another Critic gate, replenish any
historical attempt, or prove a future foreground run survives client loss.
Execution durability beyond truthful reconciliation requires its own scoped
owning decision and observed proof on an existing supported runner. The original
Critic result and disposition remain separate obligations.