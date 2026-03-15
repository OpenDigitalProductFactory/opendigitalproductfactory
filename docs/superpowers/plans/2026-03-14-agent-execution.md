# EP-AGENT-EXEC-001: Agent Task Execution — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agents propose actions via LLM tool-use, humans approve in the chat, proposals execute existing server actions, and every decision is audit-logged via AuthorizationDecisionLog.

**Architecture:** New `AgentActionProposal` + `ApiToken` Prisma models. MCP-style REST endpoint exposes platform tools. `callProvider` extended with `tools` parameter. `sendMessage` parses tool_calls into proposals. Proposal cards in chat UX with approve/reject. Approval triggers existing server actions in a Prisma transaction.

**Tech Stack:** Next.js 14, Prisma 5, TypeScript (strict), React 18, OpenAI-compatible tool-use API.

**Spec:** `docs/superpowers/specs/2026-03-14-agent-execution-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `packages/db/prisma/migrations/<ts>_agent_action_proposal/migration.sql` | AgentActionProposal + ApiToken tables |
| `apps/web/lib/mcp-tools.ts` | Tool definitions (5 tools), capability filtering, execution handlers |
| `apps/web/lib/mcp-tools.test.ts` | Tool definition + filtering tests |
| `apps/web/app/api/mcp/tools/route.ts` | MCP tools/list endpoint |
| `apps/web/app/api/mcp/call/route.ts` | MCP tools/call endpoint (external clients) |
| `apps/web/lib/actions/proposals.ts` | approveProposal, rejectProposal server actions |

### Modified Files
| File | Change |
|------|--------|
| `packages/db/prisma/schema.prisma` | AgentActionProposal + ApiToken models, reverse relations, supportsToolUse |
| `apps/web/lib/ai-inference.ts` | callProvider gains optional tools parameter + tool_calls parsing |
| `apps/web/lib/ai-provider-priority.ts` | callWithFailover gains options object with tools |
| `apps/web/lib/agent-coworker-types.ts` | AgentMessageRow gains optional proposal field |
| `apps/web/lib/agent-coworker-data.ts` | serializeMessage joins proposals |
| `apps/web/lib/actions/agent-coworker.ts` | sendMessage includes tools, parses tool_calls |
| `apps/web/components/agent/AgentMessageBubble.tsx` | Proposal card rendering |

---

## Chunk 1: Schema + MCP Tools

### Task 1: Prisma Schema Migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add AgentActionProposal and ApiToken models**

Add before the Platform Configuration section:

```prisma
// ─── Agent Action Proposals ──────────────────────────────────────────────────

model AgentActionProposal {
  id             String       @id @default(cuid())
  proposalId     String       @unique
  threadId       String
  thread         AgentThread  @relation(fields: [threadId], references: [id])
  messageId      String       @unique
  message        AgentMessage @relation(fields: [messageId], references: [id])
  agentId        String
  actionType     String
  parameters     Json
  status         String       @default("proposed")
  proposedAt     DateTime     @default(now())
  decidedAt      DateTime?
  decidedById    String?
  decidedBy      User?        @relation("ProposalDecisions", fields: [decidedById], references: [id])
  executedAt     DateTime?
  resultEntityId String?
  resultError    String?      @db.Text

  @@index([threadId])
  @@index([status])
}

model ApiToken {
  id        String    @id @default(cuid())
  token     String    @unique
  userId    String
  user      User      @relation(fields: [userId], references: [id])
  name      String
  expiresAt DateTime?
  createdAt DateTime  @default(now())
}
```

- [ ] **Step 2: Add reverse relations**

On `AgentThread`, add: `proposals AgentActionProposal[]`
On `AgentMessage`, add: `proposal AgentActionProposal?`
On `User`, add: `approvedProposals AgentActionProposal[] @relation("ProposalDecisions")` and `apiTokens ApiToken[]`

On `ModelProfile`, add: `supportsToolUse Boolean @default(false)`

- [ ] **Step 3: Generate and apply migration**

```bash
cd d:/OpenDigitalProductFactory && pnpm --filter @dpf/db exec npx prisma generate
cd d:/OpenDigitalProductFactory && pnpm --filter @dpf/db exec npx prisma migrate dev --name agent_action_proposal
```

If migrate dev fails, apply manually and resolve.

- [ ] **Step 4: Commit**

```bash
cd d:/OpenDigitalProductFactory && git add packages/db/prisma/ && git commit -m "feat(db): add AgentActionProposal, ApiToken, supportsToolUse"
```

---

### Task 2: MCP Tool Definitions

**Files:**
- Create: `apps/web/lib/mcp-tools.ts`
- Create: `apps/web/lib/mcp-tools.test.ts`

- [ ] **Step 1: Create tool definitions module**

Create `apps/web/lib/mcp-tools.ts`:

```typescript
import type { CapabilityKey } from "@/lib/permissions";
import { can, type UserContext } from "@/lib/permissions";
import { prisma } from "@dpf/db";
import * as crypto from "crypto";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  requiredCapability: CapabilityKey | null;
};

export type ToolResult = {
  success: boolean;
  entityId?: string;
  message: string;
  error?: string;
};

// ─── Tool Registry ───────────────────────────────────────────────────────────

export const PLATFORM_TOOLS: ToolDefinition[] = [
  {
    name: "create_backlog_item",
    description: "Create a new backlog item in the ops backlog",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Item title" },
        type: { type: "string", enum: ["portfolio", "product"], description: "Item type" },
        status: { type: "string", enum: ["open", "in-progress"], description: "Initial status" },
        body: { type: "string", description: "Detailed description" },
        epicId: { type: "string", description: "Epic ID to link to (optional)" },
      },
      required: ["title", "type"],
    },
    requiredCapability: "manage_backlog",
  },
  {
    name: "update_backlog_item",
    description: "Update an existing backlog item",
    inputSchema: {
      type: "object",
      properties: {
        itemId: { type: "string", description: "The item ID (e.g., BI-PORT-001)" },
        title: { type: "string", description: "New title" },
        status: { type: "string", enum: ["open", "in-progress", "done", "deferred"] },
        priority: { type: "number", description: "Priority number" },
        body: { type: "string", description: "Updated description" },
      },
      required: ["itemId"],
    },
    requiredCapability: "manage_backlog",
  },
  {
    name: "create_digital_product",
    description: "Register a new digital product in the inventory",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Product name" },
        productId: { type: "string", description: "Unique product identifier" },
        lifecycleStage: { type: "string", enum: ["plan", "design", "build", "production", "retirement"] },
        portfolioSlug: { type: "string", description: "Portfolio slug to assign to" },
      },
      required: ["name", "productId"],
    },
    requiredCapability: "manage_backlog",
  },
  {
    name: "update_lifecycle",
    description: "Update a digital product's lifecycle stage and status",
    inputSchema: {
      type: "object",
      properties: {
        productId: { type: "string", description: "Product identifier" },
        lifecycleStage: { type: "string", enum: ["plan", "design", "build", "production", "retirement"] },
        lifecycleStatus: { type: "string", enum: ["draft", "active", "inactive"] },
      },
      required: ["productId"],
    },
    requiredCapability: "manage_backlog",
  },
  {
    name: "report_quality_issue",
    description: "Report a bug, suggestion, or question about the platform",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["runtime_error", "user_report", "feedback"], description: "Issue type" },
        title: { type: "string", description: "Short summary" },
        description: { type: "string", description: "Detailed description" },
        severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
      },
      required: ["type", "title"],
    },
    requiredCapability: null,
  },
];

// ─── Capability Filtering ────────────────────────────────────────────────────

export function getAvailableTools(userContext: UserContext): ToolDefinition[] {
  return PLATFORM_TOOLS.filter(
    (t) => t.requiredCapability === null || can(userContext, t.requiredCapability),
  );
}

// ─── Tool Execution ──────────────────────────────────────────────────────────

export async function executeTool(
  toolName: string,
  params: Record<string, unknown>,
  userId: string,
): Promise<ToolResult> {
  switch (toolName) {
    case "create_backlog_item": {
      const itemId = `BI-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      const item = await prisma.backlogItem.create({
        data: {
          itemId,
          title: String(params.title ?? "Untitled"),
          type: String(params.type ?? "product"),
          status: String(params.status ?? "open"),
          body: params.body ? String(params.body) : null,
          ...(typeof params.epicId === "string" ? { epicId: params.epicId } : {}),
        },
      });
      return { success: true, entityId: item.itemId, message: `Created backlog item ${item.itemId}` };
    }

    case "update_backlog_item": {
      const existing = await prisma.backlogItem.findUnique({ where: { itemId: String(params.itemId) } });
      if (!existing) return { success: false, error: "Item not found", message: `Item ${params.itemId} not found` };
      const data: Record<string, unknown> = {};
      if (typeof params.title === "string") data.title = params.title;
      if (typeof params.status === "string") data.status = params.status;
      if (typeof params.priority === "number") data.priority = params.priority;
      if (typeof params.body === "string") data.body = params.body;
      await prisma.backlogItem.update({ where: { itemId: String(params.itemId) }, data });
      return { success: true, entityId: String(params.itemId), message: `Updated ${params.itemId}` };
    }

    case "create_digital_product": {
      const product = await prisma.digitalProduct.create({
        data: {
          productId: String(params.productId),
          name: String(params.name),
          lifecycleStage: String(params.lifecycleStage ?? "plan"),
          lifecycleStatus: "draft",
        },
      });
      return { success: true, entityId: product.productId, message: `Created product ${product.productId}` };
    }

    case "update_lifecycle": {
      const prod = await prisma.digitalProduct.findUnique({ where: { productId: String(params.productId) } });
      if (!prod) return { success: false, error: "Product not found", message: `Product ${params.productId} not found` };
      const updates: Record<string, unknown> = {};
      if (typeof params.lifecycleStage === "string") updates.lifecycleStage = params.lifecycleStage;
      if (typeof params.lifecycleStatus === "string") updates.lifecycleStatus = params.lifecycleStatus;
      await prisma.digitalProduct.update({ where: { productId: String(params.productId) }, data: updates });
      return { success: true, entityId: String(params.productId), message: `Updated lifecycle for ${params.productId}` };
    }

    case "report_quality_issue": {
      const reportId = "PIR-" + Math.random().toString(36).substring(2, 7).toUpperCase();
      await prisma.platformIssueReport.create({
        data: {
          reportId,
          type: String(params.type ?? "user_report"),
          title: String(params.title ?? "Untitled"),
          description: params.description ? String(params.description) : null,
          severity: String(params.severity ?? "medium"),
          reportedById: userId,
          source: "ai_assisted",
        },
      });
      return { success: true, entityId: reportId, message: `Filed report ${reportId}` };
    }

    default:
      return { success: false, error: "Unknown tool", message: `Tool ${toolName} not found` };
  }
}

// ─── Convert to provider format ──────────────────────────────────────────────

export function toolsToOpenAIFormat(tools: ToolDefinition[]): Array<Record<string, unknown>> {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));
}
```

- [ ] **Step 2: Create tests**

Create `apps/web/lib/mcp-tools.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { PLATFORM_TOOLS, getAvailableTools, toolsToOpenAIFormat } from "./mcp-tools";

describe("PLATFORM_TOOLS", () => {
  it("has 5 tools", () => {
    expect(PLATFORM_TOOLS).toHaveLength(5);
  });

  it("every tool has name, description, inputSchema, requiredCapability", () => {
    for (const tool of PLATFORM_TOOLS) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeDefined();
      expect("requiredCapability" in tool).toBe(true);
    }
  });
});

describe("getAvailableTools", () => {
  it("superuser sees all tools", () => {
    const tools = getAvailableTools({ platformRole: "HR-000", isSuperuser: true });
    expect(tools).toHaveLength(5);
  });

  it("null role sees only null-capability tools", () => {
    const tools = getAvailableTools({ platformRole: null, isSuperuser: false });
    const names = tools.map((t) => t.name);
    expect(names).toContain("report_quality_issue");
    expect(names).not.toContain("create_backlog_item");
  });

  it("HR-500 sees manage_backlog tools", () => {
    const tools = getAvailableTools({ platformRole: "HR-500", isSuperuser: false });
    const names = tools.map((t) => t.name);
    expect(names).toContain("create_backlog_item");
    expect(names).toContain("report_quality_issue");
  });
});

describe("toolsToOpenAIFormat", () => {
  it("converts to OpenAI function format", () => {
    const converted = toolsToOpenAIFormat(PLATFORM_TOOLS.slice(0, 1));
    expect(converted[0]).toHaveProperty("type", "function");
    expect(converted[0]).toHaveProperty("function.name", "create_backlog_item");
    expect(converted[0]).toHaveProperty("function.parameters");
  });
});
```

- [ ] **Step 3: Run tests**

```bash
cd d:/OpenDigitalProductFactory && pnpm --filter web exec vitest run apps/web/lib/mcp-tools.test.ts
```

- [ ] **Step 4: Commit**

```bash
cd d:/OpenDigitalProductFactory && git add apps/web/lib/mcp-tools.ts apps/web/lib/mcp-tools.test.ts && git commit -m "feat: add MCP tool definitions with capability filtering and execution handlers"
```

---

## Chunk 2: callProvider + callWithFailover Tool-Use Extension

### Task 3: Extend callProvider with tools parameter

**Files:**
- Modify: `apps/web/lib/ai-inference.ts`

- [ ] **Step 1: Update callProvider signature and request building**

In `apps/web/lib/ai-inference.ts`, update `callProvider` to accept optional tools:

Change the signature from:
```typescript
export async function callProvider(
  providerId: string,
  modelId: string,
  messages: ChatMessage[],
  systemPrompt: string,
): Promise<InferenceResult>
```
to:
```typescript
export async function callProvider(
  providerId: string,
  modelId: string,
  messages: ChatMessage[],
  systemPrompt: string,
  tools?: Array<Record<string, unknown>>,
): Promise<InferenceResult>
```

Update the `InferenceResult` type to include optional `toolCalls`:
```typescript
export type InferenceResult = {
  content: string;
  inputTokens: number;
  outputTokens: number;
  inferenceMs: number;
  toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>;
};
```

In the OpenAI-compatible branch, add tools to the body if provided:
```typescript
    body = { model: modelId, messages: allMessages, max_tokens: 4096 };
    if (tools && tools.length > 0) {
      body.tools = tools;
    }
```

Update the `extractText` for OpenAI-compatible to also capture tool_calls:
```typescript
    extractText = (d) => {
      const msg = (d.choices as Array<{ message?: { content?: string; reasoning?: string; tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> } }>)?.[0]?.message;
      return msg?.content || msg?.reasoning || "";
    };
```

After the response is parsed, extract tool_calls if present:
```typescript
  // Extract tool calls if present
  let toolCalls: InferenceResult["toolCalls"];
  const rawMsg = (data.choices as Array<{ message?: { tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> } }>)?.[0]?.message;
  if (rawMsg?.tool_calls && rawMsg.tool_calls.length > 0) {
    toolCalls = rawMsg.tool_calls
      .filter((tc) => tc.function?.name)
      .map((tc) => ({
        name: tc.function!.name!,
        arguments: tc.function?.arguments ? JSON.parse(tc.function.arguments) as Record<string, unknown> : {},
      }));
  }

  return {
    content: extractText(data),
    inputTokens: readUsageNumber("input_tokens", "prompt_tokens"),
    outputTokens: readUsageNumber("output_tokens", "completion_tokens"),
    inferenceMs,
    toolCalls,
  };
```

- [ ] **Step 2: Commit**

```bash
cd d:/OpenDigitalProductFactory && git add apps/web/lib/ai-inference.ts && git commit -m "feat: extend callProvider with tools parameter and tool_calls parsing"
```

---

### Task 4: Extend callWithFailover with tools

**Files:**
- Modify: `apps/web/lib/ai-provider-priority.ts`

- [ ] **Step 1: Update callWithFailover to accept and thread tools**

Update the `FailoverResult` type to include toolCalls:
```typescript
export type FailoverResult = InferenceResult & {
  providerId: string;
  modelId: string;
  downgraded: boolean;
  downgradeMessage: string | null;
};
```
(InferenceResult already has toolCalls — it passes through naturally.)

Update `callWithFailover` signature to accept options:
```typescript
export async function callWithFailover(
  messages: ChatMessage[],
  systemPrompt: string,
  options?: { tools?: Array<Record<string, unknown>> },
): Promise<FailoverResult>
```

In the loop where `callProvider` is called, pass the tools through:
```typescript
      const result = await callProvider(entry.providerId, entry.modelId, messages, systemPrompt, options?.tools);
```

- [ ] **Step 2: Update any existing callers**

In `apps/web/lib/actions/agent-coworker.ts`, the existing `callWithFailover` call should continue to work (no tools = no change). Verify with type check.

- [ ] **Step 3: Commit**

```bash
cd d:/OpenDigitalProductFactory && git add apps/web/lib/ai-provider-priority.ts && git commit -m "feat: extend callWithFailover with optional tools parameter"
```

---

## Chunk 3: sendMessage Integration + Proposal Server Actions

### Task 5: Wire tool-use into sendMessage

**Files:**
- Modify: `apps/web/lib/actions/agent-coworker.ts`
- Modify: `apps/web/lib/agent-coworker-types.ts`
- Modify: `apps/web/lib/agent-coworker-data.ts`

- [ ] **Step 1: Add proposal field to AgentMessageRow**

In `apps/web/lib/agent-coworker-types.ts`, add to `AgentMessageRow`:
```typescript
export type AgentMessageRow = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  agentId: string | null;
  routeContext: string | null;
  createdAt: string;
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

- [ ] **Step 2: Update serializeMessage to join proposals**

In `apps/web/lib/agent-coworker-data.ts`, update `serializeMessage` to accept an optional proposal and include it:

```typescript
function serializeMessage(m: {
  id: string;
  role: string;
  content: string;
  agentId: string | null;
  routeContext: string | null;
  createdAt: Date;
}, proposal?: { proposalId: string; actionType: string; parameters: unknown; status: string; resultEntityId: string | null; resultError: string | null } | null): AgentMessageRow {
  const row: AgentMessageRow = {
    id: m.id,
    role: (["user", "assistant", "system"] as const).includes(m.role as AgentMessageRow["role"])
      ? (m.role as AgentMessageRow["role"])
      : "system",
    content: m.content,
    agentId: m.agentId,
    routeContext: m.routeContext,
    createdAt: m.createdAt.toISOString(),
  };
  if (proposal) {
    row.proposal = {
      proposalId: proposal.proposalId,
      actionType: proposal.actionType,
      parameters: proposal.parameters as Record<string, unknown>,
      status: proposal.status,
      ...(proposal.resultEntityId ? { resultEntityId: proposal.resultEntityId } : {}),
      ...(proposal.resultError ? { resultError: proposal.resultError } : {}),
    };
  }
  return row;
}
```

- [ ] **Step 3: Update sendMessage to include tools and parse tool_calls**

In `apps/web/lib/actions/agent-coworker.ts`:

Add imports:
```typescript
import { getAvailableTools, toolsToOpenAIFormat } from "@/lib/mcp-tools";
```

In `sendMessage`, after resolving the agent and building the prompt, get available tools:
```typescript
  // Get available tools for this user
  const availableTools = getAvailableTools({
    platformRole: user.platformRole,
    isSuperuser: user.isSuperuser,
  });
  const toolsForProvider = availableTools.length > 0 ? toolsToOpenAIFormat(availableTools) : undefined;
```

Pass tools to `callWithFailover`:
```typescript
    const result = await callWithFailover(chatHistory, populatedPrompt, { tools: toolsForProvider });
```

After getting the result, check for tool_calls:
```typescript
    // Handle tool calls — create proposals
    if (result.toolCalls && result.toolCalls.length > 0) {
      const tc = result.toolCalls[0]!; // v1: one proposal per message
      const proposalId = "AP-" + Math.random().toString(36).substring(2, 7).toUpperCase();

      // Create the agent message first
      const agentMsg = await prisma.agentMessage.create({
        data: {
          threadId: input.threadId,
          role: "assistant",
          content: result.content || `I'd like to ${tc.name.replace(/_/g, " ")} with the following details.`,
          agentId: agent.agentId,
          routeContext: input.routeContext,
          providerId: result.providerId,
        },
        select: { id: true, role: true, content: true, agentId: true, routeContext: true, createdAt: true },
      });

      // Create the proposal linked to the message
      const proposal = await prisma.agentActionProposal.create({
        data: {
          proposalId,
          threadId: input.threadId,
          messageId: agentMsg.id,
          agentId: agent.agentId,
          actionType: tc.name,
          parameters: tc.arguments,
        },
      });

      return {
        userMessage: serializeMessage(userMsg),
        agentMessage: serializeMessage(agentMsg, proposal),
      };
    }
```

If no tool calls, proceed with normal text response (existing flow).

- [ ] **Step 4: Verify types and run tests**

```bash
cd d:/OpenDigitalProductFactory && pnpm --filter web exec tsc --noEmit
cd d:/OpenDigitalProductFactory && pnpm test
```

- [ ] **Step 5: Commit**

```bash
cd d:/OpenDigitalProductFactory && git add apps/web/lib/agent-coworker-types.ts apps/web/lib/agent-coworker-data.ts apps/web/lib/actions/agent-coworker.ts && git commit -m "feat: wire tool-use into sendMessage, create proposals from tool_calls"
```

---

### Task 6: Approval and Rejection Server Actions

**Files:**
- Create: `apps/web/lib/actions/proposals.ts`

- [ ] **Step 1: Create the proposals server action file**

Create `apps/web/lib/actions/proposals.ts`:

```typescript
"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@dpf/db";
import { can } from "@/lib/permissions";
import { PLATFORM_TOOLS, executeTool } from "@/lib/mcp-tools";
import * as crypto from "crypto";

async function requireAuthUser() {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) throw new Error("Unauthorized");
  return user;
}

export async function approveProposal(
  proposalId: string,
): Promise<{ success: boolean; resultEntityId?: string; error?: string }> {
  const user = await requireAuthUser();

  const proposal = await prisma.agentActionProposal.findUnique({
    where: { proposalId },
  });
  if (!proposal) return { success: false, error: "Proposal not found" };
  if (proposal.status !== "proposed") return { success: false, error: "Proposal already decided" };

  // Check capability
  const tool = PLATFORM_TOOLS.find((t) => t.name === proposal.actionType);
  if (tool?.requiredCapability && !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, tool.requiredCapability)) {
    return { success: false, error: "Insufficient permissions" };
  }

  // Execute in transaction
  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.agentActionProposal.update({
        where: { proposalId },
        data: { status: "approved", decidedAt: new Date(), decidedById: user.id },
      });

      const toolResult = await executeTool(
        proposal.actionType,
        proposal.parameters as Record<string, unknown>,
        user.id,
      );

      if (toolResult.success) {
        await tx.agentActionProposal.update({
          where: { proposalId },
          data: { status: "executed", executedAt: new Date(), resultEntityId: toolResult.entityId },
        });
      } else {
        await tx.agentActionProposal.update({
          where: { proposalId },
          data: { status: "failed", resultError: toolResult.error },
        });
      }

      return toolResult;
    });

    // Audit log
    await prisma.authorizationDecisionLog.create({
      data: {
        decisionId: `DEC-${crypto.randomUUID()}`,
        actionKey: proposal.actionType,
        objectRef: proposalId,
        actorType: "user",
        actorRef: user.id,
        decision: "allow",
        rationale: { proposalId, parameters: proposal.parameters, result: result.message },
      },
    });

    return { success: result.success, resultEntityId: result.entityId, error: result.error };
  } catch (e) {
    // Transaction failed — proposal stays as "proposed"
    await prisma.agentActionProposal.update({
      where: { proposalId },
      data: { status: "failed", resultError: e instanceof Error ? e.message : "Execution failed" },
    });
    return { success: false, error: e instanceof Error ? e.message : "Execution failed" };
  }
}

export async function rejectProposal(
  proposalId: string,
  reason?: string,
): Promise<{ success: boolean; error?: string }> {
  const user = await requireAuthUser();

  const proposal = await prisma.agentActionProposal.findUnique({
    where: { proposalId },
  });
  if (!proposal) return { success: false, error: "Proposal not found" };
  if (proposal.status !== "proposed") return { success: false, error: "Proposal already decided" };

  await prisma.agentActionProposal.update({
    where: { proposalId },
    data: { status: "rejected", decidedAt: new Date(), decidedById: user.id },
  });

  await prisma.authorizationDecisionLog.create({
    data: {
      decisionId: `DEC-${crypto.randomUUID()}`,
      actionKey: proposal.actionType,
      objectRef: proposalId,
      actorType: "user",
      actorRef: user.id,
      decision: "deny",
      rationale: { proposalId, reason: reason ?? "User rejected" },
    },
  });

  return { success: true };
}
```

- [ ] **Step 2: Commit**

```bash
cd d:/OpenDigitalProductFactory && git add apps/web/lib/actions/proposals.ts && git commit -m "feat: add approveProposal and rejectProposal server actions with audit trail"
```

---

## Chunk 4: Proposal Card UX + MCP Endpoints

### Task 7: Proposal Card in AgentMessageBubble

**Files:**
- Modify: `apps/web/components/agent/AgentMessageBubble.tsx`

- [ ] **Step 1: Add proposal card rendering**

In `AgentMessageBubble.tsx`, after the existing message rendering, add a proposal card when `message.proposal` exists:

```typescript
  // After the existing bubble div, add:
  if (message.proposal) {
    const p = message.proposal;
    const isPending = p.status === "proposed";
    const isApproved = p.status === "executed";
    const isRejected = p.status === "rejected";
    const isFailed = p.status === "failed";

    return (
      <div style={{ marginBottom: 12 }}>
        {/* Show the text content first if any */}
        {message.content && (
          <div style={{
            padding: "8px 12px",
            borderRadius: "12px 12px 12px 2px",
            fontSize: 13,
            lineHeight: 1.4,
            background: "rgba(22, 22, 37, 0.8)",
            color: "#e0e0ff",
            marginBottom: 6,
          }}>
            {message.content}
          </div>
        )}
        {/* Proposal card */}
        <div style={{
          background: "rgba(26, 26, 46, 0.9)",
          border: `1px solid ${isApproved ? "rgba(74,222,128,0.4)" : isRejected || isFailed ? "rgba(239,68,68,0.4)" : "rgba(124,140,248,0.4)"}`,
          borderRadius: 10,
          padding: "10px 14px",
          fontSize: 12,
        }}>
          <div style={{ fontWeight: 600, color: "#e0e0ff", marginBottom: 6 }}>
            {p.actionType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
          </div>
          <div style={{ color: "var(--dpf-muted)", fontSize: 11, marginBottom: 8 }}>
            {Object.entries(p.parameters).map(([k, v]) => (
              <div key={k}><span style={{ color: "#8888a0" }}>{k}:</span> {String(v)}</div>
            ))}
          </div>
          {isPending && (
            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" onClick={() => handleApprove(p.proposalId)} style={{ flex: 1, background: "rgba(74,222,128,0.2)", border: "1px solid rgba(74,222,128,0.4)", borderRadius: 6, padding: "5px 10px", fontSize: 11, color: "#4ade80", cursor: "pointer" }}>
                Approve
              </button>
              <button type="button" onClick={() => handleReject(p.proposalId)} style={{ flex: 1, background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 6, padding: "5px 10px", fontSize: 11, color: "#ef4444", cursor: "pointer" }}>
                Reject
              </button>
            </div>
          )}
          {isApproved && <div style={{ color: "#4ade80", fontSize: 11 }}>✓ Approved{p.resultEntityId ? ` — Created ${p.resultEntityId}` : ""}</div>}
          {isRejected && <div style={{ color: "#ef4444", fontSize: 11 }}>✕ Rejected</div>}
          {isFailed && <div style={{ color: "#ef4444", fontSize: 11 }}>⚠ Failed: {p.resultError}</div>}
        </div>
      </div>
    );
  }
```

The `handleApprove` and `handleReject` need to be passed as props from the panel. Add to Props:
```typescript
type Props = {
  message: AgentMessageRow;
  showAgentLabel: boolean;
  agentName: string | null;
  onApprove?: (proposalId: string) => void;
  onReject?: (proposalId: string) => void;
};
```

Wire from `AgentCoworkerPanel` → `AgentMessageBubble` via the approve/reject server actions.

- [ ] **Step 2: Wire approve/reject in AgentCoworkerPanel**

In `AgentCoworkerPanel.tsx`, import the proposal actions:
```typescript
import { approveProposal, rejectProposal } from "@/lib/actions/proposals";
```

Add handlers:
```typescript
  async function handleApprove(proposalId: string) {
    const result = await approveProposal(proposalId);
    if (result.success) {
      // Update the proposal in local state
      setMessages((prev) => prev.map((m) =>
        m.proposal?.proposalId === proposalId
          ? { ...m, proposal: { ...m.proposal, status: "executed", resultEntityId: result.resultEntityId } }
          : m
      ));
    }
  }

  async function handleReject(proposalId: string) {
    const result = await rejectProposal(proposalId);
    if (result.success) {
      setMessages((prev) => prev.map((m) =>
        m.proposal?.proposalId === proposalId
          ? { ...m, proposal: { ...m.proposal, status: "rejected" } }
          : m
      ));
    }
  }
```

Pass to `AgentMessageBubble`:
```typescript
  <AgentMessageBubble
    key={msg.id}
    message={msg}
    showAgentLabel={showAgentLabel}
    agentName={...}
    onApprove={handleApprove}
    onReject={handleReject}
  />
```

- [ ] **Step 3: Verify types and run tests**

```bash
cd d:/OpenDigitalProductFactory && pnpm --filter web exec tsc --noEmit
cd d:/OpenDigitalProductFactory && pnpm test
```

- [ ] **Step 4: Commit**

```bash
cd d:/OpenDigitalProductFactory && git add apps/web/components/agent/AgentMessageBubble.tsx apps/web/components/agent/AgentCoworkerPanel.tsx && git commit -m "feat: add proposal card UX with approve/reject in agent chat"
```

---

### Task 8: MCP REST Endpoints

**Files:**
- Create: `apps/web/app/api/mcp/tools/route.ts`
- Create: `apps/web/app/api/mcp/call/route.ts`

- [ ] **Step 1: Create tools/list endpoint**

Create `apps/web/app/api/mcp/tools/route.ts`:

```typescript
import { auth } from "@/lib/auth";
import { getAvailableTools } from "@/lib/mcp-tools";

export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tools = getAvailableTools({
    platformRole: session.user.platformRole,
    isSuperuser: session.user.isSuperuser,
  });

  return Response.json({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  });
}
```

- [ ] **Step 2: Create tools/call endpoint**

Create `apps/web/app/api/mcp/call/route.ts`:

```typescript
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { PLATFORM_TOOLS, executeTool } from "@/lib/mcp-tools";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as { name?: string; arguments?: Record<string, unknown> };
  if (!body.name) {
    return Response.json({ error: "Missing tool name" }, { status: 400 });
  }

  const tool = PLATFORM_TOOLS.find((t) => t.name === body.name);
  if (!tool) {
    return Response.json({ error: `Unknown tool: ${body.name}` }, { status: 404 });
  }

  if (tool.requiredCapability && !can(
    { platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser },
    tool.requiredCapability,
  )) {
    return Response.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const result = await executeTool(body.name, body.arguments ?? {}, session.user.id);
  return Response.json(result);
}
```

- [ ] **Step 3: Commit**

```bash
cd d:/OpenDigitalProductFactory && git add apps/web/app/api/mcp/ && git commit -m "feat: add MCP REST endpoints (tools/list, tools/call)"
```

---

## Chunk 5: Verification

### Task 9: Final Verification

- [ ] **Step 1: Run all tests**

```bash
cd d:/OpenDigitalProductFactory && pnpm test
```

- [ ] **Step 2: Type check**

```bash
cd d:/OpenDigitalProductFactory && pnpm --filter web exec tsc --noEmit
```

- [ ] **Step 3: Manual verification**

1. Open the co-worker panel
2. Ask "Create a backlog item for testing the agent execution feature"
3. Agent should respond with a proposal card showing the action and parameters
4. Click Approve → item created, card shows green check + item ID
5. Ask "Report a quality issue about slow page load"
6. Agent proposes a quality report → approve → PIR-XXXXX created

- [ ] **Step 4: Test MCP endpoint**

```bash
curl -X POST http://localhost:3000/api/mcp/tools -H "Cookie: ..." | jq .
curl -X POST http://localhost:3000/api/mcp/call -H "Cookie: ..." -H "Content-Type: application/json" -d '{"name":"create_backlog_item","arguments":{"title":"Test item","type":"product"}}'
```
