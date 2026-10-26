---
status: draft
backlog: BI-7906C73E
---

# Recover an interrupted initiative review from verified execution evidence

BI-7906C73E is the historical-recovery contribution under BI-06AE6833. It blocks
Workroom metrics BI-C684AF45. The operator explicitly requested this repair and
completion of the original metrics outcome. This document is design evidence,
not implementation admission, execution settlement or independent approval.

**Spec-approval scope and gate order.** This review assesses the proposed design,
its marked objectives and acceptance statements, and the adequacy of its proof,
authority and verification contracts. For the first scope baseline, a passing
independent spec-approval receipt atomically creates that baseline through the
governed writer. The baseline is an output of this gate. The author then records
plan coverage against the genuine baseline and obtains normal implementation
admission. This order follows the [backlog and planning
contract](../../architecture/backlog-and-planning-runbook.md); an absent first
baseline or downstream coverage receipt describes preimplementation state.
Neither is a substitute for independent design judgment.

Spec approval does not establish original launch membership, capability or
effect closure, qualify a historical execution, or authorize replay. The
implementation prerequisites and positive recovery requirements below remain
mandatory. A substantive defect in their design or feasibility remains grounds
for a failing review. Approval of the proposed scope cannot waive those later
checks or turn the dated observations below into completed work.

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

### Research & Benchmarking: what a collector can actually prove

This research amendment preserves DI-08A2750D3287 and the acceptance contract.
It does not enable a retry, replace a task, or qualify a historical execution.
The normal handoff of WC-FDAC8963 transferred design research to the current
executor; the separately owned writer-fence implementation remains outside this
worktree's scope.

Three primary-source comparisons inform the collector boundary:

| Existing contract | Adopt in DPF | Do not infer or adopt |
| --- | --- | --- |
| [Temporal Activity idempotency](https://docs.temporal.io/activity-definition#idempotency) distinguishes an effect that happened from a completion that reached workflow history. Activities can execute again after a lost completion. | Require the effect-owning service's idempotency and result contract; split independently observable effects instead of treating the whole agent turn as one effect. | An absent workflow completion does not prove that an external action never happened. Workflow durability does not make arbitrary effects exactly once. |
| [AWS Step Functions redrive](https://docs.aws.amazon.com/step-functions/latest/dg/redrive-executions.html) retains execution history and the original definition while re-running unsuccessful steps. | Preserve immutable inputs, source, completed steps and explicit recovery eligibility. | Do not import its retry/timeout reset behavior: this DPF contract preserves the original aggregate budget. An eligible redrive in another product is not authority to redrive an uncertain DPF task. |
| [Amazon's idempotent API contract](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/) binds caller intent to a stable request identifier, couples mutation and deduplication atomically, and rejects changed parameters. | Keep the original digest, reconcile the durable winner, and account for late arrivals at the actual writer. | A new key or a matching cached response does not establish closure of other effects outside that writer's transaction. |

These comparisons support the existing design; none supplies missing historical
DPF telemetry. They also explain why a generic health check or another model
call cannot replace effect-specific reconciliation.

#### Available sources and their limits

The finite D836 inventory was read through its native task/backlog context.
Its request digest is
`8d1e43f7ba6d981600ccd205acd6b90d632bacbdbc9017f5952e7d177dfb4daf`,
dispatch attempt is 1, and the immutable handoff artifact is source
`a15d9fcb8a7663bbe5f71a27a5f4920cd52e3bf2`. Its recorded uncertainty is not a
canonical review verdict. The source audit below uses retained runtime105 commit
`6bbf191fd9a5ec58857a21656ca985a120485da2`; source inspection is not proof that
this exact process, configuration or binary performed the original launch.

| Evidence owner/source | What can be established | Remaining qualification requirement |
| --- | --- | --- |
| TaskRun accepted metadata, immutable artifact and dispatch checkpoint | Logical request identity, intended writer/readers and recorded attempt. | Actual launch identity must be authenticated separately; a dispatch event is not an execution-membership receipt. |
| Native task artifacts and linked provider operations | D836's previously inspected exact TaskArtifact and AsyncInferenceOp inventories were empty. | A complete original capture contract or a retained emitter acknowledgement is needed. Empty inventories are not a complete effect inventory. |
| `routing/cli-adapter.ts` and `cli-owned-runner.ts` | The inspected source resolves provider auth, stages private files and launches through a mutable sandbox name. | Original resolved executable/configuration, immutable launch membership, descendants and any remote operations need actual emitter records. Current container identity cannot fill these fields. |
| `governed-tool-audit.ts:124-132` and `mcp-governed-execute.ts:609-755` | Consequential calls reserve an audit/receipt before execution and refuse if reservation fails. Other calls can execute before their audit is written; audit persistence failure returns no row. | Classify the actual original invocation path and reconcile domain receipts/reservations. A global zero ToolExecution count cannot prove no platform mutation. |
| `mcp/packs/initiative-readiness-pack.ts:140-148` and canonical receipt repositories | The inspected definition base declares side effects without itself declaring a consequence. The canonical writer has a separate durable domain result. | Resolve actual call classification and the exact task/authority-linked domain winner. Do not assume every readiness write used the consequential pre-execution reservation path. |
| Provider credential owner and actual provider operation | Source auth resolution may refresh before inference; present account state is readable through existing authority. | The original attributable auth/operation result is required. A currently healthy account or quota error cannot attest the old preparation outcome. |
| Approval/effect owner and maintenance retirement producer | Specific approval reservations and authenticated retirement can have their own durable identities. | Bind each to the actual original operation and reconcile its effects. Retiring a container is not proof that an unlinked task ran there or that remote effects ended. |

The audit reservation distinction matters even if a task reported zero tool
calls. At the inspected source, an ordinary tool may commit its domain change
before audit persistence fails. Conversely, a known consequential path can have
a durable pre-effect reservation. The collector must inspect that path and its
domain result; neither observation justifies a blanket assertion about all tools.

#### Ordered collector qualification

1. Resolve the exact saved request and original actor through the existing
   requester-owned readback. Do not borrow another task's result action,
   credential, Workroom or proof. A semantic-review result is a separate lane
   from an initiative-review recovery checkpoint.
2. Establish the original reachable capability set and enumerate its effect
   owners. For each owner, identify the retained authoritative locator and the
   contract that makes its read complete, attributable and final. A required-tool
   list or static native-tool denylist does not establish this set.
3. Reconcile actual domain winners and pending reservations, then establish
   original execution closure or the complete revocation/reconciliation branch
   already required by AC-HR-2. A prospective generation fence only supplies its
   own boundary; it cannot synthesize historical launch membership.
4. Qualify existing generation, authority, deadline and budget checks only after
   that evidence is complete. Otherwise return the existing missing-evidence
   recovery result, with the missing artifact and accountable emitter. Do not
   start inference to discover whether the old inference had effects.

Distinguish evidence that has not yet been read from provenance that no retained
authoritative source can supply. For D836, the finite inspected records do not
establish launch/capability/effect completeness; they do not prove that every
possible upstream source was searched. An owner may still provide a genuine
retained producer receipt. Until then, the supported result is an explicit
unsupported historical-provenance finding, with uncertainty preserved. Repeated
reads of the same task or deployment do not advance that finding.

This amendment completes neither native research acceptance nor collector
implementation. No failing-then-passing collector proof, genuinely qualified
historical recovery, or served recovery success has been run here. In particular,
a missing-proof refusal and the separate writer-fence tests cannot satisfy the
positive recovery case in AC-HR-2/5. Before implementation admission, the owner
must name an available authenticated producer for each required evidence family
and demonstrate a genuinely qualified input without replaying the held originals.

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

Implementation must resolve scoped tests/impact guards and satisfy the current
server-issued readiness requirements, plan coverage and normal implementation
admission. Do not infer required gates from the delivery-size label alone.
Approximately one fifth of implementation consolidates
generation and effect predicates in their existing shared homes. Funding scope
is unresolved in the initial claim; no cumulative funding allocation is inferred.

## Ordered implementation plan

**Implementation parent:** BI-7906C73E; existing Workroom WC-FDAC8963 and branch
`fix/original-review-settlement`. This fix keeps its sequence in this canonical
design rather than creating a second plan document. The historical investigation
and collector/admission integration belong to this parent. The separately owned
`fix/original-review-writer-fence` contribution supplies a prerequisite writer
fence; this plan neither takes its edit claims nor declares it delivered.

The native readiness read on 2026-10-18 identifies profile `fix`, permits design,
and reports only RESEARCH_REQUIRED and PLAN_REQUIRED before implementation.
Research is author-owned reproduction and verification on a named source;
completion separately owes acceptance and objective reconciliation. This read
supersedes the earlier blanket instruction to obtain feature spec/architecture
receipts before implementing this fix. The server still selects the coverage
schema and prerequisite baseline: an absent baseline is not permission to invent
one, lower the work shape, or self-approve a design.

### P1 — Establish executable evidence adapters

Acceptance references: AC-HR-1, AC-HR-2; contract reference: CONTRACT-PROOF;
flow reference: FLOW-COLLECT; verification reference: VERIFY-PROOF.

Resolve the saved request through `mcp-task-persisted-request.ts`, current actor
checks through `mcp-task-review-recovery.ts`, and original uncertainty through
`shared/execution-uncertainty.ts`. These files exist under `apps/web/lib/` on
source `46f9f42b28aff0af9bbc92c0140f1d01de516b8f`; the recovery loader and
readback issuer reject uncertainty rather than qualifying it. Preserve that
refusal until the complete qualification contract is implemented.

Use the existing owners below; implement no arbitrary JSON proof importer.
Each adapter must authenticate the producer, bind the original identity, expose
inventory completeness and finality, and distinguish unavailable from empty.

| Evidence adapter | Existing owner and locator | Historical qualification boundary |
| --- | --- | --- |
| Saved request and dispatch | TaskRun metadata/progress plus persisted-request reconstruction; TaskArtifact references use the TaskRun row identity. | Retained logical identity is available; dispatch does not authenticate a launched process. |
| Execution membership and closure | `routing/cli-adapter.ts`, `routing/cli-owned-runner.ts`, and `self-upgrade/maintenance-epoch-evidence.ts`. | A task-bound immutable launch receipt and closure are required. Signed environment retirement without original membership is insufficient. Prospective launch recording cannot backfill it. |
| Tool reservation and durable winner | `mcp-governed-execute.ts`, `tak/tool-execution-receipt.ts`, and each called domain's canonical repository. ToolExecution uses the semantic task id. | Consequential pre-effect reservations differ from post-effect best-effort audits. Enumerate actual admitted capabilities and domain results before treating an empty audit as complete. |
| Approval continuation | CoworkerActionEnvelope taskRunId, authority decision, exact argument fingerprints and associated ToolExecution/receipt. | Resolve pending, expired and executed states under current authority and the writer fence; do not cancel an unknown envelope as evidence collection. |
| Provider operation | AsyncInferenceOp identityVersion, task row relation, request/binding digests, operationId and ordered transitions. | A real operation identifier and attributable final result can qualify only that operation; an absent row does not cover an uninstrumented native CLI. |
| Authentication and other native/remote effects | The actual enabled capability inventory and the original credential/provider/effect owner's retained operation record. | Present account health and a static denylist cannot supply the original inventory or authentication result. No generic complete producer has been demonstrated for the inspected originals. |

Before an implementation claim, prepare the reproduction from the actual
original readback and the named source refusal, then identify a retained,
authenticated qualified input for every adapter. Candidate causes already
distinguished by the recorded result are approval gating (requiresApproval=false)
and writer invocation failure (no terminalWriterWait); these do not establish
execution closure. A quota result explains a provider failure but leaves child
closure unverified. No current-tree failing-to-passing collector test has run.

VERIFY-PROOF requires two different proofs: a regression that fails on the
unrepaired qualified case and passes after repair, and unchanged zero-dispatch
refusal for incomplete/foreign/truncated evidence. Exercise real owner readers
as well as injected malformed fixtures. Source fixtures establish validation
behavior, not historical settlement. If no authenticated qualified input exists,
P1 reports the missing producer and stops admission; it does not report research
or AC-HR-2 as passed on refusal tests alone.

### P2 — Consolidate qualification and integrate the writer fence

Acceptance references: AC-HR-1, AC-HR-2, AC-HR-3; contract references:
CONTRACT-PROOF, CONTRACT-FENCE; flow reference: FLOW-QUALIFY;
verification reference: VERIFY-FENCE. Depends on P1 and the separately owned
writer-fence contract becoming qualified on the integration source.

Refactor repeated generation, uncertainty and current-authority predicates in
their existing shared homes before adding an admission branch. Keep at least
one fifth of implementation effort on that consolidation, measured by the
reviewed change and eliminated duplicate decisions rather than filler edits.
Reuse the writer-fence owner's authenticated generation contract at tool entry,
approval continuation, canonical receipt commit and task settlement. Resolve
actual edit claims and the returned testImpact/guardObligations first; unresolved
impact advice requires exhaustive verification. No code paths are claimed by
this documentation checkpoint.

VERIFY-FENCE covers real PostgreSQL races: callback paused after authorization,
concurrent recovery, cancellation, delayed approval and a writer committing
across reservation. One durable winner is allowed; stale generations cannot
publish. Reuse valid exact-source evidence from the fence owner where applicable,
and test this integration's additional boundaries rather than duplicating its
release or treating its tests as collector qualification.

### P3 — Admit one same-task continuation

Acceptance references: AC-HR-1, AC-HR-3, AC-HR-4; contract references:
CONTRACT-FENCE, CONTRACT-RECEIPT; flow reference: FLOW-RECOVER;
verification reference: VERIFY-RECOVERY. Depends on P2.

Extend `mcp-task-review-recovery.ts` and the existing terminal-writer reservation
and background dispatch paths only after qualified proof. Under their stable
lock order, recheck the immutable request, actor, source, proof, prior generation,
deadlines and aggregate budgets. Read a genuine canonical winner first. Preserve
the original uncertainty and history while reserving one continuation; do not
remove the uncertainty field merely to make the old predicate return false.
Issue the exact supported recovery locator through existing readback and retain
the original task and request key. Unrepresentable legacy checkpoints remain
typed unsupported results with no inference or successor task.

VERIFY-RECOVERY extends the existing `mcp-task-review-recovery.test.ts` and
terminal-writer/dispatch suites with qualified positive admission, duplicate and
late arrivals, conflicting receipts, missing-writer budgets, expired deadlines,
revoked authority and changed source. Tests must count provider starts and task
creation explicitly. A passing admission test is not an independent review.

### P4 — Qualify delivery and served behavior

Acceptance references: AC-HR-2, AC-HR-4, AC-HR-5; contract references:
CONTRACT-PROOF, CONTRACT-RECEIPT; flow reference: FLOW-VERIFY;
verification reference: VERIFY-SERVED. Depends on P3.

Run affected package tests/typechecks and PostgreSQL tests in a compile-ready or
governed shared environment. Apply the canonical merged-tree gate, independent
source assessment, DCO PR and protected merge. The existing release coordinator
alone advances the install. Verify deployment coverage and rollback protections
before enabling recovery. Exercise one genuinely qualified, authorized original
and one missing-proof refusal on the served source; observe the real independent
writer and native readiness. Do not launch a new reviewer merely to manufacture
an uncertain task. If no genuine positive case can qualify, retain the hold and
report AC-HR-5 as unproven.

### Backlog coverage

Proposed decision: atomic, with BI-7906C73E as the implementation parent for
P1–P4. These are internal sequencing: evidence adapters without the fenced
consumer cannot recover a task, and admission without complete adapters must
remain disabled. The independent writer-fence contribution retains its own
carrier and release evidence; it is a prerequisite, not duplicate parent work.

| Deliverable | Implementation BI | Depends on | Objectives | Acceptance | Contracts | Flow | Proof checks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P1 | BI-7906C73E | None | OBJ-HISTORY, OBJ-RECOVER | AC-HR-1, AC-HR-2 | CONTRACT-PROOF | FLOW-COLLECT | VERIFY-PROOF |
| P2 | BI-7906C73E | P1; separately owned writer fence | OBJ-HISTORY, OBJ-RECOVER, OBJ-FENCE | AC-HR-1, AC-HR-2, AC-HR-3 | CONTRACT-PROOF, CONTRACT-FENCE | FLOW-QUALIFY | VERIFY-FENCE |
| P3 | BI-7906C73E | P2 | OBJ-HISTORY, OBJ-RECOVER, OBJ-FENCE | AC-HR-1, AC-HR-3, AC-HR-4 | CONTRACT-FENCE, CONTRACT-RECEIPT | FLOW-RECOVER | VERIFY-RECOVERY |
| P4 | BI-7906C73E | P3 | OBJ-HISTORY, OBJ-RECOVER, OBJ-FENCE | AC-HR-2, AC-HR-4, AC-HR-5 | CONTRACT-PROOF, CONTRACT-RECEIPT | FLOW-VERIFY | VERIFY-SERVED |

When recording native coverage, map the Objectives column to requirementRefs
and the Acceptance column to verificationRefs. The VERIFY-* labels name the
proof checks described in P1–P4; they are not scope-baseline acceptance IDs.

**Historical coverage observation:** the native receipt was not recorded after
one request on published commit
`b6980fde56afecec40156f7312d319b3dba0df8c`, blob
`27ac3cef9bfcacb9f9c90eed03b73d5f92042fb9`, returned
`traceability-incomplete`: **no initiative scope baseline exists for
BI-7906C73E**. Its supported same-room implementation-claim remedy returned
IRD-C9039B49742F and an exact independent spec-approval route. No reviewer task
was submitted. Although fix readiness directly lists research and plan, the
large coverage contract still requires that baseline; the readback does not
waive this indirect prerequisite. Resume with the server-issued route only when
reviewer execution is eligible, then submit corrected coverage against the
genuine baseline and exact current immutable source. Do not repeat the rejected
request unchanged. No Markdown table, client assessment or blocked-by
placeholder stands in for the native receipt.

### Finite unsupported boundary and resumption

The inspected original755 and D836 records retain immutable logical identity
but do not supply complete original launch membership, capability inventory or
effect closure. Those missing historical facts cannot be produced by a newer
deployment, current credentials, a new request key or prospective fence tests.
No retained authenticated qualified case has yet been demonstrated. The proof
owners listed in P1 must supply the actual original records, or the collector
must return unsupported historical provenance while preserving unknown.

At this planning checkpoint, native research acceptance, plan coverage,
implementation admission, collector code, qualified recovery and the main
BI-5366EF78 handoff were separate outstanding results. Later dated observations
record only their specific progress. This plan's sequence is not evidence that
historical recovery or the thread's desired outcome is delivered.

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

## October 19 bounded source recovery: original proof inventory

The normal author research writer accepted preimplementation diagnostic research
as `initiative-2f0151e8-426c-4d6f-9ce4-0159590516a7` against immutable
`43f7c590105caa3877e690407bf6847da7642847`. This advances the author research
lane; it does not pass P1's positive proof qualification, implement recovery, or
settle the original executions. Plan coverage still lacks an independently
approved scope baseline. Its original DED689F4DDF6 review remains UNKNOWN.

AGENTS.md section 1 and the checked-in recovery-routing reference permit bounded
source repair of unavailable admission machinery under the operator's existing
repair instruction. The Workroom records the unavailable baseline/review gates
and exact source claims. DCO, tests/typechecks, independent assessment, protected
publication and canonical deployment remain required. No missing authority is
waived, no baseline is invented and no new review request is issued.

Fresh main already supplies `mcp-task-original-result.ts`: it authenticates the
original requester/coworker and exact room, verifies immutable request identity,
reads canonical writer receipts and rechecks authority. Extend that reader rather
than create a second settlement or proof-import surface.

The bounded contribution queries metadata-only inventories for TaskArtifact and
AsyncInferenceOp through the TaskRun row identity, and ToolExecution and
CoworkerActionEnvelope through the semantic task identity. Each source is capped
at eight records plus an overflow sentinel. Raw artifact parts, tool parameters
and results, approval arguments and provider output are not selected or returned.
Two reads fingerprint the selected observation fields; changed, unavailable,
overflowing or mismatched inventories withhold counts. Current read authority
is checked again before any inventory is returned.

This is a task-linked observation inventory, never a complete capture contract.
Its output always declares capture completeness false and settlement unknown,
and names the required original launch, capability, descendant, credential,
effect-reconciliation and late-writer/approval-fence producers. Zero rows and
printable completion claims cannot satisfy any of those contracts. Auxiliary
inventory failure does not erase a separately authenticated canonical receipt;
that receipt still grants no replay or effect-settlement authority.

The first regression ran on the unrepaired reader and failed specifically on
the missing structured inventory (61 other tests passed). Focused tests exercise
bounded inventories, correct relation identities, access denial/revocation,
late approvals, unavailable/overflowing sources, canonical-receipt precedence
and rejection of printable proof claims. These are source behavior tests, not
historical launch/closure proof or the positive recovery case in AC-HR-2/5.

Response-budget calibration found a real auxiliary failure: seven valid writer
observations for the same genuine receipt, with current/prior native and capacity
observations, produced a 7,961-character base result; attaching the inventory
crossed the unchanged 8,000-character cap and erased the receipt. Qualify the
complete base result first. When only the auxiliary inventory exceeds the cap,
omit it and return `proofInventoryUnavailable: "budget"` if that marker fits;
otherwise return the complete base without the marker. A valid locator three
characters longer exercises the marker-omission boundary. Base overflow still
returns the original over-budget refusal. Neither path authorizes replay.

## October 23 bounded recovery: issued review admission

The live implementation claim for BI-7906C73E issued a spec-approval packet
because plan coverage lacked its objective baseline. Admission rejected that
exact packet with "This item has no pending review for the requested lane."
A merged diagnostic contribution had made delivery completion allowed; that
projection erased the prerequisite the admission selector used. No task was
created by the refused request.

Keep delivery completion unchanged. Resolve the missing planning prerequisite
from the complete own and inherited baseline history, and pass that compact
observation to the existing independent-review selector for both bounded reads
and request admission. Only input-required implementation with missing plan
coverage qualifies. An unavailable design observation or any retained baseline
history suppresses the new route. Read failures remain failures. Explicit null
means no observed prerequisite; legacy callers without the field retain their
existing behavior.

The claim-to-admission regression reproduces the native rejection before the
repair. Verification covers the exact bounded packet, retained/inherited and
malformed history, changed authority, and unresolved original reviews. The
change introduces no writer, settlement proof, replay permission or exemption
from independent review. Historical DED689F4DDF6 remains UNKNOWN; native baseline
and plan review are unrun. This bounded DEV admission repair follows the existing
recovery procedure with independent source assessment, normal tests, DCO,
local gate and protected publication. It does not deliver the full historical
recovery specification or BI-5366EF78's receiver acknowledgement.

**October 24 spec-review finding and clarification.** The original current-source
review task ending 1427D0CD59CA completed through supported same-task recovery.
Its independent spec-approval receipt
initiative-review-v1-2a7b54f0e844b5295d85c7a3004b2ebf2198cf504be7a3cdb21caaf5dde392fd
recorded FAIL at 2026-10-24T17:40:13.478Z for source
4514841246f099c7f3d241326e313577e4bc1027, blob
1b9692e589595594e0325d9bf4c7a2ff62693223, with finding IF-F99ADDF4DF95A0DD.
The finding cites the absent baseline and coverage and this design's explicit
limits on implementation and recovery claims.

This amendment makes the spec gate's input, output and order explicit and
separates native objective/acceptance identifiers from proof-check labels. The
OBJ-* and AC-* statements and the required historical proof are unchanged.
The FAIL and finding remain actual evidence on the reviewed artifact; the author
does not mark them resolved. Independent review of this amended immutable source
must judge the clarification and any substantive design or feasibility concerns.
No prior task, receipt, attempt budget or execution uncertainty is replaced, and
successful admission or continuation does not supply design acceptance.
