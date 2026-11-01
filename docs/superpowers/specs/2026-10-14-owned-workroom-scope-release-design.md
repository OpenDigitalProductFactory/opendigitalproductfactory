---
status: active
---

# Owned Workroom scope release

Implementation parent: BI-8D8939E5. Workroom: WC-C2B2C6C8.
WWMD: DI-2D3AB9580E90, bound_call_refinement, proceed.

## Problem and recorded policy

On source 69dda844d19a0b1d66a28928cf2e71a2fa9be34f,
`release_workroom_scope` declares `authority` for every call. The regression
`scope-release-consequence.test.ts` executes the actual tool definition with
the caller's live lease and exact owned claim. It fails because the resolver
returns `authority` rather than an ordinary effect. This is a classification
defect, independently of the repaired command-receipt transport in PR #6330.

The kernel's `principles/escalation-is-a-gate-not-a-trust-tier` requires a person
for declared damaging effects, consequential Cases, restricted data, or an
ordinary mutation without recorded steering. An autonomy-eligible WWMD decision
is platform direction; it does not grant permission or erase a damaging effect.
WWWD and WSID continue to resolve organization and practitioner decisions in
their own scope. No organization or profession policy is changed here.

BI-8D8939E5's original merge/retire examples therefore do not justify a general
DI-based approval bypass. Those consequential operations retain their existing
gates. The original nonprod-lease example already has the bounded existing
`leaseCleanupConsequenceForCall` engine, requiring exact authenticated-user task
provenance and the recorded lease binding; its live acceptance remains a separate
obligation. This design extends the same narrow-only tool-consequence contract
to own Workroom scope removal. It does not claim every coordination envelope was
wrong. BI-12E5DD91 owns complete card disclosure, BI-763D6E01 owns command-receipt
transport, and BI-AFEAAA76 owns approval completion/replay acceptance. Their
immutable histories and acceptance obligations remain intact.

## Objectives and acceptance

**OBJ-OSR-1:** Automatically classify exact owned scope removal as ordinary while preserving the current authorization and delegation engines.

**OBJ-OSR-2:** Prevent changes to scope or lease ownership between classification and mutation from authorizing a foreign release.

**OBJ-OSR-3:** Preserve genuine human and graduated-operator authority paths, command idempotency and recorded failures.

| Acceptance | Objectives | Statement |
| --- | --- | --- |
| AC-OSR-1 | OBJ-OSR-1 | A valid exact own claim on a nonterminal, unarchived room with the caller's current live lease refines authority to null; current connection delegation can steer it without a new envelope. |
| AC-OSR-2 | OBJ-OSR-1 | Missing identity, malformed requests, unknown rooms, unknown claim ownership, expired or foreign leases, and foreign requested claims retain authority. |
| AC-OSR-3 | OBJ-OSR-1 | Refinement does not bypass token, coworker grant, human capability, assistant, task, room admission, consent revocation, restricted-data, consequential-Case, explicit-proposal or always-human controls. |
| AC-OSR-4 | OBJ-OSR-2 | The mutation uses the same eligibility predicate and the existing scope/updatedAt compare-and-set; a changed owner or lease prevents an ordinary authorized call from removing foreign scope. |
| AC-OSR-5 | OBJ-OSR-3 | A genuinely approved or existing graduated-operator authority call retains its established path; forced claims, executor handoffs and grant/process changes are not refined by this change. |
| AC-OSR-6 | OBJ-OSR-3 | Exact duplicate release remains a harmless no-op on an owned live room; existing command receipts preserve exactly-once replay, cross-user/room isolation and terminal FAILED history. |
| AC-OSR-7 | OBJ-OSR-1, OBJ-OSR-2, OBJ-OSR-3 | Protected merge and qualified release precede live OAuth/portal acceptance; record actual outcome and persisted receipt, never infer acceptance from a source test or deployment alone. |

## Existing substrate and design

Reuse `resolveCallConsequence`'s narrow-only resolver. The declared authority
floor remains; exceptions or unproven inputs keep it. A pure shared predicate
reads server-resolved caller principal, exact requested kind/value pairs,
persisted claim attribution, room state and current lease. It accepts only
known claim kinds, a nonempty valid request, a proven caller and a live lease
held by that caller. Every matching persisted claim must belong to that caller;
unmatched pairs remove nothing. Raw malformed ownership entries matching a
requested pair fail closed. Extensions and shape records are retained.

The refiner resolves identity through existing `workCapsuleActor`, including
OAuth's human ownership and assistant attribution. It reads the exact capsule,
not an inferred active room. It adds no policy, delegation, approval or identity
store. The existing escalation engine still evaluates steering and limits.

At execution, consume the monitor's server-created `authorityDecisionId`, never
an argument supplied by the client. Read its existing AuthorizationDecisionLog
and validate allowed disposition, tool, human and assistant binding. An ordinary
refinement reason causes a fresh evaluation of the same predicate at mutation
time. Missing/mismatched evidence on a governed assistant call fails closed.
Current approval/graduated paths are not narrowed accidentally: only the
ordinary-refined disposition applies this ownership restriction. Existing
human-owner portal checks remain responsible for direct human release.

The current decision subject for this tool is `platform:dpf`; do not falsely
claim the log already persists a capsule-specific subject. Exact target binding
comes from the current governed dispatch context, the refiner's exact lookup,
the write-time exact lookup and existing snapshot CAS. Caller data cannot supply
the internal decision id. Tests must demonstrate that boundary.

Extract the existing scope-release transaction into a focused store leaf rather
than grow the baselined monolithic store. Preserve activity, shape/extension
retention, transaction behavior and existing public exports. Share parsing and
eligibility between classification and mutation. This consolidation is part of
the repair, not a second approval system.

## Ordered delivery and verification

One atomic implementation deliverable OSR maps to BI-8D8939E5. Classification
without mutation revalidation is unsafe; mutation revalidation without routing
leaves the approval gap. The extraction, refiner, binding check and adversarial
tests therefore ship together. Historical merge/retire/nonprod observations are
dispositioned above; closure must not imply their live acceptance is proven.

1. Record reproduction/research and obtain independent review of this immutable
   design; bind live coverage before behavior implementation.
2. Implement shared parsing/eligibility, server-side narrow-only resolver and
   focused scope-release store. Wire the existing tool/handler after coordinating
   the active claim on `mcp-handlers.ts`; co-edit only after the existing governed
   claim has executed. Envelope cmv7mxfd807ie01obbyj63tgu executed on
   2026-10-14; Workroom activity sequence 40 records the exact handler co-claim.
3. Test own/foreign/unknown claims, mixed requests, null actor, malformed inputs,
   terminal/archive/expired/foreign leases, exact target, no-op, read failure,
   unknown raw claims, stale snapshots and lease changes, including expiry while
   an unkeyed call waits for transaction admission. Read and classify inside the
   existing transaction callback immediately before the snapshot CAS. Test decision binding
   across human/assistant/tool and ordinary versus approved/graduated execution.
4. Run graph-linked work-capsules pack/alias, tool-registry, scope-input parity,
   store/adoption/session/branch/reaper/terminal tests plus command-receipt,
   receipted-tool and existing escalation/governed-executor controls. The two new
   leaf paths have no graph links yet, so add colocated tests explicitly.
5. Check style-drift, doc-index freshness, capability-completeness freshness and
   module-size/prose ratchets; obtain package and test-program typechecks, exact
   merged-code shared-runtime gate, independent semantic review and protected
   PR health. Publish through normal DCO/queue, never an install hotpatch.
6. Coordinate qualified release with the existing producer. Verify current
   OAuth consent allow/deny/revoke, portal parity, exact owner/room isolation,
   stale UI, approval/denial/expiry and persisted exactly-once outcomes using
   the existing acceptance obligations. Never reset FAILED or use a new key to
   pretend a failed action succeeded. Browser policy denial remains a stopped
   verification channel with a separately recorded defect.

## Risks and rollback

The critical risk is classification/write drift under concurrent scope or lease
changes. Shared eligibility plus snapshot CAS must refuse before the effect.
Another risk is suppressing a legitimate human-approved authority operation;
tests must preserve that route. Unknown log or malformed scope data remains gated
or refused rather than guessed. Revert the refiner and its wiring through a
normal protected PR if acceptance fails; existing authority escalation remains
the conservative floor. No database reset, new grant, migration, self-approval,
credential repair or manual release tag is part of rollback.

## Backlog coverage

Independent review: initiative-06d5545b-ca1a-4f74-bafc-dedb695a5797,
passing review of commit 295df8913622a1369a050bda230628cc387c5385,
blob ca6fa23a044c48a703ed68158bbe9fc2ff63a059. Baseline:
baseline-e4e40c3d-c67e-4f50-8310-f5a8d1cf1957. Research:
initiative-ab219014-7a05-400c-9f51-c300a95f416e.

Atomic coverage receipt: cmv7jv3a24iof01qsegrgg83f; parent BI-8D8939E5,
deliverable OSR, no dependent or independently shippable children. Requirement
references OBJ-OSR-1 through OBJ-OSR-3; contracts resolveCallConsequence,
AuthorizationDecisionLog and workCapsuleActor; flow references current governed
dispatch context, write-time exact lookup and existing snapshot CAS;
verification AC-OSR-1 through AC-OSR-7. Native coverage readback was current and
implementation admission IRD-598C5907A1BC was allowed. Refresh immutable plan
provenance to the published implementation head before publication; these
historical review and coverage receipts remain immutable.

No protected delivery or live acceptance is claimed by this document.

---

## Amendment status and explicit supersession

BI-B13239B1 / WC-7663723E owns the proposed generation-binding repair below. The original BI-8D8939E5 approval, baseline and coverage above remain immutable historical evidence for its original behavior. They do not approve this amendment. The actual current Medium research and plan admissions govern source preparation; any owed retained parent-scope amendment review must use its current server-issued route. Publication, compatible canonical deployment and independent live acceptance remain separate outcomes. No repaired test or live acceptance is asserted here.

On adoption, the amendment explicitly replaces these original clauses; it does not silently combine them:

- AC-OSR-1/2 and the kind/value-only eligibility description gain exact persistent-room and original epoch/owner/intent preconditions under AC-SRG-1/2/3. Unknown, missing or stale original targets refuse without creating replacement approval work; existing authorization denials remain denials.
- AC-OSR-4 gains full-set transactional target validation and all-writer concurrency coverage under AC-SRG-4/5/6. A fresh snapshot alone cannot prove the original deferred intent.
- AC-OSR-5 preserves genuine human/graduated authority but never permits it to substitute a current acquisition for the request's original target. Target validation applies to every execution path. Forced ownership, handoffs and grant/process changes retain their floors.
- AC-OSR-6's duplicate no-op means recovery of an exact already-settled bound outcome. An unkeyed new request for an absent/stale target is refused; a historical unbound receipt cannot be upgraded. No second removal, fabricated receipt or replacement approval is allowed.
- The original paragraph limiting ownership restrictions to ordinary-refined calls does not exempt approved, human, maintenance or graduated execution from original-target validation. Current authority and result-access checks remain mandatory.
- The original rollback advice to revert the refiner does not authorize restoring an epoch-unaware writer or executor after enrollment. Use a governed forward correction retaining refusal/rotation, or hold enrollment until the compatible-runtime boundary is established.

The ordered steps below are one atomic implementation plan. Scope-token writers, release validation, callers and concurrency repairs cannot ship as independently safe slices. Automatic retirement of positively proven obsolete approval cards remains a tracked parent outcome; this generation-binding amendment alone does not deliver that separate lifecycle effect.

## Proposed amendment: original release targets (BI-B13239B1)

Planning only for BI-B13239B1 / EP-129D11FD. Amend the existing active
`docs/superpowers/specs/2026-10-14-owned-workroom-scope-release-design.md`
under the current declared Medium shape and its actual required gates; no new work carrier or implementation
authority is created by this draft. Kernel decision DI-69009A6443F3 selected
`explicit-target-prospective-epoch`, high confidence, autonomy eligible, no
commandment conflict. It refines DI-468736148230's generation-bound direction.

### Observed problem and current substrate

Old approval cmvxd1fl11x7j01tmedds81cq names only package.json in WC-3918FB64.
Actual activity49 released its original claim; activity51 acquired that path
again. Delegated triage declined the stale approval, preserving the new claim.
Current ownership checks and snapshot CAS do not bind a deferred request to its
original acquisition. Refresh timestamps are not acquisition identity.

Read-only source/independent review at913b29e248716b31e8ffd5c4db6cbdbc03e291c9
shows existing raw-argument approval fingerprints and CommandPayloadBinding can
preserve an explicit precondition. Reuse them and current scope/activity/receipt
records. No new table, grant, AuthoritySubject, global authorization service,
provider, deployment mode or human-facing token field is proposed.

### Explicit compatibility revision

Supersede the earlier planning draft's implicit legacy-immediate exception,
blanket no-token-on-legacy-refresh rule and universal fresh-intent classifier.
The immutable earlier critique remains historical evidence, not approval of this
revision. A server version token identifies protection beginning at a successful
prospective enrollment commit; it does not assert historical acquisition birth.

Every release intent identifies the exact persistent room and finite, sorted,
deduplicated target set, including server token, recorded owner and intent.
Caller-specified expected values express the requested precondition, never
authority. Compare them with server state under current authorization and the
existing mutation transaction. Missing, malformed or changed targets refuse the
whole operation. Never substitute current targets on an old request.

An authorized claim refresh may prospectively enroll an absent token under the
existing live-lease/ownership/force rules and full snapshot CAS. Reads mint
nothing. A malformed present token is not absence and must not be silently
replaced. New acquisition, release/reacquire, owner or intent change rotates the
server token; unchanged refresh preserves it. Publish only the committed token;
concurrent losers discard unpublished candidates and reread/re-authorize. Claim-
owned token metadata disappears on release; genuine extensions/shapes survive.

Updated callers obtain the committed token and formulate a new exact release.
This is an explicit compatibility transition: old kind/value-only callers and
old unbound approvals, commands and parked intents cannot transparently use it.
They are never upgraded, rebound, replayed or replaced with repeated approval
requests. An old source version is not a supported escape. Normal human UI
hides opaque token mechanics. Current-owner cleanup remains autonomous under
its existing authority, including authorized refresh/enrollment when needed.

### Concurrency and runtime prerequisites

Release target comparison, whole-set CAS, activity and bound receipt share the
existing real transaction/lock. One stale target causes no partial removal.
Receipt preparation parses/hashes explicit intent before cached lookup; exact
original replay returns the original result and performs no second removal.
Do not upgrade historical unbound receipts.

All full-JSON scope writers must respect concurrent ownership/epoch changes.
Source913 posture save/reset/shape reconstruct whole arrays and update by id
without scope/updatedAt CAS. Break-fix uses a capsuleId-only whole-array write.
Audit reused-child shape updates and every other scope writer, including the
enclosing locks; a transaction alone is not proof. Reuse the existing boundary
action's scope/updatedAt CAS pattern rather than add another current-state store.

Older writers can preserve unknown tokens through owner/intent ABA; old removal
can leave orphan metadata, and old executors ignore expected targets. Before
enrollment, prove the existing canonical deployment/drain excludes incompatible
writers/executors and that every permitted current writer obeys the contract.
If that cannot be established, hold enrollment and capture the exact prerequisite
gap. Do not invent a runtime freeze, new grant or unreviewed database enforcement.
Rollback must retain refusal/rotation through a governed forward correction;
reverting to an unaware executor reopens the defect.

### Objectives and acceptance

**OBJ-SRG-1:** Old approval or command intent cannot remove a later protected scope epoch.

**OBJ-SRG-2:** Current-owner cleanup stays autonomous through exact existing authority and prospective enrollment.

**OBJ-SRG-3:** Every writer, deferred path and release retains one concurrency and authorization contract.

| Acceptance | Objectives | Statement |
| --- | --- | --- |
| AC-SRG-1 | OBJ-SRG-1, OBJ-SRG-2 | Server-created prospective tokens are returned only after valid enrollment/acquisition commit; unchanged refresh preserves them, while owner/intent change or reacquisition rotates them. |
| AC-SRG-2 | OBJ-SRG-1 | Both aliases, human controls, current clients, approval/parked-request parsing, standing-authority resumption and command binding preserve the original explicit target before lookup/replay; no current-state recapture occurs. |
| AC-SRG-3 | OBJ-SRG-1, OBJ-SRG-3 | Missing/malformed/stripped/stale proof refuses without mutation or replacement approvals; pre-enrollment requests never inherit prospective protection. |
| AC-SRG-4 | OBJ-SRG-1, OBJ-SRG-3 | PostgreSQL races verify concurrent enrollment winner publication, release/reacquire, owner/intent changes, unrelated full-array writes and one stale target in a set; no partial mutation or stale token restoration occurs. |
| AC-SRG-5 | OBJ-SRG-3 | Existing all-writer snapshot CAS, transactional activity/receipt, exact replay, genuine extension/shape retention and current grants/always/propose floors remain enforced. |
| AC-SRG-6 | OBJ-SRG-3 | Compatible canonical writer/executor exclusion and safe forward correction are evidenced before enrollment; unknown or old participants cannot be assumed safe from optional JSON parsing. |
| AC-SRG-7 | OBJ-SRG-1, OBJ-SRG-2 | Current callers can perform authorized enrollment then a newly formulated exact release without an added human approval; old calls are explicitly incompatible rather than silently reinterpreted. |
| AC-SRG-8 | OBJ-SRG-1, OBJ-SRG-2, OBJ-SRG-3 | Protected publication, exact served approval verification and canonical live evidence support their own outcomes; obsolete-card retirement remains a tracked parent outcome, not silently dropped. |

Before implementation admission: finish the release-ingress/parser/client and whole-array writer inventory, preserve the existing full-batch release contract (no schema/parser numeric count ceiling is present), identify the exact canonical rollout integration and enrollment hold, and obtain the research and plan coverage required by the current effective Medium decision. Actual compatible-runtime proof follows protected canonical deployment and precedes enrollment; it cannot truthfully be asserted before the new source exists. Independent PR review and live acceptance remain required. Do not invent a large-shape spec or plan approval gate. Behavioral implementation and concurrency tests remain unrun; this document is a proposed design amendment, not a behavioral source fix. The isolated reproduction below has run.


Target-count clarification after independent review: do not introduce an
arbitrary new fixed cap, truncate a batch or split it into partial releases.
Matching stored targets bounds successful mutations, not raw input parse/hash
resources. Reject duplicate kind/value entries with conflicting token/owner/
intent; deduplicate only identical targets. Use indexed lookup and a canonical
set comparison/sort. Large source tests establish correctness, not performance.
No live aggregate SQL or host-credential fallback was used; transport capacity
and served/PostgreSQL resource evidence remain separate, measured facts.

Replay ordering remains an explicit design seam: current reference-monitor
gates precede the receipt wrapper. Preserve existing current grant/room checks,
original bound outcomes and stale-intent refusal without a new approval; do not
recapture current targets or invent historical replay authority when current
access has changed. Resolve this through existing settled-outcome/receipt
contracts before implementation admission.


### Reproduction established before implementation

At named HEAD 913b29e248716b31e8ffd5c4db6cbdbc03e291c9, the isolated
/tmp/dpf-b132-reproduction/stale-release.test.ts runs the actual source release
store and parser against a synthetic transactional DB double. Final result:
two expected defect failures and two passing controls. A stale epoch against a
newer same-owner/path claim resolves and removes ownership; parser output drops
expected identity. Current release succeeds and changed owner refuses. Evidence
cmvxlaz3z3rbg01tmhn0lkn6j records the actual run. These are source reproduction
facts, not a fixed result, live mutation, receipt integration or PostgreSQL race
proof. The temporary acquisitionToken name is a test probe, not an admitted API.

### Exact replay ordering selected for the amendment

Keep current authentication, user/token/coworker/delegation and room-result-access
denials. Do not promise write-RPC recovery after expired/foreign/revoked authority.
Before adding target-state refusal or creating/projecting/reserving a NEW approval,
recover an already-settled exact approval outcome and, if commandId is present,
a bound command outcome only where current existing authority permits disclosure.
Factor lookup-only handling from existing command receipt parsing, binding and
canonical lock prefix. It invokes no handler, inserts no receipt, renews no lease,
reserves no approval and never uses a fabricated successful no-op callback.
A typed settled-command variant may extend the existing settled-result contract;
never invent an approval ID. Bind caller authority scope, canonical command type,
persistent room and complete normalized original payload. Conflicting payload or
historical unbound receipt refuses; exact accepted/refused historical outcome is
returned without a second effect. Serialize with an in-flight identical command;
a bare read is not conclusive absence. Lookup/parse/lock failure is UNKNOWN,
not permission to escalate or mutate. Proven outcome miss leads to deterministic
missing/stale-target refusal before new approval work. Matching fresh intent then
continues through all existing authority floors, with a second authoritative
whole-target comparison inside the final real mutation/receipt transaction.
If existing result-read and mutation eligibility cannot be separated, preserve
the present denial and document the replay limitation rather than bypass it.

### Ordered atomic implementation sequence for BI-B13239B1

The steps below are internal sequencing of one atomic defect repair, not
independently deployable slices. Shipping only token writers, release validation,
callers, or whole-array CAS leaves an unsafe mixed contract. All eight AC-SRG
criteria above remain the acceptance contract; this amendment remains planning
until immutable canonical coverage and the existing review requirements pass.

1. Freeze canonical amendment, source inventory and requirement/contract/flow/
   verification references; bind the implementation parent and obtain existing
   review/coverage receipts. Include full-JSON writers, claim/release aliases,
   owner UI, deferred/approved/standing-authority ingress, command outcomes,
   restoration and canonical process/executor exclusion. Evidence must name the
   permitted participants, not assume every deployment resembles this install.
2. Add failing permanent behavior and interleaving tests. Retain the established
   red controls; cover legacy refusal/no replacement approvals, original target
   preservation, exact replay/conflict/unknown lookup, enrollment winner commit,
   token rotation/ABA, extension cleanup and full-batch atomic refusal. Do not
   substitute parser-only tests for final mutation or authorization behavior.
3. Implement server epoch normalization, new-acquisition rotation and prospective
   enrollment under existing authorized ownership/live-lease checks and full
   snapshot CAS/activity transaction. Return only committed token identity. Add
   persistent room ID to target binding: restore-workrooms.ts:66-100 creates a
   new row and copies scopeClaims, so semantic capsule ID plus copied token alone
   is insufficient. Existing room skips do not establish safety of copied command
   receipts; trace that separately before claiming restored replay protection.
4. Protect all current whole-array writers with the established row lock/snapshot
   comparison. Preserve each unrelated writer's intended delta when rereading;
   never restore old ownership from stale posture/shape/break-fix/child snapshots.
5. Carry the complete expected target through current clients and all ingress;
   add lookup-only original-outcome ordering and deterministic stale refusal
   before new approval work. Keep current denial and always/propose/grant floors.
   Perform authoritative all-target comparison and removal with bound receipt,
   activity and CAS inside the canonical real transaction. No nontransaction
   production mutation fallback or partial batch release is acceptable.
6. Run affected units, package typechecks, PostgreSQL interleavings and admitted
   served owner/agent/approval paths. Verify large full batches for correctness;
   measure actual transaction/runtime behavior separately without inventing a cap.
   Exercise canonical drain/compatible executor boundary and safe forward correction
   under the existing environment contract; unknown boundary keeps enrollment held.
7. Complete existing independent review, protected PR/queue, canonical release and
   live exact-target happy path. Record each evidence lane honestly; source/synthetic
   success cannot close production or obsolete-card retirement outcomes by itself.

Expected target matching uses one-room indexed claims and canonical distinct-target
sorting, not global history scans: expected O(n log n + m) set work and O(input bytes)
validation/fingerprinting. This is a design target, not measured capacity evidence.


### Current Medium admission clarification

Exact current plan claim IRD-D4849F86465C is effective Medium and returns research as a body design note (problem/options/chosen), with body objective baseline satisfied. The ratified active 2026-09-02 proportional-shape design §4 and executable shape precedence agree. The generic research escalation still repeats the Small failing-to-passing text; it is not an additional Medium requirement. Research receipt initiative-0b320be1-d650-4d32-9fac-17da42abd3e1 records completed Medium design investigation only; plan admission IRD-34EECC84669B is allowed. Repaired tests, PostgreSQL races and served/live acceptance remain UNRUN. Current ordered steps and all AC-SRG criteria are recorded in BI-B13239B1. Canonical documentation changes belong with the admitted atomic implementation, rather than a new spec committed solely to obtain a reviewer route. Existing current authority and any actually returned owed parent-scope amendment gate remain mandatory; none is assumed satisfied by this clarification.


### Backlog coverage for BI-B13239B1

Initial atomic coverage receipt: cmvxoewhs4ayl01tm2cty6nyj, bound to immutable plan commit 9f457425a641cd46162bfc629cd34a2d250b2c88 and blob 5b271b42b3b590ebf09c9c6db9d5afae97e12605. Deliverable SRG maps to BI-B13239B1 with no dependent or independently shippable children. Requirement references are OBJ-SRG-1 through OBJ-SRG-3; contracts are CommandPayloadBinding, AuthorizationDecisionLog and workCapsuleActor; flows are the exact replay ordering, concurrency/runtime prerequisites and ordered atomic implementation sequence; verification references are AC-SRG-1 through AC-SRG-8.

The current Medium body has the same eight criteria as readable AC bullets. Research receipt initiative-0b320be1-d650-4d32-9fac-17da42abd3e1 proves design investigation only; implementation admission IRD-003F4BBA8528 is allowed. Refresh immutable coverage provenance to the final committed source before publication, preserving this initial receipt as history. These records do not constitute a native plan verdict, repaired test result, compatible canonical rollout or independent live acceptance.

### Canonical compatibility implementation detail (BI-B13239B1)

The existing promoter caller-protocol contract supplies the continuing version
floor. Advance the portal caller to protocol 2; the corrected promoter accepts
callers 1–2 for the initial N-1 install. A corrected caller rejects an old max-1
artifact before privileged readiness or launch. Revalidate the actual immutable
artifact in the central promoter launcher, including runtime-transition and
recovery callers. The corrected promoter separately probes the actual produced
portal image for the scope writer contract before launch/swap. Neither promoter
protocol support nor the four reassessment owners substitutes for portal writer
proof. No new capability, grant, table, operating mode or user control is added.

Enrollment obtains current process/image packaged-writer proof and authenticates
the existing final maintenance-retirement receipt outside the scope transaction.
It freshly observes the canonical managed cohort, its daemon/project and full
current portal identity; old retired IDs must remain absent. Unknown evidence
keeps enrollment held. The sandbox is a separate database executor by the existing
compose and sandbox-isolation contract; its production MCP calls re-enter the
portal's current authorization/target checks. Do not treat its version as a grant
to write the production database.

Inside the acquisition transaction, before the room lock, take the existing
runtime-capability-transition and self-upgrade-admission advisory locks in that
order and refuse enrollment while either has active work. These existing durable
admissions close the check-then-launch race without holding a database transaction
across Docker or introducing a runtime freeze. A process-bound retained proof is
checked before the mutation. Initial enrollment remains held through canonical
retirement, including the existing early-boot success/fallback interval. Future
updates retain protocol 2 and the actual portal contract check even when there are
no currently held claims; zero current claims do not erase the compatibility floor.

Verification must include max-1 artifact refusal, independent portal-probe failure,
current-image/cohort/receipt mismatch, and both admission/enrollment race orders.
These are implementation obligations, not claims of completed runtime evidence.


The read-only probe lives with the Workroom source under
`apps/web/lib/work-capsules/scope-epoch-writer-probe.mjs`. The existing canonical
Dockerfile already ships that complete application source at `/app/apps/web-src`;
its existing entry-module dependency is also packaged. This uses the feature's
existing source closure and requires no shared Dockerfile change. The discarded
root-script COPY proposal was never applied or published. Runtime observation
uses the existing pure maintenance-epoch receipt module, already present in both
the portal and N-1 promoter closure; it does not import promoter-only secret or
migration operations into the web bundle.
