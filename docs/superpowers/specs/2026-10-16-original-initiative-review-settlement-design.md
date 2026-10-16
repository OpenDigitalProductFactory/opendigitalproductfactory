---
status: draft
backlog: BI-7906C73E
---

# Recover an interrupted initiative review from verified execution evidence

BI-7906C73E is the historical-recovery contribution under BI-06AE6833. It blocks
Workroom metrics BI-C684AF45. The operator explicitly requested this repair and
completion of the original metrics outcome. This document is design evidence,
not implementation admission, execution settlement or independent approval.

## Observed failure and boundary

On served recovery107, original initiative review 75512C999571 remains
`input-required`, with `executionUncertainty.settlement=unknown`, unchanged since
2026-10-16T07:32:42.697Z. Its immutable request digest is
`b318f8fd47ad7b1466703bc54a2b9cf909fb04d98ae923df8f00dbb5bf0b89d6`.
The bound metrics source is `8c0b470f80277a01c05be7b17cd790daf5eb3517`, blob
`58705102d07b1b202b6e806c53243bb524e4b2b0`, in WC-2BE74A0B. Normal plan claim
IRD-75610C2D95E8 refused because the required independent receipts do not exist.

The task records a claimed dispatch and an uncertain native CLI result. It has
no terminalWriterWait checkpoint, TaskArtifact, task-bound ToolExecution or
AsyncInferenceOp. The same bounded inventory is empty for 7F9018F14572 and
D836297A5934. Empty inventories are not complete execution or effect capture.
The original saved authority includes broad grants as well as reader/writer
selectors. The actual historical native capability inventory is not established.

`hasExecutionUncertainty` intentionally refuses these attempts. Original-review
recovery requires a safely stopped writer checkpoint and cannot consume a
generic semantic-review recovery receipt. No supported original initiative
settlement importer currently supplies the missing transition.

The separate [prospective CLI launch contract](2026-10-15-maintenance-epoch-recovery-evidence.md#prospective-cli-launch-binding--october-16-design-amendment)
under BI-06AE6833 records future launch identities. It cannot backfill historical
membership. BI-8B8731EE's delivered signed retirement producer establishes an
environment observation, not which task ran there or which external effects
ended. BI-8ECEC429 covers a separate semantic-review lifecycle; BI-594CF003 and
BI-E35E1183 cover packet completeness and provenance retry respectively.

## Objectives

**OBJ-HISTORY:** Preserve the original review identity, evidence and unknown outcome while explaining exactly which recovery proof is missing.

**OBJ-RECOVER:** Admit bounded recovery on that same task only after authenticated execution and complete relevant-effect reconciliation under current authority.

**OBJ-FENCE:** Prevent stale callbacks, concurrent recovery and delayed approvals from publishing across the admitted execution generation.

## Acceptance contract

| Criterion | Objectives | Observable result |
| --- | --- | --- |
| AC-HR-1 | OBJ-HISTORY, OBJ-RECOVER | Readback and admission bind the exact original TaskRun, immutable request digest, dispatch/reservation generation, source and current authorized owner. Cross-user, changed-source, stale or concurrent requests refuse before external effects. |
| AC-HR-2 | OBJ-HISTORY, OBJ-RECOVER | The collector enumerates the actual reachable capabilities and every relevant effect with attributable evidence. Recovery requires authenticated original execution membership and closure, or genuine old-writer revocation plus complete reconciliation of all possibly started effects. Missing capability coverage, membership, closure or effect proof remains unknown. |
| AC-HR-3 | OBJ-RECOVER, OBJ-FENCE | One same-task recovery reservation atomically binds verified proof, immutable request and remaining original budgets. Late execution results, writers and approval continuations cannot cross its fence. No client nonce, replacement request, reset budget or authority widening is introduced. |
| AC-HR-4 | OBJ-HISTORY, OBJ-FENCE | A genuine canonical receipt is reconciled before requesting inference. Execution evidence, an empty audit, a client assessment and successful dispatch never become review approval. Historical uncertainty and proof remain available after an admitted recovery. |
| AC-HR-5 | OBJ-RECOVER, OBJ-FENCE | Adversarial source tests, protected delivery and canonical served verification prove both supported recovery and refusal with missing proof. The original metrics work advances only after its genuine independent receipts and normal planning admission. |

## Architecture decision

WWMD DI-08A2750D3287 selected `same-task-proof-gated` over a server-issued
successor. The consult was usable, autonomy-eligible, high confidence and stable,
with no commandment conflict. Same-task composite was 5.54074 versus 4.73843,
margin 0.80231. Leading contributors were Absorb Don't Adopt, Ship Real
Functionality and Never Assume Verify. The four scored axes were engineering
estimates of reach, interaction cost, maintainability and evidence density;
they are not measured recovery results. Both options required identical complete
proof; the decision cannot relax that requirement.

The first consult DI-B4740BF6F480 abstained. This caller used unsupported
`kind` evidence locators and failed to cite each enforced feature. The corrected
consult used `sourceType` locators and per-axis Grade C citations. There is no
verified feature-stripping platform defect and no need to repair that tool.

Reuse TaskRun immutable metadata, dispatch/reservation CAS, TaskArtifact for
bounded evidence references, current OAuth execution authority, governed tool
mediation, approval reservations and canonical receipt writers. Add no task
ledger, scheduler, grant, provider or independent-review mechanism. Do not store
a locally minted handle as a provider operation ID.

### Proof collection and validation

The recovery collector is server owned. Its input is the original task locator
under current Workroom access, not caller assertions that execution settled.
Resolve the immutable saved request and selected execution provenance first.
Return typed missing-evidence findings without model execution when coverage is
incomplete. A user-entered health result cannot attest an unobserved process.

Collect only authenticated records from the existing execution/authority/effect
owners. Every evidence reference binds task, request digest, actual attempt,
dispatch/reservation identity, emitter, observation sequence and recorded source.
Unknown versions, conflicting emitters, stale observations, future timestamps,
unbounded/truncated inventories and mismatched identities refuse qualification.
Persist validated bounded checkpoints on the existing task/evidence substrate;
preserve the original uncertainty bytes rather than deleting the marker.

Each executable effect adapter must establish an explicit closed coverage set.
Required-writer lists and the source's sixteen-tool denylist are not proof of the
actual enabled native capabilities. If that historical set cannot be established,
the original task remains held. The collector cannot default to writer-only
coverage merely because the request intended an independent review.

| Possible effect family | Required recovery evidence |
| --- | --- |
| CLI preparation, private files and process descendants | Actual original launch target/configuration and authenticated closure or verified quarantine; mutable sandbox aliases and timestamps alone are insufficient. |
| Provider authentication/renewal and account state | Attribution to the original operation and the account owner's actual recorded result; a quota diagnostic does not establish whether preparation refreshed credentials. |
| Native MCP callbacks and canonical writer | Complete admitted-call/reservation coverage, current generation check and actual domain outcome; receipt deduplication alone does not revoke an old writer. |
| Pending approvals and delayed continuations | Exact original envelope and effect reservation; current scope, expiry and generation revalidated before execution and commit. |
| Remote/provider/native tools outside the intended writer | Actual capability inventory and each provider/effect owner's closure or reconciliation acknowledgement. An absent local audit cannot supply this proof. |

Do not invoke arbitrary tools, rotate credentials or stop unknown processes to
obtain this evidence. Read authority metadata without exposing credential bytes.
Reconciliation respects the current grant intersection and paired-peer boundary.

### Atomic fence and original-task recovery

Refactor existing generation predicates into one shared server-only contract.
The existing bound-review-effect lock explicitly is not a generation fence:
it selects status and metadata, and does not itself reject input-required,
executionUncertainty or changed progress generation. Establish actual coverage
at every reachable effect boundary rather than changing that one comment.

After proof qualification, lock the original task and relevant effect
reservations in stable order. Recheck current human/coworker OAuth authority,
exact current issued packet, source, proof references, cancellation, deadlines
and original aggregate budget. In the same transaction, reserve one continuation
generation with its qualified proof reference and reject late prior generations.
Approval completion and canonical writer commit must participate in that fence;
a preflight check before an await is insufficient. Preserve current receipt
lock ordering and test it against cancellation/recovery races.

A valid original canonical receipt wins before new inference. Recovery joins
that real result and reevaluates its actual readiness finding. An unknown task
with no writer checkpoint, such as755, needs a fully specified continuation from
its immutable accepted request after proof qualification; never manufacture a
completed reader traversal or reset the missing-writer counter. If existing
recorded budget/deadline semantics cannot represent that continuation safely,
return an explicit unsupported checkpoint rather than starting another review.

The existing request_coworker/reviewRecovery lane is the admission surface.
Readback issues the exact original locator only after current authority and proof
qualification. Existing workers resume the same bounded task; no new request
key, provider fallback, parallel worker or client polling controller is added.
Any final settlement/result write uses the same generation CAS. Proof is not an
independent verdict; only the genuine governed writer can satisfy readiness.

## Historical applicability and implementation prerequisites

Currently inspected755,7F andD836 evidence does not qualify recovery. This repair
cannot truthfully promise that a missing immutable launch/configuration record
can be reconstructed. Original metrics8c, its body and755 remain unchanged.
Do not claim prospective recording or a newly deployed collector clears them.

Before implementation admission, establish an executable proof collector for
each effect family and a real authoritative source for every field it requires.
If no such source exists for historical attempts, publish that specific
unsupported condition. A collector that only refuses missing evidence is not
completion of AC-HR-2/5 or of the original metrics objective.

Implementation must resolve scoped tests/impact guards and obtain valid native
design/spec/architecture review, objective mapping, plan coverage and normal
implementation admission. Approximately one fifth of implementation consolidates
generation and effect predicates in their existing shared homes. Funding scope
is unresolved in the initial claim; no cumulative funding allocation is inferred.

## Verification and rollback

Use injected authority, store, process and effect adapters for source tests.
Cover changed task/digest/source, malformed or future proof, missing membership,
truncated capabilities, unknown remote outcome, already-issued approval,
cancellation, concurrent recovery, late callback/settlement and genuine receipt
readback. Include a callback paused between authority read and commit to prove
the transactional fence. Missing-writer and native legacy cases retain counters.
Test that unavailable proof produces zero provider starts and zero successor
tasks. Source fixtures do not prove actual historical process/effect closure.

Run affected unit and PostgreSQL concurrency tests, package typechecks and exact
protected delivery gates. Canonical served verification must exercise one
genuinely qualified recovery and one missing-proof refusal, and observe a real
independent writer/readiness result before claiming recovery completion. No
provider probe or retry is authorized merely to create a test fixture.

### Deployment and rollback barrier

The present session JWT carries taskRunId/scopes but no execution generation,
and older canonical writers do not inspect progress generations. Metadata alone
cannot make those binaries refuse a qualified callback. The first admitted
recovery therefore requires verified deployment coverage of every process that
can accept its callbacks, complete approvals or publish the affected effects.
Mixed old/new serving coverage is an admission refusal, not a rolling-upgrade
assumption. Reuse canonical deployment/readiness and generation authority; do not
invent a client capability flag or claim a worker check protects an older writer.

Rollback first disables new recovery admission while keeping the compatible
fence, observation and receipt readers in service. A forward repair can remove
new admission without removing those protections. Serving pre-fence binaries
is prohibited while any admitted generation capability or possibly started
effect remains unresolved. A binary downgrade needs positive complete draining
or revocation of every issued generation capability, closure/reconciliation of
its effects and authenticated retirement of every old callback/worker process;
token age or an empty active-task list alone does not qualify it. If that proof
is unavailable, retain the compatible reader/fence and refuse downgrade.

The implementation must place this barrier in the existing canonical deployment
and runtime admission contracts before enabling recovery. Test a real old-format
session and old writer against mixed-version and downgrade admission, not just a
mock worker claiming it understands an unknown version. No recovery is enabled
until this compatibility obligation has an executable owner and passing checks.
Retain history/proof and unknown holds; never coerce qualified generations into
legacy replay. Coordinate one canonical release through the existing producer;
do not edit installed runtime assets.
