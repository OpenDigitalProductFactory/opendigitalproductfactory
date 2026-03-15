# Agent Chat Send Polish Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the native erase confirmation with a portal-styled popover and make user messages appear immediately with sending and failed states.

**Architecture:** Keep all behavior local to the coworker panel. Introduce a small client-side optimistic message state layer in the panel, surface status rendering through the existing bubble component, and replace `window.confirm` with a lightweight anchored confirmation popover in the header.

**Tech Stack:** Next.js app router, React client components, TypeScript, Vitest

---

## File Map

- Modify: `apps/web/components/agent/AgentCoworkerPanel.tsx`
  - own optimistic local user message state and erase-confirmation state
- Modify: `apps/web/components/agent/AgentPanelHeader.tsx`
  - replace direct erase action with anchored confirmation popover UI
- Modify: `apps/web/components/agent/AgentMessageBubble.tsx`
  - render optimistic user message status and retry affordance
- Modify: `apps/web/components/agent/AgentMessageInput.tsx`
  - preserve immediate local submit behavior contract if needed
- Create or modify tests under:
  - `apps/web/components/agent/AgentCoworkerPanel.test.tsx`
  - `apps/web/components/agent/AgentPanelHeader.test.tsx`
  - `apps/web/components/agent/AgentMessageBubble.test.tsx`

## Chunk 1: Erase Confirmation Popover

### Task 1: Add failing header test for styled erase confirmation

**Files:**
- Modify: `apps/web/components/agent/AgentPanelHeader.test.tsx`

- [ ] **Step 1: Write the failing test**

Add a test that renders the header, triggers the erase control, and expects inline confirmation content such as `Erase this page conversation?`, `Cancel`, and `Erase`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cmd /c "D:\OpenDigitalProductFactory\apps\web\node_modules\.bin\vitest.CMD run components/agent/AgentPanelHeader.test.tsx --reporter=basic"`

Expected: FAIL because the header still calls the erase handler directly and renders no confirmation popover.

- [ ] **Step 3: Write minimal implementation**

Update `AgentPanelHeader.tsx` to:
- track whether the erase popover is open
- replace direct clear action on first click with popover open
- render portal-styled confirmation content adjacent to the `Erase` button
- call `onClear()` only from the confirmation action
- support `Cancel`

- [ ] **Step 4: Run test to verify it passes**

Run: `cmd /c "D:\OpenDigitalProductFactory\apps\web\node_modules\.bin\vitest.CMD run components/agent/AgentPanelHeader.test.tsx --reporter=basic"`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/agent/AgentPanelHeader.tsx apps/web/components/agent/AgentPanelHeader.test.tsx
git commit -m "feat: add coworker erase confirmation popover"
```

## Chunk 2: Optimistic User Message State

### Task 2: Add failing panel test for immediate local echo

**Files:**
- Modify or Create: `apps/web/components/agent/AgentCoworkerPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

Add a test that submits a message and immediately expects the user message to appear in the transcript before the mocked server action resolves, with a visible `Sending...` state.

- [ ] **Step 2: Run test to verify it fails**

Run: `cmd /c "D:\OpenDigitalProductFactory\apps\web\node_modules\.bin\vitest.CMD run components/agent/AgentCoworkerPanel.test.tsx --reporter=basic"`

Expected: FAIL because the panel currently appends the user message only after `sendMessage()` resolves.

- [ ] **Step 3: Write minimal implementation**

Update `AgentCoworkerPanel.tsx` to:
- create temporary optimistic user messages on submit
- append them to local state immediately
- clear the input immediately through the existing input behavior
- reconcile optimistic rows with the eventual server response
- keep server assistant and system message behavior intact

- [ ] **Step 4: Run test to verify it passes**

Run: `cmd /c "D:\OpenDigitalProductFactory\apps\web\node_modules\.bin\vitest.CMD run components/agent/AgentCoworkerPanel.test.tsx --reporter=basic"`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/agent/AgentCoworkerPanel.tsx apps/web/components/agent/AgentCoworkerPanel.test.tsx
git commit -m "feat: add optimistic coworker user messages"
```

### Task 3: Add failing bubble test for sending and failed states

**Files:**
- Modify or Create: `apps/web/components/agent/AgentMessageBubble.test.tsx`
- Modify: `apps/web/components/agent/AgentMessageBubble.tsx`

- [ ] **Step 1: Write the failing test**

Add tests that render:
- a user message with `sending` status and expect `Sending...`
- a user message with `failed` status and expect `Not sent` plus `Retry`

- [ ] **Step 2: Run test to verify it fails**

Run: `cmd /c "D:\OpenDigitalProductFactory\apps\web\node_modules\.bin\vitest.CMD run components/agent/AgentMessageBubble.test.tsx --reporter=basic"`

Expected: FAIL because the bubble component does not currently render user message status metadata.

- [ ] **Step 3: Write minimal implementation**

Update `AgentMessageBubble.tsx` to:
- accept optional user message delivery status props
- show inline status text for `sending`
- show inline failed state plus retry trigger for `failed`
- avoid changing assistant markdown rendering

- [ ] **Step 4: Run test to verify it passes**

Run: `cmd /c "D:\OpenDigitalProductFactory\apps\web\node_modules\.bin\vitest.CMD run components/agent/AgentMessageBubble.test.tsx --reporter=basic"`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/agent/AgentMessageBubble.tsx apps/web/components/agent/AgentMessageBubble.test.tsx
git commit -m "feat: add coworker message send states"
```

### Task 4: Add failing retry test and implement resend

**Files:**
- Modify: `apps/web/components/agent/AgentCoworkerPanel.test.tsx`
- Modify: `apps/web/components/agent/AgentCoworkerPanel.tsx`

- [ ] **Step 1: Write the failing test**

Add a test that forces `sendMessage()` to fail, verifies the message remains with `Not sent`, clicks `Retry`, and expects the original content to be resubmitted.

- [ ] **Step 2: Run test to verify it fails**

Run: `cmd /c "D:\OpenDigitalProductFactory\apps\web\node_modules\.bin\vitest.CMD run components/agent/AgentCoworkerPanel.test.tsx --reporter=basic"`

Expected: FAIL because failed messages currently are not retained or retryable.

- [ ] **Step 3: Write minimal implementation**

Extend `AgentCoworkerPanel.tsx` to:
- preserve failed optimistic messages
- expose a retry callback into `AgentMessageBubble`
- resend using the original message content
- flip state back to `sending` during retry

- [ ] **Step 4: Run test to verify it passes**

Run: `cmd /c "D:\OpenDigitalProductFactory\apps\web\node_modules\.bin\vitest.CMD run components/agent/AgentCoworkerPanel.test.tsx --reporter=basic"`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/agent/AgentCoworkerPanel.tsx apps/web/components/agent/AgentCoworkerPanel.test.tsx
git commit -m "feat: add coworker failed message retry"
```

## Chunk 3: Focused Verification

### Task 5: Run focused verification and prepare handoff

**Files:**
- Verify only

- [ ] **Step 1: Run focused agent component tests**

Run:

```bash
cmd /c "D:\OpenDigitalProductFactory\apps\web\node_modules\.bin\vitest.CMD run components/agent/AgentPanelHeader.test.tsx components/agent/AgentCoworkerPanel.test.tsx components/agent/AgentMessageBubble.test.tsx --reporter=basic"
```

Expected: PASS

- [ ] **Step 2: Run web typecheck**

Run:

```bash
cmd /c "D:\OpenDigitalProductFactory\apps\web\node_modules\.bin\tsc.CMD --noEmit"
```

Expected: PASS

- [ ] **Step 3: Commit any final verification-driven fixes**

```bash
git add <files>
git commit -m "fix: finish coworker send polish verification"
```

Only if needed.
