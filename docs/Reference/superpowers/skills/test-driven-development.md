---
name: test-driven-development
description: Use when implementing any feature or bugfix, before writing implementation code
source: superpowers v5.0.5
---

# Test-Driven Development (TDD)

Write the test first. Watch it fail. Write minimal code to pass.

**Core principle:** If you didn't watch the test fail, you don't know if it tests the right thing.

## The Iron Law

```
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST
```

Write code before the test? Delete it. Start over. No exceptions.

## Red-Green-Refactor

### RED — Write Failing Test
- One minimal test showing what should happen
- One behavior, clear name, real code (no mocks unless unavoidable)

### Verify RED — Watch It Fail (MANDATORY)
- Test fails (not errors)
- Failure message is expected
- Fails because feature missing (not typos)

### GREEN — Minimal Code
- Simplest code to pass the test
- Don't add features, refactor other code, or "improve" beyond the test

### Verify GREEN — Watch It Pass (MANDATORY)
- Test passes, other tests still pass, output pristine

### REFACTOR — Clean Up
- After green only: remove duplication, improve names, extract helpers
- Keep tests green. Don't add behavior.

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "Too simple to test" | Simple code breaks. Test takes 30 seconds. |
| "I'll test after" | Tests passing immediately prove nothing. |
| "TDD will slow me down" | TDD faster than debugging. |
| "Need to explore first" | Fine. Throw away exploration, start with TDD. |

## Red Flags — STOP and Start Over

- Code before test
- Test passes immediately
- Can't explain why test failed
- Rationalizing "just this once"

**All of these mean: Delete code. Start over with TDD.**
