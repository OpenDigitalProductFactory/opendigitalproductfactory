# Governed Hermes-Style Coworker Learning Loop Design

| Field | Value |
| --- | --- |
| Date | 2026-05-15 |
| Status | Draft for review |
| Related epics | EP-TAK-3F9A21 |
| Related repo areas | `apps/web/lib/actions/agent-coworker.ts`, `apps/web/lib/tak/agentic-loop.ts`, `apps/web/lib/tak/autonomous-work-run.ts`, `apps/web/lib/tak/prompt-assembler.ts`, `apps/web/lib/tak/governed-memory.ts`, `apps/web/lib/actions/agent-skills.ts`, `apps/web/lib/actions/skill-discovery.ts`, `apps/web/lib/actions/skills-observatory.ts`, `apps/web/lib/coworker-self-assessment/*`, `apps/web/app/(shell)/platform/ai/*`, `packages/db/prisma/schema.prisma`, `skills/`, `prompts/` |
| Related standards | `AGENTS.md`, `docs/architecture/trusted-ai-kernel.md`, `docs/architecture/GAID.md`, `docs/architecture/agent-standards-dpf-conformance.md`, `docs/architecture/ai-coworker-development-principles.md` |
| Related specs | `2026-03-30-ai-coworker-skills-marketplace.md`, `2026-04-05-continuous-improvement-flywheel-design.md`, `2026-04-30-ai-coworker-operator-pattern.md`, `2026-04-30-build-specialist-operator-contract.md`, `2026-04-25-tak-gaid-auth-identity-memory-refresh-design.md`, `2026-05-10-ai-coworker-visual-control-surface-design.md`, `2026-05-11-autonomous-coworker-runtime-design.md`, `2026-05-11-ai-routing-ux-verification-test-architecture-design.md` |

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

The immediate architectural signal is clear: DPF has the primitives, but not the integrated learning loop.

### 3.2 Existing strengths to preserve

DPF already has:

- `SkillDefinition`, `SkillAssignment`, and `SkillMetric` as a first-class skill substrate.
- `TaskRun`, `TaskNode`, `TaskMessage`, and `TaskArtifact` as governed work identity.
- `ToolExecution` and `ToolExecutionReceipt` as audit and evidence.
- `CoworkerSelfAssessment` and `CoworkerCapabilityNeed` as coworker-submitted improvement needs.
- TAK/GAID standards for authority, identity, memory policy, and verifiable agent behavior.
- `/platform/ai/*` surfaces for skills, authority, history, prompts, routing, model assignment, and capability needs.
- The AI Operations Map direction for visualizing coworker state as operational flow.

### 3.3 Current gaps

The gaps are coordination and product experience, not raw table count:

1. Skill metrics are not populated, so skill effectiveness is mostly invisible.
2. Skill use is not consistently attributed in the active chat/run UI.
3. Coworkers can submit capability needs, but there is no full skill-improvement proposal workflow.
4. Self-assessment is not yet tied to skill usage, failed tools, repeated user corrections, or stale playbooks.
5. There is no governed curator that can dry-run lifecycle changes, propose consolidation, or protect pinned skills.
6. Session history is persisted, but there is no operator-grade search/replay layer equivalent to Hermes session search.
7. Offline evolution is not separated from production mutation as a formal Build Studio or sandbox lane.
8. Skills, prompts, memory, tool grants, and route context are still spread across multiple admin views instead of one learning narrative.

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
2. **Procedural memory belongs in skills.** Repeated workflows, work instructions, validation steps, scripts, and templates should be skills, not long prompt paragraphs or user facts.
3. **Facts belong in governed memory.** User, organization, route, and domain facts must remain policy-classed and freshness-aware.
4. **Evidence first.** Every proposed improvement must cite the run, tool call, thread, artifact, user correction, test, or benchmark that caused it.
5. **Refactor while implementing.** Each slice should reduce fragmentation between skills, prompts, runtime evidence, and UI rather than create a parallel subsystem.
6. **Visible learning builds trust.** Operators should see what changed, why, who proposed it, who approved it, and how to roll it back.
7. **Autonomy stops at risk boundaries.** Low-risk draft proposals can be automatic; activation, external imports, tool grants, prompt changes, or code changes use explicit approval.
8. **Stable behavior graduates to code.** When a skill becomes a repeated deterministic workflow, the platform should file a graduation candidate to turn it into code, policy, schema, tests, or a first-class tool.

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

DPF should add background learning reviews as first-class `TaskRun` records. A reflection run can be triggered by:

- loaded skill plus failed tool execution,
- repeated tool failure,
- user correction or explicit dissatisfaction,
- contract violation detected by `agentic-loop`,
- repeated manual workaround,
- stale skill with high usage,
- scheduled weekly curator pass,
- Build Studio verification failure,
- low user rating or unresolved capability need,
- marketplace/import update.

Each reflection run outputs one or more of:

- `CoworkerSelfAssessment`,
- `CoworkerCapabilityNeed`,
- `SkillImprovementProposal`,
- `PromptImprovementProposal`,
- `MemoryCandidate`,
- `ConventionCandidate`,
- `BacklogItem` proposal or linked evidence,
- "no change" report with rationale.

The run must not mutate a production skill, prompt, memory, grant, or code file directly unless the action is explicitly policy-allowed.

### 6.4 Curation plane

The curator is the supervisor of learning assets. It should run as a scheduled/event-triggered governed job, not a hidden side effect.

Responsibilities:

- compute skill lifecycle state: active, stale, archived, pinned, quarantined, proposed,
- identify duplicate or overlapping skills,
- flag skills with high failure rate, low usage, missing tests, missing references, or stale external source,
- propose consolidations and patches,
- protect pinned skills from archive/delete,
- create dry-run reports before mutation,
- snapshot affected artifacts before approved changes,
- support rollback to prior revision,
- file capability needs or backlog items when the curator cannot act.

The curator should never auto-delete skills. Archive is recoverable.

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

UI must follow `AGENTS.md` theme-aware styling: no hardcoded colors, tokenized text/surface/border/accent values, restrained enterprise layout, dense but scannable controls, and no decorative card-on-card surfaces.

## 7. Data Model Stewardship

### 7.1 Reuse first

The first implementation slices should reuse:

- `SkillDefinition`,
- `SkillAssignment`,
- `SkillMetric`,
- `TaskRun`,
- `TaskArtifact`,
- `ToolExecution`,
- `ToolExecutionReceipt`,
- `CoworkerSelfAssessment`,
- `CoworkerCapabilityNeed`,
- `BacklogItemActivity`,
- `ExternalEvidenceRecord`,
- `UserFact`.

This avoids inventing a separate "learning system" alongside DPF's existing governance substrate.

### 7.2 New or extended concepts

The holistic design likely needs the following additions, introduced only when required by a slice:

| Concept | Purpose | Initial implementation guidance |
| --- | --- | --- |
| `SkillUsageEvent` | Event-level record that a skill was presented, loaded, invoked, completed, failed, or rated. | Add before expanding `SkillMetric`; aggregate metrics can be derived. |
| `SkillRevision` | Immutable record of each skill content/config version and approver. | Required before curator or proposal application can mutate skills. |
| `SkillImprovementProposal` | Proposed diff against a skill, with evidence and risk band. | Can initially be modeled as `CoworkerCapabilityNeed(kind="skill")` plus JSON diff if avoiding a table in slice 1. |
| `LearningRunReport` | Structured output of reflection or curator run. | Can initially be a `TaskArtifact` with a typed metadata contract. |
| `SkillLifecycleState` | Active, stale, archived, pinned, quarantined, proposed. | Can start as fields on `SkillDefinition`; split later if history requires it. |
| `EvidenceSearchIndex` | Searchable index over threads, task artifacts, tool executions, and evidence. | Start with Postgres full-text or scoped query helpers; add vector/FTS optimization later. |
| `EvolutionExperiment` | Offline optimization run with dataset, baseline, candidate, metrics, and diff. | Belongs in Build Studio or a dedicated sandbox model once needed. |

### 7.3 Enum discipline

Any fixed string status or kind must be typed in TypeScript and mirrored in MCP schemas in the same commit. Hyphenated values should follow existing backlog conventions.

## 8. Runtime Flows

### 8.1 Skill use telemetry

When a coworker receives a request:

1. resolve route coworker and assignments,
2. expose skill metadata in prompt/context,
3. record which skills were eligible,
4. record which skill was loaded or invoked,
5. tie subsequent tool executions and outcomes back to the active skill where possible,
6. aggregate usage into `SkillMetric`,
7. surface the active skill in the UI.

This turns "the agent probably used a skill" into auditable product state.

### 8.2 Reflection after meaningful work

After a meaningful run:

1. `agentic-loop` or a post-run observer classifies whether a reflection trigger fired,
2. a low-priority `TaskRun(source="skill" or "proactive")` is created,
3. the reflection run receives bounded evidence: recent thread summary, tool executions, loaded skills, user correction, task outcome,
4. the run decides whether to produce a skill proposal, memory candidate, capability need, or no-op report,
5. outputs are persisted as reviewable records.

Foreground user flow should not wait on this unless the user explicitly asks to review the result immediately.

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

- External skills and tools pass the Tool Evaluation Pipeline before adoption.
- Skills with scripts or external sources are scanned and assigned a risk band.
- Skill-level allowed tools must be intersected with user role and agent grants.
- Prompt-injection scanning applies to imported skills, memory candidates, and tool results.
- Secrets must never be written into skills, memory, proposals, or curator reports.
- Principal/GAID identity must be used for new actor attribution surfaces.
- All approved changes produce audit records and revision history.

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

- Add event-level skill usage tracking or a minimal equivalent.
- Populate `SkillMetric`.
- Tie skill usage to `TaskRun`, `AgentThread`, and `ToolExecution` where possible.
- Show skill attribution in coworker UI and `/platform/ai/skills`.

Acceptance:

- a run can prove which skill was eligible, loaded, and used,
- `SkillMetric` is no longer empty after exercised flows,
- tests cover metric recording and attribution.

### Slice 2: Reflection triggers and skill capability needs

- Trigger background review after repeated tool failure, user correction, or loaded-skill failure.
- Persist review as `TaskRun` plus `CoworkerSelfAssessment` or `CoworkerCapabilityNeed(kind="skill")`.
- Link evidence to the triggering tool/thread/run.

Acceptance:

- a failing skill path creates a reviewable need with submitter attribution,
- no production skill content changes automatically,
- capability-needs UI can filter skill-related needs.

### Slice 3: Skill improvement proposals

- Add a proposal representation for skill diffs.
- Support approve, edit, reject, and link-to-backlog actions.
- Persist pre-change revision snapshots.

Acceptance:

- a coworker can propose a skill patch,
- an operator can inspect evidence and diff,
- approved change creates revision history.

### Slice 4: Curator dry-run and lifecycle states

- Add curator run service.
- Produce dry-run reports for stale, duplicate, failing, unassigned, or high-value skills.
- Add pinned, stale, archived, and quarantined lifecycle states.

Acceptance:

- curator can run without mutation,
- report is visible in `/platform/ai/skills`,
- pinned skills cannot be archived by curator.

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

1. Centralize skill resolution, attribution, and telemetry in a dedicated service instead of scattering it through route handlers.
2. Keep prompt assembly as a composition layer; do not embed curator or reflection logic directly into prompt strings.
3. Reuse `TaskRun` for learning work instead of creating one-off job state.
4. Reuse `CoworkerCapabilityNeed` for agent-submitted needs until a proposal table is justified.
5. Keep `ToolExecution` as the action audit source; do not invent a second tool log.
6. Treat `SkillMetric` as aggregate state and add event records only when aggregates are insufficient.
7. Prefer typed status constants and MCP schema updates over ad hoc strings.
8. Keep UI projections over canonical runtime records; do not let the UI become a separate state store.

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

## 15. Open Questions

1. Should the first proposal object be a new `SkillImprovementProposal` table or a typed `CoworkerCapabilityNeed(kind="skill")` with `evidenceJson` carrying the diff?
2. Should lifecycle state live on `SkillDefinition` first, or should revisions/lifecycle be modeled separately from the start?
3. What is the review authority for low-risk skill text changes: AI Ops, agent owner, platform admin, or route owner?
4. Which UI route should become the primary operator home for learning: `/platform/ai/skills`, `/platform/ai/operations`, or a coworker detail page?
5. What evidence can be used in evolution experiments when an install contains customer/private data?
6. Should skill scripts run only in Build Studio/sandbox, or can low-risk deterministic scripts run in the portal runtime under strict allowlists?

## 16. First Implementation Recommendation

Start with Slice 1 and Slice 2 together as the first agile increment:

- skill usage telemetry,
- visible skill attribution,
- reflection trigger for loaded-skill failure,
- skill-related `CoworkerCapabilityNeed`,
- tests around attribution and no-direct-mutation.

This is bigger than a tiny patch but still bounded. It creates the measurement spine for everything else and proves the corporate-governed version of Hermes-style self-improvement without prematurely introducing curator mutation, marketplace import, or offline optimization.
