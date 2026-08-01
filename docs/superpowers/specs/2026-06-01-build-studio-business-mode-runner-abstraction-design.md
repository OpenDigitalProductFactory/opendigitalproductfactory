---
title: Build Studio Business Mode and Runner Abstraction
authoredAt: 2026-06-01
authoredBy: codex
status: draft-for-operator-review
specKind: design
relatedSpecs:
  - docs/superpowers/specs/2026-04-25-build-studio-redesign-design.md
  - docs/superpowers/specs/2026-05-20-build-studio-layout-redesign-design.md
  - docs/superpowers/specs/2026-05-09-build-execution-provider-design.md
  - docs/superpowers/specs/2026-04-29-coworker-execution-adapter-substrate-design.md
  - docs/superpowers/specs/2026-04-29-cli-execution-adapter-routing-design.md
  - docs/superpowers/specs/2026-04-23-a2a-aligned-coworker-runtime-design.md
  - docs/superpowers/specs/2026-05-31-pseudo-user-contract-design.md
  - docs/superpowers/specs/2026-05-30-build-studio-right-sizing-design.md
  - docs/superpowers/specs/2026-05-30-dpf-native-skill-equivalents-design.md
  - docs/superpowers/specs/2026-05-19-build-studio-single-status-command-spine-design.md
relatedEpics:
  - EP-BUILD-STUDIO-UX
  - EP-BUILD-STUDIO
  - EP-9FC5D2FD
  - EP-GROK-001
  - EP-COWORKER-INTERACTIVITY
  - EP-A2A
relatedPrinciples:
  - docs/founder-kernel/wiki/principles/architecture-over-shortcuts.md
  - docs/founder-kernel/wiki/principles/single-source-of-truth.md
  - docs/founder-kernel/wiki/principles/never-fabricate.md
  - docs/founder-kernel/wiki/principles/research-and-use-standards.md
  - docs/founder-kernel/wiki/principles/responsible-capacity-utilization.md
  - docs/founder-kernel/wiki/principles/no-assumptions.md
externalReferences:
  - https://microsoft.github.io/autogen/dev/index.html
  - https://microsoft.github.io/autogen/dev/user-guide/agentchat-user-guide/index.html
  - https://microsoft.github.io/autogen/dev/user-guide/core-user-guide/index.html
  - https://microsoft.github.io/autogen/dev/user-guide/core-user-guide/design-patterns/handoffs.html
  - https://docs.langchain.com/oss/python/langchain/multi-agent/index
  - https://docs.langchain.com/oss/python/langgraph/overview
  - https://docs.langchain.com/oss/python/langgraph/interrupts
  - https://docs.langchain.com/oss/python/langchain/frontend/human-in-the-loop
  - https://adk.dev/workflows/
  - https://docs.crewai.com/en/introduction
  - https://docs.aws.amazon.com/bedrock/latest/userguide/agents-multi-agent-collaboration.html
  - https://learn.microsoft.com/en-us/semantic-kernel/frameworks/agent/agent-orchestration/group-chat
  - https://developers.openai.com/api/docs/guides/agents/orchestration
  - https://developers.openai.com/api/docs/guides/agents/guardrails-approvals
  - https://developers.openai.com/api/docs/guides/agents/integrations-observability
  - https://developers.openai.com/api/docs/guides/agent-evals
  - https://code.claude.com/docs/en/legal-and-compliance
  - https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan
  - https://docs.x.ai/build/overview
  - https://docs.x.ai/build/cli/headless-scripting
  - https://docs.x.ai/developers/models/grok-build-0.1
  - https://docs.github.com/en/actions/how-tos/monitor-workflows/use-workflow-run-logs
  - https://docs.gitlab.com/ci/pipelines/
  - https://docs.gitlab.com/ci/jobs/
  - https://docs.replit.com/core-concepts/agent/
  - https://linear.app/docs
---

# Build Studio Business Mode and Runner Abstraction

## Executive decision

Build Studio should split into two experience levels over one execution engine:

1. **Business Mode** is the default for install owners and non-developer users. It is coworker-led, artifact-first, and approval-oriented. It hides code, terminal output, branches, internal IDs, model/provider names, MCP tool names, and workflow graphs unless the user explicitly opens advanced details.
2. **Power Mode** is for Mark, developers, platform operators, and support. It preserves the current operational Build Studio surface: workflow graph, fleet rail, node inspectors, details drawer, dispatch history, source diffs, runner/session data, skills, MCP tools, and technical traces.

The execution layer becomes provider-neutral. Claude Code, Codex, Grok, and DPF-native runners all feed the same normalized Build Studio event projection. The UI renders business artifacts, questions, screenshots, verification, and approval states from those projected events.

This spec is a UX/projection amendment over the existing Build Studio, Pseudo-User Contract, A2A/TaskRun, coworker-substrate, and CLI-adapter work. It must not introduce a parallel approval system, workflow database, task graph, or provider-specific UX surface.

The guiding acceptance test is the operator's "wife test":

> A capable non-developer can describe desired platform functionality, answer business questions, inspect a working result visually, request changes conversationally, and approve the outcome without seeing code, terminal output, model names, git concepts, or raw tool traces.

## Problem

Build Studio's current surface is too technical for the intended audience.

The repository already contains strong operational machinery:

- `apps/web/components/build/BuildStudio.tsx` renders the current active-build shell with fleet rail, workflow graph, node inspector, details drawer, action card, assurance row, release panel, and shared sandbox footer.
- `apps/web/components/build-studio/BuildStudioV2.tsx` prototypes a calmer conversational/artifact shell with business brief, preview, walkthrough, plain change, and diff tabs.
- `apps/web/lib/integrate/build-orchestrator.ts` dispatches specialist tasks and can route through `BuildAgentRunner` implementations.
- `apps/web/lib/integrate/sandbox/agent-runner-types.ts` already defines `BuildAgentId = "codex" | "claude" | "dpf-native"` with provider compatibility checks.
- `packages/db/prisma/schema.prisma` already has durable sources: `FeatureBuild`, `BusinessBuildBrief`, `BuildActivity`, `BuildDispatchAttempt`, `BuildPhaseRun`, `ToolExecution`, `WorkCapsule`, `WorkCapsuleActivity`, `AgentThread` CLI session fields, and `SkillDefinition`.
- The Pseudo-User Contract already defines the delegated-coworker approval, screen-manifest, and audit-envelope direction for user-visible actions.
- The A2A-aligned coworker runtime already identifies `TaskRun`/`TaskNode` as the long-term task and handoff substrate.
- The CLI execution adapter routing spec already defines adapter event normalization, capability profiles, and `CliSessionService` direction for Claude/Codex-style execution surfaces.

The product problem is not lack of power. It is that Build Studio exposes too much of the machinery in the default experience.

The Dale dogfood run captured this clearly:

- internal identifiers leaked (`FB-*`, `WC-*`, branch names)
- "sandbox", "capsule", "code intel", "BOM", model registry paths, tool names, and status internals appeared in business-facing copy
- progress visibility failed around long-running async tools
- a non-developer user could not tell whether the coworker was working, blocked, or asking for a business decision
- when the strong-provider gate was fixed, the successful behavior was plain-English questioning and progress, not more technical detail

This spec makes that split explicit: business users get outcomes and decisions; power users get machinery and traceability.

## Current functionality audit

### Current `apps/web/components/build/` surface

Keep, but reclassify most of it as Power Mode or advanced drill-in.

| Current function | Current code | Future disposition |
| --- | --- | --- |
| Create build from plain-English textarea | `BuildStudio.tsx` sidebar | Move into Business Mode main CTA and coworker intake. Preserve current action. |
| Build list / fleet rail | `FleetRailZone`, `BuildListItem`, `deriveQueueState` | Business Mode shows "My builds" only when needed. Power Mode keeps fleet rail. |
| Portal context strip | `PortalContextStrip` | Hide internals in Business Mode. Preserve in Power Mode. |
| Header IDs / branch badges | `activeBuild.buildId`, originator item ID, `branchBadge` | Hide by default. Show human-readable title/status. IDs move to technical details. |
| Action command spine | `BuildStudioWorkflowActionCard` | Keep. Render business-language action in Business Mode and technical command in Power Mode. |
| Workflow graph | `ProcessGraph`, `NodeInspector` | Power Mode primary surface. Business Mode collapses it into simple current step and progress. |
| Details drawer | `DetailsDrawer`, `BuildProgressOperationalPanel`, `ReviewPanel`, `FeatureBriefPanel` | Power Mode drawer. Business Mode consumes selected plain summaries only. |
| Assurance row | `CodeIntelligenceStatusCard`, `BuildAssuranceGateCard` | Business Mode shows only "Build health" when actionable. Power Mode keeps full detail. |
| Release decision | `ReleaseDecisionPanel` | Business Mode transforms into outcome approval. Power Mode keeps release mechanics. |
| Shared preview footer | `OpenSandboxButton` | Rename to "Live preview"; bind to active build context; keep technical sandbox state in Power Mode. |

### Current `apps/web/components/build-studio/` V2 surface

Reuse as the Business Mode component vocabulary, but do not introduce a second chat paradigm.

| Current V2 piece | Future use |
| --- | --- |
| `BusinessBriefPanel` | Keep as Business Mode "What we understood" artifact. Simplify "How DPF will likely build this" copy for non-developers. |
| `PreviewFrame` | Make the primary inspection surface once preview exists. |
| `ArtifactPane` | Keep as default center pane: brief, preview, walkthrough, what changed, technical change. |
| `ConversationPane` | Do not duplicate the existing AI coworker rail in production. Use its cards/types as reusable message card renderers inside the current coworker UX. |
| Cards: plan summary, verification strip, decision, files touched | Reuse. Hide `files-touched` in Business Mode unless translated to "What changed". |

### Current execution substrate

Keep the existing separation and extend it.

| Current substrate | Future disposition |
| --- | --- |
| `BuildExecutionProvider` | Keep as the substrate boundary. Local Docker remains the reference provider. |
| `BuildAgentRunner` | Extend to include `grok`. Add normalized event emission and technical trace references. |
| Claude/Codex CLI dispatch | Allowed as runner adapters, but not as user-visible UX. Avoid subscription/OAuth automation as the default unattended Claude path after the June 15, 2026 Anthropic licensing change. |
| `dpf-native` | Strategic default for governed unattended Build Studio work where possible. |
| `AgentThread.cliSession*` fields | Use for supervised/persistent CLI sessions and Power Mode technical cockpit. |
| MCP/skills | Business Mode receives the benefit through capability context. Power Mode can inspect and tune them. |

## Research and benchmarking

The design follows common patterns from established workflow and AI-build tools:

| System | Relevant pattern | Adopt | Reject |
| --- | --- | --- | --- |
| GitHub Actions | Workflow runs expose status first; job logs are searchable/downloadable drill-ins. | Status/result first, logs behind drill-in. | Do not make logs the default user experience. |
| GitLab CI/CD | Pipelines are composed of stages and jobs; jobs run on runners and have full logs. Mini graphs sort by severity for compact attention. | Separate execution graph from attention surface; keep logs for Power Mode. | Do not require business users to understand jobs/runners. |
| Replit Agent | User starts from plain language and inspects generated apps through a preview. | Plain-language intake plus preview-first inspection. | Do not couple DPF to one hosted IDE mental model or hide verification evidence. |
| Linear | Issues/projects/views can be filtered and shaped for different roles. | Role-appropriate views over the same data. | Do not fork Build Studio into separate products. |
| Claude Code / Codex / Grok Build | Powerful coding agents can run from CLI/API contexts and support headless or scripted work. | Treat them as runner adapters behind Build Studio. | Do not expose terminal sessions to business users or rely on consumer-plan automation as the default product substrate. |

Provider-specific notes as of 2026-06-01:

- Anthropic's Claude Code legal docs state that third-party developers should not route requests through Free/Pro/Max credentials on behalf of users and should use API keys for products/services. This makes unattended Build Studio automation via subscription OAuth a licensing risk.
- OpenAI's Codex help states ChatGPT-plan Codex usage counts toward agentic usage limits. This can work as a runner, but Build Studio should still abstract it behind the same event contract.
- xAI's Grok Build docs support CLI/headless/API-key patterns. Grok should be integrated as another runner, not as a separate Build Studio UX.

### Multi-agent orchestration benchmarking

The multi-agent frameworks are converging on a few repeatable patterns. DPF should borrow the patterns, not import another framework as the product architecture.

| Source | Pattern | What it teaches Build Studio |
| --- | --- | --- |
| Microsoft AutoGen | Two layers: `AgentChat` for high-level multi-agent apps, `Core` for event-driven, distributed agent systems. AutoGen also distinguishes patterns such as handoffs, group chat, reflection, and code execution. | Keep Business Mode high-level and calm, but build the runner/event layer as an explicit event-driven substrate. AutoGen's layered split validates our Business Mode / Power Mode split. |
| AutoGen handoffs | Delegate tools transfer a task to another agent; human agents can be part of the topology for complex requests. | Build Studio should model specialist transfer as structured events and typed ownership changes, not as raw chat text. A human/operator is another participant in the event topology, not a last-minute side channel. |
| LangChain / LangGraph | Multi-agent is optional; use it when context management, distributed development, parallelization, specialized tools, or sequential constraints justify it. LangGraph focuses on durable execution, streaming, persistence, and human-in-the-loop. | Avoid "multi-agent by default." Use one strong runner or one loaded skill when enough. Use subagents only when context isolation, parallel work, or gate discipline pays for the overhead. |
| LangGraph HITL | Interrupts pause execution, surface a payload, persist state, and resume with a command. Frontend guidance renders an approval card and resumes the stream after a decision. | Business questions and approval cards should be typed resumable events. Do not rely on "ask in chat and hope the next turn resumes correctly." |
| Google ADK | Workflows can be graph-based, dynamic, collaborative, or templated; templates cover sequential, loop, and parallel execution. Agent routing is a runtime choice for fallback/A-B/auto-routing. | DPF's right-sizing matrix should select a workflow shape. Small fixes can use a light sequence; larger builds can use graph/parallel/review flows. Runner/provider routing stays behind the workflow. |
| CrewAI | Distinguishes Flows as structured state/control scaffolding from Crews as autonomous collaborative agent teams. | Build Studio should put deterministic process, state, gates, and persistence in the Flow-equivalent layer; crews/runners operate inside that scaffold. |
| Amazon Bedrock Agents | Uses a supervisor/collaborator hierarchy where the supervisor plans, routes, and interacts with the user; collaborators are domain specialists. | Business Mode should keep one visible coworker/supervisor. Specialists help behind the curtain unless Power Mode opens the machinery. |
| Microsoft Semantic Kernel | Group chat orchestration uses a manager to control conversation flow, agent turns, human input, and result collection; docs explicitly position this for debate/collaboration. | Group chat/debate is useful for plan/review deliberation and Power Mode, not as the default business-user interface. |
| OpenAI Agents SDK | Makes the key design choice explicit: handoffs when a specialist should take over the conversation, agents-as-tools when the manager should stay in control. Guardrails and approvals pause sensitive tool calls and resume from saved state; tracing captures model calls, tool calls, handoffs, guardrails, and spans. | Business Mode should mostly use "agents as tools": the Build Studio coworker stays responsible for the user-facing answer. Handoffs are internal unless a human specialist truly needs to own the conversation. Approval and trace state need to be first-class. |

DPF-specific conclusion:

1. **Use manager-owned UX by default.** The visible Build Studio coworker remains responsible for the user-facing interaction. Specialists are internal capabilities.
2. **Use handoffs sparingly.** Handoffs are for true ownership changes: support escalation, Power Mode intervention, or a domain coworker that must converse directly with the user.
3. **Use workflow policy for right-sizing.** The process matrix chooses sequence, loop, parallel, review, and HITL gates based on work type, size, risk, and uncertainty.
4. **Use typed resumable events for HITL.** Business decisions, approvals, and technical escalations are resumable events with payloads and source refs.
5. **Use group chat/reflection as internal review.** Multi-reviewer deliberation is a trust signal and evidence source, not a wall of agent debate in Business Mode.
6. **Use tracing/evals as acceptance infrastructure.** Every runner/subagent path should emit traceable events that can be inspected in Power Mode and evaluated over time.

## Design principles

1. **Business users approve outcomes, not implementation.** The default approval object is a preview, screenshot walkthrough, and plain-English summary.
2. **One coworker paradigm.** Build Studio uses the existing AI coworker experience. It does not create a second chat/terminal product.
3. **One engine, two lenses.** Business Mode and Power Mode read the same build, event, artifact, and runner records.
4. **No raw machinery by default.** Code, diffs, logs, terminal text, MCP calls, model names, IDs, and branch names are hidden unless the user opens technical details.
5. **Structured events over raw output.** Runners emit normalized events. The UI does not parse stdout directly.
6. **Skills and MCP remain capability substrate.** Business users see "I checked the backlog" or "I verified the screen", not `list_backlog_items` or `run_ux_test`.
7. **Licensing-safe unattended automation.** API-native or provider-supported automation is the default for autonomous work; supervised CLI sessions are power-user tools.
8. **Process is internal characterization.** The process matrix exists so Build Studio knows how to do the work; Business Mode shows progress, confidence, and requests for input, not the full internal machinery.
9. **Autonomy is earned by low risk and low uncertainty.** Full autonomy is appropriate for low-risk, well-understood work. Higher risk, higher uncertainty, destructive change, customer-facing ambiguity, data migration, security impact, or weak evidence moves the build toward business decision gates or Power Mode review.
10. **Projection over substrate replacement.** Build Studio events are a view-model projection over existing durable records, adapter/substrate events, Pseudo-User envelopes, and task lineage. They are not a new work-unit substrate.
11. **Approvals use the Pseudo-User Contract.** Business questions can be lightweight UI events. Any delegated action, destructive action, phase advance, submission, or approval-sensitive continuation uses the Pseudo-User Contract envelope and audit path.

## Personas and modes

### Business Mode

Default for install owners, line-of-business users, and non-developer administrators.

Business Mode shows:

- feature title and business goal
- current plain-English step
- simple confidence/process posture: `quick change`, `standard build`, `careful review`, or `needs your decision`
- the one thing needed from the user, if any
- business questions with answer choices
- plan in plain English
- live preview
- screenshot walkthrough
- "what changed" in business language
- verification status as pass/fail/needs attention
- approval actions: `Looks good`, `Change this`, `Pause`, `Ask a question`

Business Mode hides by default:

- `FB-*`, `WC-*`, branch names, commit hashes
- workflow graph and node/task topology
- specialist/task names unless summarized as trust signals
- terminal output and raw logs
- source code and diffs
- MCP tool names and JSON payloads
- provider/model names
- cost/token detail
- internal queue/fleet mechanics

### Power Mode

Available by role or explicit advanced toggle. Power Mode is not a new product.
It is the technical lens over the same build.

Power Mode shows:

- existing workflow graph and anchored inspectors
- compact fleet rail and queue state
- selected process policy: work type, size, risk, uncertainty, visible phases, gates, review intensity, and autonomy level
- details drawer
- technical trace
- runner selection and fallback state
- active skills and MCP servers/tools
- branch/worktree/session data
- file diff and changed files
- ToolExecution / BuildActivity / BuildDispatchAttempt records
- terminal/PTY transcript when a CLI runner is used
- verification logs and retry/fallback controls

## User experience

### Business Mode layout

The Build Studio route keeps the existing AI coworker rail. The central build pane becomes artifact-first.

```text
+--------------------------------------------------------------++
|| Build title + simple status + advanced toggle               ||
+--------------------------------------------------------------++
|| Current step: Understand | Decide | Build | Try it | Approve ||
+------------------------------++------------------------------++
|| What I need from you         || Artifact pane                ||
|| - business question          || - What we understood         ||
|| - answer buttons             || - Live preview               ||
|| - coworker summary           || - Screenshot walkthrough     ||
||                              || - What changed               ||
||                              || - Verification               ||
+------------------------------++------------------------------++
|| Existing AI coworker rail remains the conversational surface ||
+--------------------------------------------------------------++
```

The current step labels are:

| Internal phase | Business label | User meaning |
| --- | --- | --- |
| ideate | Understand | We are clarifying the outcome. |
| plan | Decide | We are turning the outcome into a plan and resolving business choices. |
| build | Build | We are making the change. |
| review | Try it | We are checking the result and showing evidence. |
| ship | Approve | You decide whether the result is ready. |

### Process visibility and right-sizing

The process is still real, but it is an internal operating model. Build Studio needs it because a typo fix, a small defect repair, a workflow change, and a large new capability should not all run the same playbook.

This spec composes with `2026-05-30-build-studio-right-sizing-design.md`:

- `workType` and `effortSize` select a `LifecyclePolicy`
- `LifecyclePolicy` selects phases, gate evidence, prompt variant, and review intensity
- `BusinessBuildBrief.riskProfile`, implementation uncertainty, data sensitivity, reversibility, and verification confidence select an autonomy level
- Business Mode translates that into a plain posture, not a process diagram
- Power Mode exposes the actual policy and all gates

Business Mode examples:

| Internal policy | Business Mode copy |
| --- | --- |
| `fix + small + low risk + high confidence` | "This looks like a quick fix. I can make it, check it, and show you the result." |
| `feature + medium + standard risk` | "I will sketch the plan, ask about the business choices, then build a preview." |
| `feature + large` or `xlarge` | "This is big enough to split into smaller builds before we start." |
| `customer-facing + uncertain behavior` | "I need one decision from you before I build this." |
| `data migration/security/destructive change` | "This needs careful review before I make changes." |

### Autonomy levels

Autonomy is separate from provider choice. Claude, Codex, Grok, and DPF-native runners all obey the same autonomy policy.

| Level | When used | Business Mode behavior | Power Mode behavior |
| --- | --- | --- | --- |
| `explain_only` | unclear request, missing capability, no safe action yet | asks clarifying question or explains blocker | shows missing evidence/tool/provider |
| `business_decision_required` | business ambiguity blocks a safe build | asks a plain-English question with choices | shows the gated decision and source evidence |
| `bounded_autonomous` | moderate confidence; safe to make progress but pause before risky gates | builds/updates preview, then asks before approval-sensitive step | shows gates, runner trace, and rollback/retry options |
| `full_autonomous_build` | low risk, low uncertainty, strong verification path | builds and verifies, then presents result for approval | shows why autonomy was allowed |
| `power_review_required` | high risk, high uncertainty, destructive/data/security/cross-tenant impact | says a technical review is needed before continuing | routes to Power Mode/operator review |

`full_autonomous_build` means the system can perform the build and verification work without interruption. It does not mean silent production shipment. Business users still approve the visible outcome unless a separate deployment policy explicitly permits automatic release.

Autonomy must be derived once, then consumed everywhere.

```ts
export type BuildAutonomyLevel =
  | "explain_only"
  | "business_decision_required"
  | "bounded_autonomous"
  | "full_autonomous_build"
  | "power_review_required";

export type BuildAutonomyPolicy = {
  level: BuildAutonomyLevel;
  posture: "quick change" | "standard build" | "careful review" | "needs your decision";
  reasons: string[];
  requiredBusinessDecisions: Array<{
    questionId: string;
    prompt: string;
    choices?: string[];
  }>;
  requiredPowerReviewReasons: string[];
  approvalEnvelopeRequired: boolean;
  runnerConstraints: Array<
    | "api_supported_automation_only"
    | "no_consumer_oauth_unattended"
    | "canonical_runtime_verification_required"
    | "power_mode_supervision_required"
  >;
};

export function deriveBuildAutonomyPolicy(input: {
  lifecyclePolicy: LifecyclePolicy;
  businessBrief: BusinessBuildBrief | null;
  processType: BuildProcessType;
  processSize: BuildProcessSize;
  verificationConfidence: "none" | "weak" | "standard" | "strong";
  destructiveChange: boolean;
  dataMigration: boolean;
  securityImpact: boolean;
  crossTenantImpact: boolean;
  reversible: boolean;
}): BuildAutonomyPolicy;
```

`deriveBuildAutonomyPolicy()` is the single source of truth for Business Mode posture, Power Mode gate reasons, runner constraints, and approval policy. The event projector may display its output; runners may enforce its output; neither may independently recalculate autonomy from local heuristics.

### Business Mode primary cards

| Card | Purpose |
| --- | --- |
| `BusinessQuestionCard` | A decision the user can answer without technical knowledge. |
| `PlanSummaryCard` | Plain-English plan with optional "technical details" expansion. |
| `PrototypeReadyCard` | Live preview or screenshot is ready. |
| `ScreenshotWalkthroughCard` | Shows before/after or step-by-step screenshots. |
| `PlainChangeCard` | "What changed" in business terms. |
| `VerificationCard` | Checks passed/failed/blocked with non-technical explanations. |
| `ApprovalCard` | Final outcome approval and change-request path. Approval-sensitive actions are backed by a `CoworkerActionEnvelope`, not a Build-Studio-only approval mechanism. |
| `TechnicalTraceAvailableCard` | Small power-user affordance, hidden from default attention flow. |

### Approval and human-in-the-loop integration

Business Mode cards split into two classes:

| Card class | Substrate |
| --- | --- |
| Informational cards (`PlanSummaryCard`, `PrototypeReadyCard`, `PlainChangeCard`, most `VerificationCard` states) | `BuildStudioEvent` projection only. |
| Decision/action cards (`BusinessQuestionCard`, `ApprovalCard`, destructive/retry/phase-advance actions, "keep going" continuations) | Pseudo-User Contract screen action or `CoworkerActionEnvelope`, then projected back into `BuildStudioEvent`. |

This preserves one approval/audit path across the platform. Business Mode may make the card feel simpler, but the underlying action still carries delegating user, coworker agent, thread, envelope, source refs, and outcome.

### Power Mode relationship

Power Mode can be opened from:

- a role-gated `Advanced` toggle in Build Studio
- a technical details drawer from any business card
- operator/support routes

Power Mode authorization is a product decision in this spec, not an implementation afterthought:

- `view_platform` remains sufficient to reach platform/operator routes where Build Studio appears.
- `operate_build_studio_power_mode` is required to open Power Mode controls, runner/session state, retry/fallback controls, and terminal/session intervention.
- `view_build_studio_trace` is required to open raw technical trace material: terminal transcript, raw logs, MCP payloads, provider/model identifiers, source diffs, command output, and cost/token detail.
- Superusers inherit both capabilities through the normal `PERMISSIONS` path.
- If these capabilities do not exist when implementation starts, Phase 0 adds them to the canonical permissions registry and agent-grant mapping before any UI toggle ships.
- Opening raw trace material writes an authority/audit record with user, build, trace ref, reason surface, and timestamp. Summary-level Power Mode panels can render without a trace-view audit row; raw transcript/log/diff/payload access cannot.

Power Mode should default back to Business Mode for non-developer roles on later sessions unless the role grants advanced Build Studio operation.

## Event contract

Build Studio needs a provider-neutral event vocabulary, but this vocabulary is a projection boundary, not a new durable workflow engine.

`BuildStudioEvent` is derived from:

- durable Build Studio records (`FeatureBuild`, `BuildActivity`, `BuildArtifactRevision`, `BuildPhaseRun`, etc.)
- Pseudo-User Contract envelopes for delegated approvals and screen actions
- normalized adapter/substrate events from the CLI/routing and coworker-substrate layers
- `TaskRun`/`TaskNode`/`AgentThread` lineage where a build uses internal handoff, specialist, or multi-agent execution

The existing DOM `CustomEvent` bridge in `apps/web/lib/build-events.ts` remains a local sibling-component bridge during migration. It is not the durable event contract and should be treated as a UI transport detail.

### Type shape

```ts
export type BuildStudioAudience = "business" | "power" | "audit";

export type BuildStudioEventKind =
  | "intake_received"
  | "capability_check"
  | "process_policy_selected"
  | "autonomy_policy_selected"
  | "business_question"
  | "plan_summary"
  | "progress_summary"
  | "prototype_ready"
  | "screenshot_captured"
  | "plain_change"
  | "verification_step"
  | "approval_request"
  | "blocked"
  | "handoff_ready"
  | "technical_trace_available";

export type BuildStudioSourceRef =
  | { type: "feature_build"; id: string }
  | { type: "business_brief"; id: string }
  | { type: "build_activity"; id: string }
  | { type: "tool_execution"; id: string }
  | { type: "dispatch_attempt"; id: string }
  | { type: "artifact_revision"; id: string }
  | { type: "phase_run"; id: string }
  | { type: "runtime_verification"; id: string }
  | { type: "assurance_run"; id: string }
  | { type: "coworker_action_envelope"; id: string }
  | { type: "task_run"; id: string }
  | { type: "task_node"; id: string }
  | { type: "agent_thread"; id: string }
  | { type: "adapter_event"; id: string }
  | { type: "runner_trace"; id: string };

export type BuildStudioArtifactRef = {
  type: "preview" | "screenshot" | "walkthrough" | "diff" | "log" | "trace";
  label: string;
  href?: string;
  storageKey?: string;
};

export type BuildStudioEventPayloads = {
  intake_received: { businessOutcome: string; source: "direct" | "backlog" | "issue" | "coworker" };
  capability_check: { label: string; status: "passed" | "blocked" | "unknown" };
  process_policy_selected: { policyLabel: string; type: BuildProcessType; size: BuildProcessSize };
  autonomy_policy_selected: BuildAutonomyPolicy;
  business_question: { questionId: string; prompt: string; choices?: string[]; envelopeId?: string };
  plan_summary: { bullets: string[]; confidence: "low" | "medium" | "high" };
  progress_summary: { state: "working" | "possibly_stalled" | "waiting" | "done"; message: string };
  prototype_ready: { previewUrl?: string; screenshotRef?: string };
  screenshot_captured: { screenshotRef: string; caption: string };
  plain_change: { changes: string[]; userImpact: string };
  verification_step: { label: string; status: "passed" | "failed" | "blocked" | "skipped"; explanation: string };
  approval_request: { envelopeId: string; prompt: string; approveLabel: string; rejectLabel: string };
  blocked: { blockerKind: "business_input" | "power_review" | "tooling" | "provider" | "verification"; message: string };
  handoff_ready: { from: string; to: string; reason: string; taskRunId?: string; agentThreadId?: string };
  technical_trace_available: { traceId: string; traceKind: "cli-transcript" | "api-transcript" | "tool-ledger" };
};

export type BuildStudioEvent<K extends BuildStudioEventKind = BuildStudioEventKind> = {
  id: string;
  buildId: string;
  createdAt: string;
  kind: K;
  audience: BuildStudioAudience;
  title: string;
  summary: string;
  payload: BuildStudioEventPayloads[K];
  artifactRefs?: BuildStudioArtifactRef[];
  sourceRefs: BuildStudioSourceRef[];
};
```

The implementation should encode the payload registry as TypeScript types plus runtime validators. Business-audience events must pass a sanitizer that rejects raw internal IDs, branch names, provider/model names, terminal excerpts, raw tool names, command strings, JSON payload dumps, and raw MCP arguments.

### Event sourcing strategy

Do not add a new table in Slice 1.

Create a projector under `apps/web/lib/build-studio/events/` that derives `BuildStudioEvent[]` from existing durable sources:

- `FeatureBuild`
- `BusinessBuildBrief`
- `BuildActivity`
- `BuildDispatchAttempt`
- `BuildArtifactRevision`
- `BuildPhaseRun`
- `ToolExecution`
- `RuntimeVerification`
- `AssuranceRun`
- `WorkCapsuleActivity`
- `CoworkerActionEnvelope`
- `TaskRun`
- `TaskNode`
- `AgentThread`

The projector owns three separable responsibilities:

1. **Projection.** Convert durable records, adapter/substrate events, and task lineage into `BuildStudioEvent` values.
2. **Redaction.** Produce business-safe text and payloads for `audience = "business"`.
3. **Lineage.** Preserve enough source refs that Power Mode and audit views can reconstruct the technical path without exposing it by default.

If the projector becomes expensive or lossy, Slice 2 may extend `BuildActivity` with nullable envelope fields instead of creating a parallel event table:

```prisma
model BuildActivity {
  // existing fields retained
  eventKind  String?
  audience   String?
  payload    Json @default("{}")
  sourceRefs Json @default("[]")
}
```

That extension is allowed only after the typed event registry and validators exist. `eventKind` and `audience` remain string columns in Prisma for migration flexibility, but application code treats them as closed unions. Any new event kind must update the registry, validator, projector tests, and business-redaction tests in the same change.

That keeps `BuildActivity` as the single Build Studio activity stream instead of introducing a competing durable record. `TaskRun` remains the task/handoff substrate; `CoworkerActionEnvelope` remains the approval substrate; `BuildStudioEvent` remains the Build Studio view model over those records.

## Runner abstraction

### Runner IDs

Extend the existing runner ID union:

```ts
export type BuildAgentId =
  | "codex"
  | "claude"
  | "grok"
  | "dpf-native";
```

### Runner result

Extend `AgentRunResult` so every runner can return normalized technical events and trace references. Runners do not author business-facing `BuildStudioEvent` records directly; the Build Studio projector converts normalized runner/substrate events plus durable records into business, power, and audit views.

```ts
export type RunnerNormalizedEvent = {
  kind:
    | "message"
    | "tool"
    | "artifact"
    | "approval"
    | "plan"
    | "todo"
    | "subagent"
    | "hook"
    | "health";
  emittedAt: string;
  summary: string;
  payload: Record<string, unknown>;
  taskRunId?: string;
  taskNodeId?: string;
  agentThreadId?: string;
};

export type AgentRunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  toolExecutionId: string;
  agentId: BuildAgentId;
  providerId: BuildExecutionProviderId;
  normalizedEvents?: RunnerNormalizedEvent[];
  technicalTraceRef?: {
    kind: "cli-transcript" | "api-transcript" | "tool-ledger";
    storageKey?: string;
    toolExecutionId?: string;
    dispatchAttemptId?: string;
    taskRunId?: string;
    agentThreadId?: string;
  };
};
```

For CLI-backed runners, `normalizedEvents` should be produced by the same adapter-normalization family used by the coworker CLI routing substrate whenever practical. Build Studio may add build-specific source refs, but it should not create a second parser for Claude/Codex/Grok streams if the routing adapter already knows how to normalize them.

### Capability context

Every runner receives a capability bundle assembled by Build Studio:

```ts
export type BuildCapabilityContext = {
  skills: Array<{ skillId: string; name: string; summary: string }>;
  mcpTools: Array<{ name: string; grant: string; businessLabel: string }>;
  toolGrants: string[];
  repoInstructionsDigest: string;
  buildPolicyDigest: string;
  lifecyclePolicy: LifecyclePolicy;
  autonomyPolicy: BuildAutonomyPolicy;
  currentBusinessBrief?: BusinessBuildBrief;
};
```

Business Mode never renders this directly. It turns this into user-facing claims like:

- "I checked the current backlog item."
- "I used the build verification tools."
- "I found one setup question before I build."

Power Mode can inspect the actual skills, MCP servers, grants, and tool calls.

### Provider policy

| Runner | Business Mode default? | Power Mode? | Notes |
| --- | --- | --- | --- |
| `dpf-native` | Yes, target default for unattended governed builds. | Yes. | Uses DPF inference/tooling/audit directly. |
| `codex` | Yes, where configured and allowed. | Yes. | Treat as runner adapter; usage counts against relevant plan/API limits. |
| `claude` | API-key/API-native preferred for unattended automation. | Yes. | Claude Code CLI can remain excellent for supervised/power-user work. Do not make consumer subscription OAuth automation the product default. |
| `grok` | Yes, via API-key/provider-supported automation once approved. | Yes. | Add as first-class runner behind same event contract. |

## Technical trace model

The technical trace is not the product. It is evidence and support material.

Trace sources include:

- CLI transcript
- API/tool transcript
- MCP calls
- file diffs
- dispatch attempts
- verification logs
- ToolExecution rows
- WorkCapsule activity

Business Mode shows only `technical_trace_available` when useful. Power Mode opens the trace.

For CLI/PTY sessions, use the existing `AgentThread.cliSession*` substrate and add a `CliSessionService`-backed gateway. The gateway captures transcript and status, but does not expose the terminal to business users.

Computer-use automation is acceptable for QA/recovery/operator-assist. It is not the default Build Studio product substrate because it is brittle, hard to audit, and too close to recreating hidden UI automation around tools that already expose CLI/API surfaces.

## Data and component mapping

| Business Mode need | Existing source | Notes |
| --- | --- | --- |
| Business outcome | `BusinessBuildBrief.businessOutcome`, `FeatureBuild.title/description` | Already present. |
| Business questions | `BusinessBuildBrief.openQuestions`, future event payloads | Render as choices in coworker rail. |
| Current step | `FeatureBuild.phase`, `BuildFlowState`, `BuildPhaseRun` | Collapse to five business labels. |
| Process posture | right-sizing `LifecyclePolicy`, `BusinessBuildBrief.riskProfile`, `deriveBuildAutonomyPolicy()` | Business Mode shows a simple posture; Power Mode shows policy detail. |
| Plain plan | `FeatureBuild.designDoc`, `FeatureBuild.buildPlan`, `planReview` | Summarize, do not show raw JSON. |
| Preview | `Sandbox.previewUrl`, `sandboxPort`, `RuntimeTarget` | Label as Live Preview, not sandbox. |
| Screenshot walkthrough | `uxTestResults`, browser evidence | Promote from detail drawer into artifact pane. |
| What changed | `diffSummary`, `BuildArtifactRevision`, migrations | Business summary first; diff in Power Mode. |
| Verification | `verificationOut`, `uxVerificationStatus`, `RuntimeVerification`, `AssuranceRun` | Show pass/fail/business risk. |
| Approval and HITL | `CoworkerActionEnvelope`, Pseudo-User `screen_*` actions, `ToolExecution.envelopeId` | Business Mode renders simple approval cards; audit path stays platform-wide. |
| Handoff and specialist lineage | `TaskRun`, `TaskNode`, `AgentThread.parentThreadId`, `BuildDispatchAttempt` | Business Mode summarizes ownership changes; Power Mode shows lineage. |
| Technical trace | `ToolExecution`, `BuildDispatchAttempt`, `BuildActivity`, runner transcript | Power Mode only. |
| Skills/MCP | `SkillDefinition`, runtime skill usage, `ToolExecution.skillId`, tool grants | Power Mode detail; business claims in summaries. |

## Implementation plan

### Phase 0 - ratify product boundary

- Mark this spec as the governing amendment to the April 25 and May 20 Build Studio UX specs.
- Decide that Business Mode is the default route experience.
- Decide that the May 20 workflow-primary canvas becomes Power Mode.
- Do not create a new epic. Extend the existing Build Studio UX and Build Studio platform epics.
- Ratify that Business Mode approvals compose with the Pseudo-User Contract, not a Build-Studio-only approval channel.
- Ratify that `TaskRun`/`TaskNode`/`AgentThread` remain the handoff and specialist-lineage substrate.
- Add `operate_build_studio_power_mode` and `view_build_studio_trace` to the canonical permissions registry and agent-grant mapping if they are not already present.

### Phase 1 - mode resolver and component split

- Rename or wrap the current `apps/web/components/build/BuildStudio.tsx` implementation as `PowerBuildStudio` internally.
- Add `BusinessBuildStudio` as the default renderer.
- Add a `resolveBuildStudioExperienceMode(user, route, preference)` helper.
- Use role/grant/pref to expose Power Mode, with `operate_build_studio_power_mode` for controls and `view_build_studio_trace` for raw trace.
- Preserve the current route and active build selection.

Acceptance:

- non-developer role lands in Business Mode
- platform operator can switch to Power Mode
- users without `operate_build_studio_power_mode` cannot open controls even if they can view platform routes
- users without `view_build_studio_trace` cannot open raw logs/transcripts/diffs/payloads
- no build data is duplicated
- active build/coworker thread routing still works

### Phase 2 - normalized event projector

- Add `apps/web/lib/build-studio/events/types.ts`.
- Add `apps/web/lib/build-studio/events/project-build-studio-events.ts`.
- Add runtime validators for every `BuildStudioEventKind` payload.
- Project events from existing `FeatureBuild`, `BusinessBuildBrief`, `BuildActivity`, `BuildDispatchAttempt`, `ToolExecution`, `BuildArtifactRevision`, `BuildPhaseRun`, `RuntimeVerification`, `AssuranceRun`, `CoworkerActionEnvelope`, `TaskRun`, `TaskNode`, and `AgentThread` rows.
- Project `process_policy_selected` from the right-sizing matrix.
- Project `autonomy_policy_selected` only from `deriveBuildAutonomyPolicy()`.
- Add sanitizers that reject raw tool names, raw IDs, provider names, branch names, and terminal output for `audience = "business"`.
- Keep the existing DOM event bridge as UI transport only; do not treat it as the durable event source.

Acceptance:

- every active build produces a business event stream
- every active build has a business-safe process posture and power-mode policy detail
- every event payload validates against the event-kind registry
- no business event summary contains `FB-`, `WC-`, raw branch names, `reviewBuildPlan`, `saveBuildEvidence`, provider IDs, or command output
- power/audit events retain source refs for traceability
- events linked to approvals carry `CoworkerActionEnvelope` source refs
- multi-agent/specialist events carry `TaskRun`/`TaskNode`/`AgentThread` lineage when present

### Phase 3 - Business Mode artifact-first UI

- Reuse `BusinessBriefPanel`, `ArtifactPane`, `PreviewFrame`, and card components from `apps/web/components/build-studio/`.
- Replace duplicate chat with card renderers inside the existing AI coworker shell.
- Add Business Mode center sections: current step, what I need from you, live preview, walkthrough, what changed, verification, approval.
- Render `BusinessQuestionCard` and `ApprovalCard` from Pseudo-User decisions/envelopes where action or continuation authority is involved.
- Show process status as posture copy, not a workflow graph: quick change, standard build, careful review, needs your decision.
- Rename "sandbox" to "Live preview".
- Hide graph/fleet/details unless advanced mode is active.

Acceptance:

- a user can start a build from plain language without seeing branch/build/capsule IDs
- user sees a clear "working / needs you / ready to try / ready to approve" state
- user can understand whether the system is acting autonomously, asking a business question, or waiting for power-user review
- preview and screenshots are first-class artifacts
- business approvals are auditable through the same Pseudo-User Contract path as other coworker-driven actions
- graph is not visible by default in Business Mode

### Phase 4 - Power Mode cockpit

- Keep the current graph-first implementation and make it explicitly Power Mode.
- Add a technical trace drawer fed by source refs from the event projector.
- Add runner/session panel: active runner, provider, auth mode, session ID, CLI/API mode, skills, MCP tools, grants.
- Add process/autonomy panel: work type, size, risk, uncertainty, selected lifecycle, allowed autonomy, and gate reasons.
- Add task/handoff lineage panel: parent/child `AgentThread`, `TaskRun`, `TaskNode`, specialist owner, and handoff reason.
- Wire existing dispatch history, ToolExecution, BuildActivity, and verification logs into this drawer.
- Audit every raw trace open.

Acceptance:

- Mark/operator can inspect everything currently available
- runner/provider state is inspectable without leaking to Business Mode
- technical trace is role-gated
- raw trace access writes an authority/audit row
- handoff lineage is inspectable without adding a second task graph

### Phase 5 - runner event contract

- Extend `BuildAgentId` with `"grok"`.
- Extend `AgentRunSpec` with `capabilityContext`.
- Extend `AgentRunResult` with normalized runner events and trace refs.
- Update Codex and Claude runners to emit normalized runner events even if they still capture stdout/stderr.
- Reuse CLI/routing adapter event normalizers where available rather than creating Build-Studio-only parsers.
- Add Grok runner skeleton behind feature/provider availability.
- Keep `dpf-native` as strategic unattended path.

Acceptance:

- Claude, Codex, Grok, and DPF-native can all satisfy the same UI event contract
- swapping runner does not change Business Mode UX
- stdout/stderr never flows directly into Business Mode
- runner output is projected into `BuildStudioEvent` by the projector, not rendered directly

### Phase 6 - supervised CLI session support

- Implement or finish `CliSessionService` around `AgentThread.cliSession*`.
- Capture CLI transcripts as technical traces.
- Allow Power Mode operator intervention where policy permits.
- Link supervised sessions to `AgentThread` and `TaskRun` lineage when present.
- Do not drive Claude/Codex/Grok TUI through computer-use for normal product automation.

Acceptance:

- a power user can inspect/resume a supervised session
- a business user sees only progress, questions, artifacts, and approvals
- transcript is stored as trace evidence, not conversation copy

### Phase 7 - cleanup and dogfood hardening

- Remove or hide default displays of internal IDs, branch chips, provider/model chips, and tool names.
- Rename remaining user-facing "sandbox" copy to "Live preview" unless the user is in Power Mode.
- Replace "reviewBuildPlan" and similar tool names with business copy.
- Hide minimap and code-intel/assurance rows in Business Mode unless actionable.
- Add a wife-test/Dale-test QA script.

Acceptance:

- Business Mode can complete the Dale truck-stock flow without technical leakage
- Power Mode still exposes all audit and debugging detail
- small fixes can take a visibly lighter path than medium/large features
- low-risk/low-uncertainty changes can proceed through autonomous build/verification while preserving final outcome approval
- no duplicate command/status spine is introduced

## Backlog mapping

Use existing live epics rather than creating a new one:

- `EP-BUILD-STUDIO-UX`: Business Mode / Power Mode UX split.
- `EP-BUILD-STUDIO`: runner event contract, orchestration, progress visibility, task routing.
- `EP-9FC5D2FD`: Dale/persona leakage and first-customer simplification defects.
- `EP-GROK-001`: Grok runner/provider-specific work.
- `EP-COWORKER-INTERACTIVITY`: Pseudo-User Contract envelopes, screen actions, and delegated approval audit.
- `EP-A2A`: task/handoff lineage and agent-to-agent projection work.

Recommended backlog slices:

1. Business Mode shell and mode resolver.
2. Power Mode permission capabilities and trace-view audit.
3. Normalized Build Studio event projector with typed payload validators.
4. Process posture and canonical autonomy policy derivation.
5. Pseudo-User-backed Business Mode question/approval cards.
6. Business artifact pane and coworker card renderers.
7. Power Mode technical trace, task lineage, and runner cockpit.
8. Runner normalized-event contract and adapter-normalizer reuse.
9. Grok runner adapter and provider gate.
10. CLI session trace capture for supervised power-user mode.
11. Business-mode leakage cleanup and Dale/wife-test QA.

## Acceptance criteria

### Product acceptance

- A non-developer can create a new platform capability from plain language.
- The system asks only business-understandable questions on the default path.
- The user can inspect the result through preview and screenshots.
- The user can request changes conversationally.
- The user can approve based on outcome evidence.
- The user can tell whether Build Studio is working autonomously, waiting for a business decision, or paused for technical review.
- Approval-sensitive actions are visible as simple Business Mode cards while remaining auditable through Pseudo-User Contract envelopes.
- The default experience contains no raw code, terminal output, branch names, internal IDs, model names, tool names, or JSON payloads.

### Engineering acceptance

- Business Mode and Power Mode read the same build records.
- The event projector has typed payload validators and tests for redacting business-inappropriate content.
- Process/right-sizing policy is projected from the lifecycle matrix.
- Autonomy policy is projected from `deriveBuildAutonomyPolicy()` and consumed by both UI and runners.
- Current graph/details/dispatch functionality remains available in Power Mode.
- Runner adapters emit the same normalized runner-event contract.
- Build Studio projects runner/substrate events into `BuildStudioEvent`; runners do not render business events directly.
- All runner traces remain available for audit/debugging.
- Raw technical trace access is role-gated and audited.
- Pseudo-User Contract remains the delegated approval substrate.
- `TaskRun`/`TaskNode`/`AgentThread` lineage is preserved for handoffs and multi-agent work.
- Build Studio still uses the existing AI coworker rail and route context.

### Licensing/provider acceptance

- Claude unattended automation uses provider-approved API/API-key paths, not consumer subscription OAuth as the default product substrate.
- Codex is treated as a runner with plan/API usage constraints, not as a UI dependency.
- Grok is treated as a runner with API-key/provider-supported operation.
- Provider choice never changes the Business Mode interaction model.

## Open questions

1. Should Business Mode and Power Mode be a user preference or route query (`?mode=power`) with preference memory?
2. Should Slice 2 extend `BuildActivity`, or is a derived projector sufficient long-term once projector cost is measured?
3. What is the first mandatory wife-test scenario: Dale truck stock, customer appointment request, or platform self-upgrade UX?
4. What exact threshold promotes a build from `bounded_autonomous` to `full_autonomous_build`: confidence score, risk band, verification coverage, or a composite?
5. Should `deriveBuildAutonomyPolicy()` live beside the right-sizing matrix under `apps/web/lib/explore/`, or in a Build-Studio-specific policy module under `apps/web/lib/build-studio/policy/`?

## Non-goals

- No separate terminal product for business users.
- No new route that bypasses the existing AI coworker paradigm.
- No removal of existing operational Build Studio capabilities.
- No hidden computer-use automation as the default integration strategy.
- No provider-specific UX forks.
