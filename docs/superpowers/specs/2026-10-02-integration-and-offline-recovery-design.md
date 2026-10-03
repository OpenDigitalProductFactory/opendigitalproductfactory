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

- **OBJ-IT-1:** Classify DNS/network outages as infrastructure failures without producing a code-test verdict.
- **OBJ-IT-2:** Bound retries, release scarce capacity during backoff and fairly resume the immutable request after infrastructure recovers.
- **OBJ-IT-3:** Clean owned processes and reservations idempotently after failure, cancellation, timeout or executor death.
- **OBJ-IT-4:** Maintain one supervisor and one executing runner per immutable request while repeated requests join existing work.
- **OBJ-IT-5:** Distinguish liveness from progress and recover stalled execution without interrupting legitimate long-running tests.
- **OBJ-IT-6:** Classify actual runner processes by executable, argument role and ancestry.
- **OBJ-IT-7:** Preserve source, queue identity, diagnostics, completed results and terminal cancellation across recovery.
- **OBJ-IT-8:** Report running, infrastructure retry, capacity wait and intervention with clear reasons and next wake.
- **OBJ-OR-1:** Authorize and execute restoration without the portal, MCP, queue, approval store or self-upgrade.
- **OBJ-OR-2:** Enforce scoped operator authorization and independent verification of the same immutable recovery plan.
- **OBJ-OR-3:** Protect business data and restore preserved runtime/state when recovery verification fails.
- **OBJ-OR-4:** Retain independent audit evidence, report unavailable gates as unrun and reconcile once after recovery.

| ID | Objectives | Observable proof |
| --- | --- | --- |
| AC-IT-1 | OBJ-IT-1 | VER-IT-2 injects DNS/network failure and observes infrastructure evidence, with no failed-code verdict or reusable failed result. |
| AC-IT-2 | OBJ-IT-2 | VER-IT-2 observes bounded exponential backoff with jitter after release, unrelated job completion during the outage, and fair automatic resumption of the original request after restoration. |
| AC-IT-3 | OBJ-IT-3 | VER-IT-1 injects failure, cancellation, timeout and executor death; repeated cleanup releases only owned processes and reservations and never terminates a successor. |
| AC-IT-4 | OBJ-IT-4 | VER-IT-1 launches duplicate supervisors and repeated requests; they join one queue identity with at most one supervisor and executing runner. |
| AC-IT-5 | OBJ-IT-5 | VER-IT-1 preserves a quiet legitimate test within its declared stage budget, then expires a stalled stage despite continuing heartbeats and verifies cleanup. |
| AC-IT-6 | OBJ-IT-6 | VER-IT-1 ignores incidental runner names in sleeping shell command bodies while identifying executable Node runners and their actual descendants. |
| AC-IT-7 | OBJ-IT-7 | VER-IT-1 and VER-IT-2 compare pinned SHA, queue identity, attempt logs and completed results before/after recovery; cancellation remains terminal. |
| AC-IT-8 | OBJ-IT-8 | VER-IT-2 reads each running, retrying infrastructure, waiting for capacity and requiring intervention transition with reason and next wake. |
| AC-OR-1 | OBJ-OR-1 | VER-OR-2 blocks portal, MCP, queue and approval store and breaks self-upgrade; the locally available bootstrap restores the isolated target without calling any failed dependency. |
| AC-OR-2 | OBJ-OR-2 | VER-OR-1 rejects forged, expired, replayed or cross-install receipts and changed input/action hashes before mutation; distinct authorized operator and verifier signatures bind the same plan. |
| AC-OR-3 | OBJ-OR-3 | VER-OR-2 fails health/identity after swap, restores exact prior runtime/state, and proves unchanged business-data and mount identities without volume deletion or automatic database downgrade. |
| AC-OR-4 | OBJ-OR-4 | VER-OR-1 and VER-OR-2 retain local hash-linked evidence through crashes, preserve unavailable gates as unrun and import the report idempotently after restoration. |

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

### Canonical ownership and persistence

The following are proposed extensions, not claims that these fields or commands
already exist. No new queue, approval database or recovery service is introduced.

| Contract | Canonical owner and writer | Persistence and compatibility |
|---|---|---|
| Immutable test request and retry admission | `NonProductionEnvironmentLease`; `apps/web/lib/nonprod/environment-lease.ts` owns admission and cancellation | Add nullable pinned source/base/host binding and recovery fields to this existing model. Existing `claimKey` remains unique. Existing terminal evidence is never rewritten. |
| Recovery phase and budgets | The same lease, updated by its current fenced executor through existing lease tools | A Prisma enum defines running, infrastructure retry, capacity wait and intervention. Add attempt count, next eligible time, total deadline, generation and last progress time. Missing fields mean legacy execution, never inferred authority to take over. |
| Host execution | BI-A6DC9847's host worker extends the existing installer-managed host lifecycle | Bind the canonical install-state path, Docker endpoint and project to a host identity; validate queued source/worktree identity before dispatch. A managed worker holds the existing process-start/token fence and does not borrow an unrelated caller's credentials. Admission must explicitly authorize this executor before cutover. |
| Attempt diagnostics and final verdict | Existing local gate records and `ExternalEvidenceRecord` | Archive each attempt before the next opens its log. Keep exact source, gate identity and ownership generation. Infrastructure records cannot replace passed or failed-code verdicts. |
| Install identity and recovery lock | `scripts/installer/install-state.schema.json`, `resolve-host-identity.mjs`, `install-state-transaction.mjs` | Reuse canonical state-path resolution, platform identity, Docker endpoint, Compose project, locking, flushed recovery bytes and restore. Bind their hashes in the recovery plan; do not invent a second organization identity. |
| Offline recovery inputs | Installer/bootstrap recovery owns a versioned `OfflineSelfUpgradeRecoveryEnvelope` contract under `scripts/installer/`; the bootstrap recovery command is its only execution writer | The operator selects a restricted recovery-kit directory outside the installation and its state directory, on independently retained storage. It contains the immutable plan, signed receipts, execution journal and rollback metadata. These are transport/checkpoint artifacts for the existing self-upgrade recovery lifecycle, not another approval store. |
| Reconciled recovery operation | `SelfUpgradeRun` and its existing `completionEvidence`, `recoveryOfRunId` and change-record integration | After the portal recovers, an authenticated importer validates the local report and uses its stable `runId` to create/reconcile exactly one recovery run. It preserves predecessor history and rejects an existing run with different hashes. It cannot turn unrun gates into passes. |

The offline JSON contract must close its action and phase sets and reject unknown
fields. The plan contains schema version, run ID, canonical install-state hash,
Docker endpoint/project, exact service/container identities, image content IDs,
configuration and mount hashes, allowed actions and expiry. Authorization and
independent-verification receipts each bind that plan digest and identify their
separate signer. Local trusted operator and verifier public keys must already
exist, or be provisioned explicitly by the operator through the bootstrap path;
the executor cannot enroll its own signer or manufacture a receipt. Organization
CA identity alone is not proof that a person may authorize recovery.

`SelfUpgradeRun` is the canonical recovery-operation model, identified by the
same `runId` online and offline. Its bootstrap adapter, not the portal, is the
sole writer of offline execution facts. The planner writes the immutable plan;
the operator signer writes authorization; a different verifier signer writes
the verification receipt. None can rewrite another actor's artifact. A single
bootstrap executor holds the existing install-state lock plus a token-owned
lock in the recovery-kit directory and appends execution journal entries. Its
state machine is `prepared -> authorized -> preserved -> executing -> verifying
-> restored | rolling-back -> rolled-back | intervention`. Resume reconciles
the last flushed boundary with actual containers before advancing; it cannot
skip authorization or preservation. `intervention` permits observation and
evidence export only until a new scoped plan is independently authorized.

After restoration, the authenticated importer is the only writer of the imported
`SelfUpgradeRun` projection and corresponding change record. It records the
original signed envelope and journal digest in `completionEvidence`; it never
becomes an alternate execution writer or invokes the offline actions. Identical
run ID and digest are idempotent; a different digest is a conflict. The offline
journal remains the authoritative record of actions performed offline, while
the database row is its indexed projection. It cannot authorize a future run.

The recovery kit must be prepared and verified while healthy and copied to a
second independently retained location. It includes trusted signer public keys,
the signed trust manifest, executable recovery assets, exact rollback image
archive, Compose/configuration recovery metadata and installation identity
fingerprint. Private configuration is encrypted at rest using the operator's
existing offline key custody; credentials and business data are excluded from
the portable audit log. Verification checks kit hashes and performs a read-only
restore inspection before reporting the kit usable. The live install-state
directory is a restoration target, not the sole home of recovery inputs. If it
is missing, the adapter verifies the kit's installation binding against Docker
daemon/project/container labels and preserved mount identities; disagreement
stops intervention. It never silently selects another installation or daemon.

Trust enrollment is a separate, explicit operator/bootstrap ceremony, usable
without the portal: an OS-authenticated installation administrator pins an
operator public-key fingerprint and a distinct independent-verifier fingerprint,
then both sign the install-bound trust manifest. Keys supplied only by the
executor are not accepted. Existing organization/operator key custody is reused;
the recovery tool does not generate or retain signing private keys. The signed
manifest declares roles, install binding, validity, monotonically increasing
epoch and revoked fingerprints. Rotation requires the current operator and
independent verifier to sign the successor manifest; an older epoch cannot
replace a locally recorded newer epoch. Emergency replacement of lost trust is
a new independently witnessed enrollment, never an executor fallback. Offline
verification uses this pre-positioned manifest and its expiry, not an unavailable
approval-store query. Missing, expired or contradictory trust stops safely and
names the required out-of-band repair rather than inventing authorization.

The journal is append-only, sequence-numbered and hash-linked, written and flushed
before each consequential step. Restrictive permissions and symlink rejection
protect its directory. It contains hashes and action results, not credentials or
environment values. Reconciliation keeps the original signed envelope and log;
the platform receipt references their digest. A corrupt journal, unknown phase,
unverifiable signer, changed mount, changed source or ambiguous prior effect stops
at requiring intervention with no further mutation.

### Additive rollout and implementation boundaries

1. Expand the existing lease model with nullable fields, a typed recovery enum
   and an eligibility index. The forward-only migration must apply with active,
   queued, cancelled and terminal legacy rows present. Do not reset or backfill
   ownership, completed evidence, timestamps or retry budgets by guesswork.
2. Server readers and writers accept both versions. Legacy executors keep their
   existing lease path; upgraded executors explicitly advertise the recovery
   protocol. Generation checks fence writes, renewals and cleanup. Backfill only
   identities proven from their canonical source; otherwise retain legacy mode.
3. Deploy and verify the host worker and its authorized dispatch contract before
   any host stops spawning resumers. Host cutover is atomic under the host fence;
   existing executing runners drain. The original session may then die without
   losing dispatch. Retain old fields/readers during rollback; removal is later
   work after mixed-version proof, not part of the first migration.
4. Offline recovery uses versioned local files because the database may be down.
   Extend the existing `SelfUpgradeRun.completionEvidence` JSON reader additively
   for the signed report; no separate authorization/journal database table is
   required. Old readers may ignore the additive report. The importer rejects
   unknown versions and never overwrites a terminal predecessor. If implementation
   discovers a required schema change, revise and review this design first.

The server lease writer has exclusive precedence over test-execution authority.
For upgraded requests it atomically admits `waiting -> running` with a new
generation and assigned executor; only that executor/generation may renew,
report progress, settle or release. An infrastructure settlement cleans owned
processes, records the attempt, releases the active slot and moves to retry wait;
when eligible it rejoins the FIFO tail. Cancellation is terminal. Budget
exhaustion moves to intervention. Duplicate deliveries subscribe to the same
immutable request. A local host fence prevents duplicate host workers but cannot
grant or extend a server lease. With the control plane down, a currently admitted
runner keeps only its already granted bounded authority, then cleans up and
waits unrun; no host worker grants itself admission. Offline platform restoration
is a separate scoped bootstrap action and never grants test capacity.

Protocol-null rows remain legacy-owned. A running legacy row is never upgraded
or taken over. Conversion requires a queued/inactive row, positive proof that
the old executor and its descendants are gone, unchanged immutable source and
an atomic server-side version/generation check. Unknown liveness refuses
conversion. The server records the previous executor and new authorized host
assignment, while the host atomically switches dispatch mode under its fence.
Terminal completed rows remain terminal and reusable under existing evidence
rules. These invariants, including control-plane loss during cutover, are
mandatory mixed-version tests before disabling the legacy resumer on any host.

### Failure analysis and falsifiable exercises

All observations below are acceptance tests to implement and run, not passed
evidence. Documentation checks establish only the integrity of this draft.

| Trigger and effect | Prevention/containment and detection | Recovery proof |
|---|---|---|
| DNS disappears while job A owns capacity; job B starves | Structured dependency failure ends A's attempt without a code verdict; cleanup/release precedes backoff | VER-IT-2 blocks only A's dependency, observes B complete, restores DNS and observes A resume under the original identity without operator cleanup |
| Supervisor or runner is killed; stale owner renews or duplicate delivery runs twice | Persisted budget, start identity and generation fence; host reconciler distinguishes owner death from an unavailable probe | VER-IT-1 kills each execution boundary, injects duplicate supervisors and PID reuse, and asserts one executing runner and no successor termination |
| A quiet valid test is mistaken for a stall | Stage authority carries an explicit execution deadline; heartbeat is never progress | VER-IT-1 keeps a legitimate quiet test alive within budget, then separately freezes a stage beyond budget and verifies bounded cleanup and fair requeue |
| Shell text mentions the runner without executing it | Executable and argument-role classification plus actual ancestry | VER-IT-1 asserts sleeping wrappers and their sleep children are ignored while a real Node runner and descendants remain protected |
| A recovery receipt is forged, replayed or used for another install | Distinct trusted signers, exact plan/host/action/expiry binding and replay reconciliation | VER-OR-1 changes each binding independently and asserts zero mutations; repeated valid delivery reconciles the already completed operation |
| Crash, corrupt journal or partial swap leads to repeated side effects | Flushed intent, observed-state reconciliation, token ownership and exact recovery bytes | VER-OR-1 injects death before and after every write/swap boundary, then resumes or safely stops without erasing evidence |
| Rollback uses an incompatible image or replaces business data | Preposition known rollback image and matching configuration; preserve mounts; no schema downgrade or automatic DB restore | VER-OR-2 fails target health, restores the original image/state and compares business-data and mount identities before/after |
| Portal, MCP, approval store, queue or self-upgrade is down | Bootstrap runs from locally available verified assets and receipts; no control-plane call on the restoration path | VER-OR-2 denies each dependency and breaks the upgrade entry point, restores the isolated target, then reconciles original evidence once; unavailable gates stay unrun |

The implementation owner remains accountable for these risks in BI-02E5CE5A
and BI-7A4E70E9. No residual operational risk is accepted by this draft. Failed or
unrun exercises block recovery acceptance; independent design review evaluates
the proposed protections and testability, not nonexistent runtime results.

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
No initiative scope baseline exists for BI-02E5CE5A. The independent baseline
request currently depends on the routing repair recorded against BI-EE99767C.
This draft is not implementation authorization or evidence of delivered recovery.
