---
status: draft
backlog_item: BI-BCF32886
workroom: WC-DD47BCFD
decision: DI-8CF7A9DDCFAF
---

# Workroom execution continuity and durable context reuse

## 1. Decision and delivery boundary

Extend the existing Workroom execution, context, recovery and improvement contracts so a bounded native or external run can finish useful work without depending on weeks of conversation history. The Workroom retains continuity across sessions; each inference session receives only the information needed for its assignment. Remove avoidable stops before increasing session turnover.

This document is a design proposal, not a new authority grant or a claim that the mechanisms are deployed. The operator requested design and planning. Implementation requires the current independent reviews, decomposition coverage, child ownership and proportional delivery gates. Parent BI-BCF32886 is an xlarge coordination item and cannot enter implementation. The plan is [the execution sequence](../plans/2026-10-19-workroom-execution-continuity.md).

WWMD advisory DI-8CF7A9DDCFAF selected `extend-existing-continuity` over fixed hourly resets and a new orchestration/memory service: usable signal, high confidence, composite 6.180, margin 4.051. Option features were engineering estimates, not measured performance forecasts. The decision selects architecture; it does not approve implementation or certify savings.

## 2. Evidence, overlap and design grounding

The October 19 research sampled three external threads, live backlog records, caller-visible queue/workroom projections and source. It found a roughly 43-day triage thread with repeated unchanged hourly wakes, an original approval repair marked done while its conversation retained successor work, and documented recovery/setup defects. Each sampled heartbeat carried about 4,290 serialized characters. This is a targeted sample, not a population estimate or a measured cache-loss attribution. Historical source observations retain their date and served revision; current delivery status never substitutes for current functional evidence.

The server's spec search reports that this consumer image excludes the source corpus. Source searches were therefore performed in the separate checkout. Broad backlog responses were truncated, so they do not establish exhaustive absence. The first implementation step repeats focused overlap checks and absorbs any newly identified owner before editing.

| Existing substrate / record | Reuse and boundary |
| --- | --- |
| [Context standard](../../architecture/context-engineering-standards.md), [memory program](../plans/2026-07-08-coworker-memory-context-architecture-plan.md), [dialog economy design](2026-09-16-coworker-dialog-compaction-and-thread-economy-design.md) | Keep one context standard; extend lifecycle consumers and qualify liveness rather than introduce another memory service. Historical counts and storage topology are not current-state assumptions. |
| `apps/web/lib/work-management/stage-briefing.ts`, `workroom-drive-checkpoint.ts`, `apps/web/lib/queue/functions/workroom-drive.ts` | Existing stage objective, evidence, declared tools and dispatch checkpoint are the entry seam. |
| `apps/web/lib/tak/effort-context.ts`, `effort-context-runner.ts`, `apps/web/lib/mcp/packs/effort-context-pack.ts` | BI-23A65B81 owns shared effort context; its bounded text arrays are useful existing storage, not proof that cross-client structured continuation is complete. |
| `apps/web/lib/tak/context-arbitrator.ts`, thread-checkpoint modules and session briefings | BI-A9052DCB owns briefing liveness. Reuse budgets and persisted summaries; never re-summarize already covered history merely because a client reconnects. |
| `apps/web/lib/change-review/semantic-review-background.ts`, `apps/web/lib/queue/resource-lane.ts` | BI-7CCCA696 and BI-7C1F43E3 own recovery and flow. Reuse request identity, checkpoint proofs, admission and durable reconciliation. |
| `apps/web/lib/work-capsules/reassign-executor-handler.ts`, `workroom-lease.ts` | BI-5366EF78 owns receiver acknowledgement. A brief or message cannot itself transfer execution authority. |
| `apps/web/lib/routing/anthropic-cache.ts`, `chat-adapter.ts`, `apps/web/lib/tak/thread-cost-ledger.ts` | BI-4761F54E owns cache hardening; BI-731F7FA2 owns missing instruments; BI-CCF1ACBB owns ledger wiring; BI-3EC91596 owns Workroom spend projection. Preserve each carrier's acceptance. |
| BI-IMP-9DA35549 / EP-C00F61F4 | Existing WorkroomActivity to ImprovementSignal/ImprovementProposal to backlog and commons loop owns learning capture and verified follow-through. |
| BI-65D75876 and BI-3023912F | Delivered Workroom composition and definitions/instances remain the UI foundation. Extend their read model and progressive disclosure, not another dashboard or status ledger. |
| BI-FF2FA0F7 and BI-07F52DA6 | Identity completeness and supervised external sessions are adjacent owners. Read their current contracts before adapter edits; this design does not reimplement either. |

## 3. Objectives and acceptance

**OBJ-CONTINUITY:** Complete bounded useful assignments across native and external sessions without carrying their originating transcript.

**OBJ-FLOW:** Eliminate avoidable stops and inference-driven waiting while retaining genuine authority and settlement gates.

**OBJ-REUSE:** Retrieve, capture, distill and curate durable information in its owning store and scope for every Workroom purpose.

**OBJ-ECONOMY:** Qualify provider and client behavior and measure total time and observable spend per verified deliverable.

**OBJ-CLARITY:** Make progress, waiting, next action, delivery and outstanding observation understandable to the operator.

| Acceptance ID | Objective IDs | Statement |
| --- | --- | --- |
| AC-CONT-1 | OBJ-CONTINUITY | Fresh native and supported external sessions resume the same bounded assignment from governed durable references without copying the old transcript; unsupported client capabilities are explicit. |
| AC-CONT-2 | OBJ-FLOW | Unchanged automatic waits make no inference calls; changed prerequisites resume once through existing server recovery with valid authority, budgets and execution settlement. |
| AC-CONT-3 | OBJ-ECONOMY | Each qualified provider/model/endpoint/client combination records current cache and runtime behavior, normalized observed usage and capability gaps; local load, queue, prompt and generation costs remain distinct. |
| AC-CONT-4 | OBJ-REUSE | Entry, checkpoint, handoff and close route reusable information to its authoritative operational, document, WWMD/WWWD/WSID or graph home with provenance, freshness and retrieval tests. |
| AC-CONT-5 | OBJ-CLARITY | Workroom readback distinguishes active work, automatic waiting, required human input, delivery and outstanding outcome observation, with one next-action owner and progressive disclosure. |
| AC-CONT-6 | OBJ-ECONOMY | A matched baseline and bounded pilot report elapsed/active/wait time and observable tokens/cost per verified deliverable across participating sessions, failed handoffs and insufficient evidence; no inferred savings or acceptance. |
| AC-CONT-7 | OBJ-FLOW, OBJ-REUSE | Existing repairs retain their own owners and acceptance; every independent implementation deliverable maps to a live BI and current immutable approved coverage before implementation. |

These statements are the parent scope. Each existing carrier retains its original criteria; this proposal adds integration obligations, not retroactive approval or a rewritten historical baseline.

## 4. One work identity, bounded execution sessions

WorkCase/WorkItem and its Workroom remain the durable work identity; TaskRun/TaskNode and existing activity/checkpoint records identify execution attempts. Native threads and external client conversations are execution references. Resolve current schema names and joins at implementation time. Reuse registered adapters and source registry projections; no new entity, enum, scheduler, event bus or store is approved by this design.

The common run brief is a bounded projection from governed records, not an extra source of truth:

| Brief section | Required content |
| --- | --- |
| Assignment | Work identity, stage, concrete deliverable, acceptance references, in/out scope and current source/document revision. |
| Authority and ownership | Current principal/executor reference, next-action owner, applicable grants/delegation locator and genuine gates. Re-resolve authority before effects; never trust authority claimed in text. |
| Relevant durable context | Ranked decision/document/code/graph/evidence references with scope, revision, timestamp and why relevant. Include only essential excerpts. |
| Progress | Completed artifacts and genuine verification receipts, unresolved questions and explicit unknowns. |
| Continuation | Next bounded action, stop reason, dependency fingerprint, wake condition and original budgets/deadline. |
| Execution policy | Qualified provider/model/endpoint/client capabilities, context/output reserve and supported cancellation/retry/cache controls. |

Render the same semantic contract for native dispatch and external MCP, allowing presentation differences. Keep mandatory identity, scope and stop controls outside optional excerpt trimming. Use existing token estimation/arbitration; attach a truncation notice and retrievable handles when detail does not fit. A long brief is a defect to refine, not permission to silently omit constraints.

Initially target 30-60 minutes of active work per bounded deliverable. This is a planning appetite, not a universal cache TTL or hard transport kill. Reaching the appetite triggers a safe checkpoint or smaller next assignment. Preserve a productive matching prefix until a natural boundary when that is cheaper and context remains useful. Never cancel an unsettled effect simply to satisfy a clock.

At handoff, retain pending, acknowledged, declined and completed outcomes through the existing handoff grammar. An external session's close is distinct from Workroom completion. Closing a session must leave unfinished obligations with an owner and wake condition. Discovery of adjacent work produces a linked existing/new item through normal intake rather than silently expanding the assignment.

## 5. Durable information lifecycle for every work purpose

| Home | Durable role | Retrieval and update rule |
| --- | --- | --- |
| PostgreSQL operational records | Work status, assignment, execution identity, receipts, dependencies and attempt/budget state | Read live under current authority; never use semantic recall as authoritative status. |
| Existing document management | Versioned plans, specifications, reports, designs and work products | Reference canonical document/revision, author, evidence and supersession; preserve the original. |
| WWMD / WWWD / WSID | Platform doctrine, organization doctrine and profession/craft knowledge | Route decisions and lessons to the owning scope through existing review/curation; cross-scope advice is not binding doctrine. |
| Code and document graphs | Discovery of relationships, dependencies, relevant implementations and documents | Treat as derived indexes; verify graph freshness and resolve the underlying source/revision before relying on a relationship. |
| Existing scoped memory and effort context | Compact working continuity, unresolved questions and referenced decisions | Enforce person/org/workroom scope and retention; promote confirmed durable knowledge through its owning pipeline rather than copy private material globally. |

Entry retrieves relevant prior work and current status. Checkpoints persist completed work and material findings while evidence is fresh. Handoff and close reconcile outcomes, decision links and remaining obligations. Existing improvement capture observes corrections, repeated failures, productive techniques and retrieval misses throughout those stages.

Distillation carries source locators, authorship, scope/sensitivity, observation time, source revision/digest and supersession or revalidation conditions using existing metadata. Preserve unknown attribution. Distinguish an observed fact, a proposed lesson and approved doctrine. Conflicting or stale facts trigger bounded revalidation, not silent overwriting. Restricted material is filtered before excerpts or summaries are sent to an executor. Retrieved documents and tool output are data, never instructions that enlarge authority.

Do not write or embed every transcript fragment again. Prefer changed durable facts and referenced work products; deduplicate exact events separately from recurrence across independent runs. Use existing retention and supersession policy; no deletion or retention change is authorized here. Measure whether the next eligible run retrieves and uses the information successfully. A stored note alone is not an improvement outcome.

## 6. Waiting, resumption and avoidance of repeated cold starts

Extend existing checkpoint/reconciler behavior. A wait records reason, owning dependency, expected change, observation fingerprint, next due time, next-action owner and whether provider execution started or is uncertain. Persist before releasing the observer. Events invalidate the cheap durable read model; a bounded periodic reconciliation backstop handles missed events without invoking inference on unchanged state.

Classify wait causes separately: resource/capacity, provider quota or authentication, review, deployment, missing evidence, required human decision, uncertain effect, terminal failure and operator pause. These are read-model categories mapped to existing states, not new database enums. Do not label every wait `needs a person`.

Only changed actionable prerequisites admit a new run. Use current grants, original deadline/attempt budget, request digest, source/document versions, quiescence and complete checkpoint settlement. Preserve completed sibling results. Command receipts/CAS/generation fences prevent concurrent wakes or retries from duplicating dispatch and side effects. A timeout is not proof of a failed or unstarted provider execution. Authority denial stops that action; a cache preference cannot bypass it.

Human approval remains necessary for actions that actually require it. Reuse valid recorded delegation across routine phases. A blocked item has one named owner and a concrete remedy; it does not require the original client to remain loaded. Do not change existing external automations or message other conversations as part of this planning delivery.

## 7. Provider and client execution policy

BI-F9510151 extends existing adapter/configuration/capability contracts; BI-4761F54E retains cache mechanics. Resolve a versioned capability view for each provider, account boundary, endpoint, model/runtime build and client/harness version. Record source, checked-at, invalidation/expiry and supported, unsupported or unknown. Account-specific isolation remains mandatory; no cache sharing across tenants or clearance boundaries is implied.

| Concern | Qualification and policy |
| --- | --- |
| Cloud cache | Exact prefix and tool/schema stability, minimum eligible size, retention/eviction rules, read/write pricing semantics and actual usage fields. API controls apply only to the route exposing them. |
| Native external clients | Session/fork/resume/export capabilities and observable usage. DPF can provide governed briefs and evidence; it cannot assume it controls hidden prompt composition, subscription accounting or cache retention. |
| Local runtime | Separate cold model load, warm model residency, queue time, prompt processing, prefix reuse and token generation; record model/context/quantization/runtime/hardware identity. No throughput claim from a single memory or utilization snapshot. |
| Retry and cancellation | Pre-dispatch refusal, known completed result and uncertain execution have different recovery paths. Settle effects before replay; preserve budgets and provenance. |
| Long waits | Checkpoint and release unnecessary client observation. Do not generate synthetic keepalive inference to retain caches or hold scarce resources idle. |

Qualification matrix: cold request; immediate identical-prefix request; task suffix change; prefix/tool/schema change; natural idle interval spanning the documented retention boundary where feasible; observed eviction/restart; cancellation; pre-dispatch capacity refusal; uncertain timeout. Do not force a production eviction, reset another owner's model or run paid probes without current authority and a finite budget. An unobserved expiry/eviction is unverified, not a fabricated miss.

Normalize provider usage before aggregation. Some providers report cached tokens as a subset of total input while others report disjoint cache categories. Store or project observed total input, uncached input, cache writes, cache reads and output without double counting; absent fields remain null/unknown, not zero. Subscription allowance and API dollar estimates are separate. Telemetry unavailability in an external client limits attribution rather than proving savings.

## 8. Operator experience and information architecture

Extend the existing Workroom detail/inventory read model and Authorized Surface Contract. The first screen answers: what outcome, what happened, what happens next, who owns it, and whether the person must act. Preserve the existing route hierarchy and theme-aware report components.

The primary path is outcome and acceptance, current bounded assignment, native or external run, then artifacts and verified evidence. A wait resumes at the assignment when its prerequisite changes. Delivery hands ongoing observation to its recorded owner. Scoped knowledge and verified improvements feed the next assignment.

Primary content: outcome and current assignment; working/waiting/person-needed status; latest material result; next-action owner and automatic wake condition; verified deliverables and remaining acceptance. Secondary disclosure: participating sessions, relevant durable knowledge, observed time/spend with coverage/freshness. Diagnostic disclosure: raw events, model/cache fields, source identities and receipts. Avoid technical identifiers, lease paragraphs or percentages of unknown completion in the primary flow.

No user action is shown unless a valid available action can advance the work. A queued wait says what it awaits; an unavailable client says what continuation artifact is available. Delivery, acceptance and ongoing pilot observation are distinct. The construction session may finish when its durable observation handoff exists; the broader outcome remains open until its actual criteria pass.

Verify keyboard operation, accessible status text, narrow viewport, light/dark/brand themes and browser/MCP projection agreement. Use semantic theme tokens and existing components. Prototype and critique the affected surface before runtime UI edits; this document does not claim a rendered UX review.

## 9. Measurement, pilot and continuous improvement

Extend existing telemetry and improvement records; no parallel spend ledger. Correlate work identity, assignment, TaskRun, native/external session, provider call and receipts where known. Deduplicate by originating execution identity so mirrored/imported events are not billed twice.

Measure wall-clock elapsed, active work, automatic and human wait, provider queue/load/prompt/generation time, compactions, startup/rehydration tokens, repeated reads/setup/reviews, unchanged inference wakes, failure/retry count, cache read/write/uncached coverage, handoff completion and accepted deliverables. Report p50/p95 only with sample count and observation window. Show unknown external usage separately. Historical snapshots and truncated query populations are not a baseline census.

Baseline matched work classes before policy changes, stratified by provider/client and verification burden. Begin with the next 10 eligible bounded assignments or 7 days, whichever occurs first. Include a native thread, supported Claude/Codex/Grok paths where access exists, one local inference path and one non-engineering Workroom. Each claimed surface must demonstrate continuation; unavailable surfaces remain unqualified and prevent a universal rollout claim. Compare matching task classes with the same required gates; account for outages and exclusions. Do not benchmark by rerunning side effects or replacing independent acceptance with model self-report.

Safety acceptance requires zero duplicate effects, zero authority/scope leakage and no lost required obligation in exercised cases. Flow acceptance requires zero model calls on unchanged automatic waits in the controlled replay and one continuation per admitted changed event. Efficiency hypothesis: reduce median rehydration input and avoidable wait by at least 25% against the matched baseline without reduced acceptance quality. The 25% threshold is a proposed pilot target, not a promised saving. Insufficient samples or missing attribution are inconclusive; extend observation only within the approved pilot budget and owner decision.

Feed actual misses through BI-IMP-9DA35549. Classify expected refusal, duplicate, evidence gap, skill/instruction, tool/API, UX/design or platform defect. Link the recurrence to its existing carrier, repair it, then verify the same failure class no longer recurs. Standards and scope-owned doctrine changes retain their own curator; no automatic wholesale rewrite of AGENTS.md or private learning into global policy.

## 10. Research and benchmarking

Primary sources were inspected October 19, 2026. They guide qualification; provider-specific defaults must be checked again for the actual deployed tuple.

| Comparator | Adopt | Reject / limit |
| --- | --- | --- |
| [LangGraph persistence](https://docs.langchain.com/oss/python/langgraph/persistence) | Separate resumable execution checkpoints from shared knowledge; explicit storage scope. | Do not add LangGraph or equate an unbounded checkpoint history with useful prompt context. |
| [Temporal workflow](https://docs.temporal.io/workflows) | Durable state, recorded execution outcomes and continuation independent of a loaded observer. | No replacement orchestrator; reuse DPF TaskRun, events and Inngest. |
| [llama.cpp server](https://raw.githubusercontent.com/ggml-org/llama.cpp/master/tools/server/README.md), [vLLM prefix caching](https://docs.vllm.ai/en/latest/features/automatic_prefix_caching/) | Measure prefix reuse and distinguish prompt processing from generation. | Do not assume serving configuration, model residency or cross-slot behavior from API compatibility. |
| [BMAD Method](https://github.com/bmad-code-org/BMAD-METHOD), DPF [evaluation](../../security/tool-evaluations/2026-09-15-bmad-method.md) | Bounded artifact-backed work and explicit delivery phases as a process comparator. | No dependency or duplicate process pack; benchmark reading does not authorize adopting it. |
| [Anthropic long-running harnesses](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) | Incremental assignments, clear progress artifacts and real verification across context windows. | Compaction alone and self-declared completion are insufficient. |
| [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching) | Stable rendered prefixes, compatible tools/settings and model-specific retention/usage qualification. | No universal hourly TTL or assumption that fresh sessions improve hits. |
| [Anthropic caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) | Five-minute/default and supported one-hour cache choices qualified to actual request cadence and write/read economics. | Do not extend DPF HTTP controls to opaque native-client behavior. |
| [Gemini caching](https://ai.google.dev/gemini-api/docs/caching), [xAI caching](https://docs.x.ai/developers/advanced-api-usage/prompt-caching/how-it-works) | Provider/API/model-specific capabilities, stable prefixes and observed cache usage. | No cross-provider retention, routing or pricing defaults. |
| [Docker Model Runner configuration](https://docs.docker.com/ai/model-runner/configuration/) | Qualify configured context and memory separately from model maximum context. | No context reduction, model replacement or hardware recommendation without measurements. |

## 11. Compatibility, funding and rollout

Default existing consumers to their current behavior until the shared brief and wake policy are qualified. Roll out one mapped slice at a time with existing feature/config controls, retaining historical threads and receipts. Rollback switches dispatch/read-model composition to its prior qualified behavior; pending durable obligations, settlement and knowledge references remain intact. No migrations are currently specified. If existing metadata cannot represent the contract, stop that slice for data-architecture review with a proven gap and expand/contract plan before adding schema.

This is platform reliability/integration work. MCP reported funding organization unresolved on the design claim; do not invent a funding organization, charged budget or monetary commitment. Before implementation resolve that owning allocation. The operator requested 20% refactoring emphasis; reserve at least one fifth of each new implementation slice for consolidating existing briefing, attribution or continuation logic, while retaining any stronger recorded platform funding allocation. This is implementation-effort planning, not a fabricated inference-token split.

No automatic external conversation creation, messaging, archiving, automation edits, model unload/restart, retention deletion, paid-provider activation or live installation change is authorized by this planning delivery.
