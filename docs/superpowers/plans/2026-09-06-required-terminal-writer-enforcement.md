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

## Risks and rollback

The principal risk is rejecting a CLI that later gains a genuinely enforceable
mechanism. Enforcement is therefore decided from the adapter kind at the shared
boundary, not guessed from output, prompts, tool grants, or token capability. A
future adapter may be admitted only with a server-verifiable mechanism and its
own RED/GREEN transport test. Rollback is a protected revert; no durable TaskRun
or receipt migration is needed.
