# Odysseus UX, Routing, Threading, and Model-Routing Review

Date: 2026-06-14

Status: review memo

Audience: DPF product, architecture, UX, and AI platform reviewers

## Executive Summary

Odysseus is a useful benchmark because it treats AI as the center of a personal operating workspace rather than as a feature bolted onto a conventional web app. Its strongest product lesson is the "AI cockpit": one central chat/composer surface with visible controls for mode, model, memory, documents, research, and tools.

DPF should borrow the workspace model, the use-case-specific model routing, and the explicit local-vs-frontier decision surface. DPF should not copy Odysseus's modal-heavy static SPA architecture or its broad styling approach. The right DPF translation is a governed coworker workspace, durable route families, visible model receipts, and a policy-backed model router.

Recommended direction:

1. Add a DPF AI use-case policy matrix that routes chat, background utility work, research, vision, agentic actions, and privacy-sensitive tasks to the right model class.
2. Give every coworker thread a visible model/mode/privacy receipt: requested model, actual responding model, fallback/escalation, memory state, and tool authority.
3. Place model/provider setup and local model fit under `Platform > AI`, not inside a generic tools drawer.
4. Preserve DPF's architecture standards: route families, server-side data ownership, token-based theme styling, report-kit reporting primitives, and explicit evidence records.
5. Reserve about 20% of implementation effort for refactoring the AI/provider boundary before adding new UI.

## Evidence Reviewed

Primary external sources:

- Odysseus repository: <https://github.com/pewdiepie-archdaemon/odysseus>
- Odysseus hardware/model discussion: <https://github.com/pewdiepie-archdaemon/odysseus/discussions/274>

Source areas inspected in the Odysseus `dev` branch:

- `README.md` for product positioning, features, model-provider setup, and security guidance.
- `app.py` for top-level router registration and deep-link behavior.
- `routes/session_routes.py` and `core/session_manager.py` for threading/session state.
- `routes/chat_routes.py`, `src/action_intents.py`, `src/endpoint_resolver.py`, and `src/llm_core.py` for model routing, fallback behavior, agent escalation, and provider handling.
- `services/hwfit/*` and `routes/hwfit_routes.py` for hardware-fit and local model recommendation patterns.
- `static/index.html`, `static/style.css`, and related frontend scripts for the workspace shell, model picker, settings, and tool surfaces.

Review limitation: this memo is based on repository/source inspection and published screenshots/docs. It is not a runtime usability test of Odysseus.

## What Odysseus Gets Right

### 1. AI Workspace as the Product Center

Odysseus does not make users start from a settings dashboard. The visible center of gravity is a conversation workspace with a composer, model selector, chat/agent mode switch, tool entry points, and status indicators.

This is important for DPF. The primary DPF user experience should not feel like navigating an admin console to find AI features. The user should feel they are working with coworkers, documents, plans, decisions, and execution state from one coherent command surface.

DPF lesson:

- Make the coworker workspace a first-class destination.
- Keep model, memory, tools, and context visible near the work.
- Avoid burying AI mode/model choices in deep settings when they affect the current thread.

### 2. Use-Case-Specific Model Choices

Odysseus separates model roles instead of treating "the model" as one global setting. It has concepts for default chat, background utility work, research, vision, local endpoints, API endpoints, fallback chains, and teacher/frontier escalation.

This is the strongest architecture lesson. DPF should not ask one provider or model setting to carry every workload. The right question is: "What kind of work is this, what risk does it carry, and what model class is appropriate?"

DPF lesson:

- Create a governed use-case policy layer above raw provider settings.
- Let cheap/local models do background tasks where quality and risk permit.
- Use frontier models deliberately for high-complexity reasoning, research, coding, architecture, and hard failure recovery.
- Treat model fallback/escalation as an auditable event, not an invisible implementation detail.

### 3. Thread State Includes More Than Messages

Odysseus sessions carry model and endpoint choices, ownership, RAG/document state, archive/folder/important state, message count, and compaction behavior. Threads are not just a message list; they are durable work contexts.

DPF should adopt this principle while preserving its own Workroom and backlog architecture. A DPF coworker thread should know its context, model routing, memory mode, and authority level, but it should not become the only source of truth for work execution.

DPF lesson:

- Thread metadata should include model policy, privacy/memory state, attached sources, active mode, tool authority, compaction state, and last model receipt.
- Workrooms, backlog items, execution evidence, and decisions should remain canonical records outside the chat transcript.

### 4. Local Model Fit Is a Product Experience

Odysseus treats local model setup as something the product helps with. Its Cookbook and hardware-fit services scan or describe hardware, estimate model fit, and guide the user toward runnable options.

DPF should adopt this concept for operators. Local AI should not be presented as a binary "enabled/disabled" toggle. Operators need to know which tasks can run locally, which should use remote local-network infrastructure, and which should use frontier APIs.

DPF lesson:

- Add a model-fit experience under `Platform > AI`.
- Show local hardware capability, endpoint health, recommended model classes, and unsupported workloads.
- Degrade gracefully: if local hardware is insufficient, suggest remote endpoints or API fallback without shaming the user or hiding the limitation.

### 5. Visible Fallback Builds Trust

Odysseus has code paths that can emit fallback events when a provider/model fails before content begins. That is a good user-trust pattern. Silent fallback is convenient for developers but confusing for operators, especially when cost, privacy, or quality expectations differ by provider.

DPF lesson:

- A transcript should show when the actual responder differs from the requested/default model.
- Fallback events should be recorded as evidence for operational review.
- Model escalation should include reason codes such as provider offline, context exceeded, capability unavailable, verification failed, or user-approved escalation.

## What DPF Should Not Copy

### 1. Modal-Heavy Route Structure

Odysseus exposes many deep links that resolve into one static app shell and then open a corresponding tool view. That works for a personal AI workspace but is not the right architecture for DPF's product surface.

DPF needs durable route families with clear ownership and predictable navigation:

- Global navigation for stable product domains.
- Section routes/tabs for sibling areas inside a domain.
- Drawers or panels for temporary context and action surfaces.
- Dialogs only for bounded tasks, confirmations, or quick edits.

### 2. Generic "Tools" as an Information Architecture

Odysseus has a broad tools/workspace model. DPF should avoid turning AI-adjacent features into a grab bag.

DPF route placement should be based on user job and source of truth:

- Coworker work and active threads: `Workspace`.
- Provider/model/routing policy: `Platform > AI`.
- Documents, memory, and knowledge sources: `Knowledge`.
- Business workflows: the relevant business or product area.

### 3. Static Styling and One-Off UI Systems

Odysseus has a distinctive UI, but DPF cannot copy the implementation style. DPF requires theme-aware styling through `--dpf-*` CSS variables and reporting/data-display surfaces through `apps/web/components/ui/report-kit/`.

DPF implementation guardrails:

- No hardcoded colors.
- No hand-rolled status badges, KPI cards, model status tables, or export controls.
- Use report-kit primitives for provider status, model fit, route-health tables, fallback records, and AI spend/cost reporting.
- Keep server components responsible for data loading, with client wrappers only where interactivity requires them.

## Routing and Navigation Recommendations

### Target Route Homes

| Capability | DPF home | Reason |
| --- | --- | --- |
| Coworker command center | `Workspace` | This is active user work, not configuration. |
| Chat/thread history | `Workspace` | Threads are work contexts. |
| Model/provider setup | `Platform > AI > Providers` | Administrative platform configuration. |
| Model routing policy | `Platform > AI > Routing` | Governance and policy, not per-thread UI. |
| Local model fit/Cookbook equivalent | `Platform > AI > Model Fit` | Operator-facing hardware and model readiness. |
| Fallback/escalation logs | `Platform > AI > Evidence` or AI spend/reporting surface | Operational audit and cost/privacy review. |
| Memory/source controls | `Knowledge` with Workspace attachment affordances | Source truth belongs in knowledge management; use from workspace. |
| Compare/evaluation tools | `Platform > AI > Evaluation` | Useful, but should not be a global user destination at first. |

### Navigation Layer Rules

Global navigation should only answer "which product area am I in?" For the Odysseus-inspired work, that means no new top-level "Tools" or "Models" destination. DPF should add model management under Platform and expose thread-level model state contextually inside Workspace.

Section navigation should answer "which part of this domain am I in?" For `Platform > AI`, likely section tabs are:

- Providers
- Routing
- Model Fit
- Evidence
- Spend
- Evaluation

Workspace controls should answer "what can I do right now?" For coworker threads, that means mode switch, model receipt, memory/privacy state, source attachments, and action authority.

Contextual actions should stay actions:

- Test endpoint
- Add provider
- Run model fit scan
- Compare models
- Escalate this thread
- Disable memory for this thread
- Attach knowledge source

## Threading Recommendations

DPF should make coworker threads durable but not overloaded.

Recommended thread metadata:

| Field | Purpose |
| --- | --- |
| `threadId` | Stable conversation/workspace identifier. |
| `ownerPrincipalId` | Principal-based ownership and authorization. |
| `workspaceArea` | Route/domain where the thread belongs. |
| `mode` | Chat, agent, research, review, planning, or support. |
| `requestedModelPolicy` | The policy the user or workspace requested. |
| `actualModelReceipt` | Provider/model that answered each turn. |
| `fallbackEvents` | Structured provider/model fallback records. |
| `memoryMode` | Normal, no-memory/private, scoped-memory, or explicit-source-only. |
| `toolAuthority` | Which tool categories are enabled for the thread. |
| `attachedSources` | Documents, records, backlog items, Workrooms, or knowledge entries. |
| `compactionState` | Summary status, token budget, and compaction model receipt. |
| `decisionLinks` | Links to durable decision/evidence records. |

Important boundary: thread content can explain work, but Workrooms, backlog state, execution evidence, and architectural decisions should remain canonical records outside the transcript.

## Local vs Frontier Model Policy

DPF should define model selection by use case, risk, capability, privacy, and cost. A proposed first version:

| Use case | Default policy | Local model role | Frontier model role | User/operator visibility |
| --- | --- | --- | --- | --- |
| Thread title/name generation | Utility-local preferred | Primary | Fallback only | Low-friction receipt in thread metadata. |
| Summaries and compaction | Utility-local preferred if quality passes | Primary for low-risk summaries | Fallback for long/high-value context | Show compaction receipt. |
| Normal coworker chat | Org default policy | Preferred when capable | Allowed by org policy | Show requested/actual model. |
| Private/customer-sensitive work | Local or redacted-first | Primary | Explicit approval or policy exception | Strong privacy indicator. |
| Deep research | Frontier or strong remote model | Optional for cheap preprocessing | Primary for synthesis | Show provider, search scope, and evidence. |
| Architecture/design review | Frontier recommended | Assist with retrieval/summarization | Primary for reasoning | Record decision evidence. |
| Agentic tool execution | Policy-governed model | Allowed for simple bounded actions | Escalate for complex/higher-risk actions | Preview, confirmation, and execution evidence required. |
| Vision/document extraction | Specialized configured model | If available and verified | Fallback for unsupported formats/quality | Extraction receipt. |
| Provider health checks | Local utility or deterministic code | Primary where possible | Not needed | Admin-only evidence. |
| Model evaluation/compare | Explicit test configuration | Subject under test | Judge or baseline where appropriate | Evaluation run record. |

Escalation should be based on reason codes:

- Provider unavailable.
- Model capability missing.
- Context window exceeded.
- Verification failed.
- User requested better answer.
- Policy requires higher assurance.
- Privacy policy blocks frontier use.

Silent escalation should be disallowed for privacy-sensitive work and discouraged everywhere else.

## UX Recommendations

### Workspace Composer

Borrow the idea of a single central composer, but make it DPF-native.

Recommended visible controls:

- Current coworker or agent.
- Current mode: chat, plan, research, agent, review.
- Model receipt: requested policy and actual model.
- Memory/privacy state.
- Attached context sources.
- Tool/action authority.
- A concise evidence indicator when a turn creates durable records.

Do not turn the composer into a dense settings form. Advanced controls should be nearby but progressively disclosed.

### Model and Provider Setup

Model setup should be approachable but operator-grade.

Recommended flow:

1. Add or discover endpoint.
2. Test connectivity.
3. Classify provider type and capabilities.
4. Assign use-case roles.
5. Run fit/evaluation checks.
6. Save policy.

Empty states should help the operator choose among:

- Local model on this machine.
- Remote local-network model server.
- Frontier/API provider.
- No model yet, use DPF defaults if configured.

### Local Model Fit

The local model fit screen should answer:

- What hardware/runtime is available?
- Which model classes are realistic?
- Which DPF use cases can run locally?
- Which use cases require remote/frontier fallback?
- What is currently misconfigured?

This should be a practical readiness view, not a catalog of every model in the world.

## Architecture Recommendations

### Create a Policy Layer

DPF should avoid wiring provider choices directly into UI controls. Add a central policy layer that maps use cases to model candidates, fallback behavior, privacy constraints, and evidence requirements.

Candidate concept:

```ts
type AiUseCase =
  | "chat"
  | "utility"
  | "research"
  | "vision"
  | "agent-action"
  | "architecture-review"
  | "private-chat"
  | "evaluation";

type AiRoutingDecision = {
  useCase: AiUseCase;
  requestedPolicyId: string;
  candidates: ModelCandidate[];
  privacyMode: "normal" | "local-first" | "redacted" | "blocked";
  fallbackPolicy: "none" | "same-class" | "frontier-with-receipt" | "approval-required";
  evidenceRequired: boolean;
};
```

This should sit above the existing inference code, not replace it immediately.

### Keep Provider Adapters Thin

Provider adapters should normalize transport differences, not own product decisions. Product decisions belong in the routing policy layer.

Responsibilities:

- Provider adapter: URL, headers, request/response shape, streaming protocol, health check.
- Routing policy: which provider/model to try and why.
- Transcript/evidence layer: what happened, what model answered, what fallback occurred.

### Refactor Allocation

Reserve roughly 20% of the implementation budget for refactoring before UI expansion. The refactor should focus on:

- one source of truth for AI use-case policy,
- structured model/provider capability metadata,
- fallback/escalation receipts,
- thread metadata shape,
- reporting-ready evidence records.

Without this, the model UI will become a collection of per-page settings and one-off heuristics.

## Governance and Safety Requirements

DPF should apply the Trusted AI Kernel posture to model routing:

- Never hide material model/provider changes from the user or operator.
- Never send private/sensitive context to a frontier provider when policy says local-only.
- Record escalation/fallback as evidence when it affects quality, cost, privacy, or action authority.
- Require preview/confirmation for effectful agent actions.
- Keep authorization decisions tied to principals and tool grants, not to chat UI state.
- Make provider/model spend and fallback behavior reportable.

## Proposed Implementation Slices

### Slice 1: Model Policy Inventory

Document current DPF AI calls and classify them by use case:

- chat,
- summarization,
- planning,
- research,
- code/build assistance,
- classification,
- extraction,
- tool execution.

Output: a map of current call sites, providers, privacy posture, and missing receipts.

### Slice 2: Routing Policy Service

Introduce a central AI routing policy service that returns candidate models and fallback rules for a use case.

Output: no major UI yet; one or two existing AI paths route through the policy layer.

### Slice 3: Thread Model Receipt

Add transcript/thread metadata showing requested policy, actual model, fallback, and memory/privacy state.

Output: visible trust signal in Workspace with structured records behind it.

### Slice 4: Platform AI Routes

Add `Platform > AI` section routes for providers, routing policy, model fit, and evidence.

Output: admin/operator surface using DPF theme tokens and report-kit components.

### Slice 5: Local Model Fit

Add a DPF-native model fit screen that checks configured local/remote endpoints and maps them to supported use cases.

Output: practical local/frontier guidance for operators.

## UX Fit Review

Feature name: Odysseus-inspired AI workspace and model routing learnings.

Decision: fits with guardrails.

Owning areas:

- `Workspace` for coworker threads and active work.
- `Platform` for model/provider governance, routing policy, evidence, and spend.
- `Knowledge` for memory and source management.

Route family:

- Use `Platform > AI` for model governance.
- Use `Workspace` for active coworker interaction.
- Do not add a new global "Tools" destination.

Persona:

- Founder/operator using AI coworkers to run the business.
- Platform operator configuring model capability, privacy, and cost.
- Builder/agent reviewer inspecting execution evidence.

Navigation layer:

- Global nav: unchanged unless broader DPF IA work says otherwise.
- Section nav: `Platform > AI` tabs for providers, routing, model fit, evidence, spend, and evaluation.
- Workspace controls: mode, memory, model receipt, attachments, and action authority.
- Contextual actions: test endpoint, add provider, compare models, escalate, attach source.

Component reuse:

- Use report-kit for provider/model tables, status badges, KPI cards, filters, exports, charts, and evidence lists.
- Use DPF CSS variables for all colors.
- Reuse existing coworker/workspace primitives where available.

Source of truth:

- AI routing policy and provider capability records for model decisions.
- Principal/tool grants for authority.
- Knowledge records for sources and memory.
- Workrooms/backlog/evidence tables for execution state.

Empty and failure states:

- No provider configured: guided setup with local, remote, and API options.
- Local hardware insufficient: explain supported use cases and recommended fallback.
- Provider offline: show fallback path or disabled use cases.
- Privacy policy blocks frontier: explain local/redacted alternatives.

AI boundary:

- No silent frontier escalation for sensitive work.
- No effectful action without preview and confirmation.
- Every fallback/escalation should be visible in the thread or operator evidence surface.

Required evidence before shipping:

- Route and navigation review against DPF IA.
- Theme/token scan for no hardcoded colors.
- Browser UX verification for Workspace and Platform AI routes.
- Provider fallback simulation.
- Privacy-mode simulation.
- Report-kit usage check for data-display surfaces.

## Open Questions

1. Should DPF expose model selection to every user, or only expose policy/mode while admins own concrete provider/model choices?
2. Which use cases are allowed to use frontier models automatically, and which require explicit approval?
3. Should private/no-memory mode disable all persistent thread memory, or only prevent future retrieval?
4. Should local model fit be based on host hardware, configured endpoints, or both?
5. Where should AI spend, fallback, and model-quality evidence converge with existing finance/operations reporting?

## Recommended Next Decision

Approve a short architecture/design spec for `Platform > AI` and coworker thread model receipts. The spec should define:

- the AI use-case policy matrix,
- the thread metadata and model receipt shape,
- route placement under DPF navigation,
- evidence requirements for fallback/escalation,
- the first implementation slice and refactor budget.

The central product bet is simple: DPF should make AI work feel like a reliable cockpit, not a pile of settings. Odysseus shows the shape of that cockpit. DPF should implement it with stronger governance, route discipline, and architecture.
