# Iterative Build Process — Design Spec
**Date:** 2026-04-08  
**Status:** Approved for implementation  
**Ticket:** TAK-BUILD-002

---

## Problem

The Build Studio orchestrator treats every build as a fresh start. When a build completes
with test failures (e.g., "60 failing, 2722 passing"), the user's only option is to say
"yes" — which triggers a full rebuild of all 14 tasks from scratch, discarding all the
work that was already done correctly.

Real software development is iterative:
- Build → test → fix failures → test again → deploy
- Not: Build → test → rebuild everything → test → rebuild everything

Additionally, the cancel button doesn't work during orchestrator execution, trapping the
user in a 30-minute rebuild they didn't intend.

---

## Current Flow (broken)

```
ideate → plan → build (14 tasks) → QA finds 60 failures
    ↓
user says "yes" → orchestrator re-runs all 14 tasks
    ↓
all previous work overwritten or duplicated
```

---

## Proposed Flow

```
ideate → plan → build (14 tasks) → QA finds failures
    ↓
BUILD COMPLETE — results saved to FeatureBuild
    ↓
user can:
  "fix the test failures"  → FIX mode (targeted)
  "rebuild task 3"         → REBUILD mode (single task)
  "rebuild all"            → FULL REBUILD (explicit, not default)
  "proceed to review"      → advance to review phase
  "show me what was built" → describe changes without rebuilding
```

---

## Design

### 1. Build State Persistence

After the orchestrator completes, save the full result to `FeatureBuild`:

```typescript
// Already exists: buildPlan, verificationOut
// Add: buildResult (full orchestrator output including per-task status)
buildResult: {
  tasks: [
    { title, specialist, status: "DONE" | "DONE_WITH_CONCERNS" | "BLOCKED", output },
    ...
  ],
  qaOutput: { testsPassed: 2722, testsFailed: 60, typecheckPassed: true, buildErrors: [...] },
  completedAt: ISO timestamp,
}
```

### 2. Fix Mode

When the user says "fix the test failures" (or similar), the orchestrator:

1. Reads `buildResult.qaOutput` from the previous build
2. Creates a SINGLE fix task (not 14):
   - Specialist: software-engineer
   - Prompt: "These tests are failing: [test output]. Fix the source files. Do not modify the tests."
   - Context: includes the file list from the original build plan
3. Dispatches one Codex CLI call with the fix task
4. Runs QA again after the fix
5. Updates `buildResult` with the new QA output

This is how Claude Code works: it sees the error, fixes it, re-runs the check. One loop.

### 3. Single Task Rebuild

When the user says "rebuild task 3" or "redo the registration detail page":

1. Identify which task(s) to re-run from `buildResult.tasks`
2. Dispatch only those tasks via Codex CLI
3. Run QA after
4. Update `buildResult`

### 4. User Intent Classification

The coworker (single-agent conversational loop) needs to classify user responses after
a build completes:

| User says | Intent | Action |
|-----------|--------|--------|
| "yes", "looks good", "proceed" | Advance phase | Move to review phase |
| "fix the errors", "fix the tests" | Fix mode | Dispatch fix task |
| "rebuild", "redo", "start over" | Full rebuild | Re-run orchestrator |
| "rebuild task 3", "redo the API routes" | Single rebuild | Re-run specific tasks |
| "what was built?", "show me" | Describe | Summarize buildResult |
| "cancel" | Cancel | Do nothing, stay in build phase |

The default for "yes" after a successful build (0 failures) = advance to review.
The default for "yes" after a failed build (>0 failures) = should NOT rebuild. Should ask
"Do you want me to fix the failures, or proceed to review as-is?"

### 5. Cancel Button Fix

The cancel button (`agentEventBus.isCancelled(threadId)`) is checked in the agentic loop
but NOT in the orchestrator's phase loop. The orchestrator needs to check cancellation:

```typescript
for (const phase of phases) {
  // Check cancellation at phase boundary
  if (agentEventBus.isCancelled(parentThreadId)) {
    agentEventBus.clearCancel(parentThreadId);
    console.log(`[orchestrator] cancelled by user`);
    break;
  }
  // ... dispatch tasks
}
```

Also need to check before each task dispatch, not just between phases.

### 6. "Don't Redo Work" Guard

Before dispatching any task, check if the sandbox already has the output files:

```typescript
// If the file exists and the task status was DONE in the previous build,
// skip it unless the user explicitly asked to rebuild it.
if (previousResult?.tasks[i]?.status === "DONE" && !forceRebuild) {
  console.log(`[orchestrator] Skipping "${task.title}" — already completed`);
  continue;
}
```

---

## Implementation Order

1. Add `buildResult` JSON column to `FeatureBuild` (migration)
2. Save orchestrator results to `buildResult` after completion
3. Add cancellation checks to orchestrator phase loop
4. Add intent classification for post-build user responses
5. Implement fix mode (single Codex CLI call with QA output)
6. Implement single-task rebuild
7. Add "skip completed" guard to orchestrator dispatch
8. Update build phase prompt to explain available post-build actions

---

## Relationship to CLI Dispatch

This spec is dispatch-agnostic — it works the same whether the underlying execution
uses Codex CLI, Claude Code CLI, or the legacy agentic loop. The orchestrator manages
the task lifecycle; the CLI dispatch is just the execution engine for each task.
