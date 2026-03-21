---
name: finishing-a-development-branch
description: Use when implementation is complete, all tests pass, and you need to decide how to integrate the work
source: superpowers v5.0.5
---

# Finishing a Development Branch

Guide completion of development work by presenting clear options and handling chosen workflow.

**Core principle:** Verify tests -> Present options -> Execute choice -> Clean up.

## The Process

### Step 1: Verify Tests
Run project's test suite. If tests fail: STOP. Cannot proceed.

### Step 2: Determine Base Branch

### Step 3: Present Options
1. Merge back to base-branch locally
2. Push and create a Pull Request
3. Keep the branch as-is
4. Discard this work

### Step 4: Execute Choice

- **Merge locally:** checkout base, pull latest, merge, verify tests, delete branch
- **Create PR:** push with -u, gh pr create with summary + test plan
- **Keep as-is:** report status, don't cleanup
- **Discard:** require typed 'discard' confirmation first

### Step 5: Cleanup Worktree
For Options 1, 2, 4: remove worktree. For Option 3: keep.

## Red Flags — Never:
- Proceed with failing tests
- Merge without verifying tests on result
- Delete work without confirmation
- Force-push without explicit request
