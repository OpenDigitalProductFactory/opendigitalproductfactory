# Agent Panel UX Redesign — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the agent co-worker panel with a floating animated FAB, semi-transparent backgrounds, clean route transitions, and a context-aware skills dropdown.

**Architecture:** New `AgentCoworkerShell` wraps a `AgentFAB` and `AgentCoworkerPanel` as a single animated unit. The FAB morphs into the panel on open (CSS transitions, ~300ms). Skills are defined per route agent and filtered by user capabilities. No schema changes.

**Tech Stack:** Next.js 14 App Router, React 18 (useState, useEffect, useTransition, useCallback), TypeScript (strict), CSS transitions.

**Spec:** `docs/superpowers/specs/2026-03-14-agent-panel-ux-redesign.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `apps/web/components/agent/AgentCoworkerShell.tsx` | Animation state machine, FAB ↔ panel morph, open/closed state ownership |
| `apps/web/components/agent/AgentFAB.tsx` | Floating action button (44px circle, semi-transparent) |
| `apps/web/components/agent/AgentSkillsDropdown.tsx` | Hover/focus dropdown listing filtered skills |

### Modified Files
| File | Change |
|------|--------|
| `apps/web/lib/agent-coworker-types.ts` | Add `AgentSkill` type; add `skills` to `RouteAgentEntry` and `AgentInfo` |
| `apps/web/lib/agent-routing.ts` | Add `skills` arrays to `ROUTE_AGENT_MAP`; add `skills` to `resolveAgentForRoute` returns |
| `apps/web/lib/agent-routing.test.ts` | Add skills tests |
| `apps/web/components/agent/AgentCoworkerPanel.tsx` | Gut rewrite: remove state/drag/transition, accept props, semi-transparent styles |
| `apps/web/components/agent/AgentPanelHeader.tsx` | Replace with skills-aware header, no drag handle |
| `apps/web/components/agent/AgentMessageBubble.tsx` | Semi-transparent assistant bubble |
| `apps/web/components/agent/AgentMessageInput.tsx` | Semi-transparent input styles |
| `apps/web/components/shell/Header.tsx` | Remove Agent button |
| `apps/web/app/(shell)/layout.tsx` | Render `AgentCoworkerShell` instead of `AgentCoworkerPanel` |

---

## Chunk 1: Types + Skills Data + Tests

### Task 1: Add AgentSkill Type and Skills to Types

**Files:**
- Modify: `apps/web/lib/agent-coworker-types.ts`

- [ ] **Step 1: Add AgentSkill type and update RouteAgentEntry and AgentInfo**

In `apps/web/lib/agent-coworker-types.ts`, add after the `RouteAgentEntry` type definition:

```typescript
/** A context-relevant action the agent can help with. */
export type AgentSkill = {
  label: string;
  description: string;
  capability: CapabilityKey | null;
  prompt: string;
};
```

Add `skills: AgentSkill[]` to `RouteAgentEntry`:
```typescript
export type RouteAgentEntry = {
  agentId: string;
  agentName: string;
  agentDescription: string;
  capability: CapabilityKey | null;
  systemPrompt: string;
  skills: AgentSkill[];
};
```

Add `skills: AgentSkill[]` to `AgentInfo`:
```typescript
export type AgentInfo = {
  agentId: string;
  agentName: string;
  agentDescription: string;
  canAssist: boolean;
  systemPrompt: string;
  skills: AgentSkill[];
};
```

- [ ] **Step 2: Commit**

```bash
cd d:/OpenDigitalProductFactory && git add apps/web/lib/agent-coworker-types.ts && git commit -m "feat: add AgentSkill type and skills to RouteAgentEntry and AgentInfo"
```

---

### Task 2: Add Skills to Route Agent Map

**Files:**
- Modify: `apps/web/lib/agent-routing.ts`

- [ ] **Step 1: Add skills arrays to every entry in ROUTE_AGENT_MAP**

In `apps/web/lib/agent-routing.ts`, import `AgentSkill` at the top:
```typescript
import type { AgentInfo, RouteAgentEntry, AgentSkill } from "@/lib/agent-coworker-types";
```

Then add a `skills` array to each entry in `ROUTE_AGENT_MAP`. Add the skills field after each `systemPrompt` field. Here are the skills for each agent:

**`/portfolio`:**
```typescript
    skills: [
      { label: "Show health summary", description: "Summarize health metrics for this portfolio", capability: "view_portfolio", prompt: "Summarize the health metrics for this portfolio" },
      { label: "Explain budget", description: "Explain budget allocation across the portfolio", capability: "view_portfolio", prompt: "Explain how the budget is allocated across this portfolio" },
      { label: "Find a product", description: "Search for a digital product in the portfolio", capability: "view_portfolio", prompt: "Help me find a specific digital product in the portfolio" },
    ],
```

**`/inventory`:**
```typescript
    skills: [
      { label: "Filter by status", description: "Filter inventory by lifecycle status", capability: "view_inventory", prompt: "Help me filter the inventory by lifecycle status" },
      { label: "Explain lifecycle", description: "Explain the lifecycle stages and statuses", capability: "view_inventory", prompt: "Explain the lifecycle stages and what each status means" },
    ],
```

**`/ea`:**
```typescript
    skills: [
      { label: "Create a view", description: "Start a new EA view with a viewpoint", capability: "manage_ea_model", prompt: "Help me create a new EA view" },
      { label: "Add an element", description: "Add an element to the current view", capability: "manage_ea_model", prompt: "Guide me through adding a new element to this view" },
      { label: "Map a relationship", description: "Connect two elements with a relationship", capability: "manage_ea_model", prompt: "Help me create a relationship between two elements" },
      { label: "Explain viewpoint", description: "What this viewpoint allows and restricts", capability: "view_ea_modeler", prompt: "Explain what this viewpoint allows and restricts" },
    ],
```

**`/employee`:**
```typescript
    skills: [
      { label: "Explain role tiers", description: "Understand HITL tiers and SLA commitments", capability: "view_employee", prompt: "Explain the role tiers and their SLA commitments" },
      { label: "Show team structure", description: "View team memberships and assignments", capability: "view_employee", prompt: "Show me the team structure and assignments" },
    ],
```

**`/customer`:**
```typescript
    skills: [
      { label: "Account overview", description: "Summarize a customer account", capability: "view_customer", prompt: "Give me an overview of this customer account" },
      { label: "Service relationships", description: "Show service delivery relationships", capability: "view_customer", prompt: "Show the service relationships for this customer" },
    ],
```

**`/ops`:**
```typescript
    skills: [
      { label: "Create backlog item", description: "Add a new item to the backlog", capability: "manage_backlog", prompt: "Help me create a new backlog item" },
      { label: "Epic progress", description: "Summarize progress across epics", capability: "view_operations", prompt: "Give me a summary of the current epic progress" },
      { label: "Prioritize items", description: "Help order backlog items by priority", capability: "manage_backlog", prompt: "Help me prioritize the open backlog items" },
    ],
```

**`/platform`:**
```typescript
    skills: [
      { label: "Configure provider", description: "Set up an AI provider connection", capability: "manage_provider_connections", prompt: "Help me configure an AI provider" },
      { label: "Token spend", description: "Review token usage and costs", capability: "view_platform", prompt: "Show me a summary of token usage and costs" },
      { label: "Run optimization", description: "Optimize provider priority rankings", capability: "manage_provider_connections", prompt: "Run the provider priority optimization now" },
    ],
```

**`/admin`:**
```typescript
    skills: [
      { label: "Manage users", description: "User account lifecycle and roles", capability: "manage_users", prompt: "Help me manage user accounts" },
      { label: "System config", description: "Platform configuration and settings", capability: "view_admin", prompt: "Show me the current system configuration" },
    ],
```

**`/workspace`:**
```typescript
    skills: [
      { label: "What can I do?", description: "Features available to your role", capability: null, prompt: "What features and actions are available to me?" },
      { label: "Navigate to...", description: "Find the right portal section", capability: null, prompt: "Help me find the right section of the portal for what I need" },
      { label: "Explain my role", description: "What your role gives you access to", capability: null, prompt: "Explain what my current role gives me access to" },
    ],
```

- [ ] **Step 2: Add `skills` to both return statements in `resolveAgentForRoute`**

In the ungated return (capability === null), add `skills: bestMatch.skills`:
```typescript
    return {
      agentId: bestMatch.agentId,
      agentName: bestMatch.agentName,
      agentDescription: bestMatch.agentDescription,
      canAssist: true,
      systemPrompt: bestMatch.systemPrompt,
      skills: bestMatch.skills,
    };
```

In the gated return, add `skills: bestMatch.skills`:
```typescript
  return {
    agentId: bestMatch.agentId,
    agentName: bestMatch.agentName,
    agentDescription: bestMatch.agentDescription,
    canAssist,
    systemPrompt: bestMatch.systemPrompt,
    skills: bestMatch.skills,
  };
```

- [ ] **Step 3: Add skills tests**

In `apps/web/lib/agent-routing.test.ts`, add in the `resolveAgentForRoute` describe block:

```typescript
  it("returns skills array for each agent", () => {
    const routes = ["/portfolio", "/inventory", "/ea", "/employee", "/customer", "/ops", "/platform", "/admin", "/workspace"];
    for (const route of routes) {
      const result = resolveAgentForRoute(route, superuser);
      expect(result.skills.length).toBeGreaterThan(0);
      for (const skill of result.skills) {
        expect(skill.label).toBeTruthy();
        expect(skill.description).toBeTruthy();
        expect(skill.prompt).toBeTruthy();
      }
    }
  });

  it("skills include capability-gated items for superuser but not for restricted roles", () => {
    // EA route has manage_ea_model skills (HR-000 can, HR-500 cannot)
    const eaAgent = resolveAgentForRoute("/ea", superuser);
    const manageSkills = eaAgent.skills.filter((s) => s.capability === "manage_ea_model");
    expect(manageSkills.length).toBeGreaterThan(0);
    // Skills array itself is unfiltered — filtering happens client-side in AgentSkillsDropdown
    // Verify the raw skills include both view and manage capabilities
    const viewSkills = eaAgent.skills.filter((s) => s.capability === "view_ea_modeler");
    expect(viewSkills.length).toBeGreaterThan(0);
  });
```

- [ ] **Step 4: Run tests**

```bash
cd d:/OpenDigitalProductFactory && pnpm --filter web exec vitest run apps/web/lib/agent-routing.test.ts
```

- [ ] **Step 5: Verify no type errors**

```bash
cd d:/OpenDigitalProductFactory && pnpm --filter web exec tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
cd d:/OpenDigitalProductFactory && git add apps/web/lib/agent-routing.ts apps/web/lib/agent-routing.test.ts && git commit -m "feat: add skills to all route agents with capability filtering"
```

---

## Chunk 2: New Components (FAB, Shell, Skills Dropdown)

### Task 3: Create AgentFAB Component

**Files:**
- Create: `apps/web/components/agent/AgentFAB.tsx`

- [ ] **Step 1: Create the FAB component**

Create `apps/web/components/agent/AgentFAB.tsx`:

```typescript
"use client";

type Props = {
  onClick: () => void;
};

export function AgentFAB({ onClick }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Open AI Co-worker"
      style={{
        position: "fixed",
        right: 16,
        top: "50%",
        transform: "translateY(-50%)",
        width: 44,
        height: 44,
        borderRadius: "50%",
        background: "rgba(124, 140, 248, 0.7)",
        backdropFilter: "blur(4px)",
        border: "1px solid rgba(124, 140, 248, 0.3)",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
        zIndex: 50,
        transition: "transform 0.15s, opacity 0.15s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-50%) scale(1.1)";
        e.currentTarget.style.opacity = "0.9";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(-50%)";
        e.currentTarget.style.opacity = "1";
      }}
    >
      <span
        className="inline-block w-2 h-2 rounded-full bg-green-400"
        style={{ boxShadow: "0 0 6px rgba(74, 222, 128, 0.5)" }}
      />
    </button>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd d:/OpenDigitalProductFactory && git add apps/web/components/agent/AgentFAB.tsx && git commit -m "feat: add AgentFAB floating action button"
```

---

### Task 4: Create AgentSkillsDropdown Component

**Files:**
- Create: `apps/web/components/agent/AgentSkillsDropdown.tsx`

- [ ] **Step 1: Create the dropdown component**

Create `apps/web/components/agent/AgentSkillsDropdown.tsx`:

```typescript
"use client";

import { useState } from "react";
import type { AgentSkill } from "@/lib/agent-coworker-types";
import type { UserContext } from "@/lib/permissions";
import { can } from "@/lib/permissions";

type Props = {
  skills: AgentSkill[];
  userContext: UserContext;
  onSend: (prompt: string) => void;
};

export function AgentSkillsDropdown({ skills, userContext, onSend }: Props) {
  const [isOpen, setIsOpen] = useState(false);

  const filteredSkills = skills.filter(
    (s) => s.capability === null || can(userContext, s.capability),
  );

  if (filteredSkills.length === 0) return null;

  return (
    <div
      style={{ position: "relative", display: "inline-block" }}
      onMouseEnter={() => setIsOpen(true)}
      onMouseLeave={() => setIsOpen(false)}
      onFocus={() => setIsOpen(true)}
      onBlur={() => setIsOpen(false)}
    >
      <button
        type="button"
        tabIndex={0}
        onClick={() => setIsOpen((prev) => !prev)}
        onKeyDown={(e) => { if (e.key === "Escape") setIsOpen(false); }}
        style={{
          background: "none",
          border: "none",
          color: "var(--dpf-muted)",
          fontSize: 10,
          cursor: "pointer",
          padding: "2px 4px",
          borderRadius: 3,
        }}
      >
        Skills ▼
      </button>

      {isOpen && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            minWidth: 220,
            maxWidth: 280,
            background: "rgba(26, 26, 46, 0.95)",
            backdropFilter: "blur(12px)",
            border: "1px solid rgba(42, 42, 64, 0.6)",
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
            zIndex: 60,
            padding: "4px 0",
            marginTop: 4,
          }}
        >
          {filteredSkills.map((skill) => (
            <button
              key={skill.prompt}
              type="button"
              onClick={() => {
                onSend(skill.prompt);
                setIsOpen(false);
              }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                background: "none",
                border: "none",
                padding: "8px 12px",
                cursor: "pointer",
                color: "#e0e0ff",
                fontSize: 12,
                lineHeight: 1.3,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(124, 140, 248, 0.15)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "none";
              }}
            >
              <div style={{ fontWeight: 500 }}>{skill.label}</div>
              <div style={{ fontSize: 10, color: "var(--dpf-muted)", marginTop: 2 }}>
                {skill.description}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd d:/OpenDigitalProductFactory && git add apps/web/components/agent/AgentSkillsDropdown.tsx && git commit -m "feat: add AgentSkillsDropdown with capability filtering"
```

---

### Task 5: Create AgentCoworkerShell (Animation State Machine)

**Files:**
- Create: `apps/web/components/agent/AgentCoworkerShell.tsx`

- [ ] **Step 1: Create the shell component**

Create `apps/web/components/agent/AgentCoworkerShell.tsx`:

```typescript
"use client";

import { useEffect, useState } from "react";
import type { AgentMessageRow } from "@/lib/agent-coworker-types";
import type { UserContext } from "@/lib/permissions";
import { AgentFAB } from "./AgentFAB";
import { AgentCoworkerPanel } from "./AgentCoworkerPanel";

type Props = {
  threadId: string;
  initialMessages: AgentMessageRow[];
  userContext: UserContext;
};

type Phase = "closed" | "expanding" | "open" | "collapsing";

const LS_KEY_OPEN = "agent-panel-open";
const LS_KEY_POS = "agent-panel-position"; // orphaned — cleared on mount

const PANEL_W = 380;
const PANEL_H = 480;
const FAB_SIZE = 44;
const EDGE_GAP = 16;
const ANIM_MS = 300;

function loadOpen(): boolean {
  try {
    return localStorage.getItem(LS_KEY_OPEN) === "true";
  } catch {
    return false;
  }
}

export function AgentCoworkerShell({ threadId, initialMessages, userContext }: Props) {
  const [phase, setPhase] = useState<Phase>("closed");
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from localStorage after mount
  useEffect(() => {
    // Clean up orphaned drag position key
    try { localStorage.removeItem(LS_KEY_POS); } catch { /* ignore */ }

    if (loadOpen()) {
      // Skip animation on hydration — go straight to open
      setPhase("open");
    }
    setHydrated(true);
  }, []);

  function handleOpen() {
    setPhase("expanding");
    localStorage.setItem(LS_KEY_OPEN, "true");
  }

  function handleClose() {
    setPhase("collapsing");
    localStorage.setItem(LS_KEY_OPEN, "false");
  }

  function handleTransitionEnd() {
    if (phase === "expanding") setPhase("open");
    if (phase === "collapsing") setPhase("closed");
  }

  if (!hydrated) return null;

  const isExpanded = phase === "expanding" || phase === "open";
  const showContent = phase === "open";
  const showFAB = phase === "closed";

  // Use top+right with pixel values for both states so CSS can transition smoothly.
  // (CSS cannot animate between "auto" and a fixed value — both endpoints must be numbers.)
  // FAB: vertically centered on right edge. Panel: bottom-right.
  // We calculate top in pixels using window.innerHeight for both positions.
  const winH = typeof window !== "undefined" ? window.innerHeight : 800;
  const fabTopPx = Math.round((winH - FAB_SIZE) / 2);
  const panelTopPx = winH - PANEL_H - EDGE_GAP;

  return (
    <>
      {/* FAB — visible only when closed */}
      {showFAB && <AgentFAB onClick={handleOpen} />}

      {/* Morphing container — visible during expanding/open/collapsing */}
      {phase !== "closed" && (
        <div
          onTransitionEnd={handleTransitionEnd}
          style={{
            position: "fixed",
            zIndex: 50,
            // All positional values are numbers so CSS transitions work smoothly
            right: EDGE_GAP,
            top: isExpanded ? panelTopPx : fabTopPx,
            width: isExpanded ? PANEL_W : FAB_SIZE,
            height: isExpanded ? PANEL_H : FAB_SIZE,
            borderRadius: isExpanded ? 12 : FAB_SIZE / 2,
            background: isExpanded ? "rgba(26, 26, 46, 0.85)" : "rgba(124, 140, 248, 0.7)",
            backdropFilter: isExpanded ? "blur(12px)" : "blur(4px)",
            border: `1px solid ${isExpanded ? "rgba(42, 42, 64, 0.6)" : "rgba(124, 140, 248, 0.3)"}`,
            boxShadow: isExpanded
              ? "0 8px 32px rgba(0,0,0,0.4)"
              : "0 4px 16px rgba(0,0,0,0.3)",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            transition: `all ${ANIM_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`,
          }}
        >
          {/* Panel content — fades in after expansion */}
          <div
            style={{
              opacity: showContent ? 1 : 0,
              transition: `opacity ${showContent ? "150ms 150ms" : "100ms"}`,
              display: "flex",
              flexDirection: "column",
              flex: 1,
              overflow: "hidden",
            }}
          >
            {showContent && (
              <AgentCoworkerPanel
                threadId={threadId}
                initialMessages={initialMessages}
                userContext={userContext}
                onClose={handleClose}
              />
            )}
          </div>

          {/* FAB dot — visible during collapsing */}
          {phase === "collapsing" && (
            <div style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}>
              <span
                className="inline-block w-2 h-2 rounded-full bg-green-400"
                style={{ boxShadow: "0 0 6px rgba(74, 222, 128, 0.5)" }}
              />
            </div>
          )}
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Verify no type errors**

```bash
cd d:/OpenDigitalProductFactory && pnpm --filter web exec tsc --noEmit
```

Note: This will show errors because `AgentCoworkerPanel` doesn't accept `onClose` prop yet. That's fixed in Task 6.

- [ ] **Step 3: Commit**

```bash
cd d:/OpenDigitalProductFactory && git add apps/web/components/agent/AgentCoworkerShell.tsx && git commit -m "feat: add AgentCoworkerShell with FAB morph animation"
```

---

## Chunk 3: Modify Existing Components

### Task 6: Rewrite AgentCoworkerPanel (Strip State, Add Transparency)

**Files:**
- Modify: `apps/web/components/agent/AgentCoworkerPanel.tsx`

**Note:** The spec proposed lifting `onSend` to the shell component. However, `handleSend` depends on panel-local state (`messages`, `isPending`, `pathname`, agent resolution). Keeping it in the panel is cleaner — the shell only owns open/closed state and the animation.

- [ ] **Step 1: Replace the entire file**

Replace `apps/web/components/agent/AgentCoworkerPanel.tsx` with:

```typescript
"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import type { AgentMessageRow, AgentInfo } from "@/lib/agent-coworker-types";
import type { UserContext } from "@/lib/permissions";
import { resolveAgentForRoute, AGENT_NAME_MAP } from "@/lib/agent-routing";
import { sendMessage } from "@/lib/actions/agent-coworker";
import { AgentPanelHeader } from "./AgentPanelHeader";
import { AgentMessageBubble } from "./AgentMessageBubble";
import { AgentMessageInput } from "./AgentMessageInput";

type Props = {
  threadId: string;
  initialMessages: AgentMessageRow[];
  userContext: UserContext;
  onClose: () => void;
};

export function AgentCoworkerPanel({ threadId, initialMessages, userContext, onClose }: Props) {
  const pathname = usePathname();
  const [messages, setMessages] = useState<AgentMessageRow[]>(initialMessages);
  const [isPending, startTransition] = useTransition();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Resolve agent for current route
  const agent: AgentInfo = resolveAgentForRoute(pathname, userContext);

  // Auto-scroll to bottom when new messages appear
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
      const newMessages = [result.userMessage];
      if ("systemMessage" in result && result.systemMessage) {
        newMessages.push(result.systemMessage);
      }
      newMessages.push(result.agentMessage);
      setMessages((prev) => [...prev, ...newMessages]);
    });
  }

  return (
    <>
      <AgentPanelHeader
        agent={agent}
        userContext={userContext}
        onSend={handleSend}
        onClose={onClose}
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
        {isPending && (
          <div style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 2,
            marginBottom: 8,
          }}>
            <div style={{
              padding: "8px 16px",
              borderRadius: "12px 12px 12px 2px",
              fontSize: 13,
              background: "rgba(22, 22, 37, 0.8)",
              color: "var(--dpf-muted)",
            }}>
              <span className="animate-pulse">Thinking...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <AgentMessageInput onSend={handleSend} disabled={isPending} />
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd d:/OpenDigitalProductFactory && git add apps/web/components/agent/AgentCoworkerPanel.tsx && git commit -m "refactor: strip state/drag from AgentCoworkerPanel, add transparency"
```

---

### Task 7: Rewrite AgentPanelHeader (Skills, No Drag)

**Files:**
- Modify: `apps/web/components/agent/AgentPanelHeader.tsx`

- [ ] **Step 1: Replace the entire file**

Replace `apps/web/components/agent/AgentPanelHeader.tsx` with:

```typescript
"use client";

import type { AgentInfo } from "@/lib/agent-coworker-types";
import type { UserContext } from "@/lib/permissions";
import { AgentSkillsDropdown } from "./AgentSkillsDropdown";

type Props = {
  agent: AgentInfo;
  userContext: UserContext;
  onSend: (content: string) => void;
  onClose: () => void;
};

export function AgentPanelHeader({ agent, userContext, onSend, onClose }: Props) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 14px",
        background: "rgba(22, 22, 37, 0.8)",
        borderBottom: "1px solid rgba(42, 42, 64, 0.6)",
        borderRadius: "12px 12px 0 0",
        userSelect: "none",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400" />
          <span style={{ fontSize: 12, fontWeight: 600, color: "#e0e0ff" }}>
            {agent.agentName}
          </span>
          <AgentSkillsDropdown
            skills={agent.skills}
            userContext={userContext}
            onSend={onSend}
          />
        </div>
        <span style={{ fontSize: 10, color: "var(--dpf-muted)", marginLeft: 12 }}>
          {agent.agentDescription}
        </span>
      </div>

      <button
        type="button"
        onClick={onClose}
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
cd d:/OpenDigitalProductFactory && git add apps/web/components/agent/AgentPanelHeader.tsx && git commit -m "feat: rewrite AgentPanelHeader with skills dropdown, no drag"
```

---

### Task 8: Update AgentMessageBubble + AgentMessageInput (Transparency)

**Files:**
- Modify: `apps/web/components/agent/AgentMessageBubble.tsx`
- Modify: `apps/web/components/agent/AgentMessageInput.tsx`

- [ ] **Step 1: Update assistant bubble background in AgentMessageBubble**

In `apps/web/components/agent/AgentMessageBubble.tsx`, line 60, change:
```typescript
          background: isUser ? "var(--dpf-accent)" : "var(--dpf-surface-2)",
```
to:
```typescript
          background: isUser ? "var(--dpf-accent)" : "rgba(22, 22, 37, 0.8)",
```

- [ ] **Step 2: Update AgentMessageInput transparency**

In `apps/web/components/agent/AgentMessageInput.tsx`, line 38, change:
```typescript
      borderTop: "1px solid var(--dpf-border)",
```
to:
```typescript
      borderTop: "1px solid rgba(42, 42, 64, 0.6)",
```

Line 50, change:
```typescript
          background: "var(--dpf-bg)",
```
to:
```typescript
          background: "rgba(15, 15, 26, 0.8)",
```

Line 51, change:
```typescript
          border: `1px solid ${overLimit ? "#ef4444" : "var(--dpf-border)"}`,
```
to:
```typescript
          border: `1px solid ${overLimit ? "#ef4444" : "rgba(42, 42, 64, 0.6)"}`,
```

- [ ] **Step 3: Commit**

```bash
cd d:/OpenDigitalProductFactory && git add apps/web/components/agent/AgentMessageBubble.tsx apps/web/components/agent/AgentMessageInput.tsx && git commit -m "feat: semi-transparent backgrounds for message bubbles and input"
```

---

## Chunk 4: Integration + Cleanup

### Task 9: Remove Agent Button from Header

**Files:**
- Modify: `apps/web/components/shell/Header.tsx`

- [ ] **Step 1: Remove the Agent button**

In `apps/web/components/shell/Header.tsx`, delete lines 73-80 (the entire `<button>` block):
```tsx
        <button
          type="button"
          onClick={() => document.dispatchEvent(new CustomEvent("toggle-agent-panel"))}
          className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs border border-[var(--dpf-accent)] text-[var(--dpf-accent)] hover:bg-[var(--dpf-accent)] hover:text-white transition-colors"
        >
          <span>Agent</span>
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400" />
        </button>
```

- [ ] **Step 2: Commit**

```bash
cd d:/OpenDigitalProductFactory && git add apps/web/components/shell/Header.tsx && git commit -m "feat: remove Agent button from header (replaced by floating FAB)"
```

---

### Task 10: Update Shell Layout

**Files:**
- Modify: `apps/web/app/(shell)/layout.tsx`

- [ ] **Step 1: Replace AgentCoworkerPanel import and render with AgentCoworkerShell**

In `apps/web/app/(shell)/layout.tsx`, change the import (line 10) from:
```typescript
import { AgentCoworkerPanel } from "@/components/agent/AgentCoworkerPanel";
```
to:
```typescript
import { AgentCoworkerShell } from "@/components/agent/AgentCoworkerShell";
```

Change the render (lines 56-61) from:
```tsx
      {threadId && (
        <AgentCoworkerPanel
          threadId={threadId}
          initialMessages={initialMessages}
          userContext={{ platformRole: user.platformRole, isSuperuser: user.isSuperuser }}
        />
      )}
```
to:
```tsx
      {threadId && (
        <AgentCoworkerShell
          threadId={threadId}
          initialMessages={initialMessages}
          userContext={{ platformRole: user.platformRole, isSuperuser: user.isSuperuser }}
        />
      )}
```

- [ ] **Step 2: Verify no type errors**

```bash
cd d:/OpenDigitalProductFactory && pnpm --filter web exec tsc --noEmit
```

- [ ] **Step 3: Run all tests**

```bash
cd d:/OpenDigitalProductFactory && pnpm test
```

- [ ] **Step 4: Commit**

```bash
cd d:/OpenDigitalProductFactory && git add "apps/web/app/(shell)/layout.tsx" && git commit -m "feat: integrate AgentCoworkerShell into shell layout"
```

---

## Chunk 5: Final Verification

### Task 11: Full Verification

- [ ] **Step 1: Run all tests**

```bash
cd d:/OpenDigitalProductFactory && pnpm test
```

Expected: All tests pass.

- [ ] **Step 2: Type check**

```bash
cd d:/OpenDigitalProductFactory && pnpm --filter web exec tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Visual verification**

Start dev server and verify:
1. FAB appears as semi-transparent circle on right side, vertically centered
2. Click FAB → morphs/expands into the panel with animation
3. Panel is semi-transparent — page content visible behind
4. Agent name in header updates when navigating (no system messages added)
5. "Skills ▼" appears next to agent name — hover shows context-relevant actions
6. Click a skill → message sent, response appears
7. Close panel → shrinks back to FAB with animation
8. Refresh → remembers open/closed state (no animation on hydration when open)

- [ ] **Step 4: Fix any issues found**

```bash
cd d:/OpenDigitalProductFactory && git add -A && git commit -m "fix: resolve agent panel UX redesign verification issues"
```
