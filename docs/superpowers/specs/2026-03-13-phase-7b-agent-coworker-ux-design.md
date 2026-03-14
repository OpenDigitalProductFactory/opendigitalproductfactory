# Phase 7B: AI Agent Co-worker UX

**Date:** 2026-03-13
**Status:** Approved
**Depends on:** Phase 7A (AI Provider Registry & Token Spend)

## Overview

A floating chat panel that provides context-aware AI agent assistance on every screen. The panel follows the user across routes with a single persistent conversation thread, while specialist agents rotate in based on the current route and user permissions. No real AI wiring in this phase — agents produce canned responses that demonstrate the routing and UX patterns.

## 1. Thread & Message Model

### One Thread Per User

Each user gets a single `AgentThread` with `contextKey: "coworker"`. The conversation persists across all routes and sessions, giving the user a continuous history with their AI co-worker.

### Schema Migration

The `AgentThread` and `AgentMessage` models already exist in the schema. This phase adds fields to them via a Prisma migration:

**`AgentThread`** — add default to `contextKey`:
```prisma
contextKey String @default("coworker")   // existing field, adding default
```

**`AgentMessage`** — add two new columns and indexes:
```prisma
model AgentMessage {
  id           String      @id @default(cuid())
  threadId     String
  thread       AgentThread @relation(fields: [threadId], references: [id], onDelete: Cascade)
  role         String      // "user" | "assistant" | "system"
  content      String
  tone         String?     // existing field, retained
  agentId      String?     // NEW: which specialist agent authored this (null for user messages)
  routeContext String?     // NEW: route pathname when message was sent
  createdAt    DateTime    @default(now())

  @@index([threadId])      // NEW: needed for pagination queries
  @@index([createdAt])     // NEW: needed for cursor-based ordering
}
```

The existing `AgentThread` already has `onDelete: Cascade` on the user relation — no change needed there.

### Key Decisions

- **`agentId` on messages**: Tracks which specialist authored each response. Enables future multi-agent deliberation (Phase 7D) where messages from different specialists appear in the same thread.
- **`routeContext`**: Records the route pathname when the message was sent. Useful for understanding conversation flow and for agents to reference what the user was looking at.
- **`role: "system"`**: The existing schema already supports `"system"` role. Agent transition messages ("EA Architect has joined the conversation") use `role: "system"`.
- **No separate threads per route**: The user sees one continuous conversation. Agent identity changes are shown inline via system messages and avatar/label transitions.

### Route-to-Agent Mapping

A combined mapping defines which specialist agent handles each route prefix and which capability gates it. Routes with `capability: null` are accessible to all authenticated users.

```typescript
type RouteAgentEntry = {
  agentId: string;
  capability: CapabilityKey | null;  // null = no gate, all authenticated users
};

const ROUTE_AGENT_MAP: Record<string, RouteAgentEntry> = {
  "/portfolio":  { agentId: "portfolio-advisor",     capability: "view_portfolio" },
  "/inventory":  { agentId: "inventory-specialist",  capability: "view_inventory" },
  "/ea":         { agentId: "ea-architect",           capability: "view_ea_modeler" },
  "/employee":   { agentId: "hr-specialist",          capability: "view_employee" },
  "/customer":   { agentId: "customer-advisor",       capability: "view_customer" },
  "/ops":        { agentId: "ops-coordinator",        capability: "view_operations" },
  "/platform":   { agentId: "platform-engineer",      capability: "view_platform" },
  "/admin":      { agentId: "admin-assistant",        capability: "view_admin" },      // forward-looking
  "/workspace":  { agentId: "workspace-guide",        capability: null },               // all authenticated users
};
```

### Canned Responses

`generateCannedResponse(agentId, routeContext, platformRole)` returns a contextually appropriate static response. Each agent has 3-5 canned responses per route that demonstrate awareness of the current screen and user role. No LLM calls in Phase 7B.

## 2. Floating Panel UX

### Panel Specifications

- **Dimensions**: 380px wide x 480px tall (resizable in future phase)
- **Default position**: Bottom-right corner, 16px from edges
- **Z-index**: 50 (above page content, below modals)
- **Draggable**: Click-and-drag on the header bar to reposition
- **Position persistence**: Saved to `localStorage` key `"agent-panel-position"` as `{x, y}`
- **Toggle**: Existing "Agent" button in the Header component (pill with green dot, currently no onClick handler) is wired up to dispatch a `CustomEvent("toggle-agent-panel")`. The `AgentCoworkerPanel` listens for this event and syncs open/closed state with `localStorage` key `"agent-panel-open"`.

### Visual Design

- **Background**: `var(--dpf-surface-1)` (#1a1a2e)
- **Border**: 1px solid `var(--dpf-border)` (#2a2a40), with `border-radius: 12px`
- **Shadow**: Subtle dark shadow for floating effect
- **Header bar**: Agent name + role label, minimize/close buttons, drag handle
- **Message area**: Scrollable, newest at bottom, auto-scroll on new messages
- **Input area**: Text input with send button, disabled when panel is processing

### Message Bubbles

- **User messages**: Right-aligned, accent background (`var(--dpf-accent)` #7c8cf8), white text
- **Agent messages**: Left-aligned, `var(--dpf-surface-2)` (#161625) background, light text
- **System messages**: Centered, muted text (`var(--dpf-muted)` #8888a0), used for agent transition indicators
- **Agent identity**: Small label above agent messages showing agent name when the specialist changes (e.g., "EA Architect" when navigating to /ea)
- **Timestamps**: Relative time (e.g., "2m ago"), shown on hover

### Agent Transition

When the user navigates to a different route, the panel shows a subtle transition indicator:

> *EA Architect has joined the conversation*

This is persisted as a `role: "system"` message in the database and rendered centered with muted text. The new agent has access to the full conversation history for continuity.

## 3. Agent Routing & Role Awareness

### `resolveAgentForRoute(pathname, userContext)`

Pure function in `apps/web/lib/agent-routing.ts`. Reuses the existing `UserContext` type from `permissions.ts` (which has `platformRole: string | null`). **Prerequisite:** export the existing `UserContext` type in `permissions.ts` (add `export` keyword to the declaration at line 50).

```typescript
import type { UserContext } from "@/lib/permissions";

type AgentInfo = {
  agentId: string;
  agentName: string;
  agentDescription: string;
  canAssist: boolean;  // false if user lacks permission for this route's domain
};

function resolveAgentForRoute(pathname: string, userContext: UserContext): AgentInfo;
```

### Resolution Logic

1. Match `pathname` against `ROUTE_AGENT_MAP` using longest prefix match
2. If no route matches: fall back to `"workspace-guide"` (capability `null`)
3. If the matched entry has `capability: null`: return agent with `canAssist: true` (ungated route)
4. If `userContext.platformRole` is `null`: return agent with `canAssist: false`
5. Check if the user has the entry's capability via `can()` from permissions
6. If the user lacks permission: return the agent with `canAssist: false` — the agent will explain it cannot help with actions outside the user's authority

### Role-Aware Behavior

Agents scope their responses to the user's authority level:

- **HR-000 (superuser)**: Full access — agent can suggest any action
- **HR-100/200/300/400/500**: Domain-scoped — agent won't suggest actions outside the user's portfolio or capability set
- **Read-only users**: Agent provides information and navigation help but never suggests write operations

This is enforced in `generateCannedResponse` by selecting from role-appropriate response templates.

### Agent Switch

When the active agent changes (route navigation), the panel:

1. Calls `resolveAgentForRoute` with the new pathname
2. If the agent ID differs from the current one, persists a `role: "system"` message ("X has joined the conversation") via `sendMessage`
3. Updates the header to show the new agent's name and description
4. Does NOT clear the conversation — full history is preserved

## 4. Server Actions & Data Layer

### Server Actions (`apps/web/lib/actions/agent-coworker.ts`)

```typescript
"use server";

// Get or create the user's coworker thread
async function getOrCreateThread(): Promise<{ threadId: string }>;

// Send a message and get a canned response
// Returns { error: string } on validation failure or auth error
async function sendMessage(input: {
  threadId: string;
  content: string;       // max 2000 chars, must be non-empty after trimming
  routeContext: string;
}): Promise<{ userMessage: AgentMessageRow; agentMessage: AgentMessageRow } | { error: string }>;

// Load earlier messages (pagination)
async function loadEarlierMessages(input: {
  threadId: string;
  before: string;  // cursor (message ID)
  limit?: number;  // default 20
}): Promise<{ messages: AgentMessageRow[]; hasMore: boolean } | { error: string }>;
```

### Error Handling

All server actions follow the existing codebase pattern (e.g., `actions/backlog.ts`):
- Return `{ error: string }` union on failure
- Auth: call `auth()`, verify user owns the thread — return `{ error: "Unauthorized" }` if not
- Validation: reject empty content (after trim), reject content longer than 2000 characters
- Thread ownership: verify `thread.userId === session.user.id`

### Data Fetcher (`apps/web/lib/agent-coworker-data.ts`)

```typescript
// React cache — get recent messages for initial render
// MUST only be called from the shell layout after session is verified.
// The threadId is obtained via the authenticated getOrCreateThread() call,
// which guarantees the user owns the thread.
async function getRecentMessages(threadId: string, limit?: number): Promise<AgentMessageRow[]>;
```

### Serialization

Server actions and data fetchers map Prisma `DateTime` to ISO strings when constructing `AgentMessageRow`:
```typescript
createdAt: message.createdAt.toISOString()
```

### Auth Guards

All server actions call `auth()` and verify the user owns the thread. No new capability needed — any authenticated user can use the co-worker panel. The `getRecentMessages` data fetcher does not re-check auth; it relies on the caller (shell layout) having verified the session and obtained the `threadId` via `getOrCreateThread`.

### Types (`apps/web/lib/agent-coworker-types.ts`)

```typescript
type AgentMessageRow = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  agentId: string | null;
  routeContext: string | null;
  createdAt: string;  // ISO string — serialized from Prisma DateTime via .toISOString()
};

type AgentInfo = {
  agentId: string;
  agentName: string;
  agentDescription: string;
  canAssist: boolean;
};
```

## 5. Component Architecture

### Component Tree

```
ShellLayout
  └── AgentCoworkerPanel (client component, rendered at layout level)
        ├── AgentPanelHeader (drag handle, agent name, minimize/close)
        ├── AgentMessageList (scrollable message area)
        │     └── AgentMessageBubble (per message, handles user/assistant/system roles)
        └── AgentMessageInput (text input + send)
```

### `AgentCoworkerPanel` (`apps/web/components/agent/AgentCoworkerPanel.tsx`)

Client component. Manages:
- Open/closed state (listens for `CustomEvent("toggle-agent-panel")`, syncs with `localStorage`)
- Drag position (localStorage)
- Current agent (derived from `usePathname()` + `resolveAgentForRoute`)
- Message state (initial SSR data + optimistic updates)
- Auto-scroll behavior

### `AgentPanelHeader` (`apps/web/components/agent/AgentPanelHeader.tsx`)

Displays current agent name and description. Provides drag handle, minimize button, and close button.

### `AgentMessageBubble` (`apps/web/components/agent/AgentMessageBubble.tsx`)

Renders a single message. Handles:
- User vs. agent vs. system alignment and styling
- Agent identity label (shown when agent changes)
- Relative timestamp on hover

### `AgentMessageInput` (`apps/web/components/agent/AgentMessageInput.tsx`)

Text input with send button. Handles Enter-to-send, disabled state during processing, max 2000 char client-side validation.

### Integration with Shell Layout

`AgentCoworkerPanel` is rendered in `apps/web/app/(shell)/layout.tsx` as a sibling to the main content area. It receives:
- `userId` (from session)
- `threadId` (from `getOrCreateThread`)
- `initialMessages` (from `getRecentMessages`)
- `userContext` ({ platformRole, isSuperuser })

The existing "Agent" button in the Header component (pill-shaped with green dot) is wired up with `onClick={() => document.dispatchEvent(new CustomEvent("toggle-agent-panel"))}`. No new button is created.

### Testing Strategy

Unit tests for pure functions:
- `resolveAgentForRoute` — route matching, permission gating, fallback behavior, null platformRole handling
- `generateCannedResponse` — correct response selection by agent, route, and role
- Agent transition detection — when agent ID changes between messages

Integration tests for server actions:
- `getOrCreateThread` — creates on first call, returns existing on second
- `sendMessage` — persists both user and agent messages, returns correct structure
- `sendMessage` validation — rejects empty content, over-length content, unauthorized thread access
- `loadEarlierMessages` — pagination cursor behavior, hasMore flag
- Auth guards — rejects unauthenticated requests

## Scope Boundaries

### In Scope (Phase 7B)
- Prisma migration: add `agentId`, `routeContext` to `AgentMessage`; add `@default("coworker")` to `AgentThread.contextKey`; add indexes
- Floating panel UI with drag, minimize, close
- Route-based agent routing with permission awareness
- Canned responses (no LLM)
- Message persistence and pagination with error handling
- Agent transition indicators (system messages)
- Wire up existing Header "Agent" button via CustomEvent

### Out of Scope (Future Phases)
- **Phase 7C**: Agent job configuration — assigning agents to UX interfaces, configuring per-screen behavior
- **Phase 7D**: Multi-agent deliberation — multiple specialists collaborating on a single task, diversity of thought
- **Phase 7E**: Real AI wiring — replacing canned responses with actual LLM calls via the provider registry
- Panel resize
- Rich message content (markdown, code blocks, action buttons)
- Voice input
- Agent-initiated messages (proactive suggestions)

## Multi-Agent Vision (Phase 7D Preview)

The `agentId` field on messages is designed to support future multi-agent scenarios where different specialists with different perspectives deliberate together on complex tasks. This aligns with the project's diversity-of-thought philosophy: some decisions benefit from multiple viewpoints rather than a single agent's opinion. The data model is ready for this — no schema changes will be needed when Phase 7D arrives.
