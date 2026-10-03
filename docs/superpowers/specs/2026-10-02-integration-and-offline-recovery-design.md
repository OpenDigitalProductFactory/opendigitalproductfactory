---
title: Integration execution and offline platform recovery
status: draft
backlogItem: BI-02E5CE5A
relatedBacklogItems: [BI-7A4E70E9, BI-A6DC9847, BI-AE87D2BE]
---

# Integration execution and offline platform recovery

## Authority and scope

The operator authorized investigation, implementation, tests and governed delivery
on 2026-10-02. The follow-up explicitly requires restoration when the portal,
MCP, queue, approval store or self-upgrade cannot run. This authorizes building
and rehearsing recovery; it is not permission to erase production data, impersonate
an owner, replace a healthy install, self-approve a review or bypass PR controls.

BI-02E5CE5A owns integration execution recovery. BI-7A4E70E9 owns offline
restoration. The latter is independently shippable and must have its own reviewed
delivery; both outcomes are required to finish the operator's request.

## Verified starting point

Source: `7ff008013f16a82da0352df700c2153a17943a83`.
`scripts/gate-worktree.mjs:532-564` matches runner paths anywhere in command
text. An executable Node runner with a vitest child correctly returns both PIDs.
A sleeping zsh wrapper whose command body contains that runner with arguments
also returns both its PID and its sleep child's PID. A Node strict assertion
expecting no mutators fails. The narrower no-argument fixture does not reproduce
because a semicolon immediately after the filename fails the whitespace regex.

Live lease observation at 2026-10-03 01:28 UTC: one active and ten queued leases.
The incident BI records restoration after the two false-positive wrappers were
stopped. No current peer process or lease is modified by this work.

`renewNonprodEnvironmentLease` updates heartbeat and assigns phase `running`
without execution progress. `resumeUntilAdmitted` awaits an unbounded child,
uses constant delay, and guards recursive spawning only through an environment
marker. `releaseLeaseOnce` marks released before the remote call succeeds.
Terminal immutable leases already revive in place through
`settleTerminalGateLease`; completed evidence is protected in
`local-ci-gate-state.mjs`. Extend those contracts.

BI-AE87D2BE has an in-flight DNS/base-fetch fix at `68fd36c544`; consume that
delivery instead of duplicating it. BI-A6DC9847 proposes a single host worker;
the worker file is absent on the named main ref, so the design is not execution
evidence. Its migration and host identity requirements remain binding.

The existing disaster-recovery runbook §3.5a.4 routes a portal outage through
`/admin/backups`. Redeploy scripts provide a coarse emergency flag. Installer
transactions preserve state bytes and signed-release installation checks image
identity. These are the recovery substrates to extend.

## Objectives and acceptance

- OBJ-IT-1 / AC-IT-1: DNS/network failures produce infrastructure evidence,
  never a failed-code verdict or reusable failed test result.
- OBJ-IT-2 / AC-IT-2: bounded exponential backoff with jitter releases scarce
  capacity before waiting; unrelated queued work executes and the affected
  immutable request fairly resumes when infrastructure recovers.
- OBJ-IT-3 / AC-IT-3: failure, cancellation, timeout and executor death clean
  owned processes and reservations idempotently, with no successor termination.
- OBJ-IT-4 / AC-IT-4: one supervisor and one executing runner per immutable
  request; concurrent repeated requests join that work without another queue row.
- OBJ-IT-5 / AC-IT-5: heartbeat proves life only. Stage/output/child completion
  proves progress. Bounded stage deadlines detect stalls while declared
  long-running tests remain protected inside their execution budget.
- OBJ-IT-6 / AC-IT-6: process classification uses executable, argument role and
  ancestry. Incidental runner names in shell bodies are not executing runners.
- OBJ-IT-7 / AC-IT-7: source SHA, queue identity, attempt diagnostics and completed
  results survive retry and recovery. Cancellation stays cancelled.
- OBJ-IT-8 / AC-IT-8: status distinguishes running, retrying infrastructure,
  waiting for capacity and requiring intervention, including reason and next wake.
- OBJ-OR-1 / AC-OR-1: a locally available recovery entry point authorizes and
  executes restoration without portal, MCP, queue, approval DB or self-upgrade.
- OBJ-OR-2 / AC-OR-2: authorization binds install identity, exact input hashes,
  allowed operations, expiry and operator identity; an independent verification
  receipt binds the same plan. Replay cannot expand authority or repeat a swap.
- OBJ-OR-3 / AC-OR-3: preserve data and prior runtime/state before mutation;
  health/identity failure rolls back to the preserved runtime. Never delete
  volumes or silently restore an older database over newer business data.
- OBJ-OR-4 / AC-OR-4: append local audit evidence outside the failed platform;
  unavailable gates are unrun. After restoration reconcile through the existing
  governed evidence API with stable idempotency identity.

## Integration recovery contracts

CON-IT-1: the existing immutable gate identity and server lease remain the queue
authority. No alternate admission queue. An infrastructure attempt releases its
active slot, retains its identity and evidence, and rejoins at the eligible FIFO
tail after backoff. An unavailable control plane cannot grant runtime authority.

CON-IT-2: reuse process-start identity and token-owned fences. Supervisor ownership
is keyed by immutable request, separately from slot ownership. An expired
heartbeat alone cannot evict a live process. Unknown identity is fail-closed;
PID reuse never grants authority to kill. A duplicate reports the existing work.

CON-IT-3: a watchdog separates last heartbeat, last observable progress and the
stage deadline. A quiet valid stage is allowed through its declared budget.
Expired stage authority terminates only its owned process tree, records an
inconclusive attempt and releases capacity. Cleanup completion precedes handoff.
Lost owner requires the host recovery executor and server lease reconciliation;
it cannot depend on the originating interactive session surviving.

FLOW-IT-1: request -> join or own -> waiting for capacity -> admitted -> running
-> completed; infrastructure failure -> preserve attempt -> clean owned children
-> release -> retrying infrastructure -> eligible FIFO admission. Exhausted
attempt/time budget -> requiring intervention. Cancellation is terminal.

## Offline restoration contracts

CON-OR-1: extend install/bootstrap recovery with a local, bounded recovery plan.
Preparation resolves exact installation paths, container identities, immutable
target and rollback images, relevant configuration hashes and data mounts.
Preparation is read-only and remains usable without network access.

CON-OR-2: local operator authorization and independent verification are durable
inputs bound to the plan digest. They are checked before side effects without
consulting the failed approval store. Existing organization identity/trust material
is reused where available; absence of locally verifiable authority is explicit,
never replaced by an AI-authored assertion of permission.

CON-OR-3: mutation acquires the existing install-state transaction lock and proves
the previous executor no longer owns the target. Preserve exact rollback state
and image before stopping anything. Restore only the enumerated service using
immutable image identity, preserving mounts and dependencies. No arbitrary shell
payload, image retagging, automatic schema downgrade or volume deletion.

CON-OR-4: locally retained evidence records authorization, independent verification,
preconditions, actions, results, rollback and gate-unrun reasons before proceeding.
The journal survives executor death and supports resume from a verified boundary.
A restarted operation inspects actual state before replaying any action.

FLOW-OR-1: inspect -> immutable plan -> operator authorization + independent
verification -> preserve recovery point -> exclusive execution -> health and
identity verification -> restored or rollback -> evidence reconciliation.
Platform-hosted gates are never on the path before restoration.

## Ordered delivery and verification

1. BI-02E5CE5A: reproduce process fixtures; extend classifier, existing lease
   supervision, durable resumer and evidence/status projections. Integrate
   BI-AE87D2BE's delivered DNS classification. Test CON-IT-1 through CON-IT-3
   and FLOW-IT-1 against all AC-IT criteria. VER-IT-1 is deterministic process
   and fake-clock coverage; VER-IT-2 is failure injection through the canonical
   shared runtime, under its lease, with two independent queued requests.
2. BI-7A4E70E9: extend bootstrap recovery, state transactions and audit handling
   for CON-OR-1 through CON-OR-4 and FLOW-OR-1. VER-OR-1 tests authorization
   expiry, tampered plans, replay, mismatched install, crash boundaries and rollback.
   VER-OR-2 rehearses portal/MCP/queue/approval-store outages and broken
   self-upgrade against an isolated leased recovery target. Block external
   control-plane access during the exercise; restoration must still finish.
3. Each delivery updates its operations documentation and receives independent
   semantic review, appropriate local checks, governed PR and merge-queue checks.
   Capture canonical runtime identities and verify the delivered recovery path.

No live outage injection against business data. Preserve diagnostics from every
attempt. Tests must demonstrate unrelated work completes during an outage and
the original request completes after restoration without manual record cleanup.
Mark any unavailable exercise unrun and leave acceptance open.

## Research & Benchmarking

- [Kubernetes Jobs](https://kubernetes.io/docs/concepts/workloads/controllers/job/):
  adopt separate retry counts and execution deadlines. Reject treating an
  infrastructure-exhausted attempt as a verdict on application code.
- [AWS static stability](https://docs.aws.amazon.com/whitepapers/latest/aws-fault-isolation-boundaries/static-stability.html):
  recovery must avoid dependencies on an impaired control plane. Pre-position
  authority and immutable recovery inputs; no new service dependency is added.
- Existing DPF immutable-gate and host-worker designs supply queue identity,
  admission and executor ownership. Reuse them; do not install another queue.

## Compatibility, risk and rollback

Mixed-version processes must remain protected by executable/ancestry checks.
Retries may reuse evidence only for the exact immutable request. Recoverable
infrastructure observations cannot overwrite completed results. Cross-platform
process identity uses existing adapters; platform-specific limits are documented
in the platform-support watch-list. Logs must not include secrets or raw env.

Integration changes can revert independently while preserving the durable queue
and evidence. Offline recovery retains the previous image and exact state bytes;
a failed verification restores those bytes through the existing transaction
contract. Database restoration is a separately scoped destructive operation and
is not implicitly authorized by this service-restoration plan.

## Backlog coverage

Decomposed: integration recovery maps to BI-02E5CE5A; offline restoration maps to
BI-7A4E70E9. Independent review and provider-verified coverage are pending.
This draft is not implementation authorization or evidence of delivered recovery.
