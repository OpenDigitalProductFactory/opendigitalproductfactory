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

No new execution controller, queue, evidence store, grant class or generic diagnostic flag is required. The existing governed host-resource runner already owns the Windows process, exact source identity, bounded lease and single-use execution evidence.

- `apps/web/lib/work-management/action-registry.ts` already defines consequential `verify`, requires policy evaluation and a receipt, and sanctions only `run_sandbox_tests`, `run_ux_test` and `record_workroom_evidence`.
- `apps/web/lib/scheduling/workroom-stage-task-config.ts` already carries an exact shape/version/stage and its declared tools into a `ScheduledAgentTask`. It explicitly narrows tools and never grants them.
- `apps/web/lib/actions/agent-task-scheduler.ts` already creates a TaskRun for a Workroom stage, includes the stage's tools, requires the evidence writer and deduplicates completing evidence for the same dispatch.
- `record_workroom_evidence` already records stage outcomes; `record_execution_evidence` remains the source for later delivery/acceptance evidence. Neither is a research receipt.
- `scripts/host-resource-runner.mjs` already owns host-specific process supervision behind an admitted `host-heavy-resource` lease. It binds branch/head, process identity, command, duration and output digest, and records execution evidence only after the owned child exits successfully.
- The supervised Workroom/runtime and external-agent evidence lanes already own host-specific execution. A qualification uses that accountable Workroom executor when the protocol requires a host capability (for BI-B3DEC077, Windows handle sharing) that Build Studio's Linux sandbox cannot supply. It never selects an unrelated active FeatureBuild merely because one exists.
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

For a Windows-only verification the executor mode is `workroom-host`. The signed binding fixes the Windows platform, exact candidate head and test blobs, and the one allowed test path. The runner accepts only `node --test <exact-bound-path>`, acquires the canonical host-resource lease, owns the child process, hashes both output streams and atomically consumes that lease when it records one execution-evidence row. A missing Windows host, mismatched command, stale source, expired binding, changed process identity or unavailable lease makes the qualification unavailable; there is no Edge or generic-shell fallback.

For BI-B3DEC077 the protocol may name only the controlled Windows test-only reproduction. It must not authorize a product fix, production mutation, historical-envelope replay, a second executor or an unrelated source path.

## Execution and evidence

The existing Workroom driver creates one bounded preparation task and, after candidate review, one one-shot verification task. The preparation stage exposes only existing source-authoring tools already sanctioned for the current Workroom and restricts their paths to the named test/helpers. Its terminal evidence records the candidate head/diff/blob inventory without claiming the experiment ran.

The verification stage exposes only the bound verification tools. Current sandbox receipts do not bind the actual executor, source tree and test cases, so sandbox-mode verification remains fail-closed. Windows verification runs only through the host runner: the live signed binding, current accountable principal, active process-bound lease, exact head/test blobs, bounded execution window and unused lease evidence slot must all agree. Direct caller-shaped evidence without that live lease is refused.

- `positive`: the tested behavior occurred;
- `negative`: the tested behavior did not occur;
- `inconclusive`: the run completed but cannot answer the protocol;
- `blocked`: the run never began or could not complete under the binding.

### Governed Windows qualification procedure

The BI-B3DEC077 candidate lives in `scripts/lib/local-ci-gate-state.test.mjs` and calls the exported `writeLocalCiGateState`; production writer bytes remain unchanged. A bounded hidden PowerShell helper opens only the destination state file with `FileShare.ReadWrite`, deliberately excluding delete sharing. While held, the identical writer call must fail at rename, preserve the complete prior JSON byte-for-byte and leave no temporary file. The test then releases and joins the helper, repeats the identical writer call, and requires the new complete JSON. Cleanup kills a stranded helper and removes only its temporary fixture.

The signed verification token is supplied to `scripts/host-resource-runner.mjs`. The runner accepts no caller-selected procedure: its qualification command parser allows only the Node executable, `--test`, and the exact ordered paths in the binding. It proves current source identity before claiming one `host-heavy-resource` lease, supervises the owned child, hashes stdout/stderr, and records the terminal result through `record_execution_evidence`. The server revalidates binding digest, platform, head, test blobs, accountable principal, lease purpose/process/source/window and the empty evidence slot before atomically binding one evidence row to that lease.

The result does not set `research=pass`, change BacklogItem status, close a finding or authorize implementation. Failed, timed-out, skipped or refused runs remain truthful terminal or unrun evidence and cannot be rewritten as success. A later research writer may consume only accepted evidence for the complete binding. Caller-authored payloads, sandbox labels, wrong-platform runs, extra tests, changed commands, missing cleanup, prose-only reports and evidence without the matching live lease remain non-evidence.

After a terminal result, normal `record_initiative_evidence(gate: "research")` remains the only research writer. A passing receipt that resolves `IF-91E987DA433B0C82` must cite the exact qualification evidence and include that finding in `resolvedFindingRefs`. A negative or inconclusive experiment can support a changed design or a failing research receipt; it cannot be relabelled PASS.

## Fail-closed rules

Refuse before effect when any bound item, Workroom, repository, branch, base/head, protocol path/blob/review receipt, candidate head/test blob/review receipt, target production blob, installation, executor, tool list, current grant intersection, policy version, expiry or previous-start state differs. Preparation refuses edits outside the exact test/helper paths and refuses any target production-byte change. Verification refuses an unreviewed candidate, changed candidate, generic shell authority, caller-selected extra path or command, production mutation, source editing, deployment, approval/reviewer replay or unbounded test selection. Refuse a result whose signed binding, lease/process/source identities, command, output digest or terminal disposition does not match the issued binding.

Retain the current readiness DENY and `IF-91E987DA433B0C82` throughout qualification. A protocol review, scheduled task, tool success, exit code zero or Workroom evidence row is never by itself research evidence.

## Ordered implementation

1. Resolve actual source impact and sensitivity before implementation admission. The declared medium/low documentation shape is provisional: authority, readiness, scheduling and Workroom-stage files are consequential. Accept any server-raised shape/risk and its additional review; never inherit medium/low merely from the design claim.
2. Add pure preparation/verification binding and eligibility functions beside initiative-readiness terminal recovery. Derive exact server bindings from the current Workroom, immutable protocol, candidate and authority inputs; return a typed refusal for every mismatch.
3. Extend research recovery to offer bounded preparation only for an eligible qualification protocol. Keep the existing author evidence escalation for ordinary fixes and features.
4. Carry preparation through the existing Workroom stage task config and TaskRun metadata. Enforce exact test/helper write paths, immutable target production blobs, attempt/time limits and current authority immediately before every authoring effect.
5. Persist the candidate head/diff/blob inventory, require independent candidate review, then derive a separate one-start verification binding. Never retarget the initial protocol/preparation binding.
6. Bind Windows verification to `workroom-host` and the existing host-resource runner. Accept only `node --test` plus the exact ordered test paths from the signed binding; no extra executable, flag or test path is admitted.
7. Record successful execution through the existing `record_execution_evidence` writer only after the owned child exits zero. Revalidate and atomically consume the matching process-bound lease so one execution cannot yield two receipts.
8. Validate terminal Workroom evidence against the verification binding and retain positive, negative, inconclusive and blocked outcomes. Do not project any result into readiness automatically.
9. Extend the research writer validation so a receipt resolving the existing finding must cite matching terminal qualification evidence. Preserve all existing receipt/finding validation.
10. Add the exact BI-B3DEC077 real-writer fixture plus negative matrices for stale protocol/candidate, production edits, foreign room/install, widened tools, changed or extra commands, duplicate starts/results, expiry, wrong platform, held-file cleanup failure, absent/conflicting evidence and attempted research auto-pass.
11. Obtain independent policy review, protected DCO publication and served portal deployment before BI-B3DEC077 requests preparation. Do not revive historical envelopes or rooms.

## Acceptance

| Criterion | Objectives | Observable result |
| --- | --- | --- |
| AC-QRA-1 | OBJ-QRA-ADMIT, OBJ-QRA-FENCE | The exact BI-B3DEC077 protocol receives one bounded preparation binding while ordinary implementation remains denied on `RESEARCH_REQUIRED=fail`; preparation can change only named test/helper paths and cannot change target production bytes. |
| AC-QRA-2 | OBJ-QRA-ADMIT, OBJ-QRA-FENCE | Independent review fixes the completed candidate head/test blobs; only then does a separate one-start verification binding fix item, Workroom, source, protocol, candidate, installation, owner, Windows platform, exact Node test command, tools, duration, expiry and authority. Any drift refuses before effect. |
| AC-QRA-3 | OBJ-QRA-TRUTH | The signed binding and process-bound, single-use host lease report positive, negative, inconclusive or blocked through the existing execution/Workroom evidence chain without becoming a research verdict. |
| AC-QRA-4 | OBJ-QRA-TRUTH, OBJ-QRA-FENCE | Duplicate starts/results, late evidence, missing result, widened tools, unrelated active builds, wrong-platform hosts, caller-controlled extra commands or diagnostic claims cannot create another start or a PASS. |
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

Implementation scope is the qualification readiness/binding modules, the existing host-resource runner, the real gate-state writer test and their focused tests. Prefer pure validation helpers over growing large files. The existing Workroom state, host lease and evidence record remain the execution record chain; no schema migration, new queue, RemoteAction type, Edge handler, MCP writer or generic execution API is added. Legacy tasks and host runs without a qualification binding behave exactly as before.

Rollback removes future eligibility and dispatch for this binding while retaining issued bindings, TaskRuns, evidence, receipts and findings. Never delete or rewrite BI-B3DEC077 history. A terminal completed Workroom is continued only through a current actual Workroom/source binding and ordinary claim/admission; this repair does not reopen archived rooms or revive their approvals.

