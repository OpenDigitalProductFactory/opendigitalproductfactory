# Agent Panel UX Redesign — Design Spec

**Date:** 2026-03-14
**Goal:** Redesign the agent co-worker panel for a more polished, non-intrusive experience: floating animated FAB, semi-transparent panel, clean route transitions without chat clutter, and a context-aware skills dropdown.

---

## 1. Floating Agent Button (FAB)

### Current State
The Agent button lives in `Header.tsx` (line 73-79) as a pill-shaped button that dispatches `CustomEvent("toggle-agent-panel")`.

### New Behavior
- **Remove** the Agent button from `Header.tsx` entirely.
- **Add** a new floating action button (FAB) rendered in the shell layout, visually centered on the right edge of the viewport.
- **Position:** `position: fixed`, `right: 16px`, `top: 50%`, `transform: translateY(-50%)`.
- **Visual:** 44px circle, `background: rgba(124, 140, 248, 0.7)`, `backdrop-filter: blur(4px)`, green status dot centered, subtle box-shadow. On hover: opacity increases to 0.9, slight scale-up (`transform: scale(1.1)`).
- **Hidden when panel is open** — the FAB disappears during the expanding/open states and reappears when the panel collapses back.

### Morph Animation (FAB ↔ Panel)
The FAB and panel are wrapped in a single `AgentCoworkerShell` component that manages the animation state machine:

**States:** `closed → expanding → open → collapsing → closed`

**Open animation (~300ms):**
1. FAB begins transitioning: `width`, `height`, `border-radius`, `top`, `left`/`right` animate from circle (44px, 50% border-radius) to panel dimensions (380x480, 12px border-radius)
2. Panel content (header, messages, input) fades in after expansion completes (opacity 0→1, ~150ms delay)

**Close animation (~300ms):**
1. Panel content fades out (~100ms)
2. Container shrinks from panel dimensions back to FAB circle, slides to FAB position
3. FAB dot reappears

**Implementation:** CSS `transition` on the wrapper div's dimensional properties. React state drives the phase: `closed | expanding | open | collapsing`. `onTransitionEnd` advances to the next phase. No animation library needed.

**localStorage:** The `agent-panel-open` key continues to persist open/closed state. On page load, if saved state is "open", skip the animation and render the panel directly (no animation on hydration).

---

## 2. Semi-transparent Panel

### Background Changes

All solid backgrounds become alpha + blur:

| Element | Current | New |
|---------|---------|-----|
| Panel background | `var(--dpf-surface-1)` solid | `rgba(26, 26, 46, 0.85)` + `backdrop-filter: blur(12px)` |
| Panel border | `var(--dpf-border)` solid | `rgba(42, 42, 64, 0.6)` |
| Panel header | `var(--dpf-surface-2)` solid | `rgba(22, 22, 37, 0.8)` |
| Assistant bubbles | `var(--dpf-surface-2)` solid | `rgba(22, 22, 37, 0.8)` |
| Input area bg | `var(--dpf-bg)` solid | `rgba(15, 15, 26, 0.8)` |
| Input border | `var(--dpf-border)` solid | `rgba(42, 42, 64, 0.6)` |

**Unchanged:** User message bubbles stay opaque `var(--dpf-accent)` — they should stand out clearly. System messages (muted italic text) are already transparent by nature.

---

## 3. Clean Route Transitions

### Current State
When the user navigates to a different route, the panel inserts a system message like *"EA Architect has joined the conversation"* via an optimistic client-side insert + fire-and-forget `recordAgentTransition` server action. This clutters the conversation when navigating frequently.

### New Behavior
- **Remove** the agent transition `useEffect` from `AgentCoworkerPanel` that watches `agent.agentId` changes and inserts system messages.
- **Remove** the call to `recordAgentTransition` server action (the server action itself can remain for backward compatibility but is no longer called).
- The **panel header agent name** updates automatically when the route changes (it already does — `resolveAgentForRoute` runs on every render with the current pathname).
- **No visual signal** beyond the header name change. The conversation flow stays clean.
- Existing transition messages already stored in the DB continue to render normally as system messages — no migration needed to remove them.

---

## 4. Skills Dropdown

### New Type

Add to `apps/web/lib/agent-coworker-types.ts`:

```typescript
export type AgentSkill = {
  label: string;             // "Create a view"
  description: string;       // "Start a new EA view with a viewpoint"
  capability: CapabilityKey | null;  // null = available to all
  prompt: string;            // Pre-filled message sent to the agent on click
};
```

### Type Changes

- `RouteAgentEntry` gains `skills: AgentSkill[]`
- `AgentInfo` gains `skills: AgentSkill[]`
- `resolveAgentForRoute` returns `skills` (already passes through all fields from the matched entry)

### Data Source

Each entry in `ROUTE_AGENT_MAP` gains a `skills` array. Skills are defined statically in code alongside system prompts. The number of skills per agent varies — typically 3-5 per agent.

Example skills:

**portfolio-advisor:**
- "Show health summary" (`view_portfolio`) — "Summarize the health metrics for this portfolio"
- "Explain budget allocation" (`view_portfolio`) — "Explain how the budget is allocated across this portfolio"
- "Find a product" (`view_portfolio`) — "Help me find a specific digital product in the portfolio"

**ea-architect:**
- "Create a view" (`manage_ea_model`) — "Help me create a new EA view"
- "Add an element" (`manage_ea_model`) — "Guide me through adding a new element to this view"
- "Map a relationship" (`manage_ea_model`) — "Help me create a relationship between two elements"
- "Explain a viewpoint" (`view_ea_modeler`) — "Explain what this viewpoint allows and restricts"

**ops-coordinator:**
- "Create backlog item" (`manage_backlog`) — "Help me create a new backlog item"
- "Summarize epic progress" (`view_operations`) — "Give me a summary of the current epic progress"
- "Prioritize items" (`manage_backlog`) — "Help me prioritize the open backlog items"

**platform-engineer:**
- "Configure a provider" (`manage_provider_connections`) — "Help me configure an AI provider"
- "Review token spend" (`view_platform`) — "Show me a summary of token usage and costs"
- "Run optimization" (`manage_provider_connections`) — "Run the provider priority optimization now"

**workspace-guide:**
- "What can I do here?" (null) — "What features and actions are available to me?"
- "Navigate to..." (null) — "Help me find the right section of the portal for what I need"
- "Explain my role" (null) — "Explain what my current role gives me access to"

Other agents (inventory-specialist, hr-specialist, customer-advisor, admin-assistant) follow the same pattern with 2-4 skills each.

### Filtering

Skills are filtered client-side using `can(userContext, skill.capability)`. A skill with `capability: null` is visible to everyone. Higher-level HR roles see more skills because they have more capabilities.

### UX

- In `AgentPanelHeader`, next to the agent name: a small "Skills ▼" label.
- **Hover** on "Skills ▼" → dropdown appears below the header with skill labels and short descriptions.
- **Click a skill** → dropdown closes, the skill's `prompt` is sent as a message (reuses the existing `onSend` callback from `AgentMessageInput`). The agent responds via normal inference.
- **Mouse leave** → dropdown closes.
- Dropdown is a positioned `<div>` with `onMouseEnter`/`onMouseLeave` on the trigger area. No external library.

---

## 5. Component Architecture

### New Components

| Component | File | Responsibility |
|-----------|------|---------------|
| `AgentCoworkerShell` | `apps/web/components/agent/AgentCoworkerShell.tsx` | Wraps FAB + panel. Manages animation state machine (`closed/expanding/open/collapsing`). Renders FAB when closed, panel when open, animated transition between. |
| `AgentFAB` | `apps/web/components/agent/AgentFAB.tsx` | The floating circle button. Green dot, semi-transparent. onClick triggers expansion. |
| `AgentSkillsDropdown` | `apps/web/components/agent/AgentSkillsDropdown.tsx` | Hover-triggered dropdown listing filtered skills. Calls `onSelectSkill(prompt)` on click. |

### Modified Components

| Component | Change |
|-----------|--------|
| `AgentCoworkerPanel` | Remove transition `useEffect`. Semi-transparent styles. Accept `onClose` and `onSendSkill` props. |
| `AgentPanelHeader` | Add skills dropdown trigger. Pass `skills` and `userContext` props. |
| `AgentMessageBubble` | Semi-transparent background for assistant bubbles. |
| `Header.tsx` | Remove Agent button (the `<button>` with `CustomEvent("toggle-agent-panel")`). |

### Removed

| Item | Reason |
|------|--------|
| `CustomEvent("toggle-agent-panel")` listener in `AgentCoworkerPanel` | FAB and panel are now siblings in `AgentCoworkerShell`, no cross-component events needed |
| Agent transition `useEffect` in `AgentCoworkerPanel` | No more transition system messages |
| `document.addEventListener("toggle-agent-panel")` | Replaced by direct state management in shell |

### Shell Layout Change

`apps/web/app/(shell)/layout.tsx` renders `AgentCoworkerShell` instead of `AgentCoworkerPanel`:

```tsx
<AgentCoworkerShell
  threadId={threadId}
  initialMessages={initialMessages}
  userContext={{ platformRole: user.platformRole, isSuperuser: user.isSuperuser }}
/>
```

Same props — the shell component passes them through to the panel when it's open.

---

## 6. Files Affected

### New Files
| File | Responsibility |
|------|---------------|
| `apps/web/components/agent/AgentCoworkerShell.tsx` | Animation state machine, FAB ↔ panel morph |
| `apps/web/components/agent/AgentFAB.tsx` | Floating action button |
| `apps/web/components/agent/AgentSkillsDropdown.tsx` | Hover dropdown for context skills |

### Modified Files
| File | Change |
|------|--------|
| `apps/web/lib/agent-coworker-types.ts` | Add `AgentSkill` type; add `skills` to `RouteAgentEntry` and `AgentInfo` |
| `apps/web/lib/agent-routing.ts` | Add `skills` arrays to `ROUTE_AGENT_MAP`; return via `resolveAgentForRoute` |
| `apps/web/components/agent/AgentCoworkerPanel.tsx` | Semi-transparent styles; remove transition useEffect + CustomEvent listener; accept onClose/onSendSkill props |
| `apps/web/components/agent/AgentPanelHeader.tsx` | Add skills dropdown trigger; accept skills/userContext props |
| `apps/web/components/agent/AgentMessageBubble.tsx` | Semi-transparent assistant bubble background |
| `apps/web/components/shell/Header.tsx` | Remove Agent button |
| `apps/web/app/(shell)/layout.tsx` | Render `AgentCoworkerShell` instead of `AgentCoworkerPanel` |

### No Schema Changes
No Prisma migrations. No new server actions. Skills use the existing `sendMessage` flow.

---

## 7. Testing Strategy

- **Unit tests for skills filtering**: Verify `can()` correctly filters skills by user capability — HR-000 sees all, HR-500 sees ops skills, null-role sees only null-capability skills
- **Unit test for AgentSkill on every agent**: Verify each agent in the map has at least 1 skill
- **Component tests**: Verify `AgentCoworkerShell` renders FAB when closed, panel when open (state transitions)
- **Visual verification**: Animation smoothness, transparency effect, skills dropdown positioning
- **No animation unit tests** — CSS transitions are verified visually, not programmatically
