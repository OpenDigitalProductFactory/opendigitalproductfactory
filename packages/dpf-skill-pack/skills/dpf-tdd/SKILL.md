---
name: dpf-tdd
description: "Use when building or fixing behavior in the DPF codebase and you want the test to define done before the code exists. Red-green-refactor, DPF-governed: for a bug/regression, write the failing test that reproduces it FIRST (generalizes security-fix-needs-regression-test-first); prove green functionally (a structural pass is not verification); never report a test passing you did not run. The DPF-native test-first discipline; replaces the retired upstream superpowers test-driven-development dependency."

# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: false
user-invocable: true
allowed-tools: Bash Read Grep Glob mcp__dpf__find_related_tests

# DPF coworker fields (Surface B — in-portal seed loader)
category: build
assignTo: ["*"]
capability: null
taskType: workflow
triggerPattern: "tdd|test.first|test.driven|write the test first|red.green|failing test|regression test before"
userInvocable: true
agentInvocable: true
allowedTools: ["Bash", "Read", "Grep", "Glob", "mcp__dpf__find_related_tests"]
composesFrom: []
contextRequirements: []
riskBand: low

# Kernel principle enforcement
enforces:
  - kernel/principles/build-gate-mandatory
  - kernel/principles/security-fix-needs-regression-test-first
  - kernel/principles/structural-verification-is-not-functional
  - kernel/principles/never-fabricate
---

# DPF Test-Driven Development

Write the test that defines "done" **before** the code that satisfies it. Generic TDD is red-green-refactor; the DPF layer is that the test is *evidence* — the build gate enforces it at merge, and the kernel forbids claiming a green you didn't actually observe. This is the DPF-native test-first discipline; it replaces the retired upstream `test-driven-development` skill.

## When to use

- Implementing new behavior where the expected output is specifiable up front.
- **Fixing a bug or regression** — the highest-value case: write the failing test that reproduces it first, so the fix is provably the thing that closed it.
- Hardening a contract (a schema, an API shape, an enum) against drift.

## When NOT to use

- Pure exploration/spike where the interface isn't known yet — spike, then come back and test-drive the real implementation.
- One-off scripts or throwaway diagnostics with no merge path.

## The loop (DPF-gated)

1. **Red — write the failing test first.** Name the behavior; assert the expected result; run it and **watch it fail for the right reason**. For a bug fix this is mandatory: a test that reproduces the symptom (generalizing `security-fix-needs-regression-test-first` beyond security). Use `mcp__dpf__find_related_tests` to place it with its siblings and match the suite's conventions.

2. **Green — minimum code to pass.** Write only enough to make the test pass. Run the test; confirm it now passes **for the right reason** (not because the assertion is trivially true).

3. **Refactor — clean under the green.** With the test guarding behavior, improve the code. Re-run after each change.

4. **Gate — functional, not structural.** `build-gate-mandatory`: the suite must pass at merge. `structural-verification-is-not-functional`: a typecheck/lint pass is **not** a test pass. Run the actual tests and read the actual result.

## Guardrails

- **Never report a test as passing without running it.** `never-fabricate`: "should pass" is not "passes." Run it; quote the result.
- **A bug fix without a first-failing regression test is incomplete** — you can't prove the fix is what closed the symptom.
- **Green for the right reason.** A test that passes before your change (or with the assertion inverted) is testing nothing — make it fail first.
- **Typecheck/build green ≠ tests green.** They are different gates; clear both.

## See also

- Verification discipline this shares with debugging: [`dpf-systematic-debugging`](../dpf-systematic-debugging/SKILL.md) Phase 4 (functional-not-structural).
- Kernel: `build-gate-mandatory`, `security-fix-needs-regression-test-first`, `structural-verification-is-not-functional`, `never-fabricate`.
