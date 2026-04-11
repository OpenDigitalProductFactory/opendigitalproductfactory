# Platform MCP Tool Server — Design Spec

| Field | Value |
|-------|-------|
| **Epic** | Platform Infrastructure |
| **Status** | Draft |
| **Created** | 2026-04-11 |
| **Author** | Claude Code for Mark Bodman |
| **Scope** | `apps/web/app/api/mcp/`, `apps/web/lib/routing/cli-adapter.ts`, `packages/db/src/seed.ts` |
| **Replaces** | Text-based tool descriptions in CLI adapter system prompt |
| **Primary Goal** | Expose all platform tools as a first-class MCP server so any MCP-capable client (Claude CLI, Codex, future agents) can discover and call them natively |
| **Design Principle** | Architecture over shortcuts — single protocol, single source of truth, no translation layers |

---

## 1. Problem Statement

DPF defines ~55 platform tools in `apps/web/lib/mcp-tools.ts` with full schemas and execution logic. These tools power the entire Build Studio workflow: saving feature briefs, assessing complexity, running sandbox operations, managing the backlog, and more.

When the platform routes inference through the Claude CLI adapter (`anthropic-sub` → `claude-cli`), tool definitions are **appended as text descriptions** in the system prompt rather than registered as callable tools. The CLI receives:

```
Available tools (respond with tool_use blocks to invoke):
- update_feature_brief: Save the Feature Brief...
- assess_complexity: Score a feature on 7 dimensions...
```

The model reads these descriptions but has no mechanism to invoke them. It responds: "The Build Studio tools are listed in the system prompt but aren't wired into my callable tool environment." This breaks the entire Build Studio workflow for CLI-dispatched inference.

### Root cause

The CLI adapter (`cli-adapter.ts:214-228`) attempts a workaround: describe tools as text, hope the model generates `tool_use` blocks, and have the platform's agentic loop execute them server-side. This creates three problems:

1. **No native tool calling.** The Claude CLI's `-p` mode doesn't register text descriptions as callable tools. The model cannot generate proper `tool_use` content blocks for tools it doesn't have registered.

2. **Competing agentic loops.** The platform runs a multi-turn agentic loop (`agentic-loop.ts`) around single-turn CLI calls. Each CLI invocation is a fresh `claude -p` call with no continuity. The platform loop and the CLI's potential internal loop are architecturally at odds.

3. **Translation layer.** Tools are defined once in `mcp-tools.ts`, then translated to OpenAI format for the chat adapter, Anthropic format for the responses adapter, text descriptions for the CLI adapter, and MCP format for external servers. Each translation is a point of drift and failure.

### What this blocks

- Build Studio ideate phase (requires `update_feature_brief`, `assess_complexity`, `suggest_taxonomy_placement`, `save_phase_handoff`)
- Build Studio plan phase (requires `propose_decomposition`, `reviewBuildPlan`, `saveBuildEvidence`)
- Build Studio build phase (requires all sandbox tools)
- Any future route that adds tool-requiring workflows dispatched through CLI

---

## 2. Design Principle: Central Configuration, Provider-Agnostic Delivery

The platform owns the **what** — tools, skills, instructions, governance. The adapter layer owns only the **how** — protocol, auth, output format. An admin configuring a coworker should never need to think about which provider will execute the work. A tool defined once should be callable by any provider. A skill written once should be delivered to any model. An instruction set once should govern any execution path.

This is not aspirational — it is a hard architectural constraint. Any design that requires per-provider configuration of coworker capabilities violates this principle and must be reworked.

### 2.1 The three pillars of coworker configuration

Every AI coworker's behavior is determined by three centrally-managed pillars:

**Pillar 1: Instructions** (what the coworker knows and how it behaves)

- System prompts assembled from `.prompt.md` files (seeded to DB, editable via Admin > Prompts)
- Skills from `.skill.md` files (seeded to DB, assigned per agent via `SkillAssignment`)
- Route context from `route-context-map.ts` (page-specific domain knowledge)
- Platform preamble, identity block, mission statement (composable prompt blocks)

Delivery: assembled into a single system prompt string by `prompt-assembler.ts`. Delivered as `system` field (API-native) or `--system-prompt` file (CLI-agentic). Provider-agnostic — it's just text.

**Pillar 2: Tools** (what the coworker can do)

- Tool definitions in `mcp-tools.ts` — schemas, descriptions, execution logic
- Tool grants per agent in `agent_registry.json` / `AgentToolGrant` table
- Build phase scoping via `buildPhases` tags on each tool
- Route domain scoping via `domainTools` in route context map
- HITL proposal flow for side-effecting tools

Delivery: API-native providers receive tool schemas in the request body (OpenAI/Anthropic/Gemini format). CLI-agentic providers discover tools via MCP `tools/list` and call via `tools/call`. **This is what this spec adds** — before this spec, CLI providers couldn't receive tools at all.

**Pillar 3: Governance** (what the coworker is allowed to do)

- Capability checks (`can(userContext, requiredCapability)`)
- Agent grant filtering (`isToolAllowedByGrants()`)
- HITL tiers per agent (`hitlTierDefault`)
- Delegation chain authority narrowing (capabilities reduce at each hop)
- Audit trail (`ToolExecution`, `AgentActionProposal` records)

Delivery: enforced server-side in `executeTool()` and `getAvailableTools()`. Both API-native and CLI-agentic paths call these same functions. Governance never lives in the adapter — it lives in the platform core.

### 2.2 What this means for the MCP server

The MCP server is not a new capability system — it is a **delivery mechanism** for the existing three pillars. It translates the platform's central configuration into MCP protocol so CLI-agentic providers can consume it:

- `tools/list` delivers Pillar 2 (tools) filtered by Pillar 3 (governance)
- `tools/call` executes Pillar 2 (tools) with Pillar 3 (governance) enforcement
- The system prompt (Pillar 1) is delivered separately via `--system-prompt`, same as before

No tool logic, no skill logic, no governance logic lives in the MCP server itself. It is a thin protocol adapter over `getAvailableTools()` and `executeTool()`.

### 2.3 Design: Platform as MCP server

The platform exposes its existing `executeTool()` function over MCP protocol (HTTP JSON-RPC). Any MCP-capable client — Claude CLI, Codex CLI, future agents — can discover and call platform tools natively, with no translation layer.

```
┌────────────────────────────────────────────────────────────────────┐
│                     portal (Next.js)                               │
│                                                                    │
│  ┌──────────────────────────┐    ┌──────────────────────────────┐ │
│  │   Agentic Loop           │    │   MCP Tool Server             │ │
│  │   (agentic-loop.ts)      │    │   /api/mcp/tools              │ │
│  │                          │    │                                │ │
│  │   Direct API providers:  │    │   initialize → capabilities   │ │
│  │   routeAndCall → chat/   │    │   tools/list → tool schemas   │ │
│  │   responses adapter      │    │   tools/call → executeTool()  │ │
│  │                          │    │                                │ │
│  │   CLI providers:         │    │   Auth: session token in       │ │
│  │   routeAndCall → CLI     │    │   X-MCP-Session header         │ │
│  │   adapter → claude -p    │    │                                │ │
│  │   --mcp-config ──────────┼───►│   Governance: capability       │ │
│  │                          │    │   checks, audit logging,       │ │
│  │                          │    │   agent grant filtering        │ │
│  └──────────────────────────┘    └───────────────┬──────────────┘ │
│                                                  │                 │
│                                    ┌─────────────▼──────────────┐ │
│                                    │   mcp-tools.ts              │ │
│                                    │   executeTool(name, params, │ │
│                                    │     userId, context)        │ │
│                                    │   Single source of truth    │ │
│                                    └────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────┘
```

### 2.4 Provider pattern taxonomy

Every inference provider falls into one of two architectural categories based on how tool calling works:

**API-native** — Platform sends tool schemas in the HTTP request body. Model returns `tool_use`/`tool_calls` blocks. Platform executes tools and iterates. Loop owner: platform (`agentic-loop.ts`). Providers: Anthropic API (`anthropic`), OpenAI (`openai`), Gemini (`google`), Ollama/Docker Model Runner (`ollama`).

**CLI-agentic** — CLI discovers tools via MCP, calls them, loops internally, returns final result. Loop owner: CLI process. Providers: Claude CLI (`anthropic-sub`), Codex CLI (`codex`), any future CLI-based agent.

**API-native providers** are already working. The chat adapter handles per-provider format translation (Anthropic content blocks, OpenAI function calling, Gemini `functionDeclarations`). These translations are cosmetic — JSON shape differences, not architectural gaps.

**CLI-agentic providers** all share the same characteristics:

- Run inside a container (sandbox)
- Need auth injected via env vars (provider-specific mechanism)
- Need tool access via MCP (same MCP server for all)
- Own the tool loop — platform makes one call, gets a complete result
- Return structured output (JSON/stream-JSON, provider-specific parsing)

The pattern: **every CLI-agentic provider needs the same MCP server.** The MCP server is the platform's tool surface — it doesn't change per provider. What changes per CLI provider is isolated in the adapter layer:

**Per-provider** (adapter-specific):

- Auth mechanism (OAuth, API key, env var name)
- CLI command and flags (`claude -p`, `codex`, etc.)
- Output format parsing (stream-json, json)

**Shared** (built once, used by all CLI-agentic adapters):

- MCP config generation (`lib/mcp/session-token.ts`)
- MCP server endpoint (`/api/mcp/tools`)
- Tool schemas, filtering, execution (`mcp-tools.ts`)
- Session token creation and validation

This means the MCP server is built once and benefits all CLI-agentic providers — current and future. The Codex CLI adapter (`codex-dispatch.ts`) gets MCP tool access by generating the same config file; no MCP changes needed.

### 2.5 Agent-scoped tool surface (TAK governance)

Every AI coworker has a different tool surface. The Software Engineer gets sandbox tools; the COO gets backlog and registry tools; the QA Engineer gets test tools. This scoping is enforced by the `AgentToolGrant` system (`agent-grants.ts`) and must carry through to MCP.

The session token encodes the `agentId` of the active coworker. When the CLI calls `tools/list`, the MCP server resolves that agent's grants and returns **only the tools that agent is authorized to use.** The CLI never sees tools outside its scope — they don't appear in discovery, so the model can't attempt to call them.

Scoping layers applied in `tools/list`, in order:

1. **User capability** — `can(userContext, tool.requiredCapability)` filters by platform role
2. **Agent grants** — `isToolAllowedByGrants(toolName, agentGrants)` filters by coworker's `tool_grants` from `agent_registry.json` or `AgentToolGrant` DB table
3. **Build phase** — `tool.buildPhases.includes(activeBuildPhase)` filters by current phase when inside a build (e.g., ideate-phase tools only during ideate)
4. **Route domain** — `domainTools` from `route-context-map.ts` constrains to page-relevant tools

This is the same filtering that `getAvailableTools()` already applies for direct API calls — the MCP server reuses the same code path, not a reimplementation.

### 2.6 Key decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Server location | Inside the portal container (`/api/mcp/tools` route) | Tools already execute inside the portal process (DB access, imports). No new container needed. |
| Transport | HTTP JSON-RPC (Streamable HTTP) | Matches MCP spec and existing browser-use pattern. Claude CLI supports HTTP MCP servers via `--mcp-config`. |
| Auth model | Short-lived session token generated per CLI invocation | CLI adapter creates a scoped token before spawning `claude -p`. Token encodes `userId`, `agentId`, `routeContext`, `threadId`, and expiry. No long-lived credentials exposed. |
| Tool filtering | Server-side, per-session | `tools/list` returns only tools the session's user+agent are authorized for. Same `getAvailableTools()` + `isToolAllowedByGrants()` logic. Build phase filtering applied when session includes a build context. |
| Agentic loop ownership | CLI owns the tool loop for CLI-dispatched calls | The platform's agentic loop makes a single CLI call. The CLI discovers tools via MCP, calls them, gets results, and continues its own loop internally. Platform receives the final result. |
| External exposure | Internal only — `localhost` within Docker network | Not exposed outside the container network. No public endpoint. |
| Protocol version | MCP 2025-03-26 (latest stable) | Supports Streamable HTTP transport, tool annotations, and capability negotiation. |

### 2.7 Control flow — before vs. after

**Before (broken):**
```
Platform agentic loop
  → iteration 1: routeAndCall → CLI adapter → claude -p (tools as text in system prompt)
  ← CLI returns text: "tools aren't wired in"
  → iteration 2: nudge → CLI adapter → claude -p
  ← CLI returns text: "I still can't call tools"
  → ... loop exhausts iterations, returns failure
```

**After:**
```
Platform agentic loop
  → CLI adapter generates MCP session token
  → CLI adapter writes mcp-config.json to sandbox
  → CLI adapter spawns: claude -p --mcp-config /tmp/mcp-config.json
  → Claude CLI discovers tools via MCP tools/list
  → Claude CLI calls tools via MCP tools/call (its own internal loop)
  → Claude CLI returns final result (text + tool outputs)
  ← CLI adapter parses result, returns to platform
```

For direct API providers (chat/responses adapter), nothing changes. The MCP server exists as an additional capability, not a replacement.

---

## 3. MCP Server Implementation

### 3.1 Endpoint: `apps/web/app/api/mcp/tools/route.ts`

A single Next.js API route that handles the MCP JSON-RPC protocol:

```typescript
// Handles: initialize, tools/list, tools/call, notifications/initialized
export async function POST(request: Request): Promise<Response> {
  const body = await request.json();
  
  switch (body.method) {
    case "initialize":
      return jsonrpc(body.id, {
        protocolVersion: "2025-03-26",
        serverInfo: { name: "dpf-platform", version: "1.0.0" },
        capabilities: { tools: { listChanged: false } },
      });

    case "notifications/initialized":
      return new Response(null, { status: 204 });

    case "tools/list":
      return handleToolsList(body, request);

    case "tools/call":
      return handleToolsCall(body, request);

    default:
      return jsonrpcError(body.id, -32601, "Method not found");
  }
}
```

### 3.2 Session token

The CLI adapter generates a short-lived session token before each CLI invocation:

```typescript
interface McpSessionPayload {
  userId: string;
  agentId: string;
  routeContext: string;
  threadId: string;
  buildPhase: string | null;
  exp: number; // Unix timestamp, 5 minutes from now
}
```

Token is a signed JWT using `process.env.NEXTAUTH_SECRET` (already available in the portal). Passed to the MCP server via the `X-MCP-Session` header in the MCP config.

### 3.3 `tools/list` — tool discovery

Returns tool schemas for all tools the session's user+agent are authorized to use:

```typescript
async function handleToolsList(body: JsonRpcRequest, request: Request) {
  const session = validateSession(request);
  
  const tools = await getAvailableTools(
    { platformRole: session.platformRole, isSuperuser: session.isSuperuser },
    { agentId: session.agentId, unifiedMode: true },
  );
  
  // Apply build phase filtering if session has active build
  const filtered = session.buildPhase
    ? tools.filter(t => t.buildPhases?.includes(session.buildPhase))
    : tools;
  
  return jsonrpc(body.id, {
    tools: filtered.map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      annotations: {
        title: t.name.replace(/_/g, " "),
        readOnlyHint: !t.sideEffect,
        destructiveHint: t.executionMode === "proposal",
        openWorldHint: !!t.requiresExternalAccess,
      },
    })),
  });
}
```

### 3.4 `tools/call` — tool execution

Delegates to the existing `executeTool()` function:

```typescript
async function handleToolsCall(body: JsonRpcRequest, request: Request) {
  const session = validateSession(request);
  const { name, arguments: params } = body.params;
  
  // Proposal tools (side-effecting, need HITL approval) are blocked via MCP.
  // The CLI can't present an approval dialog. Return a structured message
  // telling the CLI to inform the user that approval is needed in the UI.
  const toolDef = PLATFORM_TOOLS.find(t => t.name === name);
  if (toolDef?.executionMode === "proposal") {
    return jsonrpc(body.id, {
      content: [{
        type: "text",
        text: JSON.stringify({
          status: "approval_required",
          message: `${name} requires human approval. The proposal has been saved — approve it in the Build Studio UI.`,
          proposalId: await createProposal(session, name, params),
        }),
      }],
      isError: false,
    });
  }
  
  // Execute immediate tools directly
  const result = await executeTool(name, params ?? {}, session.userId, {
    routeContext: session.routeContext,
    agentId: session.agentId,
    threadId: session.threadId,
  });
  
  return jsonrpc(body.id, {
    content: [{
      type: "text",
      text: JSON.stringify(result),
    }],
    isError: !result.success,
  });
}
```

### 3.5 Tool annotations (MCP 2025-03-26)

The MCP spec supports tool annotations that help clients make informed decisions:

| Annotation | Mapping from `mcp-tools.ts` |
|---|---|
| `readOnlyHint` | `!tool.sideEffect` |
| `destructiveHint` | `tool.executionMode === "proposal"` |
| `idempotentHint` | `false` for write tools, `true` for query tools |
| `openWorldHint` | `tool.requiresExternalAccess` |

These annotations let the CLI (or any client) make its own decisions about confirmation prompts, retries, and caching.

---

## 4. CLI Adapter Changes

### 4.1 MCP config generation

The CLI adapter replaces the text-based tool injection with an MCP config file:

```typescript
// Before (broken):
let toolContext = "";
if (tools && tools.length > 0) {
  const toolDescriptions = tools.map(t => ...);
  toolContext = `\n\nAvailable tools:\n${toolDescriptions.join("\n")}`;
}
const fullSystemPrompt = systemPrompt + toolContext;

// After:
const mcpConfig = {
  mcpServers: {
    "dpf-platform": {
      type: "url",
      url: `http://localhost:${MCP_PORT}/api/mcp/tools`,
      headers: {
        "X-MCP-Session": sessionToken,
      },
    },
  },
};
const mcpConfigFile = `/tmp/mcp-config-${slug}.json`;
// Write mcpConfig to sandbox, pass --mcp-config to CLI
```

### 4.2 CLI command change

```bash
# Before:
claude -p - --dangerously-skip-permissions --output-format json \
  --model $MODEL --system-prompt "$SYSPROMPT" < $PROMPT_FILE

# After:
claude -p - --dangerously-skip-permissions --output-format stream-json \
  --model $MODEL --system-prompt "$SYSPROMPT" \
  --mcp-config $MCP_CONFIG_FILE < $PROMPT_FILE
```

Key changes:
- `--mcp-config` points to the generated config file
- `--output-format stream-json` for richer event parsing (tool call events are interleaved)
- System prompt no longer includes tool descriptions — the CLI discovers tools via MCP
- Tools parameter is no longer passed to the CLI adapter (MCP replaces it)

### 4.3 Agentic loop simplification for CLI routes

When the CLI adapter is used, the platform's agentic loop behavior changes:

- **Before:** Multi-turn loop — each iteration calls CLI, parses tool_use blocks, executes tools, feeds results back.
- **After:** Single call — the CLI handles its own tool loop via MCP. The platform receives the final result.

The agentic loop detects CLI-dispatched results by checking `result.providerId` or adapter type. When the result comes from the CLI adapter, the loop treats it as a complete response (no further iterations needed for tool execution).

```typescript
// In agentic-loop.ts, after routeAndCall returns:
if (result.adapterType === "claude-cli") {
  // CLI handled tool calling internally via MCP.
  // Result is complete — no need to iterate.
  return {
    content: result.content,
    // ... other fields
    executedTools: result.toolCalls.map(tc => ({
      name: tc.name,
      args: tc.arguments,
      result: tc.result,
    })),
  };
}
```

---

## 5. Security

### 5.1 Session token scope

| Property | Constraint |
|----------|-----------|
| Lifetime | 5 minutes (covers a single CLI invocation + tool calls) |
| Scope | Bound to `userId`, `agentId`, `routeContext`, `threadId` |
| Signing | HMAC-SHA256 using `NEXTAUTH_SECRET` |
| Replay | One-time use flag optional; expiry is primary control |

### 5.2 Network isolation

The MCP server is only accessible within the Docker network. The portal container listens on `localhost:3000` (or the configured port). The CLI runs inside the sandbox container and accesses the portal via the Docker network hostname `portal`.

```
sandbox container → http://portal:3000/api/mcp/tools → portal container
```

No external exposure. No port mapping to host.

### 5.3 Tool governance

All existing governance mechanisms apply unchanged:

- **Capability checks:** `can(userContext, tool.requiredCapability)` — enforced in `tools/list`
- **Agent grant filtering:** `isToolAllowedByGrants(toolName, agentGrants)` — enforced in `tools/list`
- **Build phase filtering:** `tool.buildPhases.includes(activeBuildPhase)` — enforced in `tools/list`
- **HITL proposals:** `executionMode === "proposal"` tools return `approval_required` — enforced in `tools/call`
- **Audit logging:** `ToolExecution` records created for every `tools/call` — same as agentic loop

### 5.4 Threat model

| Threat | Mitigation |
|--------|-----------|
| Token theft from sandbox | 5-minute expiry; sandbox is ephemeral; token scoped to single user+agent |
| Unauthorized tool access | `tools/list` applies same filtering as `getAvailableTools()` — no tools leaked |
| Prompt injection via tool results | Tool results are JSON-stringified, not interpolated into prompts by the server |
| DoS via tool spam | Rate limiting via existing `recordRequest()` infrastructure; CLI timeout (3 min) bounds total duration |
| Sandbox escape via tool calls | Tools execute in the portal container (same as today); sandbox tools delegate to `docker exec` |

---

## 6. Registration and Discovery

### 6.1 Seed registration

Add to `packages/db/src/seed.ts` in the `seedMcpServers()` function:

```typescript
{
  serverId: "mcp-dpf-platform",
  name: "DPF Platform Tools",
  transport: "http",
  category: "platform",
  tags: ["platform", "tools", "build-studio", "backlog", "sandbox"],
  config: {
    url: "http://portal:3000/api/mcp/tools",
    transport: "http",
    executionScope: "portal",
    notes: "Internal MCP server exposing all platform tools. Used by CLI adapters for native tool calling. Not externally accessible.",
  },
},
```

### 6.2 Health check

The MCP server supports the standard `initialize` handshake. The existing `checkMcpServerHealth()` in `mcp-server-health.ts` can verify it's responding. Health is also implicitly verified on every CLI dispatch — if the MCP server is down, the CLI reports tool discovery failure, which surfaces as an inference error.

---

## 7. Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `apps/web/app/api/mcp/tools/route.ts` | **Create** | MCP JSON-RPC endpoint: initialize, tools/list, tools/call |
| `apps/web/lib/mcp/session-token.ts` | **Create** | Session token generation and validation (JWT) |
| `apps/web/lib/routing/cli-adapter.ts` | **Modify** | Replace text tool injection with MCP config generation |
| `apps/web/lib/tak/agentic-loop.ts` | **Modify** | Detect CLI adapter results and skip multi-turn tool iteration |
| `packages/db/src/seed.ts` | **Modify** | Register `mcp-dpf-platform` server entry |
| `apps/web/lib/routing/cli-adapter.test.ts` | **Modify** | Update tests for MCP config generation |
| `apps/web/app/api/mcp/tools/route.test.ts` | **Create** | MCP protocol conformance tests |

---

## 8. Behavioral Changes

### 8.1 What changes

| Behavior | Before | After |
|----------|--------|-------|
| CLI tool access | Text descriptions in system prompt; model can't call them | Native MCP tool calling; model discovers and calls tools |
| CLI agentic loop | Platform loop wraps CLI in multi-turn; CLI is single-turn | CLI runs its own tool loop via MCP; platform makes single CLI call |
| Tool definition format | Translated per-adapter (OpenAI, Anthropic, text, MCP) | MCP for CLI; existing formats for API adapters (unchanged) |
| Build Studio via CLI | Broken — tools not callable | Working — full tool access via MCP |

### 8.2 What doesn't change

| Behavior | Status |
|----------|--------|
| Direct API providers (chat/responses adapter) | Unchanged — tools passed via native API format |
| Ollama adapter | Unchanged — uses chat adapter with OpenAI format |
| Tool execution logic (`executeTool()`) | Unchanged — MCP server delegates to same function |
| Capability checks, grant filtering, audit | Unchanged — enforced in MCP server using same functions |
| HITL proposal flow | Unchanged — proposal tools return `approval_required` via MCP |
| Browser-use MCP server | Unchanged — separate server, separate tools |

---

## 9. Migration Path

### Phase 1: MCP server + CLI adapter update (this spec)
- Create the MCP endpoint
- Update CLI adapter to generate MCP config
- Update agentic loop to handle CLI-complete results
- Seed the server registration
- Verify Build Studio ideate→plan→build→review→ship flow via CLI

### Phase 2: Codex CLI integration (follow-on)
- Codex CLI supports MCP via `--mcp-config` (same flag)
- Reuse the same MCP server and session token mechanism
- Update `codex-dispatch.ts` to generate MCP config

### Phase 3: Unified tool protocol (future)
- Evaluate consolidating all adapters to use MCP for tool calling
- Chat/responses adapters would still handle inference, but tool execution could flow through MCP
- This would make `PLATFORM_TOOLS` → MCP schema the single translation, eliminating OpenAI/Anthropic format conversion

---

## 10. Acceptance Criteria

1. Build Studio ideate phase works end-to-end via `anthropic-sub` CLI dispatch:
   - `update_feature_brief` called and saves brief
   - `suggest_taxonomy_placement` returns taxonomy candidates
   - `assess_complexity` returns complexity scores
   - `save_phase_handoff` transitions to plan phase

2. MCP protocol conformance:
   - `initialize` returns valid capabilities
   - `tools/list` returns all authorized tools with correct schemas
   - `tools/call` executes tools and returns results in MCP content format
   - Invalid session tokens return `401`
   - Expired tokens return `401`

3. Security:
   - MCP endpoint is not accessible from outside the Docker network
   - Session tokens expire after 5 minutes
   - Tool filtering matches existing `getAvailableTools()` behavior exactly
   - Proposal tools return `approval_required`, not execution results

4. No regression:
   - Direct API providers (chat, responses) continue working unchanged
   - Existing agentic loop behavior preserved for non-CLI routes
   - Browser-use MCP server unaffected

5. Observability:
   - `ToolExecution` audit records created for every MCP tool call
   - Session token creation logged with userId and agentId
   - CLI adapter logs MCP config path and session scope

---

## 11. Open Questions

| # | Question | Impact | Resolution |
|---|----------|--------|------------|
| 1 | Does `claude -p --mcp-config` support multi-turn tool calling within a single invocation? | Determines whether the platform loop iterates or the CLI handles the full loop. | **RESOLVED:** Yes. `claude -p` runs the full agentic loop internally. MCP tools are discovered, called, results fed back, and the model continues looping until it produces a final text response — all within a single invocation. The platform's agentic loop makes one CLI call and receives the complete result. |
| 2 | Should the MCP server support SSE streaming for long-running tool calls? | Some tools (sandbox operations, web search) can take 10-30 seconds. | Start without streaming. Add Streamable HTTP notifications if latency becomes a problem. |
| 3 | Should the MCP config use `url` type (direct HTTP) or `stdio` type (spawn a bridge process)? | `url` is simpler but requires network access from sandbox to portal. `stdio` avoids network but adds process management. | Use `url` type — sandbox already has network access to portal (required for dev server). |
| 4 | Should session tokens be stored in the DB for auditing, or is JWT self-validation sufficient? | DB storage enables revocation but adds latency. | Start with JWT self-validation. Add DB storage if revocation becomes a requirement. |
