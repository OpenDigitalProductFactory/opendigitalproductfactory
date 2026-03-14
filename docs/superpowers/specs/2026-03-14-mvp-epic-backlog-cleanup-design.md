# MVP Epic & Backlog Cleanup — Design Spec

**Date:** 2026-03-14
**Goal:** Clean up duplicate/stale backlog items, fix statuses, assign orphans, mark subsumed items, and create three new MVP-critical epics that define the path to a self-iterating platform.

**MVP Definition:** A standalone platform deployment (no VS Code) that can iterate on itself and build new products within the context of the 4 portfolios. AI agents have real conversations, run in Docker with managed Ollama, and can take governed actions with human approval.

---

## Part 1: Backlog Cleanup

### 1.1 Deduplicate (retire 4 thin BI-REST items)

These restored items are covered by original items with richer detail:

| Retire | Covered By | Reason |
|--------|-----------|--------|
| BI-REST-080 | BI-PROD-004/005/006/007/008 | Theme items with full acceptance criteria |
| BI-REST-081 | BI-PROD-009/010/011/012/013 | A11y items with WCAG specs |
| BI-REST-010 | BI-PROD-001 | Backlog CRUD (same work, less detail) |
| BI-REST-012 | BI-PROD-002 | DPF self-registration (same work, less detail) |

**Action:** Delete these 4 items from the database.

### 1.2 Fix Statuses (3 items marked wrong)

| Item | Current | Correct | Reason |
|------|---------|---------|--------|
| BI-PROD-001 | in-progress | done | Phase 5A Backlog CRUD shipped |
| BI-PROD-002 | in-progress | done | DPF Portal product exists, seed works |
| BI-PROD-003 | open | done | Phase 2B/2C agent counts and health metrics shipped |

### 1.3 Assign Orphans to Existing Epics

| Item | Assign To | Reason |
|------|----------|--------|
| BI-PORT-001 | EP-PORTAL-FOUND-001 | Portal foundation work |
| BI-PORT-002 | EP-PORTAL-FOUND-001 | Taxonomy is portal foundation |
| BI-PORT-003 | EP-PORTAL-FOUND-001 | Portfolio route is portal foundation |
| BI-PORT-004 | EP-BACKLOG-FOUND-001 | Backlog system work |
| BI-PROD-001 | EP-BACKLOG-FOUND-001 | Backlog CRUD |
| BI-PROD-002 | EP-BACKLOG-FOUND-001 | DPF self-registration (backlog context) |
| BI-PROD-003 | EP-BACKLOG-FOUND-001 | Agent counts are part of product management foundation |

### 1.4 Mark Subsumed Items

| Item | New Status | Reason |
|------|-----------|--------|
| BI-REST-042 | done | Subsumed by EP-DEPLOY-001 (new epic covers Docker/Ollama comprehensively) |
| BI-REST-052 | done | Subsumed by EP-AGENT-EXEC-001 (new epic covers governed task execution) |

### 1.5 Update Parent Epic Statuses

| Epic | New Status | Reason |
|------|-----------|--------|
| EP-AI-PROVIDERS-001 | done | All 3 items done (BI-REST-040, 041 done; 042 subsumed) |
| EP-AI-COWORKER-001 | done | All 3 items done (BI-REST-050, 051 done; 052 subsumed) |

---

## Part 2: New MVP Epics

### 2.1 EP-LLM-LIVE-001 — Live LLM Conversations

**Goal:** Replace canned responses in the co-worker panel with real AI inference via configured providers.

**Architecture:** The existing `callProviderForProfiling` function in `actions/ai-providers.ts` already makes provider-specific API calls (Anthropic `/messages`, OpenAI `/chat/completions`, Ollama `/api/chat`, Gemini `/generateContent`). This epic generalizes that into a chat-capable inference function and wires it into `sendMessage`.

**Prerequisite:** At least one provider must be configured and active (Ollama running locally, or a cloud API key entered).

**Fallback:** When no provider is active, canned responses continue to work (graceful degradation).

#### Backlog Items

**BI-LLM-001: Build `callProvider` generalized inference function**
- Type: product | Priority: 1 | Status: open
- Generalize `callProviderForProfiling` into `callProvider(providerId, modelId, messages[], systemPrompt)` supporting multi-turn chat format.
- Provider-specific request/response formats already handled in profiling code.
- Return `{ content: string, inputTokens: number, outputTokens: number, inferenceMs: number }`.
- Handle errors gracefully: provider down, rate limited, model not found.

**BI-LLM-002: Define agent system prompts for all 9 route agents**
- Type: product | Priority: 2 | Status: open
- Each route agent (portfolio-advisor, ea-architect, ops-coordinator, etc.) gets a system prompt stored in `ROUTE_AGENT_MAP` alongside existing `agentName`/`agentDescription`.
- System prompts describe the agent's role, what it can help with, and the user's current route context.
- Prompts include the user's `platformRole` and capabilities so the agent knows what the user can access.

**BI-LLM-003: Add platform default provider/model selection**
- Type: product | Priority: 3 | Status: open
- New fields or config: which provider+model is the default for agent conversations.
- Selection UI in `/platform/ai` — dropdown of active providers, dropdown of discovered models for that provider.
- `rankProvidersByCost` already exists for auto-selection fallback.
- Stored as a platform-level setting (not per-agent — that's a future enhancement).

**BI-LLM-004: Replace canned responses with live inference in `sendMessage`**
- Type: product | Priority: 4 | Status: open
- In `sendMessage` server action: after resolving the agent, check if a default provider is configured and active.
- If yes: build messages array (system prompt + recent thread history + user message), call `callProvider`, persist the response with `agentId` and token counts.
- If no: fall back to `generateCannedResponse` (existing behavior).
- Thread history: include last N messages as context (configurable, default 20).

**BI-LLM-005: Wire token usage logging into inference calls**
- Type: product | Priority: 5 | Status: open
- `logTokenUsage` already exists. Call it after every successful inference with agentId, providerId, contextKey="coworker", token counts, and computed cost.
- Token spend is already visible in `/platform/ai` spend dashboard (By Provider / By Agent tabs).

### 2.2 EP-DEPLOY-001 — Standalone Docker Deployment with Managed Ollama

**Goal:** Single `docker compose up` brings the full platform online with portal, Postgres, and managed Ollama. The platform UI manages Docker/Ollama directly — users never touch Docker commands.

**Architecture:** Three-service Docker Compose stack. The portal container mounts the Docker socket to manage the Ollama container. Auto-detection of host GPU/RAM selects an appropriate default model and pulls it automatically on first startup.

#### Backlog Items

**BI-DEPLOY-001: Create portal Dockerfile and Docker Compose stack**
- Type: product | Priority: 1 | Status: open
- Multi-stage Dockerfile: install deps → build Next.js standalone → production image.
- Compose services: `portal` (Next.js, port 3000), `db` (Postgres 16, volume-mounted data), `ollama` (ollama/ollama image, GPU passthrough if available).
- Environment variables for `DATABASE_URL`, `CREDENTIAL_ENCRYPTION_KEY`, `AUTH_SECRET`.
- Prisma migrations run automatically on portal startup.

**BI-DEPLOY-002: Build Docker API client for container management**
- Type: product | Priority: 2 | Status: open
- Server-side module that talks to Docker Engine API via mounted socket (`/var/run/docker.sock`).
- Operations: inspect container status, start/stop/restart container, list images, pull image, exec command.
- Scoped to the Ollama container only (not arbitrary Docker management).
- Server actions with `manage_provider_connections` auth guard.

**BI-DEPLOY-003: Add Ollama management UI in platform**
- Type: product | Priority: 3 | Status: open
- New section in `/platform/ai` or `/platform/ai/ollama`: Ollama container status (running/stopped/not found), start/stop/restart buttons.
- Model management: list pulled models, pull new model by name, delete model.
- Real-time pull progress indicator.

**BI-DEPLOY-004: Implement host capability detection and auto-model selection**
- Type: product | Priority: 4 | Status: open
- On startup or from platform UI: detect GPU presence (NVIDIA runtime in Docker), available RAM.
- Model selection matrix: CPU-only + <8GB → `phi3:mini` (~2GB), CPU + 16GB+ → `llama3:8b` (~5GB), GPU + 8GB VRAM → `llama3:8b`, GPU + 16GB+ VRAM → `llama3:70b-q4`.
- Store detected capabilities and selected model as platform config.

**BI-DEPLOY-005: Auto-pull default model and auto-configure provider on first startup**
- Type: product | Priority: 5 | Status: open
- Portal startup sequence: check if Ollama is reachable → check if any models are pulled → if not, trigger pull of auto-selected model → configure Ollama provider to `status: "active"` → set as default provider for agent conversations.
- This makes the platform usable with zero manual configuration.

**BI-DEPLOY-006: Add health check monitoring and status indicators**
- Type: product | Priority: 6 | Status: open
- Docker Compose health checks on all three services.
- Portal status bar/banner when Ollama is unreachable or no models are available.
- Health endpoint (`/api/health`) for external monitoring.

### 2.3 EP-AGENT-EXEC-001 — Agent Task Execution with HITL Governance

**Goal:** Agents can propose real actions (create backlog items, modify products, update EA models). Humans approve before execution. Every action is audit-logged for regulated industry compliance.

**Architecture:** New `AgentActionProposal` model captures what the agent wants to do. Proposals render as structured cards in the chat. Approval triggers execution of existing server actions. The `AuthorizationDecisionLog` model (already in schema) records the audit trail.

**Prerequisite:** EP-LLM-LIVE-001 must be complete (agents need real LLM conversations to understand user intent and formulate proposals).

#### Backlog Items

**BI-EXEC-001: Design AgentActionProposal schema**
- Type: product | Priority: 1 | Status: open
- New Prisma model: `AgentActionProposal` with fields: id, proposalId (unique), threadId FK, agentId, actionType (create_backlog_item | update_backlog_item | create_digital_product | update_digital_product | update_lifecycle | create_ea_element | create_ea_relationship), parameters (Json), status (proposed | approved | rejected | executed | failed), proposedAt, decidedAt, decidedBy (userId), executedAt, resultEntityId, resultError.
- FK to AgentMessage (the message that proposed it) for traceability.

**BI-EXEC-002: Build proposal creation from agent inference**
- Type: product | Priority: 2 | Status: open
- When the LLM response indicates an action (via tool-use / function-calling pattern), parse the proposed action into an `AgentActionProposal`.
- Define the tool schemas the LLM can call: `create_backlog_item({ title, type, status, body, epicId? })`, `update_lifecycle({ productId, stage, status })`, `create_ea_element({ viewId, elementTypeSlug, name })`, etc.
- Agent system prompts updated to include available tools based on user capabilities.

**BI-EXEC-003: Create proposal card rendering in chat UX**
- Type: product | Priority: 3 | Status: open
- New message content type or `role: "proposal"` rendering in `AgentMessageBubble`.
- Card shows: action type (human-readable label), key parameters, affected entity.
- Approve / Reject buttons inline. Edit button opens parameter adjustment.
- Approved/rejected state renders differently (green check / red X with timestamp and approver).

**BI-EXEC-004: Implement proposal execution engine**
- Type: product | Priority: 4 | Status: open
- On approval: map `actionType` + `parameters` to existing server actions (`createBacklogItem`, `updateBacklogItem`, etc.).
- Execute with the approving user's auth context (not the agent's).
- Record result: `executedAt`, `resultEntityId` (the created/updated entity), or `resultError`.
- Post confirmation message in agent thread.

**BI-EXEC-005: Wire approval events into AuthorizationDecisionLog**
- Type: product | Priority: 5 | Status: open
- `AuthorizationDecisionLog` model already exists with `decision` (allow|deny|require_approval), `rationale` (Json), and related fields.
- Every proposal approval/rejection writes a log entry: who, when, what action, what parameters, decision, rationale (user can optionally add a note).
- This satisfies the regulated industry requirement: queryable, exportable audit evidence.

**BI-EXEC-006: Add agent action history view in platform**
- Type: product | Priority: 6 | Status: open
- New page or section in `/platform` or `/admin`: table of all `AgentActionProposal` records.
- Filterable by: status (proposed/approved/rejected/executed/failed), agent, action type, date range.
- Detail view shows full proposal parameters, approval chain, execution result.
- Export capability for compliance audits.

---

## Part 3: Complete Epic Landscape

### MVP-Critical (build order: A → B → C)

| Epic | Title | Status | Items |
|------|-------|--------|-------|
| EP-LLM-LIVE-001 | Live LLM Conversations | open | 5 (BI-LLM-001..005) |
| EP-DEPLOY-001 | Standalone Docker Deployment with Managed Ollama | open | 6 (BI-DEPLOY-001..006) |
| EP-AGENT-EXEC-001 | Agent Task Execution with HITL Governance | open | 6 (BI-EXEC-001..006) |

### Active (in-progress, other agents)

| Epic | Title | Status | Open Items |
|------|-------|--------|------------|
| EP-EA-MODEL-001 | EA Modeling Foundation and Canvas | in-progress | BI-REST-022 (structured notation) |
| EP-EA-REF-001 | EA Reference Model Assessment | in-progress | BI-REST-032 (repeatable load) |
| EP-GOV-FOUND-001 | Identity, Access, Agent Governance | in-progress | BI-REST-060/061/062 |
| EP-DISCOVERY-001 | Bootstrap Discovery & Portfolio Quality | in-progress | BI-REST-070/071/072 |

### Done

| Epic | Title | Notes |
|------|-------|-------|
| EP-PORTAL-FOUND-001 | Portal Foundation | + 3 orphan items assigned |
| EP-BACKLOG-FOUND-001 | Backlog Foundation | + 4 orphan items assigned, statuses fixed |
| EP-AI-PROVIDERS-001 | AI Provider Registry | BI-REST-042 subsumed by EP-DEPLOY-001 |
| EP-AI-COWORKER-001 | AI Agent Co-worker UX | BI-REST-052 subsumed by EP-AGENT-EXEC-001 |

### Deferred (post-MVP)

| Epic | Title | Notes |
|------|-------|-------|
| EP-UI-THEME-001 | Theme & Branding Modernization | 5 detailed items with acceptance criteria |
| EP-UI-A11Y-001 | Dark Theme Usability & Accessibility | 2 open items remaining |

---

## Part 4: Cleanup Script Actions

The following database mutations implement Parts 1.1–1.5:

1. **Delete 4 duplicate items:** BI-REST-080, BI-REST-081, BI-REST-010, BI-REST-012
2. **Fix 3 statuses:** BI-PROD-001→done, BI-PROD-002→done, BI-PROD-003→done
3. **Assign 7 orphans:** BI-PORT-001/002/003→EP-PORTAL-FOUND-001, BI-PORT-004/BI-PROD-001/002/003→EP-BACKLOG-FOUND-001
4. **Mark 2 subsumed:** BI-REST-042→done, BI-REST-052→done
5. **Update 2 epic statuses:** EP-AI-PROVIDERS-001→done, EP-AI-COWORKER-001→done
6. **Create 3 new epics** with 17 backlog items total
