# Governed Hermes-Style Coworker Learning Loop Design

| Field | Value |
| --- | --- |
| Date | 2026-05-15 |
| Status | Draft for review |
| Related epics | EP-TAK-3F9A21 |
| Related repo areas | `apps/web/lib/actions/agent-coworker.ts`, `apps/web/lib/tak/agentic-loop.ts`, `apps/web/lib/tak/autonomous-work-run.ts`, `apps/web/lib/tak/prompt-assembler.ts`, `apps/web/lib/tak/governed-memory.ts`, `apps/web/lib/actions/agent-skills.ts`, `apps/web/lib/actions/skill-discovery.ts`, `apps/web/lib/actions/skills-observatory.ts`, `apps/web/lib/coworker-self-assessment/*`, `apps/web/lib/improvement-flywheel/*`, `apps/web/app/(shell)/platform/ai/*`, `packages/db/prisma/schema.prisma`, `skills/`, `prompts/` |
| Related standards | `AGENTS.md`, `docs/architecture/trusted-ai-kernel.md`, `docs/architecture/GAID.md`, `docs/architecture/agent-standards-dpf-conformance.md`, `docs/architecture/ai-coworker-development-principles.md` |
| Related specs | `2026-03-30-ai-coworker-skills-marketplace.md`, `2026-04-05-continuous-improvement-flywheel-design.md`, `2026-04-30-ai-coworker-operator-pattern.md`, `2026-04-30-build-specialist-operator-contract.md`, `2026-04-25-tak-gaid-auth-identity-memory-refresh-design.md`, `2026-05-10-ai-coworker-visual-control-surface-design.md`, `2026-05-11-autonomous-coworker-runtime-design.md`, `2026-05-11-ai-routing-ux-verification-test-architecture-design.md`, `2026-05-12-ai-capacity-continuity-design.md`, `2026-05-13-realtime-hitl-mobile-companion-design.md`, `2026-05-13-code-intelligence-graph-adoption-design.md`, `2026-05-14-coworker-memory-shape-contracts-design.md`, `2026-05-14-portal-work-capsule-control-harness-design.md` |

## 1. Purpose

Hermes Agent is good because it treats improvement as a product surface, not a hidden model behavior. It combines procedural skills, session search, user memory, background reflection, curation, scheduled jobs, and offline evolution into a tight loop where the agent learns from real use.

DPF should lift the principles that make Hermes feel good while keeping DPF's stronger corporate governance posture:

1. every improvement is attributable to a coworker, user, run, tool execution, or source artifact,
2. every durable change is reviewable, reversible, and auditable,
3. skills are procedural memory, not just labels,
4. learning loops become governed work, not invisible prompt drift,
5. repeated successful agent behavior graduates into deterministic workflow, policy, tests, or code.

This spec defines the holistic architecture. Implementation remains incremental and agile: each slice must be shippable, reviewable, and useful on its own.

## 2. Executive Decision

DPF should build a governed coworker learning system with five coordinated planes:

1. **Skill plane** - versioned, assigned, progressively disclosed procedural playbooks.
2. **Runtime evidence plane** - `TaskRun`, `ToolExecution`, receipts, thread messages, and artifacts.
3. **Reflection plane** - event-triggered and scheduled self-review runs that propose improvements.
4. **Curation plane** - lifecycle management for skills, prompts, memory candidates, and conventions.
5. **Evolution plane** - sandboxed/offline optimization that proposes diffs and benchmark evidence, never direct production mutation.

The product surface should make the loop visible in `/platform/ai`: what the coworker used, what it learned, what it wants changed, what was approved, and what was rolled back.

### 2.1 Non-goals

To prevent scope creep across what is already a holistic design, this spec **does not**:

- redefine memory primitives — `2026-05-14-coworker-memory-shape-contracts-design.md` owns `MemoryCandidate`, `UserFact` policy classes, and freshness rules,
- redesign the signal-routing or portfolio-prioritization layer — `2026-04-05-continuous-improvement-flywheel-design.md` owns `ImprovementSignal` and the top-3 prioritization spine,
- redesign the skills marketplace browse/install surface — `2026-03-30-ai-coworker-skills-marketplace.md` owns the catalog, ratings, and discovery flow,
- redesign Build Studio's PR/verification lifecycle — `2026-05-11-autonomous-coworker-runtime-design.md` and `2026-04-30-build-specialist-operator-contract.md` own that path,
- replace TAK/GAID authority, identity, or grant resolution — those remain canonical at `docs/architecture/trusted-ai-kernel.md` and `docs/architecture/GAID.md`,
- introduce a parallel runtime or job system alongside `TaskRun` — reflection, curator, and evolution all flow through the existing operator-pattern runtime,
- expose any agent-to-production write that bypasses `ImprovementProposal` review, `SkillRevision` history, or PR-based delivery.

### 2.2 IT4IT alignment

Per the Mark/DPF "IT4IT v3.0.1 foundation" principle, this loop is positioned in the **Detect-to-Correct** and **Request-to-Fulfill** value streams:

- **Detect-to-Correct.** Skill-failure detection (`PlatformIssueReport`), reflection triggers, curator stale/duplicate detection, and rollback live here. Evidence flows from `ToolExecution` and `TaskRun` into reflection runs.
- **Request-to-Fulfill.** `ImprovementProposal` review, `SkillRevision` activation, evolution-lab PRs, and graduation candidates land here, joining the existing backlog → Build Studio → ship path.
- **Strategy-to-Portfolio** is touched only through `ImprovementSignal` emission into the flywheel (§6.3.2). This spec does not own the prioritization step.

## 3. Current Repo Truth

### 3.1 Live state verified 2026-05-15

Live Postgres inspection showed:

| Model | Count | Meaning |
| --- | ---: | --- |
| `Agent` | 81 | Coworkers and specialists exist as durable runtime actors. |
| `SkillDefinition` | 54 | Skill definitions already exist in Postgres. |
| `SkillAssignment` | 131 | Coworkers already have many assigned skills. |
| `SkillMetric` | 0 | The aggregate metric model exists, but the learning loop is not measuring skill use yet. |
| `CoworkerSelfAssessment` | 1 | The self-assessment foundation is now active, but barely populated. |
| `CoworkerCapabilityNeed` | 1 | Coworker-submitted needs exist, with submitter attribution. |
| `UserFact` | 50 | User memory is present and should remain policy governed. |
| `ToolExecution` | 1249 | Tool audit is real and should be the primary evidence source. |
| `ToolExecutionReceipt` | 7 | Receipt-bearing tools exist but are not yet broadly used. |
| `TaskRun` | 44 | A2A-shaped work identity exists. |
| `ScheduledAgentTask` | 2 | Scheduled coworker execution exists. |
| `ScheduledJob` | 10 | General background scheduling exists. |
| `PlatformIssueReport` | n/a (model exists) | The current "stuck coworker / repeated tool" detector at `apps/web/lib/tak/agentic-loop.ts:843` writes `type="agent_stuck"` rows here inline (no named helper function — the spec must integrate with this exact call site, not invent one). This is the **first** signal source the reflection plane must consume. |
| `ImprovementProposal` | n/a (model exists) | Governed proposal envelope with `category`, `severity`, `agentId`, `reviewedById`, `backlogItemId`, `buildId`, `verifiedAt`, `contributionStatus`. Skill-shaped proposals fit here. |
| `DeliberationRun` | n/a (model exists) | Multi-perspective governed reasoning over `TaskRun`/`TaskNode`. Existing substrate for any "reflection plane" run that needs branched evaluation. |
| `PromptTemplate` / `PromptRevision` | n/a (model exists) | Prompts are seeded, edited via Admin > Prompts, and versioned via `PromptRevision`. Sets the precedent skills should follow for revision history. |
| `BacklogItemActivity` | n/a (model exists) | `kind` is free-form String today (not enum-constrained); used as the canonical evidence trail on backlog work. |
| `ExternalEvidenceRecord` | n/a (model exists) | External-provider evidence with `actorUserId`, `routeContext`, `provider`, `resultSummary`. Already governs cross-provider audit. |

#### Forward-dependency primitives (referenced but not yet shipped)

These are named throughout the spec as if they were live. They are not. Each lands in another in-flight spec; this design depends on those landing first or alongside.

| Concept | Owning spec | Today's state |
| --- | --- | --- |
| `ImprovementSignal` | `2026-04-05-continuous-improvement-flywheel-design.md` (Draft) | Not in `schema.prisma`. This spec's reflection plane assumes the flywheel ships the model and the signal-routing service. |
| `MemoryCandidate` | `2026-05-14-coworker-memory-shape-contracts-design.md` | Not in `schema.prisma`. This spec defers all memory-candidate shape to that document and must not redefine it. |

The immediate architectural signal is clear: DPF has the primitives, but not the integrated learning loop. Two corollaries follow:

1. **Substrate-before-invention.** `ImprovementProposal`, `DeliberationRun`, and the `PromptTemplate`/`PromptRevision` precedent must be reused before any new "skill improvement", "reflection report", or "skill revision" model is added. New tables enter only when an existing model is unambiguously the wrong shape.
2. **Live enums beat aspirational enums.** `SkillDefinition.status` is `discovered | evaluated | approved | installed | active | deprecated` today (`packages/db/prisma/schema.prisma:6800`). Any lifecycle vocabulary in this spec must reconcile with that enum or propose a single migration that updates it.

### 3.2 Existing strengths to preserve

DPF already has:

- `SkillDefinition`, `SkillAssignment`, and `SkillMetric` as a first-class skill substrate (with `skillMdContent` already on `SkillDefinition`).
- `TaskRun`, `TaskNode`, `TaskMessage`, and `TaskArtifact` as governed work identity (`TaskRun.source` already enumerates `coworker | build | skill | proactive`).
- `DeliberationRun` for multi-perspective governed reasoning over a `TaskRun`/`TaskNode` tree (`schema.prisma`).
- `ToolExecution` and `ToolExecutionReceipt` as audit and evidence.
- `ImprovementProposal` as the governed proposal envelope already linked to backlog, build, reviewer, and contribution status.
- `CoworkerSelfAssessment` and `CoworkerCapabilityNeed` as coworker-submitted improvement needs (with submitter attribution and severity/status).
- `PromptTemplate` + `PromptRevision` as the existing precedent for versioned, edit-via-admin, seed-from-repo content.
- `PlatformIssueReport` as the live, in-use sink for runtime issues observed by the agentic loop today (`type="agent_stuck"` rows written at `apps/web/lib/tak/agentic-loop.ts:843`); the reflection plane must integrate with this exact code path rather than invent a parallel observer.
- TAK/GAID standards for authority, identity, memory policy, and verifiable agent behavior.
- The Continuous Improvement Flywheel design (`2026-04-05-continuous-improvement-flywheel-design.md`) which already specs `ImprovementSignal`, signal normalization, and routing into the common backlog.
- The AI Coworker Operator Pattern (`2026-04-30-ai-coworker-operator-pattern.md`) and Build Specialist Operator Contract — the inheritable five-piece contract for any governed autonomous run.
- `/platform/ai/*` surfaces for skills, authority, history, prompts, routing, model assignment, and capability needs.
- The AI Operations Map direction for visualizing coworker state as operational flow.

### 3.3 Current gaps

The gaps are coordination and product experience, not raw table count:

1. Skill metrics are not populated, so skill effectiveness is mostly invisible. `SkillMetric` rows are not written by any current code path.
2. Skill use is not consistently attributed in the active chat/run UI; `apps/web/lib/tak/prompt-assembler.ts` does not record which skills were eligible, presented, loaded, or invoked.
3. The agentic loop already has a repeated-tool observer at `apps/web/lib/tak/agentic-loop.ts:826` that writes a `PlatformIssueReport(type="agent_stuck")` row inline at `agentic-loop.ts:843` (no named helper — the write is open-coded). That row is the only structured signal that "the coworker got stuck"; nothing converts it into a reflection run, an `ImprovementProposal`, or a `CoworkerCapabilityNeed`. Any reflection trigger this spec ships must consume `PlatformIssueReport` rather than duplicate the detection.
4. `CoworkerCapabilityNeed.kind` is a free-form String today, not an enum — using `kind="skill"` works but violates the AGENTS.md §3 "Strongly-Typed String Enums" rule until it is typed.
5. There is no governed curator that can dry-run lifecycle changes, propose consolidation, or protect pinned skills.
6. `SkillDefinition.status` enum (`discovered | evaluated | approved | installed | active | deprecated`) does not include the operational lifecycle states the design needs (e.g., `stale`, `pinned`, `quarantined`). The marketplace spec uses a different vocabulary again. The conflict must be reconciled with one migration, not papered over.
7. Self-assessment is not yet tied to skill usage, failed tools, repeated user corrections, or stale playbooks.
8. Session history is persisted, but there is no operator-grade search/replay layer equivalent to Hermes session search.
9. Offline evolution is not separated from production mutation as a formal Build Studio or sandbox lane.
10. Skills, prompts, memory, tool grants, and route context are still spread across multiple admin views instead of one learning narrative.
11. The five-piece Operator Pattern contract (operator contract, skill playbooks, tool surface, persistent work products, UI surface) is not yet applied to the reflection, curator, or evolution runs themselves — they are governed runs and should inherit it.

## 4. Research and Benchmarking

### 4.1 Open-source and open-agent systems

#### Hermes Agent

Hermes Agent combines CLI and messaging gateway operation, skills, memory, session search, scheduled jobs, delegation, and background review. Its strongest design choices are:

- skills as procedural memory stored in `SKILL.md` with progressive disclosure,
- agent-managed skill proposals through a `skill_manage` tool,
- memory separated into durable user facts and operational memory,
- session search over persisted conversation history,
- a curator that marks skills active, stale, or archived with backup and rollback,
- background review that proposes memory or skill updates after meaningful work,
- trajectories and a separate self-evolution repo for benchmarked optimization.

Patterns to adopt:

- procedural skill artifacts with supporting references, scripts, templates, and examples,
- background review after repeated tool use, failures, or user correction,
- curator dry-runs, reports, pinning, rollback, and lifecycle state,
- session search as evidence retrieval, not prompt stuffing,
- evolution as a diff-and-benchmark process.

Patterns to reject or adapt:

- direct foreground production mutation of skills by an agent,
- sidecar JSON lifecycle state when Postgres is the DPF source of truth,
- global flat memory files as the main memory substrate,
- messaging-gateway-first design as the product center.

Sources: [Hermes Agent](https://github.com/NousResearch/hermes-agent), [Hermes skills](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills), [Hermes memory](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory), [Hermes curator](https://hermes-agent.nousresearch.com/docs/user-guide/features/curator), [Hermes self-evolution](https://github.com/NousResearch/hermes-agent-self-evolution).

#### LangGraph

LangGraph's relevant contribution is durable, resumable state for long-running agent workflows. Its docs emphasize persistence, durable execution, human-in-the-loop interrupts, and thread identifiers that resume the same checkpoint.

Patterns to adopt:

- every long-running learning job must be resumable through `TaskRun`,
- approval waits should be durable task states, not chat conventions,
- side effects must be idempotent and associated with evidence records.

Patterns to reject:

- importing LangGraph as an unreviewed dependency for this feature before DPF's Tool Evaluation Pipeline approves it.

Sources: [LangGraph overview](https://docs.langchain.com/oss/python/langgraph/overview), [durable execution](https://docs.langchain.com/oss/python/langgraph/durable-execution), [interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts).

#### OpenHands

OpenHands documents the same `SKILL.md` progressive-disclosure direction and warns that legacy always-loaded skills increase token usage. It also supports public skill repositories with precedence rules.

Patterns to adopt:

- skill metadata first, skill body only when relevant,
- explicit precedence when local/project skills conflict with shared or marketplace skills,
- cached external skill import with local review before activation.

Patterns to reject:

- automatic loading of public skills into DPF without TAK evaluation, security scanning, and assignment review.

Source: [OpenHands Agent Skills and Context](https://docs.openhands.dev/sdk/guides/skill).

### 4.2 Commercial and enterprise systems

#### Claude Agent Skills and Claude Code

Claude's skills model formalizes progressive disclosure: metadata is cheap and always available, instructions load only when triggered, and supporting files/scripts load only as needed. Claude Code also distinguishes durable project context, skills, MCP, subagents, hooks, and plugins.

Patterns to adopt:

- skills as reusable workflows with references, scripts, and templates,
- clear layering between always-on rules, on-demand skills, tools, subagents, and lifecycle hooks,
- deterministic helper scripts inside skills where appropriate.

Pattern to adapt:

- DPF skills live in `skills/<category>/<name>.skill.md` and Postgres, not `.claude/skills`.

Sources: [Claude Agent Skills](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview), [Claude Code extension model](https://code.claude.com/docs/en/features-overview).

#### OpenAI Agents SDK

OpenAI Agents SDK guidance emphasizes guardrails, tracing, and human-in-the-loop approval that pauses a run and resumes from serialized state. The useful pattern is run-level approval and traceability across nested agents and tools.

Patterns to adopt:

- approval is run-wide, not local to one tool wrapper,
- runs can pause, serialize, resume, and preserve pending approval state,
- traces include model calls, tools, handoffs, guardrails, and custom events.

Pattern to adapt:

- DPF should map this to `TaskRun`, TAK approvals, `ToolExecution`, and Operations Map projections.

Sources: [OpenAI Agents SDK HITL](https://openai.github.io/openai-agents-python/human_in_the_loop/), [OpenAI Agents SDK guardrails](https://openai.github.io/openai-agents-python/guardrails/), [OpenAI tracing](https://openai.github.io/openai-agents-python/tracing/).

#### Devin

Devin's enterprise docs separate a stateless brain from an isolated execution environment and provide enterprise deployment options with dedicated workspaces. Devin for Terminal skills bundle prompts, permissions, tool access, and workflows, and can run with scoped permissions or subagent execution.

Patterns to adopt:

- isolated execution environments for high-impact evolution and code-changing work,
- skill-level tool restrictions,
- channel options for web, API, and chat, while keeping one session/work identity.

Patterns to adapt:

- DPF's "Devbox" equivalent is Build Studio/sandbox plus worktree execution, governed by TAK and PR review.

Sources: [Devin enterprise deployment](https://cognitionai.mintlify.app/enterprise/deployment/overview), [Devin VPC architecture](https://cognitionai-enterprise.mintlify.app/enterprise/vpc/overview), [Devin skills](https://cli.devin.ai/docs/extensibility/skills/overview).

### 4.3 DPF differentiator

Most agent systems optimize for individual agent productivity. DPF must optimize for governed organizational learning:

- learning is linked to authority,
- learning creates durable operational assets,
- every skill/prompt/memory change has provenance,
- improvement work flows into backlog, Build Studio, and PRs,
- the user sees and can govern the loop.

## 5. Design Principles

1. **Governed learning over hidden adaptation.** Coworkers may propose changes, but production skill/prompt/memory changes require policy-appropriate review.
2. **Reuse before invent.** Before any new model, service, or surface, name the existing primitive (`ImprovementProposal`, `DeliberationRun`, `TaskRun`, `CoworkerCapabilityNeed`, `PromptRevision`) and explain why it cannot serve. Substrate-creep is the easiest way to fragment governance.
3. **One flywheel.** This loop is the skill-and-coworker-deepening lane of the Continuous Improvement Flywheel (`2026-04-05-continuous-improvement-flywheel-design.md`). Reflection outputs become `ImprovementSignal` entries; the flywheel is the prioritization spine. Do not build a parallel router.
4. **Operator pattern applies to learning runs.** Every reflection, curator, and evolution run is a governed operator and inherits the five-piece contract from `2026-04-30-ai-coworker-operator-pattern.md`: operator contract, skill playbooks, tool surface, persistent work products, UI surface.
5. **Procedural memory belongs in skills.** Repeated workflows, work instructions, validation steps, scripts, and templates should be skills, not long prompt paragraphs or user facts.
6. **Facts belong in governed memory.** User, organization, route, and domain facts must remain policy-classed and freshness-aware (see `2026-05-14-coworker-memory-shape-contracts-design.md`).
7. **Evidence first.** Every proposed improvement must cite the run, tool call, thread, artifact, user correction, test, or benchmark that caused it.
8. **Refactor while implementing.** Each slice should reduce fragmentation between skills, prompts, runtime evidence, and UI rather than create a parallel subsystem.
9. **Visible learning builds trust.** Operators should see what changed, why, who proposed it, who approved it, and how to roll it back.
10. **Autonomy stops at risk boundaries.** Low-risk draft proposals can be automatic; activation, external imports, tool grants, prompt changes, or code changes use explicit approval.
11. **Stable behavior graduates to code.** When a skill becomes a repeated deterministic workflow, the platform should file a graduation candidate to turn it into code, policy, schema, tests, or a first-class tool.

## 6. Target Architecture

### 6.1 Skill artifact system

DPF should evolve from "skill row with blob content" toward "skill package as governed artifact."

The source remains:

- `skills/<category>/<name>.skill.md` in repo for seedable skills,
- `SkillDefinition` in Postgres for runtime/editable state,
- `SkillAssignment` for coworker assignment,
- `SkillMetric` and new event-level telemetry for effectiveness.

Each skill package should support:

- `SKILL.md` style body with frontmatter,
- references,
- templates,
- scripts,
- examples,
- allowed tools,
- required context,
- risk band,
- agent-invocable and user-invocable flags,
- lifecycle state,
- provenance and revision history.

DPF should not make every supporting file a giant DB blob immediately. The design should support a staged storage model:

1. keep `SkillDefinition.skillMdContent` as the first source of runtime truth,
2. add revision and usage telemetry around it,
3. add a skill asset manifest for references/templates/scripts when the first implementation needs bundled assets,
4. later decide whether assets live in repo, object storage, or Postgres-backed artifacts.

#### 6.1.1 Lifecycle vocabulary reconciliation

`SkillDefinition.status` today is `discovered | evaluated | approved | installed | active | deprecated`. The marketplace spec (`2026-03-30-ai-coworker-skills-marketplace.md`) and earlier drafts of this design have used `active | stale | archived | pinned | quarantined | proposed`. The two are not mergeable as drop-in synonyms because they describe different axes:

- The current enum describes **adoption stage**: how the skill entered the org and whether it is approved for use.
- The proposed states describe **operational health**: whether the skill is being used, decaying, intentionally protected, or under quarantine.

Decision: keep `SkillDefinition.status` as adoption stage, and introduce `SkillDefinition.lifecycleState` as a separate column for operational health, valued `active | stale | pinned | quarantined | archived`. The migration that adds the column also adds the typed enum in `apps/web/lib/backlog.ts` and the matching MCP tool definition (per AGENTS.md §3). `proposed` is not a state on the skill; it is the state of the proposing `ImprovementProposal`.

### 6.2 Runtime evidence and session search

Hermes' session search works because past work is retrievable without flooding every prompt. DPF should implement the same principle over governed records:

- `AgentThread` and `AgentMessage` provide conversation history,
- `TaskRun`, `TaskMessage`, and `TaskArtifact` provide work history,
- `ToolExecution` and `ToolExecutionReceipt` provide action evidence,
- `BacklogItemActivity(kind="evidence")` provides backlog evidence,
- `ExternalEvidenceRecord` provides external-provider evidence,
- governed memory provides freshness-aware recall.

The new capability is an indexed evidence search service that can answer:

- "show prior runs where this skill failed",
- "show user corrections related to this workflow",
- "show tool failures after this skill was loaded",
- "show similar capability needs already filed",
- "show whether this prompt/skill change improved outcomes."

This is not a replacement for governed memory. It is evidence recall.

### 6.3 Reflection plane

Reflection runs are governed `TaskRun` records — not a parallel job system. They inherit the Operator Pattern: each reflection run has an explicit operator contract (what trigger fired, what evidence is in scope, what work products it must produce, what authority it holds, when it advances vs. waits).

#### 6.3.1 Triggers

A reflection run can be triggered by:

- loaded skill plus failed tool execution,
- repeated tool failure (already detected at `apps/web/lib/tak/agentic-loop.ts:826`; the loop persists a `PlatformIssueReport(type="agent_stuck")` row at `agentic-loop.ts:843`. The reflection trigger consumes that row — it does **not** re-detect, and the detection block must first be extracted into a named helper so both the existing report and the reflection trigger fire from one site),
- user correction or explicit dissatisfaction,
- contract violation detected by `agentic-loop`,
- repeated manual workaround,
- stale skill with high usage,
- scheduled weekly curator pass,
- Build Studio verification failure,
- low user rating or unresolved capability need,
- marketplace/import update,
- capacity-continuity scheduling (`2026-05-12-ai-capacity-continuity-design.md`).

#### 6.3.2 Outputs

Each reflection run outputs one or more of:

- `CoworkerSelfAssessment` — the assessment record itself,
- `CoworkerCapabilityNeed` (with typed `kind`) — the surfaced need,
- `ImprovementProposal` — the existing governed proposal envelope, with `category` set to `skill | prompt | memory | tool | convention | code` and `routeContext` populated; the diff and evidence carried in `description` / `conversationExcerpt` / `observedFriction` until a richer payload is justified,
- `MemoryCandidate` — only if `2026-05-14-coworker-memory-shape-contracts-design.md` does not already provide this primitive; reuse first,
- `ImprovementSignal` (per `2026-04-05-continuous-improvement-flywheel-design.md`) — the canonical input to the portfolio flywheel,
- `BacklogItem` proposal or linked evidence,
- `TaskArtifact` carrying a typed "no change" report with rationale.

The run must not mutate a production skill, prompt, memory, grant, or code file directly unless the action is explicitly policy-allowed. Mutation always goes through `ImprovementProposal` review or the Build Studio PR lane.

### 6.4 Curation plane

The curator is the supervisor of learning assets. It runs as a scheduled/event-triggered governed `TaskRun` (a `ScheduledAgentTask` whose execution becomes an operator-pattern coworker run), not a hidden side effect.

Responsibilities:

- compute skill `lifecycleState`: `active | stale | pinned | quarantined | archived` (per §6.1.1),
- identify duplicate or overlapping skills,
- flag skills with high failure rate, low usage, missing tests, missing references, or stale external source,
- propose consolidations and patches via `ImprovementProposal` (no separate proposal model),
- protect pinned skills from archive/delete,
- create dry-run reports as `TaskArtifact` records linked to the curator's `TaskRun`,
- snapshot affected artifacts as `SkillRevision` records before approved changes (mirroring the `PromptRevision` precedent),
- support rollback to a prior `SkillRevision`,
- emit each significant finding as an `ImprovementSignal` so the portfolio flywheel can prioritize across signals.

The curator should never auto-delete skills. Archive is recoverable. Curator activity must produce audit records under the curator's GAID identity, not the user's.

### 6.5 Evolution plane

Hermes self-evolution uses execution traces and eval datasets to evolve skills and other artifacts. DPF should implement the same pattern as a governed offline lane:

1. select an artifact: skill, prompt, tool description, route contract, or convention,
2. build an evaluation dataset from approved traces, tests, transcripts, and synthetic cases,
3. run optimization inside Build Studio/sandbox or a tool-evaluated provider,
4. compare baseline against candidate using deterministic tests and LLM judge where appropriate,
5. produce a diff, report, and rollback plan,
6. open a PR or backlog proposal,
7. require human/role approval before production activation.

The evolution plane must not train on private data for external providers unless that is explicitly covered by policy and customer agreement.

### 6.6 Visual control plane

The learning loop should become visible across three surfaces:

1. **Coworker chat and work surfaces**
   - show which skill was used,
   - show when a coworker filed a need,
   - show when a skill/prompt/memory improvement was proposed,
   - link to evidence and approvals.

2. **`/platform/ai/skills`**
   - skill library,
   - assignments,
   - lifecycle state,
   - metrics,
   - proposals,
   - revisions,
   - curator reports,
   - rollback and pin controls.

3. **AI Operations Map**
   - learning events as operational overlays,
   - blocked/stale/quarantined skills,
   - capability needs by value stream,
   - skill and prompt changes linked to TaskRuns and evidence.

UI must follow AGENTS.md §12 theme-aware styling: no hardcoded colors, no inline `style={{ color: "#xxx" }}`, tokens only — `text-[var(--dpf-text)]`, `text-[var(--dpf-muted)]`, `bg-[var(--dpf-surface-1|2)]`, `bg-[var(--dpf-bg)]`, `border-[var(--dpf-border)]`, `text-[var(--dpf-accent)]` / `bg-[var(--dpf-accent)]`. `<option>` elements need explicit `bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]`. Sole exception: `text-white` on accent buttons. Layout: restrained enterprise density, scannable controls, no decorative card-on-card surfaces, progressive disclosure (3–5 essential fields, advanced via coworker). The full standard is `docs/platform-usability-standards.md`.

## 7. Data Model Stewardship

### 7.1 Reuse first

The first implementation slices should reuse:

- `SkillDefinition` (extend with `lifecycleState` per §6.1.1),
- `SkillAssignment`,
- `SkillMetric`,
- `TaskRun` (use `source = "skill"` or `"proactive"` for reflection runs),
- `TaskNode`, `TaskMessage`, `TaskArtifact`,
- `DeliberationRun` (when reflection requires multi-perspective evaluation),
- `ToolExecution`,
- `ToolExecutionReceipt`,
- `PlatformIssueReport` (canonical sink for runtime issues observed by the agentic loop today; reflection consumes it, does not duplicate it),
- `ImprovementProposal` (the existing proposal envelope — no parallel `SkillImprovementProposal`),
- `CoworkerSelfAssessment`,
- `CoworkerCapabilityNeed` (with `kind` promoted to a typed enum per AGENTS.md §3),
- `PromptTemplate` + `PromptRevision` (precedent for `SkillRevision`),
- `BacklogItemActivity`,
- `ExternalEvidenceRecord`,
- `UserFact`,
- `ScheduledAgentTask` (for curator and reflection schedules).

This avoids inventing a separate "learning system" alongside DPF's existing governance substrate.

### 7.2 New or extended concepts

The holistic design likely needs the following additions, introduced only when required by a slice. Each row names the existing primitive to extend before any new model lands.

| Concept | Purpose | Decision |
| --- | --- | --- |
| `SkillUsageEvent` | Event-level record that a skill was presented, loaded, invoked, completed, failed, or rated. | New table — `SkillMetric` is per-period aggregate and cannot carry per-event provenance. Aggregates derive from events; do not write both directly. Land in Slice 1. |
| `SkillRevision` | Immutable record of each skill content/config version and approver. | New table, modeled directly on the existing `PromptRevision` precedent (`PromptTemplate` + `PromptRevision`). Same shape, same naming, same review semantics. Land in Slice 3. |
| Skill improvement proposal | Proposed diff against a skill, with evidence and risk band. | **Reuse `ImprovementProposal`** — it already carries `category`, `severity`, `agentId`, `routeContext`, `threadId`, `submittedById`, `reviewedById`, `backlogItemId`, `buildId`, `verifiedAt`, `contributionStatus`. Add `proposedDiffJson` and `targetSkillId` only if `description`/`conversationExcerpt` cannot carry the diff cleanly. Do **not** create `SkillImprovementProposal`. |
| Reflection / curator run report | Structured output of a reflection or curator run. | Reuse `TaskRun` + `TaskArtifact` with a typed `kind` on the artifact (e.g. `learning-run-report`). Use `DeliberationRun` when the run requires multi-perspective evaluation. No new run-report table. |
| Skill operational lifecycle | `active | stale | pinned | quarantined | archived` (per §6.1.1). | New `SkillDefinition.lifecycleState` column, separate from existing adoption-stage `status`. Typed enum lands with the migration. |
| Evidence / session search | Searchable index over threads, task artifacts, tool executions, and evidence. | Start with Postgres full-text or scoped query helpers over existing tables; add vector/FTS optimization later. No new evidence table — only an indexed query service. |
| Evolution experiment | Offline optimization run with dataset, baseline, candidate, metrics, and diff. | New table only when Slice 6 lands. Until then, model experiments as Build Studio `FeatureBuild` records with typed metadata. |
| `MemoryCandidate` | Proposed memory write awaiting policy review. | Defer to `2026-05-14-coworker-memory-shape-contracts-design.md`. Reuse whatever it specifies; do not redefine. |

### 7.3 Enum discipline

Per AGENTS.md §3 ("Strongly-Typed String Enums") any fixed string status or kind must be typed in `apps/web/lib/backlog.ts` and mirrored in the MCP tool definition in `apps/web/lib/mcp-tools.ts` in the same commit, before any data uses it. Hyphenated values, not underscores.

This spec adds or formalizes the following enums on first use:

| Model.field | Values | Slice |
| --- | --- | --- |
| `SkillDefinition.lifecycleState` (new) | `active | stale | pinned | quarantined | archived` | Slice 4 |
| `CoworkerCapabilityNeed.kind` (existing String, must be typed) | `skill | prompt | memory | tool | convention | code | other` | Slice 2 |
| `ImprovementProposal.category` (existing, in use) | extend the in-use set if it does not already include `skill | prompt | memory | tool | convention`; do not redefine. | Slice 3 |
| `TaskArtifact.metadata.kind` for learning artifacts | `learning-run-report | curator-report | evolution-report | no-change-report` | Slice 2 |

Each enum extension lands as a single commit that updates code + MCP schema + migration + seeds together. Live data must not contain values absent from the typed enum.

## 8. Runtime Flows

### 8.1 Skill use telemetry

When a coworker receives a request:

1. resolve route coworker and assignments via `apps/web/lib/actions/agent-skills.ts:getSkillsForAgent`,
2. expose skill metadata (not bodies) in the composed prompt — extend `apps/web/lib/tak/prompt-assembler.ts` with a `skills` block alongside `domainTools`, and have it emit a `SkillUsageEvent` of phase `eligible` for each presented skill,
3. when a skill is loaded into the prompt body, emit a `SkillUsageEvent` of phase `loaded`,
4. when the agent invokes a skill (or a skill-attributable tool call fires), emit a `SkillUsageEvent` of phase `invoked` with the parent `taskRunId`, `threadId`, and originating `toolExecutionId` where known,
5. tie subsequent `ToolExecution` rows to the active skill via `ToolExecution.taskRunId` (already present) plus a new `ToolExecution.skillId` nullable column when the active skill is unambiguous,
6. roll `SkillUsageEvent` rows up into `SkillMetric` per period via a scheduled aggregator (no double-write from the runtime),
7. surface the active skill in the chat/coworker UI as a compact attribution affordance using DPF theme tokens (see §10).

This turns "the agent probably used a skill" into auditable product state. Telemetry must be emitted regardless of whether a reflection/curator pipeline downstream is enabled — measurement is independent of action.

### 8.2 Reflection after meaningful work

After a meaningful run:

1. The post-run observer in `apps/web/lib/tak/autonomous-work-run.ts` (called after `executeAutonomousAgenticLoop` returns) classifies whether a reflection trigger fired. It queries `PlatformIssueReport` rows produced during the run (the `agent_stuck` row written by `agentic-loop.ts:843` plus any other `coworker_runtime`-sourced reports) instead of re-implementing detection. Slice 2 starts by extracting `agentic-loop.ts:813–870` into a named helper (e.g. `detectRepeatedToolFailure` in a new `apps/web/lib/tak/runtime-issues.ts`) so the existing `PlatformIssueReport.create` and the new reflection trigger share one detection site.
2. If a trigger fires, a low-priority `TaskRun(source="skill" or "proactive")` is created via the existing `AutonomousWorkRun` facade so authority, GAID identity, and evidence trail are inherited.
3. The reflection run receives bounded evidence: recent thread summary, last N `ToolExecution` rows for this thread, loaded skills, user correction signals, task outcome. Evidence is fetched by the search service in §6.2, not by stuffing the prompt.
4. The run decides whether to produce a skill proposal (`ImprovementProposal` with `category="skill"`), a memory candidate (per memory shape contracts), a capability need (typed `kind`), a backlog item, or a typed no-change `TaskArtifact`.
5. Every non-no-change output also emits an `ImprovementSignal` (per `2026-04-05-continuous-improvement-flywheel-design.md`) so the portfolio flywheel can prioritize across signals — the reflection plane is the producer, not the prioritizer.
6. Foreground user flow does not wait on this unless the user explicitly asks to review the result immediately. The coworker UI's busy state and a notification are the user-visible signal of active reflection (per the "Agent as main conduit" pattern).

### 8.3 Curator dry-run

On schedule or admin request:

1. load skill inventory and telemetry,
2. identify stale, duplicate, risky, failing, or highly valuable skills,
3. produce a dry-run report with proposed actions,
4. allow an operator to approve, edit, reject, pin, archive, or request backlog work,
5. on approval, snapshot the current artifact,
6. apply the change with revision and audit,
7. update Operations Map and skill UI.

### 8.4 Evolution experiment

For a selected skill/prompt/tool description:

1. create an experiment from approved evidence,
2. build eval cases from real traces plus synthetic edge cases,
3. run candidate generation in sandbox,
4. score baseline and candidates,
5. emit a report with metrics and diffs,
6. file a PR, Build Studio task, or backlog proposal.

Production activation is a separate approval.

### 8.5 Graduation to deterministic behavior

When a skill or convention is repeatedly successful and stable:

1. curator marks it as a graduation candidate,
2. system proposes a backlog item for code/tool/schema/policy/test implementation,
3. Build Studio implements and verifies,
4. skill changes from "do this manually" to "use the platform primitive",
5. old procedural guidance is retained only as context or rollback support.

## 9. Governance Model

### 9.1 Change authority

| Change type | Default authority |
| --- | --- |
| Skill usage metric | Automatic |
| Reflection no-op report | Automatic |
| Coworker capability need | Automatic submission, human review |
| Memory candidate | Policy-classed approval based on sensitivity |
| Skill proposal | Human/supervisor review before activation |
| Prompt proposal | Human/supervisor review before activation |
| Skill archive | Human review, with rollback |
| Skill delete | Avoid; require elevated admin approval if ever allowed |
| External skill import | Tool Evaluation Pipeline plus assignment approval |
| Evolution experiment | Sandbox allowed; production change requires PR/review |
| Tool grant change | Existing TAK authority rules |
| Code change | Build Studio/PR path only |

### 9.2 Security controls

- External skills and tools pass the Tool Evaluation Pipeline (AGENTS.md §9, EP-GOVERN-002) before adoption.
- Skills with scripts or external sources are scanned and assigned a risk band.
- Skill-level allowed tools must be intersected with user role capabilities (`PERMISSIONS[capability].roles`) and agent grants (`config_profile.tool_grants`) per `apps/web/lib/agent-grants.ts:getAvailableTools`. Both must permit the tool.
- Prompt-injection scanning applies to imported skills, memory candidates, and tool results.
- Secrets must never be written into skills, memory, proposals, or curator reports.
- Principal/GAID identity must be used for new actor attribution surfaces. New identity-bearing entities introduced after 2026-05-09 must be modeled as `PrincipalAlias` linked to a single `Principal` (AGENTS.md §11).
- All approved changes produce `ToolExecution` audit records and revision history (`SkillRevision`, `PromptRevision`).

### 9.3 Delivery governance

This spec inherits the AGENTS.md §4 delivery contract — the spec does not relax these:

- Every change lands via a PR against `main` from a topic branch (`feat/<slug>`, etc.).
- Every commit carries a DCO `Signed-off-by:` trailer (`git commit -s`); the DCO bot blocks merge otherwise.
- Concurrent slice work uses one git worktree per session (`git worktree add ../DPF-<topic> -b <prefix>/<topic>`) — never share a working tree.
- The build gate (AGENTS.md §5) — vitest + `next build` + UX verification + clean migration — is mandatory per slice; Build-Studio-produced PRs cannot fail CI typecheck.
- Theme-token compliance (AGENTS.md §12) is part of the build gate for every UI surface this spec touches.

## 10. UI and UX Requirements

The user experience should make DPF feel capable and trustworthy, not like a lab notebook.

### 10.1 Skills library

`/platform/ai/skills` should evolve into a proper Skills Observatory:

- library table with lifecycle, risk, source, assignment count, usage, success rate, stale state,
- detail view with skill body, assets, revisions, assignments, metrics, proposals, evidence,
- curator report tab,
- pin/archive/rollback controls,
- import/evaluate flow for external skills,
- "graduate to platform primitive" action when a skill is stable.

### 10.2 Coworker detail

Each coworker detail page should show:

- assigned skills,
- most used skills,
- failing/stale skills,
- recent learning events,
- open capability needs,
- pending improvement proposals,
- recent user corrections,
- recent prompt/memory/skill changes.

### 10.3 Chat and route work surfaces

When a skill materially guides work, the panel should show a small attribution affordance:

- skill name,
- version,
- status,
- why it was selected,
- link to evidence and review.

This should be compact and work-focused. Avoid marketing copy, oversized hero layouts, or decorative visuals.

### 10.4 Operations Map overlay

Learning events should appear as operational signals:

- yellow/attention state for proposed improvements,
- blocked state for capability needs,
- stale state for skill decay,
- verified state for approved improvements with receipts,
- rollback state for reverted changes.

Use existing DPF theme tokens and platform nav. Do not introduce a parallel visual shell.

## 11. Incremental Agile Delivery Plan

This is intentionally holistic, but implementation should land in thin slices.

### Slice 0: Spec and backlog alignment

- Land this spec.
- File or link backlog items under `EP-TAK-3F9A21` or a dedicated skills-learning epic if product leadership chooses one.
- Define the exact first release boundary.

Acceptance:

- spec is reviewable,
- related backlog is live,
- first implementation slice has clear acceptance criteria.

### Slice 1: Skill usage telemetry and attribution

- Add `SkillUsageEvent` model (per §7.2) with phases `eligible | loaded | invoked | completed | failed | rated`.
- Extend `apps/web/lib/tak/prompt-assembler.ts` to emit `eligible` and `loaded` events when composing the prompt, and to expose a `skills` block alongside `domainTools`.
- Add `ToolExecution.skillId` (nullable) and have `apps/web/lib/tak/agentic-loop.ts` populate it when the active skill is unambiguous.
- Add a scheduled aggregator that rolls `SkillUsageEvent` into `SkillMetric` per period; runtime never writes to `SkillMetric` directly.
- Show skill attribution in the coworker chat panel and `/platform/ai/skills` detail (theme-token compliant).

Acceptance:

- a run can prove which skill was eligible, loaded, and used, with row-level evidence,
- `SkillMetric` is no longer empty after exercised flows and is the same value as the aggregator's recomputation,
- vitest covers event emission, attribution, and aggregator idempotency,
- `next build` clean; UX verification confirms skill chip appears in coworker chat.

### Slice 2: Reflection triggers and skill capability needs

- Extract the repeated-tool detection block at `apps/web/lib/tak/agentic-loop.ts:813–870` into a named helper in `apps/web/lib/tak/runtime-issues.ts` so both the existing `PlatformIssueReport.create` write and the new reflection trigger share one detection site.
- Add post-run hook in `apps/web/lib/tak/autonomous-work-run.ts` that classifies whether a reflection trigger fired by querying `PlatformIssueReport` rows produced during the run.
- When a trigger fires, spawn a low-priority `TaskRun(source="skill" or "proactive")` via the existing autonomous-run facade.
- Promote `CoworkerCapabilityNeed.kind` from free-form String to typed enum in `apps/web/lib/backlog.ts` + `mcp-tools.ts` (per AGENTS.md §3) — values: `skill | prompt | memory | tool | convention | code | other`.
- Persist review outputs as `CoworkerSelfAssessment` + `CoworkerCapabilityNeed(kind="skill")` and emit one `ImprovementSignal` per non-trivial finding.
- Link evidence (tool/thread/run/artifact references) to the triggering rows.

Acceptance:

- a failing skill path creates a reviewable need with submitter attribution and an `ImprovementSignal`,
- no production skill content changes automatically,
- `CoworkerCapabilityNeed.kind` is enum-validated everywhere it is set or filtered,
- capability-needs UI can filter skill-related needs,
- vitest covers trigger classification + signal emission; `next build` clean.

### Slice 3: Skill improvement proposals

- Reuse `ImprovementProposal` with `category="skill"` and a `targetSkillId` reference; add `proposedDiffJson` only if the existing text fields cannot carry the diff cleanly.
- Add `SkillRevision` model directly mirroring the `PromptRevision` shape (immutable per-version record, approver, snapshot).
- Support approve, edit, reject, and link-to-backlog actions on `ImprovementProposal` for `category="skill"`.
- Activation writes a new `SkillRevision`, then updates `SkillDefinition.skillMdContent` (the seed pattern: patch the seed file too if the change should survive a fresh install — Mark's "fix the seed, not the runtime" rule).
- Rollback restores from a prior `SkillRevision` and writes a new revision.

Acceptance:

- a coworker can submit an `ImprovementProposal(category="skill")` with diff and evidence,
- an operator can inspect evidence and diff in `/platform/ai/skills` detail,
- approved change creates a `SkillRevision` and updates `SkillDefinition` atomically,
- rollback restores prior `skillMdContent` and writes a new revision (no in-place mutation),
- vitest covers approval, rollback, and seed-vs-runtime drift detection.

### Slice 4: Curator dry-run and lifecycle states

- Add `SkillDefinition.lifecycleState` column with typed enum (per §6.1.1 and §7.3); migration also seeds initial lifecycle for every existing skill.
- Add curator run as a `ScheduledAgentTask` whose execution is a governed coworker `TaskRun` (operator-pattern compliant — explicit operator contract, named work products).
- Produce dry-run reports for stale, duplicate, failing, unassigned, or high-value skills as `TaskArtifact` rows with `metadata.kind="curator-report"`.
- Curator emits `ImprovementSignal` and (optionally) `ImprovementProposal` rows; never mutates skills directly.

Acceptance:

- curator runs without any direct skill mutation,
- report is visible in `/platform/ai/skills` with theme-token UI,
- pinned skills cannot be archived by curator (invariant test),
- `SkillDefinition.lifecycleState` enum is enforced in TS + MCP schema + DB constraint,
- vitest covers curator findings + dry-run guarantee; `next build` clean.

### Slice 5: Evidence/session search

- Add scoped search over thread, task, artifact, tool, and evidence records.
- Make reflection and curator runs use search instead of raw prompt stuffing.
- Add UI links from proposals to evidence search results.

Acceptance:

- operator can find prior similar failures,
- reflection prompts receive bounded evidence summaries,
- memory and evidence search remain separate concepts.

### Slice 6: Evolution lab

- Add sandboxed experiment flow for one artifact type, starting with skills.
- Generate eval cases from approved evidence.
- Compare baseline and candidate.
- Emit report and diff; do not auto-activate.

Acceptance:

- a skill experiment produces a benchmark report,
- candidate diff can be filed to backlog or PR,
- private data use is policy-gated.

### Slice 7: External skill import and marketplace governance

- Reconcile existing skills marketplace design with the new curator/evaluation flow.
- Import external skill metadata into discovered/quarantined state.
- Require evaluation before approval and assignment.

Acceptance:

- imported skills are inert until approved,
- risk band and source provenance are visible,
- external scripts do not run before evaluation.

### Slice 8: UX consolidation

- Consolidate learning state across Skills, Capability Needs, Operations Map, and Coworker detail.
- Replace fragmented admin-only views with an operator narrative.
- Add route-level UX verification for the full loop.

Acceptance:

- an operator can answer: what did the coworker learn, why, who approved it, and how do we undo it,
- UI remains theme-aware and accessible,
- no hardcoded colors or parallel nav.

## 12. Refactoring Commitments

Each implementation slice should spend real effort reducing fragmentation:

1. **Split `apps/web/lib/actions/agent-coworker.ts`** (currently 1,793 lines, well past the AGENTS.md soft limit for action files) along the seams this work surfaces — skill resolution + attribution should leave that file and live in a dedicated `apps/web/lib/skills/runtime.ts` service. Route handlers consume the service. Slice 1 must perform this extraction, not defer it.
2. **Add a `skills` block to `apps/web/lib/tak/prompt-assembler.ts`** as a peer of `domainTools`, and keep the prompt assembler a pure composition layer — no curator or reflection logic in prompt strings.
3. **Reuse `TaskRun` for learning work** instead of creating one-off job state. Reflection, curator, and evolution runs all flow through `AutonomousWorkRun`.
4. **Reuse `ImprovementProposal` and `CoworkerCapabilityNeed`** for agent-submitted needs and proposed diffs — do not introduce a parallel proposal table.
5. **Keep `ToolExecution` as the action audit source**; do not invent a second tool log. Add `ToolExecution.skillId` to bind action evidence to skill attribution.
6. **Treat `SkillMetric` as aggregate state** derived from `SkillUsageEvent`; runtime never writes to both directly.
7. **Prefer typed status constants** in `apps/web/lib/backlog.ts` and MCP schema updates in `apps/web/lib/mcp-tools.ts` over ad hoc strings (AGENTS.md §3).
8. **Keep UI projections over canonical runtime records.** The `/platform/ai/*` surfaces and the Operations Map overlay must read from `SkillDefinition`, `SkillUsageEvent`, `SkillMetric`, `ImprovementProposal`, `CoworkerCapabilityNeed`, and `TaskRun` directly — never a parallel UI state store.
9. **Mirror `PromptRevision` for `SkillRevision`.** Same shape, same naming, same review semantics — discoverable for any operator who already knows the prompt revision pattern.

## 13. Acceptance Criteria

The holistic program is successful when:

1. every meaningful coworker run can show which skill, prompt, memory, tools, and grants shaped it,
2. skill use produces metrics and evidence,
3. coworkers can submit skill/prompt/memory/tool needs with attribution,
4. proposed improvements are reviewable and reversible,
5. curator dry-runs produce useful reports without hidden mutation,
6. external skill adoption is evaluated before activation,
7. offline evolution produces benchmarked diffs instead of production drift,
8. stable repeated skill behavior graduates into code, policy, schema, tests, or tools,
9. the operator UI makes learning visible and governable,
10. no implementation bypasses TAK, GAID, DPF theme rules, or PR-based delivery.

## 14. Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Hidden self-modification erodes trust | No production mutation without review, revisions, and rollback. |
| Skill sprawl overwhelms users | Curator lifecycle, pinning, archive, duplicate detection, and assignments. |
| Metrics become vanity numbers | Tie metrics to outcomes: success, failures, user corrections, evidence, and backlog impact. |
| Memory and evidence get conflated | Keep policy-classed memory separate from evidence/session search. |
| External skills introduce malicious instructions | Quarantine, scan, evaluate, risk-band, and approve before assignment. |
| UI becomes too complex | Use progressive disclosure: overview, filters, detail panels, evidence links. |
| Evolution overfits to small traces | Require held-out eval cases, manual review, and production monitoring after activation. |
| Refactoring stalls delivery | Slice by slice: each PR must improve one runtime seam and one visible outcome. |
| Lifecycle vocabulary fragmentation | Adoption-stage `status` and operational `lifecycleState` are intentionally separate (per §6.1.1); both are typed enums; the marketplace spec is updated in the same migration commit so the platform speaks one vocabulary. |
| Substrate duplication via copy-paste from Hermes | Reviewers gate every new model against the §7.1 reuse list; the §7.2 table requires a stated reason any new table cannot be an extension of an existing one. |
| Reflection plane outruns the flywheel | Reflection emits `ImprovementSignal` rows only — prioritization stays in the flywheel. Removing this discipline is treated as a regression. |
| Seed/runtime drift on approved skill changes | Skill activation patches the seed file (`skills/<category>/<name>.skill.md`) in the same commit as the runtime mutation; an invariant guard in seed verifies parity on boot ("fix the seed, not the runtime"). |
| Cross-session sweep on concurrent slice work | Per AGENTS.md §4 each slice runs in its own `git worktree`; PR checks include a branch-guard so commits never sweep across sessions. |

## 15. Resolved Decisions and Open Questions

### 15.1 Resolved during spec drafting

| Question | Decision | Anchor |
| --- | --- | --- |
| New `SkillImprovementProposal` table vs. typed `CoworkerCapabilityNeed(kind="skill")` with diff JSON? | Neither — reuse `ImprovementProposal` with `category="skill"` and `targetSkillId`. | §7.2 |
| Lifecycle state on `SkillDefinition` or a separate model? | Separate column on `SkillDefinition`: `lifecycleState` (operational health) is distinct from `status` (adoption stage); both typed enums. | §6.1.1, §7.3 |
| Where does the reflection trigger consume "agent stuck" signal? | The existing `PlatformIssueReport(type="agent_stuck")` row at `agentic-loop.ts:843`. Slice 2 extracts detection into one shared helper so both writes fire from the same site. | §3.1, §6.3.1, §8.2 |

### 15.2 Open

1. **Review authority for low-risk skill text changes.** Default proposal: "agent owner approves; AI Ops audits weekly," pending product-owner sign-off. Resolve before Slice 3 ships.
2. **Primary operator home for learning.** Operations Map overlay (`2026-05-10-ai-coworker-visual-control-surface-design.md`) is the platform-wide projection; `/platform/ai/skills` is the skill-domain deep view; coworker detail is the agent-domain deep view. Recommendation: Operations Map is the entry point; confirm with product before Slice 8.
3. **Evidence usable in evolution experiments when an install contains customer/private data.** Reuse the policy classes in `2026-05-14-coworker-memory-shape-contracts-design.md` rather than redefine; that spec must land its policy taxonomy before Slice 6 starts.
4. **Skill-script execution surface.** Build Studio/sandbox only, or low-risk deterministic scripts allowed in portal runtime under strict allowlists? Default to sandbox-only until a concrete portal use case forces the question.
5. **Capacity-continuity handoff.** When a reflection-triggered run needs scheduled capacity, how does the contract handshake with `2026-05-12-ai-capacity-continuity-design.md`? Cross-reference only; do not re-spec here.
6. **HITL Mobile Companion approvals.** Should curator findings be approvable from `2026-05-13-realtime-hitl-mobile-companion-design.md`, or only from desktop operator surfaces? Defer to mobile companion spec's scope decision.
7. **Forward-dependency sequencing.** `ImprovementSignal` (flywheel spec) and `MemoryCandidate` (memory shape contracts spec) are both Draft. Concretely: does the Hermes spec block on those landing first, or do all three move as a coordinated wave? Recommend coordinated wave with a single program-level review.

## 16. First Implementation Recommendation

Start with Slice 1 and Slice 2 together as the first agile increment, executed under one topic branch (`feat/skill-telemetry-and-reflection`) in its own worktree (per AGENTS.md §4):

- `SkillUsageEvent` model + migration,
- `apps/web/lib/tak/prompt-assembler.ts` `skills` block + event emission,
- `ToolExecution.skillId` (nullable) + agentic-loop binding,
- scheduled `SkillUsageEvent` → `SkillMetric` aggregator,
- detection helper extracted from `agentic-loop.ts:813–870` into `apps/web/lib/tak/runtime-issues.ts`, with both the existing `PlatformIssueReport.create` and the new reflection trigger flowing through it,
- post-run reflection hook in `apps/web/lib/tak/autonomous-work-run.ts` (consuming `PlatformIssueReport` rows produced during the run),
- `CoworkerCapabilityNeed.kind` promoted to typed enum in `backlog.ts` + `mcp-tools.ts`,
- skill-related `CoworkerCapabilityNeed` + `ImprovementSignal` emission,
- skill attribution chip in coworker chat + `/platform/ai/skills` detail (theme-token compliant),
- vitest covering attribution, aggregator idempotency, trigger classification, no-direct-mutation, and enum enforcement.

This is bigger than a tiny patch but still bounded. It creates the measurement spine for everything else and proves the corporate-governed version of Hermes-style self-improvement without prematurely introducing curator mutation, marketplace import, or offline optimization. Crucially it adds **zero new proposal substrate** — proposals reuse `ImprovementProposal`, signals reuse the flywheel — so the increment validates the reuse-first principle before any later slice is allowed to add a new model.

Slice 3 (proposals + `SkillRevision`) and Slice 4 (curator + `lifecycleState`) can run in parallel worktrees once Slice 1+2 lands, since they share no schema collisions.
