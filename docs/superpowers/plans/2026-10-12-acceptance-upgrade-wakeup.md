---
status: draft
---

# Preserve acceptance work across upgrades

Backlog: BI-E3B918C2. Workroom: WC-DC780E03.
Source inspected: 007eef1a3bc035a5f7906cf92cd2432819695534.

This is a bounded source-repair design and implementation record, not an
implementation admission or a completion claim. Native implementation admission
returned `initiative_not_ready` on 2026-10-12. Research, design approval,
architecture, baseline, author provenance, plan review, coverage and traceability
requirements remain unsatisfied. No receipt is implied by this document.

## Design grounding and boundary

Extend [delivery closeout](../specs/2026-09-04-delivery-closeout-cost-efficiency-design.md),
OBJ-DC-3/4, CT-DC-ACCEPTANCE, FLOW-DC-2/3 and AC-DC-6, using the existing
acceptance sweep. Preserve the October 3 deployment-closure addendum: delivery
may be done while acceptance remains pending. Do not reopen delivered originals
or turn deployment proof into acceptance PASS.

The user's instruction to improve this DEV process authorizes preparing source
changes and resolving blockers. It does not supply independent review receipts.
This proposal separates the bounded repair from the broad, unapproved
[September 5 plan](2026-09-05-delivery-closeout-efficiency.md). If reviewed and
admitted, it supersedes that plan's sequencing only for the wakeup and retained
obligation slice. It neither approves that plan nor completes the rest of E3.

Out of scope: a new scheduler, ledger or acceptance engine; release creation;
upgrading this install; gate-tiering changes; cleanup; UI redesign; equivalent
check batching; new automatic acceptance authority. E3's ten-obligation,
three-execution criterion remains outstanding after this slice.

## Source findings

- `apps/web/lib/self-upgrade/run-store.ts` records successful upgrade state but
  does not admit an acceptance sweep in `completeRun`.
- `apps/web/lib/queue/functions/agent-task-dispatch.ts` already reconciles due
  tasks every five minutes. Reuse this dispatcher, not a second cron function.
- `apps/web/lib/actions/agent-task-scheduler.ts` conditionally advances the due
  time before execution. Rewriting that time while an execution is active could
  admit another run. Advancing a date is not an execution lease.
- `apps/web/lib/backlog/acceptance-sweep/acceptance-sweep-task.ts` overwrites the
  next due time on both success and error, and stores the page cursor in the
  standing acceptance room's activity. A wakeup must survive completion writes.
- `acceptance-sweep-page.ts` selects only `awaiting-acceptance` items.
  `backlog-terminal-transition.ts` already records `acceptanceObligation` and
  `closureBasis` on deployment closure. These are the existing obligation source.
- `acceptance-sweep-evaluate.ts` uses the completion decision. That decision can
  permit delivery closure without proving acceptance; expanding selection alone
  would therefore be insufficient.

## Proposed implementation and tests

### 1. Durable wakeup through the existing task

Extend the existing scheduled task's typed configuration with an acceptance-only
checkpoint. Store pending upgrade identity and claimed generation separately from
the cadence. Reuse existing SelfUpgradeRun records as the recoverable source.
No event handler invokes the sweep directly.

The atomic claim must fence one active generation; completion must compare its
claim before acknowledging it. An upgrade arriving during execution remains
pending and schedules a later pass. Use the scheduled-task-row transaction
boundary specified below, not `nextRunAt` alone. Never hold its transaction while
checks execute.

Reconciliation belongs in the existing dispatcher before due-task selection.
Admit only successful, non-dry-run upgrades matching the authoritative served
identity. Duplicate notices coalesce. Missing events recover from persisted state;
an uncertain served identity remains pending. Respect disabled tasks and drain
state. Preserve unrelated configuration and daily sweep behavior.

Tests in colocated scheduler/sweep suites must demonstrate duplicate notices,
two simultaneous dispatchers, wakeup during both successful and failed execution,
crash after claim, restart without an event, disabled task, failed/dry-run upgrade,
unknown served identity and rollback. Assert execution count and durable pending
state, not only calls to a mock notification function.

### 2. Retain deployment-closed obligations

Extend the existing page selector to include deployment-closed originals whose
current evidence still requires independent acceptance. Use recorded closure
provenance and subsequent acceptance evidence, not every historical `done` row
or an old unresolved activity after a later pass. Malformed evidence is an
explicit unresolved obligation, never implicit PASS.

Keep delivery disposition separate from acceptance evaluation and routing.
Deployment closure must not make the owed-acceptance projection empty. Do not
close an already closed item again. Reuse independent-owner exclusion, existing
reviewer routing and corrective intake; do not invent grants or replay exhausted
review tasks. Preserve tenant and served-revision boundaries.

Extend page, evaluation and run tests for pending versus satisfied originals,
failed acceptance, malformed provenance, ordinary done items, customer/product
scope, duplicate correction, and later evidence that resolves an obligation.
Exercise cursor wrap with more than 500 rows and continuous fresh arrivals so
older obligations cannot starve. Assert originals remain done without a false
acceptance receipt.

## Independent review follow-up: scheduled-task transaction fence

The coordinator requested changes on the initial draft. Source inspection found
an existing durable lease in `apps/web/lib/jobs/postgres/store.ts`: `claimRuns`
claims JobRun plus JobConcurrencySlot; `renewLease` and terminal transitions compare
`leaseOwner`. `worker.ts` supplies a UUID-based worker identity, defaults to a
five-minute lease and renews every lease duration divided by three. These are
engine-owned records; application code must not query or mutate them directly.

This lease is not sufficient evidence of safe sweep takeover. In `engine.ts`,
`step.run` checks ownership before invoking its callback, then awaits that callback.
The sweep's snapshot, routing, closure, cursor and scheduling writes happen inside
the callback without its lease owner. `worker.ts` does not cancel that callback
when renewal returns false. A suspended callback can therefore resume after
recovery; the existing engine's guarded terminal transition alone cannot fence
those domain writes. This is a source finding, not a reproduced runtime incident.

Proposed extension: an acceptance-only transaction boundary on the existing
ScheduledAgentTask row, with versioned checkpoint data in its existing taskConfig.
This extends the scheduler; it does not read JobRun tables or create a new ledger.
The checkpoint contains ownerToken (a fresh UUID per claim), claimedRunId,
leaseExpiresAt, pendingRunId and acknowledgedRunId. Daily runs also receive a
fresh ownerToken; a null claimedRunId means cadence work, not upgrade acceptance.
Preserve all unrelated taskConfig properties. Malformed checkpoint state refuses
mutation and reports attention rather than resetting ownership.

All checkpoint operations first lock the same scheduled-task row with
`SELECT ... FOR UPDATE` inside a short serializable transaction. Claim requires
active/due work and no unexpired lease; it installs a fresh token and captures
pendingRunId without clearing it. Lease duration is five minutes, renewed every
60 seconds while the executor runs. Use database `clock_timestamp()` for expiry,
not client time or transaction-start `now()`. Renewal after expiry is refused,
even if no successor has claimed yet. Reclaim, renewal, wakeup and acknowledgement
serialize on this row. A lost renewal aborts further work locally, but the database
boundary, not the abort signal, is the safety mechanism.

`withAcceptanceSweepWrite(claim, callback)` locks that row, checks active status,
exact ownerToken and claimedRunId, and unexpired lease, then invokes a DB-only
callback with the transaction client. Recheck expiry after the callback before
commit and roll back if expired. Apply a bounded database transaction/statement
timeout; do not retry a mutation outside this boundary. A resumed stale worker
can read, but no write commits after its ownership expires or changes. A successor
cannot claim until an in-flight write transaction commits or rolls back.

Concrete adapter wiring, based on the inspected interfaces:

- `recordOwedAcceptanceSnapshot` already takes `OwedSnapshotDb`; pass the guarded
  transaction client. Both read-last-fingerprint and create belong inside it.
- `recordSweepRun` already takes `RoomDb`; its room upsert and activity append,
  including the cursor payload, use the guarded client. Final schedule and
  acknowledgement updates use the same boundary; an old error handler may not
  fall back to the current unconditional update.
- `routeAgedItems` and `issueAcceptanceObjectiveMappingPacket` take explicit DB
  clients. Prepare read-only candidates before taking the task lock, then route
  one candidate per guarded transaction, passing the SAME client into packet
  issuance and owner resolution. These inspected writers perform DB operations,
  not tool/model dispatch; the existing room drive acts after commit. Preserve
  the batch-wide route limit when extracting a per-candidate loop.
- `completeBacklogItemTransition` accepts `db: TerminalTransitionDb`, whose
  `$transaction` callback interface is defined in `terminal-transition-repository.ts`.
  Supply a narrow adapter that implements each requested serializable transaction
  through `withAcceptanceSweepWrite`. Do not supply a Prisma transaction client
  pretending it can open a nested transaction. The service's Git refresh precedes
  transaction creation and stays outside the fence. Its normal attempt AND its
  CAS-conflict audit retry each enter the adapter and revalidate ownership.
  Preserve all existing authorization, readiness and status CAS behavior.

In `executeScheduledAgentTask`, route acceptance tasks through this specialized
claim BEFORE the generic cadence claim; leave other task kinds unchanged. All
acceptance entry points, including daily/manual rerun, must use it. Completion
clears only its own token and acknowledges only its captured run ID. If a newer
pending run exists, keep it due for the next dispatcher; otherwise restore the
normal cadence. A wakeup during execution changes pending identity only, never
ownership. Failed execution does not acknowledge pending work; record bounded
retry state using the existing task attempts field and retry convention, without
spinning at every dispatch indefinitely. Confirm that convention in implementation
review before selecting the retry budget.

Production callback auditing is part of the gate: if a hidden path opens another
client transaction or performs network/tool I/O while holding the fence, extract
its read/preparation phase or identify it as an unresolved dependency. The adapter
must not weaken terminal authority or turn a refused claim into a successful run.

### Ordering and evidence rules for reassessment

Upgrade notices are hints, never ordering authority. Reconciliation reads the
latest successful non-dry-run canonical deployment using `(completedAt, id)` as a
stable database ordering, and validates its deployed identity against the served
target. Persist the exact run ID as identity; never order SHA strings. A newer
rollback run targeting an older SHA is a new generation. A delayed notice for an
older run cannot replace it. Ambiguous deployment order or uncertain served
identity must remain unresolved, not pick an arbitrary SHA. A sweep may acknowledge
only its captured run ID; a concurrently observed successor stays pending.

Candidate selection requires the current terminal transition to have
`closureBasis: canonical-deployment`, `to: done`, and a pending or failed acceptance
obligation. A historical matching activity alone cannot make an unrelated current
done item eligible. Reuse `objective-reconciliation.ts` for the current baseline,
latest mapping, referenced evidence and malformed/conflicting states. Use the
existing validated acceptance-evidence lane for small/documentation work, not a
free-text PASS or completion verdict. A later PASS discharges the obligation only
when its governed evidence is bound to the same item, current baseline/contract,
required independent reviewer and applicable deployed revision. A newer unresolved
baseline, failure or mismatched revision does not inherit that PASS. Extract the
acceptance read before `projectDeploymentClosure`; exclude `mergeAccepts` from
independent-acceptance proof. If the existing evidence contract lacks a required
binding, retain an explicit unresolved obligation rather than inventing it.

The decisive executable sequence for fencing review is: A claims; pause A inside
an actionable callback; expire/recover its lease; B claims; wake a successor
upgrade; resume A. Assert A cannot mutate a snapshot, route/close an item, write
the cursor, overwrite due time or acknowledge B's generation. Then terminate B
before acknowledgement, restart, and assert one valid successor completes. Run
this against the real persistence adapter in addition to unit fakes. A fake that
simply throws on an ownership check cannot prove the transaction boundary.

## Backlog coverage status

Parent and slice mapping: BI-E3B918C2. Proposed atomic repair: scheduling a sweep
that still drops closed obligations does not meet the intended outcome. The two
sections above are internal sequencing, not claims that all of E3 is implemented.
Requirement refs: OBJ-DC-3, OBJ-DC-4. Contract: CT-DC-ACCEPTANCE.
Flows: FLOW-DC-2, FLOW-DC-3. Verification: AC-DC-6 (partial slice only).

Receipt: not recorded. Independent review and supported native coverage
reconciliation remain required. The historical exhausted research TaskRun ending
7E9DAA6EEFB0 is not approval and must not be blindly replayed or replaced.

## Verification, refactoring and rollback

The initial directory claim left impact advice unresolved. Concrete file claims
now resolve the contract; related tests and the style guard were inspected.
Missing graph entries for new files are covered by colocated tests, not exemptions.
Write failing behavioral tests first, then affected suites and package typecheck.
Keep roughly 20% of implementation effort for consolidating scheduler completion
and acceptance-pool predicates rather than duplicating them across callers.

Independent review must cover atomic wakeup fencing, current-obligation selection,
and the distinction between completion readiness and acceptance readiness. Publish
through a DCO-signed protected PR only with truthful gate results. A later served
runtime exercise must show an upgrade causes a bounded pass, pending obligations
survive a restart, and author sessions are unnecessary. Source tests alone are not
that proof. Source tests have run; PostgreSQL and served-runtime checks remain
unrun pending the governed verification queue.

Rollback removes the new admission integration without deleting upgrade history,
obligation activities, accepted evidence or the existing daily sweep. A failed
admission must not roll back a successful deployment or erase pending work.

## Implementation checkpoint, October 12

The independent client design assessment passed draft SHA256
`38E396C79E9969BB90551F1CC9FBBE42BBF542DE19B5C998FC18D51F16146A5B`.
That assessment is not a native receipt or approval of later source changes.

The candidate implements upgrade admission, restart reconciliation, task-row
ownership, guarded writes, and a shared round-robin candidate cursor. The cursor
now covers fresh and revisited candidates together; unbounded priority for fresh
items could starve older obligations. Revisit estimates include rejected historical
candidates because reading them consumes page capacity too.

Git refresh and deployment/merge signal reads run before the completion fence.
Their exact database inputs are reread through the locked transaction client;
changed inputs or expired preparation refuse the close. The existing terminal
service still evaluates all remaining readiness and performs its own status CAS.
Both its ordinary transaction and CAS-conflict audit retry use the owner fence.
Transactions have bounded lock/statement timeouts and at most three attempts for
serialization or deadlock conflicts. No mutation retries outside the fence.

Expired execution gets one immediate recovery per generation/cadence cycle,
using the existing attempts field. A second crash falls back to normal cron.
A new upgrade resets this recovery budget. Ordinary reported failure also uses
the existing cron fallback; it does not acknowledge pending work.

There is a retained-evidence limitation. Existing objective mappings validate
their reviewer packet when written but do not persist its revision binding;
execution evidence has no typed deployed-revision binding. Current baseline or
historical PASS alone therefore cannot discharge a retained obligation. Such
items remain done with an explicit unresolved acceptance snapshot, no invented
receipt, no author session, and no automatic replay of an exhausted reviewer.
Repairing that evidence contract remains under BI-E3B918C2. Equivalent-check
batching and the broader cost/throughput objectives are also not complete.

Source checks have demonstrated merge-versus-acceptance separation, stale-owner
refusal, changed-input refusal, date-sensitive input comparison, and cursor
progress across 601 old candidates with continuous fresh arrivals. The broader
affected suite passed 433 tests before the final refactoring pass. Subsequent
checks are recorded in the Workroom; these counts are not runtime qualification.

The PostgreSQL suite uses the production Prisma adapter and write ports against
a unique test schema copied from the governed target's table definitions. It
covers competing claims, bounded crash recovery, late owners, successor wakeups,
write-port fencing, and expiry during a transaction. These tests are unrun until
the shared-environment queue admits the request. Final source assessment, protected publication,
and served verification remain outstanding.

## DEV recovery checkpoint

On October 12 the operator explicitly authorized bypassing broken process as
needed. The documented `operator-emergency` publication path may record the
local gate as skipped, never passed; DCO, independent assessment, deterministic
source checks and protected CI remain required.

Read-only MCP evidence showed the original lease expired without admission,
while its TaskRun remained submitted with no heartbeat and an unconsumed
capacity-available event. That is not an executing PostgreSQL test. One fresh
request queued, but the admission response reported zero safe capacity. No
runtime was changed and none of the six PostgreSQL tests executed.

Native evidence recording was refused because the current assistant was not
admitted to the existing Workroom. Its prescribed executor handoff awaits
approval. A request to cancel the replacement queued lease also awaits approval.
Neither action is recorded here as executed; no direct database workaround was
used. The coordinating recovery owners have both exact requests. This local
record preserves the evidence until canonical recording is authorized.

The final source audit reproduced a page/evaluation race: an item closed after
page selection could project as closable. Evaluation now also honors the current
decision's done-state binding and retains its unresolved acceptance obligation.

Independent source review requested two corrections on `15aa77661ed`. Raw-query
Prisma adapter conflicts now inspect only the wrapped SQLSTATE for serialization
or deadlock; unrelated and uncertain failures are not retried, and the three-try
bound remains. Real Prisma error-class fixtures reproduced the missing retries.
The production close adapter now has regression coverage through the real
terminal CAS-conflict audit retry, with simulated transaction rollback and
expiry/takeover between attempts. Removing ownership checks made both stale
retry tests fail; restoring them made the tests pass. This source-local
coverage does not replace the still-unrun PostgreSQL qualification.

## Retained reviewer/runtime binding continuation — October 16

Continue EXISTING BI-E3B918C2 / WC-DC780E03 after the inactive author's explicit
handoff. Preserve branch fix/acceptance-upgrade-wakeup, original source37a75a5,
merged PR6230/dfa821e and its evidence. Normal Large DESIGN claim
IRD-F897407D4838 allowed preparation only. Implementation remains unadmitted;
old exhausted reviews and generic PortfolioAgent notes are not approvals.

The canonical contract is the October 16 retained acceptance binding addendum in
[delivery closeout](../specs/2026-09-04-delivery-closeout-cost-efficiency-design.md).
It retains CT-DC-ACCEPTANCE, OBJ-DC-3/4 and AC-DC-6. Kernel decision
DI-AF2BCA4787FD chose RuntimeVerification with server-owned typed binding;
usable/autonomyEligible true, estimates grade C, agent outcome recorded. This
slice does not claim equivalent-check batching or full E3 acceptance.

### Source evidence and sequence

At inspected ca812ae29d364fff864ae8271532a4a8f5a45090:
retained-acceptance.ts explicitly names the missing contract;
acceptance-sweep-evaluate.ts sends Done work to that fallback before owner
selection; objective-mapping-repository.ts validates the request but persists
no applicable runtime binding; runtime-targets.ts records general result JSON.
D33 is Small/Done, so the Medium-only6451 criteria/archived-author route does
not repair its retained obligation. These are read-only findings, not a pass.

1. Complete the concrete server-issued criteria/plan and TaskRun binding contract
   for legacy Small and existing governed baselines. Keep their semantics
   distinct. Audit the actual issuer-to-tool-context path, authority exclusions
   and one-primary-attach validation. Resolve missing immutable criteria through
   a prospective independently approved plan; never invent historical provenance.
   Obtain native design/spec/architecture approval and exact plan coverage/review
   before normal Large implementation admission. Reuse existing records; do not
   reconstruct or replay an exhausted review packet.
2. After admission and exact path/impact claims, write failing issuer/writer and
   persistence regressions. Reject same author/agent, ambiguous identity, revoked
   authority, foreign subject/tenant/install, missing criteria, forged result
   binding, generic manual notes, stale authored/merge/served identity, rollback,
   changed body/plan, expired TaskRun generation and unknown schema versions.
   Verify duplicate equality versus conflicting completion and later failures.
3. Extend the existing sweep/runtime-verification path and one shared binding
   validator. Keep network/check execution outside transactions and revalidate
   immutable prepared proof and current owner inside. Resolve receipt lookups by
   original closure activity; justify any forward-only index on existing fields.
   Use the real database transaction and existing scheduler ownership fence.
4. Consume the same validated receipts in retained acceptance and Task Hub
   projection. Preserve original Done delivery, partial-panel fail, review rounds
   and old Task records. Missing proof gives the actual next owning action;
   delivery or a prose claim cannot become acceptance. Check keyboard, themes,
   narrow screens and unavailable/partial/failed states on a containing install.
5. Run affected tests and official package types, native issuer-to-writer and
   real PostgreSQL tests, 601 continuously arriving obligations and a10,000-receipt
   lookup fixture. Obtain independent exact-source review, the governed gate,
   DCO/protected CI/queue and canonical deployment. Then independently exercise
   D33's actual delivered behavior and verify its typed acceptance is consumed.
   Preserve every original row; no unknown review becomes settled by this test.

Reserve roughly20% of implementation effort for consolidating identity,
criteria/runtime binding and eligibility across issuer, writer, sweep and read
model. Do not clone objective-mapping baseline semantics or create a table,
scheduler, reviewer override or result ledger. Rollback preserves all receipts
and pending obligations while disabling the new consumer/actuator.

Native approval, coverage, implementation admission, code, tests, index migration
and live acceptance for this continuation are UNRUN. This documentation does not
change that status. The earlier wakeup/fencing delivery and its historical gates
remain separately attributed.
