# Agent Hands On Labels Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the coworker elevated-assist UI from `Fill` / `Form fill enabled` to `Hands Off` / `Hands On`.

**Architecture:** Update only the coworker header component and its focused test. Keep the underlying elevated-assist logic untouched and verify the wording change with a red-green test cycle.

**Tech Stack:** React, TypeScript, Vitest

---

## Chunk 1: Header Terminology

### Task 1: Update the coworker header labels

**Files:**
- Modify: `apps/web/components/agent/AgentPanelHeader.tsx`
- Test: `apps/web/components/agent/AgentPanelHeader.test.tsx`

- [ ] **Step 1: Write the failing test**

Update the header test to expect:
- `Hands Off` when assist is disabled
- `Hands On` when assist is enabled

- [ ] **Step 2: Run test to verify it fails**

Run:
`pnpm --filter web test -- components/agent/AgentPanelHeader.test.tsx`

- [ ] **Step 3: Write minimal implementation**

Change:
- button label text
- yellow badge text
- tooltip wording if needed

- [ ] **Step 4: Run test to verify it passes**

Run:
`pnpm --filter web test -- components/agent/AgentPanelHeader.test.tsx`

- [ ] **Step 5: Run focused typecheck**

Run:
`pnpm --filter web typecheck`

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/agent/AgentPanelHeader.tsx apps/web/components/agent/AgentPanelHeader.test.tsx
git commit -m "feat: rename coworker assist toggle to hands on"
```
