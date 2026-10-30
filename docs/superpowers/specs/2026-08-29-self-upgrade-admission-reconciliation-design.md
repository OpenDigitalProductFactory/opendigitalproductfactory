---
status: active
---

# Durable Self-Upgrade Admission and Dispatch Reconciliation

**Backlog item:** BI-3FD07259
**Workroom:** WC-25858CAB
**Branch:** `fix/durable-self-upgrade-admission-and-dispatch-reco`

**Proposed amendment, 2026-10-30:** original-request disposition and legacy
uncertainty; DESIGN Workroom WC-1EDB2880 on
`codex/upgrade-admission-disposition`. This amendment is a review proposal, not
an implementation approval or a disposition of a historical upgrade request.
The original Workroom, delivered source, and acceptance history remain intact.

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
- **OBJ-SUA-005:** Keep one verified immutable release target available through
  a bounded transient registry failure without weakening action-time authority.
- **OBJ-SUA-008:** Resolve an original request through a caller-owned, issuer-bound
  read without dispatching, retrying, finalizing, or changing runtime state.
- **OBJ-SUA-009:** Preserve historical `UNKNOWN` when genuine original provenance
  is unavailable; prospective identities cannot settle an uncorrelated attempt.

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
| AC-SUA-009 | OBJ-SUA-004, OBJ-SUA-005 | After live registry discovery agrees with a fresh successful publisher snapshot, a later transient registry failure may reuse only that exact bounded candidate; stale, conflicting, unverified, wrong-install, wrong-platform, malformed, or Git-source evidence remains unavailable. | Verified release-target fallback |
| AC-SUA-017 | OBJ-SUA-001, OBJ-SUA-008 | Before an upgrade can be submitted, its issuer-owned original locator and immutable authority binding are durably recoverable by its authorized caller; a locator returned only after admission is insufficient. | Original-request preparation |
| AC-SUA-018 | OBJ-SUA-002, OBJ-SUA-008 | Repeated submission of that exact locator returns its same durable outcome, including after completion; matching an active fingerprint is never original-request attribution. | Original-request transition |
| AC-SUA-019 | OBJ-SUA-003, OBJ-SUA-008 | Exact readback returns admitted, terminal-nonadmitted, ambiguous, or unavailable and invokes no admission, finalization, reconciliation, scheduling, dispatch, lease, or runtime mutation. | Read-only disposition |
| AC-SUA-020 | OBJ-SUA-004, OBJ-SUA-008 | Terminal non-admission requires authoritative completion of the original request and a durable barrier excluding its late admission, dispatch, and effects. Missing rows, expiry, elapsed time, or an empty history cannot establish that outcome. | Completion barrier |
| AC-SUA-021 | OBJ-SUA-003, OBJ-SUA-009 | Unrelated latest runs, matching target/actor/time, new signatures, later success, and new fences never settle an uncorrelated historical request or clear its uncertainty. | Legacy provenance |
| AC-SUA-022 | OBJ-SUA-004, OBJ-SUA-008 | Wrong-principal, wrong-install, malformed, or unsupported locators fail closed without revealing another caller's request; existing capabilities and grant intersections remain authoritative. | Caller-owned projection |
| AC-SUA-023 | OBJ-SUA-003, OBJ-SUA-009 | Reload and navigation preserve exact caller-owned uncertainty; a legacy request with irrecoverable original provenance remains UNKNOWN with an accountable missing-capability disposition. | Operator projection |
| AC-SUA-024 | OBJ-SUA-004, OBJ-SUA-009 | Present-operation eligibility is separate from historical outcome and confers no replay or waiver without its own approved operation-specific contract and actual admission. Independently authorized deployment may satisfy current delivery without settling history. | Present-operation boundary |

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
- the migration applies to a database containing historical self-upgrade rows;
  and
- a successful registry read followed by a transient failure retains the exact
  fresh verified release target, while absent/stale/red/conflicting evidence
  remains unavailable.

Live acceptance requires one canonical release and one governed action whose
UI returns a run id immediately, whose persisted dispatch transitions are
observable, and whose physical upgrade completes at most once. Served SHA,
health, preserved data, and CAN-TEST remain mandatory.

## Bounded verified release-target fallback

The live `f13fcf1c` pre-action fixture proved that release-artifact projection
was volatile: one page read resolved the exact immutable release and issued a
signed binding, while a later read in the same unchanged process returned
`Target: unknown` after transient fetch degradation. The already-verified
`release_health.latest` publisher state remained exact and healthy throughout.

The repair extends that existing PlatformConfig row rather than creating a
second target store. A successful live registry read may attach one
`verifiedTarget` attestation only when the row's current publisher snapshot is
`verified`, has a successful workflow conclusion, and exactly matches the
candidate tag, source SHA, and publisher run id. The attestation binds the GHCR
owner, channel tag, install mode, installed image tag, running config digest,
Linux platform/architecture, and all three registry-verified image digests.
The write uses a serializable transaction so a concurrent health poll cannot be
overwritten by an older page observation.

On a later registry failure, `resolveSelfUpgradeStatusTarget` may use that
candidate only when both the publisher snapshot and attestation are no more
than 30 minutes old and every bound install, platform, tag, SHA, publisher, and
digest field still validates. The normal current-config comparison still
decides whether the candidate is pending or already installed. Matching health
polls preserve the attestation; a changed, red, in-progress, ambiguous, or
unsuccessful publisher identity clears it. Missing evidence remains target
unavailable.

This fallback never applies to Git-source installs and never converts failed,
stale, malformed, mismatched-owner/channel/architecture/digest, or unverified
evidence into authority. It does not persist or reuse a client signature. The
page still issues a fresh server-signed expiring release-artifact binding, and
the action still performs its ordinary binding, target, predecessor,
quiescence, and emergency-override checks at execution time. PR #4863 remains
the single owner-state/UI projection contract; this extension changes no UI
surface.

## Source-free registration and persisted-target reconciliation extension

Live acceptance of `SUR-6B312E24` exposed two coupled recovery defects after
the original admission contract shipped:

1. a consumer portal with `APP_URL` unset self-registers through
   `http://localhost:3000/api/inngest`; inside the Linux container that name can
   resolve to `::1` while the Next listener is reachable only on IPv4, so the
   real registration PUT fails even though `127.0.0.1:3000` is healthy; and
2. the dispatcher asks Git-backed target discovery to rediscover a release
   target after admission. A source-free consumer has no usable
   `/host-dpf` Git remote, so a null discovery result leaves the already
   authenticated, exact-bound durable run permanently indeterminate.

The repair keeps `SelfUpgradeRun` as the single authority. When no explicit
`APP_URL` is configured, the portal uses its server-owned loopback listener at
`127.0.0.1` and the effective `PORT`. An explicit configured URL remains
authoritative. Registration health is persisted as successful only after the
actual PUT returns an OK response. That transition immediately invokes the
existing idempotent admission reconciler so an accepted run does not wait for
the maintenance interval.

For dispatch, a resolved current target must still match the stored target
exactly. If release discovery is unavailable, the dispatcher may reconstruct
only a `release-artifact` target from the stored SHA/tag and accept it only when
recomputing the admission fingerprint from every persisted authority field
matches exactly. A null resolver never authorizes a `git-source` admission,
an untagged release, or a fingerprint mismatch. No client field is re-read and
no new run is created. A later conflicting resolved target remains terminal
drift.

`SUR-6B312E24` is the immutable live fixture. It must remain the sole run while
this source repair is developed and published. Once the repair is served, the
normal reconciler may claim and dispatch that same run with stable event id
`self-upgrade:SUR-6B312E24` exactly once under the existing lease and worker
compare-and-swap contracts.

### Extension acceptance

- With `APP_URL` unset and `PORT=3000`, the self-registration endpoint is
  `http://127.0.0.1:3000/api/inngest`; explicit `APP_URL` is normalized without
  changing its host.
- A failed or non-OK PUT persists failure and never triggers admission
  reconciliation; a successful PUT persists success and triggers reconciliation.
- A null target resolver can dispatch one exact fingerprint-valid tagged
  release admission but leaves Git-source, untagged, or corrupt bindings
  fail-closed and indeterminate/failed according to the existing state machine.
- Resolver drift, unhealthy job-engine state, newer runs, active leases, and
  duplicate worker delivery retain their current refusals.
- Live proof uses no second click or replacement run: the already persisted
  `SUR-6B312E24` must reach a truthful terminal dispatch/result through
  reconciliation.

### Terminal old-target and source-free bootstrap correction

The live `SUR-6B312E24` fixture closed in `failed` with an immutable target from
an older release. A terminal row is historical evidence, not a mutable retry
slot: reconciliation must return a fail-closed terminal disposition without
rewriting its target, status, fingerprint, or failure evidence. It must never
dispatch that row toward a later release.

When the current release target is available only through a server-owned,
authenticated release binding, the existing operator action is the sole
bootstrap boundary. There is no second bootstrap export or alternate admission
path. The action verifies the signed, expiring release binding before it supplies
`recoveryOfRunId` to the transaction; the ordinary request path cannot supply
that field. This boundary proves that the superseded row is the exact latest terminal run,
accepts only a distinct tagged `release-artifact` target from the authenticated
server binding, and creates one separately fingerprinted admission through the
same atomic transaction. `SelfUpgradeRun.recoveryOfRunId` is a unique typed
self-relation, so a predecessor can have at most one successor and the
predecessor's target, status, fingerprint, failure, and timestamps remain
untouched. This supersedes the earlier "no replacement run" acceptance only for
the proven terminal-old-target case; predecessor immutability remains normative.
No client-provided SHA/tag, Git fallback, row reopening, downgrade, emergency
override, or direct queue send is accepted. Active or ambiguous predecessors,
newer runs, an existing successor, untagged/Git targets, target drift, and
missing or expired authentication all remain fail closed. The normal
worker/quiescence gates still decide whether the new admission can perform a
physical upgrade.

`recoveryOfRunId` is audit metadata, not dispatch authority. Dispatch authority
comes only from the successor admission's independently verified signed target
binding and its own recomputed admission fingerprint. The additive migration
checks structural predecessor evidence but does not cryptographically recompute
the historical predecessor fingerprint. Its trust premise is the integrity of
server-created historical rows; the residual risk is a previously corrupted
predecessor being linked for audit. That link cannot authorize, retarget, or
dispatch either row. Migration tests statically assert the SQL contract; live
acceptance must separately inspect the migrated rows and the independently
authorized successor dispatch.

### Bootstrap ordering

The current source-free runtime predates `recoveryOfRunId`, so publication alone
cannot prove this contract live. After the protected repair release is published,
the existing operator page must render a fresh signed binding for that exact tag
and SHA. One separately authorized click may then use the already-live durable
admission path to create and dispatch a new, separately fingerprinted run; a
plain retry without the signed binding is refused. When the new container starts,
the additive migration links that singular in-flight manual release admission to
the immediately preceding failed pre-dispatch run only when every CAS predicate
holds. Any ambiguity leaves the relation null and fails live acceptance. Served
SHA, CAN-TEST, the successor relation, the unchanged predecessor row, and ordinary
restart coherence are all required before downstream recovery resumes.

## Proposed original-request disposition amendment — 2026-10-30

### Current evidence and limits

BI-CE244260 supplies the actual interrupted-click acceptance context for this
BI-3FD07259 amendment. One logged-in operator action targeted public PR #6594,
SHA `f63d7fbc0bac50fb09320532e6e9831944ca1f1c`, on 2026-10-26 between
08:08 and 08:18 UTC, with emergency override off. Its response was interrupted.
No original request, run, or client-attempt key was returned or retained. Its
historical outcome remains `UNKNOWN`. The retained-response investigation is
exhausted; this amendment does not authorize another search or action.

At served source `4718cd4f1c5418ab2eba819dd47d5cb839f8eca0`, the relevant
protocol is unchanged in inspected protected source
`641248e9e8e4999c369c1c85792918f9d521f91b`:

- `promotions.ts:738–795` accepts no original locator and returns a run id only
  after admission. `admission.ts:139–155` fingerprints authority fields, not a
  click. `run-store.ts:102–113` coalesces matching active rows only.
- `run-store.ts:179–183,724–725` reads by a known run id; its latest-row read and
  the paged history action do not attribute an original click.
- `SelfUpgradeTriggerControl.tsx:205–213` clears uncertainty on a generic server
  signature change. The swap-resilience test at lines 220–254 expects an observed
  succeeded latest run to unlock the control without original correlation.
- `admission.ts:351–360` reconciles by dispatching. It is a consequential recovery
  operation, never the read-only resolver proposed here.

The earlier AC-SUA-007 convergence promise therefore needs original provenance.
This amendment narrows that promise explicitly: convergence applies only to an
exact original request identified by issuer evidence. No historical acceptance,
delivery receipt, successful later run, or source test is rewritten as proof of
the uncorrelated click. OBJ-SUA-006/007 and AC-SUA-010–016 remain owned by the
existing exact-target recovery design; their known-terminal predecessor rules
do not apply to this case.

### Original-request preparation and transition

The proposed prospective protocol prepares an issuer-owned `SelfUpgradeRun`
identity before enabling submission. A separate authenticated preparation write
returns that opaque identity; it never admits an upgrade, sends an event, or
starts a physical action. Preparation is not performed by a status GET or the
disposition read. The existing single visible Upgrade now control remains the
action surface; there is no second upgrade button or browser-generated id.

The candidate representation extends `SelfUpgradeRun`, not another table or
queue. A `prepared` lifecycle/dispatch state holds the server-issued run id,
canonical requesting Principal, exact target/tag, force/dry-run/routine posture,
impact identity, and existing binding fingerprint. A `not_admitted` state uses
the same row's completion timestamp and safe reason for definitive rejection.
The precise enum/schema migration is subject to data-model review. Dispatch
state must be non-null for these new protocol rows: today's null-state worker
compatibility branch returns `legacy` and must never execute a prepared intent.

The issuer maintains one indexed unresolved manual intent per caller on this
installation. Preparation retries recover that same intent; repeated reloads
cannot accumulate reservations. The caller may carry the locator but cannot
choose its identity, binding, owner, generation, or disposition. Changing target
or force cannot silently replace an unresolved intent. A new intent requires an
explicit new-operation transition from an observed closed predecessor; it does
not reuse the old identity. Preparation must not block independently authorized
scheduled work merely because a person viewed the page.

Admission locks that exact row through the existing serialized admission
boundary, rechecks current authority and immutable inputs, and atomically
transitions it to the existing admitted `pending` state before any dispatch.
Repeating its locator returns the same admitted or rejected outcome even after
the run terminates. Another active row is a conflict, not attribution to this
intent. Fingerprints remain binding checks; they are not request receipts.

Every admission/finalization path participates in the same completion barrier.
An issuer rejection can close the original request only after its admission
transaction has either committed as admitted or been excluded. Once closed
without admission, delayed ingress, suspended transactions, callbacks and queue
consumers for that locator cannot admit, dispatch or perform effects. An expiry
may motivate this separately governed finalization write; expiry alone cannot
establish terminal non-admission. Readback never performs the write.

Prepared and non-admitted rows are excluded from latest-*accepted*-run,
recovery-predecessor, active-run, reconciliation and physical-worker selection.
History labels them as requests without claiming an upgrade occurred. Legacy
rows retain null provenance; there is no backfill from actor/target/time.
Forward and rollback compatibility must prove older workers cannot interpret a
new protocol row as a legacy execution. If that proof is unavailable, deployment
of the prospective protocol remains blocked rather than assuming compatibility.

### Read-only disposition and caller-owned projection

Extend the existing status projector and self-upgrade MCP pack. The existing
`get_self_upgrade_queue_status` gains an explicit original-request projection
mode, using the same repository and existing read authority. That mode reads
only persisted original disposition; it bypasses fresh queue/registry discovery
and cannot invoke the admission reconciler. UI and MCP share this projection.
No new capability or grant is implied: existing capability, token, coworker,
tenant/install and authenticated Principal checks all remain necessary.

The caller supplies its genuine opaque locator, or asks for its own unresolved
prepared intent. A different caller's locator never grants access. A bounded
response carries protocol version, observation time, caller-safe original
reference when available, outcome, evidence reference/revision, and safe reason.
Secrets, other actors' requests, internal traces, and raw failure logs are absent.

| Outcome | Required evidence | Meaning |
| --- | --- | --- |
| `admitted` | Exact issuer-owned original-to-run binding and durable admission commit | This original request admitted that run; its lifecycle may still be pending or terminal. |
| `terminal-nonadmitted` | Exact original-request completion record and effective exclusion of its late commit, dispatch and effects | This original request cannot later admit an upgrade. |
| `ambiguous` | Genuine locator exists but authoritative original completion/admission is unresolved or conflicting | Keep the original action unavailable; no replay or read-triggered repair. |
| `unavailable` | Provenance absent, inaccessible, unsupported, irrecoverable, or unverifiable | Historical outcome stays UNKNOWN; explain the missing capability without inferring rejection. |

An inaccessible locator has the same safe unavailable projection as one the
caller cannot verify; no existence oracle is exposed. Reconnect and reload use
the caller-owned durable intent. A change in latest run, target signature,
window, token validity, grant state or current health cannot clear original
uncertainty. Known returned-run locking remains supported.

This rehydration promise is prospective. A legacy click whose identity and
uncertainty were never durably recorded cannot acquire a reconstructable lock
through this repair. Its retained acceptance case remains evidence of UNKNOWN;
the reader must report the missing provenance rather than claim to recover an
absent record or infer a historical button state.

### Legacy provenance and accountable escalation

Only positive original issuer evidence can settle a legacy request:

1. An authentic contemporaneous receipt or issuer record uniquely binding the
   original ingress/request to a particular durable admission proves admitted.
2. An authentic completion record uniquely binding the original request, together
   with authoritative exclusion of all its late admission/dispatch/effect paths,
   proves terminal non-admission.

Either packet must identify its actual issuer, original request provenance,
installation and actor binding, evidence integrity, completion/admission fact,
and the basis excluding conflicting late effects. A candidate run, approximate
time, equal target, empty query, expired token, restarted process or current
fence is not such a packet. A current fence can establish a present safety fact;
it cannot prove that the past request was never admitted.

For the keyless 2026-10-26 click, neither packet is currently available through
an audited supported route. Source cannot recreate evidence that was never
retained. The accurate disposition is `unavailable`, historical `UNKNOWN`, with
the missing original correlation attributed to BI-3FD07259 and the original
acceptance context retained under BI-CE244260. The original operator retains
control of any consequential action. The admission-contract owner must provide
an actually supported issuer packet or report the capability unavailable; this
proposal does not confer privileged log, DB, credential, or alternate-actor access.

### Present-operation boundary and options

Current-operation eligibility and historical outcome are separate facts. The
current source contains no waiver for this unknown request. The options are:

| Option | Effect boundary | Actual prerequisite |
| --- | --- | --- |
| Preserve no replay; observe independently authorized deployment | Current bytes/effective configuration may converge while the original outcome remains UNKNOWN. | Normal existing deployment authority and current functional evidence. This amendment adds no deployment request. |
| Read genuine original issuer proof if a route becomes available | Settle only the exact original request supported by that proof. | An actual supported read route and packet satisfying the legacy proof above; none is presently established. |
| Consider a separate present-operation contract | Keep history UNKNOWN while judging one named new operation on its own evidence. | Independent approved scope, exact actor/target/action/force posture, technical exclusion of conflicting old effects, expiry/stop rules, recorded accountable human authority, and actual operation admission. No such contract is approved here. |

The third option is not a retry permission, a requested human rubber stamp, or
an implementation task admitted by this amendment. The following proposed
contract makes its current-case requirements reviewable. Missing old correlation
cannot be cured by calling a new request safe. Root's no-replay boundary remains
in force. No force, abort, reload, latch reset, alternative actor, MCP fallback,
provider, credential, host or runtime change is authorized.

If independently authorized deployment supplies the required current bytes and
effective setting, root may verify the local-inference objective under its
existing authority. Future admission hardening then remains this BI's work; it
does not become a new universal native or overall completion gate. A source PASS
never settles the historical click or fabricates BI-CE244260 acceptance.

### Proposed one-operation eligibility contract — not approved

The candidate operation is **one new normal Upgrade now admission by the
original logged-in operator on the same installation**, with emergency override
off. Its purpose is to serve the protected source/current configuration needed for
native registration and local-inference acceptance. It is a distinct operation;
the 2026-10-26 click remains UNKNOWN and is never submitted again, assigned the
new locator, or marked superseded/failed/nonexecuted.

The native owner's 2026-10-30 03:18 UTC retained reassessment
`current-dispatch-config-convergence-reassessment-20261030.json`, SHA256
`8c3249dfd167a11f4a1110d10adfca30342f12cc0c2d90f84f39c78303e07026`,
records that supported PKI bootstrap already wrote canonical explicit dispatch=1.
Its read-only Compose render returned 1. The eight audited promoter/Compose
source paths were identical between served `4718cd4f` and protected `641248e9`:
normal promotion consumes canonical `.env` without forwarding the old portal's
dispatch=0. Root verified the retained artifact; it did not repeat the physical
render. This establishes a current configuration path, not running-process
convergence, upgrade authority, or original-request settlement. PR #6757's
missing-key initializer remains useful for other installs and follows its own
gates; it is not a current-Mac source prerequisite merely to initialize that key.

| Bound fact | Required value before this candidate could be admitted |
| --- | --- |
| Historical subject | BI-CE244260 original 2026-10-26 click, old target f63d7fbc0bac50fb09320532e6e9831944ca1f1c, UNKNOWN retained unchanged. |
| Actor | The original authenticated human operator, through root's existing logged-in portal control; the issuer resolves and records its actual Principal and installation. No delegation to this design agent, MCP fallback, or borrowed credential. |
| New target | Preserve the installation's actual configured target kind and source mode. The current case is git-source/upstream: require one exact canonical protected source/merge SHA and its normal issuer-validated target/binding, with normal canonical configuration consumption. This Mac already has explicit canonical dispatch=1; consuming it does not require PR #6757's missing-key initialization. Only an installation already configured for release-artifact may instead bind the canonical publisher-verified immutable tag, protected source SHA and image digest. No install-mode switch or guessed future squash SHA/tag is authorized. |
| Actual target at this freeze | **Unbound.** The retained configuration audit does not issue an action-time git-source target/binding or select a deployment identity. The actual target-kind-specific binding must be attached to the operation's reviewable issuer packet before admission; it cannot be silently substituted into this frozen proposal. PR #6757 proceeds independently and is not a prerequisite of this current-case option. |
| Action and posture | Normal single Upgrade now action; requestedForce=false; no force/abort/restart/Compose/provider/model/issuer/grant changes. Existing target, quiescence, window/recovery, rollback and protected deployment checks all remain authoritative. |
| Present effect exclusion | Positive issuer evidence that no prior request can later commit, dispatch or cause a conflicting physical effect, and no unresolved physical effect is already running. A new current fence alone says nothing about historical outcome. |
| Recovery/rollback | The normal pipeline's pre-update recovery point and source-bound rollback contract. No extra manual swap or restore is authorized if it fails; retain its new exact identity and stop for its supported recovery disposition. |
| Lifetime | Exact one-operation identity and issuer-bound current target/authority revision; expire on target, actor, authority, fence, activity, override or runtime change. Expiry grants no retry. |
| Recorded decision | Independent approval of this contract under BI-3FD07259's actual spec-approval/architecture gates, then an accountable human authorization explicitly covering this distinct present action while retaining the old UNKNOWN, followed by the operation's own actual admission. Existing messaging/continuation authority is not that exception. |

The technical exclusion is a positive precondition, not a claim that it exists.
A possible prospective mechanism is a server-owned monotonic admission/effect
epoch checked by **every** commit, dispatcher and physical worker, including
legacy/keyless ingress. Establishing it is a separately governed write with
mixed-version proof: an old process, queued consumer or already-running
promoter that ignores it defeats the exclusion. Closing known database rows or
observing no current rows does not provide that proof. An epoch may prevent
future effects while still leaving past admission UNKNOWN.

The currently served source has no approved operation-specific epoch/eligibility
writer or receipt. Installing one through the very unknown manual operation is
circular and does not satisfy its own precondition. This proposal therefore
does not make the candidate executable on the current runtime. If no supported
issuer proof or enforceable exclusion can be established, the result remains a
specific missing capability, not a generic request to approve the next phase.
The source owner is BI-3FD07259/WC-1EDB2880; independent design/spec approval
owns this proposed exception contract, and the original human operator owns the
consequential authorization and eventual action. Root independently reviews the
frozen proposal before either gate is requested. The existing independent
restoration design BI-7A4E70E9 is not an executable alternative merely because
its preparation exists.

No target has been rebound, human exception approved, present eligibility
receipt issued, or new upgrade requested by writing this section. If an
independently authorized automatic deployment first supplies current bytes and
effective dispatch=1, verify that current outcome and retire this candidate as
unneeded; preserve the historical UNKNOWN and the BI-3FD07259 future hardening.

### Amendment research and alignment

The existing research remains applicable. Primary sources rechecked 2026-10-30:

- [HTTP Semantics, RFC 9110 §9.2.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.2):
  adopt the distinction between retry semantics and knowledge that a request was
  applied; reject automatic replay of an unclassified consequential request.
- [Temporal workflow and run identity](https://docs.temporal.io/workflow-execution/workflowid-runid):
  adopt explicit original execution identity separate from a later/current run;
  retain DPF's canonical model and reject a new workflow-engine dependency.
- [Inngest idempotency](https://www.inngest.com/docs/durable-execution/guides-and-advanced/idempotency):
  retain a stable business occurrence and consumer effect guard; its 24-hour
  producer deduplication does not provide historical original-request proof.
- [AWS StartExecution](https://docs.aws.amazon.com/step-functions/latest/apireference/API_StartExecution.html):
  adopt stable identity plus bound input and explicit closed-execution behavior;
  do not treat its finite name-reuse interval as permanent exactly-once proof.

This repairs the existing admission contract rather than introducing a feature
or provider. Deployment contracts 3 (lifecycle), 4 (Authority Core identity), and
10 (client/API governance) apply. Canonical Principal ownership and
`SelfUpgradeRun` remain authoritative. All reads are indexed exact-key or a
bounded caller-owned unresolved slot; history keeps cursor pagination. The
existing low-volume upgrade lane and EP-BUILD-A4A726 own the scale boundary.

### Ordered amendment work and review boundary

The linked existing plan carries the ordered work, risks, tests and coverage
status. This frozen proposal is DESIGN only. Root independently reviews its
exact immutable source before any implementation; normal research, scope,
independent design/architecture, plan coverage, funding, publication and runtime
gates still apply. The claimed shape stays Large because the intended contract
controls access and consequential operation eligibility, even though this
proposal's actual diff changes only two documentation files. No paid/native
review dispatch or new spending allowance is included.
