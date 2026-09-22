---
status: active
---

# Required Terminal-Writer Enforcement Implementation Plan

**Backlog item:** `BI-8B8731EE`
**Workroom:** `WC-E30BEE1A`
**Branch:** `fix/required-terminal-writer-enforcement`
**Design:** `docs/superpowers/specs/2026-09-02-capacity-deferral-is-not-a-writer-failure-design.md`

## Outcome

Never dispatch a governed writer-only initiative-review turn through an adapter
that cannot server-verify a required tool call. Continue through the existing
fallback chain when an enforceable adapter is eligible; otherwise preserve the
same TaskRun and return a typed, actionable refusal. Writer arguments,
approvals, baselines, and receipts remain model-selected and server-governed.

## Exact reproduced evidence

TaskRun `TR-MCP-Y210Nmg3bjg3MDBnYTAxbXhheDU2MXV2aQ-7ECDD7A53D18` required
`record_initiative_evidence`, held a write-capable session token and the exact
writer grant, and persisted five successful exact-bound reader executions. Two
subsequent native-MCP Claude CLI writer-only turns returned prose and zero writer
calls. There is no writer ToolExecution, approval envelope, or receipt. The run
remains frozen and is not a test target.

## Ordered atomic fix sequence

1. Add RED provider-boundary tests for both initiative writer names proving that
   a sole, exactly bound terminal writer no longer exempts Claude CLI or Codex
   CLI from required-tool enforceability.
2. Add RED fallback tests proving the typed capability refusal does not mark a
   provider unhealthy and that a later HTTP adapter receives the unchanged
   required tool policy and terminal writer name.
3. Add RED route-failure and TaskRun projection tests for the exact all-adapters-
   unenforceable outcome: typed
   `required-terminal-writer-not-enforceable`, same TaskRun, resumable, no writer,
   envelope, or receipt.
4. Remove the CLI terminal-writer exception at the shared inference boundary.
   Emit a dedicated typed inference error before adapter execution. Keep HTTP
   adapters and other natively enforcing adapters unchanged.
5. Teach fallback to treat that error as candidate ineligibility rather than a
   provider failure: do not consume a provider request, open a runtime circuit,
   degrade a model, disable credentials, or retry the same incompatible adapter.
6. Preserve the typed cause through the agentic loop and project it into the
   original remote TaskRun with its request digest, binding, successful reads,
   grants, approval state, and replay identity intact.
7. Refactor under green only. The implementation must remain generic over the
   writer name and must not synthesize decisions, arguments, envelopes,
   baselines, or receipts.
8. Run focused and graph-linked tests, web typecheck, style/docs/source/module
   guards, and pregate preflight. If a shared local/preview lease is occupied or
   underperforming, record that result as `INCONCLUSIVE` with the focused checks
   as compensation; never claim PASS. DCO and every protected PR/merge-group
   check remain mandatory.
9. Publish one signed head, open one protected PR, arm normal squash auto-merge,
   inspect all review/check results, and monitor the protected merge. Release and
   live replay are owned by the root batch and are outside this Workroom.

## Expected code surface

- `apps/web/lib/inference/ai-inference.ts`
- `apps/web/lib/inference/ai-inference.call-provider.test.ts`

## Provider noncompliance closeout

1. Reproduce a successful immutable read followed by a required-writer prose response.
2. Carry the noncompliant provider into the next in-turn route as a deny-only constraint, clearing a matching preference without selecting or pinning its replacement.
3. Prove the same TaskRun reaches an alternate provider's actual writer call, while the no-alternative case remains a typed refusal and no receipt is inferred.
- `apps/web/lib/routing/fallback.ts`
- `apps/web/lib/routing/fallback.test.ts`
- `apps/web/lib/tak/inference-dead-ends.ts`
- `apps/web/lib/tak/inference-dead-ends.test.ts`
- `apps/web/lib/tak/agentic-loop.ts`
- `apps/web/lib/tak/agentic-loop.test.ts`
- `apps/web/lib/mcp-task-execution.ts`
- `apps/web/lib/mcp-task-execution.test.ts`
- `apps/web/lib/mcp-task-replay-projection.ts`
- `apps/web/lib/mcp-task-replay-projection.test.ts`
- `apps/web/lib/mcp-task-review-contract.ts`
- `apps/web/lib/mcp-task-submit.test.ts`
- `apps/web/lib/mcp/external-coworker-task-adapter.ts`
- `apps/web/lib/mcp/external-coworker-task-adapter.test.ts`
- `apps/web/lib/tak/terminal-tool-policy.ts`
- `apps/web/lib/tak/terminal-tool-policy.test.ts`

No schema, migration, public route, role, grant, approval, writer, receipt, or UI
surface change is expected.

## Backlog coverage

- Decision: atomic
- Parent: `BI-8B8731EE`
- Receipt: blocked-by: the required terminal-writer path being repaired cannot yet obtain its canonical readiness writer
- Dependencies: none
- Rationale: capability refusal, fallback semantics, typed cause preservation,
  and same-TaskRun projection form one fail-closed dispatch contract. Shipping
  any subset either continues to send prose-only writer turns or hides the real
  cause behind `missing-terminal-writer`.

| Deliverable key | Backlog item | Independently shippable | Requirement refs | Contract refs | Flow refs | Verification refs |
| --- | --- | --- | --- | --- | --- | --- |
| `required-terminal-writer-enforcement` | BI-8B8731EE | no | OBJ-BI8B-001, OBJ-BI8B-002, OBJ-BI8B-003, OBJ-BI8B-004 | adapter-enforceability, immutable-taskrun, terminal-writer, approval-and-receipt | writer-only-dispatch, fallback-candidate-selection, typed-taskrun-refusal | AC-BI8B-001, AC-BI8B-002, AC-BI8B-003, AC-BI8B-004, AC-BI8B-005 |

## Supersession note (2026-09-09)

Step 4's CLI exclusion is superseded for BOUND terminal writers by BI-C35576A9
(kernel DI-48BC3C1F11A8, operator-ratified): CLI adapters are dispatched under a
`receipt-verified` contract and the executor's receipt check is the guarantee. The
plain required-tool path is unchanged. See §7 of the design this plan implements.

## Risks and rollback

## Terminal truncation repair (2026-09-15)

BI-8B8731EE / WC-00D415A4 adds one atomic correction on
`fix/local-terminal-writer-contract`: distinguish output-token exhaustion from
completed prose before judging a required writer. The run-specific research/plan
review disposition is `changes/local-terminal-writer-exception.json`;
SKIPPED/INCONCLUSIVE is not a passing receipt or coverage claim.

1. Reproduce a truncated writer-only response in the real loop with mocked
   inference; assert continuation retains the sole writer and required choice.
2. Bound continuation to the existing two-turn truncation allowance. Exhaustion
   preserves missing-receipt failure but names output truncation, not provider
   noncompliance. A successful writer must never execute twice.
3. Prove the durable TaskRun projection does not tag that exhausted response as
   prose noncompliance, so the automatic noncompliance replay cannot admit it.
4. Run graph-linked and colocated loop, terminal-policy, TaskRun, background
   recovery, and adapter tests, typecheck and normal guards. Publish DCO-signed
   through the protected queue and canonical upgrade. Only then may the owner
   resume the original review and verify its actual persisted receipt.

No named-function tool-choice change, model pin, grant, migration, writer
argument, approval, or receipt validation change is included. Runtime truncation
is a hypothesis supported by the 4096-token log; the ordering defect is confirmed
in source. Tests prove the correction, not that every local-model failure is fixed.

The principal risk is rejecting a CLI that later gains a genuinely enforceable
mechanism. Enforcement is therefore decided from the adapter kind at the shared
boundary, not guessed from output, prompts, tool grants, or token capability. A
future adapter may be admitted only with a server-verifiable mechanism and its
own RED/GREEN transport test. Rollback is a protected revert; no durable TaskRun
or receipt migration is needed.

### Failure analysis — review repair round 1 (2026-09-22)

Scope: the seven-file truncation repair, not a replacement inference engine or
receipt store. The accountable owner for each residual risk below is the
BI-8B8731EE delivery owner; the reviewer-run owner controls any live resumption.
No live recovery or receipt success is claimed before canonical deployment.
The independent reviewer must evaluate the immutable supplied diff and its
named base/head trees, not substitute its own workspace checkout.

1. **Output cutoff before the writer.** Effect: an operator waits for a review
   that has no receipt. Prevention: process truncation before completed-prose
   refusal, preserving the exact allowed tools and writer binding. Containment:
   two continuations maximum, then an explicit missing-writer wait. Detection:
   `agentic-loop-terminal-truncation.test.ts` checks three dispatches on exhaustion
   and successful single-writer completion. Recovery: inspect output budget and
   resume only through the existing governed TaskRun path. Residual risk: the
   model can still omit the writer; bounded failure mitigates cost, not liveness.

2. **Provider rotation or unavailable capacity.** Effect: retrying an unsuitable
   provider wastes time; widening eligibility could disclose confidential input.
   Prevention: truncation does not add a denied provider or alter route policy;
   completed prose retains the existing deny-only rotation. Containment: routing
   still enforces sensitivity and eligible capacity; no replacement is pinned.
   Detection: the truncation test checks absence of a new deny constraint;
   `terminal-tool-policy.test.ts` covers prose rotation, sole-provider retry and
   routing failure after reading. Recovery: restore eligible capacity before a
   governed resume. Residual risk: ordinary routing may select another eligible
   provider, and no eligible provider may exist. No guaranteed affinity is claimed.

3. **Repeated resumptions and automatic replay.** Effect: an operator can incur
   repeated inference costs without receiving an assessment. Prevention: output
   exhaustion omits the prose-noncompliance marker used by automatic recovery.
   Containment: existing TaskRun attempt limits and immutable replay identity
   remain unchanged. Detection: `mcp-task-terminal-writer.test.ts` checks same-run
   replay, third-attempt exhaustion, and already-escalated replay; background
   dispatch tests reject automatic recovery without the required marker.
   Recovery: reconcile the existing run rather than submit duplicate work.
   Residual risk: a separately authorized new run has its own budget; this patch
   does not implement a global spending ceiling or exactly-once inference.

4. **Partial, rejected, or uncertain writer execution.** Effect: a false receipt
   claim can advance unreviewed work, or a duplicate writer can repeat an action.
   Prevention: emitted tool calls still execute through the governed writer;
   successful writer completion is checked before truncation continuation.
   Containment: existing policy rejects a second writer in the same batch and
   does not equate rejection with a valid receipt. Detection: truncation tests
   cover emitted calls and success followed by truncated prose; terminal-policy
   tests cover duplicate and rejected writers. Recovery: reconcile canonical
   receipt identity before resuming any uncertain write. Residual risk: mocked
   tests do not prove atomicity across process crashes or a writer-side commit
   followed by transport failure; no new cross-store atomicity guarantee is made.

5. **Approval-pending writer.** Effect: repeating a call can create duplicate
   approval work, while claiming completion can hide the human decision still
   owed. Prevention: a persisted approval envelope remains a terminal boundary
   before truncation handling. Containment: this patch never approves an envelope
   or treats it as a successful receipt. Detection: terminal-policy tests require
   the envelope, and the truncation suite checks no continuation or second writer
   after that boundary while retaining `success: false`. Recovery: the authorized
   approver resolves the existing envelope through its normal workflow. Residual
   risk: approval may remain pending; the run owner, not the loop, follows up.

6. **Persistence or projection failure.** Effect: the operator can see a stale
   state even when inference or a writer ran. Prevention: no new receipt writer
   or projection store is introduced; existing receipt validation is authoritative.
   Containment: output exhaustion retains missing-writer failure and cannot
   produce a passing receipt solely from text. Detection: durable-projection
   regression tests check the absence of prose-noncompliance on exhaustion;
   the truncation suite injects a writer persistence-error result and verifies
   bounded continuation cannot turn that failed result into success;
   replay tests check persisted escalation without another attempt. Recovery:
   read canonical TaskRun, tool execution and receipt records, reconcile their
   exact identity, and use governed recovery rather than direct database edits.
   Residual risk: database outage/crash consistency is not proven by those mocked
   projection tests. Live post-deployment reconciliation remains required.

7. **Operator misunderstanding or unsuccessful deployment.** Effect: passing
   tests may be mistaken for a delivered assessment. Prevention: report source
   gates separately from served-version and receipt acceptance. Containment:
   keep the original BI open and original reviewer frozen until deployment is
   verified. Detection: canonical upgrade identity and the original run's actual
   receipt are the acceptance observations, both currently pending. Recovery:
   protected revert for a regression; escalate an unresolved reviewer instead of
   silently replaying it. Residual risk: delivery remains incomplete until the
   reviewer owner verifies the receipt and its exact authority fingerprint.

**Evidence boundary.** Each test named above is source-local, mocked evidence
for its stated invariant, not a live receipt. Exact-tree CI records bind the
executed tests, typechecks, guards and production build to the reviewed commit;
the review submission references that record after it passes. The round-1
evidence must be rerun after these additions. Canonical deployment identity,
real reviewer recovery and persisted receipt acceptance remain unrun. If those
fail, retain the failure and obtain governed recovery; do not mark the BI done.
