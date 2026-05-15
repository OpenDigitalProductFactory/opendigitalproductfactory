# DPF Business Operating System Command Center Design

| Field | Value |
|-------|-------|
| Status | Draft for review |
| Date | 2026-05-15 |
| Scope | Workspace home command center, human plus AI workforce operating model, six-C readiness model |
| Primary surface | `/workspace` |
| Sibling surfaces | `/platform/ai/operations-map`, `/platform/ai/capability-needs`, `/platform/ai/authority`, `/platform/audit/authority` |
| Related specs | `2026-04-25-tak-gaid-auth-identity-memory-refresh-design.md`, `2026-04-23-a2a-aligned-coworker-runtime-design.md`, `2026-04-30-ai-coworker-operator-pattern.md`, `2026-05-10-ai-coworker-visual-control-surface-design.md` |
| Backlog alignment | Extends `EP-TAK-3F9A21` concepts; likely needs a new Workspace/Business OS epic before implementation |

## Purpose

DPF should present itself as a Business Operating System, not only as a collection of modules plus an AI chat panel. The workspace home screen should become the command center where an operator can see what is happening across the business, where human employees and AI coworkers are active, what needs attention, what is safe to trust, and what is contained by policy or approval.

The external AIOS transcript contributed a useful mental model: context, connections, capabilities, and cadence. DPF should keep that model but add two enterprise-grade primitives:

- **Confidence**: how much the operator can trust the signal, recommendation, model profile, memory, route, or action.
- **Containment**: the boundary around action, including authority, budget, data scope, blast radius, approval posture, and rollback path.

Together these form the six Cs of DPF's Business OS:

1. **Context**: What the platform knows, and which source of truth backs it.
2. **Connections**: Which systems, APIs, MCP servers, credentials, files, and people it can reach.
3. **Capabilities**: What humans, AI coworkers, skills, tools, and deterministic workflows can do.
4. **Cadence**: What runs on schedule, what recurs, what catches up, and what changes when people are away.
5. **Confidence**: How trustworthy each signal or action is, based on evidence, freshness, profile quality, and validation.
6. **Containment**: What can happen safely now, under which principal, grant, route, approval tier, and scope.

The first product move is not a new automation engine. It is a clearer command-center projection over data DPF already owns.

## Current Repo Truth

The current `/workspace` page already has the right home-base shape, but it is still a grouped portal landing page rather than a command center. It fetches cross-domain counts, renders workspace tiles, shows attention items, and includes calendar plus activity feed sections in `apps/web/app/(shell)/workspace/page.tsx`.

Existing data already covers much of the command-center substrate:

- `/workspace` counts products, portfolios, agents, providers, epics, backlog, employees, customers, compliance, and finance records.
- `apps/web/lib/activity-feed-data.ts` builds action, awareness, and history items for employee and HR activity.
- `TaskRun`, `TaskMessage`, and `TaskArtifact` exist as the A2A-shaped work substrate.
- `ScheduledAgentTask` exists for recurring coworker work.
- `ToolExecution` and `ToolExecutionReceipt` exist for tool-call evidence.
- `AuthorizationDecisionLog` exists for authority decisions.
- `AgentActionProposal` exists for approval-required actions.
- `CoworkerSelfAssessment` and `CoworkerCapabilityNeed` exist for coworker capability gaps.
- `KnowledgeArticle.reviewIntervalDays` and `lastReviewedAt` exist but require the TAK/GAID memory freshness work before they should drive consequential decisions.
- `apps/web/lib/ai-operations-map/load-map-data.ts` already projects agents, task runs, tool executions, receipts, backlog evidence, and external evidence into the AI Operations Map.

The current architectural gap is presentation and composition. DPF has many of the records needed to answer "what is going on across the business?", but the first screen does not yet organize them into a small set of operational signals with confidence and containment visible.

## Research And Benchmarking

### Open-Source Patterns

**Plane.** Plane positions itself as an open-source work management alternative with work items, cycles, modules, pages, analytics, and integrations in one workspace. Its useful lesson is that work, docs, cycles, and analytics belong together. DPF should adopt the "one workspace, multiple work objects" idea, but not collapse the business into project-management primitives. DPF has a broader model: products, obligations, invoices, employees, AI coworkers, receipts, and knowledge articles all matter.

Source: [Plane GitHub README](https://github.com/makeplane/plane).

**OpenProject.** OpenProject's Work Package API exposes a rich work-item model: author, assignee, responsible party, project, status, priority, sprint, budget, time entries, children, relations, derived dates, derived effort, and custom fields. DPF should adopt the principle of explicit work relationships and derived rollups. The command center should show source-backed rollups, not hand-authored summaries.

Source: [OpenProject Work Packages API](https://www.openproject.org/pt/docs/api/endpoints/work-packages/).

**n8n.** n8n's database separates workflow definitions, saved executions, execution data, execution metadata, installed nodes, packages, and migrations. The useful pattern is durable run history and execution snapshots. DPF should apply the same principle to AI coworker cadence through `TaskRun`, `ScheduledAgentTask`, `ToolExecution`, and receipts. DPF should not copy broad workflow-editor semantics as the authority model; TAK and GAID must remain the control plane.

Source: [n8n database structure](https://docs.n8n.io/hosting/architecture/database-structure/).

### Commercial Patterns

**monday.com.** monday work management organizes workspaces around boards, items, groups, columns, dashboards, forms, automations, integrations, and AI workflows. The useful lesson is that dashboards and views make operating state legible once workflows exist. DPF should adopt the "dashboard over live work data" pattern while avoiding a board-as-everything model.

Source: [monday work management getting started](https://support.monday.com/hc/en-us/articles/115005305649-Get-started-with-monday-work-management).

**ClickUp.** ClickUp tasks carry descriptions, assignees, priorities, dates, tags, custom fields, and dependencies. DPF should keep task metadata explicit and dependency-aware, but the Business OS command center should not become a task list. Tasks are one signal family among approvals, AI runs, finance risk, compliance exposure, customer obligations, and platform health.

Source: [ClickUp Tasks API docs](https://developer.clickup.com/docs/tasks).

**ServiceNow workspaces.** ServiceNow describes workspaces as focused work areas where agents can complete whole jobs, and offers specialized workspaces for audit, compliance, digital portfolio management, enterprise architecture, service operations, and workforce optimization. The useful lesson is a role-focused single-pane workspace with targeted drill-downs. DPF should adopt this at the home-screen level, but avoid scattering core operating truth across many disconnected workspaces.

Sources: [ServiceNow Configurable Workspace overview](https://www.servicenow.com/docs/r/platform-user-interface/learn-about-agent-workspace.html), [ServiceNow list of workspaces](https://www.servicenow.com/docs/r/platform-user-interface/list-of-workspaces.html).

### Patterns Adopted

- Treat the workspace home as a command center over real operational records.
- Preserve rich domain records rather than forcing every signal into tasks.
- Show execution history and evidence for automated or agentic work.
- Keep dashboards as projections, not sources of truth.
- Show confidence and containment next to AI-driven recommendations and actions.
- Use focused drill-downs for diagnostics, not duplicate top-level navigation.

### Patterns Rejected

- A personal folder/wiki as the runtime control plane.
- A board/list as the universal business model.
- Broad MCP/API access as a convenience default.
- A dashboard that hides provenance, freshness, authority, or approval state.
- A new schema-first "BusinessCommandCenter" table before projection needs prove it.

## Product Model

### Six-C Readiness

Every business domain shown on the command center should have a six-C readiness summary:

| C | Question The Operator Needs Answered | DPF Sources |
|---|--------------------------------------|-------------|
| Context | Does DPF know the current truth for this domain? | Domain tables, `KnowledgeArticle`, `UserFact`, route context |
| Connections | Are the required systems reachable and scoped? | MCP service catalog, integration state, provider state, credentials |
| Capabilities | Who or what can act here? | Agent registry, skills, tool grants, permissions, employees |
| Cadence | What runs without prompting, and what is overdue? | `ScheduledAgentTask`, `TaskRun`, calendar, operating tempo |
| Confidence | Is the signal fresh, validated, and evidence-backed? | profile confidence, receipts, memory freshness, evidence rows |
| Containment | What is bounded by approval, route, principal, cost, and data scope? | TAK grants, proposals, `AuthorizationDecisionLog`, receipts |

Confidence and containment are not decorative labels. They decide whether a signal can become action:

- Low confidence plus weak containment means "show as advisory only."
- High confidence plus strong containment means "eligible for deterministic automation or proposal-mode action."
- High confidence plus weak containment means "operator review required before action."
- Low confidence plus strong containment means "safe to investigate, not safe to execute."

### Workspace Home As Command Center

The command center should answer five questions in the first viewport:

1. **What needs attention now?**
2. **What changed since I last looked?**
3. **Which humans and AI coworkers are active, blocked, or waiting?**
4. **Which parts of the business are healthy, stale, disconnected, or overexposed?**
5. **What can be safely delegated or approved next?**

The first screen should use dense, scannable operational UI rather than a hero or marketing panel. It should not explain DPF. It should show the business.

Recommended layout:

1. **Command Strip**: urgent approvals, failed or blocked AI runs, overdue compliance/finance items, provider degradation, customer-impacting alerts.
2. **Operating Snapshot**: compact metrics for revenue/finance, customers, delivery/build, compliance, workforce, platform health, and AI workforce.
3. **Six-C Readiness Matrix**: rows by business domain, columns for context, connections, capabilities, cadence, confidence, containment. Each cell is a compact state indicator with drill-down.
4. **Human And AI Work In Motion**: active `TaskRun` items, scheduled coworker work, employee calendar commitments, proposals waiting for a human, and recent handoffs.
5. **Command Drawer / Coworker Launch**: contextual actions to ask the right coworker, approve a proposal, inspect evidence, or open the deeper route.

### Navigation Contract

The command center belongs at `/workspace` because that is where an operator starts the day. It should not replace AI Operations.

- `/workspace`: cross-business command center for the current operator.
- `/workspace/my-queue`: personal assigned work and approvals.
- `/platform/ai/operations-map`: AI workforce topology and execution diagnostics.
- `/platform/ai/capability-needs`: coworker investment queue.
- `/platform/ai/authority` and `/platform/audit/authority`: authority and audit drill-down.
- Domain routes: portfolio, finance, compliance, customer, employee, build, and operations remain the places where work is performed.

This follows the portal navigation principle that global navigation answers "where am I?", section navigation answers "which area of this domain?", and local page controls answer "what can I do here right now?"

## TAK And GAID Integration

The Business OS command center is an operator-facing projection over TAK and GAID, not a replacement for them.

TAK provides:

- runtime authorization and approval posture
- memory freshness and revalidation rules
- containment gates for side-effect actions
- audit/evidence expectations
- refusal and escalation semantics

GAID provides:

- stable identity for AI coworkers and eventually service accounts/customers
- AIDoc projection for each coworker's operating state
- portable authorization classes for external surfaces
- receipt identity and traceability
- exposure-state boundaries

The command center should display TAK/GAID outcomes in plain operational language:

- "Fresh, evidence-backed, safe to propose"
- "Stale memory, needs revalidation"
- "No active provider for this coworker"
- "Approval required before execution"
- "Contained to read-only customer records"
- "External boundary crossed, receipt available"

## Data Projection Architecture

V1 should be projection-only and schema-light. The implementation should extract the current `/workspace` data assembly into a focused server helper before changing UI structure.

Recommended helper:

- `apps/web/lib/workspace/command-center.ts`

Responsibilities:

- fetch existing domain counts in parallel
- fetch active and blocked `TaskRun` rows
- fetch pending `AgentActionProposal` rows
- fetch scheduled coworker runs from `ScheduledAgentTask`
- fetch recent `ToolExecutionReceipt` and failed `ToolExecution` rows
- fetch coworker capability needs and self-assessment verdicts
- fetch provider and agent degradation signals
- fetch existing activity-feed items
- derive six-C readiness cells from existing records
- return a view DTO that is independent of React components

The first implementation should not add a new command-center table. If later projections become expensive or need historical snapshots, add a materialized projection after measuring the page.

## UI Design Principles

- No marketing hero. The workspace is a tool surface.
- No card-inside-card layouts. Use full-width bands, compact tables, strips, and individual repeated cards only where they represent items.
- Use DPF theme variables only.
- Use small, stable status indicators for confidence and containment. Avoid large decorative color blocks.
- Show provenance through links and evidence states rather than long explanatory copy.
- Keep domain rows comparable. Operators should be able to scan horizontally across the six Cs.
- Do not make the AI coworker the whole screen. The coworker is the command surface, not the source of truth.

## First Implementation Slice

**Goal:** Turn `/workspace` into a command-center first screen without schema changes.

Files likely touched:

- `apps/web/app/(shell)/workspace/page.tsx`
- `apps/web/lib/workspace/command-center.ts` (new)
- `apps/web/lib/workspace/command-center.test.ts` (new)
- `apps/web/components/workspace/BusinessCommandCenter.tsx` (new)
- `apps/web/components/workspace/BusinessCommandCenter.test.tsx` (new)
- `apps/web/components/workspace/ActivityFeed.tsx` only if needed to remove hardcoded status colors in this path

Refactoring budget:

- Extract current `/workspace` data gathering out of the page component before adding new layout.
- Keep derivation functions pure and tested.
- Preserve the existing `WorkspaceTiles`, calendar, and activity feed as lower sections until the command-center projection proves the replacement path.

Acceptance:

- `/workspace` first viewport renders Command Strip, Operating Snapshot, Six-C Readiness Matrix, and Human plus AI Work In Motion.
- No new Prisma models or migrations.
- Every displayed signal links to a source route or states "not wired" explicitly.
- Confidence and containment appear for AI-driven or automation-driven signals.
- AI Operations Map remains the drill-down for AI topology and receipts; it is linked, not duplicated.
- The page uses only `var(--dpf-*)` styling tokens, except allowed status semantics already present in the design system.
- Unit tests cover six-C derivation and empty-state behavior.
- UX verification exercises `/workspace` on the production-served portal after login.

## Follow-On Slices

1. **Business OS Readiness Audit.** Add a route or panel that scores each domain against the six Cs and creates governed capability needs or backlog items.
2. **Cadence Center.** Show scheduled coworker tasks, catch-up state, away/holiday/event operating tempo, and last-run evidence.
3. **Confidence Ledger.** Consolidate memory freshness, provider profile confidence, evidence confidence, and route classification confidence into one operator-facing language.
4. **Containment Inspector.** For any proposed action, show principal, GAID, tool grant, route, object scope, budget/sensitivity, approval tier, and receipt path.
5. **Domain Playbooks.** Convert high-repetition command-center actions into skills or deterministic workflows when usage evidence supports it.

## Out Of Scope

- Replacing domain routes.
- Adding new connectors.
- Adding a new workflow automation engine.
- Creating public/federated GAID issuance.
- Making personal or team wikis authoritative policy.
- Building live streaming command-center animation in V1.
- Writing to business records directly from the matrix without proposal or approval paths.

## Risks

| Risk | Mitigation |
|------|------------|
| Dashboard noise buries the actual next action | Limit first viewport to exceptions, active work, and six-C status; push raw counts below |
| False confidence in stale AI or memory signals | Depend on TAK/GAID memory freshness work; label unknowns as unknown |
| Weak containment hidden behind friendly UI | Show approval, scope, route, and receipt state inline for action-capable signals |
| Navigation duplication with AI Operations | Keep `/workspace` operator-facing and `/platform/ai/*` diagnostic/admin-facing |
| Page performance from too many queries | Extract projection helper, parallelize reads, cap result windows, measure before materializing |
| Humans feel replaced instead of amplified | Frame the surface around humans steering judgment, approvals, goals, and exceptions |

## Recommended Next Step

Write an implementation plan for the first slice: extract the current workspace data projection, add the six-C view DTO, and redesign `/workspace` as the command center while preserving existing route links and activity sections.

The implementation should land as a narrow UI/data-projection slice, not a platform-wide automation rewrite.
