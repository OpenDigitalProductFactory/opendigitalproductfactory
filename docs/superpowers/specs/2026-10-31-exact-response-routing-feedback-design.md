---
status: draft
---

# Exact-response routing feedback

**Backlog:** BI-A009189A; EP-6D558A14. **Parent contract:** [CLI routing §4.3](./2026-04-29-cli-execution-adapter-routing-design.md#43-adapterruntelemetry-table-new).

This is the canonical feedback extension referenced by the parent routing design. It extracts former §4.3.1 without changing its feedback contract so native independent review can consume an artifact within its 64,000-character limit. The parent retains the adapter architecture.

Original review task `8A3597A756B6` remains **UNKNOWN**. This extraction does not settle, replay or convert that task into an approval. Current independent review and acceptance must be earned for the exact new artifact through the server-issued route.

**Status:** proposed extension; capture is not implemented or accepted by this document. BI-A009189A owns delivery under EP-6D558A14. BI-B93E9C6E separately owns Build Studio quality-ledger attribution. The routing consolidation BI-2BBD9D34 exposes unavailable evidence honestly; it does not deliver this feedback loop.

This contract defines the explicit `userAccepted` disposition on the exact producing attempt and supersedes the parent’s earlier inferred-acceptance wording.

The unit being judged is one saved answer and the exact successful attempt that produced it. An operator may mark it **Kept** or **Needs revision**, change that choice, or clear it. These are explicit dispositions. A retry, elapsed time, gratitude or successful HTTP response does not establish either disposition or correctness. Saving feedback does not run another model, update routing weights, change a provider assignment, or confirm an override.

## Feedback delivery objectives and acceptance

The following scope applies to the BI-A009189A extension only; historical adapter-delivery phases in the parent design retain their own owners and evidence.

**OBJ-RF-1:** Attribute each explicit disposition to the exact saved answer and successful producing attempt, with current authority and auditable corrections.

**OBJ-RF-2:** Make feedback easy to record and useful in routing evaluation while keeping human preference, agent judgment, execution success, evaluated quality and costs distinguishable.

| Acceptance ID | Objective IDs | Statement |
| --- | --- | --- |
| AC-1 | OBJ-RF-1 | Define the evaluated unit and explicit operator action before writing: a response-producing attempt, not every route in a shared message or fallback chain. |
| AC-2 | OBJ-RF-1 | Resolve exact attempt identity server-side and recheck current thread/room ownership and provider/model/trace association. Read-only platform access alone is not feedback-write authority. |
| AC-3 | OBJ-RF-1 | Record attributable feedback and time through the existing governed/audited path; allow correction according to the chosen design. Preserve missing/ambiguous/historical evidence as unavailable. |
| AC-4 | OBJ-RF-2 | Show feedback coverage separately from execution success, evaluator scores, diagnostics/test results and costs. Do not infer a model score from gratitude, elapsed time, today's provider profile or one shared trace. |
| AC-5 | OBJ-RF-1 | Saving feedback must not dispatch inference, update learned routing behavior or confirm an override. |
| AC-6 | OBJ-RF-1, OBJ-RF-2 | Verify ownership/permission removal, repeated attempts/fallbacks, duplicate/corrected submissions, source attribution, and the actual compact keyboard-accessible UX. |

## Research & Benchmarking

The existing source was audited at commit 4177c09734178904c79c402a3b210ba67d850df3. AdapterRunTelemetry has an id primary key and userAccepted/acceptedAt; it has no attemptId column. AgentMessage has no generic metadata slot. The writer intentionally suppresses telemetry failures, while fallback and agentic results manually copy response fields. A recovered earlier draft or an inline-review rewrite can otherwise inherit the wrong last-call identity.

| Comparator | Pattern adopted | Boundary retained in DPF |
| --- | --- | --- |
| [Langfuse open data model](https://langfuse.com/docs/evaluation/scores/data-model) and [updates](https://langfuse.com/faq/all/tracing-data-updates) | Bind feedback to a specific observation; distinguish annotation/API/evaluation source. | Updating a score is not an immutable correction history. DPF authenticates the writer and audits changes transactionally. |
| [Helicone request feedback](https://docs.helicone.ai/features/advanced-usage/feedback) and [evaluation scores](https://docs.helicone.ai/features/advanced-usage/scores) | Preallocate a request identity, carry it with the response, and separate boolean feedback from evaluations. | A request-id/rating payload alone does not establish current DPF thread or Workroom authority. |
| [Braintrust open SDK](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/logger.ts) | Target an exact event row; keep score, corrected expected answer and feedback source distinct. | Actor metadata supplied by a client is not authenticated provenance. No SDK or service is added. |
| [Langfuse Cloud feedback](https://langfuse.com/docs/observability/features/user-feedback) | A small response-level control with optional deeper annotation; retries are ambiguous implicit signals. | Do not convert retry into an automatic negative score or add a mandatory form. |
| [LangSmith feedback UX](https://docs.langchain.com/langsmith/agent-server-feedback) and [data format](https://docs.langchain.com/langsmith/feedback-data-format) | Stable response/run identity, saved/error acknowledgement, distinct score and corrected ground truth. | DPF keeps its own authorization and audit; feedback update/delete APIs are not evidence of immutable history. |
| [Braintrust human review](https://www.braintrust.dev/articles/human-in-the-loop-evals-for-llm-apps) | Inspect the relevant trace, then drill into a specific output. | A full evaluation rubric stays outside the compact disposition control. |

[Microsoft HAX guideline 15](https://www.microsoft.com/en-us/haxtoolkit/guideline/encourage-granular-feedback/) supports granular feedback on individual outputs. [WCAG 2.2 status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html) supplies the save/error announcement requirement. These are design inputs, not DPF usability or independent-review results.

## Architecture decision and configuration boundary

Two viable provenance options were compared. **A, selected:** allocate the existing telemetry primary ID inside each server callProvider invocation, preserve the nonblocking writer and carry the successful producer through the result chain into a dedicated nullable AgentMessage scalar. **B:** await telemetry creation, then use a nullable FK. B still requires all result propagation and adds DB latency, failure ordering and retention-deletion behavior. A keeps delivery independent of telemetry availability; strict eligibility checks compensate for its deliberately soft telemetry reference.

Kernel advisory DI-EEB57FD9D9D4 recommended A (7.9935 versus 7.4361) using explicitly author-estimated feature vectors; these are not measured performance or implementation admission. Earlier DI-0735E46708DF had no feature vectors and was unusable, not a tie. A craft consultation DI-E6B510F9AD67 resolved the bound software-engineer profile instead of a declared UX borrow and escalated at confidence 0.35. It is not a UX Critic approval; the original separately attributed Critic assessment remains owed through its existing repair owner.

Configuration cannot create the missing producer binding, transactional writer or identity checks. Those invariants require code and an additive schema migration through the normal release. Existing configuration continues to own provider/model assignments and routing policy. This is a worked example for BI-4538254D's future architect-WSID guidance, not implementation of that corpus item or a new hot configuration language.

## Producer binding and eligibility

- Reuse AdapterRunTelemetry.id, preallocated once for each actual callProvider attempt. Success and error telemetry for that invocation use that ID. Never allocate a second identity because telemetry persistence failed.
- Extend the real InferenceResult → FallbackResult → RoutedInferenceResult → AgenticResult chain. The selected successful response carries its own producer; no latest-row, timestamp, current provider profile or shared-trace heuristic is allowed.
- Add dedicated nullable producer identity and saved-content digest fields to AgentMessage. The digest is of the persisted answer bytes and detects later content edits; it is not rawEventDigest. Do not put producer identity in contextTrace or invent an existing metadata field. No immediate telemetry FK may make asynchronous telemetry persistence or 180-day deletion a prerequisite for saving a reply. Persist the server-resolved Workroom scope alongside the binding: a typed known-unroomed/workroom state and a nullable link to the existing canonical Workroom. A null TaskRun is not proof of unroomed scope; unknown or ambiguous scope remains ineligible.
- Preserve recovered draft content and its producer together. An inline-review rewrite is ineligible unless the rewriting producer is explicitly propagated. Clearing eligibility for an unbound rewrite is preferable to crediting the earlier model. Synthetic approval, failure, exhaustion, operational messages and empty async-start admissions have no eligible producer.
- Resolve the exact durable attempt on read and again inside the write transaction. Require the stored producer binding, unchanged saved-content digest, saved assistant message, matching thread/message/provider/model association, successful completion, and a supported visible primary execution mode. Shadow alternatives, race losers, unresolved winners and ambiguous or missing associations are ineligible.
- Missing legacy binding, delayed or failed telemetry, expired rows or digest mismatch produce an honest unavailable state. They never block the answer, retry inference, infer a zero rating, or attach feedback to another attempt. Existing past data is not backfilled from today's owner or latest call.

## One governed writer and current provenance

Extend the existing telemetry row; do not create a second feedback or quality-score store. Keep userAccepted as the current disposition and acceptedAt as the time of a non-null current choice, including a negative choice. Add a nullable canonical Principal relation, a nullable typed source distinguishing human and agent judgments, and an integer feedback revision for compare-and-set writes. Legacy state retains unknown actor/source. Clearing sets the current value/time null and increments the revision; the audit preserves the clearing actor and prior state.

A browser action, a bounded MCP action and the authorized-surface action call the same server domain operation. Tool discovery found no existing exact-attempt action: submit_feedback is employee feedback and report_quality_issue files platform issues. Reuse thread_write rather than read/admin grants. Register the shared action/read contract through the existing governed-surface registry; surface_act is transport, not a second writer.

The server derives identity and source from authentication, canonical Principal aliases and the actual acting agent. Never accept actor, source, provider, model or Workroom authority from the request. Automation and AI-assisted submissions remain agent-attributed; they do not become human calibration because they use a person's browser or token. Agent feedback may update/clear only its own current agent judgment and cannot replace a human judgment. An authorized human may replace or clear the current judgment; the audit retains the previous actor and source.

Use Serializable isolation for the domain transaction, including saved message/binding/content, attempt feedback and all current authority reads. A serialization conflict returns a bounded retry/conflict result; re-read current state and revalidate on retry rather than replaying stale authority. This prevents a concurrent message edit or membership/ownership change between the digest/authority check and commit. Within that transaction:

1. Resolve the saved message and exact producer, then recheck the current authenticated thread owner. A shared strict helper must fail closed; do not copy the optional-delegate feedback-support helper.
2. Resolve room scope from the persisted server-authored response binding. Verify any task/thread linkage agrees; resolve semantic TaskRun identity to its database identity before room lookup. Missing scope is unavailable, not unroomed. Reuse canonical human/agent Workroom access with requested action, current participation, role, restrictions and clearance. Content visibility alone never grants action authority.
3. Validate eligibility and actor/source rules. Require the expected feedback revision; a stale correction returns conflict and current safe state. Identical current state may be a no-op only after authorization and provenance validation. A retry after an unknown write outcome first reads the current state.
4. Update only the exact telemetry row and append an attributable AdminActivity using the same transaction. Include attempt/message/thread identity, actor Principal and acting agent, prior/new disposition and source, revision, timestamp and calling surface. Do not copy prompt/answer content or raw provider failure text into audit parameters. Audit failure rolls back the disposition; best-effort global governed invocation logging alone is insufficient.

Any authorization removal, relationship change, missing actor or missing room admission denies the write without inference or provider-policy changes. The audit has its existing retention/lifecycle contract; telemetry expiry does not fabricate a still-actionable response rating.

## Compact UX and reporting

Show Kept / Needs revision beside an eligible saved response, with a visible selected state, saving/saved/error status and a correction/clear affordance. Use real buttons, pressed state, existing theme tokens and at least 44×44 targets. Announce status without moving focus. No confirmation popup or mandatory text form is needed for this reversible action. Raw IDs, provider details and correction history belong in the existing inspector disclosure. An unavailable control explains the bounded missing evidence; it does not invite the operator to guess a provider or choose a fallback row.

The routing evaluation summary reports a bounded cohort with explicit counts for eligible responses, human feedback, agent feedback and missing/unattributed evidence. It retains existing success/known/unknown execution counts, measured cost denominators and quality availability. Update every boolean consumer, including routing-management-projection and Golden Triangle receipts, so agent or legacy-unattributed feedback cannot become human calibration. Kept share has a labeled human-feedback denominator; it is not a correctness or quality score. Queries are indexed and paginated or bounded with explicit window/coverage; never scan every message or load the whole provider catalog per action. EP-6D558A14 owns later broader evidence/ranking work.

## Verification and release obligations

Acceptance is the BI-A009189A Acceptance section. Meaningful tests cover retry/fallback winner; multiple same-message attempts with misleading timestamps; recovered draft identity; unchanged versus rewritten review; synthetic and async-start exclusion; delayed/failed telemetry without lost answer or extra inference; wrong thread/message/provider/model/mode; expired and legacy rows; ownership/room/grant removal; AI versus human provenance; corrections/clears/concurrent revisions; atomic audit failure; concurrent message edit or authority removal; and unchanged routing weights/provider assignments.

Verify the actual compact response control and routing disclosure in the served containing image at 320/390/1280 widths, both themes, keyboard-only save/correct/clear, status announcement, reload and navigation. Source tests, the exact-tree shared gate and protected PR checks precede governed deployment. The new nullable fields and revision default preserve old rows; migration rollback must not discard captured audit history. A fresh served preflight, real UX Critic disposition and independent acceptance remain separate evidence. No historical routing gate or original prototype critique qualifies this new change.

## Reviewable prototype

[Interactive feedback prototype](../../ux-fit/2026-10-31-routing-feedback-prototype.html) is DEMO-only. The relative link refers to the prototype in the current source revision. Its first draft was present at source `92ac47ccb093d30f9c42e5a86dd233ac1a3426f7`; 43 author-side isolated state assertions passed against that first draft. Those results are historical, not evidence that subsequent prototype corrections have been verified. Check corrections against their actual revision rather than carrying forward the first draft’s blob or hash.

Chrome’s file-URL policy rejected browser preview and prohibited workarounds. Visual, layout, real keyboard focus, hitbox and accessibility checks remain unrun. New feedback advisory engagement `CE-930C0CB0` is separate from original `CE-1FE20783`; this artifact records no actual result for the new engagement. UI comparative decision `DI-617D89B8C594` prefers contextual controls to a separate form; its estimates are not measured usability.
