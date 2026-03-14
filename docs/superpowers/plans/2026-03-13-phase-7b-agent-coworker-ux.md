# Phase 7B: AI Agent Co-worker UX — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a floating chat panel that provides route-aware, role-gated AI agent assistance on every screen, with canned responses and persistent conversation history.

**Architecture:** Prisma migration adds `agentId`/`routeContext` fields and indexes to existing `AgentMessage` model. Pure `agent-routing.ts` handles route→agent resolution with capability checks. Server actions manage thread CRUD and message persistence. A draggable client-side `AgentCoworkerPanel` renders in the shell layout, toggled via the existing Header "Agent" button through a `CustomEvent`.

**Tech Stack:** Next.js 14 App Router, Prisma 5, TypeScript (strict: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), Vitest, React 18 (`useTransition`, `useEffect`, `useRef`), `@xyflow/react` CSS variables.

**Spec:** `docs/superpowers/specs/2026-03-13-phase-7b-agent-coworker-ux-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `packages/db/prisma/migrations/<timestamp>_agent_coworker_fields/migration.sql` | Add `agentId`, `routeContext`, indexes to `AgentMessage`; default on `AgentThread.contextKey` |
| `apps/web/lib/agent-coworker-types.ts` | `AgentMessageRow`, `AgentInfo`, `RouteAgentEntry` types, `validateMessageInput` pure function |
| `apps/web/lib/agent-routing.ts` | `ROUTE_AGENT_MAP`, `AGENT_NAME_MAP`, `resolveAgentForRoute`, `generateCannedResponse` |
| `apps/web/lib/agent-routing.test.ts` | Unit tests for routing + canned responses |
| `apps/web/lib/agent-coworker-data.ts` | React cache fetcher: `getRecentMessages` |
| `apps/web/lib/actions/agent-coworker.ts` | Server actions: `getOrCreateThread`, `sendMessage`, `loadEarlierMessages`, `recordAgentTransition` |
| `apps/web/lib/actions/agent-coworker.test.ts` | Tests for server action validation logic |
| `apps/web/components/agent/AgentMessageBubble.tsx` | Single message renderer (user/assistant/system) |
| `apps/web/components/agent/AgentPanelHeader.tsx` | Drag handle, agent name, minimize/close buttons |
| `apps/web/components/agent/AgentMessageInput.tsx` | Text input with send, Enter-to-send, char limit |
| `apps/web/components/agent/AgentCoworkerPanel.tsx` | Main panel: drag, toggle, routing, message list |

### Modified Files
| File | Change |
|------|--------|
| `packages/db/prisma/schema.prisma` | Add `agentId String?`, `routeContext String?`, `@@index` to `AgentMessage`; add `@default("coworker")` to `AgentThread.contextKey` |
| `apps/web/lib/permissions.ts` | Export existing `UserContext` type (add `export` keyword) |
| `apps/web/components/shell/Header.tsx` | Add `onClick` to Agent button dispatching `CustomEvent("toggle-agent-panel")` |
| `apps/web/app/(shell)/layout.tsx` | Add `getOrCreateThread` + `getRecentMessages` calls; render `AgentCoworkerPanel` |

---

## Chunk 1: Schema Migration & Types

### Task 1: Prisma Schema Migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma:607-627`

- [ ] **Step 1: Update `AgentThread` model — add default to `contextKey`**

In `packages/db/prisma/schema.prisma`, find the `AgentThread` model (line 611) and change:
```prisma
  contextKey String
```
to:
```prisma
  contextKey String         @default("coworker")
```

- [ ] **Step 2: Update `AgentMessage` model — add fields and indexes**

In the same file, find the `AgentMessage` model (line 619). Add `agentId`, `routeContext`, and two indexes. The full model should become:
```prisma
model AgentMessage {
  id           String      @id @default(cuid())
  threadId     String
  thread       AgentThread @relation(fields: [threadId], references: [id], onDelete: Cascade)
  role         String      // user | assistant | system
  content      String
  tone         String?
  agentId      String?     // specialist agent that authored this response
  routeContext String?     // route pathname when message was sent
  createdAt    DateTime    @default(now())

  @@index([threadId])
  @@index([createdAt])
}
```

- [ ] **Step 3: Generate and apply migration**

Run:
```bash
cd d:/OpenDigitalProductFactory && pnpm db:generate
cd d:/OpenDigitalProductFactory && pnpm --filter @dpf/db exec npx prisma migrate dev --name agent_coworker_fields
```
Expected: Migration created successfully, Prisma client regenerated.

- [ ] **Step 4: Verify migration applied**

Run:
```bash
cd d:/OpenDigitalProductFactory && pnpm --filter @dpf/db exec npx prisma migrate status
```
Expected: All migrations applied, no pending.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat(db): add agentId, routeContext, indexes to AgentMessage schema"
```

---

### Task 2: Export `UserContext` from `permissions.ts`

**Files:**
- Modify: `apps/web/lib/permissions.ts:50`

- [ ] **Step 1: Add `export` to `UserContext` type**

In `apps/web/lib/permissions.ts`, line 50, change:
```typescript
type UserContext = {
```
to:
```typescript
export type UserContext = {
```

- [ ] **Step 2: Verify no type errors**

Run:
```bash
cd d:/OpenDigitalProductFactory && pnpm --filter web exec tsc --noEmit
```
Expected: No errors (existing usages are internal, export is additive).

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/permissions.ts
git commit -m "feat(permissions): export UserContext type for agent routing"
```

---

### Task 3: Shared Types — `agent-coworker-types.ts`

**Files:**
- Create: `apps/web/lib/agent-coworker-types.ts`

- [ ] **Step 1: Create the types file**

Create `apps/web/lib/agent-coworker-types.ts`:
```typescript
import type { CapabilityKey } from "@/lib/permissions";

/** Serialized message for client/server boundary. */
export type AgentMessageRow = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  agentId: string | null;
  routeContext: string | null;
  createdAt: string; // ISO string via .toISOString()
};

/** Resolved agent info returned by resolveAgentForRoute. */
export type AgentInfo = {
  agentId: string;
  agentName: string;
  agentDescription: string;
  canAssist: boolean;
};

/** Entry in the route-to-agent map. */
export type RouteAgentEntry = {
  agentId: string;
  agentName: string;
  agentDescription: string;
  capability: CapabilityKey | null;
};

/** Max message content length (chars). */
export const MAX_MESSAGE_LENGTH = 2000;

/** Validate message input (pure function, usable from tests and server actions). */
export function validateMessageInput(input: {
  content: string;
  routeContext: string;
}): string | null {
  const trimmed = input.content.trim();
  if (!trimmed) return "Message content cannot be empty";
  if (trimmed.length > MAX_MESSAGE_LENGTH) return `Message cannot exceed ${MAX_MESSAGE_LENGTH} characters`;
  if (!input.routeContext) return "Route context is required";
  return null;
}
```

- [ ] **Step 2: Verify no type errors**

Run:
```bash
cd d:/OpenDigitalProductFactory && pnpm --filter web exec tsc --noEmit
```
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/agent-coworker-types.ts
git commit -m "feat: add agent coworker shared types"
```

---

## Chunk 2: Agent Routing & Canned Responses (TDD)

### Task 4: Write Failing Tests for Agent Routing

**Files:**
- Create: `apps/web/lib/agent-routing.test.ts`

- [ ] **Step 1: Write the test file**

Create `apps/web/lib/agent-routing.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { resolveAgentForRoute, generateCannedResponse } from "./agent-routing";

describe("resolveAgentForRoute", () => {
  const superuser = { platformRole: "HR-000", isSuperuser: true };
  const opsUser = { platformRole: "HR-500", isSuperuser: false };
  const noRole = { platformRole: null, isSuperuser: false };

  it("returns portfolio-advisor for /portfolio path", () => {
    const result = resolveAgentForRoute("/portfolio", superuser);
    expect(result.agentId).toBe("portfolio-advisor");
    expect(result.canAssist).toBe(true);
  });

  it("returns ea-architect for /ea/views/123", () => {
    const result = resolveAgentForRoute("/ea/views/123", superuser);
    expect(result.agentId).toBe("ea-architect");
    expect(result.canAssist).toBe(true);
  });

  it("returns workspace-guide for unknown routes", () => {
    const result = resolveAgentForRoute("/unknown/path", superuser);
    expect(result.agentId).toBe("workspace-guide");
    expect(result.canAssist).toBe(true);
  });

  it("returns canAssist=false when user lacks capability", () => {
    // HR-500 has view_operations but not view_ea_modeler
    const result = resolveAgentForRoute("/ea", opsUser);
    expect(result.agentId).toBe("ea-architect");
    expect(result.canAssist).toBe(false);
  });

  it("returns canAssist=true for ungated routes (capability null)", () => {
    const result = resolveAgentForRoute("/workspace", noRole);
    expect(result.agentId).toBe("workspace-guide");
    expect(result.canAssist).toBe(true);
  });

  it("returns canAssist=false when platformRole is null on gated route", () => {
    const result = resolveAgentForRoute("/portfolio", noRole);
    expect(result.agentId).toBe("portfolio-advisor");
    expect(result.canAssist).toBe(false);
  });

  it("uses longest prefix match", () => {
    const result = resolveAgentForRoute("/platform/ai/providers/openai", superuser);
    expect(result.agentId).toBe("platform-engineer");
  });

  it("returns correct agent metadata", () => {
    const result = resolveAgentForRoute("/ops", superuser);
    expect(result.agentName).toBeTruthy();
    expect(result.agentDescription).toBeTruthy();
  });
});

describe("generateCannedResponse", () => {
  it("returns a non-empty string", () => {
    const response = generateCannedResponse("portfolio-advisor", "/portfolio", "HR-000");
    expect(response).toBeTruthy();
    expect(typeof response).toBe("string");
  });

  it("returns a response for unknown agent (fallback)", () => {
    const response = generateCannedResponse("nonexistent-agent", "/somewhere", "HR-000");
    expect(response).toBeTruthy();
  });

  it("returns different responses for different roles on same route", () => {
    const adminResponse = generateCannedResponse("portfolio-advisor", "/portfolio", "HR-000");
    const opsResponse = generateCannedResponse("portfolio-advisor", "/portfolio", "HR-500");
    expect(adminResponse).toBeTruthy();
    expect(opsResponse).toBeTruthy();
    // HR-000 draws from default pool, HR-500 from restricted pool
    expect(adminResponse).not.toBe(opsResponse);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd d:/OpenDigitalProductFactory && pnpm --filter web exec vitest run apps/web/lib/agent-routing.test.ts
```
Expected: FAIL — module `./agent-routing` not found.

---

### Task 5: Implement Agent Routing & Canned Responses

**Files:**
- Create: `apps/web/lib/agent-routing.ts`

- [ ] **Step 1: Create the routing module**

Create `apps/web/lib/agent-routing.ts`:
```typescript
import { can } from "@/lib/permissions";
import type { UserContext } from "@/lib/permissions";
import type { CapabilityKey } from "@/lib/permissions";
import type { AgentInfo, RouteAgentEntry } from "@/lib/agent-coworker-types";

/** Route prefix → agent + capability mapping. */
const ROUTE_AGENT_MAP: Record<string, RouteAgentEntry> = {
  "/portfolio": {
    agentId: "portfolio-advisor",
    agentName: "Portfolio Advisor",
    agentDescription: "Helps navigate portfolio structure, products, and health metrics",
    capability: "view_portfolio",
  },
  "/inventory": {
    agentId: "inventory-specialist",
    agentName: "Inventory Specialist",
    agentDescription: "Assists with digital product inventory and infrastructure CIs",
    capability: "view_inventory",
  },
  "/ea": {
    agentId: "ea-architect",
    agentName: "EA Architect",
    agentDescription: "Guides enterprise architecture modeling, views, and relationships",
    capability: "view_ea_modeler",
  },
  "/employee": {
    agentId: "hr-specialist",
    agentName: "HR Specialist",
    agentDescription: "Assists with role management, people, and organizational structure",
    capability: "view_employee",
  },
  "/customer": {
    agentId: "customer-advisor",
    agentName: "Customer Advisor",
    agentDescription: "Helps manage customer accounts and service relationships",
    capability: "view_customer",
  },
  "/ops": {
    agentId: "ops-coordinator",
    agentName: "Ops Coordinator",
    agentDescription: "Assists with backlog management, epics, and operational workflows",
    capability: "view_operations",
  },
  "/platform": {
    agentId: "platform-engineer",
    agentName: "Platform Engineer",
    agentDescription: "Helps configure AI providers, credentials, and platform services",
    capability: "view_platform",
  },
  "/admin": {
    agentId: "admin-assistant",
    agentName: "Admin Assistant",
    agentDescription: "Assists with platform administration and user management",
    capability: "view_admin",
  },
  "/workspace": {
    agentId: "workspace-guide",
    agentName: "Workspace Guide",
    agentDescription: "Helps navigate the portal and find the right tools for your task",
    capability: null,
  },
};

const FALLBACK_ENTRY = ROUTE_AGENT_MAP["/workspace"]!;

/** Lookup agentId → agentName for rendering historical messages. */
export const AGENT_NAME_MAP: Record<string, string> = Object.fromEntries(
  Object.values(ROUTE_AGENT_MAP).map((e) => [e.agentId, e.agentName]),
);

/**
 * Resolve which specialist agent should handle the current route.
 * Uses longest prefix match, then checks user capabilities.
 */
export function resolveAgentForRoute(
  pathname: string,
  userContext: UserContext,
): AgentInfo {
  // Find longest matching prefix
  let bestMatch: RouteAgentEntry = FALLBACK_ENTRY;
  let bestLen = 0;

  for (const [prefix, entry] of Object.entries(ROUTE_AGENT_MAP)) {
    if (pathname === prefix || pathname.startsWith(prefix + "/")) {
      if (prefix.length > bestLen) {
        bestLen = prefix.length;
        bestMatch = entry;
      }
    }
  }

  // Ungated routes (capability null) — always canAssist
  if (bestMatch.capability === null) {
    return {
      agentId: bestMatch.agentId,
      agentName: bestMatch.agentName,
      agentDescription: bestMatch.agentDescription,
      canAssist: true,
    };
  }

  // Gated routes — check user permission
  const canAssist = can(userContext, bestMatch.capability);

  return {
    agentId: bestMatch.agentId,
    agentName: bestMatch.agentName,
    agentDescription: bestMatch.agentDescription,
    canAssist,
  };
}

// ─── Canned Responses ───────────────────────────────────────────────────────

type CannedResponseSet = Record<string, string[]>;

const CANNED_RESPONSES: Record<string, CannedResponseSet> = {
  "portfolio-advisor": {
    default: [
      "I can help you explore the portfolio structure, review product health metrics, and understand budget allocations across your portfolios.",
      "Looking at the portfolio view — would you like me to explain the health scores or help you navigate to a specific product group?",
      "I'm your Portfolio Advisor. I can guide you through portfolio nodes, agent assignments, and product ownership.",
    ],
    restricted: [
      "I can see you're viewing the portfolio area. I can help explain what you see here, but some actions may require additional permissions.",
    ],
  },
  "inventory-specialist": {
    default: [
      "I can help you explore the digital product inventory, review lifecycle stages, and understand infrastructure dependencies.",
      "Looking at the inventory — would you like me to help filter products by status or explain the lifecycle stages?",
    ],
    restricted: [
      "I can help you understand the inventory view, but modifying products may require elevated permissions.",
    ],
  },
  "ea-architect": {
    default: [
      "I can help you with your architecture model — creating views, adding elements, and establishing relationships between components.",
      "Welcome to the EA Modeler. I can guide you through viewpoint selection, element placement, and relationship mapping.",
      "Need help with the canvas? I can explain how to drag elements from the palette, connect them, and organize your architecture view.",
    ],
    restricted: [
      "I can explain the architecture model you're viewing, but editing requires EA management permissions.",
    ],
  },
  "hr-specialist": {
    default: [
      "I can help you understand the role structure, review team assignments, and navigate the employee directory.",
      "Looking at the employee view — I can explain role tiers, SLA commitments, and help you understand the organizational hierarchy.",
    ],
    restricted: [
      "I can help you explore employee information visible to your role.",
    ],
  },
  "customer-advisor": {
    default: [
      "I can help you manage customer accounts, review service relationships, and track engagement metrics.",
    ],
    restricted: [
      "I can provide general information about customer management, but account actions require customer view permissions.",
    ],
  },
  "ops-coordinator": {
    default: [
      "I can help you manage the backlog — creating items, organizing epics, and tracking progress across portfolio and product work.",
      "Looking at operations — would you like help prioritizing backlog items or understanding the epic structure?",
    ],
    restricted: [
      "I can help you understand the backlog view, but creating or editing items requires operations permissions.",
    ],
  },
  "platform-engineer": {
    default: [
      "I can help you configure AI providers, manage credentials, monitor token spend, and set up scheduled sync jobs.",
      "Looking at the platform services — would you like help connecting a new provider or reviewing the token usage dashboard?",
    ],
    restricted: [
      "I can explain the platform configuration, but changes require platform management permissions.",
    ],
  },
  "admin-assistant": {
    default: [
      "I can help with platform administration — user management, role assignments, and system configuration.",
    ],
    restricted: [
      "Administration features require admin-level access. I can help you navigate to areas within your permissions.",
    ],
  },
  "workspace-guide": {
    default: [
      "Welcome! I'm your Workspace Guide. I can help you find the right tools and navigate the portal. What are you looking to do?",
      "I can help you get oriented — the workspace tiles show features available to your role. Would you like me to explain any of them?",
      "Need help finding something? I can point you to portfolio management, the backlog, architecture modeling, and more.",
    ],
    restricted: [
      "I'm here to help you navigate. Let me know what you're looking for and I'll point you in the right direction.",
    ],
  },
};

const GENERIC_FALLBACK = "I'm here to help. What would you like to know about this area of the portal?";

/**
 * Generate a canned response based on agent, route, and user role.
 * Selects from role-appropriate templates. No LLM calls.
 */
export function generateCannedResponse(
  agentId: string,
  _routeContext: string,
  platformRole: string | null,
): string {
  const agentResponses = CANNED_RESPONSES[agentId];
  if (!agentResponses) return GENERIC_FALLBACK;

  // HR-000 (superuser): full access responses
  // Other roles (including null): use restricted if available
  const isFullAccess = platformRole === "HR-000";
  const pool = isFullAccess
    ? agentResponses["default"] ?? [GENERIC_FALLBACK]
    : agentResponses["restricted"] ?? agentResponses["default"] ?? [GENERIC_FALLBACK];

  // Simple deterministic selection based on content hash to avoid randomness in tests
  const index = Math.abs(hashCode(agentId + _routeContext + (platformRole ?? ""))) % pool.length;
  return pool[index] ?? GENERIC_FALLBACK;
}

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32-bit integer
  }
  return hash;
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run:
```bash
cd d:/OpenDigitalProductFactory && pnpm --filter web exec vitest run apps/web/lib/agent-routing.test.ts
```
Expected: All 11 tests PASS.

- [ ] **Step 3: Verify no type errors**

Run:
```bash
cd d:/OpenDigitalProductFactory && pnpm --filter web exec tsc --noEmit
```
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/agent-routing.ts apps/web/lib/agent-routing.test.ts
git commit -m "feat: add agent routing with canned responses (TDD)"
```

---

## Chunk 3: Server Actions & Data Layer

### Task 6: Data Fetcher — `getRecentMessages`

**Files:**
- Create: `apps/web/lib/agent-coworker-data.ts`

- [ ] **Step 1: Create the data fetcher**

Create `apps/web/lib/agent-coworker-data.ts`:
```typescript
import { cache } from "react";
import { prisma } from "@dpf/db";
import type { AgentMessageRow } from "@/lib/agent-coworker-types";

function serializeMessage(m: {
  id: string;
  role: string;
  content: string;
  agentId: string | null;
  routeContext: string | null;
  createdAt: Date;
}): AgentMessageRow {
  return {
    id: m.id,
    role: m.role as AgentMessageRow["role"],
    content: m.content,
    agentId: m.agentId,
    routeContext: m.routeContext,
    createdAt: m.createdAt.toISOString(),
  };
}

/**
 * Get recent messages for a thread. React-cache deduped within a single request.
 * MUST only be called after session verification (shell layout).
 */
export const getRecentMessages = cache(
  async (threadId: string, limit = 50): Promise<AgentMessageRow[]> => {
    // Fetch newest N in desc order, then reverse to get chronological for display
    const messages = await prisma.agentMessage.findMany({
      where: { threadId },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        role: true,
        content: true,
        agentId: true,
        routeContext: true,
        createdAt: true,
      },
    });
    return messages.reverse().map(serializeMessage);
  },
);

export { serializeMessage };
```

- [ ] **Step 2: Verify no type errors**

Run:
```bash
cd d:/OpenDigitalProductFactory && pnpm --filter web exec tsc --noEmit
```
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/agent-coworker-data.ts
git commit -m "feat: add getRecentMessages data fetcher for agent coworker"
```

---

### Task 7: Write Failing Tests for Server Action Validation

**Files:**
- Create: `apps/web/lib/actions/agent-coworker.test.ts`

- [ ] **Step 1: Write the test file**

Create `apps/web/lib/actions/agent-coworker.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { validateMessageInput } from "../agent-coworker-types";

describe("validateMessageInput", () => {
  it("returns null for valid input", () => {
    expect(validateMessageInput({ content: "Hello", routeContext: "/portfolio" })).toBeNull();
  });

  it("rejects empty content", () => {
    expect(validateMessageInput({ content: "", routeContext: "/portfolio" })).toMatch(/empty/i);
  });

  it("rejects whitespace-only content", () => {
    expect(validateMessageInput({ content: "   ", routeContext: "/portfolio" })).toMatch(/empty/i);
  });

  it("rejects content over 2000 chars", () => {
    const long = "x".repeat(2001);
    expect(validateMessageInput({ content: long, routeContext: "/portfolio" })).toMatch(/2000/);
  });

  it("accepts content at exactly 2000 chars", () => {
    const exact = "x".repeat(2000);
    expect(validateMessageInput({ content: exact, routeContext: "/portfolio" })).toBeNull();
  });

  it("rejects empty routeContext", () => {
    expect(validateMessageInput({ content: "Hello", routeContext: "" })).toMatch(/route/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd d:/OpenDigitalProductFactory && pnpm --filter web exec vitest run apps/web/lib/actions/agent-coworker.test.ts
```
Expected: FAIL — module not found or `validateMessageInput` not exported.

---

### Task 8: Implement Server Actions

**Files:**
- Create: `apps/web/lib/actions/agent-coworker.ts`

- [ ] **Step 1: Create the server actions file**

Create `apps/web/lib/actions/agent-coworker.ts`:
```typescript
"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@dpf/db";
import { validateMessageInput } from "@/lib/agent-coworker-types";
import type { AgentMessageRow } from "@/lib/agent-coworker-types";
import { resolveAgentForRoute, generateCannedResponse } from "@/lib/agent-routing";
import { serializeMessage } from "@/lib/agent-coworker-data";

// ─── Auth helper ────────────────────────────────────────────────────────────

async function requireAuthUser() {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) throw new Error("Unauthorized");
  return user;
}

// ─── Server Actions ─────────────────────────────────────────────────────────

export async function getOrCreateThread(): Promise<{ threadId: string }> {
  const user = await requireAuthUser();

  const existing = await prisma.agentThread.findUnique({
    where: { userId_contextKey: { userId: user.id, contextKey: "coworker" } },
    select: { id: true },
  });

  if (existing) return { threadId: existing.id };

  const created = await prisma.agentThread.create({
    data: { userId: user.id, contextKey: "coworker" },
    select: { id: true },
  });

  return { threadId: created.id };
}

export async function sendMessage(input: {
  threadId: string;
  content: string;
  routeContext: string;
}): Promise<
  | { userMessage: AgentMessageRow; agentMessage: AgentMessageRow }
  | { error: string }
> {
  const user = await requireAuthUser();

  // Verify thread ownership
  const thread = await prisma.agentThread.findUnique({
    where: { id: input.threadId },
    select: { userId: true },
  });
  if (!thread || thread.userId !== user.id) {
    return { error: "Unauthorized" };
  }

  // Validate input
  const validationError = validateMessageInput(input);
  if (validationError) return { error: validationError };

  const trimmedContent = input.content.trim();

  // Persist user message
  const userMsg = await prisma.agentMessage.create({
    data: {
      threadId: input.threadId,
      role: "user",
      content: trimmedContent,
      routeContext: input.routeContext,
    },
    select: {
      id: true,
      role: true,
      content: true,
      agentId: true,
      routeContext: true,
      createdAt: true,
    },
  });

  // Resolve agent and generate canned response
  const agent = resolveAgentForRoute(input.routeContext, {
    platformRole: user.platformRole,
    isSuperuser: user.isSuperuser,
  });

  const responseContent = generateCannedResponse(
    agent.agentId,
    input.routeContext,
    user.platformRole,
  );

  // Persist agent response
  const agentMsg = await prisma.agentMessage.create({
    data: {
      threadId: input.threadId,
      role: "assistant",
      content: responseContent,
      agentId: agent.agentId,
      routeContext: input.routeContext,
    },
    select: {
      id: true,
      role: true,
      content: true,
      agentId: true,
      routeContext: true,
      createdAt: true,
    },
  });

  return {
    userMessage: serializeMessage(userMsg),
    agentMessage: serializeMessage(agentMsg),
  };
}

export async function loadEarlierMessages(input: {
  threadId: string;
  before: string;
  limit?: number;
}): Promise<{ messages: AgentMessageRow[]; hasMore: boolean } | { error: string }> {
  const user = await requireAuthUser();

  const thread = await prisma.agentThread.findUnique({
    where: { id: input.threadId },
    select: { userId: true },
  });
  if (!thread || thread.userId !== user.id) {
    return { error: "Unauthorized" };
  }

  const limit = input.limit ?? 20;

  const messages = await prisma.agentMessage.findMany({
    where: { threadId: input.threadId },
    orderBy: { createdAt: "desc" },
    cursor: { id: input.before },
    skip: 1, // skip the cursor itself
    take: limit + 1, // fetch one extra to check hasMore
    select: {
      id: true,
      role: true,
      content: true,
      agentId: true,
      routeContext: true,
      createdAt: true,
    },
  });

  const hasMore = messages.length > limit;
  const slice = hasMore ? messages.slice(0, limit) : messages;

  return {
    messages: slice.reverse().map(serializeMessage),
    hasMore,
  };
}

export async function recordAgentTransition(input: {
  threadId: string;
  agentId: string;
  agentName: string;
  routeContext: string;
}): Promise<{ message: AgentMessageRow } | { error: string }> {
  const user = await requireAuthUser();

  const thread = await prisma.agentThread.findUnique({
    where: { id: input.threadId },
    select: { userId: true },
  });
  if (!thread || thread.userId !== user.id) {
    return { error: "Unauthorized" };
  }

  const msg = await prisma.agentMessage.create({
    data: {
      threadId: input.threadId,
      role: "system",
      content: `${input.agentName} has joined the conversation`,
      agentId: input.agentId,
      routeContext: input.routeContext,
    },
    select: {
      id: true,
      role: true,
      content: true,
      agentId: true,
      routeContext: true,
      createdAt: true,
    },
  });

  return { message: serializeMessage(msg) };
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run:
```bash
cd d:/OpenDigitalProductFactory && pnpm --filter web exec vitest run apps/web/lib/actions/agent-coworker.test.ts
```
Expected: All 6 tests PASS.

- [ ] **Step 3: Verify no type errors**

Run:
```bash
cd d:/OpenDigitalProductFactory && pnpm --filter web exec tsc --noEmit
```
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/actions/agent-coworker.ts apps/web/lib/actions/agent-coworker.test.ts
git commit -m "feat: add agent coworker server actions with validation (TDD)"
```

---

## Chunk 4: UI Components

### Task 9: `AgentMessageBubble` Component

**Files:**
- Create: `apps/web/components/agent/AgentMessageBubble.tsx`

- [ ] **Step 1: Create the component**

Create `apps/web/components/agent/AgentMessageBubble.tsx`:
```typescript
"use client";

import type { AgentMessageRow } from "@/lib/agent-coworker-types";

type Props = {
  message: AgentMessageRow;
  showAgentLabel: boolean; // true when agent changed from previous message
  agentName: string | null;
};

function formatRelativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function AgentMessageBubble({ message, showAgentLabel, agentName }: Props) {
  if (message.role === "system") {
    return (
      <div style={{
        textAlign: "center",
        padding: "8px 0",
        fontSize: 11,
        color: "var(--dpf-muted)",
        fontStyle: "italic",
      }}>
        {message.content}
      </div>
    );
  }

  const isUser = message.role === "user";

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: isUser ? "flex-end" : "flex-start",
      gap: 2,
      marginBottom: 8,
    }}>
      {showAgentLabel && agentName && !isUser && (
        <span style={{ fontSize: 10, color: "var(--dpf-accent)", marginLeft: 4 }}>
          {agentName}
        </span>
      )}
      <div
        title={formatRelativeTime(message.createdAt)}
        style={{
          maxWidth: "85%",
          padding: "8px 12px",
          borderRadius: isUser ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
          fontSize: 13,
          lineHeight: 1.4,
          background: isUser ? "var(--dpf-accent)" : "var(--dpf-surface-2)",
          color: isUser ? "#ffffff" : "#e0e0ff",
          wordBreak: "break-word",
        }}
      >
        {message.content}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify no type errors**

Run:
```bash
cd d:/OpenDigitalProductFactory && pnpm --filter web exec tsc --noEmit
```
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/agent/AgentMessageBubble.tsx
git commit -m "feat: add AgentMessageBubble component"
```

---

### Task 10: `AgentPanelHeader` Component

**Files:**
- Create: `apps/web/components/agent/AgentPanelHeader.tsx`

- [ ] **Step 1: Create the component**

Create `apps/web/components/agent/AgentPanelHeader.tsx`:
```typescript
"use client";

import type { AgentInfo } from "@/lib/agent-coworker-types";

type Props = {
  agent: AgentInfo;
  onMouseDown: (e: React.MouseEvent) => void; // drag handle
  onClose: () => void;
};

export function AgentPanelHeader({ agent, onMouseDown, onClose }: Props) {
  return (
    <div
      onMouseDown={onMouseDown}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 14px",
        background: "var(--dpf-surface-2)",
        borderBottom: "1px solid var(--dpf-border)",
        borderRadius: "12px 12px 0 0",
        cursor: "grab",
        userSelect: "none",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400" />
          <span style={{ fontSize: 12, fontWeight: 600, color: "#e0e0ff" }}>
            {agent.agentName}
          </span>
        </div>
        <span style={{ fontSize: 10, color: "var(--dpf-muted)", marginLeft: 12 }}>
          {agent.agentDescription}
        </span>
      </div>

      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        title="Close"
        style={{
          background: "none",
          border: "none",
          color: "var(--dpf-muted)",
          cursor: "pointer",
          fontSize: 16,
          padding: "2px 6px",
          borderRadius: 4,
          lineHeight: 1,
        }}
      >
        ✕
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/agent/AgentPanelHeader.tsx
git commit -m "feat: add AgentPanelHeader component"
```

---

### Task 11: `AgentMessageInput` Component

**Files:**
- Create: `apps/web/components/agent/AgentMessageInput.tsx`

- [ ] **Step 1: Create the component**

Create `apps/web/components/agent/AgentMessageInput.tsx`:
```typescript
"use client";

import { useState, useRef } from "react";
import { MAX_MESSAGE_LENGTH } from "@/lib/agent-coworker-types";

type Props = {
  onSend: (content: string) => void;
  disabled: boolean;
};

export function AgentMessageInput({ onSend, disabled }: Props) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function handleSubmit() {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    if (trimmed.length > MAX_MESSAGE_LENGTH) return;
    onSend(trimmed);
    setValue("");
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  const overLimit = value.trim().length > MAX_MESSAGE_LENGTH;

  return (
    <div style={{
      display: "flex",
      gap: 6,
      padding: "10px 12px",
      borderTop: "1px solid var(--dpf-border)",
    }}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder={disabled ? "Sending..." : "Ask your co-worker..."}
        style={{
          flex: 1,
          background: "var(--dpf-bg)",
          border: `1px solid ${overLimit ? "#ef4444" : "var(--dpf-border)"}`,
          borderRadius: 6,
          padding: "6px 10px",
          fontSize: 12,
          color: "#e0e0ff",
          outline: "none",
        }}
      />
      <button
        type="button"
        onClick={handleSubmit}
        disabled={disabled || !value.trim() || overLimit}
        style={{
          background: "var(--dpf-accent)",
          border: "none",
          borderRadius: 6,
          padding: "6px 12px",
          fontSize: 12,
          color: "#ffffff",
          cursor: disabled || !value.trim() || overLimit ? "not-allowed" : "pointer",
          opacity: disabled || !value.trim() || overLimit ? 0.5 : 1,
        }}
      >
        Send
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/agent/AgentMessageInput.tsx
git commit -m "feat: add AgentMessageInput component"
```

---

## Chunk 5: Main Panel & Integration

### Task 12: `AgentCoworkerPanel` — Main Client Component

**Files:**
- Create: `apps/web/components/agent/AgentCoworkerPanel.tsx`

- [ ] **Step 1: Create the panel component**

Create `apps/web/components/agent/AgentCoworkerPanel.tsx`:
```typescript
"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import type { AgentMessageRow, AgentInfo } from "@/lib/agent-coworker-types";
import type { UserContext } from "@/lib/permissions";
import { resolveAgentForRoute, AGENT_NAME_MAP } from "@/lib/agent-routing";
import { sendMessage, recordAgentTransition } from "@/lib/actions/agent-coworker";
import { AgentPanelHeader } from "./AgentPanelHeader";
import { AgentMessageBubble } from "./AgentMessageBubble";
import { AgentMessageInput } from "./AgentMessageInput";

type Props = {
  threadId: string;
  initialMessages: AgentMessageRow[];
  userContext: UserContext;
};

const PANEL_W = 380;
const PANEL_H = 480;
const EDGE_GAP = 16;
const LS_KEY_OPEN = "agent-panel-open";
const LS_KEY_POS = "agent-panel-position";

function loadPosition(): { x: number; y: number } {
  try {
    const raw = localStorage.getItem(LS_KEY_POS);
    if (raw) {
      const parsed = JSON.parse(raw) as { x: number; y: number };
      if (typeof parsed.x === "number" && typeof parsed.y === "number") return parsed;
    }
  } catch { /* ignore */ }
  return {
    x: typeof window !== "undefined" ? window.innerWidth - PANEL_W - EDGE_GAP : EDGE_GAP,
    y: typeof window !== "undefined" ? window.innerHeight - PANEL_H - EDGE_GAP : EDGE_GAP,
  };
}

function loadOpen(): boolean {
  try {
    return localStorage.getItem(LS_KEY_OPEN) === "true";
  } catch {
    return false;
  }
}

export function AgentCoworkerPanel({ threadId, initialMessages, userContext }: Props) {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [messages, setMessages] = useState<AgentMessageRow[]>(initialMessages);
  const [isPending, startTransition] = useTransition();
  const [lastAgentId, setLastAgentId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number } | null>(null);

  // Hydrate from localStorage after mount
  useEffect(() => {
    setIsOpen(loadOpen());
    setPosition(loadPosition());
  }, []);

  // Listen for toggle event from Header Agent button
  useEffect(() => {
    function handleToggle() {
      setIsOpen((prev) => {
        const next = !prev;
        localStorage.setItem(LS_KEY_OPEN, String(next));
        return next;
      });
    }
    document.addEventListener("toggle-agent-panel", handleToggle);
    return () => document.removeEventListener("toggle-agent-panel", handleToggle);
  }, []);

  // Resolve agent for current route
  const agent: AgentInfo = resolveAgentForRoute(pathname, userContext);

  // Agent transition — persist system message when agent changes
  useEffect(() => {
    if (lastAgentId === null) {
      setLastAgentId(agent.agentId);
      return;
    }
    if (agent.agentId !== lastAgentId) {
      setLastAgentId(agent.agentId);
      // Optimistic: show immediately
      const optimisticMsg: AgentMessageRow = {
        id: `system-${Date.now()}`,
        role: "system",
        content: `${agent.agentName} has joined the conversation`,
        agentId: agent.agentId,
        routeContext: pathname,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, optimisticMsg]);
      // Persist to DB (fire-and-forget — optimistic msg is already shown)
      void recordAgentTransition({
        threadId,
        agentId: agent.agentId,
        agentName: agent.agentName,
        routeContext: pathname,
      });
    }
  }, [agent.agentId, agent.agentName, pathname, lastAgentId, threadId]);

  // Auto-scroll to bottom when new messages appear
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ─── Drag handling ──────────────────────────────────────────────────────

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startPosX: position.x,
      startPosY: position.y,
    };

    function onMouseMove(ev: MouseEvent) {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;
      const newPos = {
        x: dragRef.current.startPosX + dx,
        y: dragRef.current.startPosY + dy,
      };
      setPosition(newPos);
      localStorage.setItem(LS_KEY_POS, JSON.stringify(newPos));
    }

    function onMouseUp() {
      dragRef.current = null;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [position]);

  // ─── Send message ───────────────────────────────────────────────────────

  function handleSend(content: string) {
    startTransition(async () => {
      const result = await sendMessage({
        threadId,
        content,
        routeContext: pathname,
      });
      if ("error" in result) {
        console.warn("sendMessage error:", result.error);
        return;
      }
      setMessages((prev) => [...prev, result.userMessage, result.agentMessage]);
    });
  }

  function handleClose() {
    setIsOpen(false);
    localStorage.setItem(LS_KEY_OPEN, "false");
  }

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        left: position.x,
        top: position.y,
        width: PANEL_W,
        height: PANEL_H,
        zIndex: 50,
        display: "flex",
        flexDirection: "column",
        background: "var(--dpf-surface-1)",
        border: "1px solid var(--dpf-border)",
        borderRadius: 12,
        boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
        overflow: "hidden",
      }}
    >
      <AgentPanelHeader
        agent={agent}
        onMouseDown={handleDragStart}
        onClose={handleClose}
      />

      {/* Messages area */}
      <div style={{
        flex: 1,
        overflowY: "auto",
        padding: "12px",
      }}>
        {messages.length === 0 && (
          <div style={{
            textAlign: "center",
            color: "var(--dpf-muted)",
            fontSize: 12,
            padding: "40px 20px",
          }}>
            Start a conversation with your AI co-worker
          </div>
        )}
        {messages.map((msg, i) => {
          const prevAgentId = i > 0 ? messages[i - 1]?.agentId : null;
          const showAgentLabel = msg.role === "assistant" && msg.agentId !== prevAgentId;
          return (
            <AgentMessageBubble
              key={msg.id}
              message={msg}
              showAgentLabel={showAgentLabel}
              agentName={showAgentLabel && msg.agentId ? (AGENT_NAME_MAP[msg.agentId] ?? msg.agentId) : null}
            />
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      <AgentMessageInput onSend={handleSend} disabled={isPending} />
    </div>
  );
}
```

- [ ] **Step 2: Verify no type errors**

Run:
```bash
cd d:/OpenDigitalProductFactory && pnpm --filter web exec tsc --noEmit
```
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/agent/AgentCoworkerPanel.tsx
git commit -m "feat: add AgentCoworkerPanel main component"
```

---

### Task 13: Wire Up Header Agent Button

**Files:**
- Modify: `apps/web/components/shell/Header.tsx:72-79`

- [ ] **Step 1: Add onClick handler to the existing Agent button**

In `apps/web/components/shell/Header.tsx`, find the Agent button (around line 72). Change from:
```tsx
        <button
          type="button"
          className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs border border-[var(--dpf-accent)] text-[var(--dpf-accent)] hover:bg-[var(--dpf-accent)] hover:text-white transition-colors"
        >
```
to:
```tsx
        <button
          type="button"
          onClick={() => document.dispatchEvent(new CustomEvent("toggle-agent-panel"))}
          className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs border border-[var(--dpf-accent)] text-[var(--dpf-accent)] hover:bg-[var(--dpf-accent)] hover:text-white transition-colors"
        >
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/shell/Header.tsx
git commit -m "feat: wire up Header Agent button to toggle co-worker panel"
```

---

### Task 14: Integrate Panel into Shell Layout

**Files:**
- Modify: `apps/web/app/(shell)/layout.tsx`

- [ ] **Step 1: Read the current layout file**

Read `apps/web/app/(shell)/layout.tsx` to understand the current structure.

- [ ] **Step 2: Add imports and panel rendering**

Add these imports at the top of `apps/web/app/(shell)/layout.tsx`:
```typescript
import { getOrCreateThread } from "@/lib/actions/agent-coworker";
import { getRecentMessages } from "@/lib/agent-coworker-data";
import { AgentCoworkerPanel } from "@/components/agent/AgentCoworkerPanel";
```

In the component body, after the `if (!session?.user) redirect("/login");` guard (line 11), add a `user` variable and the thread/messages fetch. Place the thread fetch in the existing `Promise.all` block for parallelism:

Change from:
```typescript
  const [latestDiscoveryRun, activeBranding] = await Promise.all([
```
to:
```typescript
  const user = session.user;
  const [latestDiscoveryRun, activeBranding, { threadId }] = await Promise.all([
```

Add `getOrCreateThread()` as a third element in the `Promise.all` array:
```typescript
    getOrCreateThread(),
  ]);
```

After the `Promise.all` block, fetch messages (depends on threadId):
```typescript
  const initialMessages = await getRecentMessages(threadId);
```

Update the Header props to use the `user` variable (replace `session.user.platformRole` → `user.platformRole`, etc.).

Then add the `AgentCoworkerPanel` as a sibling to `<main>`, inside the outermost div (before the closing `</div>`):
```tsx
      <AgentCoworkerPanel
        threadId={threadId}
        initialMessages={initialMessages}
        userContext={{ platformRole: user.platformRole, isSuperuser: user.isSuperuser }}
      />
```

- [ ] **Step 3: Verify no type errors**

Run:
```bash
cd d:/OpenDigitalProductFactory && pnpm --filter web exec tsc --noEmit
```
Expected: No errors.

- [ ] **Step 4: Start dev server and verify visually**

Run:
```bash
cd d:/OpenDigitalProductFactory && pnpm dev
```

Open `http://localhost:3000/workspace` in browser. Verify:
1. Click the "Agent" button in the header → panel appears bottom-right
2. Panel shows "Workspace Guide" as the active agent
3. Type a message and send → user bubble appears, canned response appears
4. Click ✕ to close → panel disappears
5. Navigate to `/portfolio` → agent transition message appears, header updates to "Portfolio Advisor"
6. Drag the panel header → panel repositions
7. Refresh page → panel remembers open/closed state and position
8. Refresh page → transition messages persist (visible from DB reload)

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/\(shell\)/layout.tsx
git commit -m "feat: integrate AgentCoworkerPanel into shell layout"
```

---

## Chunk 6: Final Verification & Cleanup

### Task 15: Run Full Test Suite

- [ ] **Step 1: Run all tests**

Run:
```bash
cd d:/OpenDigitalProductFactory && pnpm test
```
Expected: All tests pass (agent-routing tests + agent-coworker action tests + all existing tests).

- [ ] **Step 2: Run type check**

Run:
```bash
cd d:/OpenDigitalProductFactory && pnpm typecheck
```
Expected: No errors.

- [ ] **Step 3: Run build**

Run:
```bash
cd d:/OpenDigitalProductFactory && pnpm build
```
Expected: Build succeeds.

- [ ] **Step 4: Fix any issues found**

If tests, types, or build fail: fix the issues and commit the fixes.

- [ ] **Step 5: Final commit (if any fixes)**

```bash
git add -A
git commit -m "fix: resolve Phase 7B build/test issues"
```
