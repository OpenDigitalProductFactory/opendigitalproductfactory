# Local-CI admitted-owner recovery implementation plan

**Backlog item:** BI-52500C0D
**Branch:** `fix/local-ci-admitted-owner-recovery`

> **For agentic workers:** execute this plan one independently reviewable backlog
> item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green
> implementation, `dpf-local-merge-ci-before-push` plus the completion gate
> before any success claim, and `dpf-pr-with-dco` for handoff.

## Outcome

Reduce a process-proven admitted local-CI orphan from a 15–20 minute slot hold
to a bounded two-minute recovery window, while a healthy gate retains exclusive
ownership through frequent renewal. Transport uncertainty must never allow a
runner to mutate past its authority deadline, but one transient MCP error must
not immediately destroy a healthy exhaustive run.

This is a safety and queue-latency repair. It does not weaken the exact-tree
test/build gate and does not increase sandbox capacity.

## Prior-design reconciliation

| Existing design | Reconciliation |
| --- | --- |
| `2026-07-26-sandbox-lease-fencing.md` / PR #3638 | Preserve PostgreSQL `activeKey` authority, owner-session renewal, host PID/token fencing, descendant termination, and `finally` release. Repair the disproven crash/orphan bound rather than replacing the lease model. |
| `2026-07-28-local-ci-sandbox-pool-pilot.md` | Keep capacity at one. Safe two-slot activation remains downstream of complete slot isolation and this bounded owner-recovery contract. |
| PR #3709 durable FIFO admission | Preserve idempotent `claimKey`, strict FIFO promotion, and queue polling. Queued requests may retain their requested TTL; only an admitted `local-integration-ci` hold gets the short safety TTL. |
| PR #3750 dead queued-observer reconciliation | Preserve same-host UUID+PID proof for queued cancellation. Admitted recovery remains database-expiry based because a remote portal cannot treat host-local PID state as global authority. |
| `fix/local-ci-descendant-fence` | Treat its process-tree quiescence work as compatible substrate. This plan owns the different case where the supervising gate process itself disappears after admission. |

## Verified current substrate

- `apps/web/lib/nonprod/environment-lease.ts` admits a queued row using its
  requested TTL (up to 20 minutes) and renews with a 15-minute default.
- `scripts/gate-worktree.mjs` requests that long TTL and starts
  `superviseLeaseRun` only after database admission and local-fence acquisition.
- `scripts/lib/lease-supervisor.mjs` heartbeats at TTL/3, fences on the first
  thrown transport error, and has no independent authority-deadline timer.
- `scripts/lib/mcp-client.mjs` has no request deadline, so a renewal can hang
  beyond lease expiry.
- Claim polling and release already reconcile expired active rows and promote
  the oldest waiter under the database transaction/advisory lock.

## Architecture

1. Add a `local-integration-ci` admitted TTL cap of two minutes in the lease
   service. FIFO and idempotent queue-observation semantics remain unchanged;
   canonical waiters refresh their short liveness window on every observation.
2. Have the canonical gate request at most that two-minute TTL even when talking
   to an older portal, then derive supervision timing from the actual admitted
   lease expiry returned by the portal.
3. Add a bounded MCP request timeout. A structured renewal rejection is proven
   ownership loss and fences immediately. A thrown transport failure is
   uncertainty: record it and retry while time remains.
4. Arm an independent safety deadline before the known lease expiry. If no
   successful renewal advances the expiry, terminate the descendant tree before
   another claimant can acquire the slot.
5. Renew the admitted database authority while a prior live host fence delays
   startup; never acquire that fence near the last known authority expiry.
6. Record admitted expiry, renewal expiry, transport-uncertain events, and
   authority-deadline fencing in the existing lease-event evidence.

PostgreSQL remains the only admission authority. Host process records remain
supporting liveness evidence, never a second lease source of truth.

## TDD phases

### 1. Red: admitted TTL and promotion

Add lease-service tests proving:

- a queued 20-minute local-CI request is admitted with at most two minutes;
- renewal cannot extend that active lease beyond two minutes;
- other nonproduction environments retain the existing TTL policy; and
- an expired short lease is reconciled and the oldest waiter is promoted.

### 2. Red: supervisor uncertainty and deadline

Add dependency-free Node tests proving:

- one thrown renewal transport error records uncertainty without immediate
  termination;
- a later successful renewal advances the authority deadline;
- a structured `lease_lost` response fences immediately; and
- repeated uncertainty terminates before the last known expiry and releases
  exactly once.

### 3. Green: service, transport, and gate integration

Implement the minimum service cap, request timeout, supervisor deadline, and
gate expiry handoff needed to satisfy the red contracts. Preserve the current
signal and process-tree cleanup behavior.

### 4. Refactor and compatibility

Centralize TTL/deadline math in dependency-free helpers. Reconcile against the
latest descendant-fence branch before publication if it lands first. Keep
legacy fixture responses working by falling back to the requested TTL only when
the portal omits admitted expiry.

### 5. Completion gate

- Run the focused lease service, supervisor, MCP client, and gate contracts.
- Run docs index/link checks and `git diff --check`.
- Run the exact-tree governed local-CI gate against current `origin/main`.
- Push signed commits, update a ready non-draft PR, require `pnpm pr:health`,
  and merge only through the queue.

## Risks and rollback

- **False fencing during a portal blip:** retry transport uncertainty while the
  known authority window remains; structured owner loss still fences
  immediately.
- **Mutation after expiry:** an independent deadline timer terminates before the
  database expiry boundary even if the MCP call hangs.
- **Queue churn:** queued TTL is not globally shortened, and canonical waiters
  refresh their idempotent claim well inside the active cap.
- **Cross-environment regression:** the two-minute cap is scoped to
  `local-integration-ci`; `active-candidate` keeps the existing policy.
- **Rollback:** revert the PR. No schema or data migration is involved; capacity
  remains one throughout.

## Documentation impact

Update `docs/testing/pre-pr-gate.md` only if the operator-facing recovery and
heartbeat contract is not already accurate after the descendant-fence work.
There is no portal UX, public-site, setup, prompt, or route-map impact.

## Backlog coverage

- Decision: atomic
- Parent: BI-52500C0D
- Receipt: cms71e61l0dxf01ogh4j4wzu8
- Rationale: The short active TTL, actual-expiry-derived heartbeat cadence,
  bounded transport uncertainty, server-side expiry promotion, and evidence
  events form one fail-closed lease-safety contract. Shipping any subset could
  retain the 15–20 minute orphan penalty or allow a live runner to cross its
  authority boundary.
- Dependencies: none

| Deliverable | Backlog item | Depends on |
| --- | --- | --- |
| Bound local-CI admitted-owner recovery while preserving live-owner fencing | BI-52500C0D | None |
