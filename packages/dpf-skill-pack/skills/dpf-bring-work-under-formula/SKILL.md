---
name: dpf-bring-work-under-formula
description: "Use when adding a DPF work carrier or lifecycle. Routes it through one case, a WorkUnit adapter, the source registry, and canonical status projection."
disable-model-invocation: false
user-invocable: true
allowed-tools: Read Grep Glob Edit Write Bash mcp__dpf__query_backlog mcp__dpf__wiki_query
category: governance
assignTo: ["platform-engineer", "software-engineer", "build-specialist"]
capability: manage_platform
taskType: code_generation
triggerPattern: "new work carrier|new work source|new lifecycle|status projector|bring .* under .* formula|WorkUnit adapter"
userInvocable: true
agentInvocable: true
allowedTools: ["Read", "Grep", "Glob", "Edit", "Write", "Bash", "mcp__dpf__query_backlog", "mcp__dpf__wiki_query"]
composesFrom: ["dpf-verify-substrate-first", "dpf-writing-plans", "dpf-tdd", "dpf-pr-with-dco"]
contextRequirements: []
riskBand: medium
enforces:
  - kernel/principles/universal-work-formula
  - kernel/principles/single-source-of-truth
  - kernel/principles/verify-substrate-before-proposing-new
---

# Bring Work Under the Universal Formula

Use the invariant lifecycle: `frame → propose → collaborate → review → govern → verify → carry-over`. A domain changes only context, temporal shape, and participants; a different outcome does not justify another lifecycle.

## 1. Verify existing substrate

Read `work-management/work-unit.ts`, `source-registry.ts`, `status-projection.ts`, and the Work Convergence design before editing. Search for an existing source entry, WorkItem case, carrier adapter, and projector. Extend those when they fit.

## 2. Make the work addressable

Every originated unit resolves to one WorkItem/case. Reuse the domain source identity when it exists; otherwise register a stable source key. Never leave an ad-hoc carrier with a null case identity, and never create two WorkItems for one source tuple.

## 3. Add one thin adapter

Map the carrier into `WorkUnit`: identity, participants, process/current state, outcome, governance, and carry-over. Register the adapter in `WORK_UNIT_CARRIER_REGISTRY`. Carrier-specific state remains input; company-facing state comes only from `projectWorkUnitState`.

## 4. Put variation in the source registry

Express context as `domainCategory`, temporal shape as `roomProjection.mode`, participants through the source/room policy, process as `supportedTransitions`, and governance as decision/receipt policy. Do not encode these axes in a second projector or enum.

## 5. Reconcile terminal execution safely

Clear stale active links and release retryable claims. Abandoned work returns to a resumable state. Completion never infers BacklogItem `done`; the governed completion path must cite server-resolved evidence.

## 6. Prove conformance

Write the failing adapter/projection tests first, then run the focused suites and `node --test scripts/check-work-unit-conformance.test.mjs && node scripts/check-work-unit-conformance.mjs`. Finish through `dpf-pr-with-dco` and validate the case on the canonical runtime.

## Hard rules

- One unit of work has one addressable case and one canonical WorkItem anchor.
- `status-projection.ts` is the single company-facing projection authority.
- A new carrier requires an adapter + registry entry, never a forked formula.
- No terminal carrier may silently mark implementation done without evidence.
