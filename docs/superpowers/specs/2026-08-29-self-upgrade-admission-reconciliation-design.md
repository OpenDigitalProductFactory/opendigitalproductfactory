---
status: active
---

# Durable Self-Upgrade Admission and Dispatch Reconciliation

**Backlog item:** BI-3FD07259
**Workroom:** WC-25858CAB
**Branch:** `fix/durable-self-upgrade-admission-and-dispatch-reco`

## Problem

The Upgrade Center persists a `SelfUpgradeRun` before sending the manual Inngest
event, but the server action waits for that network call before it returns an
identity to the browser. The UI therefore cannot distinguish a slow accepted
request from an unaccepted click. It eventually clears its local busy state on a
timer even when the durable disposition is still unknown.

Two production fixtures demonstrate the gap:

1. An accepted click returned no durable outcome for about 52 seconds. The row
   later appeared as `SUR-D71E8971` and failed before mutation with
   `queue-dispatch-failed: fetch failed`.
2. A replacement click settled after about 10 seconds with no `SelfUpgradeRun`
   row and no durable UI outcome.

Both outcomes invite a second click while the first physical action may still be
admitted. That is unsafe for a workflow whose next step drains and replaces the
running portal.

## Outcome

The server atomically admits one immutable self-upgrade request before any
asynchronous dispatch. It returns the admission/run identity immediately. The
same row records dispatch ownership, attempts, acknowledgement, ambiguity, and
terminal failure. A post-response dispatcher plus the existing portal startup
maintenance loop reconcile the row by the same identity. Duplicate sends use a
stable event id, and the worker uses a database compare-and-swap before it may
begin a physical upgrade.

The Upgrade Center projects the durable state instead of a client timer. It
keeps the action unavailable while admission disposition is unknown and explains
whether the request is admitted, waiting for the job engine, dispatched, or
failed before dispatch.

## Governed scope manifest

- **OBJ-SUA-001:** Give every accepted upgrade request a durable server-issued
  admission identity and exact immutable target before returning to the caller.
- **OBJ-SUA-002:** Reconcile delayed, failed, and ambiguous queue dispatch by the
  same identity without starting a duplicate physical upgrade.
- **OBJ-SUA-003:** Present one truthful operator state and keep the trigger
  unavailable while the request's disposition is unknown.
- **OBJ-SUA-004:** Preserve quiescence, emergency-override, release binding, and
  newer-run checks as fail-closed authority boundaries.

| Acceptance | Objectives | Statement | Design evidence |
| --- | --- | --- | --- |
| AC-SUA-001 | OBJ-SUA-001 | Manual and MCP admission persist a `pending` run with exact target SHA, target tag when applicable, force posture, actor, impact summary, fingerprint, and dispatch state before returning its run id. | Admission transaction |
| AC-SUA-002 | OBJ-SUA-001, OBJ-SUA-002 | Dispatch uses a stable event id derived from the run id, a bounded database lease, and recorded attempt/acknowledgement fields. | Dispatch state machine |
| AC-SUA-003 | OBJ-SUA-002, OBJ-SUA-004 | Only the latest exact-bound pending run may be dispatched; target drift, a newer run, changed force posture, or a fresh activity refusal ends or defers without mutation. | Reconciliation invariants |
| AC-SUA-004 | OBJ-SUA-002 | A transport timeout or process loss leaves the same run recoverable; boot/periodic reconciliation retries it without a second click. | Recovery flow |
| AC-SUA-005 | OBJ-SUA-002, OBJ-SUA-004 | The worker atomically claims an admitted row once, so queue deduplication expiry or duplicate delivery cannot start a second physical upgrade. | Consumer CAS |
| AC-SUA-006 | OBJ-SUA-003 | The existing control shows durable pending, dispatching, queued, indeterminate, and dispatch-failed outcomes and never unlocks on a blind timer. | Operator projection |
| AC-SUA-007 | OBJ-SUA-003 | A response interruption after admission still converges from server data; no local success state is treated as evidence. | Operator projection |
| AC-SUA-008 | OBJ-SUA-004 | Emergency override remains explicit and immutable per admission; ordinary activity/quiescence preflight remains authoritative and cannot be bypassed by reconciliation. | Authority boundary |

## Governed design-review recording contract

The immutable reviewer must use the canonical
`record_initiative_design_review` disposition schema exactly. A `pass` decision
requires both `findings = []` and `resolvedFindingRefs = []`. Positive
observations belong only in the reviewer `reason`; they are not findings. Any
finding requires `decision = fail` (or another canonical non-pass disposition
supported by the server-issued schema). The writer remains fail closed when a
proposed disposition contradicts this contract; neither approval nor replay may
rewrite the reviewer's arguments.

## Existing substrate and ownership boundary

This change extends the canonical `SelfUpgradeRun`, `triggerSelfUpgrade`,
`requestSelfUpgrade`, Inngest manual worker, and `/ops/self-upgrade` control. It
does not introduce another queue or upgrade command.

BI-6CB35411 separately owns consumer runtime identity convergence. This design
records and validates the target tag/SHA it is given, but it does not change
`dpf-start.ps1`, `DPF_IMAGE_TAG`, install-state, compose selection, or OCI labels.
If those identities still disagree after this repair is live, BI-6CB35411 remains
a hard prerequisite before any reviewer replay.

### Normative dependency disposition

BI-6CB35411 is an explicit out-of-scope dependency, not an omitted BI-3FD07259
requirement. A conforming BI-3FD07259 implementation **must not** edit consumer
start/restart selection, `DPF_IMAGE_TAG`, install-state, Compose image selection,
or OCI labels. Its responsibility ends after it durably binds and dispatches the
exact release-artifact tag and SHA supplied by the canonical target resolver.
BI-6CB35411 independently makes those runtime identities converge and remains a
hard delivery prerequisite before BI-F48 resumes. A design-review finding that
claims this design omits runtime identity convergence contradicts this normative
scope boundary; a genuine finding must instead identify a defect inside the
admission, dispatch, reconciliation, worker-CAS, or operator-projection contract.

## Admission transaction

`admitSelfUpgrade` resolves support and the exact target on the server, then
creates the canonical row in one transaction:

- `status = pending`;
- `targetSha` and, for a release install, `targetTag`;
- `requestedForce`, `trigger`, and `impactSummaryId`;
- `admissionFingerprint`, a hash of target kind, SHA, tag, force posture, actor,
  and impact-summary identity; and
- `dispatchStatus = admission_pending`, attempt count zero, and no lease.

The transaction refuses when another `pending`, `queued`, or `running` run
exists. A unique admission fingerprint makes a repeated server invocation for
the same still-active request return the same row rather than create a second
one. Closed dispatch states use a Prisma enum.

The server action schedules `dispatchSelfUpgradeAdmission(runId)` with Next.js
`after()`, which is supported in Server Functions and Docker. The response is
not coupled to the queue round trip: the caller receives the durable run id as
soon as admission commits. Startup and periodic maintenance are the independent
recovery path if the process exits before or during that callback.

## Dispatch state machine

The row carries these dispatch states:

```text
admission_pending -> dispatching -> dispatched
        ^                 |             |
        |                 v             v
        +--------- indeterminate     worker claim
                          |
                          v
                   dispatch_failed
```

`claimDispatch` is a transaction that checks the stored binding, verifies this
is still the latest nonterminal run, and acquires a short lease with a random
token. It increments the attempt count and records `dispatching` before network
I/O. The sender uses `id = self-upgrade:<runId>` and stores returned provider
event ids on acknowledgement.

A definite queue refusal records `dispatch_failed`, terminal run failure, and a
safe operator explanation. A timeout, connection loss, or process exit is not
proof that the queue rejected the event; it records or leaves `indeterminate`.
Reconciliation reacquires only an expired lease and resends the same event id.
It never creates a new row.

Inngest event-id deduplication covers duplicate sends for 24 hours. Because that
window is not a permanent exactly-once guarantee, `startRun` also performs a
consumer-side compare-and-swap from the admitted/queued lifecycle to `running`.
A duplicate delivery after the deduplication window observes an already claimed
or terminal row and returns without preflight, drain, or swap.

## Reconciliation invariants

Before every dispatch or resend, the reconciler verifies:

1. the row remains the latest `SelfUpgradeRun`;
2. its status is `pending` or `queued`, without `completedAt`;
3. its admission fingerprint still matches its stored actor, target, tag,
   force posture, and impact summary;
4. the canonical target resolver still returns the same target kind, SHA, and
   tag; and
5. no unexpired dispatch lease is owned by another process.

Target drift or a newer run fails closed. Activity and quiescence are deliberately
not predicted by admission: the existing authoritative worker preflight retains
that responsibility and may skip safely before mutation. Reconciliation never
sets emergency override and cannot alter the stored force posture.

## Operator experience

The existing Upgrade Center control remains the single action surface. It does
not add another button or advanced operator choice.

- `admission_pending` / `dispatching`: **Request accepted — connecting to the
  upgrade engine.** The run id is visible and the action remains disabled.
- `indeterminate`: **Request accepted — delivery is being reconciled.** The
  action remains disabled; the operator is not told to click again.
- `dispatched` / `queued`: **Upgrade queued.** Existing live status takes over.
- `dispatch_failed`: **The accepted request could not reach the upgrade
  engine.** The exact run id and durable failure are shown. A future recovery
  attempt is system-owned, not another click.

The 45-second `justQueued` unlock is removed. Client network errors trigger a
refresh and say that admission is being checked; only server state decides
whether the button can re-enable.

## Research and benchmarking

- [Inngest event idempotency](https://www.inngest.com/docs/guides/handling-idempotency)
  deduplicates a stable event id for 24 hours. DPF adopts this at the producer
  boundary but rejects relying on it alone because the window expires.
- [AWS Step Functions `StartExecution`](https://docs.aws.amazon.com/step-functions/latest/apireference/API_StartExecution.html)
  treats the same Standard Workflow name and input as an idempotent start while
  it is running. DPF adopts the same stable-identity/bound-input semantics in
  `SelfUpgradeRun`, without introducing another workflow engine.
- [Temporal](https://docs.temporal.io/) demonstrates durable workflow recovery
  across process and infrastructure failures. DPF adopts durable state plus
  independent reconciliation, while retaining the existing Inngest and Prisma
  substrate.
- [Next.js `after`](https://nextjs.org/docs/app/api-reference/functions/after)
  provides the supported post-response execution primitive for Server Functions
  and Docker. DPF uses it only as the fast path; the database reconciler remains
  authoritative if the callback never completes.

## Rejected alternatives

- **Await queue dispatch before returning.** This is the current ambiguity: the
  browser loses the durable run identity when the transport is slow or reset.
- **Let the browser retry or generate the id.** Authority and target binding
  belong on the server, and a second click is not a recovery protocol.
- **Mark a send exception terminal immediately.** A transport exception cannot
  prove the queue did not accept the event.
- **Use only Inngest event deduplication.** Its documented window is 24 hours;
  consumer CAS is still required.
- **Add a second dispatch table.** `SelfUpgradeRun` is already the canonical
  admission, lifecycle, audit, and UI record.
- **Fold in BI-6CB35411.** Runtime tag convergence is a separate consumer-start
  defect and expands this repair beyond the dispatch boundary.

## Scale ceiling and retention

Self-upgrade is globally serialized and produces at most a small number of rows
per release. The reconciler scans only nonterminal rows with indexed lifecycle
state and a bounded batch. Lease acquisition is transactional; no polling loop
runs faster than the existing maintenance cadence. Dispatch metadata remains on
the run for the same operational-history retention as the upgrade itself.

## Verification

Tests must prove:

- both exact production fixtures return or converge on one durable run identity;
- admission is committed before the mocked dispatch starts;
- a delayed/throwing dispatch leaves one recoverable row and a stable event id;
- concurrent reconcilers acquire one lease and duplicate deliveries claim the
  worker once, including after the provider dedupe window;
- target, tag, fingerprint, force, newer-run, and lease conflicts fail closed;
- the existing action remains disabled for pending/dispatching/indeterminate and
  has no timer-based re-enable;
- ordinary queued/running/succeeded/failed/skipped history remains compatible;
- startup and periodic recovery resend only eligible rows; and
- the migration applies to a database containing historical self-upgrade rows.

Live acceptance requires one canonical release and one governed action whose
UI returns a run id immediately, whose persisted dispatch transitions are
observable, and whose physical upgrade completes at most once. Served SHA,
health, preserved data, and CAN-TEST remain mandatory.
