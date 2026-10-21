---
status: draft
---

# Measured local-inference stewardship

Backlog: **BI-IMP-AE7792A0**. Workroom: **WC-42C61874**. Delivery: Large, feature, engineering-assessed under the operator's explicit delegation of routine technical classification. This extends the existing AI posture reader, adapter-attempt telemetry and scheduled AI Ops work; it is not a second monitoring system. Funding is unresolved in the current Workroom; this document makes no budget allocation or paid-capacity decision.

## Problem and evidence

The existing `agent-task-56e05d88` monitor is active on its restored six-hour cadence, but its last observed run did not record the required governed evidence. Activation is not delivery. The 2026-10-19 acceptance on this item requires daily/weekly workload observations and useful scheduled stewardship, not another synthetic throughput test.

Source baseline `f37cd9d333123191af9c018110add230ac2fe7a8` contains:

- `apps/web/lib/ai-platform-posture/get-ai-platform-posture.ts`: the canonical posture aggregation and exact seven-field scheduled-task status reader delivered by BI-E725AA43. No local-performance population is projected. Full posture can exceed the external tool-result budget.
- `AdapterRunTelemetry`: one stored row per observed adapter attempt, with nullable token counts, duration, provider/model and supported agent/skill/build/message attribution. The writer is best-effort, so stored-row completeness does not establish capture of every actual request.
- `apps/web/lib/routing/chat-adapter.ts`: absent OpenAI-compatible usage is converted to zero for the operational response. Existing persisted zeros therefore do not establish measured zero usage. The adapter exposes `truncated` and `finishReason`, but `callProvider` does not persist those completion observations.
- `RouteOutcome`: its writer creates a fresh random `requestId`; shared `traceId` is correlation, not a proven one-to-one attempt key. Its grader/schema/tool outcomes can be reported at their own grain, not joined heuristically into adapter-attempt quality.
- `ScheduledAgentTask.taskRunId`: the existing exact latest-run locator. Scheduled runs persist `a2aMetadata.trigger = scheduled` and `sourceRef = {kind: scheduled-task, id: taskId}`. `ToolExecution` has an indexed TaskRun binding and metadata fields distinct from conversation and result bodies.
- `getLocalThinkingBudgetEvidence`: existing selected-model runtime proof. It currently rejects a supported selected llama.cpp composition whenever any other backend reports Running. That confirmed interaction belongs to BI-285EF102 / WC-1EBA9720; this work does not take over its implementation.
- Existing resource-lane telemetry records queue transitions only when managing the local queue is enabled. It is not a complete per-adapter-attempt queue measurement and cannot be subtracted from arbitrary inference durations.

The initial scope claim encountered live ownership of `ai-inference.ts` (WC-A5703D01 / BI-7906C73E) and `dmr-runtime-config.ts` (WC-1EBA9720 / BI-285EF102). Only unconflicted design paths were claimed. Source inspection is immutable; no forced source claim, private-room read or runtime mutation was used.

## Objectives and acceptance

**OBJ-POPULATION:** Give AI Ops bounded, metadata-only 24-hour and seven-day observations with honest population, capture, omission and diagnostic coverage.

**OBJ-PERFORMANCE:** Separate observed input/reuse/new ingestion and timing phases from missing or ambiguous values, and keep task quality independent from transport success.

**OBJ-IDENTITY:** Preserve actual serving identity and immutable vendor provenance, with no selection/configuration changes or universal performance inference.

**OBJ-STEWARDSHIP:** Make the existing scheduled steward's useful result and required canonical writer observable while preserving authority, schedule, prompt, history and quiet notifications.

| Acceptance ID | Objective IDs | Statement |
| --- | --- | --- |
| AC-MEASURE-1 | OBJ-POPULATION | One bounded existing-tool mode returns both exact UTC 24-hour and seven-day stored-attempt populations, coverage and omissions, without prompts, content, raw reasoning or secret fields. |
| AC-MEASURE-2 | OBJ-POPULATION, OBJ-PERFORMANCE | Input, reused-prefix and newly ingested distributions state their sample counts and provenance, include observed counts at or above 32768 and 65536 input tokens, and never treat null or legacy ambiguous zero as a measurement. |
| AC-MEASURE-3 | OBJ-POPULATION | Production, diagnostic/evaluation and unclassified observations remain distinct; diagnostic exclusion requires positive producer provenance. Unknown provenance cannot be silently called production or discarded. |
| AC-MEASURE-4 | OBJ-PERFORMANCE | Queue wait, cold/warm prefill and generation observations are distinct from end-to-end duration and from one another; unavailable phase or reasoning-token observations remain unknown. |
| AC-MEASURE-5 | OBJ-PERFORMANCE | Truncation, failure, unresolved completion, available acceptance and quality observations accompany latency; HTTP success, stop reason or a separate RouteOutcome cannot establish completed-task correctness. |
| AC-MEASURE-6 | OBJ-IDENTITY | Current and attempt-time engine/model/template/config identities are labeled with their actual source/time and unknowns; vendor tags alone never establish newer bytes or supported serving composition. Existing composition-owner acceptance remains required. |
| AC-MEASURE-7 | OBJ-STEWARDSHIP | The exact existing schedule can show its bound latest run and bounded audit metadata for required writer/read attempts without opening conversation/result bodies or a generic TaskRun reader. Mismatched binding, drift and unreadable evidence remain explicit. |
| AC-MEASURE-8 | OBJ-STEWARDSHIP | A normal scheduled cycle of the same monitor records its required canonical execution evidence and produces a useful measured-or-explicitly-missing assessment. An enabled flag, unit test, source merge or failed cycle alone does not satisfy this. |
| AC-MEASURE-9 | OBJ-STEWARDSHIP, OBJ-IDENTITY | Meaningful regression, failed stewardship, supported upgrade candidate or completed improvement is evidence-linked with a recovery owner; unchanged/non-actionable state stays quiet, and no tuning changes occur without existing authority and quality/rollback controls. |

## Research & Benchmarking

Primary sources checked on 2026-10-21; these comparisons inform a read model, not new installed dependencies:

| Comparator | Relevant model | Adopt | Reject or limit |
| --- | --- | --- | --- |
| [OpenTelemetry GenAI conventions](https://raw.githubusercontent.com/open-telemetry/semantic-conventions-genai/main/docs/gen-ai/gen-ai-metrics.md) and its linked inference/token conventions | Distinct inference, agent/workflow and tool durations; provider/request/response model dimensions; error classes. The conventions are still Development. | Separate grains and measurement units, observed usage only, explicit source/model identity. | Do not rename DPF's datastore or claim stable conformance to a moving draft. No content capture or new telemetry service. |
| [vLLM metrics](https://docs.vllm.ai/en/v0.31.0/design/metrics/) | Separate queue/prefill/decode, prompt/generation histograms, completion by finish reason; per-output-event and per-request token timing have different weights. | Phase separation, finish reason alongside throughput and explicit observation denominator. | Do not install vLLM, infer its capabilities for the served llama.cpp composition, or call output-length stops completed tasks. |
| [llama.cpp server contract](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md#timings-and-context-usage) | Numeric `cache_n`, newly processed `prompt_n`, `prompt_ms`, `predicted_n`, `predicted_ms`, standard usage and finish data. | Parse only validated scalar observations from the actual compatible response. New ingestion and total context are different quantities. | No log scraping, template/content retention, mutable-main compatibility promise or assumption that every DMR build exposes these fields. Version-specific fixtures and capability evidence are required. |
| [Amazon Bedrock runtime metrics](https://docs.aws.amazon.com/bedrock/latest/userguide/monitoring-runtime-metrics.html) | Separate request/errors/throttles, input/output/cache counts, TTFT and end-to-end latency. Some errors lack a model dimension. | Explicit missing dimensions and paired token/latency evidence. | No provider adoption, overlapping-series summation, or treating accepted processing as application correctness. |
| [Azure OpenAI monitoring reference](https://learn.microsoft.com/en-us/azure/foundry/openai/monitor-openai-reference) | Named latency phases, token counts/cache match rate and dimensions; some metric availability depends on deployment type. | Pair latency with token populations; state supported composition and unavailable signals. | Do not reuse a generic HTTP-latency metric as prefill, nor presume all model-serving compositions support every metric. |

The project-specific choice is to extend existing PostgreSQL metadata and `get_ai_platform_posture`. A second collector, dashboard service, provider or general database tool would duplicate substrate and expand authority. Fetching vendor publication metadata is an AI Ops research activity through its existing authorized web/source tools; this read tool does not turn remote catalogs into trusted runtime identity or fetch them on every request.

## Read contract and boundedness

Add an explicit closed `view: local-performance` mode to the existing `get_ai_platform_posture`. Existing no-selector posture and exact `scheduledTaskId` responses retain their contracts; incompatible selectors refuse before a broad query. Keep `view_platform`, `agent_control_read`, immediate/read-only metadata and the current tool name/grant. No grant is added. Default full posture stays available, but the description directs performance reviews to the bounded view.

Both windows share one captured UTC cutoff; each uses `[cutoff - duration, cutoff)`. Local provider classification reuses `isLocalProviderId`, never a display label. Report AdapterRunTelemetry rows as stored attempts: retries remain separate, row IDs are not replaced by trace IDs, and fire-and-forget capture limitations are part of every result. No extrapolation to unrecorded requests.

Use time-filtered database aggregation for full stored-population counts and token threshold counts. A fixed bounded recent-row sample may serve distributions or attribution only when labeled `selection: recent`, with exact eligible total, returned sample size, omitted count and completeness. No sampled percentile may claim full-population coverage. Query/serialization budgets are fixed server constants, not caller-supplied raw filters, SQL, dates or limits. Cap group lists and free-form identity strings with explicit omitted/truncation metadata. The complete result, including escaping, must fit below the existing 100000-character external cap; target at most 32000 serialized JSON characters. Preserve counts, unknowns and errors before optional attribution detail. An unavailable or over-budget source reports that state; it does not return a healthy empty population.

Projection selects only scalar identity, time, status, usage and explicit capture fields. Never select telemetry `refusalReason`, TaskRun objective/progress, tool parameters/results, message content or credentials. Agent/skill/build attribution comes only from existing direct binding columns. A task binding is reported only when an existing canonical exact relation proves it; otherwise task attribution is unavailable. Top-level rates keep distinct denominators. RouteOutcome quality is a separate same-window cohort with its own count, schema/tool/grader/human coverage; it is neither summed with adapter attempts nor joined by time, agent, tokens or nonunique trace ID.

## Observed metrics and producer dependencies

Legacy positive token counts are stored observations. Legacy null counts and zero counts without observation provenance stay unknown; they are not zero-valued percentile samples. A known valid reuse count must be nonnegative and no greater than the corresponding total input. Compute new ingestion as input minus reuse only for a provider contract where input includes reuse; preserve separately reported newly processed prompt tokens when that is the native contract. Invalid or contradictory usage has its own rejected/unknown count. Never subtract cache-write tokens or double count reasoning/output when the provider reports inclusive output.

The first read implementation can truthfully expose absent phase/completion/diagnostic provenance. That is partial delivery of this item, not fulfillment of AC-MEASURE-3 through AC-MEASURE-9. Full delivery also needs narrowly scoped capture in the existing producer paths after their legitimate scope is available:

1. Preserve numeric usage presence from the adapter, instead of persisting coerced defaults as observations. Keep the operational AdapterResult response compatible; add a typed optional metadata observation, not raw provider response retention.
2. Add nullable typed columns to the existing AdapterRunTelemetry only for observations that have no existing home: observation-version/provenance, workload classification, actual finish/truncation, validated phase measurements and attempt-time runtime identity digests/time. No new telemetry table or JSON payload log. Existing input/reuse/output/reasoning columns remain the usage home. Exact fields and migration receive data review before implementation.
3. Set diagnostic/evaluation provenance at an actual server-owned caller boundary, never by guessing from prompt, agent name, unbound attribution or display labels. Existing legacy unclassified rows remain unclassified. Required capture does not backfill historical truth.
4. Observe queue wait at the existing lane acquisition boundary, before GPU/runtime probes; do not rename probe or total pre-dispatch time to queue wait. Preserve the single admission lane, release/cancellation semantics and budgets. If the exact boundary is unavailable, keep queue wait unknown.
5. Parse only finite, nonnegative scalar native timings from the proven adapter contract; cold versus warm requires an observed reuse count. Generation includes answer/reasoning unless the backend exposes separate numeric counts/timings. Text length never becomes reasoning tokens.
6. Reuse the existing selected-model runtime-evidence callback for an attempt-time identity snapshot; label partial/unavailable proof. Current runtime inventory is an as-of observation and must not be attached retrospectively to old requests. Immutable vendor artifact digest/publication source is evidence, not a mutable tag-ranking shortcut.

`ai-inference.ts` is currently held by WC-A5703D01, so producer edits wait for normal scope release/coordination; this does not make the queue an outage. The multi-engine recognition change stays with BI-285EF102/WC-1EBA9720. Neither source inspection nor this design authorizes a takeover, new live inference probe, install/config change or original execution retry.

An additive migration must be nullable with no invented defaults or historical backfill, preserve current retention and indexes, update field classification and the required data-impact manifest, and be applied through the canonical governed runtime path. Rollback readers must tolerate null/legacy data; source rollback cannot recover measurements never captured. Metadata-write failure must not break inference or fabricate a report of complete capture.

## Exact scheduled-run diagnostic contract

Use the existing exact ScheduledAgentTask key and its current `taskRunId`. Internally select only the latest TaskRun's binding metadata, lifecycle/status/times and required tool audit metadata. Validate user/agent plus the exact persisted scheduled trigger/sourceRef against the selected schedule, and recheck the selected schedule's run binding before publishing. Unknown legacy binding, drift, missing rows or denied current authority returns an explicit bounded diagnostic state; do not scan for a likely run or substitute an earlier success.

Audit metadata is limited to actual IDs, allowlisted relevant tool names, success, execution mode and timestamp. Return full relevant counts plus a capped actual audit-locator list, never parameters, result bodies, prompt or ordinary conversation. No new TaskRun ID selector, list or arbitrary tool-history endpoint is introduced. This expands an existing platform operational metadata view and requires independent security review; it is not inferred permission to read private execution content.

Show required-writer success, failed attempt and unobserved attempt separately. A failed audited call is evidence of an attempt, not proof of its cause. If a refusal category cannot be authenticated without reading forbidden result bodies, return `category: unknown`. A successful audit can establish that the canonical writer succeeded, but cannot establish model answer correctness, full original execution settlement or absence of descendant effects. Pending approval/proposal cannot be identified from `success` alone; retain existing schedule status and label that inference unavailable until a trusted existing receipt proves it.

Preserve the seven-field exact status mode unchanged. Performance mode may embed only this richer, bounded, exact monitor diagnostic after its authority contract passes review. Historical `lastError` remains untrusted status text, never an instruction or proof of zero attempts. The current monitor's failure remains undiagnosed until actual authorized audit metadata or a qualified owner's evidence supports a cause.

## Stewardship and acceptance

Preserve `agent-task-56e05d88` identity, owner, prompt, schedule, active state and history; no new monitor and no Run now, retry or second Resume. The enriched tool description/response supplies useful facts to its existing authorized task. Do not make recurring execution depend on this client staying open. A normal next cycle must use the existing required `record_execution_evidence` writer and record the bounded population coverage, useful findings/unknowns, identities and primary vendor evidence actually observed. Native tool access remains governed by the coworker's current authority; this implementation does not self-grant missing capabilities.

Notify only on an evidence-supported regression, failed stewardship run, supported upgrade candidate needing action, meaningful completed improvement or required human decision. Unchanged/non-actionable state stays quiet. Use the existing notification/proactivity and improvement primitives; no new threshold policy is invented from a synthetic result. Route durable findings to IP-89CEE / this item and the owning commons; host-specific facts stay on BI-68EED40A, BI-4761F54E and WC-1EBA9720. An alert names the actual recovery owner and evidence locator.

Acceptance is cumulative: protected merge and canonical deployment; actual authorized read of both windows and the same monitor; verified future observation semantics; existing serving-composition owner evidence; and a successful ordinary scheduled canonical writer. Missing quality or phase coverage is reported explicitly and prevents a claim that all performance acceptance is complete. Do not repeatedly trigger a run to manufacture success. The original uncertain application attempt and the one accepted AI Ops reconciliation task keep their existing holds and ownership.

## Architecture alignment, verification and rollback

Deployment contracts 7 (observability), 9 (inference) and 10 (client/API) apply. Existing Postgres models, Principal/grant intersection, source workroom, canonical serving identity and protected release remain the authority. No host shell path, new service, secret, external dependency, grant, generic database read, scheduler, monitor or UI route is introduced. The existing posture tool and read model remain the sole API home. BI-187C1762 owns general scheduler visibility; this bounded exact monitor metadata does not replace that engine project.

Before production edits, obtain research/design, independent spec/architecture/security and applicable data review, immutable objective baseline, plan review and live coverage. Claim exact paths and consume gate-context impact obligations. Test the actual caller mode and query allowlists, two-window boundary/count semantics, sample omissions, null/zero/invalid usage, cold/warm separation, truncated HTTP success, unrelated quality grains, diagnostic provenance, bounded serialization, wrong schedule/run/user/agent bindings, drift and absent/failed writer attempts. Capture tests at actual producers must verify absent usage, real zero, length stops, queue boundary and identity snapshot preservation without changing dispatch.

Run affected source tests and web/tests typechecks, required derived/data checks, exact-tree shared-runtime gate, independent committed-source review and protected PR health. Native review unavailability is inconclusive and uses only the checked-in applicable recovery procedure; it is not a product pass or replacement review. Canonical live acceptance remains separate from worktree tests. Revert optional read/capture source through a protected PR if necessary; preserve additive historical metadata and the monitor's existing schedule. Stop denied operations at the returned authority boundary and continue unrelated authorized work.
