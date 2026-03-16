# Unified MCP Coworker Architecture

**Date:** 2026-03-16
**Status:** Draft
**Author:** Mark Bodman (CEO) + Claude (design partner)

## Problem Statement

The current agent architecture assigns named personas (COO, Portfolio Analyst, Scrum Master, etc.) to each route, each with bespoke system prompts, personality heuristics, and static tool lists. This creates several problems:

1. **Persona fragmentation** — 11 distinct agents with overlapping capabilities and inconsistent behavior. Employees interact with different "characters" on different pages.
2. **Authority confusion** — agent-level capability checks mix with user-level HR role checks, making it unclear whose authority governs an action.
3. **Rigid tool awareness** — agents have hardcoded tool lists in their system prompts, causing them to refuse tools they actually have access to (e.g., COO refusing web search after external access was enabled).
4. **No cost optimization** — every inference uses the same provider tier regardless of task complexity. Simple summarization tasks consume the same expensive model as deep reasoning.
5. **Separate integration paths** — internal LLM providers and external services (web search, URL fetch) are registered and routed through completely different systems.

## Design Summary

Replace the multi-persona agent system with a **single AI coworker identity** that adapts to context, governed by the employee's HR role, with a **unified MCP routing layer** that treats all AI resources — local models, cloud models, and external services — as MCP endpoints in one registry.

### Key Principles

- **One coworker, many contexts** — same AI identity everywhere, domain knowledge injected per route
- **HR role is the sole authority gate** — what the coworker can do is always bounded by what the employee is authorized to do
- **Advise / Act toggle** — binary autonomy dial controlled by the employee
- **Sensitivity follows the data** — each page has a classification that determines which endpoints can serve it
- **Cost-optimal routing** — primary inference gets the best model, sub-tasks get the cheapest eligible model
- **Workforce = MCP Registry** — one admin control plane for all AI capabilities

---

## Section 1: Core Identity Model

### What Changes

- Strip agent personas from route definitions — no more named agents with personalities
- Remove the COO agent entirely
- Replace the "External Access" toggle with "Advise / Act"
- One system prompt template assembled from composable blocks

### Three Inputs Shape Behavior

1. **Route context** — what page the employee is on, what domain tools are relevant, what data is visible. Injected as factual context, not personality.
2. **HR role** — the employee's designation (HR-000 through HR-500) determines what the coworker is allowed to do. The existing `can()` capability system is the sole authority gate.
3. **Advise / Act toggle** — binary, per-session, controlled by the employee.

### What Stays

- Route → context mapping (reframed as domain context injection, not agent assignment)
- HR role → capability matrix (unchanged)
- Audit trail and proposal system
- Route-based domain tags in the database for tracking (e.g., `domain:portfolio`, `domain:ops`)

### What Is Removed

- All 11 named agent personas and their system prompts
- Agent-specific model requirements
- The COO agent and its cross-cutting authority concept
- The "External Access" toggle concept (absorbed into MCP routing + Advise/Act)

---

## Section 2: MCP Endpoint Manifest & Routing Layer

### Endpoint Manifest

Every AI resource — LLM provider or external service — is registered as an MCP endpoint with a capability manifest:

```
EndpointManifest {
  endpointId: string           // "mantis", "ollama-llama3", "brave-search"
  endpointType: "llm" | "service"
  displayName: string

  // Clearance
  sensitivityClearance: ("public" | "internal" | "confidential" | "restricted")[]

  // Capability
  capabilityTier: "basic" | "routine" | "analytical" | "deep-thinker"
  taskTags: string[]           // ["summarization", "reasoning", "code-gen", "web-search", "data-extraction"]

  // Cost
  costBand: "free" | "low" | "medium" | "high"

  // MCP connection
  mcpTransport: "stdio" | "sse" | "http"
  mcpEndpoint: string          // URL or command
  authMethod: "none" | "api_key" | "oauth2"

  // Operational
  status: "active" | "inactive" | "unconfigured"
  maxConcurrency?: number
}
```

### Routing Algorithm

The `AgentRouter` receives a task request and selects the best endpoint:

1. **Filter** — exclude endpoints whose `sensitivityClearance` doesn't cover the page's sensitivity level
2. **Filter** — exclude endpoints that lack required task tags
3. **Rank** — among eligible endpoints, prefer lowest `costBand` that meets the `capabilityTier` requirement
4. **Failover** — if primary fails, try next-best match

### Primary vs Sub-Task Routing

- Page primary inference → highest-tier eligible endpoint (the "senior employee")
- Sub-task delegation → cheapest eligible endpoint that meets the sub-task's capability requirement (the "junior employee")
- Delegation is transparent to the user — they see one coworker

### Tool Migration

| Today | New Model |
|-------|-----------|
| `search_public_web` (hardcoded in mcp-tools.ts) | MCP endpoint: `brave-search` (task tag: "web-search") |
| `fetch_public_website` (hardcoded in mcp-tools.ts) | MCP endpoint: `public-fetch` (task tag: "web-fetch") |
| `analyze_public_website_branding` (hardcoded) | MCP endpoint: `branding-analyzer` (task tag: "branding-analysis") |
| `read_project_file`, `search_project_files` | Stay as local tools (no provider routing needed) |
| Domain tools (backlog, lifecycle, etc.) | Stay as local tools, gated by HR capability |

---

## Section 3: Advise / Act Mechanics

### Toggle

Located in the agent panel header (same position as today's External Access button). Restyled with clear labels.

- **Advise** (default) — coworker reads, analyzes, recommends. Cannot create, update, or delete.
- **Act** — coworker executes any tool the employee's HR role authorizes. All actions logged.

### Tool Classification

Each tool in the registry gains a `sideEffect: boolean` flag:

- `sideEffect: false` — allowed in both Advise and Act modes. Examples: `read_project_file`, `search_project_files`, `search_portfolio_context`, `search_public_web`, `fetch_public_website`.
- `sideEffect: true` — blocked in Advise mode, allowed in Act mode (subject to HR authority). Examples: `create_backlog_item`, `update_backlog_item`, `propose_file_change`, `update_lifecycle`, `add_provider`.

### Elevation Request

When the coworker needs to act but is in Advise mode, it surfaces this once per conversation turn:

> "I can see what needs to happen here but I'm in Advise mode. Switch to Act if you'd like me to execute this."

It does not repeat or nag. One mention, then moves on.

### Authority Enforcement in Act Mode

Switching to Act does not grant new capabilities. If the employee's role lacks `manage_backlog`, the coworker cannot create backlog items even in Act mode:

> "This action requires backlog management authority which your role doesn't include."

### Audit Trail

Every tool execution in Act mode logs to `authorizationDecisionLog`:

| Field | Value |
|-------|-------|
| `actorRef` | Employee's user ID |
| `actionKey` | Tool name |
| `objectRef` | Entity affected |
| `endpointUsed` | Which MCP endpoint handled it |
| `mode` | "act" |
| `routeContext` | Which page this happened on |

### Session Scoping

Advise/Act is per-session (sessionStorage). Defaults to Advise. Resets on new session.

---

## Section 4: Page Sensitivity Classification

### Standard Levels

| Level | Meaning | Routes |
|-------|---------|--------|
| **Public** | No sensitive data. Any provider. | Marketing pages, public docs |
| **Internal** | Business data, not personally sensitive. | `/portfolio`, `/inventory`, `/ops`, `/build`, `/ea` |
| **Confidential** | Personal data, financials, HR records. | `/employee`, `/customer`, `/workspace` |
| **Restricted** | Platform config, secrets, access control. | `/admin`, `/platform` |

### Routing Integration

1. Page loads → sensitivity level included in coworker context
2. Router only selects endpoints with matching `sensitivityClearance`
3. If no eligible endpoint exists at required tier, falls back to lower-tier cleared endpoint or reports unavailability
4. Sensitivity badge shown in UI near Advise/Act toggle

### Sub-Task Sensitivity Inheritance

Default behavior: sub-tasks inherit the originating page's sensitivity level. A sub-task from `/employee` (confidential) cannot route to an endpoint only cleared for "internal."

**Human override:** If the router cannot find an eligible endpoint (or only expensive ones), the coworker surfaces this:

> "I need to run a web search but this page is Confidential and no search endpoint is cleared at that level. You can approve a sensitivity downgrade to Internal for this specific task if the query contains no sensitive data."

The human approves or denies. The downgrade decision is logged in the audit trail with the employee's ID. The downgrade applies to that single sub-task only, not the session.

---

## Section 5: Provider Profile Migration

### Schema Evolution

The `ModelProvider` table evolves into the MCP endpoint registry.

**Fields retained (renamed):**

| Current | New |
|---------|-----|
| `providerId` | `endpointId` |
| `name` | `displayName` |
| `baseUrl` | `mcpEndpoint` |
| `authMethod` | `authMethod` (unchanged) |
| `status` | `status` (unchanged) |

**Fields added:**

| Field | Type | Purpose |
|-------|------|---------|
| `endpointType` | `"llm" \| "service"` | Replaces `category` |
| `sensitivityClearance` | `string[]` | Classification levels this endpoint may handle |
| `capabilityTier` | `string` | Complexity tier: basic, routine, analytical, deep-thinker |
| `costBand` | `string` | Relative cost: free, low, medium, high |
| `taskTags` | `string[]` | What this endpoint does well |
| `mcpTransport` | `string` | Connection type: stdio, sse, http |
| `maxConcurrency` | `number?` | Operational limit |

**Fields removed:**

| Field | Reason |
|-------|--------|
| `families` / `enabledFamilies` | Replaced by `capabilityTier` + `taskTags` |
| `costModel` (token/compute) | Replaced by `costBand` |
| `supportedAuthMethods` | Simplified to single `authMethod` |
| `category` (direct/local/agent/router) | Replaced by `endpointType` |

### Migration Examples

| Provider | endpointType | costBand | sensitivityClearance | capabilityTier | taskTags |
|----------|-------------|----------|---------------------|---------------|----------|
| Ollama/llama3.1 | llm | free | all levels | analytical | reasoning, code-gen, summarization |
| Ollama/phi3 | llm | free | all levels | basic | summarization, data-extraction |
| Mantis | llm | free | all levels | deep-thinker | reasoning, code-gen, summarization |
| Brave Search | service | low | public, internal | basic | web-search |
| Public Fetch | service | free | public, internal | basic | web-fetch |
| OpenRouter | llm | medium | public, internal | deep-thinker | reasoning, code-gen |

### Workforce Admin Page

The existing Workforce page becomes the single control plane. Adding Mantis works the same as adding Brave Search — register the endpoint, set its manifest, activate it.

---

## Section 6: Unified System Prompt Architecture

### Prompt Assembly

One template, seven composable blocks:

```
1. Identity block        (static)
2. Authority block       (dynamic — HR role + capabilities)
3. Mode block            (dynamic — Advise or Act)
4. Sensitivity block     (dynamic — page classification)
5. Domain context block  (per-route — page purpose, available tools)
6. Route data block      (dynamic — live page data)
7. Attachments block     (dynamic — uploaded files)
```

### Block Definitions

**1. Identity (static, ~50 words):**

> You are an AI coworker on the Open Digital Product Factory platform. You are capable, direct, and specific to this platform. You don't give generic advice — everything you say is grounded in what's actually here. If you don't know, say so. If you can act, act. If you can't, explain why and what the employee can do about it.

**2. Authority (generated from HR role):**

> The employee you're working with holds role {HR-XXX}. They are authorized to: {granted capabilities}. They are NOT authorized to: {denied capabilities relevant to this route}. All actions you take execute under their authority. Never exceed it.

**3. Mode:**

> *Advise:* Mode: ADVISE. You may read, search, analyze, and recommend. You must not create, update, or delete anything. When you would take action, describe what you'd do. If action is needed, suggest switching to Act mode — once per turn, don't nag.

> *Act:* Mode: ACT. You may execute any tool the employee's role authorizes. All actions are logged. Prefer the most direct path. Don't ask for confirmation on routine operations — the employee chose Act mode because they trust you to act.

**4. Sensitivity:**

> This page is classified {LEVEL}. Only endpoints cleared for {LEVEL} are handling requests. Do not include classified data in sub-tasks routed to lower-clearance endpoints.

**5. Domain context (per-route, replaces persona prompts):**

> Domain: {domain name}. {2-3 sentences about what this page does.}
> Available domain tools: {list with one-line descriptions}.
> Key concepts: {domain-specific terms and relationships}.

**6 & 7.** Route data and attachments — unchanged from today's injection.

### What This Eliminates

- 11 bespoke system prompts with personality, heuristics, interpretive models
- The COO's special authority framing
- Agent-specific skill definitions
- Hardcoded `YOUR TOOLS` lists (the domain context block lists tools dynamically)

---

## Migration Strategy

### Phase 1: Schema & Routing Foundation
- Evolve `ModelProvider` table to MCP endpoint schema
- Build the `AgentRouter` with sensitivity × capability × cost matching
- Migrate existing providers to new manifest format
- Register external services as MCP endpoints

### Phase 2: Coworker Identity
- Replace `agent-routing.ts` persona map with route context definitions
- Build the composable system prompt assembler
- Implement Advise/Act toggle (replacing External Access)
- Add `sideEffect` flag to tool registry

### Phase 3: Sub-Task Delegation
- Primary agent can emit sub-task requests with capability/cost hints
- Router dispatches sub-tasks to cheapest eligible endpoint
- Sensitivity inheritance with human override
- Delegation chain captured in audit trail

### Phase 4: Workforce Admin
- Update Workforce page to show/edit MCP endpoint manifests
- Unified view: LLM providers and service endpoints in one table
- Sensitivity clearance and capability tier editing
- Endpoint health monitoring

---

## Future Epic: Corporate Knowledge Memory

All employee-coworker interactions generate institutional knowledge — decisions, rationale, patterns, solutions. Today this is trapped in individual chat threads.

**Vision:** A vector-indexed corporate memory (Pinecone or equivalent) registered as an MCP service endpoint in the workforce registry with task tags like `"memory-recall"`, `"knowledge-search"`. The coworker could recall prior decisions, surface relevant past conversations, and help new employees benefit from accumulated organizational learning.

**Architectural hook:** The audit trail and conversation history already being logged are the raw material. The MCP routing architecture makes adding a memory endpoint a standard workforce registration — no special integration path needed.

**Not in scope for this spec.** Noted here to ensure nothing in this design blocks it.

---

## Files Affected

| File | Change |
|------|--------|
| `apps/web/lib/agent-routing.ts` | Replace persona map with route context definitions |
| `apps/web/lib/mcp-tools.ts` | Add `sideEffect` flag, migrate external tools to endpoint references |
| `apps/web/lib/actions/agent-coworker.ts` | New prompt assembler, Advise/Act gating, router integration |
| `apps/web/lib/ai-provider-priority.ts` | Replace with `AgentRouter` using MCP endpoint matching |
| `apps/web/components/agent/AgentPanelHeader.tsx` | Advise/Act toggle, sensitivity badge |
| `apps/web/components/agent/AgentCoworkerPanel.tsx` | Session state for Advise/Act |
| `packages/db/prisma/schema.prisma` | Evolve ModelProvider to endpoint manifest schema |
| `apps/web/app/(protected)/platform/workforce/` | Updated admin UI for endpoint management |
| `apps/web/lib/agent-sensitivity.ts` | Refactor to per-route sensitivity declarations |
| `apps/web/lib/governance-resolver.ts` | Wire sensitivity override flow |
