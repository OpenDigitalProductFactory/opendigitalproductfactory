# EP-AGENT-EXEC-001: Agent Task Execution with HITL Governance — Design Spec

**Date:** 2026-03-14
**Goal:** Agents propose real actions via MCP tool-use. Humans approve before execution. Every action is audit-logged. The platform exposes its own capabilities as an MCP server.

**Prerequisite:** EP-LLM-LIVE-001 (live LLM conversations) — complete.

---

## 1. Schema: AgentActionProposal

New Prisma model (**migration required**):

```prisma
model AgentActionProposal {
  id             String       @id @default(cuid())
  proposalId     String       @unique  // "AP-XXXXX" human-readable
  threadId       String
  thread         AgentThread  @relation(fields: [threadId], references: [id])
  messageId      String       @unique  // v1: one proposal per message
  message        AgentMessage @relation(fields: [messageId], references: [id])
  agentId        String       // soft ref to agent ID (not FK — agent may be route-derived, not in Agent table)
  actionType     String       // create_backlog_item | update_backlog_item | create_digital_product | update_lifecycle | report_quality_issue
  parameters     Json         // structured args the agent proposed
  status         String       @default("proposed") // proposed | approved | rejected | executed | failed
  proposedAt     DateTime     @default(now())
  decidedAt      DateTime?
  decidedById    String?
  decidedBy      User?        @relation(fields: [decidedById], references: [id])
  executedAt     DateTime?
  resultEntityId String?      // ID of the created/updated entity
  resultError    String?      @db.Text

  @@index([threadId])
  @@index([status])
}
```

**Reverse relations required:**
- `AgentThread` gains `proposals AgentActionProposal[]`
- `AgentMessage` gains `proposal AgentActionProposal?` (singular — v1 is one proposal per message, enforced by `@unique` on messageId)
- `User` gains `approvedProposals AgentActionProposal[]`

**Design decisions:**
- `messageId @unique` enforces v1's one-proposal-per-message constraint at the DB level. Future multi-proposal support would remove this constraint.
- `agentId` is a soft reference (not FK) because route-derived agents (e.g., "portfolio-advisor") are not rows in the `Agent` table — they're entries in `ROUTE_AGENT_MAP`.
- Indexes on `threadId` and `status` for common query patterns.

**Human-readable IDs:** `AP-XXXXX` format (same pattern as PIR-XXXXX for quality reports).

---

## 2. MCP Server

### Endpoint

`apps/web/app/api/mcp/route.ts` — simplified REST endpoint inspired by MCP conventions. NOT full MCP JSON-RPC 2.0 compliance in v1 (that requires Streamable HTTP transport with SSE, which is overkill for the initial integration).

**v1 is REST-style:**
- `POST /api/mcp/tools` — returns available tools filtered by the authenticated user's capabilities
- `POST /api/mcp/call` — executes a tool (for external MCP clients only — the co-worker panel uses the proposal/approve flow instead)

**Future:** Full MCP JSON-RPC 2.0 compliance (JSON-RPC envelope with `method: "tools/list"`, `method: "tools/call"`) as a follow-up when connecting external MCP clients like Claude Code becomes a priority.

**Auth for browser requests:** Existing Auth.js session (JWT cookie).

**Auth for external MCP clients (Claude Code, Cursor):** New `ApiToken` model — a simple table of `token` (hashed), `userId`, `name`, `expiresAt`. The endpoint checks the `Authorization: Bearer <token>` header and resolves to a user context. Token management via `/admin` or `/platform`. This is a new schema addition for this epic.

**External clients skip the proposal flow** — they're already human-operated. When Claude Code calls `create_backlog_item`, it executes immediately (the human is the one typing in Claude Code). The proposal/approve flow is only for the AI co-worker panel where the agent acts autonomously.

### Tool Definitions

`apps/web/lib/mcp-tools.ts` — tool definitions following MCP schema + execution handlers.

**5 tools for v1:**

| Tool | Required Capability | Parameters |
|------|-------------------|-----------|
| `create_backlog_item` | `manage_backlog` | title (required), type (portfolio/product, required), status?, body?, epicId? |
| `update_backlog_item` | `manage_backlog` | itemId (required), title?, status?, priority?, body? |
| `create_digital_product` | `manage_backlog` | name (required), productId (required), lifecycleStage?, portfolioSlug? |
| `update_lifecycle` | `manage_backlog` | productId (required), lifecycleStage?, lifecycleStatus? |
| `report_quality_issue` | null (anyone) | type (required), title (required), description?, severity? |

Each tool definition includes:
- `name` — tool identifier
- `description` — human-readable, included in LLM system prompt
- `inputSchema` — JSON Schema for parameters
- `requiredCapability` — `CapabilityKey | null` for filtering
- `handler(params, userId)` — async function that executes the action using existing server actions

**Capability filtering:** `getAvailableTools(userContext)` returns only tools the user has permission to execute. The LLM only sees tools it's allowed to propose.

---

## 3. LLM Tool-Use Integration

### callProvider Extension

`apps/web/lib/ai-inference.ts` — `callProvider` gains an optional `tools` parameter.

When tools are provided, the request body includes them in the provider's native format:
- **OpenAI-compatible (including Ollama):** `tools` array with `type: "function"` and `function: { name, description, parameters }`
- **Anthropic:** `tools` array with `name`, `description`, `input_schema`
- **Gemini:** `tools: [{ functionDeclarations: [...] }]` (array of tool objects wrapping function declarations)

The response parser checks for `tool_calls` in the LLM response:
- **OpenAI-compatible:** `choices[0].message.tool_calls[]`
- **Anthropic:** `content[].type === "tool_use"`
- **Gemini:** `candidates[0].content.parts[].functionCall`

Returns extended `InferenceResult`:
```typescript
type InferenceResult = {
  content: string;
  inputTokens: number;
  outputTokens: number;
  inferenceMs: number;
  toolCalls?: Array<{
    name: string;
    arguments: Record<string, unknown>;
  }>;
};
```

### callWithFailover Extension

`callWithFailover` in `ai-provider-priority.ts` gains an optional `tools` parameter that is threaded through to each `callProvider` retry attempt. The `FailoverResult` type (which extends `InferenceResult`) also carries `toolCalls`.

**Updated signature:**
```typescript
export async function callWithFailover(
  messages: ChatMessage[],
  systemPrompt: string,
  options?: { tools?: ToolDefinition[] },
): Promise<FailoverResult>
```

The existing `sensitivity` parameter (if present) is folded into the options object. This is a non-breaking change — existing callers that pass no third argument continue to work.

### sendMessage Changes

In `apps/web/lib/actions/agent-coworker.ts`, `sendMessage` is updated:

1. Get available tools via `getAvailableTools(userContext)`
2. Convert MCP tool definitions to the provider's native tool format
3. Include in `callWithFailover(messages, systemPrompt, { tools })`
4. If response has `toolCalls`:
   - For each tool call: create an `AgentActionProposal` (status: `proposed`)
   - Create an assistant message that describes what the agent wants to do
   - Return the message with proposal data attached
5. If response has no tool calls: normal text conversation

### Model Filtering

Add `supportsToolUse` field to `ModelProfile` schema (Boolean, **default false** — safe default). The provider priority system filters out models with `supportsToolUse: false` when selecting for agent conversations that need tool-use. The profiling step must run to set this to `true` for capable models. Models that haven't been profiled won't be used for tool-use conversations until profiling confirms their capability.

---

## 4. Proposal Card UX

### AgentMessageBubble Extension

When a message has an associated proposal, `AgentMessageBubble` renders a **proposal card** instead of plain text:

**Proposed state:**
- Header: action type label (e.g., "Create Backlog Item")
- Body: key parameters as labeled fields
- Footer: **Approve** (green button) and **Reject** (red button)

**Approved state:**
- Green check icon + "Approved by [role] at [time]"
- If executed: "Created [entity ID]" with result summary
- If failed: error message in red

**Rejected state:**
- Red X icon + "Rejected by [role] at [time]"

### Data Flow

The serialized message (`AgentMessageRow`) gains an optional `proposal` field:
```typescript
type AgentMessageRow = {
  // ... existing fields
  proposal?: {
    proposalId: string;
    actionType: string;
    parameters: Record<string, unknown>;
    status: string;
    resultEntityId?: string;
    resultError?: string;
  };
};
```

The `serializeMessage` function in `agent-coworker-data.ts` joins proposals onto messages when loading thread history.

---

## 5. Approval Server Actions

`apps/web/lib/actions/proposals.ts`:

### `approveProposal(proposalId)`

1. Auth check — user must have the tool's `requiredCapability`. For tools with `requiredCapability: null` (e.g., `report_quality_issue`), any authenticated user can approve.
2. Verify proposal status is `proposed` (can't approve twice)
3. In a single Prisma transaction: update status to `approved`, set `decidedAt`/`decidedById`, then execute the tool handler
4. On success: update status to `executed`, set `executedAt`, `resultEntityId`
5. On failure: update status to `failed`, set `resultError`. Also insert a system message in the agent thread notifying the user: "Action failed: [error]"
6. Write to `AuthorizationDecisionLog`: `decisionId` = `DEC-${crypto.randomUUID()}`, decision `allow`, actionKey = tool name, objectRef = proposalId, actorRef = userId
7. Return updated proposal

**Atomicity note:** Steps 3-4 use a Prisma `$transaction` to ensure the proposal never gets stuck in `approved` state without execution. If the handler throws, the transaction rolls back to `proposed` and the error is recorded via step 5 outside the transaction.

**Same-user constraint (v1):** In v1, only the thread owner can see and approve proposals (the `AgentThread` has `@@unique([userId, contextKey])`). This means the proposer and approver are implicitly the same user. Cross-user approval (e.g., a manager approving an agent's proposal for a subordinate) is a future enhancement.

### `rejectProposal(proposalId, reason?)`

1. Auth check — same rules as approval
2. Update status to `rejected`, set `decidedAt`, `decidedById`
3. Write to `AuthorizationDecisionLog`: `decisionId` = `DEC-${crypto.randomUUID()}`, decision `deny`, rationale = reason
4. Return updated proposal

---

## 6. Audit Trail

Every approval/rejection writes to the existing `AuthorizationDecisionLog` model:

| Field | Value |
|-------|-------|
| `actionKey` | Tool name (e.g., `create_backlog_item`) |
| `objectRef` | `proposalId` (AP-XXXXX) |
| `actorType` | `"user"` |
| `actorRef` | userId of the approver |
| `decision` | `"allow"` or `"deny"` |
| `rationale` | JSON with proposal parameters + reason |

This satisfies the regulated industry requirement: every agent action has a traceable chain from user request → agent proposal → human decision → execution → result.

---

## 7. Files Affected

### New Files
| File | Responsibility |
|------|---------------|
| `packages/db/prisma/migrations/<ts>_agent_action_proposal/migration.sql` | AgentActionProposal table |
| `apps/web/app/api/mcp/route.ts` | MCP server endpoint (tools/list, tools/call) |
| `apps/web/lib/mcp-tools.ts` | Tool definitions, capability filtering, execution handlers |
| `apps/web/lib/mcp-tools.test.ts` | Tool definition tests |
| `apps/web/lib/actions/proposals.ts` | approveProposal, rejectProposal server actions |

### Modified Files
| File | Change |
|------|--------|
| `packages/db/prisma/schema.prisma` | AgentActionProposal model + ApiToken model + reverse relations on AgentThread, AgentMessage, User + supportsToolUse on ModelProfile |
| `apps/web/lib/ai-inference.ts` | callProvider gains optional `tools` param, response parser handles `tool_calls` |
| `apps/web/lib/agent-coworker-types.ts` | AgentMessageRow gains optional `proposal` field |
| `apps/web/lib/agent-coworker-data.ts` | serializeMessage joins proposals onto messages |
| `apps/web/lib/actions/agent-coworker.ts` | sendMessage includes tools, parses tool_calls into proposals |
| `apps/web/components/agent/AgentMessageBubble.tsx` | Proposal card rendering with approve/reject |

---

## 8. Testing Strategy

- **Unit tests for MCP tool definitions**: Each tool has valid JSON Schema, required fields are required, capability filtering works
- **Unit tests for tool-call parsing**: Mock LLM responses with tool_calls for OpenAI-compatible format, verify parsing into structured array
- **Unit tests for approval flow**: Approve → executed, reject → rejected, double-approve → error, unauthorized → error
- **Unit tests for audit logging**: Every approval/rejection writes AuthorizationDecisionLog
- **Integration test**: sendMessage with tool-capable model → proposal created → approve → entity created
- **Visual verification**: Proposal cards render correctly in all states (proposed, approved, rejected, executed, failed)

---

## 9. Not in Scope

- **MCP client** (connecting to external servers like GitHub, Jira) — separate epic
- **Auto-configuration for Claude Code** — EP-SELF-DEV-001
- **EA element tools** — more complex, needs canvas context. Add after v1 is validated.
- **Batch proposals** — agent proposes multiple actions at once. v1 is one proposal per message.
- **Proposal editing** — user modifies parameters before approving. v1 is approve/reject only.
