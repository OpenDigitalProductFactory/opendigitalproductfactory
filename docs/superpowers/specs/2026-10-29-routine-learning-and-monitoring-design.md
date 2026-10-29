---
title: Routine learning drafts and bounded monitoring reports
status: draft
author: Codex
date: 2026-10-29
backlog:
  - BI-C5E51A15
---

# Routine learning drafts and bounded monitoring reports

Workroom: WC-2A0CFCB2. Branch: codex/routine-coworker-reporting. Initial base: c396c4801c56f448bc60e3e1a124b9b09cfad21b. This is a proportional amendment of docs/superpowers/specs/2026-08-13-wwwd-constitutional-alignment-gate.md and the existing action-escalation/curated-artifact contracts. Parent source repair PR6746 is separately in the protected merge queue; no source-only acceptance is borrowed from it.

Status: research/design only; no implementation-ready claim. BI-C5E51A15 requires proportional amendment of the existing constitutional action-escalation design and independent review. Existing Medium repair scope; no broad coworker graduation, new permission store, or silent weakening of explicit owner policy.

## Objective and source evidence

Routine internal learning drafts and the originally commissioned bounded read-only six-hour AI Ops watch should complete under existing authority without repetitive owner approval. Genuine consequential actions still use ordinary approval. Owner selected task history for routine watch results and actionable changes only, evidence cmvsz02qa1xqc01k0moi8z344. Preserve the SAME paused agent-task-56e05d88, cadence, full original prompt, unrelated taskConfig, identity, privacy/resource/timeout limits and run history. Do not replay its old approved-but-failed report.

Kernel revised the reporting choice after an independent challenge found no full-prompt disclosure contract: DI-47F9FDA696E0 supersedes DI-00D2ABF4D497 on that evidence. Original prompt remains private and unmodified; the repair does not need to disclose its additional content. Unknown commission classification is not inferred from its target coworker. No denied read was attempted or bypassed.

Existing sources: govern/authority/escalation-gate.ts and resolve-coworker-tool-authority.ts; proactivity/propose-interception.ts; mcp/packs/contribution-hive-pack.ts and scheduled-agent-task-pack.ts; operate/scheduled-jobs/agent-task-core.ts; tak/autonomous-work-run.ts and scheduled-task-runs.ts; actions/agent-task-scheduler.ts. Existing TaskMessage/AgentMessage and TaskRun record scheduled output. Existing communications in-app adapter and dispatcher deliver owner notifications; their current implementation is NOT itself an unchanged-condition deduplicator.

## A. Classify the actual learning draft correctly

propose_improvement creates a proposed ImprovementProposal, files eligible work in triaging backlog intake, and indexes knowledge. Inspected reconciliation/digest/local-only sweep consumers create intake or reports, not a build or live policy change; skill-application paths require their separate category/target and review. Its current executionMode=proposal always wins before every steering rule. The handler's deliverable is the recommendation itself, so propose changing its declaration to immediate + coworkerArtifact=true, retaining sideEffect=true, normal audit, input binding, current user/agent/grant/sensitivity gates and operator policy.

The current handler also silently captures the last five thread messages into conversationExcerpt. Automatic draft filing must not expand hidden conversation-data copying: persist the explicitly provided description/observedFriction as the evidence, omit automatic message capture for this tool, and leave skill-content proposals unchanged. If a thread context is provided, validate its exact owner/current admitted context through the existing boundary before recording the link; a foreign or stale thread must not be read or mutated. No extra private message read is necessary for the learning draft deliverable. Test that foreign-thread attempts produce no draft/intake/index and that no conversation query is used on the ordinary artifact path.

Before enabling that artifact classification, make the draft write itself safe to repeat. The current handler generates a new proposal ID on every call, so metadata alone would move duplicate minutia into the backlog. Reuse an exact pending ImprovementProposal for the SAME submitted user, actor, route/thread scope and normalized complete draft content. A reviewed/terminal draft is not silently revived. Use the existing row and fields, an owner-scoped serializable transaction and existing isRolledBackPostgresConflict (shared/postgres-transaction-conflict.ts) with a bounded local retry policy, never treating uncertain transport/commit loss as proved rollback; no new idempotency table or caller-supplied authority key. Concurrent identical calls must create one proposal and one canonical intake origin; a retry can finish a missing backlog projection using that same proposal ID. Return whether the draft was reused. Do not repeat completed indexing/intake work just because the model repeats the call. Scope/content mismatches must never return another user's or agent's draft. Verify concurrency and interrupted-projection recovery against actual persistence, not an in-memory-only sketch.

This uses the existing artifact taxonomy and propose-interception exemption, not a name whitelist in the governor. No other proposal tool changes; contribute_to_hive and propose_skill_improvement keep outward/human-review semantics. Explicit always approval, missing grants/capabilities, stale consent, cross-tenant context and consequential actual tools remain refused or gated. A description asking to deploy/delete changes no handler behavior: it only saves a draft, never executes that action. Confirm the complete downstream consumer sweep before implementation and test real handler + governor behavior, not just metadata.

## B. Exact owner reporting configuration with no prompt rewrite

Extend the existing list tool with optional exact taskId selection, preserving its existing compact prompt projection and returning only an owner's selected task plus a server revision digest. This adds bounded selection, not a full prompt reader. All pages/bulk behavior retain current privacy limits.

Add one narrow reporting configuration operation in the existing scheduled-task pack/core. Input: taskId, expected revision digest, mode=read-only-history, reason. Reuse work_capsule_write and existing capability/authority gating; no new grant. Require the task be paused, owned by the caller, generic agent-task, with no typed/domain/Workroom/stage/dispatch/procedural-write contract or mandatory Workroom writer. Reject unknown/conflicting workflow configuration. Revalidate ownership and revision in one transaction, compare-and-swap against current row version, merge only the versioned reporting key into taskConfig, and retain every other field. Scope fingerprint covers full prompt, owner, agent, route, task kind/config, schedule/timezone and active state; operational reporting state is distinct from permission scope. Audit only identifiers/digests/mode and safe reason, not extra prompt content. No implicit resume, rerun or recreate.

The mode expressly narrows the originally bounded read-only commission to observation and reporting. It cannot be used to suppress required mutations on typed or Workroom jobs. Future users must be shown that all operational writes are excluded by this mode; this owner's original watch is already recorded as bounded read-only in C5 intake.

## C. Read-only runtime boundary and truthful completion

Resolve the reporting contract from the current persisted task. Narrow normally authorized definitions BEFORE budgeting to explicitly sideEffect=false, immediate (including existing undefined-immediate default), nonconsequential tools. Unknown sideEffect is not proof of a read. Carry the identical filtered set through active and deferred tools, load_tools, automatic promotion, reassessment/native continuations and budget fallback. Existing loop refuses an absent definition before the governor. Add a current server-owned reporting-policy denial for side effects from this scheduled job, including an old pending approval; schema filtering alone cannot authorize historical writes. All current grant, capability, sensitivity and external-access checks remain.

Add the owner-selected reporting instruction above the retained original task context: same observations and limits, routine results in task history, no per-tick backlog evidence write or operational action. The required-writer/pinning/correction code sees only the narrowed authorized surface under this exact mode; unchanged jobs keep their current required-work rules. Eligibility rejects explicit Workroom/procedural writer conflicts. At least one real successful observation is needed; failed reads, inference failure, unavailable tools, malformed report and zero observations cannot become green completion.

## D. Actionable delivery without another owner flood

Use a bounded validated report shape with summary, result state (routine/actionable/unchanged/resolved), evidence references to actual successful observation calls, and recommendation for actionable results. Model output cannot supply owner, job, authority, tool rights, recipient or a new executable call. Server records every valid report in existing TaskMessage/AgentMessage and settles the actual TaskRun; bad/failing observations retain failure status.

One server-owned unresolved condition slot per job in its reporting state prevents paraphrased identical findings from creating new notices. On the first actionable report, create one in-app communication for the exact job owner through the existing dispatcher/adapter, linked to existing task history. While open, later findings update history without creating another notification. Ordinary routine/unchanged output does not close an unresolved condition. A resolved report must reference the server's exact current condition and fresh observation evidence before clearing it; retain history. Genuine required judgment uses existing input-required state/decision brief and durable parking; missing credentials use auth-required, never an ordinary approval for a failed read. Do not label an FYI report as paused-ai approval.

Make condition claim, notification insertion, delivery audit and stored condition identity atomic using the existing database transaction and existing notification/communication rows. Reuse the existing in-app adapter/dispatcher writer through transaction-client injection rather than duplicating notification shapes, adding an outbox/table, changing global cadence, or fanning out to email/push. Concurrent executions and a crash after notification creation must not issue a second notice. Notification errors must not be falsely recorded as delivery. All model reporting text is bounded and follows existing safe diagnostic handling; it is advice, not authorization to act.

## Verification and rollout

Source tests: actual improvement draft + governor under permitted current policy and explicit always control; harmful action tools, outward/skill controls, missing grants, cross-tenant and stale authorization. Monitoring: exact owner/CAS/stale revision, same identity/history and unchanged prompt/settings, typed/Workroom/conflicting-contract refusal, unknown metadata, active/deferred/load/fallback/guessed writer attempts, stale scheduled approval denial/finalization, failed/zero observations, real persisted history, actionable first notice, concurrent/replayed notice prevention, unchanged paraphrase silence and exact resolution. Both typechecks and affected tests, canonical shared gate, independent exact-source review and protected PR queue.

After canonical deployment, configure the SAME paused watch with its current exact revision, resume once through the supported operation, and observe its next legitimate run. Verify task history/settled run, zero routine envelopes and a required consequential-action control; zero observations is not a pass. Keep C5 open until both original operations and live controls are verified. No source-only or environment-startup result is live coworker acceptance.

## Remaining design challenge

Confirm current-job eligibility using the existing bounded metadata projection, not private prompt reconstruction. Specify the report parser/evidence-reference and human-input transition contract against actual runtime helpers before implementation. Verify that transaction injection reuses notification/audit writers without making all communication behavior task-specific. These are explicit independent review obligations, not claimed existing guarantees.

## Concrete state and transaction refinements from source

ScheduledAgentTask.lastStatus is closed to ok/error/proposed; proposed already means awaiting-person. Do not add a status or migration. A validated needs-decision report parks its existing TaskRun as input-required with decisionBrief, the SAME job as proposed/nextRunAt=null, and does not call it failed or completed. A missing-credential observation parks the run auth-required with the precise refusal, never claims owner judgment. Valid routine/actionable FYI reports settle completed after persisted history; zero or failed required observations and invalid reports do not settle green.

The report state distinguishes routine, actionable, unchanged, resolved and needs-decision. Routine/unchanged cannot close an open condition. Resolution must echo the current server-generated condition identity and bind fresh observed evidence; model-generated new wording/keys cannot create a new unresolved notice. Keep one open condition per job and record every report in history. An actionable FYI notification is an in-app communication, not a CoworkerActionEnvelope or fake paused-ai record.

Current communications adapter/dispatcher/delivery-evidence have default Prisma bindings. Extend these existing writer seams with optional transaction-client/dependency injection, preserving every existing default. The job's condition claim, actual in-app Notification insertion, communication delivery attempt and condition reference then commit in one transaction, with ownership/scope checked and existing row version/CAS serializing concurrent report settlement. Failed adapter/delivery audit rolls the transaction back, so an unresolved condition cannot be marked notified when no notice exists; no separate outbox/table or alternative writer. A retry after a committed transaction finds the stored condition and does not send again. Inspect and test this against actual dispatcher failure semantics before claiming it is sufficient.

## Traceability and implementation boundary

The live parent item was read through MCP on 2026-10-29. Its complete proposed acceptance is preserved below; these proposed criteria require independent design review before implementation.

**OBJ-C5-AUTONOMY:** Complete authorized routine drafts and bounded observations without repeated owner clicks.

**OBJ-C5-ATTENTION:** Keep routine monitoring results in task history and surface actionable changes once.

**OBJ-C5-AUTHORITY:** Preserve the existing consequence, current-authority and exact-execution controls.

| Acceptance ID | Objective IDs | Statement | Design and verification |
| --- | --- | --- | --- |
| AC-C5-1 | OBJ-C5-AUTHORITY | Derive approval from actual data scope, reversibility, spend/resource/frequency bounds, external publication, security/authority and production effect. Names like self-improvement or monitoring do not confer authority. | A–C; actual handler/governor and negative controls |
| AC-C5-2 | OBJ-C5-AUTONOMY, OBJ-C5-ATTENTION | With current operator intent and intersected grants, non-destructive internal evidence/learning drafts and bounded read-only recurring checks proceed automatically when existing policy allows. Reuse valid scoped authorization; no fresh click solely for a phase change or novelty. | A–D; permitted draft, exact job configuration and history tests |
| AC-C5-3 | OBJ-C5-AUTHORITY | External publication, expanded data/permissions, destructive action, deployment/model or budget policy changes and material/unbounded recurring load retain the governing approval or independent review. Unknown consequence cannot silently become routine. | A–C; outward, harmful, authority, stale and unsafe-frequency controls |
| AC-C5-4 | OBJ-C5-AUTHORITY | Audit the rule, scope, evidence and consent used; explain the exact unmet boundary when a human is required. Preserve exact binding, expiry, cancellation, single execution, separation of duties and all existing refusals. | A–D; audit, concurrency, delayed authorization and notification settlement tests |
| AC-C5-5 | OBJ-C5-AUTONOMY, OBJ-C5-ATTENTION, OBJ-C5-AUTHORITY | Reproduce these two actual operations and obtain positive/negative, tampering, cross-tenant, stale-consent, unsafe-frequency and harmful-action tests. Verify on canonical live runtime that unnecessary envelopes fall while required controls still fire; never accept zero observations as proof. | Verification and rollout; both original operations and served required-control case |

The learning-draft repair and monitoring repair are independently shippable. Before implementation, check current backlog overlap and map each to a live deliverable through the existing coverage writer. This draft does not declare them atomic or substitute design publication for delivery.

| Requirement | Objective | Existing contract | Flow | Verification |
| --- | --- | --- | --- | --- |
| AC-C5-DRAFT: routine internal learning drafts proceed under current permitted policy, without duplicate filing or hidden transcript capture | OBJ-C5-AUTONOMY | CT-LEARNING-DRAFT: sideEffect remains true; recommendation persistence is the deliverable; current authority and explicit always still govern | FLOW-DRAFT-INTAKE: caller → governor → repeat-safe pending draft → existing intake | VERIFY-DRAFT: actual handler/governor, identity/scope, concurrent repeat and projection recovery controls |
| AC-C5-HISTORY: the same bounded read-only job retains routine results in task history and surfaces actionable changes once | OBJ-C5-ATTENTION | CT-ROUTINE-MONITOR: owner/revision-bound narrowing, original prompt and limits retained | FLOW-HISTORY: current job → narrowed observations → persisted run/history → one open owner notice | VERIFY-HISTORY and VERIFY-LIVE: no-op/failure/changed/resolved cases, real storage/notification and next legitimate served run |
| AC-C5-CONTROLS: harmful, outward, authority, data-scope, stale-consent and unsafe-frequency cases retain their existing controls | OBJ-C5-AUTHORITY | CT-ACTION-ESCALATION: existing resolveEscalation/current grant intersection; no actor graduation or name exemption | FLOW-GOVERNOR: current authority → eligible action or precise refusal/approval → exact execution/outcome | VERIFY-CONTROLS: negative/tamper/cross-tenant/current-policy tests and canonical live required-control case |

These are working design references, not new accepted parent criteria. Before implementation, quote/map the parent's complete live acceptance, bind the immutable artifact, record the proportional review and live backlog coverage. Do not claim this draft or its kernel recommendation is an implementation approval.

New reporting configuration must pass target ownership, paused-state, workflow eligibility and exact revision preconditions BEFORE any new approval request. Reuse the canonical governed-tool preflight seam and revalidate inside the mutation transaction after any delayed approval; an impossible configuration must not consume another owner click. The current-side-effect denial for an already configured read-only job also precedes new envelope creation. Do not add an approval bypass by tool name.

Source investigation and this draft may proceed under the authorized Medium repair. Implementation is stopped until independent design challenge is resolved, canonical plan/backlog coverage recorded and the actual implementation claim admitted. No draft states, tests, live job changes, new approvals or UX acceptance are represented as completed work.
