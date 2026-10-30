---
status: draft
backlog_item: BI-2664971A
workroom: WC-A8C14CBE
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

No new executor, queue, evidence store, grant class or generic diagnostic flag is required.

- `apps/web/lib/work-management/action-registry.ts` already defines consequential `verify`, requires policy evaluation and a receipt, and sanctions only `run_sandbox_tests`, `run_ux_test` and `record_workroom_evidence`.
- `apps/web/lib/scheduling/workroom-stage-task-config.ts` already carries an exact shape/version/stage and its declared tools into a `ScheduledAgentTask`. It explicitly narrows tools and never grants them.
- `apps/web/lib/actions/agent-task-scheduler.ts` already creates a TaskRun for a Workroom stage, includes the stage's tools, requires the evidence writer and deduplicates completing evidence for the same dispatch.
- `record_workroom_evidence` already records stage outcomes; `record_execution_evidence` remains the source for later delivery/acceptance evidence. Neither is a research receipt.
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

For BI-B3DEC077 the protocol may name only the controlled Windows test-only reproduction. It must not authorize a product fix, production mutation, historical-envelope replay, a second executor or an unrelated source path.

## Execution and evidence

The existing Workroom driver creates one bounded preparation task and, after candidate review, one one-shot verification task. The preparation stage exposes only existing source-authoring tools already sanctioned for the current Workroom and restricts their paths to the named test/helpers. Its terminal evidence records the candidate head/diff/blob inventory without claiming the experiment ran.

The verification stage exposes only the bound verification tools. Current sandbox receipts do not bind the actual executor, source tree and test cases, so sandbox-mode qualification is retained only for historical parsing and is fail-closed for issuance, execution, settlement and research consumption. The Workroom `record_execution_evidence` writer likewise authenticates who submitted metadata but does not independently observe a host process, so host assertions are also non-evidence. Qualification may be enabled only after the responsible sandbox or host runner emits an exact server-verifiable executor/build/head/test-case/platform/output receipt. Until then the binding and parser remain auditable scaffolding, but neither mode may earn research PASS.

- `positive`: the tested behavior occurred;
- `negative`: the tested behavior did not occur;
- `inconclusive`: the run completed but cannot answer the protocol;
- `blocked`: the run never began or could not complete under the binding.

The canonical `host-resource-runner` is the responsible host executor. A verify-phase qualification token is supplied to that runner out-of-band, never as a caller-authored result. The runner presents the signed token when it claims its existing `host-heavy-resource` lease. The server verifies the current Workroom principal, exact signed binding, branch/head, required platform, test path/blob and one-start window, then derives the lease claim identity from the binding digest. The runner supervises the child, streams its output unchanged, hashes the observed output, and on terminal success submits the derived receipt through the existing `record_execution_evidence` writer. The writer re-verifies the signed binding and active canonical lease, including owner session/provider, runner PID/process identity, branch/head, claim identity and execution window, then atomically binds the resulting activity id to the lease. A caller-shaped payload without that exact leased runner association is non-evidence.

The runner-attested result includes the binding digest, executor lease identity, command/test identity, candidate head/test blobs, platform, bounded output digest and timings. A later research writer may accept only the receipt kind selected by the signed binding, only while its independently observed source/executor metadata matches the complete verification binding, and only inside the admitted execution window. Sandbox-labelled receipts and authenticated Workroom assertions remain auditable but are non-evidence until their own executor provenance contract exists. A caller-selected, foreign lease, foreign build, wrong-platform, skipped-required-case, nonzero execution or prose-only receipt is non-evidence. The result does not set `research=pass`, change BacklogItem status, close a finding or authorize implementation. Missing terminal evidence remains unknown.

After a terminal result, normal `record_initiative_evidence(gate: "research")` remains the only research writer. A passing receipt that resolves `IF-91E987DA433B0C82` must cite the exact qualification evidence and include that finding in `resolvedFindingRefs`. A negative or inconclusive experiment can support a changed design or a failing research receipt; it cannot be relabelled PASS.

## Fail-closed rules

Refuse before effect when any bound item, Workroom, repository, branch, base/head, protocol path/blob/review receipt, candidate head/test blob/review receipt, target production blob, installation, executor, tool list, current grant intersection, policy version, expiry or previous-start state differs. Preparation refuses edits outside the exact test/helper paths and refuses any target production-byte change. Verification refuses an unreviewed candidate, changed candidate, general shell authority, production mutation, source editing, deployment, approval/reviewer replay or unbounded test selection. Refuse a result whose TaskRun/tool receipt, output digest or terminal disposition does not match the issued binding.

Retain the current readiness DENY and `IF-91E987DA433B0C82` throughout qualification. A protocol review, scheduled task, tool success, exit code zero or Workroom evidence row is never by itself research evidence.

## Ordered implementation

1. Resolve actual source impact and sensitivity before implementation admission. The declared medium/low documentation shape is provisional: authority, readiness, scheduling and Workroom-stage files are consequential. Accept any server-raised shape/risk and its additional review; never inherit medium/low merely from the design claim.
2. Add pure preparation/verification binding and eligibility functions beside initiative-readiness terminal recovery. Derive exact server bindings from the current Workroom, immutable protocol, candidate and authority inputs; return a typed refusal for every mismatch.
3. Extend research recovery to offer bounded preparation only for an eligible qualification protocol. Keep the existing author evidence escalation for ordinary fixes and features.
4. Carry preparation through the existing Workroom stage task config and TaskRun metadata. Enforce exact test/helper write paths, immutable target production blobs, attempt/time limits and current authority immediately before every authoring effect.
5. Persist the candidate head/diff/blob inventory, require independent candidate review, then derive a separate one-start verification binding. Never retarget the initial protocol/preparation binding.
6. Extend the existing host-resource lease claim with the signed qualification binding. Derive its claim identity server-side, refuse drift before process start and return only the validated receipt projection needed by the runner.
7. Refactor the canonical host runner's child observation so it streams and hashes output once, then publishes exactly one successful terminal receipt through the existing execution-evidence writer. Nonzero, interrupted, expired, skipped or unobserved runs publish no passing evidence.
8. Validate and CAS-bind that receipt to the exact active lease. Caller-authenticated metadata, a foreign lease, a reused receipt, mismatched process/source/platform/test/command, or evidence outside the admitted window remains insufficient.
9. Validate terminal Workroom evidence against the verification binding and retain positive, negative, inconclusive and blocked outcomes. Do not project any result into readiness automatically.
10. Extend the research writer validation so a receipt resolving the existing finding must cite matching terminal qualification evidence. Preserve all existing receipt/finding validation.
11. Add the exact BI-B3DEC077 fixture plus negative matrices for stale protocol/candidate, target production edits, foreign room/install/executor/lease, widened tools, duplicate preparation/execution/receipt, expiry, nonzero or missing/conflicting evidence and attempted research auto-pass.
12. Obtain independent policy review, protected DCO publication and served deployment before BI-B3DEC077 requests preparation. Then issue current bindings in order; do not revive historical envelopes or rooms.

## Acceptance

| Criterion | Objectives | Observable result |
| --- | --- | --- |
| AC-QRA-1 | OBJ-QRA-ADMIT, OBJ-QRA-FENCE | The exact BI-B3DEC077 protocol receives one bounded preparation binding while ordinary implementation remains denied on `RESEARCH_REQUIRED=fail`; preparation can change only named test/helper paths and cannot change target production bytes. |
| AC-QRA-2 | OBJ-QRA-ADMIT, OBJ-QRA-FENCE | Independent review fixes the completed candidate head/test blobs; only then does a separate one-start verification binding fix item, Workroom, source, protocol, candidate, installation, owner, executor mode/platform, action, tools, duration, expiry and authority. Any drift refuses before effect. |
| AC-QRA-3 | OBJ-QRA-TRUTH | Positive, negative, inconclusive and blocked outcomes persist through existing TaskRun/tool/Workroom evidence without becoming a research verdict. |
| AC-QRA-4 | OBJ-QRA-TRUTH, OBJ-QRA-FENCE | Duplicate dispatch, late acknowledgement, missing result, widened tools, unrelated active builds, wrong-platform/skipped runs and caller-controlled diagnostic claims cannot create another start or a PASS. |
| AC-QRA-5 | OBJ-QRA-RECOVER | Only a genuine later research receipt can resolve `IF-91E987DA433B0C82`, explicitly citing the bound terminal evidence and finding id. |
| AC-QRA-6 | OBJ-QRA-FENCE | Existing small-fix reproduction, feature research, grants, receipts, Workroom stages and non-qualification callers pass unchanged regression coverage. |
| AC-QRA-7 | OBJ-QRA-ADMIT, OBJ-QRA-TRUTH, OBJ-QRA-FENCE, OBJ-QRA-RECOVER | Independent policy review, protected CI/merge and served-source verification precede the first qualification action. |

## Scope, compatibility and rollback

Initial source scope is initiative-readiness recovery/receipt validation, Workroom stage task configuration and their focused tests. Prefer pure modules over growing existing large files. No schema migration or new MCP writer is planned. Legacy tasks without a qualification binding behave exactly as before.

Rollback removes future eligibility and dispatch for this binding while retaining issued bindings, TaskRuns, evidence, receipts and findings. Never delete or rewrite BI-B3DEC077 history. A terminal completed Workroom is continued only through a current actual Workroom/source binding and ordinary claim/admission; this repair does not reopen archived rooms or revive their approvals.

