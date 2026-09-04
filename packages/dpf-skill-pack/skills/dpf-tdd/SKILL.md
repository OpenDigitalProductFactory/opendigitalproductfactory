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

Red-green-refactor is assumed, not taught. The DPF layer is that a test is **evidence**: the build gate enforces it at merge, and the kernel forbids claiming a green you did not observe.

## When to use

- New behavior whose expected output is specifiable up front.
- **Fixing a bug or regression** — the highest-value case. The first-failing test is what proves the fix closed the symptom.
- Hardening a contract (schema, API shape, enum) against drift.

Skip it for a spike where the interface is still unknown, or a throwaway diagnostic with no merge path.

## Run the test against the runtime it needs

- **Source-local** (targeted Vitest specs, typechecks, pure functions) — run in the thread worktree.
- **Runtime-bound** (needs the portal up, dev DB seeded, MCP reachable, Prisma generated, Build Studio executing) — run against the canonical local install or a governed shared nonprod environment (`dpf-use-shared-nonprod-environment`).

This is [AGENTS.md §4 "Where each gate runs"](../../../../AGENTS.md) applied to TDD. Do not turn the worktree into a full DPF runtime so a runtime-bound test will run there — that is harness work, not test work.

**A suite that did not execute because the worktree could not host its runtime is an unrun gate, not a red gate.** Say which one you have.

## The DPF-gated loop

1. **Impact before Red.** Consume the `changeImpactContract` returned when the Workroom claimed its edit paths (or read `verificationState.changeImpactContract`). Resolve every `testImpact` entry with `find_related_tests` and pull every `guardObligation` into the loop now. If `find_related_tests` returns `Code graph unavailable`, an unavailable graph, or low-trust/qualify advice, **do not retry it blindly**: record the lookup as unavailable/unrun, then use a bounded `Grep`/`Glob` sweep plus colocated tests and the repository's explicit test commands. `status: unresolved`, stale graph advice, or an unmapped source path **expands** verification — it never means "no tests." The fallback is evidence of the search you performed, not a claim that the graph found nothing.

2. **Red.** Watch it fail for the right reason. For a bug fix this is mandatory (`security-fix-needs-regression-test-first`, generalized beyond security).

3. **Green, then refactor under the green.**

4. **Gate — functional, not structural.** Clear the guard obligations, then the full build gate. A typecheck or lint pass is **not** a test pass (`structural-verification-is-not-functional`). Quote the result from the run you actually performed.

## Guardrails

- **Never report a test as passing without running it.** "Should pass" is not "passes" (`never-fabricate`).
- **Typecheck/build green ≠ tests green.** Different gates; clear both.
- **A bug fix without a first-failing regression test is incomplete** — nothing proves the fix is what closed the symptom.
- **Revert-to-red is necessary but not sufficient — calibrate the threshold against BOTH branches.** A numeric assertion can fail against the unfixed code for the wrong reason and still not test what its comment claims. Real case: a layout test asserted an x-span `< 600px` "because the clamp keeps a tiny graph from scattering." Measured, the span was **266px with the clamp and 483px without** — both under 600, so deleting the clamp kept it green. Fix: measure on both branches and put the threshold *between* them (320px), then delete the guarded behavior and confirm red. **If a test's comment names what it guards, delete exactly that and watch it fail** — otherwise the comment, not the test, is doing the work.
- **Do not postpone the impact contract.** Finding an already-predicted test only after implementation is process failure even if the final gate passes.

## See also

- [`dpf-systematic-debugging`](../dpf-systematic-debugging/SKILL.md) — shares the functional-not-structural discipline.
- Kernel: `build-gate-mandatory`, `security-fix-needs-regression-test-first`, `structural-verification-is-not-functional`, `never-fabricate`.
