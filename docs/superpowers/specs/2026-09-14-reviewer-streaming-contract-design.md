# Reviewer streaming contract repair

Status: proposed; implementation awaits governed research and plan coverage.
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
Independent review must check this choice before implementation.

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
