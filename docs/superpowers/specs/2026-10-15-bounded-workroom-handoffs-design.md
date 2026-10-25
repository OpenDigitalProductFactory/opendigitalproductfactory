---
status: draft
backlog: BI-5366EF78
---

# Same-mandate Workroom executor handoffs

BI-5366EF78 is the successor delivery for the October 15 owner observation on BI-B22C8E02.
It does not amend the frozen evidence or acceptance of PR #6202. Funding and
purpose are shared DPF platform reliability under the owner's explicit direction
to execute the BI. Human ownership remains with the person; executor acceptance
does not transfer ownership or confer access.

## Problem and evidence

The owner-requested Claude-to-Codex handover of WC-8D35443E generated approval
cmva8uv3f19ie01rxozn6u25e. The owner had to find and approve it. That observation
proves interruption, not unchanged authority. On source base
`b338f06e581e6cc7886c334b519f098feb142865`, `work-capsules-pack.ts` assigns
`authority` unconditionally to `reassign_workroom_executor` and its tests require
no call refinement. `reassign-executor-handler.ts` immediately transfers the
lease and can admit a new assistant. There is no receiver acknowledgement.

PR #6552 subsequently delivered source `1e275624e0cd6d2cca125b8417e6fd80ec896cf2`
through protected merge `3ccdb097ae67208ab250ed2c28b53ef31efe5fe8`.
The served request on October 24 returned `handoff-transaction-required` before
a pending request was created. Its rejected command and unchanged boundary remain
evidence. The transaction-proof correction below addresses that actual defect;
source publication did not establish successful served acceptance.

## Objectives and acceptance

**OBJ-1:** Complete authorized same-mandate executor handoffs without a human approval click.

**OBJ-2:** Preserve ownership, current permissions, sensitivity, shape and concurrent lease boundaries.

**OBJ-3:** Make pending, acknowledged, completed and refused outcomes durable and understandable.

| Acceptance | Objectives | Statement |
| --- | --- | --- |
| AC-1 | OBJ-1, OBJ-2 | An owner-authorized request to an already admitted eligible receiver remains pending until that authenticated receiver acknowledges; neither phase creates a fresh approval under valid standing delegation. |
| AC-2 | OBJ-2 | Neither phase changes owners, participant roles, grants, sensitivity, work shape or mandate; missing delegation, restricted/consequential effects, new admission and legacy direct reassignment retain their existing gates. |
| AC-3 | OBJ-2, OBJ-3 | Changed owner, participant eligibility, mandate, executor or lease identity refuses completion; concurrent requests serialize; duplicate commands and acknowledgements cannot execute the transfer twice. |
| AC-4 | OBJ-3 | The existing room timeline and MCP readback distinguish waiting for acknowledgement, completed and failed; a request alone never appears as a completed transfer. |
| AC-5 | OBJ-1, OBJ-2, OBJ-3 | Tests exercise the actual receipt wrapper and Prisma callback, exact transaction-client identity, nested savepoint and outer rollback, classification, failures, retries and concurrency; exact-source delivery and served DEV evidence remain distinct from source-local tests. |

## Design grounding

Extend `reassign-executor-handler.ts`, `workroom-lease.ts`, `receipted-tool.ts`,
`command-receipts.ts`, `oauth-workroom-ownership.ts` and
`workroom-agent-access.server.ts`. Reuse the existing consequence refiner and
connection delegation; never change the global escalation policy. Reuse
`WorkroomActivity` for a request and its outcome, and the existing timeline
presenter. The July 11 cross-agent handoff plan explicitly reserved the missing
propose/acknowledge step. BI-A27B903D owns human-ownership continuity;
BI-06AE6833 owns autonomous stalled-PR recovery. This delivery supplies a bounded
handoff primitive without taking either initiative over.

WWMD decision DI-D17E0B08FCAC recommends extending the existing command,
with usable signal and autonomy eligible. Earlier DI-1BC3BF810052 was unusable
because its options lacked scoreable features; it grants nothing.

## Operation contract

Extend the existing tool with an optional handoff phase. Omission preserves the
existing consequential direct reassignment. The new bounded flow is explicit:

1. `request`: requires command identity, expected lease holder, expected executor
   kind/ref, target agent identity, target executor kind/ref and next-action
   manifest. Resolve all principals on the server. Only a currently active human
   owner and their authorized assistant may initiate. Both source and receiver
   must already have action admission to this exact room. No new invitation.
2. Persist the request in the room's existing activity log under the row lock.
   Capture requesting human and assistant, exact receiver, source/target executor,
   lease holder and expiry, room authority/scope/shape, roster, effective
   sensitivity and case policy. Bind a digest to the stored request. Return the
   request identity and `pending-acknowledgement`; transfer no executor or lease
   holder. Any normal same-holder renewal required for this write must occur
   before the snapshot in this transaction, never after the request is frozen.
3. `acknowledge`: accepts only the stored request identity. The authenticated
   receiver must be the exact target assistant acting for the same human owner;
   it cannot acknowledge on another agent's behalf. Current governed token,
   grant and delegation checks apply independently to both callers.
4. Under the same room lock, reload the request, owner, roster, room mandate,
   policy, sensitivity and lease/executor snapshot. Reject stale or expired
   requests and any changed protected boundary. Recheck both actors' current
   exact-room access. Never trust a caller-supplied unchanged-boundary flag.
5. Record acknowledgement and the existing `executor-changed` event and complete
   the lease transfer in one transaction. The existing human lease principal is
   retained on OAuth handoff, with the receiver identified separately in the
   executor and activity provenance. Admission and roles remain untouched.

The bounded flow is ordinary only after these facts are positively verified.
Static `authority` remains the fallback for unknown input, failed reads, legacy
calls and new admission. Existing `connectionDelegationFor` determines steering;
an environment label is never delegation. Production acquires no DEV exemption:
its current delegation and explicit approval policies continue to govern.

The executor writer must recheck the same predicate after classification. An
ordinary authorization decision is not permission to execute a newly changed
room. Refusal returns a typed stale/boundary result and never falls back to the
legacy immediate writer. Revoked token/grant/consent follows the existing
governor rather than a new exception.

## Durability, concurrency and presentation

Use command receipts for retry identity and the existing room row lock for
serialization. Store the request and terminal outcome on the existing activity
substrate; add no table. An index-only migration requires actual query-plan
qualification and the normal data-impact/migration review. A second acknowledgement reads the terminal
outcome and returns it without another transfer. A different payload reusing an
identity is refused. A changed lease must be detected even if the same principal
later holds it again: bind the executor and lease expiry as well as holder.
Normal unrelated timeline entries must not invalidate a request merely because
activitySequence advanced.

For this bounded slice, deliberately use conservative lease-snapshot invalidation,
not a claim that expiry is a continuous lease generation. An ordinary heartbeat
changes leaseExpiresAt and therefore makes a pending request stale. Keep normal
heartbeats running. Acknowledgement returns `handoff-lease-snapshot-changed`
without a transfer; the feed explains that the room lease was renewed or changed
and the requester must read current state and submit a fresh request for receiver
acknowledgement. This retries the two agent phases, not human approval. Automatic
unbounded re-requesting is prohibited. The usability cost is explicit: a renewal
between the phases can require another exchange even with the same owner.

Validate that the captured lease was live at request and is still live at
acknowledgement using database wall time. Null, elapsed or changed expiry refuses.
Same-holder lapse/reacquisition cannot revive the old request, even if principal
and executor are equal. This contract does not promise acceptance across renewal;
a future continuity optimization needs a proven acquisition identity and coverage
of every lease writer, not a heuristic using executor equality. Tests must cover
renewal before snapshot, renewal between phases and same-holder lapse/reacquisition.

The room feed says "Handoff requested; waiting for the receiving assistant",
"Receiving assistant acknowledged; handoff completed", or "Handoff could not
complete: <reason>". Use existing semantic theme styles and feed components.
Pending is informational and does not ask the owner to approve. A real boundary
change gives the existing supported remedy. No timer-driven refresh, separate
chat ledger, decorative dashboard or new approval control.

Refactoring allocation: consolidate the snapshot/predicate shared by consequence
classification and the transactional executor writer. Keep parsing and lifecycle
handling outside the already large tool pack. Do not duplicate room admission,
principal identity or command-receipt logic.

## Receipt adapter clarification — October 16

Source inspection at `79ebe36deb8c155a208c9ded35e158cb764aeabd` found a
material gap in the retry contract above. `command-receipts.ts` compares only
command type and target before replaying a stored result. `receipted-tool.ts`
can return that result before the handoff handler runs. Checking a payload
digest only inside the handler would therefore fail to reject a changed retry.
This clarification changes the required adapter behavior; it is DESIGN only.

For the new explicit phases, require a command ID and a versioned digest of the
complete normalized command payload. Reuse canonical JSON from
`@dpf/integration-shared/canonical-json` and SHA-256. Parse and validate before
receipt lookup; reject unknown phase fields rather than silently dropping an
effect-bearing input. Include phase, room, expected source/lease, receiver,
target executor and manifest for a request, and phase, room and stored request
identity for acknowledgement. Bind every accepted optional field, including a
reason. The command ID remains the lookup key, not a replacement payload hash.

Extend the existing receipt adapter with an optional versioned payload binding
used by these phases. Both accepted and rejected receipts retain that binding.
Under the existing command and room locks, compare it BEFORE returning any
prior result: equal normalized payload returns its original result, different
payload refuses without effects. An old unbound receipt cannot satisfy a new
bound command. A refusal must not replace the original receipt. Legacy tools
and omitted-phase reassignment retain their existing replay semantics. This
adds no table, ledger, grant or new command identity mechanism.

Rollback releases both existing locks. For bound handoff commands, the separate
rejection-publication transaction must reacquire the SAME command advisory lock,
then the SAME room row lock, and reread the receipt before publishing anything.
Validate its binding before replaying either an accepted or rejected result.
If another attempt won after rollback, return/rethrow that durable winner for
an equal payload; for a different payload return the command-identity conflict
without replacing the winner. Do not throw the first attempt's fresh refusal
when a committed equal-payload success has already won. Only an absent receipt
permits publishing this attempt's bound rejection under those locks. Unknown
transaction outcomes are not a confirmed rollback or permission to rerun effects.
Add real PostgreSQL races covering rolled-back failure versus accepted retry,
and rejection publication versus a different payload, checking caller outcomes
as well as the single durable receipt and at-most-once transfer.

The handler must use the exact server-owned client stored by the active receipt
transaction context after bound preparation and the shared lock prefix. Require
both an active bound context and object identity between that context's database
client and the candidate passed to the handler. The database object is server
input, never a public command parameter. Require the existing raw-query port to
be callable. An absent context, an active but unbound context, or a root/foreign
object that is not this callback client refuses before handoff effects.

Presence or absence of a `$transaction` member is not transaction-membership
proof. The installed Prisma 7 callback client can retain that member for nested
transaction/savepoint behavior used by the existing lease writer. Preserve that
capability inside the receipt transaction. The handoff handler must not open a
separate outer transaction or strip client methods to satisfy a shape test.
The existing private receipt context remains the single proof owner; introduce
no caller flag, exported context setter, capability registry or alternate
transaction lifecycle. The identity check adds no database query or scan.

This corrects the earlier nested-transaction assumption. Before implementing it,
run a failing request through the real receipt wrapper and actual Prisma callback,
without mocking the transaction-proof helper or deleting `$transaction`.
After correction, prove exact-bound-client acceptance and absent, active-unbound,
root and foreign-client rejection. A PostgreSQL acknowledgement must exercise
the existing lease writer's actual nested boundary. Force outer completion or
publication failure after that boundary and prove executor kind/ref, human lease
holder, expiry, transfer count, activity and accepted receipt roll back together.
A handler-only mock or successful isolated nested call is insufficient.

Keep a proven pre-effect transaction-required rejection durable under its old
command key. After the deployed correction, a legitimate fresh command may use
the existing ordinary protocol within the continuing owner instruction and
current exact-room authority, receiver, boundary and lease. It creates one pending
request and transfers only on the exact receiver's acknowledgement. Link and
preserve the old rejection/envelope; never replay its key or vary a fingerprint
to evade a refusal. Another API or human approval is not inherently required
solely for this repaired execution. Unknown old effects, changed scope or a real
new authority requirement retain their native remedy. If the old room no longer
needs a handoff, retain its history and use the authorized synthetic fixture for
positive acceptance. These are required checks, not passing results.

Keep accountable assistant identity separate from an executor locator. The
current `handler-actor.ts` resolves the OAuth human and assistant and preserves
the authenticated token reference; `toExecutorRef` is caller-supplied data.
A different chat or a self-declared executor reference does not prove a different
assistant. The selected contract below authenticates the receiving assistant's
endorsement, not a particular external chat. Missing canonical assistant, surface
or room-admission proof returns the precise boundary refusal; do not add a client
assertion, grant or unverified session identity.

### Receiver destination audit

At inspected current source `81ef41a0fcffa9ed5995642446370b465d7e3ab5`,
the existing OAuth access check establishes authenticated human/assistant action
admission, not external-chat authentication. Having that assistant endorse the
stored executor destination is a candidate protocol, but declaring executorRef
to be coordination metadata alone would contradict these existing consumers:

- `inference/async-operation-authority.ts` authorizes a Workroom operation when
  executorRef matches the acting user, agent or principal, independently of its
  participant/lease-holder alternatives.
- `portal-context/authority-resolver.ts` uses a user/principal ref match to infer
  canActOnCapsule and canActOnBuild. This is a permission projection, not proof
  of enforcement by every downstream writer.
- `govern/automation-fixture.ts` compares executorRef with a verification lease's
  ownerSessionId, alongside branch, expiry and origin checks.
- `change-review/semantic-review-policy-exemption.ts` pins sourceExecutorRef;
  changing it can invalidate an existing exception and cannot be called unchanged
  evidence. Build Studio research bindings also use executorRef as a build ID.
- `work-capsule-store.ts` and `work-capsule-branch-identity.ts` use it in occupied
  branch, re-adoption and scope-change fences; those protections remain required.

Before accepting the endorsement option, specify and review a bounded predicate
that proves these effective authority/evidence/lease boundaries are preserved,
or refactor the affected authority readers onto existing canonical room admission
without treating a newly endorsed locator as an additional grant. Audit fixture
and exception effects explicitly and retain legacy behavior outside the admitted
scope. External locator semantics do not cover Build Studio/native executors.
No verified external-session registry was established by this audit, and none
is proposed. Unsupported destination bindings retain the consequential path or
an exact boundary refusal.

### Selected authority contract

Kernel consult DI-0F10A3B213D5 compared canonical room-authority refactoring with
a transactionally proven before/after predicate over the existing ref consumers.
It recommends `canonical-room-authority`, high confidence, margin 2.514, usable
and autonomy eligible, with no commandment conflict or autonomy blockers. The
agent selects that DESIGN direction. Eight-axis scores are grade-C engineering
estimates, not measured security/performance results. This is not a native
design approval, implementation admission or proof that any refactor is safe.

Use one extracted canonical room-admission resolver for the affected async
Workroom authority and portal authority projections. Reuse the existing
resolveAgentWorkroomAccess/resolveHumanWorkroomAccess policy and canonical
Principal aliases, current human capability, active assistant, actual room roles,
explicit narrowing/removal, case policy and sensitivity checks. Preserve each
consumer's requested read/action level and tool-specific grant intersection.
ExecutorRef equality must not supply an additional authority branch. Missing or
ambiguous actor/context refuses; do not manufacture a human for a service actor
or silently widen a service's existing mandate. TaskRun-specific async authority
is outside this Workroom refactor and keeps its existing checks.

The bounded request records the exact already-admitted target assistant and
destination kind/ref. Its authenticated acknowledgement endorses those stored
bytes under the same owner's current delegation. Limit this flow to external
assistant executor kinds with a server-resolved canonical assistant/surface
mapping; unsupported mappings or Build Studio/native/human executors retain the
existing consequential path. A locator is coordination data, not proof of a
particular physical chat or independent reviewer. State that limitation in
readback rather than labeling an external chat authenticated. Neither request
nor acknowledgement admits participants or makes another chat's work independent.

Before treating a particular handoff as ordinary, also resolve its real secondary
effects under the room transaction. Preserve occupied-branch/re-adoption/scope
fences. If source or destination ref is bound to a current verification lease,
Build Studio association or applicable policy exemption whose qualification
would change, refuse this bounded path with the exact owning remedy. Do not
transfer another session's lease, silently invalidate/rewrite its evidence, or
pretend the unchanged holder proves unchanged effects. Unavailable dependency
reads refuse. Do not enumerate all actors or effects without a bound: use exact
existing ref/item indexes, detect bounded overflow and keep unknown cases gated.

Canonical-authority refactoring and bounded handoff must ship atomically. Review
legacy actor cases explicitly: an actor whose only alleged permission is locator
equality is not newly admitted or auto-migrated. It receives an actual admission
remedy. Preserve legitimate canonical access, explicit removals and existing
non-Workroom behavior. Independent review must assess this source scope expansion
before implementation. The selected design closes the conceptual receiver
boundary; exact adapter/lock/query proof, native approvals and tests remain owed.

### Shared-fence implementation contract

The bounded source audit found one production lease-creation writer:
`nonprod/environment-lease.ts` claimNonprodEnvironmentLease. It takes the existing
`dpf:nonprod-environment:<environmentKey>` transaction advisory lock before create,
resume or admission. Release/reconciliation use that environment boundary too.
Renewal currently updates without it, but requires an already active lease and
does not change its owner or turn a terminal row active. Other inspected terminal
writers only remove eligibility. Tests must protect these statements against
every actual nonterminal transition, not assume a row-lock absence predicate.

Extract the existing environment lock into a shared DB-only port. For bounded
handoff request and acknowledgement, require real Read Committed transactions
and acquire locks in this order: command-identity advisory lock; all canonical
environment advisory locks in sorted key order; Workroom row; existing present
actor/admission/policy rows in stable table/id order. The closed environment set
currently contains active-candidate, host-heavy-resource and local-integration-ci;
derive and validate it from one canonical registry rather than copying a list.
No external I/O runs under these locks. Both the ordinary receipt attempt and
its separate rejection-publication transaction use the identical lock prefix.

The receipt adapter needs a server-only DB callback before its room lock; the
new bounded phases supply the environment-lock callback there. The public tool
cannot provide callbacks or locking claims. Existing commands need not acquire
these locks. A lease writer that also touches Workroom state already takes its
environment lock first; the handoff must not invert that order by adding locks
inside its already room-locked handler. Use bounded transaction/lock timeouts.
Read Committed ensures queries after waiting on a lock see the committed winner;
do not import a stale pre-wait snapshot as authority.

After locking, query exact source and destination refs for ALL nonterminal lease
statuses, including queued and expired-but-not-terminal rows, regardless of TTL.
Any such dependency refuses bounded handoff; use the actual lease owner and
normal release/cancel remedy. This deliberately avoids relying on unfenced renewal
or expiry as an absence proof. Unknown status/environment, overflow or missing
registry coverage refuses. A later new lease claim serializes after the handoff;
it is a distinct allocation under its own normal authority, not a transferred
lease. Add a forward-only ownerSessionId/status index only after actual query
qualification; the existing provider-prefix index is not sufficient by assertion.

For semantic policy exemptions, refactor recordSemanticReviewExemption to keep
its provider/approval preparation outside locks, then lock this same Workroom
row and recheck the exact repository/head/executor snapshot in its real insert
transaction. Use the existing DB-only recordExternalEvidenceInStore port; the
outer recordExternalEvidence action cannot substitute for that transaction.
Handoff reads exact same-room/current-source exemption candidates while holding
the room lock. An applicable exemption that ref movement would invalidate refuses;
malformed potentially applicable or overflowing evidence refuses too. Do not use
the legacy latest-20 convenience scan as proof that no applicable row exists.
Publication that wins the room lock first is visible to handoff; publication
that loses must revalidate the changed executor and cannot insert stale evidence.
No approval, evidence result or native-review state is modified by refusal.

Bounded external rooms must have no Build Studio/build association. Reject
non-null featureBuildId, native/build/human executor kinds and unsupported
assistant/surface mapping. Preserve branch scope CAS and protected-state checks;
do not rewrite those stores to infer session authentication from an endorsed ref.
Shared authority repair, lease-lock extraction, exemption insert fencing and
handoff phases are one atomic implementation scope. Real PostgreSQL races and
independent exact-source review are required before this source-derived contract
can be called qualified. Any newly discovered unfenced positive writer stops
the bounded path until this contract is amended and reviewed.

This is a genuine correction to the source adapter contract, not proof that the
three earlier reviewer executions settled. Preserve their identities, uncertain
effects and retry budgets. Any current artifact review must use the normal
issuer and its actual admission decision; no new key is manufactured to evade
an existing hold, and a client advisory is not a native approval.

## Research & Benchmarking

- [Temporal message passing](https://docs.temporal.io/encyclopedia/workflow-message-passing):
  tracked updates separate acknowledgement and completion and support validation.
  Adopt explicit outcomes and validation; reject fire-and-forget success for a
  transfer. Reuse DPF's durable log instead of adopting another workflow engine.
- [BMAD Method](https://github.com/bmad-code-org/BMAD-METHOD/blob/main/docs/index.md):
  adopt explicit work artifacts and proportional delivery; reject client-only
  process as proof of server authority. It is a benchmark, not a dependency.
- [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests):
  adopt stable retry identities and preserved results; reject re-executing a
  transfer to recover a lost response. Keep DPF's existing transactional receipts.
- [GitHub environment protections](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments):
  preserve explicit protection and independent decisions at consequential
  boundaries; reject repeating a human review for ordinary bounded execution.

Alignment: existing canonical Principal and Workroom identities; no new service,
dependency, credential, model or authority store. Additive MCP input fields retain
legacy semantics. Existing runtime/install, grant intersection, tenant and PR/DCO
contracts remain authoritative. This changes no industry value-stream ordering.

## Delivery and rollback

One atomic successor delivery under BI-5366EF78: classification, request/receiver
workflow, transactional boundary checks, readback and regression evidence must
ship together. The plan is [bounded handoffs](../plans/2026-10-15-bounded-workroom-handoffs.md).
Independent review must judge this successor scope, not reuse PR #6202's approval.
Scope overlap on the tool-pack integration is held by WC-1D447592; resolve that
claim before editing the pack. No force override or competing write is authorized.

Rollback removes the new phase inputs/refinement and restores the static
authority floor. Historical activity and receipts stay readable. Pending requests
remain uncompleted; rollback never transfers a lease or changes permissions.
