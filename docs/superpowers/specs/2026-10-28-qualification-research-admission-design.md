---
status: draft
backlog_item: BI-2664971A
workroom: WC-417CEBF8
prior_workroom: WC-A8C14CBE
---

# Bounded qualification before a research verdict

## Problem and authority boundary

BI-B3DEC077 is a qualification-only Windows experiment. Its purpose is to determine whether a product gap exists; it is not an implementation of an already reproduced defect. The truthful research receipt `initiative-b5358b03-f498-4858-bd92-2f997ba792c1` therefore failed and opened `IF-91E987DA433B0C82`. Initiative readiness now denies implementation on `RESEARCH_REQUIRED=fail`, while the experiment that could produce the missing evidence is also treated as implementation. That is a policy deadlock.

This repair does not pass research, clear the finding, widen author grants, reinterpret the failed receipt or exempt diagnostic work. It admits one exact verification action before the research verdict and records what happened. Ordinary implementation remains denied. A later research receipt may resolve the existing finding only from genuine terminal experiment evidence.

**OBJ-QRA-ADMIT:** Let the accountable owner run one immutable, bounded qualification protocol without first claiming that its result is known.

**OBJ-QRA-TRUTH:** Preserve positive, negative, inconclusive and unrun outcomes without converting any of them into a research PASS.

**OBJ-QRA-FENCE:** Keep normal fix/feature readiness, authority, source identity, Workroom ownership and evidence requirements unchanged outside the exact qualification action.

**OBJ-QRA-RECOVER:** After the experiment, give the author one lawful path to address the existing finding with the actual evidence, while retaining every prior receipt and decision.

## Existing substrate

No new execution controller, queue, evidence store, grant class or generic diagnostic flag is required. One typed handler extends the existing native Edge executor.

- `apps/web/lib/work-management/action-registry.ts` already defines consequential `verify`, requires policy evaluation and a receipt, and sanctions only `run_sandbox_tests`, `run_ux_test` and `record_workroom_evidence`.
- `apps/web/lib/scheduling/workroom-stage-task-config.ts` already carries an exact shape/version/stage and its declared tools into a `ScheduledAgentTask`. It explicitly narrows tools and never grants them.
- `apps/web/lib/actions/agent-task-scheduler.ts` already creates a TaskRun for a Workroom stage, includes the stage's tools, requires the evidence writer and deduplicates completing evidence for the same dispatch.
- `record_workroom_evidence` already records stage outcomes; `record_execution_evidence` remains the source for later delivery/acceptance evidence. Neither is a research receipt.
- `RemoteAction`, `remote-action-dispatch.ts`, `dispatch-orchestrator.ts` and the native Edge action runner already provide the one server-owned execution controller this design needs: a machine-bound action row, approved ChangeRequest, per-node allow-list, signed expiring envelope, durable nonce consumption, single claim and terminal native report.
- The native Edge agent already refuses unknown action types and unconfigured handlers. Qualification extends that closed registry with one typed Windows procedure; it does not add a command runner, caller-selected executable, path, URL, script, environment variable or argument vector.
- The supervised Workroom/runtime and external-agent evidence lanes already own host-specific execution. A qualification must use that accountable Workroom executor when the protocol requires a host capability (for BI-B3DEC077, Windows handle sharing) that Build Studio's Linux sandbox cannot supply. It must never select an unrelated active FeatureBuild merely because one exists.
- `apps/web/lib/backlog/initiative-readiness/entry-adapter.ts` and `shape-requirements.ts` remain the sole research projection. The existing small-fix `source_verified` plus latest `test_pass` path is unchanged.
- `apps/web/lib/backlog/initiative-readiness/terminal-recovery.ts` and `shape-lane-escalations.ts` already own the supported recovery answer for an unmet research lane. Extend that answer; do not add a parallel controller.

The completed author-research reachability work (BI-9FE775F9) and bounded author-fact policy (BI-06AE6833 / `2026-10-12-author-research-policy-reuse.md`) concern recording facts already evidenced. They do not authorize an experiment whose result is not yet known. BI-C5A25AB4 retains bounded provider-probe response evidence and is not an admission policy.

## Decision

Introduce two linked server-derived bindings on the existing Workroom stage substrate: a **qualification preparation binding** and, only after preparation settles, a **qualification verification binding**. Store them in the existing stage task configuration / TaskRun metadata and Workroom evidence payload; do not add a table or status.

The preparation binding is issued only when all of these are true:

1. Current readiness has `RESEARCH_REQUIRED=fail` or `missing`, and no other unmet requirement is being bypassed.
2. The Workroom is live, source-complete and owned by the requesting executor.
3. A current immutable protocol exists on the exact Workroom head and states qualification-only scope, immutable target production paths/blobs, permitted new test/helper paths, command class, maximum preparation attempts, expected candidate result shape and prohibited effects.
4. The design/protocol has passed its ordinary independent policy review. That review approves the protocol, not its unknown result.
5. Current authority permits the normal `verify` action and every declared tool is already reachable through the caller/user/room grant intersection.
6. There is no prior preparation start or terminal evidence for the same binding digest.

The preparation binding fixes backlog item, Workroom, repository, base/head SHA, protocol path/blob, immutable target production blobs, permitted test/helper paths, installation identity, owner/executor, shape/version/stage, declared authoring tools, attempt count, duration, issued/expiry time, the exact independent semantic-review receipt and a canonical digest. Caller-supplied values may only repeat these values; they cannot widen them. That review approves the immutable protocol but is not execution authority: `claim_workroom_scope` re-evaluates current human/token authority, and the scheduled mandate re-reads current coworker grants immediately before each admitted effect. Preparation may author the named test/helper candidate only. It cannot change target production bytes, run the qualification for settlement, record research PASS or authorize ordinary implementation.

Preparation terminates with one candidate head and exact candidate diff/blob inventory, or with blocked/inconclusive evidence. The initial protocol binding never follows that new head automatically. The server refuses a final verification binding until an independent policy review accepts the candidate head, confirms the diff is limited to the allowed test/helper paths, confirms every target production blob is unchanged and records the exact test command and expected result interpretation.

The final verification binding is newly derived from that reviewed candidate. It binds both the original protocol blob and review receipt and the final candidate head/test blobs and review receipt, plus installation, owner, exact `verify` action, declared verification tools, one start, maximum duration and issued/expiry time. Current human/token authority and coworker grants are re-evaluated at the same execution boundaries as preparation. Any preparation after review invalidates the candidate and requires a new review/binding; it never mutates the existing binding.

For a Windows-only verification the executor mode is `native-edge`, not `workroom-host`. The server selects one current trusted internal Windows Edge node whose fresh `action.execute` capability advertises the exact qualification action. The node is part of the binding before a `RemoteAction` is created. The caller cannot nominate or replace it. A missing, stale, foreign, untrusted, disabled or differently scoped node makes the qualification unavailable rather than falling back to host metadata.

For BI-B3DEC077 the protocol may name only the controlled Windows test-only reproduction. It must not authorize a product fix, production mutation, historical-envelope replay, a second executor or an unrelated source path.

## Execution and evidence

The existing Workroom driver creates one bounded preparation task and, after candidate review, one one-shot verification task. The preparation stage exposes only existing source-authoring tools already sanctioned for the current Workroom and restricts their paths to the named test/helpers. Its terminal evidence records the candidate head/diff/blob inventory without claiming the experiment ran.

The verification stage exposes only the bound verification tools. Current sandbox receipts do not bind the actual executor, source tree and test cases, so sandbox-mode qualification is retained only for historical parsing and is fail-closed for issuance, execution, settlement and research consumption. The Workroom `record_execution_evidence` writer likewise authenticates who submitted metadata but does not independently observe a host process, so caller-submitted host assertions are non-evidence. A Windows qualification is enabled only through the signed native Edge action described below. Historical `workroom-host` bindings remain parseable but cannot issue, execute, settle or support research.

- `positive`: the tested behavior occurred;
- `negative`: the tested behavior did not occur;
- `inconclusive`: the run completed but cannot answer the protocol;
- `blocked`: the run never began or could not complete under the binding.

### Native Edge qualification action contract

Add exactly one privileged action type, `qualification.windows.verify-v1`. It uses the existing `RemoteAction` lifecycle and is available only to a trusted internal Windows native Edge node that explicitly advertises the action in its fresh `action.execute` capability and scope policy. It is machine-bound, `riskClass=high`, ChangeRequest-approved, one-shot and never selected by generic convergence.

The versioned closed parameter schema contains only server-derived identities: BI id, Workroom id, repository id, base/head SHA, protocol path/blob, immutable production path/blob inventory, allowed test path/blob inventory, qualification binding digest, expected procedure id, result schema version, maximum duration and the selected Edge node id. Every key is required and unknown keys are refused. The schema contains no command, executable, interpreter, argument, writable directory, URL, environment variable, credential, free-form script or caller-owned output field.

The native handler implements the procedure identified by `windows-handle-replacement-v1` in compiled code. It first verifies that the provisioned qualification controller manifest is immutable and matches the action contract. It materializes only an isolated temporary fixture under the agent-owned state directory and opens the controlled Windows handle with `FILE_SHARE_READ | FILE_SHARE_WRITE`, deliberately excluding delete sharing. Each attempt uses the production writer's single rename-over-destination shape; deleting the destination before rename is forbidden. The first refused replacement must preserve the old JSON and its failed temporary source must be removed. The handler then closes the held handle, performs the identical second replacement, verifies the new JSON, and cleans the fixture. It never opens or mutates a repository checkout or production file. Source/test/protocol blobs are identities used for server admission and evidence correlation, not host paths accepted from the caller.

Before creating the action the portal re-reads the Workroom, current branch/head, protocol and candidate blobs, policy review, authority decision, selected node capability and absence of a prior action for the binding digest. Creation and verification-state transition use one transaction and an idempotent action key derived from the binding digest. Claim repeats node trust, scope, ChangeRequest and allow-list checks. The signed envelope repeats the complete closed schema. The Edge verifies signature, expiry, node id, schema and its durable nonce journal before the first effect.

The native terminal report contains the action key, nonce-bound envelope digest, node id, platform/architecture, procedure id/version, qualification binding digest, base/head, protocol/test/production blob inventories, start/end timestamps, both observed replacement outcomes, cleanup disposition and bounded output digest. The portal accepts it only from the node that owns the claim, only through the existing result endpoint, and revalidates every identity against the current immutable binding before appending one Workroom execution-evidence row. Failed, timed-out and refused native actions remain terminal evidence but cannot be rewritten as success. Redelivery may deliver a stored report; it cannot execute the consumed nonce again.

The result does not set `research=pass`, change BacklogItem status, close a finding or authorize implementation. A later research writer may consume only the accepted terminal evidence for the complete binding. Caller-authored host payloads, sandbox labels, foreign nodes/actions, wrong-platform reports, missing steps, cleanup failure, nonterminal actions, prose-only reports and evidence from an unconfigured handler remain non-evidence. Missing terminal evidence remains unknown.

After a terminal result, normal `record_initiative_evidence(gate: "research")` remains the only research writer. A passing receipt that resolves `IF-91E987DA433B0C82` must cite the exact qualification evidence and include that finding in `resolvedFindingRefs`. A negative or inconclusive experiment can support a changed design or a failing research receipt; it cannot be relabelled PASS.

## Fail-closed rules

Refuse before effect when any bound item, Workroom, repository, branch, base/head, protocol path/blob/review receipt, candidate head/test blob/review receipt, target production blob, installation, Edge node, action key/type/schema, executor, tool list, current grant intersection, policy version, expiry or previous-start state differs. Preparation refuses edits outside the exact test/helper paths and refuses any target production-byte change. Verification refuses an unreviewed candidate, changed candidate, generic shell authority, caller-selected host path or command, production mutation, source editing, deployment, approval/reviewer replay or unbounded test selection. Refuse a result whose node, signed envelope/action, binding digest, native procedure, source identities, output digest or terminal disposition does not match the issued binding.

Retain the current readiness DENY and `IF-91E987DA433B0C82` throughout qualification. A protocol review, scheduled task, tool success, exit code zero or Workroom evidence row is never by itself research evidence.

## Ordered implementation

1. Resolve actual source impact and sensitivity before implementation admission. The declared medium/low documentation shape is provisional: authority, readiness, scheduling and Workroom-stage files are consequential. Accept any server-raised shape/risk and its additional review; never inherit medium/low merely from the design claim.
2. Add pure preparation/verification binding and eligibility functions beside initiative-readiness terminal recovery. Derive exact server bindings from the current Workroom, immutable protocol, candidate and authority inputs; return a typed refusal for every mismatch.
3. Extend research recovery to offer bounded preparation only for an eligible qualification protocol. Keep the existing author evidence escalation for ordinary fixes and features.
4. Carry preparation through the existing Workroom stage task config and TaskRun metadata. Enforce exact test/helper write paths, immutable target production blobs, attempt/time limits and current authority immediately before every authoring effect.
5. Persist the candidate head/diff/blob inventory, require independent candidate review, then derive a separate one-start verification binding. Never retarget the initial protocol/preparation binding.
6. Add the closed qualification action type and parameter parser to the existing database dispatch package. Extend claim timeout only for this bounded procedure; keep all existing action-type, node-scope, trust, ChangeRequest and capability checks.
7. Add one portal qualification-action module that selects a fresh eligible node, derives the idempotent action key and creates the machine-bound `RemoteAction` in the same transaction that marks the verification binding dispatched. No alternate queue, lease or result endpoint is added.
8. Add the native Windows handler and explicit provisioning/capability advertisement. The handler is disabled unless the supported native installer supplies the exact immutable controller manifest and state layout; absent or partial provisioning fails closed.
9. Extend existing result ingestion to validate the native qualification report against the bound action and append the one canonical Workroom evidence row. Refuse direct `record_execution_evidence` qualification payloads and every legacy host-lease assertion.
10. Validate terminal Workroom evidence against the verification binding and retain positive, negative, inconclusive and blocked outcomes. Do not project any result into readiness automatically.
11. Extend the research writer validation so a receipt resolving the existing finding must cite matching terminal qualification evidence. Preserve all existing receipt/finding validation.
12. Add the exact BI-B3DEC077 fixture plus negative matrices for stale protocol/candidate, production edits, foreign room/install/node/action, widened tools, duplicate preparation/action/result, replayed nonce, expiry, missing handler/provisioning, wrong platform, invalid native steps, cleanup failure, absent/conflicting evidence and attempted research auto-pass.
13. Obtain independent policy review, protected DCO publication, canonical native Edge package/install delivery and served portal deployment before BI-B3DEC077 requests preparation. Observe a fresh Windows node capability advertising the exact action before issuing it. Do not revive historical envelopes or rooms.

## Acceptance

| Criterion | Objectives | Observable result |
| --- | --- | --- |
| AC-QRA-1 | OBJ-QRA-ADMIT, OBJ-QRA-FENCE | The exact BI-B3DEC077 protocol receives one bounded preparation binding while ordinary implementation remains denied on `RESEARCH_REQUIRED=fail`; preparation can change only named test/helper paths and cannot change target production bytes. |
| AC-QRA-2 | OBJ-QRA-ADMIT, OBJ-QRA-FENCE | Independent review fixes the completed candidate head/test blobs; only then does a separate one-start verification binding fix item, Workroom, source, protocol, candidate, installation, owner, native Edge node/platform, action/schema, tools, duration, expiry and authority. Any drift refuses before effect. |
| AC-QRA-3 | OBJ-QRA-TRUTH | The signed, nonce-consumed, machine-bound native Edge action reports positive, negative, inconclusive or blocked through the existing RemoteAction/result/Workroom evidence chain without becoming a research verdict. |
| AC-QRA-4 | OBJ-QRA-TRUTH, OBJ-QRA-FENCE | Duplicate dispatch, replayed nonce, late acknowledgement, missing result, widened tools, unrelated active builds, unconfigured/foreign/wrong-platform nodes, caller-controlled commands or diagnostic claims cannot create another start or a PASS. |
| AC-QRA-5 | OBJ-QRA-RECOVER | Only a genuine later research receipt can resolve `IF-91E987DA433B0C82`, explicitly citing the bound terminal evidence and finding id. |
| AC-QRA-6 | OBJ-QRA-FENCE | Existing small-fix reproduction, feature research, grants, receipts, Workroom stages and non-qualification callers pass unchanged regression coverage. |
| AC-QRA-7 | OBJ-QRA-ADMIT, OBJ-QRA-TRUTH, OBJ-QRA-FENCE, OBJ-QRA-RECOVER | Independent policy review, protected CI/merge and served-source verification precede the first qualification action. |

### Backlog acceptance traceability

The governed medium-work coverage receipt binds the acceptance baseline verbatim:

- A server-owned qualification binding names the exact BI, Workroom, repository, base/head, immutable protocol blob, installation, accountable owner, permitted tools, bounded starts and time, and current authority decision.
- The binding reuses the governed stage/evidence mechanism; no parallel execution controller or generic bypass is introduced.
- Admission authorizes only the bounded experiment. It does not pass RESEARCH_REQUIRED, resolve IF-91E987DA433B0C82, or authorize ordinary implementation.
- Positive, negative and inconclusive terminal outcomes are all persisted truthfully and remain auditable.
- Only a later genuine research receipt may resolve the existing finding, explicitly citing its finding id and the experiment evidence.
- Changed/stale protocol, source, Workroom, installation, authority, tool scope, expiry, duplicate start, absent result, or conflicting evidence fails closed.
- Existing small-fix source_verified + test_pass and normal record_initiative_evidence behavior remain unchanged.
- Independent policy review, protected CI/merge and served deployment precede use by BI-B3DEC077.

## Scope, compatibility and rollback

Implementation scope is the qualification readiness/binding modules, a small portal qualification-action adapter, the existing database remote-action dispatcher/parser, existing result ingestion, the native Edge executor/Windows handler and their focused tests and supported installer/configuration path. Prefer pure modules over growing existing large files. `RemoteAction` remains the single execution record; no schema migration, new queue, new MCP writer or generic execution API is planned. Legacy tasks, nodes and actions without a qualification binding behave exactly as before.

Rollback removes future eligibility and dispatch for this binding while retaining issued bindings, TaskRuns, evidence, receipts and findings. Never delete or rewrite BI-B3DEC077 history. A terminal completed Workroom is continued only through a current actual Workroom/source binding and ordinary claim/admission; this repair does not reopen archived rooms or revive their approvals.

