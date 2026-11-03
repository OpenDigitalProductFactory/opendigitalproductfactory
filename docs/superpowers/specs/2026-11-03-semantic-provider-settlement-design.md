---
status: active
backlog: BI-346EF529
---

# Request-bound semantic provider settlement

Status: active fix design and ordered plan; independent review and deployment pending.
Backlog: BI-346EF529. Workroom: WC-9B20E05C.
Extends [shared reviewer control](2026-07-27-shared-change-reviewer-control-design.md).
Owner: AGT-EXT-CODEX, chat 01a1741b-b5bb-7452-a3e6-affa024a7ac3.
Coordinator: existing OpsMap chat 019fc372-5f89-79e3-bd5c-7cda1e182cef.

## Problem and evidence

TR-GATE-946C25E3DA40177C7094E65C at dd42fd0f29458ee15b28a00712602fce55f77cee
has two failed semantic nodes after its original deadline, with providerOutcome
unknown and no retry authority. Candidate routing and adapter telemetry prove
client activity but have no authenticated node binding or provider termination
acknowledgement. Client transport closure is not a provider receipt.

**OBJ-1:** Persist original branch-to-provider correlation before dispatch.
**OBJ-2:** Separate client termination from authenticated provider disposition.
**OBJ-3:** Recover only through existing authority, budget and writer fences.
**OBJ-4:** Give historical missing-proof work an explicit non-accepting terminal
disposition without inventing settlement or a passing review.

## Existing substrate and scope

Use TaskRun generations, TaskNode snapshots, RouteDecisionLog traceId,
AdapterRunTelemetry and scoped RuntimeVerification. Existing critical checkpoints
are awaited and fenced; adapter analytics are fire-and-forget and cannot serve
as the authoritative settlement writer. No new scheduler, provider or grants.

Relevant files: semantic-review-background.ts, routed-semantic-review.ts and
semantic-review-remediation.ts under apps/web/lib/change-review; routed-inference.ts
and provider-inference-transport.ts under apps/web/lib/inference;
routing/adapter-telemetry-writer.ts. Reuse existing transport/capture mechanisms.

BI-8ECEC429 delivered UNKNOWN guidance. BI-CAP-3147C64B exposes readback.
BI-7906C73E owns historical initiative-review fences. These remain separate.

## Options and selected approach

1. Infer completion from timeout, idle model, process exit or missing rows:
rejected because none authenticates termination of the original request.
2. Add an independent settlement scheduler/table: rejected because it duplicates
task ownership and recovery policy.
3. Extend existing fenced branch checkpoints and provider adapter result
contracts: selected. Persist correlation before the first effect, and append
typed observed terminal evidence through the original owner.

Correlation includes taskRunId, taskNodeId, immutable request digest, execution
generation, branch id, server-generated attempt id, route trace, endpoint,
account identity and model. Every fallback attempt needs its own identity;
settling the last attempt alone cannot settle the branch.

Before dispatch, failure to persist correlation stops dispatch. Once dispatch may
have begun, missing persistence remains UNKNOWN. Prompts, credentials and full
responses are excluded from public readback.

Terminal proof types are complete provider response, acknowledged provider
cancellation, and authenticated pre-dispatch refusal. A local AbortError,
deadline, closed socket, adapter finishedAt or HTTP status alone proves only the
corresponding client observation. Provider acknowledgement must identify the
original request and terminal state. Unsupported cancellation is explicit.
A complete but malformed review can prove provider completion while retaining
an inconclusive review result.

A shared predicate validates correlation, all attempt coverage, terminal proof,
current source and original generation. Evidence collection may append a late
observation after the execution deadline, but cannot write a semantic verdict,
renew a budget or cross a revoked writer fence. Recovery consumes the existing
scoped health verification and bounded-successor contract only after this proof
is validated. Role names and caller executionSettled booleans confer no proof.

## Historical D62 disposition

First try immutable prompt hash plus original route/transport/provider records
to authenticate both candidate traces. Temporal proximity alone is insufficient.
If the provider retained a request id and terminal observation, the governed
collector can validate that evidence against original task/node/digest and
record the existing scoped remediation receipt. The original requester then
uses retry_semantic_review with that server-resolved receipt; the existing
expired-window successor admission decides authority and remaining allowance.

If original request identity or acknowledgement was never retained, this repair
cannot make D62 retryable. Supported finite disposition is cancellation or
abandonment by the current authorized original-task owner through the existing
lifecycle, preserving UNKNOWN provider outcome and no acceptance. Before any
new review is admitted, the canonical writer/effect authority must independently
prove old-writer revocation and reconcile possibly started effects through its
existing approved policy. This design grants no such exception. Where that
policy cannot establish safety, the source PR remains held. Protection remains
unsatisfied; a closed administrative task is not an independent review.

## Research and compatibility

Docker Model Runner documents OpenAI-compatible chat completions, embeddings
and model management, but this investigation has not established a request-bound
terminal cancellation receipt on the deployed endpoint:
https://docs.docker.com/ai/model-runner/api-reference/

OpenAI background Responses exposes request-id cancellation; its synchronous
connection-termination semantics must not be assumed for another provider:
https://developers.openai.com/api/reference/resources/responses/methods/cancel
https://developers.openai.com/api/docs/guides/background

Adopt explicit provider capabilities and retained operation identity; reject
inferring protocol behavior merely from an OpenAI-compatible URL. This is a
repair to existing lifecycle contracts, with no new external dependency.

## Acceptance criteria

- AC-1 / OBJ-1: A durable immutable node/attempt binding exists before dispatch; failed binding prevents the effect. Fallbacks retain all attempts.
- AC-2 / OBJ-2: Response completion, acknowledged cancellation, client-only abort and unavailable provider observation remain distinct across restart.
- AC-3 / OBJ-3: Mismatched digest, node, account, generation, source, incomplete attempt set or stale proof refuses recovery; concurrency admits at most the existing single successor.
- AC-4 / OBJ-4: Historical missing proof remains UNKNOWN and can receive only an authorized non-accepting terminal disposition; it never earns a review pass.
- AC-5 / OBJ-1,OBJ-2,OBJ-3,OBJ-4: First-failing regression tests, targeted tests, both typechecks, canonical exact-tree integration, independent review and served acceptance demonstrate the contract. Unrun checks stay unrun.

## Ordered atomic delivery and backlog coverage

All steps map to BI-346EF529. They are internal sequencing of one repair:
a producer without a consumer is insufficient and a consumer without proof is
unsafe. Existing transport/correlation predicate consolidation accounts for at
least 20 percent of implementation effort. Funding scope remains unresolved;
no organization allocation is inferred.

1. Freeze exact source and authenticate adapter acknowledgement capabilities.
Resolve scope claims and impact contract. Verify whether a schema extension is
required before proposing one.
2. Red: add correlation-before-dispatch and response/abort/cancel/fallback tests.
Include restart, late observation and historical missing-proof refusal cases.
Verification refs: settlement-regressions, historical-unknown-refusal.
3. Green: propagate original branch identity through routing and transport;
await fenced critical evidence, reusing existing snapshots and writer.
Contract refs: original-branch-binding, provider-terminal-proof.
4. Refactor shared proof validation into existing recovery predicates; wire
readback and admission to the same result. Flow refs:
dispatch-observe-reconcile-recover, historical-unknown-closeout.
5. Run affected tests and both TypeScript programs, normal canonical exact-tree
integration and independent semantic review. Requirement refs: AC-1, AC-2, AC-3,
AC-4, AC-5. Record provider-backed immutable plan coverage before implementation.

Coverage receipt: pending. No implementation admission or passing check claimed.

## Deployment, restart and rollback

Publish via protected signed PR and normal merge queue. Deploy only through
canonical request_self_upgrade. No startup backfill may infer historical proof.
Missing/new optional fields remain unknown. If database changes are required,
use reviewed additive migration compatible with old rows and forward-only
rollback semantics; no schema change is selected yet.

In-flight work must retain its original generation and observe normal upgrade
drain. Restart is neither cancellation acknowledgement nor proof of no effects.
A restarted collector may read recorded proof and append a validated observation;
it must not replay requests. Rollback disables consumption of new proof, retaining
immutable observations and held tasks. Independent served acceptance uses owned
fictional review fixtures; D62 is recovered only after actual native admission.

## Implementation bounds and observation semantics

The original TaskNode generation owns the critical ledger in outputSnapshot.
The parent TaskRun write fence serializes registration, append and sealing.
Sealing closes registration; a late fallback or duplicate acknowledgement is
refused. Recovery reads the same original node/digest/generation predicate.
Existing three-attempt review budgets and the 100-node recovery read bound stay
unchanged. Each branch ledger allows 64 events; HTTP evidence buffers at most
262144 bytes. Exceeding either bound cannot earn settlement. No full-install
scan is introduced. Evidence remains in the original TaskNode while recovery
is pending, under its existing retention/ownership lifecycle.

The first implementation recognizes a fully consumed successful Chat Completions
JSON response with a nonempty provider id and recognized finish reason. It does
not infer cancellation acknowledgement from an abort, reader cancellation,
transport closure, HTTP error, unsupported stream/protocol or idle runner.
Unsupported adapter attempts remain registered and prevent complete proof.
Provider cancellation acknowledgement remains unsupported where the provider
has no authenticated request-specific terminal cancellation contract.

A sealed provider proof can satisfy the existing node-coverage predicate, while
fresh scoped health evidence, current authority, original budget, single-flight
and writer-fence checks remain mandatory for bounded successor admission.
Historical nodes without the critical ledger remain UNKNOWN. A successful
source test or administrative task closeout never satisfies Failure Readiness.
No database migration is required; this uses versioned optional TaskNode JSON.
Canonical upgrade drains in-flight work before loading new producer code;
restart alone changes no historical proof or recovery authorization.

Recovery accepts sealed native original-node proof; a caller-authored health
boolean or settledNodeIds list cannot establish provider settlement. The fresh
health receipt still verifies scope/currency and any endpoint remediation.
This intentionally keeps legacy UNKNOWN tasks held when they lack authentic
original evidence. Adapter identity (provider/model/account mode/account/trace)
is registered before waiting for compute admission. If admission ends before
adapter execution, the same original writer records adapter-not-dispatched;
that proof is rejected if any HTTP dispatch was observed for that adapter.

Completed inconclusive checkpoints owe the same original-provider settlement as
failed or interrupted nodes before retry, successor admission or worker checkpoint
replacement. A final pass or fail checkpoint is reused without redispatch. Existing
typed, generation-bound server capacity or eligibility refusals can establish that
routing ended before dispatch; a status label or diagnostic fragment alone cannot.
A retained ledger takes precedence over compatibility evidence. A typed legacy
refusal may establish pre-dispatch settlement only when the ledger is absent;
malformed, unsealed or incomplete native observations cannot be overridden.
