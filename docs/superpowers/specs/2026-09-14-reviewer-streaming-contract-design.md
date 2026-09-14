---
status: active
---

# Reviewer streaming contract repair

Status: implementation authorized by the run-local exception below; readiness
research, independent spec approval and live plan coverage remain UNRUN, not passed.
Implementation owner: BI-87148687. Workroom: WC-64E1A7A1.
Delivery category: operator-approved Medium; the platform raises review sensitivity to high.

## Problem and evidence

Canonical evidence `cmu1nljmz414n01mlacdtlzyw` records the failed research
review's route at 2026-09-14 06:02:23.625 UTC. AGT-WS-BUILD's `external-mcp`
request excluded all six Codex endpoints for `Missing required capability:
streaming`. The embedding and ChatGPT endpoints lacked tool-use capability;
local Qwen was the only candidate. Recent Build and Review route records repeat
the same exclusions. Local inference admission subsequently times out under
contention. Provider availability is not evidence of spare admission capacity.

The source explains the streaming exclusion: `tak/agentic-loop.ts` knows whether
the caller is chat or autonomous, but its `routeOptions` does not communicate
that the autonomous consumer needs a completed result, not streamed tokens.
`routing/request-contract.ts` defaults interaction mode to `sync`, which derives
a streaming requirement for `external-mcp`.

This establishes a routing mismatch, not the cause of every uncertain review.
In particular, scheduler review TR-GATE-8153F26BFC76FA3EED2EFFFC needs its own
execution reconciliation. Neither the coordinator appointments nor this design
authorizes a retry of that review.

## Existing substrate and boundaries

- `tak/autonomous-work-run.ts` distinguishes chat/autonomous and tags admission
  origin. Retain that distinction and its budgets.
- `tak/agentic-loop.ts` consumes `RoutedInferenceResult.content` and `toolCalls`.
- `inference/routed-inference-options.ts` and `route-contract-builder.ts` carry
  caller requirements into `routing/request-contract.ts`.
- `routing/pipeline-v2.ts` excludes endpoints that cannot meet the resulting
  contract; `routing/execution-plan.ts` derives actual streaming from it.
- `inference/routed-inference.ts` treats `background` as durable asynchronous
  admission and returns an operation handle. This is NOT interchangeable with
  a synchronous call that does not stream.

Reuse these contracts. No new tables, providers, agent identities, grants,
retry counters, or alternate receipt writer are needed.

## Options and selected approach

1. **Explicit streaming requirement, completed-result execution (selected).**
   Carry an optional caller streaming requirement through the existing route
   options/context into request-contract inference. Autonomous agentic calls
   explicitly do not require streaming. Preserve the current default for chat
   and callers that omit the requirement. Keep the interaction mode and result
   delivery semantics unchanged. A true streaming requirement still excludes
   endpoints that do not advertise it.
2. **Convert the loop to durable background operations (deferred).** This would
   require operation polling, checkpoint/resume, cancellation and result-handle
   consumption. It is a materially larger change than repairing an erroneous
   requirement. Merely switching the existing mode would break the consumer.
3. **Mark Codex streaming-capable or force a provider (rejected).** That would
   substitute an assertion for capability evidence and could bypass legitimate
   routing constraints. The repair belongs in the caller contract.

## Research and benchmarking

This is an internal contract repair, not a new feature or external dependency.
The comparison is between the platform's existing completed-result and durable
asynchronous execution paths, not adoption of a new orchestration framework.
The existing execution plan already separates `stream` from delivery mode; the
repair should make caller requirements reflect that existing separation.
Independent review must check this choice; the run-local exception below defers
the currently blocked readiness receipts, not protected delivery review.

## Run-local enforcement override — 2026-09-14

The authenticated operator in Codex task `01a07357-54bf-7da2-8813-4cec6fc9ebad`
directed: "Fix the process until it works and the desired outcomes for this
thread are delivered. Bypass process if needed." The owning repair task read
that actual user message and the existing run-local exception precedent in
`2026-08-24-external-mcp-coworker-thread-context-design.md` before applying it.
The source task explicitly delegated this bounded repair exception on September
14, conditional on the current independent spec attempt ending without receipt.

That condition was verified in canonical TaskRun state: spec review
`TR-MCP-Y21xamsxOWhsMDAwMDdwcnZzZm4ybTAzOQ-D2CBA7F95346` attempt 2 became
`input-required` at `2026-09-14T20:10:55.585Z`, with
`prose-without-required-writer` and no receipt. The earlier source hydration
contained 6,826 characters across three pages. Research also encountered local
provider-capacity wait. Normal coverage refused `traceability-incomplete`
because the missing spec receipt has not created the initiative scope baseline.
The review mechanism therefore blocks the implementation of its own routing fix.

For **BI-87148687 / WC-64E1A7A1 / branch
`fix/reviewer-streaming-contract` only**, the operator direction authorizes
implementation of the scoped streaming-contract correction and its tests while
`RESEARCH_REQUIRED`, spec approval and `PLAN_REQUIRED`/live coverage remain
**UNRUN (no passing receipt)**. Failed or inconclusive attempts remain recorded;
this exception is not an approval, baseline, coverage record or delivery verdict.
It expires at this branch's PR merge or branch abandonment.

It does not bypass tool grants, sensitivity/data screening, author/reviewer
separation, DCO, protected PR or merge queue, build gates, scope ownership,
destructive/production-integrity controls, or canonical-runtime verification.
It does not apply to the scheduler branch or authorize its uncertain review to
be replayed. Do not consume spec attempt 3 before the repair is live. After
protected delivery and canonical deployment, reconcile the exact bound reviews
through the supported recovery and record actual receipts and plan coverage.

## Acceptance criteria

- AC1: An autonomous external-MCP reviewer does not exclude an otherwise eligible
  non-streaming Codex endpoint solely for streaming.
- AC2: The consuming loop receives normal completed text/tool results, not an
  unhandled asynchronous operation handle. Tool execution and iteration still work.
- AC3: Existing chat callers retain their streaming requirement and capability
  filtering. Explicit streaming demand still fails closed for incapable endpoints.
- AC4: Data-screening, minimum tool capability, independent reviewer identity,
  immutable artifact binding, receipt validation and retry limits are unchanged.
- AC5: On the canonical updated runtime, an eligible governed reviewer completes
  a real receipt. A route preview or unit test alone is not completion evidence.

## Ordered implementation sequence and backlog coverage

BI-87148687 is the implementation parent and owns this sequence. It is atomic:
caller intent, contract propagation, eligibility and consumer-result tests must
ship together to avoid advertising eligibility that cannot be consumed.
No independently shippable child is proposed. Live coverage is pending; this
document is not a coverage receipt.

1. Resolve scope impact and inspect existing request-contract, routed-inference
   and agentic-loop tests. Add failing cases for AC1-AC3 at each existing seam.
2. Add the optional streaming requirement to existing route options/context and
   request inference. Pass the non-streaming requirement from autonomous calls;
   preserve omitted/chat defaults. Do not switch delivery mode to background.
3. Exercise the real eligibility pipeline with an otherwise eligible
   non-streaming tool-capable endpoint. Exercise the loop consuming completed
   tool/text results. Add negative regressions for AC3-AC4.
4. Run affected tests, typecheck and required source guards, then the canonical
   build/review gate. Publish only when merge-ready; merge through the queue.
5. Advance the canonical install through self-upgrade. Reconcile persisted
   reviewer state and use only a currently permitted recovery. Verify AC5 and
   record outcome evidence; do not reset exhausted tasks or fabricate receipts.

## Risks, documentation and rollback

### Authorized evidence-reuse recovery extension — 2026-09-14

The operator's coordinating task explicitly authorized repairing the newly
observed CI-evidence binding blocker on this same branch. The first real gate
passed, but its evidence had a null Workroom link because the room used a custom
executor label instead of the app task ID. Correcting that identity through
`reassign_workroom_executor` succeeded; the documented re-run reused the same
unlinked evidence. No result or database row was manually rewritten.

The actual reuse boundary is `settleTerminalGateLease`, inside the existing
lease transaction, before the result recorder is called. Extend that boundary,
not a client workaround: use the canonical evidence's stored branch, SHA and
external session to find exactly one non-archived Workroom with that identity.
Attach only a null link with a compare-and-set update. Refuse multiple matches,
a foreign existing link or a lost update. Missing legacy identity or no matching
Workroom remains unlinked and does not acquire review authority. Do not change
the verdict, output, expiry, gate identity or lease owner.

Sequence: write failing admission-reuse regression tests; add the narrow
transactional reconciliation; prove same-link idempotency and refusal cases;
rerun affected tests, types and the canonical gate on the new immutable SHA;
obtain protected independent review before publication; verify real reuse and
reviewer receipts after canonical deployment. This extension shares BI-87148687
and the branch-only readiness exception, not a protected-review exception.

The shared inference boundary affects more than the originating reviewer.
Defaults must remain backward-compatible. An execution-plan recipe must not
silently re-enable streaming against a non-streaming contract. Re-run existing
background-operation and sensitive-data screening regressions as well as the
new consumer tests. No credential, residency or provider-capacity override is
part of this repair.

Update the owning inference architecture documentation with the distinction
between token streaming and result delivery. There is no user-facing UI change.
Rollback is one PR revert through the normal pipeline. Preserve all run and
receipt evidence even if the code is reverted.
