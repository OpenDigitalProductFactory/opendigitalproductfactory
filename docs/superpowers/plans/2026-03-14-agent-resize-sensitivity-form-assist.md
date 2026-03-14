# Agent Resize, Sensitivity, and Form Assist Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the coworker panel resizable, add route sensitivity policy for provider selection, and support human-approved agent form filling without form submission.

**Architecture:** Extend the current route-aware coworker stack with route metadata for sensitivity, persisted panel sizing and elevated assist preferences, and a structured form-assist adapter that pages opt into. Keep the human-in-the-loop boundary by allowing field updates only, not submit.

**Tech Stack:** Next.js App Router, React, TypeScript, Prisma, Vitest

---

## File Map

- Modify: `apps/web/components/agent/AgentCoworkerShell.tsx`
  - add resize state, persistence, and viewport clamping
- Modify: `apps/web/components/agent/AgentCoworkerPanel.tsx`
  - surface elevated assist controls and policy cues
- Modify: `apps/web/components/agent/AgentPanelHeader.tsx`
  - add yellow elevated-assist indicator and toggle affordance
- Modify: `apps/web/lib/agent-routing.ts`
  - add route sensitivity metadata and provider policy resolution
- Modify: `apps/web/lib/actions/agent-coworker.ts`
  - include sensitivity and form-assist context in the server action path
- Create: `apps/web/lib/agent-sensitivity.ts`
  - route sensitivity resolution and provider allowance logic
- Create: `apps/web/lib/agent-form-assist.ts`
  - types and helper functions for structured form assist adapters
- Create or modify: preference persistence files as needed based on current repo patterns
- Add tests in:
  - `apps/web/components/agent/AgentCoworkerShell.test.tsx`
  - `apps/web/components/agent/AgentPanelHeader.test.tsx`
  - `apps/web/lib/agent-sensitivity.test.ts`
  - `apps/web/lib/actions/agent-coworker.test.ts`
  - form-specific tests for the first integrated form

## Chunk 1: Sensitivity and Provider Policy

### Task 1: Add route sensitivity metadata

**Files:**
- Create: `apps/web/lib/agent-sensitivity.ts`
- Modify: `apps/web/lib/agent-routing.ts`
- Test: `apps/web/lib/agent-sensitivity.test.ts`

- [ ] **Step 1: Write failing tests for sensitivity resolution**

Cover:
- route-to-sensitivity mapping
- allowed provider sets for each sensitivity level
- fallback behavior when no provider is allowed

- [ ] **Step 2: Run the targeted test command and confirm failure**

Run:
`pnpm --filter web test -- lib/agent-sensitivity.test.ts`

- [ ] **Step 3: Implement `agent-sensitivity.ts`**

Add:
- sensitivity type
- route lookup helper
- provider policy helper

- [ ] **Step 4: Wire route agent resolution to include sensitivity metadata**

Keep current route specialist behavior intact while exposing sensitivity.

- [ ] **Step 5: Re-run the targeted tests**

Run:
`pnpm --filter web test -- lib/agent-sensitivity.test.ts`

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/agent-sensitivity.ts apps/web/lib/agent-routing.ts apps/web/lib/agent-sensitivity.test.ts
git commit -m "feat: add route sensitivity policy for coworker agents"
```

## Chunk 2: Resizable Coworker Panel

### Task 2: Add panel resize behavior and persistence

**Files:**
- Modify: `apps/web/components/agent/AgentCoworkerShell.tsx`
- Test: `apps/web/components/agent/AgentCoworkerShell.test.tsx`

- [ ] **Step 1: Write failing tests for resize persistence and viewport clamping**

Cover:
- restoring stored size
- clamping oversize dimensions
- preserving drag behavior

- [ ] **Step 2: Run the targeted test command and confirm failure**

Run:
`pnpm --filter web test -- components/agent/AgentCoworkerShell.test.tsx`

- [ ] **Step 3: Implement resizable shell behavior**

Add:
- width and height state
- resize handle
- persisted dimensions
- window-resize clamping

- [ ] **Step 4: Re-run the targeted tests**

Run:
`pnpm --filter web test -- components/agent/AgentCoworkerShell.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/agent/AgentCoworkerShell.tsx apps/web/components/agent/AgentCoworkerShell.test.tsx
git commit -m "feat: make coworker panel resizable"
```

## Chunk 3: Elevated Assist Preference and Header Cues

### Task 3: Add per-user per-route elevated assist state

**Files:**
- Modify: `apps/web/components/agent/AgentCoworkerPanel.tsx`
- Modify: `apps/web/components/agent/AgentPanelHeader.tsx`
- Modify: preference persistence files as required by current repo patterns
- Test: `apps/web/components/agent/AgentPanelHeader.test.tsx`
- Test: `apps/web/lib/actions/agent-coworker.test.ts`

- [ ] **Step 1: Write failing tests for elevated assist indicator and toggle behavior**

Cover:
- yellow indicator rendering
- enabled state persistence
- route-scoped behavior

- [ ] **Step 2: Run the targeted test commands and confirm failure**

Run:
`pnpm --filter web test -- components/agent/AgentPanelHeader.test.tsx lib/actions/agent-coworker.test.ts`

- [ ] **Step 3: Implement elevated assist persistence**

Prefer a user-aware persisted preference keyed by route.

- [ ] **Step 4: Implement the header indicator and toggle**

The indicator should be visibly yellow and present only when elevated assist is active.

- [ ] **Step 5: Re-run the targeted tests**

Run:
`pnpm --filter web test -- components/agent/AgentPanelHeader.test.tsx lib/actions/agent-coworker.test.ts`

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/agent/AgentCoworkerPanel.tsx apps/web/components/agent/AgentPanelHeader.tsx apps/web/lib/actions/agent-coworker.ts
git commit -m "feat: add elevated form assist preference for coworker"
```

## Chunk 4: Structured Form Assist Adapter

### Task 4: Add the form assist interface and wire one form

**Files:**
- Create: `apps/web/lib/agent-form-assist.ts`
- Modify: one representative form component in the portal
- Modify: `apps/web/lib/actions/agent-coworker.ts`
- Test: form-specific test file
- Test: `apps/web/lib/actions/agent-coworker.test.ts`

- [ ] **Step 1: Write failing tests for structured field updates**

Cover:
- registered field metadata
- safe field update application
- no submit path

- [ ] **Step 2: Run the targeted tests and confirm failure**

Run:
`pnpm --filter web test -- <form test file> lib/actions/agent-coworker.test.ts`

- [ ] **Step 3: Implement `agent-form-assist.ts`**

Add:
- field metadata types
- adapter contract
- structured update payload helpers

- [ ] **Step 4: Wire one real form to opt in**

Choose a representative portal form with manageable scope.

- [ ] **Step 5: Pass structured form context into the coworker action path**

Only when elevated assist is enabled and the page has opted in.

- [ ] **Step 6: Re-run the targeted tests**

Run:
`pnpm --filter web test -- <form test file> lib/actions/agent-coworker.test.ts`

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/agent-form-assist.ts apps/web/lib/actions/agent-coworker.ts <form files>
git commit -m "feat: add structured agent form assist"
```

## Chunk 5: Full Verification

### Task 5: Run branch-level verification

**Files:**
- No code changes unless verification exposes defects

- [ ] **Step 1: Run focused web tests**

Run:
`pnpm --filter web test -- components/agent/AgentCoworkerShell.test.tsx components/agent/AgentPanelHeader.test.tsx lib/agent-sensitivity.test.ts lib/actions/agent-coworker.test.ts <form test file>`

- [ ] **Step 2: Run typecheck**

Run:
`pnpm --filter web typecheck`

- [ ] **Step 3: Run production build**

Run:
`$env:DATABASE_URL='postgresql://dpf:dpf_dev@localhost:5432/dpf'; pnpm --filter web build`

- [ ] **Step 4: Commit any verification-driven fixes**

```bash
git add <changed files>
git commit -m "fix: address verification issues for coworker assist controls"
```
