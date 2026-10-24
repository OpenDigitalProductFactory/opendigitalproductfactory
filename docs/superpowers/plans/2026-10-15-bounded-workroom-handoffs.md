---
status: active
---

# Bounded Workroom handoffs implementation plan

Backlog: BI-5366EF78, successor to BI-B22C8E02. PR #6202 remains frozen.
**Backlog item:** BI-5366EF78
Design: [same-mandate handoffs](../specs/2026-10-15-bounded-workroom-handoffs-design.md).

## Sequence and verification

1. Publish and independently review the successor design. Bind the plan's live
   coverage to this immutable scope before source implementation. Resolve the
   live tool-pack scope held by WC-1D447592 before editing that path.
2. Claim exact paths and refresh gate context. Add meaningful failing tests for
   AC-1 through AC-5: pending request leaves executor untouched, exact receiver
   acceptance, current delegation, no admission/grant/owner mutation, stale lease
   and boundary refusal, retry/concurrent acknowledgement and failure rollback.
3. Extend the existing command and activities with the explicit phase lifecycle.
   Extract the shared same-mandate snapshot/predicate for classification and the
   writer. Extend the existing receipt adapter with the design's optional
   versioned payload binding and compare it before cached replay, including
   rejected results. Reuse its transaction client without a nested transaction.
   Preserve the legacy controlled writer. This is internal sequencing of
   one atomic deliverable, not independently shippable work.
4. Project pending/completed/failed on the existing timeline and MCP readback.
   Test understandable states, including a failed request never looking complete.
5. Run affected Workroom/authority/receipt tests and both web TypeScript programs,
   relevant deterministic guards, doc-index generation and the exact-tree shared
   pregate. Obtain independent semantic review and protected PR checks, merge by
   queue, then advance only through request_self_upgrade.
6. Verify the served DEV flow with the feature SHA preflight and disposable
   authorized room participants. Record no fresh approval, pending-before-ack,
   exact receiver completion and a protected-boundary refusal. No production or
   paired-peer writes. Unrun checks remain unrun.

## Backlog coverage

- Decision: atomic
- Parent: BI-5366EF78
- Receipt: pending against the corrected plan artifact. Native spec approval on October 23 established baseline `baseline-645f3eb8-d279-4064-82d1-cc85d3f17d28`; the October 16 missing-baseline refusal below is historical.
- Rationale: Shared canonical authority repair, payload-bound request/acknowledgement, dependency fencing and transfer must ship together; partial approval removal would weaken the authority boundary.
- Dependencies: none external to this atomic delivery; independent canonical spec approval, baseline and plan review/coverage are required gates.

Atomic deliverable `bounded-executor-handoff` maps to BI-5366EF78, with no
dependencies. Requirements OBJ-1, OBJ-2, OBJ-3; contract
`same-mandate-boundary`; flow `request-acknowledge-complete`; verification
AC-1, AC-2, AC-3, AC-4, AC-5 through `handoff-concurrency-regressions`. The phases cannot ship independently: removing
approval without receiver acceptance, concurrency checks and the shared writer
predicate would weaken the existing authority contract.

The following mapping uses the approved baseline IDs. The coverage writer must
accept this exact committed plan; this text does not claim that receipt or an
independent plan-review pass.

| Requirement | Planned behavior | Acceptance verification |
| --- | --- | --- |
| OBJ-1 | Request and exact receiver acknowledgement reuse valid standing delegation without a new human approval. | AC-1 and AC-5: pending-before-ack writer tests, classification tests and served DEV flow. |
| OBJ-2 | Canonical room authority, immutable request bindings and shared dependency locks preserve every protected boundary. | AC-1, AC-2, AC-3 and AC-5: denial and stale-state cases, real receipt replay, PostgreSQL races and protected-boundary verification. |
| OBJ-3 | Existing timeline and readback expose pending, acknowledged, completed and refused states with at-most-once transfer. | AC-3, AC-4 and AC-5: concurrent/duplicate acknowledgements, rollback outcomes and state presentation tests. |

### October 16 normal coverage attempt and remaining design work

The normal coverage writer was called against published plan commit
`79ebe36deb8c155a208c9ded35e158cb764aeabd`, blob
`c2478ed0db55dfcee74909fe73dfab437ef5e539`. It refused
`traceability-incomplete`: **no initiative scope baseline exists for
BI-5366EF78**. The table above remains planning content; no canonical coverage
was recorded. The normal remedy is an eligible independent spec approval that
mints the baseline, followed by coverage against the resulting exact artifact.
The three uncertain original reviews cannot be replayed to obtain it.

The October 16 receipt-adapter clarification in the existing design is material:
current receipt replay checks type/target but not payload and happens before
the handoff handler. Before implementation, independently review the optional
bound-payload adapter contract and resolve the receiving assistant versus
executor-session authorization interface. No revised review packet has been
issued by this clarification, and no previous review is represented as settled.

After normal implementation admission, add first-failing real-adapter cases for
equal retries, changed request/acknowledgement fields with the same command ID,
changed manifest/reason, reordered object keys, old unbound receipt collision,
conflicting accepted and rejected retries, concurrent acknowledgement, and
rollback without a transfer. Verify that replay cannot bypass digest validation
and that the original result is never overwritten. Include the shared receipt
and wrapper suites; claim those exact source paths before changing them.

The independent client advisory identified the separate rejection transaction
after rollback: it currently lacks the original locks and can return a fresh
refusal despite a durable concurrent winner. The bounded adapter must reacquire
command-advisory then room-row locks, compare the bound payload and replay the
winner before considering publication. Real PostgreSQL tests race rolled-back
failure/rejection publication with an accepted retry and with a different payload;
assert consistent caller outcomes, no receipt overwrite and at-most-once effects.

Lease handling deliberately chooses conservative expiry-snapshot invalidation.
Keep normal heartbeats enabled. Capture any required same-holder request renewal
before freezing the request; a subsequent renewal returns the precise stale-lease
remedy and requires a fresh agent request/acknowledgement, with no fresh human
approval. Test renewal before capture, renewal between phases, expired snapshots
and same-holder/executor lapse/reacquisition. Do not claim a stable lease epoch or
hide this extra-exchange cost. At this advisory checkpoint, receiver-to-executor
authorization was still open; the selected design direction below supersedes it.

The receiver-destination source audit in the design identifies real executorRef
consumers at current source81ef41a0: async-operation authorization, portal authority
projection, verification-lease matching, policy-exemption validity, Build Studio
research association and occupied-branch/scope fences. Do not resolve the open
interface merely by renaming the value a locator. Specify the exact unchanged-
boundary predicate or shared canonical-admission refactoring, claim its actual
paths, and independently review its effects before code. Meaningful regressions
must reject identity-looking destination refs that would confer new authority,
foreign verification-lease association and unsupported executor kinds, while
preserving real room admission and existing branch protections. This is still
design preparation, not an expansion of implementation admission.

### Selected receiver-boundary design direction

DI-0F10A3B213D5 selects canonical-room-authority refactoring over preserving
locator authority behind another before/after checker. Signal is usable/high
confidence and autonomy eligible; scores are grade-C estimates. This is a design
choice, not independent approval. The selected authority contract in the design
supersedes the earlier open conceptual question, while adapter details and real
evidence remain required before implementation.

After normal approval/admission, extract and reuse the existing canonical
human/agent room-admission resolver in async Workroom authority and portal
authority projection; remove executorRef as an independent authorization branch.
Preserve each caller's read/action policy, grants, explicit participant narrowing,
clearance and service-actor limits. Do not alter unrelated TaskRun authority.
Keep exact authenticated assistant endorsement separate from external-chat proof;
only supported server-resolved external assistant/surface mappings qualify.

Add exact transactional dependency checks for active verification-lease,
policy-exemption and unsupported build associations affected by either ref;
changed/unknown effects refuse with the owning remedy. Preserve branch/scope
fences. Define bounded lookup indexes, lock order and freshness against concurrent
dependency writers before claiming the no-authority-change predicate is complete.
Claim these additional exact paths and refresh graph impact before any edit.

First-failing tests must demonstrate that an identity-shaped destination cannot
confer async or portal authority, real admitted actors retain access, removed or
narrowed actors stay denied, different chats are not independent identities,
and valid/foreign lease or exemption transitions are classified correctly. Test
each affected adapter and the real shared transaction, including concurrent
dependency changes and bounded-lookup failure. Shared authority repair and the
handoff workflow are one atomic delivery; no partial approval removal may ship.

### Adapter contracts and proof obligations

Source call-site audit at81ef41a0 identifies these concrete integration ports.
These are proposed contracts, not evidence that their transactions already exist.

| Adapter | Required contract | Verification |
| --- | --- | --- |
| Shared room access | Extract the existing server policy with an explicit requested content/action level and a transaction-capable DB port. Resolve authenticated human/assistant aliases, active status, roles, case restrictions and clearance; no executorRef or caller-provided authorized flag. | Same policy fixtures through human, OAuth assistant and internal actor adapters; missing/ambiguous identity and narrowed/removed participation deny. |
| Async Workroom scope | Extend resolveServerOwnedAsyncOperationAuthority and its callers to declare the operation's access level. Read-model get/list use content; admission/mutation use action. Keep TaskRun scope separate. Production admission must recheck action authority through the actual mutation transaction, not rely on the current pre-transaction lookup. | Cover async-operation-read-model, async-operation-runtime, async-operation-workroom-runtime and semantic-review-authority callers; a read grant cannot admit work. |
| Portal authority | Resolve current human room action access in portal-context/index.ts through its existing bounded source resolver. Pass that server result into the pure authority projection; unavailable access is false plus attention. | An identity-looking locator cannot enable canActOnCapsule/canActOnBuild; projection success never substitutes for writer authorization. |
| Internal/service actors | Never manufacture a userId to call a human-only resolver. Reuse the canonical room policy for the actual authenticated principal and existing service mandate; absent supported context refuses. Human superuser affordances do not flow to an agent. | Enumerate actual call-site actor variants and preserve legitimate admitted service behavior; no implicit administrator or locator fallback. |
| Handoff command | Parse and normalize phase payload before receipt lookup, use versioned payload binding, and resolve both actors plus exact room action access inside the command transaction. | Real receipt wrapper/Prisma tests, not a handler-only mock; changed payload and rollback publication cannot bypass authority. |

Dependency proof must cover absence as well as rows that happen to exist. At the
inspected schema, ExternalEvidenceRecord has a workCapsuleId/createdAt index;
NonProductionEnvironmentLease has ownerProvider/ownerSessionId but no standalone
ownerSessionId index. A source/destination-ref query must use a justified actual
index plan, not assume the composite index covers an arbitrary suffix lookup.
Use the canonical terminal-status registry, bounded deterministic reads and
overflow refusal; never truncate a relevant live dependency from history.

Before implementation, specify a common serialization boundary with the actual
lease/exemption/association writers. Locking only matched rows cannot protect
an absent dependency from concurrent insertion. The design must name which
existing resource/room lock every relevant writer shares, or a bounded shared
transaction-lock protocol, its complete acquisition order and revalidation.
No code may claim the absence predicate safe until every interacting writer is
enumerated and real PostgreSQL insert/update/reassignment races demonstrate it.
An index-only migration is allowed only if query qualification establishes the
need; update the data-impact contract and migration review in that same delivery.
No new business table, identity registry or permission is authorized by this note.

### Completed source fence audit and regression plan

The selected shared-fence contract in the design replaces the generic unresolved
absence-fence question above with these specific changes, still unimplemented:

1. Extract environment-lease.ts's actual transaction advisory lock into a shared
   DB-only port and canonicalize its closed environment-key registry. Production
   creation has one audited writer. Enumerate claim/resume/admit/reconcile/release
   and renewal/terminal transitions; reject any new unfenced positive transition.
2. Extend the bound command receipt adapter with a server-only before-room-lock
   port. Both normal attempt and rejection publication take command advisory,
   sorted canonical environment advisory locks, then Workroom row, followed by
   stable actor/policy row locks. Require Read Committed fresh post-lock reads,
   real transaction support and bounded timeouts; no network under locks.
3. Query source/destination ownerSessionId for every nonterminal lease, including
   queued or expired-but-still-active. Any match/unknown/overflow refuses. This
   covers unfenced renewal because renewal cannot create a row or reactivate a
   terminal one. Qualify ownerSessionId/status lookup at10,000 rows and add only
   the justified forward index, with actual data-impact/migration review.
4. Make semantic-review exemption insertion use the same Workroom row lock and
   final head/repository/executor recheck through recordExternalEvidenceInStore
   on its real transaction. Handoff's exact current-source query must cover
   applicable evidence without a latest-N exclusion. Existing approval remains
   required; no evidence is rewritten or invented by the new fence.
5. Reject Build Studio/native/human destinations and linked builds in the bounded
   external flow. Retain branch/scope CAS and canonical action admission; matching
   a ref never admits an actor or authenticates an external chat.

The first-failing PostgreSQL matrix must interleave lease creation, queued
admission, terminal resume, renewal, release and handoff in both lock orders;
assert no qualifying dependency is overlooked and no deadlock survives bounded
retry. Include all environment keys, unknown registry/status and10,000 lease
rows. Race exemption publication versus handoff: prior exemption refuses the
handoff; prior handoff makes stale publication refuse. Assert no partial transfer,
new grant, fixture-lease reassignment or hidden evidence invalidation. Run the
same schedule through the real receipt adapter, including rejection publication,
not only extracted pure predicates. Caller-outcome and lease-renewal tests from
the earlier advisory remain required. Source audit is not execution evidence.

## Impact, risk and rollback

Initial scope impact resolves doc-index generation and exact-source pregate;
module claims alone do not measure source test impact. Refresh exact-path claims
before Red and include every returned testImpact and guardObligation. Verification
is exhaustive when impact is unresolved. Managed dependency bootstrap reports
compile-ready with pnpm 10.33.2 and no ignored builds.

Main risks are classification/execution races, accidental admission or ownership
change, and duplicate transfer. Reuse the room lock and command receipts and
positively revalidate identity/policy inside the writer. Rollback restores legacy
authority; it does not remove historical activities or complete pending transfers.
