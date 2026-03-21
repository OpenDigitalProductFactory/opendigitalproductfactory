---
name: subagent-driven-development
description: Use when executing implementation plans with independent tasks in the current session
source: superpowers v5.0.5
---

# Subagent-Driven Development

Execute plan by dispatching fresh subagent per task, with two-stage review after each: spec compliance review first, then code quality review.

**Why subagents:** Fresh context per task. Precisely crafted instructions. Never inherit session history. Preserves coordinator context.

**Core principle:** Fresh subagent per task + two-stage review (spec then quality) = high quality, fast iteration

## The Process

1. Read plan, extract all tasks with full text, create TodoWrite
2. Per task:
   a. Dispatch implementer subagent with full task text + context
   b. Handle questions (answer before letting them proceed)
   c. Implementer implements, tests, commits, self-reviews
   d. Dispatch spec compliance reviewer (verify matches spec)
   e. If issues: implementer fixes, re-review
   f. Dispatch code quality reviewer
   g. If issues: implementer fixes, re-review
   h. Mark task complete
3. After all tasks: dispatch final code reviewer for entire implementation
4. Use finishing-a-development-branch skill

## Model Selection

- **Mechanical tasks** (isolated functions, clear specs, 1-2 files): fast, cheap model
- **Integration tasks** (multi-file coordination, debugging): standard model
- **Architecture/design/review**: most capable model

## Handling Implementer Status

- **DONE:** Proceed to spec compliance review
- **DONE_WITH_CONCERNS:** Read concerns before proceeding
- **NEEDS_CONTEXT:** Provide missing context, re-dispatch
- **BLOCKED:** Assess blocker — provide context, upgrade model, break down task, or escalate

## Red Flags — Never:
- Skip reviews (spec compliance OR code quality)
- Proceed with unfixed issues
- Dispatch multiple implementation subagents in parallel (conflicts)
- Make subagent read plan file (provide full text instead)
- Start code quality review before spec compliance passes
- Move to next task while either review has open issues
