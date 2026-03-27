# Trusted AI Kernel (TAK)

## What This Document Is

This document describes the architecture of the **Trusted AI Kernel** -- the governance and execution substrate that sits between human operators and AI agents in Open Digital Product Factory. TAK is not a separate product. It is the set of layered enforcement mechanisms, routing logic, audit infrastructure, and immutable directives that make it safe to let AI agents act on behalf of humans inside a business platform.

The purpose of documenting TAK explicitly is twofold:

1. **For this project:** To give operators, auditors, and developers a single place to understand how human authority flows through the system, how agent actions are constrained, and how every action is recorded.
2. **For anyone building agentic systems:** To provide a reference architecture that can be studied, forked, and adapted. Every component described here is implemented in this codebase and can be inspected directly.

---

## Core Principle

**Humans hold authority. Agents hold capability. The kernel mediates.**

An agent may have the technical capability to call any tool, but TAK ensures it can only exercise authority that has been explicitly granted by a human, scoped to a context, and recorded for audit. No agent in this system acts without a traceable chain of authority back to a human decision.

---

## 1. The Human-Agent Interaction Model

### 1.1 Platform Roles (Tier 1 -- Immutable)

Six governance roles map to IT4IT v3.0.1 value stream authority domains. These are hard-coded and cannot be created, renamed, or deleted at runtime:

| Role ID | Title | Authority Domain |
|---------|-------|------------------|
| HR-000 | CDIO / Executive Sponsor | Strategic direction, executive escalation, full platform access |
| HR-100 | Portfolio Manager | Portfolio governance, investment allocation (IT4IT Evaluate SS5.1) |
| HR-200 | Digital Product Manager | Product lifecycle, backlog, delivery (Explore SS5.2 through Release SS5.5) |
| HR-300 | Enterprise Architect | Architecture guardrails, technology standards |
| HR-400 | ITFM Director | Financial governance, cost allocation |
| HR-500 | Operations Manager | SLA, incident response, operational continuity (Operate SS5.7) |

Every user is assigned exactly one platform role. The role determines which **capabilities** the user can exercise (32 capabilities defined in `apps/web/lib/permissions.ts`).

### 1.2 Business Model Roles (Tier 2 -- Extensible, Product-Scoped)

When a digital product is created and a business model is attached (SaaS, Marketplace, E-commerce, etc.), a set of product-specific roles becomes available. Eight business model templates ship with the platform, each defining four specialized roles (32 total). These roles are:

- Scoped to a specific product, not platform-wide
- Assigned to users who already hold a platform role
- Governed by their own HITL tier (default: Tier 2)
- Escalation-linked to a platform governance role (usually HR-200, with financial matters escalating to HR-400)

This two-tier model means a user always has a platform-wide governance identity **and** may have additional product-scoped authority for specific digital products they manage.

### 1.3 The AI Coworker

Every page in the platform shell has a conversational AI coworker panel. The coworker is not a single agent -- it is a **contextual agent resolver** that selects the right agent identity, tool set, and system directives based on:

- The current route (which page the user is on)
- The user's platform role (what capabilities they have)
- The resolved agent for that route (what tools the agent is granted)

The coworker is the primary interface through which humans interact with the agent layer. It supports two modes:

- **Conversational:** The user asks questions, the agent reasons and responds
- **Action-oriented:** The agent proposes tool calls, which execute immediately or require approval

---

## 2. Layered Authority Resolution

TAK enforces authority through five layers. Each layer narrows what is possible. No layer can widen permissions granted by a layer above it.

```
+-----------------------------------------------------------+
|  Layer 1: Authentication                                  |
|  Who is this person? (Auth.js session, API token)         |
+-----------------------------------------------------------+
           |
+-----------------------------------------------------------+
|  Layer 2: Identity & Role                                 |
|  What platform role do they hold? (HR-000 through HR-500) |
|  What business model roles are assigned?                  |
+-----------------------------------------------------------+
           |
+-----------------------------------------------------------+
|  Layer 3: Capability Resolution                           |
|  Which of the 32 capabilities does their role grant?      |
|  can(user, capability) -> boolean                         |
+-----------------------------------------------------------+
           |
+-----------------------------------------------------------+
|  Layer 4: Agent Grant Intersection                        |
|  Which tools does the route's agent have grants for?      |
|  isToolAllowedByGrants(toolName, agentGrants) -> boolean  |
|                                                           |
|  Effective tools = user capabilities ∩ agent grants       |
+-----------------------------------------------------------+
           |
+-----------------------------------------------------------+
|  Layer 5: Execution Mode Enforcement                      |
|  Is this tool immediate (execute now) or proposal         |
|  (return for human approval before execution)?            |
+-----------------------------------------------------------+
```

### How Effective Permissions Are Computed

For any given (user, agent, tool) triple:

```
userAllowed  = tool.requiredCapability is null
               OR user.platformRole ∈ PERMISSIONS[capability].roles

agentAllowed = tool.name ∉ TOOL_TO_GRANTS
               OR agent.grants includes at least one required grant

effective    = userAllowed AND agentAllowed
```

A tool is only available if **both** the human and the agent are authorized. This is the fundamental invariant of TAK: the agent cannot exceed the human's authority, and the human cannot force the agent to act outside its granted scope.

The Effective Permissions Inspector at `/platform/ai/authority` allows any authorized user to select a role, agent, and product, and see the complete intersection computed in real time.

---

## 3. Request Routing -- From User to Agent to Tool to Provider

### 3.1 Route Context Resolution

When a user navigates to a page (e.g., `/build`, `/employee`, `/ops`), the route context map (`apps/web/lib/route-context-map.ts`) resolves:

| Property | Purpose |
|----------|---------|
| `domain` | Human-readable domain name (e.g., "Employee Management") |
| `sensitivity` | Data classification: `public`, `internal`, `confidential`, `restricted` |
| `domainContext` | Multi-sentence guidance injected into the agent's system prompt |
| `domainTools` | Array of tool names available on this route |
| `skills` | Quick-action buttons (label + pre-built prompt) shown in the UI |

Resolution uses **longest prefix match**: `/build/feature/123` resolves to the `/build` context, inheriting its 30+ build tools and five-phase workflow guidance.

Four **universal skills** are added to every route:
- "Analyze this page" -- read-and-reason on the current page data
- "Do this for me" -- execute the primary action for the current context
- "Add a skill" -- extend the route with a new skill via code change
- "Evaluate this page" -- accessibility and UX audit

### 3.2 Agent Resolution

The platform maintains an agent registry (`packages/db/data/agent_registry.json`) with 43 agents organized across seven IT4IT value streams. Each agent has:

- **Identity:** Unique ID (e.g., `AGT-ORCH-300`), name, type (orchestrator/specialist)
- **Tier:** Hierarchy level (1 = top orchestrator, 3+ = specialist)
- **Tool Grants:** Array of grant categories (e.g., `["backlog_read", "backlog_write", "sandbox_execute"]`)
- **HITL Tier Default:** How much human oversight this agent requires (0-3)
- **Delegation Chain:** Which agents it delegates to and which human role it escalates to
- **Autonomy Level:** `advisory`, `constrained_execute`, `supervised_execute`, `elevated_execute`

When the coworker activates on a route, the system resolves the appropriate agent and filters the available tools to the intersection of:
1. Tools listed in the route's `domainTools`
2. Tools the user's role grants capability for
3. Tools the agent's `tool_grants` permit

### 3.3 The Agentic Loop

Once tools are resolved, the agentic loop (`apps/web/lib/agentic-loop.ts`) drives the conversation:

```
User sends message
       |
       v
  +--------------------------+
  | Build system prompt:     |
  | - Route domain context   |
  | - Immutable directives   |
  | - Available tools        |
  | - Sensitivity level      |
  +--------------------------+
       |
       v
  +--------------------------+
  | Call inference provider   |<--------+
  | (see Section 5)          |         |
  +--------------------------+         |
       |                               |
       v                               |
  +--- Model responds ---+             |
  |                       |             |
  | Text only?            |             |
  | +-- Yes: return to    |             |
  | |   user              |             |
  | |                     |             |
  | +-- No: tool calls    |             |
  |     detected          |             |
  |     |                 |             |
  |     v                 |             |
  | For each tool call:   |             |
  | +-- Proposal mode?    |             |
  | |   Return approval   |             |
  | |   card to user      |             |
  | |                     |             |
  | +-- Immediate mode?   |             |
  |     Execute tool      |             |
  |     Record audit log  |             |
  |     Append result     |             |
  |     to conversation   |             |
  |     |                 |             |
  |     +--- Continue --->+-------------+
  +--- Loop guards -------+
       |
       v
  Safety checks per iteration:
  - Iteration limit (100 max)
  - Time limit (120s standard, 600s for builds)
  - Repetition detector (same tool+args 3x = stall)
  - Fabrication detector (claims completion without tool use)
  - Narration detector (describes code instead of calling tools)
```

### 3.4 Tool Execution Modes

Every tool in the registry has an execution mode:

| Mode | Behavior | Use Case |
|------|----------|----------|
| `immediate` | Execute synchronously during the loop; result appended to conversation | Read operations, queries, analysis |
| `proposal` | Break the loop; return an approval card to the user | Side-effect operations: creating records, modifying data, deploying |

Proposal mode is TAK's primary human-in-the-loop gate for consequential actions. The user sees exactly what the agent wants to do (tool name, parameters, rationale) and can approve or reject. Rejection is recorded with a reason in the `AuthorizationDecisionLog`.

---

## 4. Agent Delegation and Escalation

### 4.1 Delegation Chain

Agents form a hierarchy. Orchestrator agents (Tier 1-2) can delegate work to specialist agents (Tier 3+). The delegation chain is defined per-agent in the registry:

```
HR-000 (CDIO -- human)
 +-- AGT-ORCH-000 (COO Orchestrator, Tier 1)
      +-- AGT-ORCH-200 (Evaluate/Explore Orchestrator, Tier 2)
      |    +-- AGT-110 (Capability Mapper, Tier 3)
      |    +-- AGT-120 (Service Designer, Tier 3)
      +-- AGT-ORCH-300 (Integrate Orchestrator, Tier 2)
      |    +-- AGT-130 (Build Coordinator, Tier 3)
      |    +-- AGT-131 (Test Orchestrator, Tier 3)
      +-- AGT-ORCH-400 (Deploy Orchestrator, Tier 2)
           +-- AGT-140 (IaC Executor, Tier 3)
           +-- AGT-141 (Rollback Planner, Tier 3)
```

Key constraint: **a delegated agent cannot exceed the grants of its delegator.** If the Integrate Orchestrator has `["backlog_read", "backlog_write", "sandbox_execute"]`, a specialist it delegates to can use at most those same grants.

### 4.2 HITL Tiers

Every agent and business model role carries a Human-In-The-Loop tier that governs oversight requirements:

| Tier | Label | Behavior |
|------|-------|----------|
| 0 | Blocked | Agent cannot act. Human must decide directly. |
| 1 | Approve Before | Agent proposes; human must approve before execution. |
| 2 | Review After | Agent acts immediately; human reviews asynchronously. |
| 3 | Autonomous | Agent acts and logs; no mandatory human review. |

HITL tiers are enforced through the execution mode system: Tier 0-1 agents have their side-effect tools forced into `proposal` mode regardless of the tool's default mode. Tier 2-3 agents may execute immediately, but all actions are still recorded in the audit trail.

### 4.3 Escalation

When an agent encounters a situation outside its authority or risk band, it escalates to the designated human role:

- Specialist agents escalate to their orchestrator's human supervisor
- Orchestrators escalate to the platform governance role they report to
- Business model roles escalate to HR-200 (product authority), HR-400 (financial authority), or HR-500 (operational authority)

Escalation is not optional -- it is a structural property of the delegation chain, not a runtime decision by the agent.

---

## 5. Inference Provider Routing

### 5.1 Provider-Agnostic Abstraction

The AI inference layer (`apps/web/lib/ai-inference.ts`) abstracts over multiple providers through a unified interface:

```
callProvider(providerId, modelId, messages, systemPrompt, tools, executionPlan)
       |
       v
  Lookup provider config (DB: baseUrl, auth method, headers)
       |
       v
  Resolve execution adapter (chat, image_gen, embedding, transcription)
       |
       v
  Format messages for provider (Anthropic format vs OpenAI format)
       |
       v
  POST to provider endpoint with authentication
       |
       v
  Parse response: extract text content + tool calls
       |
       v
  Return: InferenceResult { content, inputTokens, outputTokens, toolCalls }
```

### 5.2 Authentication Methods

| Method | Use Case |
|--------|----------|
| `api_key` | Header-based authentication (e.g., Anthropic, OpenAI) |
| `oauth2_client_credentials` | Bearer token from credential service |
| `oauth2_authorization_code` | Same, for authorization code flows |
| `none` | Local/self-hosted providers (Ollama, Docker Model Runner) |

### 5.3 Provider Selection

The platform supports multiple concurrent providers. Each agent or route can specify a preferred provider, with fallback to the platform default. The provider registry at `/platform/ai` allows operators to:

- Add and configure providers (local and remote)
- Assign providers to capability categories (chat, image generation, embedding)
- Run endpoint capability probes to verify provider health
- Track token usage and cost per provider, agent, and route

### 5.4 Token Usage and Cost Tracking

Every inference call logs:

```
TokenUsage {
  agentId       -- which agent made the call
  providerId    -- which provider served it
  contextKey    -- route context (e.g., "/build", "/employee")
  inputTokens   -- tokens consumed in the prompt
  outputTokens  -- tokens generated in the response
  costUsd       -- computed cost (token-based or compute-time-based)
}
```

This feeds the cost analytics visible on the platform AI dashboard, enabling operators to understand spend by agent, route, and provider.

---

## 6. MCP, Skills, and External Tool Integration

### 6.1 Platform Tools as MCP Surface

The platform's 100+ tools are defined in `apps/web/lib/mcp-tools.ts` using a schema compatible with the Model Context Protocol (MCP). Each tool definition includes:

```typescript
{
  name: "create_backlog_item",
  description: "Create a new backlog item in an epic",
  inputSchema: { /* JSON Schema */ },
  executionMode: "proposal",
  requiredCapability: "manage_backlog"
}
```

Tools are organized into functional categories:

| Category | Examples | Typical Mode |
|----------|----------|--------------|
| Backlog | create_backlog_item, update_backlog_item, query_backlog | proposal |
| Portfolio | create_digital_product, update_lifecycle, search_portfolio_context | proposal / immediate |
| Build/Sandbox | launch_sandbox, generate_code, run_sandbox_tests | immediate |
| Deploy | deploy_feature, schedule_promotion, create_release_bundle | proposal |
| Employee/HR | create_employee, query_employees, transition_employee_status | proposal / immediate |
| Compliance | prefill_onboarding_wizard, search_knowledge | immediate |
| Web/External | search_public_web, fetch_public_website | immediate |
| Codebase | read_project_file, search_project_files, propose_file_change | immediate / proposal |
| Evaluation | evaluate_tool, evaluate_page, generate_ux_test | immediate |

### 6.2 MCP Client-Server Model

The platform acts as both MCP **server** (exposing tools to external clients) and MCP **client** (consuming tools from external MCP servers):

**As MCP Server:**
- `POST /api/mcp/tools` -- list available tools, filtered by the caller's session and agent context
- `POST /api/mcp/call` -- execute a tool, subject to all TAK authority checks
- Authentication: Auth.js session (browser) or hashed `ApiToken` (external clients)

**As MCP Client:**
- Tools with namespaced names (e.g., `slack:send_message`) are routed to external MCP servers
- The namespace is parsed, the server is looked up, and `executeMcpServerTool()` handles the call
- External MCP servers must pass the Tool Evaluation Pipeline (EP-GOVERN-002) before they can be connected

### 6.3 Skills

Skills are pre-built prompt templates attached to routes. They appear as quick-action buttons in the coworker panel. When a user clicks a skill:

1. The skill's prompt text is injected as a user message
2. The agentic loop processes it with the route's full tool set
3. The agent responds conversationally or proposes actions

Skills serve as guided workflows -- they lower the barrier to complex actions without reducing the governance applied to them. Every skill invocation passes through the same authority layers as a free-form message.

### 6.4 Tool Evaluation Pipeline

Before any external tool (MCP server, npm package, API) is adopted, it must pass the Tool Evaluation Pipeline:

1. **Security Auditor** (AGT-190) -- vulnerability and supply chain analysis
2. **Architecture Reviewer** -- fit with platform patterns and data model
3. **Compliance Checker** -- regulatory and data governance implications
4. **Integration Analyst** -- API compatibility and failure mode analysis
5. **Risk Scorer** -- aggregate risk band assignment
6. **Verdict Synthesizer** -- approve, conditionally approve, or reject

Approved tools are version-pinned with conditions and scheduled for periodic re-evaluation. The approved tool registry lives at `packages/db/data/approved_tools_registry.json`.

---

## 7. Audit Trail and Continuous Improvement

### 7.1 What Gets Recorded

TAK records every significant action across three audit surfaces:

**Tool Execution Log** (`ToolExecution` table):
Every tool call -- immediate or proposal -- is recorded with:
- `agentId` -- which agent called the tool
- `userId` -- which human's session the agent is operating under
- `toolName` -- the tool that was called
- `parameters` -- full input parameters (JSON)
- `result` -- full output (JSON)
- `success` -- whether the call succeeded
- `executionMode` -- `"immediate"` or `"proposal"`
- `routeContext` -- which page/route triggered the call
- `durationMs` -- execution time
- `createdAt` -- timestamp

Recording is fire-and-forget (async insert after `executeTool()` returns) so it never blocks the response path.

**Agent Action Proposals** (`AgentActionProposal` table):
Side-effect actions that require human approval are recorded with full lifecycle tracking:
- `proposalId` -- human-readable ID (AP-XXXXX)
- `status` -- `proposed` -> `approved`/`rejected` -> `executed`/`failed`
- `decidedById` -- which human approved or rejected
- `decidedAt` -- when the decision was made
- `resultEntityId` -- the entity created by execution (e.g., a backlog item ID)
- `gitCommitHash` -- for code changes, the resulting commit

**Authorization Decision Log** (`AuthorizationDecisionLog` table):
Every authorization decision (allow or deny) is recorded with:
- `actorType` / `actorRef` -- who made the decision (user or agent)
- `delegationGrantId` -- if authority was delegated, which grant was used
- `actionKey` -- the tool or action being authorized
- `decision` -- `"allow"` or `"deny"`
- `rationale` -- structured JSON explaining why
- `sensitivityLevel` -- the data classification of the context
- `routeContext` -- where the decision was made

### 7.2 Token Usage and Cost

Every inference call records token consumption and computed cost in the `TokenUsage` table, attributed to the specific agent, provider, and route context. This enables:

- Cost-per-agent analytics (which agents are expensive?)
- Cost-per-route analytics (which workflows consume the most?)
- Provider comparison (which provider gives better results per dollar?)
- Budget alerting and allocation

### 7.3 Conversation History

All agent messages are stored in the `AgentMessage` table with:
- `role` -- user, assistant, system, tool
- `agentId` -- which agent generated the response
- `routeContext` -- which page the conversation happened on
- `providerId` -- which inference provider was used
- `tone` -- detected tone classification
- Thread-level grouping via `AgentThread`

### 7.4 Endpoint Capability Probes

The platform includes a test registry (`apps/web/lib/endpoint-test-registry.ts`) that defines behavioral probes to verify agent quality:

| Probe | What It Tests |
|-------|---------------|
| Instruction compliance | Agent advises instead of acting when tools are removed |
| Tool calling | Agent calls the right tool with correct parameters |
| Brevity | Agent keeps responses concise |
| No narration | Agent acts instead of describing what it would do |
| Hallucination resistance | Agent admits limitations instead of fabricating |
| Role boundary | Agent respects permission boundaries |
| Partial information | Agent asks for missing required fields instead of guessing |

These probes can be run against any provider/model combination to evaluate fitness for production use.

### 7.5 Continuous Improvement Loop

The audit data feeds back into platform improvement:

```
Tool executions + proposals + decisions
       |
       v
  Analytics dashboards (/platform/ai/authority)
       |
       v
  Identify patterns:
  - Which tools fail most often?
  - Which agents are over-provisioned (have grants they never use)?
  - Which proposals get rejected most (agent misalignment)?
  - Which routes consume the most tokens (optimization targets)?
       |
       v
  Adjust:
  - Tune agent tool grants (narrow or widen)
  - Update system prompts (improve instruction compliance)
  - Switch providers for specific routes (cost/quality tradeoff)
  - Add/remove skills (workflow optimization)
  - Adjust HITL tiers (increase autonomy for proven agents)
```

---

## 8. Immutable Directives

### 8.1 What Are Directives?

Directives are instructions that are **injected into the agent's system prompt and cannot be overridden by the user, the conversation, or the agent itself.** They are the TAK equivalent of kernel-mode restrictions -- the agent cannot jailbreak past them because they are not part of the conversational context the agent controls.

### 8.2 Directive Sources

Directives are assembled from multiple sources and injected as the system prompt before the agentic loop begins:

| Source | Content | Mutability |
|--------|---------|------------|
| **Platform directives** | Core behavioral rules: never fabricate, never exceed granted tools, always propose side-effects | Immutable at runtime. Changed only by code deployment. |
| **Route domain context** | Domain-specific guidance injected per route (e.g., "You are assisting with employee management. firstName and lastName are required for employee creation.") | Immutable at runtime per route definition. |
| **Sensitivity constraints** | Data handling rules based on route sensitivity level (public/internal/confidential/restricted) | Immutable. Derived from route context map. |
| **Agent identity** | The agent's name, role description, value stream, and behavioral boundaries | Immutable. Defined in agent registry. |
| **Directive Policy Class** | Governance profile that sets the agent's approval mode, allowed risk band, and configuration constraints | Mutable only by platform administrators via governance controls. |

### 8.3 What Directives Enforce

The immutable directive layer enforces:

1. **Tool boundary:** The agent can only call tools that appear in its filtered tool set. It cannot reference, describe, or claim to use tools it doesn't have.

2. **Execution mode:** The agent cannot convert a `proposal` tool into an `immediate` execution. If a tool requires approval, the loop breaks and returns the proposal to the human.

3. **Fabrication prohibition:** The agent must call tools to take action. If it claims to have completed work (built, deployed, created) without having called the corresponding tools, the fabrication detector catches it and forces a retry.

4. **Narration prohibition:** The agent must not describe code or output instead of calling the appropriate tool. Pattern detection in the loop identifies when an agent is narrating rather than acting.

5. **Sensitivity compliance:** On confidential/restricted routes, the agent's system prompt includes explicit handling rules for the data classification level.

6. **Identity consistency:** The agent introduces itself with a canonical greeting (identity, capabilities, skills hint) and does not adopt other personas or claim capabilities it doesn't have.

7. **Incomplete information handling:** When required fields are missing, the agent must ask the user rather than guessing or fabricating values. This is tested by the endpoint capability probes.

### 8.4 How Directives Survive the Call Chain

When the coworker on Route A invokes a tool that delegates to Agent B, the directives are recomputed for Agent B's context:

```
User on /build (HR-200) -> Build Coworker (AGT-ORCH-300)
  |
  | calls launch_sandbox
  |
  v
Sandbox Agent (AGT-130) receives:
  - Its own agent identity directives
  - Its own tool grants (subset of AGT-ORCH-300's grants)
  - The route's sensitivity level (inherited)
  - Fresh system prompt assembled for AGT-130's context
```

The delegated agent **never sees the delegator's full system prompt.** It gets its own directives, computed from its own grants and the inherited context. This prevents directive leakage across the delegation chain.

---

## 9. The Authority Dashboard

The `/platform/ai/authority` page provides four views into the TAK state:

### 9.1 Authority Matrix (Heatmap)

A grid with agents as rows and grant categories as columns. Cell color indicates whether the agent has grants in that category. Expandable rows show the specific grants.

Grant categories: Backlog, Registry, Architecture, Finance, Compliance, Security, Deploy, Governance, Sandbox, Tools.

### 9.2 Delegation Chain (Tree)

A hierarchical tree showing human supervisors at the top, orchestrator agents below them, and specialist agents as leaves. Each node shows:
- Agent name and ID
- HITL tier (color-coded: 0=red, 1=orange, 2=blue, 3=green)
- Value stream assignment
- Escalation path
- Business model roles (shown with dashed separators under their escalation target)

### 9.3 Effective Permissions Inspector

Three dropdowns (user role, agent, product) and a table showing every tool with:
- User allowed (green/red/gray)
- Agent allowed (green/red/gray)
- Effective (green/red -- the intersection)
- Execution mode (proposal/immediate)

Footer stats show total tools available, blocked by role, blocked by grants.

### 9.4 Tool Execution Log

Stat cards (total executions, success rate, unique agents, unique tools) and a filterable table of all tool executions with timestamps, parameters, results, and duration.

---

## 10. End-to-End Request Flow

Here is the complete path of a user request through TAK, using a concrete example: an HR-200 user on the `/ops` page asks the coworker to "Create a backlog item for fixing the login bug, high priority."

```
1. USER SENDS MESSAGE
   "Create a backlog item for fixing the login bug, high priority"
   Route: /ops
   User: HR-200 (Digital Product Manager)

2. ROUTE CONTEXT RESOLUTION
   resolveRouteContext("/ops") returns:
     domain: "Operations / Backlog"
     sensitivity: internal
     domainTools: [query_backlog, create_backlog_item, update_backlog_item]
     domainContext: "You help manage the operational backlog..."

3. AGENT RESOLUTION
   Agent for /ops route: AGT-OPS (Operations Agent)
   Agent grants: [backlog_read, backlog_write]

4. TOOL FILTERING
   For each tool in domainTools:
     query_backlog:
       userAllowed: can(HR-200, manage_backlog) = true
       agentAllowed: isToolAllowedByGrants("query_backlog", [backlog_read]) = true
       -> AVAILABLE (immediate)

     create_backlog_item:
       userAllowed: can(HR-200, manage_backlog) = true
       agentAllowed: isToolAllowedByGrants("create_backlog_item", [backlog_write]) = true
       -> AVAILABLE (proposal)

     update_backlog_item:
       userAllowed: can(HR-200, manage_backlog) = true
       agentAllowed: isToolAllowedByGrants("update_backlog_item", [backlog_write]) = true
       -> AVAILABLE (proposal)

5. SYSTEM PROMPT ASSEMBLY
   [Platform directives: never fabricate, use tools, propose side-effects]
   [Route context: "You help manage the operational backlog..."]
   [Agent identity: "You are the Operations Agent..."]
   [Sensitivity: internal]
   [Available tools: query_backlog, create_backlog_item, update_backlog_item]

6. AGENTIC LOOP - ITERATION 1
   -> Call inference provider (Anthropic/OpenAI/local)
   <- Model responds with tool call:
      create_backlog_item({
        title: "Fix login bug",
        priority: "high",
        type: "product",
        status: "open"
      })

7. EXECUTION MODE CHECK
   create_backlog_item.executionMode = "proposal"
   -> Loop breaks. Return approval card to user.

8. PROPOSAL RECORDED
   AgentActionProposal created:
     proposalId: AP-00042
     actionType: create_backlog_item
     parameters: { title: "Fix login bug", priority: "high", ... }
     status: "proposed"

9. USER APPROVES
   User clicks "Approve" on the proposal card.

10. TOOL EXECUTION
    create_backlog_item executes:
      -> Prisma transaction creates BacklogItem
      -> Returns: { id: "BLI-00123", title: "Fix login bug" }

11. AUDIT TRAIL RECORDED (parallel, non-blocking)
    ToolExecution created:
      agentId: AGT-OPS
      userId: HR-200
      toolName: create_backlog_item
      parameters: { title: "Fix login bug", ... }
      result: { id: "BLI-00123" }
      success: true
      executionMode: proposal
      routeContext: /ops

    AgentActionProposal updated:
      status: "executed"
      decidedById: HR-200
      executedAt: 2026-03-27T...
      resultEntityId: BLI-00123

    AuthorizationDecisionLog created:
      actorType: user
      actorRef: HR-200
      actionKey: create_backlog_item
      decision: allow
      rationale: { approved_proposal: "AP-00042" }

12. RESPONSE TO USER
    "I've created backlog item BLI-00123: 'Fix login bug' with high priority."

13. TOKEN USAGE LOGGED
    TokenUsage created:
      agentId: AGT-OPS
      providerId: (whichever served the inference)
      inputTokens: 1,247
      outputTokens: 89
      costUsd: 0.0043
```

---

## 11. Security Properties of the Kernel

### 11.1 Defense in Depth

| Layer | Protection |
|-------|-----------|
| Route context | Only domain-relevant tools are presented to the agent |
| User capabilities | Role-based access prevents users from accessing tools outside their authority |
| Agent grants | Tool-to-grant mapping prevents agents from calling tools outside their scope |
| Execution mode | Side-effect tools require explicit human approval |
| Fabrication detection | Agent cannot claim completion without tool evidence |
| Audit trail | Every action is recorded with full context for forensic review |
| Delegation constraints | Delegated agents cannot exceed delegator's authority |
| Sensitivity classification | Data handling rules are injected based on route sensitivity |

### 11.2 What TAK Prevents

| Threat | Mitigation |
|--------|-----------|
| Agent acts beyond its authority | Grant intersection: effective = user ∩ agent |
| Agent fabricates results | Fabrication detector + forced retry with tool-call nudge |
| Agent gets stuck in a loop | Repetition detector (3+ identical calls) + time/iteration limits |
| User accesses data above their clearance | Role-based capability check + sensitivity-level tool filtering |
| Agent deploys without approval | Proposal mode forces human gate for all deployment tools |
| No accountability for agent actions | Full audit trail: ToolExecution + AgentActionProposal + AuthorizationDecisionLog |
| External tool introduces vulnerability | Tool Evaluation Pipeline (6-agent review) before adoption |
| Agent leaks system prompt to user | Directive injection is server-side; agent cannot access or relay raw system prompt |
| Delegation chain circumvents authority | Delegated agents recompute authority from their own grants, not the delegator's prompt |

### 11.3 What TAK Does Not Yet Prevent

The following are known gaps being addressed in the roadmap:

- **Cross-agent prompt injection:** If Agent A's output is fed as context to Agent B, a crafted response could influence Agent B's behavior. Mitigation: output sanitization at delegation boundaries (planned).
- **Token-based cost attacks:** A user could craft prompts that maximize token consumption. Mitigation: per-user and per-route token budgets (planned).
- **Stale delegation grants:** Grants have expiry dates but there is no automatic revocation when a user's role changes. Mitigation: event-driven grant invalidation (planned).

---

## 12. Mapping to IT4IT v3.0.1

The TAK architecture maps directly to IT4IT value streams:

| IT4IT Value Stream | TAK Component |
|--------------------|---------------|
| **Evaluate (SS5.1)** | Portfolio route context, investment capability gates, HR-100 authority domain |
| **Explore (SS5.2)** | EA route context, architecture tools, HR-300 authority domain |
| **Integrate (SS5.3)** | Build Studio route, sandbox tools, AGT-ORCH-300 delegation chain |
| **Deploy (SS5.4)** | Deploy tools (proposal mode), AGT-ORCH-400, release gates |
| **Release (SS5.5)** | Service catalog tools, release bundling, promotion scheduling |
| **Consume (SS5.6)** | Customer route context, AGT-ORCH-600, usage analytics |
| **Operate (SS5.7)** | Ops route context, SLA tools, HR-500 authority domain, AGT-ORCH-700 |

Each value stream has a designated orchestrator agent, a set of specialist agents, and a human governance role. The authority matrix at `/platform/ai/authority` shows this mapping visually.

---

## 13. Using TAK as a Reference Architecture

### 13.1 What You Can Take From This

If you are building an agentic system and want to adopt TAK patterns:

1. **Role-capability-grant triple:** Define human roles with capabilities, agent identities with grants, and compute effective permissions as the intersection. This is the most portable pattern in TAK.

2. **Execution mode separation:** Distinguish immediate (safe, read-only) tools from proposal (side-effect, needs approval) tools. Never let the model decide which mode to use -- declare it in the tool definition.

3. **Fire-and-forget audit:** Record every tool call asynchronously after execution. Never block the response path for logging. The audit table schema (`ToolExecution`) is simple and can be adopted directly.

4. **Route-based context injection:** Instead of giving every agent every tool, scope tools to the domain the user is working in. This reduces prompt size, improves model accuracy, and limits blast radius.

5. **Fabrication detection:** Check whether the model claims completion without having called the appropriate tools. This is a simple pattern match on the response text that catches a surprisingly common failure mode.

6. **Delegation with authority narrowing:** When one agent delegates to another, recompute authority from scratch for the delegated agent. Never pass the delegator's full context or permissions.

### 13.2 Key Files to Study

| File | What It Demonstrates |
|------|---------------------|
| `apps/web/lib/agentic-loop.ts` | The complete agentic loop with all safety guards |
| `apps/web/lib/permissions.ts` | Role-capability mapping and the `can()` function |
| `apps/web/lib/agent-grants.ts` | Tool-to-grant mapping and the intersection check |
| `apps/web/lib/mcp-tools.ts` | Tool registry with 100+ tools, schemas, and execution modes |
| `apps/web/lib/route-context-map.ts` | Route-to-agent-context resolution |
| `apps/web/lib/ai-inference.ts` | Provider-agnostic inference with token tracking |
| `apps/web/lib/endpoint-test-registry.ts` | Behavioral probes for agent quality verification |
| `packages/db/prisma/schema.prisma` | Data model for agents, governance, delegation, audit |
| `packages/db/data/agent_registry.json` | 43 agents with grants, tiers, delegation chains |
| `apps/web/components/platform/AuthorityMatrixPanel.tsx` | Authority heatmap visualization |
| `apps/web/components/platform/DelegationChainPanel.tsx` | Delegation tree visualization |
| `apps/web/components/platform/EffectivePermissionsPanel.tsx` | Permission intersection inspector |

---

## Summary

The Trusted AI Kernel is not a product -- it is an architecture pattern implemented in production code. It solves the fundamental problem of agentic systems: **how do you let AI agents act on behalf of humans without losing control, accountability, or auditability?**

TAK's answer is five interlocking mechanisms:

1. **Layered authority resolution** -- human roles, agent grants, and execution modes compose to determine what any (human, agent, tool) triple can do
2. **Immutable directives** -- behavioral constraints injected server-side that the agent cannot override or circumvent
3. **Proposal gates** -- consequential actions require explicit human approval before execution
4. **Complete audit trail** -- every tool call, proposal, decision, and token expenditure is recorded with full context
5. **Delegation with narrowing** -- agents can delegate to other agents, but authority only narrows, never widens

These mechanisms are general-purpose. They do not depend on a specific LLM provider, tool set, or business domain. They can be adopted individually or as a complete system by anyone building agentic applications where trust, accountability, and human oversight matter.
