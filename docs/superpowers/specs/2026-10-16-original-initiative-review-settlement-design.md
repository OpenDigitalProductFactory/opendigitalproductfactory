---
status: draft
backlog: BI-7906C73E
---

# Recover an interrupted initiative review from verified execution evidence

The [bounded reassessment amendment](#bounded-reassessment-amendment) is the
current proposed scope. Earlier observations and the same-task recovery contract
remain historical evidence. The amendment requires independent approval and
immutable coverage before implementation; this document grants neither.

For independent amendment review, compare this revision with approved baseline
`baseline-4ff3b6e1-9ec7-44a7-be74-8da97dc28f4c`. Its changed criteria are AC-RA-3
and AC-RA-7; no objective is removed or changed. If the reviewer independently
chooses a passing supersession, the canonical writer requires an explicit
`supersessionDispositions` entry for each changed criterion, with the reviewer's
own substantive reason (at least 20 trimmed characters). A failing assessment
retains its genuine findings. This reminder supplies the writer contract, not a
verdict or permission to omit any review evidence.

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

> **OBJ-RECOVER:** Admit bounded recovery on that same task only after authenticated execution and complete relevant-effect reconciliation under current authority.

**OBJ-FENCE:** Prevent stale callbacks, concurrent recovery and delayed approvals from publishing across the admitted execution generation.

## Historical same-task acceptance contract

This quoted manifest remains normative for historical same-task recovery. It is
archived outside the current amendment's delivery baseline: no current phase
claims positive historical recovery or completion of OBJ-RECOVER.

> | Criterion | Objectives | Observable result |
> | --- | --- | --- |
> | AC-HR-1 | OBJ-HISTORY, OBJ-RECOVER | Readback and admission bind the exact original TaskRun, immutable request digest, dispatch/reservation generation, source and current authorized owner. Cross-user, changed-source, stale or concurrent requests refuse before external effects. |
> | AC-HR-2 | OBJ-HISTORY, OBJ-RECOVER | The collector enumerates the actual reachable capabilities and every relevant effect with attributable evidence. Recovery requires authenticated original execution membership and closure, or genuine old-writer revocation plus complete reconciliation of all possibly started effects. Missing capability coverage, membership, closure or effect proof remains unknown. |
> | AC-HR-3 | OBJ-RECOVER, OBJ-FENCE | One same-task recovery reservation atomically binds verified proof, immutable request and remaining original budgets. Late execution results, writers and approval continuations cannot cross its fence. No client nonce, replacement request, reset budget or authority widening is introduced. |
> | AC-HR-4 | OBJ-HISTORY, OBJ-FENCE | A genuine canonical receipt is reconciled before requesting inference. Execution evidence, an empty audit, a client assessment and successful dispatch never become review approval. Historical uncertainty and proof remain available after an admitted recovery. |
> | AC-HR-5 | OBJ-RECOVER, OBJ-FENCE | Adversarial source tests, protected delivery and canonical served verification prove both supported recovery and refusal with missing proof. The original metrics work advances only after its genuine independent receipts and normal planning admission. |
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

Present reassessment uses the atomic R1–R4 sequence below. The
[historical P1–P4 investigation and plan](../../history/2026-10-16-review-settlement-investigation.md#ordered-implementation-plan)
remains a reference for possible same-task recovery. It has not established a
qualified positive original case and grants no current admission. Historical
same-task recovery retains its quoted AC-HR contract and inline proof,
authority, identity, budget, generation and rollback conditions.

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

The original-result reader is observation-only. Its inventory selects metadata
rather than artifact contents, tool arguments/results, approval arguments or
provider output. Each source is capped at eight records plus an overflow
sentinel. Stable double reads and a current authority recheck are required;
changed, unavailable, overflowing or mismatched inventories withhold counts.
Completeness remains false and settlement unknown: empty rows do not prove
original launch, capabilities, descendant closure, credential/effect settlement
or late-writer fencing. Auxiliary failure or overflow never erases a separately
authenticated canonical receipt. Omit the auxiliary inventory and include its
unavailable marker only if the unchanged response cap permits; otherwise retain
the complete base result. Base overflow still refuses. No inventory result or
receipt authorizes replay or historical effect settlement.

[Historical implementation observations and calibration](../../history/2026-10-16-review-settlement-investigation.md#october-19-bounded-source-recovery-original-proof-inventory)
retain the prior receipt IDs, test details and response-size example.

## Bounded reassessment amendment

### Owning direction and explicit supersession

The live BI-7906C73E amendment cites WWMD DI-61A9ECAFBEDE, selecting
`quarantine-and-reassess`. It supplies advisory platform direction, not approval
or execution authority. Its Grade C engineering estimates are not measured
security results. Current reverification returned eight unresolved citations:
the runtime source resolver could not resolve their recorded spec locators.
Retain that limitation. The earlier no-feature consult was unusable.

AC-HR-1 through AC-HR-5 and DI-08A2750D3287 continue to govern **same-task
historical recovery**. [P1–P4 remain its historical plan](../../history/2026-10-16-review-settlement-investigation.md#ordered-implementation-plan). This amendment supersedes
only the prior policy that every separately authorized present reassessment must
first close all historical effects. It adds the distinct contract below without
weakening the proof needed to resume an old attempt or declare effects settled.

This contribution belongs to WC-A5703D01 and
`codex/bounded-review-reassessment` in its own sibling worktree. Historical
WC-FDAC8963 and peer trees retain their ownership. The parent owns BI-285EF102,
WC-1EBA9720, frozen source `95d6ceeda08af9019d8b07e85515cfcac6334e8c` and
application performance acceptance. Original design-spec D2E5E2765847 and
spec-approval 4E1879A26F6B remain UNKNOWN, attempt 1, with replay disallowed.
Their original digests, deadlines, budgets and checkpoints stay immutable.

**Operator amendment, 2026-10-21.** The human authorized at most **two total**
fresh restricted present assessments for BI-285EF102: one for the design-spec
requirement associated with D2E5E2765847 and one for the spec-approval requirement
associated with 4E1879A26F6B. The authorization uses current normal budgets and
all recorded limits, while preserving unknown historical consumption separately.
It was confirmed from the direct human reply in parent chat
`01a12e23-936f-75b2-b382-d33c36045cd5` and recorded as BI-7906C73E activity
`cmvi9mamr416101lfaz5ueejt` and BI-285EF102 activity
`cmvi9man5416401lfsq7dbc71`. These records do not themselves replace independent
amendment approval, plan coverage, current actor authority or execution capture.
This bounded authorization removes missing historical aggregate accounting as a
prerequisite for these two present assessments only. It grants no global budget
waiver, original replay, third assessment or authority for another requirement.
On approving this revision, supersede the prior AC-RA-3 statement with the
operator-authorized two-requirement exception; its historical accounting rule
continues to apply outside that exception. Other objectives and criteria retain
their meaning.

The issuer must obtain the following policy from an independently approved
immutable artifact. It reads the pinned bytes, verifies the current baseline and
normal owner/actor authority, then emits a bound request. This extends the
existing baseline and TaskRun admission; it is not a second grant store. An
authorization-item locator selects evidence, never grants execution by itself.

```review-reassessment-policy-v1
{
  "schemaVersion": 1,
  "subjectItemId": "BI-285EF102",
  "maxAssessments": 2,
  "historicalConsumption": "retain-unknown",
  "currentLimits": "normal-recorded",
  "originalReplay": false,
  "operatorEvidenceActivityIds": ["cmvi9mamr416101lfaz5ueejt", "cmvi9man5416401lfsq7dbc71"],
  "requirements": [
    { "gate": "design-spec", "originalRequestDigest": "8f7b7729a3b3c9aa37521e14ba20f81a9fe8bde8c716fe7b3217a5f3fe4488f9", "maxAssessments": 1 },
    { "gate": "spec-approval", "originalRequestDigest": "78da95183d424f2434fe1f503c0bbd1981678590e2158b3d7ec440aecf940a00", "maxAssessments": 1 }
  ]
}
```

The original accepted request supplies its exact artifact identity. Admission
must establish it, retain it in the current request, and refuse changed source.
Malformed or multiple policy blocks, stale or unretained approval, ambiguous
membership, unavailable evidence or unauthorized original-owner access refuse.

### Additional objectives and acceptance

**OBJ-PRESENT:** Obtain one genuine independent verdict on the exact current review requirement without resuming an uncertain historical attempt.

**OBJ-CONTAIN:** Enforce complete prospective execution and capability boundaries while preserving historical uncertainty as a separate unresolved effect incident.

| Criterion | Objectives | Observable result |
| --- | --- | --- |
| AC-RA-1 | OBJ-HISTORY, OBJ-PRESENT | Current original owner, independent reviewer, exact subject, gate, immutable artifact, independently approved amendment baseline and issued packet bind admission. Bind the target's expectedCurrentBaselineId, including null for initial approval, and validate it atomically. A genuine existing receipt is reconciled first; stale source, owner or expectation refuses without inference. |
| AC-RA-2 | OBJ-FENCE, OBJ-CONTAIN | Held, uncertain, canceled, unversioned and displaced original callbacks cannot dispatch a platform tool or append a canonical result. Delayed approvals retain their captured original generation and pass current checks before execution and commit; they cannot revive the old task by marking it working. Unknown prior external effects stay unknown. |
| AC-RA-3 | OBJ-PRESENT, OBJ-CONTAIN | One transaction admits at most one present reassessment across all authorization families for the same subject, gate and artifact. The operator's 2026-10-21 authorization permits at most two total for the two named BI-285EF102 requirements under current normal budgets and all recorded limits, retaining unknown historical consumption separately. Known exhausted or conflicting limits refuse; missing historical aggregate accounting alone does not refuse these two. Other requirements retain the original accounting prerequisite. No original budget, attempt counter or deadline is reset. |
| AC-RA-4 | OBJ-CONTAIN | A qualified existing in-process provider composition exposes exactly read_source_at_version and the bound canonical writer. The backend enforces the names, immutable reader arguments and writer binding on every actual dispatch path. Native CLI, shell, browser, filesystem tools, account/credential preparation, alternate task APIs, discovery escalation and undeclared provider tools are unavailable. Schema filtering alone fails qualification. |
| AC-RA-5 | OBJ-HISTORY, OBJ-CONTAIN | Before execution, authenticated capture binds task, request, reservation, generation, authority, exact tools, provider configuration and immutable artifact. Missing or invalid pre-effect capture refuses with zero starts. Post-start capture failure preserves uncertain consumption and blocks further effects while reconciling any genuine committed receipt first. No historical closure is inferred. |
| AC-RA-6 | OBJ-PRESENT, OBJ-FENCE | Only the current independent canonical writer issues the new receipt. Durable supersession binds it to the current requirement and quarantined originals. It changes no original outcome, clears no unknown effect and authorizes no replay. Cancellation and receipt races retain one durable winner. |
| AC-RA-7 | OBJ-FENCE, OBJ-CONTAIN | Canonical admission verifies compatible transport, approval, worker and writer versions. Mixed-version admission and unsafe downgrade refuse. Disabling admission retains compatible fences/readers and all unresolved histories. Canonical self-upgrade database rollback always retains spent allocations and histories; it also retains compatible active fences unless every capability and possible effect is genuinely retired and reconciled. Missing proof refuses restoration. |
| AC-RA-8 | OBJ-PRESENT, OBJ-CONTAIN | Source tests, real PostgreSQL races and canonical served acceptance prove both a restricted positive reassessment and refusal. D2/4E are never relaunched. Genuine current receipts and normal BI-285EF102 plan admission precede review-recovery completion; application under-load acceptance remains with the parent. |

### Existing substrate and actual execution boundary

Extend TaskRun metadata/progress and its reservation/dispatch CAS, TaskArtifact,
ToolExecution, CoworkerActionEnvelope and canonical initiative receipts. No
second attempt ledger, scheduler, grant engine, provider or result writer is
introduced. Store reassessment relations and qualified capture on those existing
records; result projections do not become a second authority store.

Current source `ee1e80b0a46b893beea11b928cfe621849730ad4` supplies these homes:

- `backlog/initiative-readiness/bound-review-effect.ts` owns task-before-subject
  locking, genuine-receipt precedence and captured-generation writer checks.
- `mcp-task-review-recovery.ts` owns historical recovery refusal. Its
  `reviewRecoveryToolRefusal` currently permits legacy tasks without
  `reviewExecutionAuthority` to proceed to other tool checks; consolidate a
  common task-bound entry restriction instead of a parallel authority engine.
- `mcp-task-submit-approval-recovery.ts` and `coworker/approved-task-run.ts`
  must preserve that restriction before reservation or marking a task working.
  Replace unconditional settlement with the existing generation-aware CAS in
  `mcp-task-attempt-state.ts` and `observability/heartbeat.ts`.
- `routing/cli-adapter.ts` converts displayed tools to broad grants and adds
  `backlog_read`; the native session transport checks grants. That is not exact
  callable reach. Present reassessment selects the existing in-process
  provider/tool loop and refuses native or text-tool fallback. Ordinary review
  routing is not implicitly requalified by this amendment.
- `mcp/independent-review-request.ts` and `mcp-task-submit.ts` own issued-packet
  validation and TaskRun admission. Extend them with a server-issued reassessment
  relation; a client cannot invent a key, drop a locator or change source merely
  to evade an old hold.

Qualification binds the actual selected composition before dispatch and again
after capacity admission. The provider can request only function calls for the
two admitted names. The server rejects other names before lookup or execution,
including nested calls, transport discovery/meta-tools and Tasks methods. The
reader accepts only the bound repository, commit, path and blob, including paged
reads of that artifact. The writer accepts only its exact subject, gate,
baseline, actor and captured generation. No auxiliary tool, native launch,
filesystem preparation or account renewal participates. Existing configured
inference access grants no account mutation or credential creation authority.

Persist configuration and call reservations before execution; authoritative
ToolExecution/domain receipts supply outcomes. Missing audits cannot be replaced
by counts or model text. Pre-start capture failure guarantees zero provider/tool
starts. After a start, incomplete observation preserves the reservation and
unknown consumption, holds further effects and reconciles any genuine already
committed receipt first; observation failure cannot erase that verdict.
Prospective capture and old callback fencing do not
prove membership or closure for historical native process trees. An unsupported
composition refuses without silently selecting another provider or route.

**Finite current-token enforcement.** The positive path must preserve the
reviewer's current registry and execution-configuration limits, including its
50,000-token aggregate task ceiling. An estimate, configured context number or
unlimited-only implementation cannot establish that ceiling. Qualify the
existing local DMR Messages/count composition and its unchanged local-runtime
account under normal routing eligibility. Bind the actual engine artifact and
source, full model digest, deterministic template and served configuration; an
available route or version prefix alone is insufficient.

**Chosen audited composition, pending independent approval.** Kernel decision
DI-ECA01D51F723 selected `audited-native-messages-invariant`, with composite
13.0819, margin 0.8069, high confidence, autonomy eligible and no commandment
conflict. Its recorded outcome supersedes DI-5E1966E5D0FF's proposed broad
host-owner extension; retain that earlier decision as history. This decision
selects an implementation direction. It does not approve this amendment,
establish empirical proof or authorize a production allocation.

The initial native inspection retained in WC-A5703D01 established this candidate
composition. These are initial physical observations and retained artifact
identities, not facts freshly measured by each later HTTP read:

| Evidence | Exact observed value |
| --- | --- |
| OCI model manifest | 1,192 bytes; `sha256:66c4f325bc71350f07fb2da4f92455553c7bbc8af5d7ee2095fbeac79b9e66c9` |
| OCI model configuration | 11,424 bytes; `sha256:0c8ee016ba9be61836af6cac90d09ed414298ba20e65d2a20bf01d642967e7ae` |
| Logical model configuration using canonical JSON | `sha256:f2cad47727f7d07e4a51f11c4499d90252ee96b530d7a508a06359ecec91dd40` |
| GGUF layer | `sha256:31629f53165ab6a7dad8c9847dcfd1fdf55829dac1e6e748f4a68581b0033d34` |
| mmproj layer | `sha256:de2a49866988ea272c43dc2a43ee2662c25725a717ca5b9059ea420a97f53fe8` |
| Engine executable bytes | `sha256:0e9095b1a9068961682fa60fa101bdcf40e0b1f1e6b0c44c1616c0611c1d4b26` |
| Reported engine archive identity | `sha256:b70706f473b4043ca3e0c32704a7fda3412b83bceef0564684187b8011230de8` |
| Engine source | `72874f559c598b8f89fbb24864868337cf5afb4c` |
| Effective template | 8,952 characters; `sha256:c3cf9e34abf4f9e36c2d72165aa9c132d3e2a725b6c2586aaa3a8af9d7a81041` |

The complete manifest contains GGUF and mmproj layers, with no template sidecar.
The effective template is clock independent; no separate native named-tool
template is present. The inspected renderer environment and process arguments contain no
template overrides. The restricted request remains text and function tools
only; the mmproj layer grants no multimodal capability. The Workroom evidence
is neither a review verdict nor a served acceptance receipt.

Define one source-audited supported-composition catalog entry from that retained
evidence and the pinned [DMR v1.2.8 forwarding source](https://github.com/docker/model-runner/blob/5a3112fdc10bcfe236a7450fcfa7e83ed3c0209e/pkg/inference/scheduling/http_handler.go#L98-L108),
[engine identity owner](https://github.com/docker/model-runner/blob/5a3112fdc10bcfe236a7450fcfa7e83ed3c0209e/pkg/inference/backends/llamacpp/download.go#L231-L249)
and [llama.cpp count/generation implementation](https://github.com/ggml-org/llama.cpp/blob/72874f559c598b8f89fbb24864868337cf5afb4c/tools/server/server-context.cpp#L5330-L5378).
Qualification has two explicit phases. Before reserving a candidate, verify the
source-supported method/catalog, current account and grant intersection,
registry/execution-configuration budgets, compatible implementation and expected
composition. That establishes a supported qualification procedure, not a fresh
observation of the actual runtime or permission to execute a review.

One atomic admission-counter transaction reserves at most one candidate for the
exact requirement/artifact and at most two across the named authorization.
Every reservation counts, including pending, refused, failed, canceled and
uncertain candidates. A matching caller joins that same candidate; no different
key, credential family or qualification failure creates a replacement. The
originals stay UNKNOWN and retain their immutable identities and accounting.
AC-RA-3 counts that initial candidate allocation. The later execution seal grants
permission to execute the same allocation; it never allocates a second task.

The reserved TaskRun owns one immutable qualification manifest and one captured
event lineage using existing TaskArtifact/ToolExecution owners. Its initial
phase permits only the exact bounded runtime-identity GETs. Reader/writer tools,
counting, generation, fallback and ordinary worker execution remain unavailable.
Persist each configuration effect's capture before its HTTP request. Fresh reads
of `/version`, `/engines/status`, the full-SHA `/models` identity/configuration
and `/engines/_configure` must match the audited catalog and current account.
Feed those observed facts through normal V2 eligibility and ranking, preserving
hard task floors, preferences and account restrictions. Only the supported
expected composition may proceed; a changed selection does not trigger fallback.

Atomically accept the final immutable execution seal under the same TaskRun
fence and review-subject locking protocol, rechecking authority, baseline,
membership, compatibility and remaining bounds. The seal binds the actual plan,
tools, configuration and complete qualification capture. Only then admit reader,
writer, count and generation effects. Keep the same capture open, event ordinals,
reservation identity and original window; promotion cannot restart the deadline
or replenish starts/tokens. A failed qualification consumes its reservation and
cannot enter ordinary recovery or allocate another assessment.

Revalidate the required logical identities after capacity admission and before
count/generation dispatch, using captured configuration reads that themselves
consume the existing allowance. Keep configuration observation separate from the
check that would otherwise recursively request another observation. Fresh logical
self-reports are not fresh physical hashes of the executable, inherited
environment or model files. Unknown, ambiguous, incomplete or changed tuples
refuse; a matching version prefix does not qualify them. No uncaptured
pre-reservation HTTP lookup stands in for this protocol.

The composition proof must establish semantic invariance across every supported
typed DPF mutator. Context reconciliation changes capacity without changing the
fixed model's tokenizer or renderer. Install, removal, unload and reload paths
must either preserve those semantics for the exact full model SHA or refuse
the request. An alias change cannot select a different model for the sealed
full-SHA body. Audit the effective template selection, absence of sidecars and
renderer overrides, default template arguments, tokenization and completion
counter. A supported transition that can change those semantics invalidates the
catalog entry until a real compatible guard or another proof closes it. Repeated
identity reads alone cannot exclude a change and reversal between reads.

The trust boundary includes the native runtime, its host administrator and the
integrity of its self-reports, installed artifacts, environment and startup
arguments. Arbitrary host/native administrative changes to those facts are
outside the supported typed DPF contract and invalidate qualification. This
includes privileged approved `admin_run_command` or sandbox execution; those
surfaces retain their existing authority and are not claimed absent or retired.
The trust boundary must be explicit; it does not turn an unsupported renderer mutation
into a safe one. No new native observer or durable host lease is required solely
to protect an invariant that every supported transition already preserves.
Existing admission, execution-generation, resource-capacity and cancellation
controls still apply. Source audits and kernel decisions cannot substitute for
the initial physical evidence or actual runtime verification.

Preserve existing local resource-capacity admission. Its `/engines/ps` reads must
use the same bounded captured transport. The restricted composition cannot
perform automatic unload or other model-management effects; wait or refuse
within its unchanged window when capacity is unavailable. Typed capture and
scope refusals must escape ordinary best-effort error handling.

Inside the admitted window, serialize each complete native Messages body once.
Capture the count request, validate its nonnegative safe-integer prompt count,
then durably reserve that exact count plus the full enforced output ceiling
before sending the unchanged serialized body for generation. Count and
generation use the exact full model SHA and the catalog's deterministic renderer
and tokenizer. Every actual HTTP request, including configuration and count
reads, consumes the recorded start allowance and deadline and receives valid
pre-effect capture. Configuration reads and prospective counts are not generated
token usage. Retain every generation reservation in full, including outstanding
or uncertain consumption; no refund replenishes the task allowance.

Preserve the normal current daily-budget gate at every start, using the current
registry/configuration intersection and observed UTC-day usage. That gate is an
observed-usage pre-call check, not a cross-worker reservation of the remaining
daily allowance. Do not claim a new hard daily aggregate guarantee from it. The
present task's finite aggregate ceiling uses its strict durable reservations;
this amendment changes no daily setting, funding authority or normal gate rule.

Before normal V2 selection, apply the existing spend-aware budget-class policy
for the current daily warning state while preserving hard task floors. Bind that
class into the execution seal. If its applicable policy changes before dispatch,
refuse further execution under the spent allocation; do not silently reroute or
reset qualification, reservations or the window.

Validate complete generation usage: uncached plus cached input must equal the
reserved prompt count, and output must not exceed the reserved ceiling. Missing
or conflicting usage, unsupported response blocks, changed configuration or
incomplete capture holds further effects and reconciles any genuine committed
receipt first. Refuse media, hidden native tools, fallback, account preparation,
native process launch and silent setting removal. Pre-start capture failure
allows zero starts; post-start uncertainty preserves the reservation and history.

To reduce provider starts, the implementation may preload the complete bound
artifact through the same governed immutable reader, with attributable capture
and traversal evidence, and stop when the canonical receipt is verified. It must
not truncate source, tool history or output allowances to fit the budget, invent
reader evidence, or replace the independent writer's judgment. Failure to fit
the full reservation refuses execution.

The new authenticated finite qualifier and production integration remain
unimplemented. Draft reservation and Messages tests do not establish their
installation, qualification or served acceptance. The independently approved
amendment baseline, refreshed atomic R1–R4 coverage, compatible producer and
transport evidence, and real positive/refusal verification remain required
before their respective implementation and delivery gates. No finite positive
task is admitted until its actual enforcement is established. This choice
changes no AC-RA-4/5/7 semantics, human budget authorization, historical unknown
consumption or original-task replay prohibition.

### Atomic admission, original limits and concurrency

Resolve authorized original readback and genuine exact receipts first. The
server-owned membership key is tenant, canonical backlog item, gate and immutable
repository/commit/path/blob identity, independent of credential family, reviewer
and request key. Include every accepted matching request plus all explicitly
linked predecessors/supersessions, held/canceled/completed rows and outstanding
reservations. Resolve accepted request digests and canonical item/Workroom/task
relations; a client-supplied lineage list is not authoritative. Legacy candidates
linked to those owning relations whose immutable binding cannot be established
return `reassessment-lineage-unproven`, never an assumed exclusion. Parent D2/4E
must be present in their respective exact-artifact membership sets.

Lock related TaskRuns in
stable order before the owning review subject, preserving the canonical writer's
task-before-subject order. Recheck lineage after acquiring the subject lock;
every relevant creation route must serialize on that same subject. If the
recheck finds changed membership, abort and restart from the refreshed ordered
task set without provider execution; never acquire another existing task lock
while holding the subject lock. Demonstrate the protocol in real PostgreSQL races.

In that transaction, recheck current actor and normal grant intersection,
exact artifact/baseline and packet, original immutable identities, cancellation,
the source-supported qualification procedure, compatibility and remaining
aggregate allowance. For a reserved candidate, the final execution seal
rechecks those conditions and the actual qualified composition before granting
execution; it does not create another allocation.
Current per-task writer attempts and saved inference/deadline ceilings are
owned by accepted TaskRun requests and terminal-writer checkpoints. Provider
usage and pending reservations come from task-linked AsyncInferenceOp,
TaskArtifact and ToolExecution/effect owners; no absent row means zero usage.
The current coworker daily-token gate is additional, not an original lineage
allowance. Preserve every known inherited limit and reservation. A recorded
exhausted ceiling or a conflict with an applicable limit refuses. For an ordinary
reassessment outside the two named authorizations, derive inherited allowance
and prior consumption from authoritative records, count outstanding reservations
in full, and refuse unknown bounds as `reassessment-accounting-unproven`.
An unknown historical amount may be charged at an upper bound only when that
original enforced bound is authenticated; it never becomes zero or a current
default.

For the two operator-authorized BI-285EF102 requirements, retain historical
attempts, reservations and unknown consumption as historical observations;
do not invent an original allowance or subtract an invented historical charge.
Admission records a distinct present allocation under normal current authority,
the actual current budget configuration and the existing bounded effort warrant,
request/output limits and execution window. Record those bounds before execution
and count every actual provider start, internal transport retry and outstanding
present reservation against them. Fail closed if a required current bound or
its enforcement cannot be established. Normal daily budgets remain enforced,
including their recorded configuration; this amendment creates no token-quota
setting or substitute funding authority. Funding attribution uses the normal
owner scope and never follows from installation or administrator identity.

Count the two admitted present tasks across both gates, all credentials and
families, including canceled, failed and uncertain tasks; cancellation or an
unobserved result does not replenish either allocation. A matching caller joins
the existing winner. No replacement provider task, new request key or completed
task replay creates another assessment. Neither a new task nor a new credential
changes an original deadline, attempt count or spend limit. The new present
window belongs only to the new admitted task and cannot revive the old window.

At most one reassessment may exist for the bound requirement/artifact,
irrespective of token, reviewer selection or family. Concurrent callers join the
same durable winner or receive its refusal. The immutable new binding names the
quarantined predecessors, current requirement and supersession authority.
Workers, approvals, task settlement and canonical writers compare the captured
identity at their existing CAS/commit boundaries. A pass, fail or not-applicable
current verdict changes only that requirement; the historical incident stays
open. Exact-subject lineage queries are paged; truncation/overflow refuses.
The scale boundary is the existing per-install substrate under EP-ABB3AC9D,
without full-install scans or a new cross-install coordination service.

### Ordered amendment implementation and coverage

R1–R4 replace P1–P4 **only for present reassessment**. Same-task recovery keeps
its original proof prerequisites. BI-7906C73E stays `delivery-large@1.0.0`.
Independent baseline approval, immutable coverage and current implementation
admission precede source implementation; body text and WWMD are not receipts.

| Deliverable | Implementation BI | Depends on | Objective requirementRefs | Contracts | Flow | Acceptance verificationRefs |
| --- | --- | --- | --- | --- | --- | --- |
| R1: shared callback and approval fencing | BI-7906C73E | Genuine amendment baseline and coverage | OBJ-HISTORY, OBJ-PRESENT, OBJ-FENCE, OBJ-CONTAIN | CONTRACT-RA-FENCE | FLOW-RA-CONTAIN | AC-RA-1, AC-RA-2, AC-RA-6 |
| R2: restricted composition and capture | BI-7906C73E | R1 | OBJ-HISTORY, OBJ-FENCE, OBJ-CONTAIN | CONTRACT-RA-CAPTURE | FLOW-RA-QUALIFY | AC-RA-4, AC-RA-5, AC-RA-7 |
| R3: atomic exact-artifact admission | BI-7906C73E | R2 | OBJ-HISTORY, OBJ-PRESENT, OBJ-FENCE, OBJ-CONTAIN | CONTRACT-RA-ADMIT | FLOW-RA-ADMIT | AC-RA-1, AC-RA-3, AC-RA-6 |
| R4: protected delivery and served acceptance | BI-7906C73E | R3 | OBJ-PRESENT, OBJ-FENCE, OBJ-CONTAIN | CONTRACT-RA-RELEASE | FLOW-RA-VERIFY | AC-RA-7, AC-RA-8 |

R1 consolidates checks in the existing shared homes and tests old/late callbacks,
original delayed approvals, cancellation, stale authority and callbacks paused
between authorization and commit. R2 claims exact loop/dispatch paths and proves
both admitted tools execute while hidden tools, task/meta APIs, immutable-reader
changes, native fallback, capability mismatch and overflow cannot execute. R3
tests concurrent families, the two-task authorization ceiling, known exhausted
limits, unknown historical accounting retained separately, stale owner/source/
baseline, receipt precedence, cancellation and positive restricted reassessment.
Resolve each claimed path's testImpact and guardObligations before edits;
unresolved advice expands verification. At least one fifth of implementation
consolidates existing generation, authority and effect predicates.

R4 requires affected unit tests, real PostgreSQL races, package typechecks,
exact committed-tree gates, independent assessment, DCO PR and protected merge.
The planned server-owned `mcp-task-reassessment-contract.ts` must obtain explicit
support from the actual transport, approval, worker and canonical-writer owners
and bind it to the executing container config digest and baked source identity.
Reuse the existing immutable runtime-image observer and packaged protocol-probe
pattern; neither environment SHA alone nor a liveness heartbeat proves support.
Seal and recheck that evidence through existing TaskRun/TaskArtifact owners.
Prove that an actual old binding parser refuses the nested new relation through
persisted-request digest reconstruction before preparation or inference.

Enforce candidate compatibility through existing self-upgrade preflight, final
swap and promoter rollback owners. Forced draining cannot waive it. Automatic
rollback cannot restore incompatible writer/reader bytes while retained
obligations require the fences; quiescence alone is not retirement proof. These
deployment and compatibility producers remain unimplemented and require real
positive, missing-proof, mixed-version and unsafe-downgrade verification.

The existing canonical PostgreSQL rollback owner,
`apps/web/lib/self-upgrade/rollback.ts`, restores an earlier database snapshot;
image compatibility alone cannot preserve newer task fences or capture history.
R4 therefore includes an obligation check at this owner. Always prove retention
of consumed candidate allocations and required histories; capability retirement
never permits their deletion or rewinds the one-per-requirement/two-total ceiling.
Also prove retention of current compatible fences, or complete authenticated
retirement and reconciliation of every issued capability and possibly started
effect. Exclude reassessment admission and protected allocation, capture,
settlement and canonical-writer commits from proof validation through restoration
and post-restore verification. Resume only after restore execution is positively
settled and the surviving proof is verified. Loss of a lock or connection does
not prove an external restore process stopped. A process-local mutex or a
database row lock assumed to survive restoration is not that exclusion.
Use the existing canonical restore/admission boundary only when its exclusion
and evidence survive the restore; otherwise refuse before any restore effect.
Missing, uncertain or stale proof also refuses. Reuse canonical state and the
rollback contract; do not invent a second history store or infer retirement
from quiescence or an empty active-task list. Test a recovery point predating
admission, cross-worker admission and protected-commit races through the entire
restore, lock loss with a continuing restore process, missing proof, post-restore
retention of spent allowances/histories and genuine capability retirement without
a third allocation. Existing destructive permissions and
typed confirmation remain mandatory. This scope covers only canonical
self-upgrade database rollback; arbitrary privileged database/file/host
administration remains the declared trusted-admin boundary. WWMD decision
`DI-31985D298EC9` selected this pending design clarification; it grants neither
amendment approval nor implementation admission.

Only canonical `request_self_upgrade` advances the install. Served acceptance
verifies compatible writer/approval/transport coverage, a restricted positive
case and refusal cases. The parent obtains genuine current D2/4E requirement
receipts and BI-285EF102 plan admission without replaying historical tasks;
its application under-load evidence remains separate. No authenticated positive
qualification for D2/4E is established yet. A missing membership or allowance
producer is a concrete admission blocker, not a claim those originals can advance.

Proposed coverage is atomic: these are sequencing steps in one admission
contract. R1 cannot satisfy the present review, R2 without R3 admits nothing,
and R3 without R2 must refuse. The shipped collector and writer-fence BIs retain
their own records and are not reimplemented. This table asserts no baseline or
coverage receipt; record the genuine returned receipts before implementation.

Rollback disables new admission while retaining compatible fences, readers and
histories. A pre-fence downgrade requires positive capability retirement and
reconciliation of possibly started effects; missing proof refuses it. Neither
rollback nor a current verdict clears the historical incident.

[October 23–24 upstream admission observations and historical plan clarification](../../history/2026-10-16-review-settlement-investigation.md#october-24-upstream-historical-plan-clarification) retain their immutable source, failed review and unchanged original request history separately from the present reassessment contract.
