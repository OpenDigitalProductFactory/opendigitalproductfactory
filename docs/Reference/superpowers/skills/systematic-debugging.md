---
name: systematic-debugging
description: Use when encountering any bug, test failure, or unexpected behavior, before proposing fixes
source: superpowers v5.0.5
---

# Systematic Debugging

**Core principle:** ALWAYS find root cause before attempting fixes. Symptom fixes are failure.

## The Iron Law

```
NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST
```

## The Four Phases

### Phase 1: Root Cause Investigation

BEFORE attempting ANY fix:
1. **Read error messages carefully** — stack traces, line numbers, error codes
2. **Reproduce consistently** — exact steps, every time?
3. **Check recent changes** — git diff, new dependencies, config changes
4. **Gather evidence in multi-component systems** — log at each boundary
5. **Trace data flow** — where does bad value originate?

### Phase 2: Pattern Analysis
1. Find working examples in same codebase
2. Compare against references (read completely, don't skim)
3. Identify differences between working and broken
4. Understand dependencies

### Phase 3: Hypothesis and Testing
1. Form single hypothesis: "I think X because Y"
2. Make SMALLEST possible change to test
3. One variable at a time
4. Didn't work? NEW hypothesis, don't add more fixes

### Phase 4: Implementation
1. Create failing test case (MUST have before fixing)
2. Implement single fix at root cause
3. Verify fix — test passes, no regressions
4. If 3+ fixes failed: STOP and question architecture

## Red Flags — STOP and Return to Phase 1

- "Quick fix for now, investigate later"
- "Just try changing X"
- Proposing solutions before tracing data flow
- "One more fix attempt" (when already tried 2+)

## If 3+ Fixes Failed

This is NOT a failed hypothesis — this is a wrong architecture. Discuss with human before attempting more fixes.
