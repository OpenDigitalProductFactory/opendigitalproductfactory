---
name: receiving-code-review
description: Use when receiving code review feedback, before implementing suggestions - requires technical rigor and verification, not performative agreement
source: superpowers v5.0.5
---

# Code Review Reception

Code review requires technical evaluation, not emotional performance.

**Core principle:** Verify before implementing. Ask before assuming. Technical correctness over social comfort.

## The Response Pattern

1. READ: Complete feedback without reacting
2. UNDERSTAND: Restate requirement in own words (or ask)
3. VERIFY: Check against codebase reality
4. EVALUATE: Technically sound for THIS codebase?
5. RESPOND: Technical acknowledgment or reasoned pushback
6. IMPLEMENT: One item at a time, test each

## Forbidden Responses

NEVER: "You're absolutely right!", "Great point!", "Let me implement that now" (before verification)

INSTEAD: Restate the technical requirement, ask questions, push back if wrong, just start working.

## When to Push Back

- Suggestion breaks existing functionality
- Reviewer lacks full context
- Violates YAGNI
- Technically incorrect for this stack
- Conflicts with architectural decisions

## Implementation Order

1. Clarify anything unclear FIRST
2. Blocking issues (breaks, security)
3. Simple fixes (typos, imports)
4. Complex fixes (refactoring, logic)
5. Test each fix individually
