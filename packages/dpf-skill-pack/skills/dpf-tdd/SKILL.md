---
name: dpf-tdd
description: "Use for DPF test-first work. Write the failing behavior test first, make it green, refactor, then run the functional gate; never claim an unrun test passed."

# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: false
user-invocable: true
allowed-tools: Bash Read Grep Glob mcp__dpf__get_work_capsule mcp__dpf__find_related_tests

# DPF coworker fields (Surface B — in-portal seed loader)
category: build
assignTo: ["build-specialist", "platform-engineer", "external-coding-agent", "software-engineer"]
capability: null
taskType: workflow
triggerPattern: "tdd|test.first|test.driven|write the test first|red.green|failing test|regression test before"
userInvocable: true
agentInvocable: true
allowedTools: ["Bash", "Read", "Grep", "Glob", "mcp__dpf__get_work_capsule", "mcp__dpf__find_related_tests"]
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

### Where to run the test

Match the test to the runtime it needs:

- **Source-local tests** (targeted Vitest/Jest specs, typechecks, pure-function unit tests) — run in the thread worktree.
- **Runtime-bound tests** (anything that needs the portal up, the dev DB seeded, MCP reachable, Prisma client generated, Next/Turbopack serving, Build Studio executing) — run against the canonical local install or a governed shared nonprod environment (see `dpf-use-shared-nonprod-environment`).

This is [AGENTS.md §5 "Where each gate runs"](../../../../AGENTS.md) applied to TDD. Do not spend cycles making the thread worktree into a full DPF runtime so a runtime-bound test will run there — that is harness work, not test work. A suite that did not execute because the worktree could not host its runtime is an **unrun gate, not a red gate**.

1. **Impact before Red.** Consume the `changeImpactContract` returned when the Workroom's edit paths were claimed (or retrieve it from `verificationState.changeImpactContract`). Resolve every `testImpact` entry with `mcp__dpf__find_related_tests`, and put every applicable `guardObligation` into the loop now. `status: unresolved`, missing/stale graph advice, or an unmapped source path expands verification; it never means “no tests.”

2. **Red — write the failing test first.** Name the behavior; assert the expected result; run it and **watch it fail for the right reason**. For a bug fix this is mandatory: a test that reproduces the symptom (generalizing `security-fix-needs-regression-test-first` beyond security). Use `mcp__dpf__find_related_tests` to place it with its siblings and match the suite's conventions.

3. **Green — minimum code to pass.** Write only enough to make the test pass. Run the test; confirm it now passes **for the right reason** (not because the assertion is trivially true).

4. **Refactor — clean under the green.** With the test guarding behavior, improve the code. Re-run after each change.

5. **Gate — functional, not structural.** Exercise the contract's guard obligations before the final gate, then run the complete build gate. `build-gate-mandatory`: the suite must pass at merge. `structural-verification-is-not-functional`: a typecheck/lint pass is **not** a test pass. Run the actual tests and read the actual result. Run the suite against the runtime it was written for — source-local in the worktree, runtime-bound against the canonical install — and quote the result from that run.

## Guardrails

- **Never report a test as passing without running it.** `never-fabricate`: "should pass" is not "passes." Run it; quote the result.
- **A bug fix without a first-failing regression test is incomplete** — you can't prove the fix is what closed the symptom.
- **Green for the right reason.** A test that passes before your change (or with the assertion inverted) is testing nothing — make it fail first.
- **Revert-to-red is necessary but NOT sufficient — calibrate the threshold against BOTH branches.** A numeric assertion can fail against the *unfixed* code for the wrong reason and still not test the thing its comment claims. Real case: a layout test asserted an x-span `< 600px` "because the clamp keeps a tiny graph from scattering". Measured, the span was **266px with the clamp and 483px without** — both under 600, so deleting the clamp kept it green. Fix: measure the metric on both branches and put the threshold *between* them (320px), then delete the guarded behaviour and confirm red. **If a test's comment names what it guards, delete exactly that and watch it fail** — otherwise the comment, not the test, is doing the work.
- **Typecheck/build green ≠ tests green.** They are different gates; clear both.
- **Do not postpone the impact contract.** Discovering an already-predicted test or guard only after implementation is process failure, even if the final gate eventually passes.

## See also

- Verification discipline this shares with debugging: [`dpf-systematic-debugging`](../dpf-systematic-debugging/SKILL.md) Phase 4 (functional-not-structural).
- Kernel: `build-gate-mandatory`, `security-fix-needs-regression-test-first`, `structural-verification-is-not-functional`, `never-fabricate`.
