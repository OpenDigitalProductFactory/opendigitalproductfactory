# AI Coworker Visual Control Surface Design

| Field | Value |
| --- | --- |
| Status | Draft for review |
| Created | 2026-05-10 |
| Last revised | 2026-05-10 (chief-architect review pass: corrected AgentEvent surface, replaced fabricated `EvidenceRecord`, reused existing theme + capability tokens, corrected `/platform/ai/operations` IA, narrowed V1 scope to runtime-truth sources) |
| Author | Codex + Mark Bodman |
| Primary audience | Platform architecture, AI workforce UX, governance, business archetype design |
| Related repo areas | `apps/web/app/(shell)/platform/ai/*`, `apps/web/lib/tak/agent-event-bus.ts`, `apps/web/lib/tak/task-states.ts`, `apps/web/app/api/agent/stream/route.ts`, `apps/web/lib/mcp-governed-execute.ts`, `apps/web/lib/govern/permissions.ts`, `apps/web/components/platform/platform-nav.ts`, `apps/web/components/platform/AiTabNav.tsx`, `apps/web/lib/storefront/*`, `packages/storefront-templates/*`, `packages/db/prisma/schema.prisma` (`ToolExecution`, `ToolExecutionReceipt`, `BacklogItemActivity` (`kind="evidence"`), `ExternalEvidenceRecord`, `Principal`, `PrincipalAlias`, `Agent`, `TaskRun`) |
| Related prior artifacts | `2026-04-23-a2a-aligned-coworker-runtime-design.md`, `2026-04-29-coworker-execution-adapter-substrate-design.md`, `2026-04-29-orchestration-primitives-design.md`, `2026-04-30-ai-coworker-operator-pattern.md`, `2026-04-30-build-specialist-operator-contract.md`, `2026-04-23-it-service-provider-msp-archetype-design.md`, `2026-04-25-dpf-on-dpf-production-instance-design.md`, `2026-04-22-enterprise-auth-directory-federation-design.md` (PrincipalAlias addendum, 2026-05-09) |

## Purpose

Design a clearer management and control surface for DPF's AI coworkers by representing coworker activity on a business operating map.

The target is not a decorative animation layer. The target is an operator surface that helps a user answer:

1. what business flow is this coworker helping with
2. what is it doing right now
3. which tools, policies, approvals, and evidence are involved
4. where is work blocked, degraded, or risky
5. how do I adjust the coworker without understanding every low-level runtime detail

The visual model should borrow from industrial HMI/SCADA, schematic transit maps, value stream mapping, and AI-agent observability, then adapt those patterns to DPF's archetype-driven operating model.

## Executive Decision

DPF should build a Coworker Operations Map as the primary visual control surface for AI coworkers.

The map should have three layers:

1. **Business operating map** - a simplified, archetype-specific schematic of the business flow.
2. **AI activity overlay** - live coworker execution, tool calls, policy gates, approvals, evidence, and incidents layered on top.
3. **Control inspector** - a contextual panel for adjusting skills, tool grants, model routing, policies, prompts, and escalation behavior.

The map should be schematic like a subway map, not literal like a floor plan. It should show operating clarity over physical or data-model accuracy.

## Current Repo Truth

### AI management surface

Verified current routes under `apps/web/app/(shell)/platform/ai/` (2026-05-10):

- `agent/` — per-agent detail
- `assignments/` — agent ↔ route bindings
- `authority/` — tool grants, policy decisions, `ToolExecution` audit log
- `build-studio/` — Build Studio orchestration surface
- `history/` — execution history
- `model-assignment/` — agent ↔ model bindings
- `operations/` — **legacy alias only**: `apps/web/app/(shell)/platform/ai/operations/page.tsx` is a one-line `permanentRedirect("/platform/ai/build-studio")`. It is **not** an operator-facing health view; treat it as an alias slot.
- `prompts/` — prompt template editor (`PromptTemplate`)
- `providers/` — provider registry + status
- `routing/` — model routing rules and fallback
- `skills/` — skill definitions and assignments
- (root) — AI overview

The platform-level navigation that surfaces these lives in `apps/web/components/platform/platform-nav.ts` and `apps/web/components/platform/AiTabNav.tsx`. The Operations Map tab is added through those files — not by inventing parallel nav state.

This gives access to useful runtime facts, but the user experience is difficult because it is organized around platform subsystems rather than the questions an operator has about a coworker. In particular, `authority/` and `routing/` each carry slices of the same operator question ("is this coworker doing the right thing safely?") in different shapes; `operations/` carries nothing today and is available as a redirect slot if the new IA wants `/platform/ai/operations` to point at the Operations Map instead of Build Studio (decision deferred to V2 IA refresh — see Open Questions).

The current UX mostly answers:

- which coworker exists
- which provider/model is selected
- which skills and tool grants exist
- which execution history exists

It does not clearly answer:

- where the coworker fits in the business model
- which value stream it is serving
- how coworker behavior changes by archetype
- what is happening right now in relation to the business
- which control should be adjusted for a specific business outcome

### Archetype model

DPF already has an archetype vocabulary in `packages/storefront-templates/src/types.ts`.

Current archetype categories include:

- `healthcare-wellness`
- `beauty-personal-care`
- `trades-maintenance`
- `professional-services`
- `software-platform`
- `education-training`
- `pet-services`
- `food-hospitality`
- `retail-goods`
- `fitness-recreation`
- `nonprofit-community`
- `hoa-property-management`

The activation profile model already treats some archetypes as operating models, not just storefront themes. `ActivationProfile.modules` currently includes:

- `customer-estate`
- `service-agreements`
- `billing-readiness`
- `service-operations`
- `projects`
- `lifecycle-signals`
- `integrations`

The MSP profile is especially important because it proves the direction: an archetype can activate real business modules such as customer estate, service agreements, and service operations.

### Coworker execution and tool-call substrate

DPF already has the runtime primitives this map projects from. The map MUST NOT introduce a parallel event grammar; it MUST project the canonical ones.

Canonical primitives, verified 2026-05-10 against repo HEAD:

- **Event bus.** `apps/web/lib/tak/agent-event-bus.ts` exports `AgentEvent`, keyed by `threadId`. The top-level `apps/web/lib/agent-event-bus.ts` is a 2-line shim re-export; the `tak/`-scoped file is the source of truth. The union is large and already covers most of what the map needs to project:
  - task lifecycle: `task:status`, `task:artifact`
  - tool calls: `tool:start`, `tool:complete`
  - build orchestrator: `phase:change`, `brief:update`, `evidence:update`, `iteration`, `coding:*`, `verification:started|step|complete`, `orchestrator:build_started|task_dispatched|task_progress|task_complete|phase_summary|specialist_retry|warning`, `sandbox:ready`
  - async inference: `async:started|progress|complete|failed|expired`, `done` (carries `providerInfo: { providerId, modelId }`)
  - work queue: `queue:item_created|item_assigned|item_claimed|item_status_changed|item_completed`, `queue:escalation`, `queue:sla_warning`, `queue:message`
  - long-running side jobs: `brand:extract.progress|complete|failed`, `sync:progress`, `test:step`
  - deliberation: `deliberation:queued|branch_dispatched|branch_completed|degraded_diversity|completed`
  - error: `error`

  Per `2026-04-29-coworker-execution-adapter-substrate-design.md`, this bus evolves rather than gets replaced. Several "where do we get handoff / approval / verification events" questions are already answered by existing discriminants (notably `queue:escalation` for handoffs and `verification:*` / `task:status === "input-required"` for approval-shaped waits) — **do not add new discriminants the map can already express**.

- **Task-state vocabulary.** `apps/web/lib/tak/task-states.ts` defines: `submitted`, `working`, `input-required`, `auth-required`, `completed`, `failed`, `canceled`, `rejected`, `archived`. The same file exports `TASK_IN_FLIGHT_STATES`. Reuse exactly.
- **Streaming transport.** `apps/web/app/api/agent/stream/route.ts` already streams agent progress over Server-Sent Events; consumed by `apps/web/components/agent/AgentCoworkerPanel.tsx`. Reuse — do not introduce a parallel WebSocket channel.
- **Governed tool execution.** `apps/web/lib/mcp-governed-execute.ts` writes one `ToolExecution` row per call. Verified `ToolExecution` columns (`packages/db/prisma/schema.prisma:2981`): `id`, `threadId`, `agentId`, `userId`, `toolName`, `parameters`, `result`, `success`, `executionMode`, `routeContext`, `durationMs`, `createdAt`, `auditClass`, `capabilityId`, `summary`, `apiTokenId`. Provider/model attribution is **not** persisted on `ToolExecution`; it rides the `AgentEvent` stream as `done.providerInfo` and (for async paths) on `async:started`. The map reads provider/model from the event stream, not the row.
- **Tool grants and authorization.** `apps/web/lib/tak/agent-grants.ts` intersects user-role capabilities × agent `tool_grants` (AGENTS.md §8). The top-level `apps/web/lib/agent-grants.ts` is a re-export shim. Surfaces today live at `/platform/ai/authority`.
- **Receipts.** `ToolExecutionReceipt` (`packages/db/prisma/schema.prisma:3012`) is the **per-execution verification record**: `inputFingerprint`, `outputDigest`, `executionStatus`, `receiptKind`, `receiptStatus`, `expiresAt`, optional `buildId`. This is the right model for the "Verified" Evidence chip — the platform already has receipts; the map should expose them, not invent a parallel ledger.
- **Evidence ledger.** There is **no top-level `EvidenceRecord` model**. Two distinct sources cover the surface:
  - `BacklogItemActivity` with `kind: "evidence"` (written by `record_execution_evidence` MCP at `apps/web/lib/mcp-tools.ts:3494`) — backlog-anchored evidence (test_pass, build_pass, ux_verified, spec_review, manual_check, external_link).
  - `ExternalEvidenceRecord` (`packages/db/prisma/schema.prisma:3174`) — external tool / provider calls (`actorUserId`, `routeContext`, `operationType`, `target`, `provider`, `resultSummary`, `details`).
  The map projection treats both as Evidence chips; the inspector deep-links to whichever was the source. **The spec must not refer to a non-existent `EvidenceRecord` model.**
- **Identity.** `Principal` + `PrincipalAlias` (`packages/db/prisma/schema.prisma:193,204`). Per the 2026-05-09 addendum to `2026-04-22-enterprise-auth-directory-federation-design.md`, identity-bearing references introduced after 2026-05-09 MUST resolve to a `Principal` via a `PrincipalAlias`, not a parallel discriminator. Coworker rows in `Agent` (`schema.prisma:1440`) reach the map through their `PrincipalAlias` — the map never reads `Agent.id` as the actor key.

The missing piece is a projection layer + visual model that turns those facts into a coherent operator surface. The map is a view, not a new substrate.

## Research and Benchmarking

### Industrial HMI and SCADA

Industrial HMI design emphasizes situational awareness, consistent navigation, alarm priority, and disciplined color use. ISA-101 describes HMI practices around layout, navigation, alarm systems, cybersecurity, and the goal of reducing operator error and improving situational awareness.

Pattern to adopt:

- normal operation should be visually quiet
- color and motion should be reserved for abnormal, risky, blocked, or attention-worthy states
- the top-level view should show system health and flow, with drill-down for diagnosis
- alarms must be explicit and prioritized, not mixed with decorative status color

Pattern to reject:

- skeuomorphic control-room graphics where visual drama hides operational meaning
- constantly animated screens that create fatigue
- using red/green/yellow as generic decoration instead of meaningful state

References:

- ISA-101 standards overview: https://www.isa.org/standards-and-publications/isa-standards/isa-101-standards
- High Performance HMI overview: https://www.isa.org/getmedia/06130a38-f7af-4b35-8c9c-2c34f25c1977/The-High-Performance-HMI-Overview-v2-01.pdf

### Schematic transit maps

Transit maps work because they simplify. They trade geographic accuracy for decision clarity: lines, stations, transfers, direction, and service state.

Pattern to adopt:

- draw business flows as schematic lines, not physical org charts
- place coworker actions at stations and gates
- show transfers and dependencies clearly
- let the diagram be "wrong" about physical layout when that makes the operating model easier to understand

Pattern to reject:

- graphing every database object, agent relation, and tool dependency in one hairball
- treating the map as literal geography
- optimizing for completeness at the expense of navigation

References:

- TfL Harry Beck Tube map heritage: https://tfl.gov.uk/corporate/about-tfl/culture-and-heritage/art-and-design/harry-becks-tube-map
- London Transport Museum map collections: https://www.ltmuseum.co.uk/collections

### Value stream mapping

Value stream mapping shows the flow of work and information from demand to delivery. Lean Enterprise Institute describes value-stream maps as a way to capture current material and information flow, design future flow, and create a common language for process decisions.

Pattern to adopt:

- map the value stream, not only the worker
- show information flow and work flow together
- support current-state and future-state views
- make bottlenecks, queues, rework, and handoffs visible

Pattern to reject:

- only showing coworker internals without showing customer/business flow
- drawing a process diagram that cannot be used to improve the process

Reference:

- Lean Enterprise Institute value stream mapping overview: https://www.lean.org/lexicon-terms/value-stream-mapping/

### Porter value chain

Porter's value chain is useful as the generic business architecture layer. Harvard's Institute for Strategy and Competitiveness describes it as a tool for disaggregating a company into strategically relevant activities and locating sources of competitive advantage.

Pattern to adopt:

- use value-chain structure as the generic fallback for businesses without a stronger archetype map
- treat AI coworkers as supporting or primary-activity accelerators depending on their role
- connect coworker work to cost, speed, quality, differentiation, or customer experience

Pattern to reject:

- forcing every business into the same manufacturing-style process
- using Porter's model as a static textbook diagram instead of a practical control surface

Reference:

- Harvard ISC value chain overview: https://www.isc.hbs.edu/strategy/business-strategy/Pages/the-value-chain.aspx

### AI agent observability and workflow tools

Modern AI agent tooling is converging on traces, spans, tool calls, handoffs, guardrails, and workflow graphs.

OpenAI Agents tracing includes spans for agent runs, model generations, function/tool calls, guardrails, and handoffs. LangSmith observability emphasizes seeing which tools are called, what prompts are generated, and how agents make decisions. AutoGen Studio provides a low-code interface for prototyping agents, composing teams, and interacting with workflows.

Pattern to adopt:

- every visible animation should be backed by a real event, trace span, tool call, policy gate, or evidence receipt
- users should be able to drill from a map pulse into the actual execution trace
- handoffs and approvals should be first-class visual events
- visual management should be useful for debugging and governance, not just presentation

Pattern to reject:

- showing hidden chain-of-thought as the management primitive
- implying certainty or intent that the runtime did not record
- using agent "thought bubbles" as a substitute for traceable events and evidence

References:

- OpenAI Agents SDK tracing: https://openai.github.io/openai-agents-python/tracing/
- LangSmith observability: https://docs.langchain.com/oss/python/langchain/observability
- AutoGen Studio: https://microsoft.github.io/autogen/stable/user-guide/autogenstudio-user-guide/index.html

## Design Principles

1. **Map the business, not the database.** The visual surface shows business flow and control points. Low-level tables and runtime objects remain available through inspectors and traces.

2. **Show actual events only.** Animation must correspond to persisted or streamed runtime events: tool calls, handoffs, approvals, failures, evidence, model calls, or policy decisions.

3. **Project, don't republish.** The map consumes canonical primitives — `AgentEvent` from the `tak/` bus, `ToolExecution` + `ToolExecutionReceipt` rows, `BacklogItemActivity` (`kind="evidence"`) and `ExternalEvidenceRecord` rows, task-state from `task-states.ts`. It does not invent a parallel event union, a parallel state machine, a parallel transport, or a parallel evidence model. New event types belong on the canonical bus first.

4. **Normal is quiet.** Calm baseline. Motion and color are reserved for active work, blocked work, incidents, risks, approvals, and degraded paths.

5. **Archetype changes the map, not the runtime contract.** Business archetypes select map templates and vocabulary. They do not fork coworker execution semantics.

6. **Every visual object has a control path.** If a user can see a coworker, gate, line, station, or alert, they can inspect and (with the right authority) adjust the relevant configuration.

7. **Provide map, table, and trace views.** A visual map is excellent for orientation, but dense management still needs tables and debugging still needs traces. The map links into the existing `/platform/ai/history` and `/platform/ai/authority` views; it does not replace them in V1.

8. **Accessible by default.** Reduced-motion (`prefers-reduced-motion`) is a first-class state, not an afterthought. Color is never the sole indicator — every state carries label, icon, or shape. Keyboard navigation and screen-reader landmarks are V1 acceptance criteria.

9. **No decorative agent theater.** Coworker animation should never imply unlogged cognition, magic, or hidden agency.

## Visual Grammar

### Core objects

| Visual object | Meaning | Data source |
| --- | --- | --- |
| Line | Business value stream or workflow | archetype map template, workflow taxonomy |
| Station | Business stage or capability module | archetype category, activation modules, route context |
| Coworker badge | AI coworker assigned or active at a station/line | agent registry, assignments, task runs |
| Pulse | Active execution moving through a workflow | live events, trace spans, tool execution |
| Gate | Approval, policy, hook, or risk checkpoint | authority binding, hook lifecycle, HITL policy |
| Signal | Healthy, waiting, blocked, degraded, failed | task state, tool result, policy decision |
| Transfer | Handoff between coworkers or systems | event bus, task handoff, A2A/coworker delegation |
| Evidence | Backlog-anchored evidence, external tool evidence, receipt, or build artifact | `BacklogItemActivity` (`kind="evidence"`) via `record_execution_evidence`; `ExternalEvidenceRecord`; `ToolExecutionReceipt`; Build Studio `FeatureBuild` artifacts |
| Incident marker | Failure requiring attention | task state, tool failure, alarm policy |

### Motion rules

Motion is allowed only for:

- active work progressing through a line
- a tool call in flight
- a handoff between coworkers
- an approval waiting for input
- a newly raised incident

Motion is not allowed for:

- idle coworkers
- static capability ownership
- decorative ambience
- unverified "thinking" states

### Color rules

The implementation must use DPF theme tokens per AGENTS.md §12 — no hardcoded hex, no `text-gray-*`, no inline `style.color`.

Existing tokens (defined in `apps/web/app/globals.css`, overridden by branding at runtime — both light and dark scopes):

- `--dpf-bg`, `--dpf-surface-1`, `--dpf-surface-2`, `--dpf-surface-3` — calm baseline surfaces (default / idle stations + lines)
- `--dpf-text`, `--dpf-text-secondary`, `--dpf-muted` — primary and secondary text
- `--dpf-border`, `--dpf-border-strong` — line strokes, station outlines at rest
- `--dpf-accent`, `--dpf-accent-soft` — active pulse / coworker badge highlight
- `--dpf-success`, `--dpf-warning`, `--dpf-error`, `--dpf-info` — semantic state tokens

**Do not introduce new state tokens for the map.** The state palette above is already complete and is already piped through the branding pipeline. Earlier drafts of this spec proposed `--dpf-state-error` / `--dpf-state-warning`; that was based on a misread of `globals.css`. Reuse the existing `--dpf-*` tokens.

V1 state → token mapping:

| State | Surface / stroke | Text / icon | Required non-color cue |
| --- | --- | --- | --- |
| Idle | `--dpf-surface-1` / `--dpf-border` | `--dpf-muted` | rest shape only |
| Active | `--dpf-accent-soft` fill + `--dpf-accent` stroke (restrained motion) | `--dpf-text` | pulse glyph |
| Waiting approval | `--dpf-surface-2` + `--dpf-accent` dashed stroke | `--dpf-text` | clock/hand icon + "WAITING" label |
| Blocked / failed | `--dpf-error` stroke on `--dpf-surface-1` | `--dpf-text` | "BLOCKED" label + diamond shape |
| Degraded | `--dpf-warning` stroke on `--dpf-surface-1` | `--dpf-text` | "DEGRADED" label + triangle |
| Verified (receipt) | `--dpf-success` thin border on Evidence chip | `--dpf-muted` | checkmark glyph, used sparingly |
| Info (informational badge) | `--dpf-info` stroke | `--dpf-muted` | "i" glyph |

Color is never the sole indicator. Every state carries label + icon + shape so the map remains usable under monochrome rendering and for users with color-vision differences. The branding pipeline (`BrandingConfig` → `globals.css` overrides) already exercises these tokens; the map does not introduce new branding contracts.

## Information Architecture

### Global AI Workforce Area

Target tab grouping, with explicit mapping from the existing routes (each row references the actual folder under `apps/web/app/(shell)/platform/ai/`):

| New tab | Subsumes existing route(s) | V1 behavior |
| --- | --- | --- |
| Coworkers | `(root)`, `agent/`, `assignments/` | unchanged content under a clearer label |
| Operations Map | (new) `operations-map/` | new route; first-class tab |
| Activity | `history/` | unchanged content; renamed tab |
| Tools & Authority | `authority/` (grants + policy + `ToolExecution` audit) | grants surface stays; gains link from map |
| Models & Routing | `providers/`, `model-assignment/`, `routing/` | unchanged content; consolidated tab |
| Prompts & Skills | `prompts/`, `skills/` | unchanged content |
| Build Studio | `build-studio/` | stays as its own surface; appears as a coworker on the Operations Map |
| (alias slot) | `operations/` | already a `permanentRedirect` to `build-studio/`; V2 may repoint to `operations-map/` |

V1 route plan:

- Operations Map ships at `/platform/ai/operations-map` as a new route alongside existing routes. No existing routes are removed in V1.
- Nav lands in `apps/web/components/platform/platform-nav.ts` and `apps/web/components/platform/AiTabNav.tsx` — add the new entry; do not refactor the whole structure in the same PR.
- Tab grouping is a navigation refresh; underlying routes keep working. Legacy redirects (per AGENTS.md §2 precedent) land in V2 once the new IA is exercised.
- Build Studio remains addressable at its own URL; it surfaces on the map as one or more coworker badges anchored to Build / Verify stations. The reconciliation between Build Studio's per-task substrate (`2026-04-30-build-specialist-operator-contract.md`) and a single map badge is an open question (see §Open Questions).

### Per-Coworker Detail

Recommended tabs:

- **Overview** - who this coworker is, business role, active map position
- **Capabilities** - skills, tools, integrations, model routing
- **Governance** - tool grants, policy gates, approvals, sensitivity limits
- **Runtime** - current tasks, health, budgets, degradation
- **Knowledge and Prompts** - assigned prompts, memory context, route context
- **Activity** - trace timeline, evidence, tool executions, failures

The per-coworker page should link back to the Operations Map with the coworker selected.

## Archetype Map Templates

### Generic fallback: Porter/value-chain map

Use this when an install has no stronger archetype map.

Primary flow:

1. Demand
2. Intake
3. Delivery
4. Customer Experience
5. Support
6. Improve

Support bands:

- Platform and tools
- People and policies
- Finance and governance
- Knowledge and data

### Software platform map

Use for `software-platform`.

Primary flow:

1. Discover
2. Backlog
3. Design
4. Build
5. Verify
6. Release
7. Support
8. Improve

Expected coworker positions:

- Scout/research coworkers at Discover and Backlog
- Architect/design coworkers at Design
- Build Studio coworkers at Build and Verify
- Release/governance coworkers at Release
- Support/operations coworkers at Support and Improve

This should be the first implementation target because DPF can use it on itself.

### Managed service provider map

Use when activation profile is `managed-service-provider`, especially `it-managed-services`.

Primary flow:

1. Customer Intake
2. Triage
3. Agreement and SLA
4. Service Operations
5. Customer Estate
6. Billing Readiness
7. Lifecycle Review
8. Improvement

Sidecar graph:

- customers
- sites
- configuration items
- agreements
- lifecycle signals
- integrations

This should be the second implementation target because it exercises activation modules such as `customer-estate`, `service-agreements`, `billing-readiness`, `service-operations`, `lifecycle-signals`, and `integrations`.

### Healthcare and wellness map

Primary flow:

1. Inquiry
2. Intake
3. Schedule
4. Visit or Service
5. Follow-up
6. Recall or Compliance
7. Retention

Control emphasis:

- privacy and sensitivity gates
- approval before external communication
- scheduling and follow-up reliability

### Retail and goods map

Primary flow:

1. Demand
2. Catalog
3. Order
4. Fulfillment
5. Support
6. Retention

Control emphasis:

- inventory and fulfillment status
- customer communication
- revenue and support signals

### Education and training map

Primary flow:

1. Inquiry
2. Enrollment
3. Delivery
4. Progress
5. Completion
6. Follow-up

Control emphasis:

- learner progress
- schedule/session operations
- credential or completion evidence

### Nonprofit and community map

Primary flow:

1. Awareness
2. Donor or Volunteer Intake
3. Program Delivery
4. Impact Evidence
5. Stewardship

Control emphasis:

- mission outcomes
- donor trust
- volunteer and program coordination

### HOA and property management map

Primary flow:

1. Request or Notice
2. Review
3. Work Order or Compliance
4. Communication
5. Assessment or Meeting
6. Resolution

Control emphasis:

- transparent approvals
- resident communication
- recurring obligations and meeting evidence

## Control Model

### Inspecting a station

Selecting a station should show:

- purpose of the business stage
- assigned coworkers
- active and recent tasks
- relevant tools and integrations
- policies and approval gates
- evidence generated at this station
- common adjustments

### Inspecting a coworker

Selecting a coworker should show, per the Operator Contract pattern (`2026-04-30-ai-coworker-operator-pattern.md`):

- identity: `Principal` + display label, with the `PrincipalAlias` (agent kind) that emitted the events
- role and business responsibility (domain perspective)
- current position on the map
- active task and recent activity, keyed by `taskRunId` / `threadId`
- what counts as concrete work product for this coworker
- when this coworker requires explicit approval (write/external/destructive boundaries)
- assigned skills
- available tools and grants
- model routing
- policies, approval mode, and sensitivity ceiling
- current degraded features or blocked capabilities
- recommended adjustments (read-only in V1; write actions deferred per §Control Inspector Writes)

### Inspecting a gate

Selecting a gate should show:

- gate type: approval, policy, hook, risk, sensitivity, spend, destructive action
- trigger condition
- current behavior
- recent allowed/denied decisions
- owner or approver
- proposed adjustment path

### Inspecting an activity pulse

Selecting an activity pulse should show:

- trace summary
- coworker
- current step
- tool/model calls
- elapsed time
- waiting condition
- evidence and artifacts
- failure or retry state

## Access Model

The Operations Map is a sensitive surface — it concentrates policy decisions, denied executions, sensitivity ceilings, and evidence. Per AGENTS.md §8, tool **invocation** intersects user-role capabilities × agent grants. The map **view** needs a parallel rule, **expressed in the platform's existing capability vocabulary**, not a new ad-hoc one.

The canonical capability set lives in `apps/web/lib/govern/permissions.ts` (re-exported from `apps/web/lib/permissions.ts`). The Operations Map composes from capabilities that already exist:

- `view_platform` — baseline access to platform shell routes (already gates `/platform/*`)
- `view_admin` — administrative inspection across platform subsystems
- `manage_agents` — agent ↔ assignment / routing / grant inspection (already controls `/platform/ai/authority` write paths)
- `manage_capabilities` — capability registry (governs the underlying authority data)
- `view_compliance` / `manage_compliance` — evidence and audit detail

V1 access tiers (no new capability keys in V1; tiers are **derivations** over existing capabilities):

| Tier | Required capabilities (intersection of platform roles) | Sees |
| --- | --- | --- |
| Operator | `view_platform` | lines, stations, coworker badges, pulses, severity, generic counts; no parameters, no policy detail |
| Reviewer | `view_platform` + `manage_agents` | + gate state, approval queues, denied calls (parameters redacted to summary) |
| Auditor | `view_platform` + `view_compliance` | + Evidence chips with payload, `ToolExecution.parameters`, `result`, `auditClass`, `ToolExecutionReceipt` detail |
| Admin | `view_platform` + `view_admin` + `manage_agents` | + write actions (deferred to V2; see Control Inspector Writes) |

Redaction rules:

- `ToolExecution.parameters` and `result` are projected as `summary` (existing `ToolExecution.summary` column) for Operator and Reviewer. Auditor sees full payload subject to existing sensitivity policy.
- Coworkers whose visibility scope excludes the viewer's role are hidden, not greyed out. Their pulses still count toward aggregate health on the line.
- Cross-organization data never appears on the map (single-org-per-install invariant). Even so, queries scope on `organizationId` defensively, not just on the absence of cross-org joins.

If a future iteration genuinely needs a new capability (e.g. distinguishing "see Evidence chips" from "see full payload"), it lands as a new entry in `lib/govern/permissions.ts` with a matching `getShellNavSections` / `getWorkspaceTiles` plumbing change in the same PR — never as a map-local flag.

### Control Inspector Writes

V1 inspectors are read-only. The Executive Decision's "Control inspector" is implemented as inspect-and-link-out in V1 — selecting a recommendation deep-links to the existing surface (`/platform/ai/authority`, `/platform/ai/routing`, etc.) that owns the change. V2 introduces in-map writes behind preview + explicit confirmation + audit, with no change to AGENTS.md §8 grant enforcement.

## Runtime Data Contract

The map consumes canonical runtime sources. It does not introduce a new wire envelope. The projection is a view type.

### Sources (no new substrate)

| Source | Origin | Used for |
| --- | --- | --- |
| `AgentEvent` stream | `apps/web/lib/tak/agent-event-bus.ts`, delivered over `/api/agent/stream` (SSE) | active task pulses, status transitions, artifacts, tool start/complete, verification, orchestrator phases, queue escalations |
| `ToolExecution` rows | `apps/web/lib/mcp-governed-execute.ts` writes | tool-call pulses (post-hoc), denied calls (`success=false` + `auditClass`), latency, `executionMode`, `routeContext`, `auditClass`, `capabilityId`, `summary` |
| `ToolExecutionReceipt` rows | written by the governed executor for receipt-bearing calls | Verified Evidence chip (`receiptKind`, `receiptStatus`, `inputFingerprint`, `outputDigest`, `expiresAt`) |
| `BacklogItemActivity` (`kind="evidence"`) | `record_execution_evidence` MCP (`apps/web/lib/mcp-tools.ts:3494`) | backlog-anchored evidence chips (`test_pass`, `build_pass`, `ux_verified`, `spec_review`, `manual_check`, `external_link`) |
| `ExternalEvidenceRecord` rows | `apps/web/lib/actions/external-evidence.ts` writes | external-tool evidence chips (`provider`, `operationType`, `target`, `resultSummary`) |
| Task state | `apps/web/lib/tak/task-states.ts` vocabulary | severity mapping (see below) |
| Authority decisions | `getAvailableTools` / agent grants (AGENTS.md §8); resolved into `ToolExecution.success=false` rows at runtime | gate state, denied call attribution |
| Provider / model attribution | `AgentEvent` `done.providerInfo`, `async:started`, deliberation events | inspector model attribution, fallback signals — **not on `ToolExecution`** |

The map's read path is a **single server projection function** that fans out to these sources by `(organizationId, threadId|taskRunId|agentId|backlogItemId, occurredAt window)` and merges into `MapProjection[]`. The function is the only place that knows about the heterogeneous source set; the client component sees a uniform stream.

### Projection type (view layer only)

```ts
// apps/web/lib/ai-operations-map/types.ts
type MapProjection = {
  id: string;                       // synthetic projection id
  occurredAt: string;               // sourced from AgentEvent or ToolExecution.createdAt
  organizationId: string;
  archetypeCategoryId: string;      // resolved from StorefrontConfig.archetypeId
  mapTemplateId: string;            // chosen template (e.g. "software-platform")
  actor: {
    principalId: string;            // canonical identity (AGENTS.md §11)
    aliasKind: "agent" | "user" | "service-account" | "edge-node" | "mobile-device";
    label: string;                  // display only
  };
  location: {
    lineId: string;
    stationId?: string;
    gateId?: string;
  };
  kind:
    | { source: "agent-event"; event: AgentEvent }                              // any discriminant on the canonical union
    | { source: "tool-execution"; row: ToolExecutionView }                      // includes denied via success=false + auditClass
    | { source: "tool-receipt"; row: ToolExecutionReceiptView }                 // verified outcome
    | { source: "evidence-backlog"; row: BacklogItemActivityView }              // BacklogItemActivity where kind="evidence"
    | { source: "evidence-external"; row: ExternalEvidenceRecordView }
    | { source: "handoff"; from: PrincipalRef; to: PrincipalRef };              // synthesized from queue:escalation / orchestrator:task_dispatched
  severity: "normal" | "attention" | "warning" | "critical";       // derived from task state + auditClass
  summary: string;                                                  // human-readable, never authoritative
  refs: {
    taskRunId?: string;
    threadId?: string;
    toolExecutionId?: string;
    toolReceiptId?: string;
    backlogItemActivityId?: string;
    externalEvidenceRecordId?: string;
    buildId?: string;            // FeatureBuild for Build Studio pulses
    traceId?: string;
    capabilityId?: string;
  };
};
```

### Severity derivation

Severity is derived, not stored. The mapping is exhaustive over `TaskState` and over the existing `auditClass` values written by `mcp-governed-execute.ts`; a discriminated-union exhaustiveness check fails the build if a new value is added without a corresponding mapping in the same PR.

Mapping:

- `TaskState` `failed` / `rejected` → `critical`
- `TaskState` `input-required` / `auth-required` → `attention`
- `TaskState` `canceled` → `warning`
- `TaskState` `submitted` / `working` → `normal` (active, not abnormal)
- `TaskState` `completed` / `archived` → `normal`
- `ToolExecution.success === false` + `auditClass` ∈ {destructive, sensitive} → `critical`
- `ToolExecution.success === false` otherwise → `warning`
- `AgentEvent.type === "error"` or `async:failed` → `critical`
- `AgentEvent.type === "queue:sla_warning"` or `orchestrator:specialist_retry` → `warning`
- `AgentEvent.type === "deliberation:degraded_diversity"` → `warning`
- `ToolExecutionReceipt.receiptStatus !== "valid"` → `warning`
- everything else → `normal`

### No new event types in V1

The canonical `AgentEvent` union already covers task lifecycle, tool calls, orchestrator phases, queue escalations, verification, deliberation, brand extract, and async inference. **The map MUST NOT add a parallel discriminant in V1.** If a genuine gap appears during implementation, it lands on the canonical bus first, with a companion change in the substrate spec (`2026-04-29-coworker-execution-adapter-substrate-design.md`) — never as a parallel envelope owned by the map. Specifically, handoffs are projected from `queue:escalation` and `orchestrator:task_dispatched` / `task_complete` correlated by `threadId|buildId`; approvals are projected from `task:status === "input-required" | "auth-required"`; verification is projected from `verification:complete`.

## Data Model Recommendation

Do not begin with a large schema migration.

Start with code-owned map templates:

- `apps/web/lib/ai-operations-map/templates.ts`
- `apps/web/lib/ai-operations-map/types.ts`
- `apps/web/lib/ai-operations-map/project-events.ts`

Only add database persistence after the first read-only map proves the model.

Likely future persisted concepts:

- `CoworkerMapTemplate`
- `CoworkerMapNode`
- `CoworkerMapLine`
- `CoworkerMapAssignment`
- `CoworkerMapViewPreference`

Persistence should support operator customization later, but the V1 should avoid making map editing part of the first slice.

## UX Modes

### Live mode

Shows the current operational state:

- active tasks
- waiting approvals
- incidents
- recent handoffs
- latest evidence

### Review mode

Shows what happened over a selected time range:

- task paths
- tool calls
- failures
- approvals
- evidence
- cost and latency

### Simulation mode

Preview-only mode for policy and capability changes:

- "If this coworker gets this tool grant, where can it act?"
- "If this approval gate becomes automatic, which lines become unblocked?"
- "If this model route degrades, which workflows are affected?"

Simulation is a later phase. It should not block the first implementation.

## First Implementation Slice

Build a read-only Software Platform Operations Map.

Scope:

- add a new `/platform/ai/operations-map` route or equivalent tab
- render the software-platform map template
- show coworker badges by known role/assignment where available
- project recent tool executions and task events onto the map
- open an inspector for coworker, station, gate, and event selections
- link from the map to existing per-coworker detail pages and activity/history pages

Non-goals for slice 1:

- map editing
- live WebSocket animation if existing event plumbing is not ready
- new database tables
- archetype customization UI
- simulation
- policy modification from the map

Acceptance (measurable):

1. **Orientation task.** Starting from `/platform/ai/operations-map`, a new admin can answer "which coworkers ran in the last hour and where on the business flow" without using filters or search. Verified by walkthrough on the running portal.
2. **Drill-down task.** Selecting any pulse opens an inspector that links to the underlying `ToolExecution`, `BacklogItemActivity` (`kind=evidence`), `ExternalEvidenceRecord`, `ToolExecutionReceipt`, or `AgentEvent`-derived trace in `/platform/ai/history` or `/platform/ai/authority`. No dead links — verified by automated test that walks every link in a seeded fixture.
3. **Trace integrity.** No map element renders without a backing row or event in the canonical sources listed in §Runtime Data Contract. Enforced by automated test (see §Test Strategy).
4. **Access tiers honored.** `Operator` (`view_platform`) sees summary-only; `Auditor` (`view_platform` + `view_compliance`) sees full payload. Cross-org rows never appear; queries scope on `organizationId` defensively.
5. **Identity.** All `actor` references resolve to a `Principal` via `PrincipalAlias`. No new identity discriminator in the map view layer.
6. **Theme tokens.** Zero hardcoded colors per AGENTS.md §12. Map reuses existing `--dpf-*` tokens (including `--dpf-error`, `--dpf-warning`, `--dpf-success`, `--dpf-info`, `--dpf-accent-soft`); **no new tokens introduced** by this slice. Verified by lint (`no-hex-colors`) and by visual check under the default light + dark themes.
7. **Reduced motion.** With `prefers-reduced-motion: reduce`, all pulses become static badges with state labels; the map remains fully usable. Verified by component test that asserts `aria-live` regions still update without motion.
8. **Keyboard + a11y.** Map is keyboard-navigable; stations, coworkers, gates, and inspector triggers expose ARIA roles and labels. Verified by axe-core component pass and a keyboard-only walkthrough.
9. **No new permission keys.** V1 composes from existing `PERMISSIONS` (`lib/govern/permissions.ts`); zero additions in V1.
10. **Build gate (AGENTS.md §5).** `npx vitest run` (affected files), `pnpm --filter web typecheck`, `cd apps/web && npx next build` all pass.
11. **PR hygiene (AGENTS.md §4).** Branch `feat/ai-operations-map-v1`; one concern; DCO `Signed-off-by:` on every commit (`git commit -s`); squash-and-delete on merge. Branch guard run before commit.

## Second Implementation Slice

Add Managed Service Provider map support. Reuses the MSP archetype model already defined in `2026-04-23-it-service-provider-msp-archetype-design.md`; this slice does not redefine customer-estate semantics.

Scope:

- detect MSP activation profile via the existing `ActivationProfile.modules` contract (`customer-estate`, `service-agreements`, `billing-readiness`, `service-operations`, `lifecycle-signals`, `integrations`)
- render MSP flow and sidecar customer-estate graph summary using the data the MSP archetype spec already commits to
- place coworker activity around intake, triage, agreements, service operations, customer estate, billing readiness, and lifecycle review
- show estate-separation and customer-graph signals in the inspector

Acceptance:

- MSP installs no longer see a generic software/platform map
- customer-estate and service-agreement activity appears in the right business context
- users can distinguish internal platform work from customer-estate work
- the sidecar graph reads only from the data shapes the MSP archetype spec commits to; no new MSP-specific tables introduced in this slice

## Refactoring Budget

The implementation should reserve explicit time for refactoring before adding new UI behavior.

Recommended refactors:

1. extract a coworker detail summary model from the current per-agent route
2. centralize AI workforce navigation so the Operations Map is not bolted onto duplicate tab structures
3. create a map projection layer that converts existing runtime records into `CoworkerMapEvent`
4. move hardcoded visual state in AI workforce pages toward theme-aware tokens while touching related UI

Do not start by rewriting all AI workforce pages. Refactor only the pieces needed to make the map and inspector clean.

## Risks

### Risk: Decorative animation without operational value

Mitigation:

- animation must map to real runtime events
- every animated object must be inspectable
- normal operation stays quiet

### Risk: One generic map becomes useless for every business

Mitigation:

- one visual grammar
- multiple archetype templates
- generic Porter/value-chain map only as fallback

### Risk: Hairball graph

Mitigation:

- stations are business stages, not tables
- details move into inspector and trace views
- map lines are curated templates, not automatic database relationship graphs

### Risk: Control changes become too easy

Mitigation:

- V1 is read-only
- later policy/grant changes go through preview, explicit confirmation, and audit
- destructive or high-risk changes keep existing approval rules

### Risk: Archetype map drift

Mitigation:

- map templates live with archetype activation contracts
- adding activation modules should require a matching map-template review
- tests assert that known activation modules are represented or deliberately hidden

### Risk: Parallel event grammar

The single largest integration risk. If the map introduces its own event union, transport, or task-state vocabulary, the platform ends up with two competing event grammars that drift apart over time.

Mitigation:

- the map consumes `AgentEvent` from `apps/web/lib/tak/agent-event-bus.ts` over the existing SSE route
- task state reuses `apps/web/lib/tak/task-states.ts` exactly
- `MapProjection` is a view type, not a wire envelope
- new event kinds land on the canonical bus first, in a substrate-spec PR, never as an Operations Map private extension
- an exhaustiveness test fails the build if the projection mapping is missing a `TaskState` or `auditClass` value

### Risk: Parallel identity model

The proposed `actor` field could grow into a parallel identity table over time.

Mitigation:

- `actor.principalId` resolves via `PrincipalAlias` (AGENTS.md §11, 2026-05-09 addendum)
- the projection never persists identity; it references `Principal` by id and reads label from the alias
- adding a new actor kind requires a new `PrincipalAlias.aliasKind`, not a new map-local enum

## Test Strategy

### Unit tests

- map template validity (every station/line referenced by templates exists; ids are stable across reorderings)
- archetype-to-map selection (`StorefrontConfig.archetypeId` → template id)
- projection correctness from fixtures covering each source: `AgentEvent`, `ToolExecution`, `ToolExecutionReceipt`, `BacklogItemActivity` (`kind="evidence"`), `ExternalEvidenceRecord`
- severity mapping (discriminated-union exhaustiveness check across the `TaskState` union and the `auditClass` values used by `mcp-governed-execute.ts`)
- inspector link generation (every projection produces a working deep-link into `/platform/ai/history`, `/platform/ai/authority`, or the relevant feature page)
- **trace integrity invariant**: a randomized set of `MapProjection` values can always be resolved back to a real source row by `refs.taskRunId | toolExecutionId | toolReceiptId | backlogItemActivityId | externalEvidenceRecordId`
- access-tier redaction (Operator/Reviewer/Auditor/Admin see the expected shape; cross-org rows are filtered even when seeded across two organizations)
- identity resolution (every `actor.principalId` resolves through a `PrincipalAlias` row; no synthetic ids)

### Component tests

- renders map with no events
- renders active event pulse
- renders blocked/approval state
- opens inspector from station, coworker, gate, and event
- supports reduced-motion preference

### UX verification

Run against the running portal:

1. open `/platform/ai/operations-map`
2. verify software-platform map renders
3. select a coworker
4. inspect a recent event
5. navigate to underlying coworker/activity detail
6. verify reduced-motion mode is usable
7. verify mobile/tablet fallback uses a stacked map plus inspector, not horizontal overflow chaos

### Build gate

Per repo rulebook:

- affected unit/component tests
- `pnpm --filter web typecheck`
- `pnpm --filter web exec next build`
- UX verification against the running app for UI changes

## Open Questions

1. **Launch shape.** New tab at `/platform/ai/operations-map` first (recommended). Replacement of the AI overview waits until the new IA is exercised on a real install. The legacy `/platform/ai/operations` redirect is an available alias slot; V2 IA refresh may point it at the map.
2. **Template ownership.** Code-owned through V2. Admin customization is deferred — the platform must first prove the model has settled before opening it for edit.
3. **Auto-placement.** Which coworker roles are canonical enough today to place automatically on the software-platform map? Resolve in the V1 PR by querying the `Agent` registry on a fresh install + DPF's own production instance and listing the roles actually seeded. Anything not in that intersection lives in an "unplaced" lane until manually positioned in V2.
4. **Projection precedence.** When the same logical event appears on both the `AgentEvent` bus and as a `ToolExecution` row (common for tool starts), which is authoritative for the pulse? **Decision:** `ToolExecution` is the audit truth; `AgentEvent` is the liveness signal. Inspector shows both; map deduplicates by `(toolExecutionId, occurredAt±2s)`. Pulses that exist only on the bus (e.g. `verification:step`) remain liveness-only and inspector-linked.
5. **Build Studio rendering.** Single coworker badge anchored to Build, with per-task children in the inspector? Or per-phase badges across Design / Build / Verify? **Resolved for V1:** one badge per active `FeatureBuild` anchored to Build with phase shown inside the badge (`phase:change` event drives the position from Design → Build → Verify → Release). Per-task specialists appear in the inspector, not on the map, per `2026-04-30-build-specialist-operator-contract.md`.
6. **Handoff event.** The current `AgentEvent` union has no `task:handoff`, but it has `queue:escalation`, `orchestrator:task_dispatched`, `orchestrator:task_complete`, and queue transitions. **Decision:** V1 projects handoffs from those existing discriminants correlated by `(threadId|buildId, workItemId)`. Do **not** add a `task:handoff` discriminant in V1; revisit only if correlation proves unreliable on a real install.
7. **Live transport scope.** Should V1 subscribe to `/api/agent/stream` SSE for live pulses, or render only the post-hoc projection from DB rows? **Recommendation:** server-side render the post-hoc projection (DB) for V1; gate live SSE subscription behind a feature flag in the same PR so it can be enabled per install once thread fan-out is reviewed. This keeps the slice small without painting the map into a "static-only" corner.

## Backlog Linkage

Per AGENTS.md §6, backlog lives in PostgreSQL — not in this spec. Before implementation:

1. Query existing epics for overlap with "operations map", "coworker UI", or "AI workforce navigation". Prefer extending an existing epic.
2. If no fit, create a new epic (suggested slug: `EP-AI-OPSMAP`) with backlog items mapped to the two implementation slices and the refactoring budget above.
3. Link this spec from the epic. Each item references the section here that defines its acceptance.
4. Implementation work proceeds via PRs against `main` with DCO sign-off, branch protection, and the §5 build gate. No direct pushes (AGENTS.md §4).

## Recommendation

Proceed with the read-only Software Platform Operations Map as the next implementation slice, on the conditions that:

- the map projects from canonical primitives (`AgentEvent`, `ToolExecution`, `ToolExecutionReceipt`, `BacklogItemActivity` with `kind="evidence"`, `ExternalEvidenceRecord`) and does **not** introduce a parallel event envelope, transport, or evidence ledger
- `actor` references resolve via `PrincipalAlias` (AGENTS.md §11, 2026-05-09 addendum)
- the IA refresh enumerates the actual routes under `apps/web/app/(shell)/platform/ai/` and preserves them in V1; nav lands in `platform-nav.ts` + `AiTabNav.tsx`
- access tiers compose from existing `PERMISSIONS` (`lib/govern/permissions.ts`); no new capability keys in V1
- styling reuses existing `--dpf-*` tokens (including `--dpf-error`, `--dpf-warning`, `--dpf-success`, `--dpf-info`, `--dpf-accent-soft`); no new tokens introduced in V1

This slice is small enough to ship without schema churn, but it creates the architectural spine for the larger idea:

- coworker management by business flow
- archetype-specific visual operations
- traceable AI activity grounded in canonical events
- governed controls aligned with existing authority surfaces
- practical inspector-based adjustment

The second slice adds the Managed Service Provider map because it validates that archetypes can express genuinely different operating models, not merely different labels.
