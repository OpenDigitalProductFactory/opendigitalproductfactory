# Self-Upgrade Purpose Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/ops/self-upgrade` answer the operator's immediate question: whether the update needs attention and what single safe next action exists.

**Architecture:** Keep data fetching unchanged. Extract a small operator-facing summary model from `SelfUpgradeClient`, then render default content around that model while moving technical identity, schedule detail, release impact, and history into named disclosures.

**Tech Stack:** Next.js 16, React server/static render tests, Vitest, existing DPF design tokens/components.

---

## Chunk 1: Operator Summary Contract

### Task 1: Add failing tests for the default page contract

**Files:**
- Modify: `apps/web/components/ops/SelfUpgradeClient.test.tsx`
- Modify: `apps/web/components/ops/SelfUpgradeClient.tsx`

- [ ] **Step 1: Write failing tests**

Add tests proving:
- queued/running state shows one primary status region with "No action needed" language.
- queued/running state does not show "Update available" or "Up to date" as competing default status labels.
- technical SHA/build identity appears under a "Technical details" disclosure, not as first-level status text.
- schedule detail appears once in the default rendered output.

- [ ] **Step 2: Run the targeted test and verify RED**

Run: `pnpm --filter web exec vitest run apps/web/components/ops/SelfUpgradeClient.test.tsx`

Expected: at least one new assertion fails because current output contains competing labels and first-level diagnostics.

- [ ] **Step 3: Implement the minimal derived summary model**

Add a local helper near existing formatting helpers:

```ts
type OperatorUpgradeState = {
  tone: "info" | "success" | "warning" | "danger";
  headline: string;
  actionLabel: string;
  detail: string;
};
```

Derive it from `latestRun`, `quiescence`, `enabled`, `isFresh`, and `inMaintenanceWindow`.

- [ ] **Step 4: Render one primary status card from that model**

Replace competing first-level status chips with a single card that carries `data-operator-upgrade-state`.

- [ ] **Step 5: Run the targeted test and verify GREEN**

Run: `pnpm --filter web exec vitest run apps/web/components/ops/SelfUpgradeClient.test.tsx`

Expected: new tests pass and existing tests still pass.

## Chunk 2: Progressive Disclosure

### Task 2: Move secondary content behind purpose-named disclosures

**Files:**
- Modify: `apps/web/components/ops/SelfUpgradeClient.tsx`
- Modify: `apps/web/components/ops/SelfUpgradeClient.test.tsx`

- [ ] **Step 1: Write failing disclosure tests**

Assert that the rendered page contains these groups:
- `What changed`
- `Timing and safety`
- `Technical details`
- `Run history and logs`

Assert the raw `Platform version:` label only appears inside the technical details section.

- [ ] **Step 2: Verify RED**

Run the same targeted Vitest command.

- [ ] **Step 3: Reorder JSX into named disclosure sections**

Keep existing content but change default hierarchy:
- Summary card first.
- Optional active run progress second.
- Disclosure sections after.
- Remove duplicated maintenance-window sentence.

- [ ] **Step 4: Verify GREEN**

Run the same targeted Vitest command.

## Chunk 3: Refactor Budget

### Task 3: Extract pure helpers and reduce component responsibility

**Files:**
- Modify: `apps/web/components/ops/SelfUpgradeClient.tsx`
- Optional create: `apps/web/components/ops/self-upgrade-view-model.ts`
- Optional test: `apps/web/components/ops/self-upgrade-view-model.test.ts`

- [ ] **Step 1: Move pure summary/state helpers out of JSX**

Extract only if it meaningfully reduces `SelfUpgradeClient.tsx` complexity without forcing broad imports.

- [ ] **Step 2: Run focused tests**

Run: `pnpm --filter web exec vitest run apps/web/components/ops/SelfUpgradeClient.test.tsx`

- [ ] **Step 3: Check formatting/type safety for touched files**

Run: `pnpm --filter web exec tsc --noEmit`

## Chunk 4: Backlog Capture

### Task 4: Update UX backlog item when DPF API accepts writes

**Files:**
- No source files.

- [ ] **Step 1: Update `BI-D77BF495` or create a dedicated child if the existing item is too narrow**

Capture these acceptance criteria:
- page has one canonical status state.
- default viewport gives one next action/no-action answer.
- diagnostics/logs/release notes/help content use progressive disclosure.
- AI/operator navigation placement is reviewed as part of the page-family UX epic.

- [ ] **Step 2: Link to `EP-UX-SYSTEM`**

Use DPF backlog tools, not seed edits.
