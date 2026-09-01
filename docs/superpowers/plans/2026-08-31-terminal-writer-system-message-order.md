---
status: active
---

# Terminal-writer system-message order — implementation plan

Backlog item: `BI-EDC0DAF2`  
Workroom: `WC-A291253B`  
Design: `docs/superpowers/specs/2026-08-31-terminal-writer-system-message-order-design.md`

**For agentic workers:** execute this plan one independently reviewable backlog
item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green
implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate
before any success claim, and `dpf-pr-with-dco` for handoff.

## Backlog coverage

- Decision: `atomic`
- Parent and delivery item: `BI-EDC0DAF2`
- Receipt: pending immutable-artifact publication and governed coverage write
- Dependencies: none
- Rationale: the role-order regression test and the terminal-writer history
  reorder are one safety fix. Neither is useful or safe to ship alone, and
  acceptance requires deploying that exact combined change and replaying the
  already-bound customer-zero TaskRun.

## Change-impact contract

The Workroom resolved the two claimed edit paths. Before Red, the contract
requires graph-linked and colocated tests for
`apps/web/lib/mcp-task-execution.ts`; those resolve to the existing
`apps/web/lib/mcp-task-terminal-writer.test.ts` resumption coverage. Completion
also requires the style-drift guard, `pnpm run pregate:preflight`, an exact-tree
`pnpm run pregate`, and `pnpm pr:health` with review findings read.

## Atomic delivery sequence

### 1. Prove the regression

- Touch: `apps/web/lib/mcp-task-terminal-writer.test.ts`.
- Change the existing terminal-writer replay assertion to require provider
  history in `system` then `user` order.
- Run the focused test and retain the failure showing the current
  `user` then `system` construction.
- Verification reference: `AC-ORDER-RED` — the assertion fails before source
  implementation for role order only.

### 2. Correct provider-facing history

- Touch: `apps/web/lib/mcp-task-execution.ts`.
- Place hydrated terminal-writer system context before the original user
  request. Preserve ordinary TaskRun history and every existing writer-policy,
  immutable-binding, grant, reviewer, and idempotency contract.
- Run the focused test and the terminal-writer/context/tool-policy suites.
- Verification reference: `AC-ORDER-GREEN` — terminal replay is
  `system` then `user`, while non-terminal execution remains unchanged.

### 3. Prove delivery safety

- Run the change-impact style guard, affected web tests, production build,
  `pregate:preflight`, and the exact-tree pregate.
- Commit with DCO sign-off, push, open a ready PR, inspect `pnpm pr:health`, and
  use the merge queue.
- Verification reference: `AC-GATE` — source, test, build, and governed PR
  evidence all bind to the delivered SHA.

### 4. Verify the customer-zero outcome

- Advance the canonical runtime only through `/ops/self-upgrade`.
- Replay TaskRun
  `TR-MCP-Y21xamsxOWhsMDAwMDdwcnZzZm4ybTAzOQ-557F042B9990` without changing
  its idempotency identity or immutable binding.
- Verify its bound `record_initiative_evidence` writer executes and
  `BI-B223F45E` research readiness becomes satisfied.
- Verification reference: `AC-LIVE-REPLAY` — the original resumable TaskRun,
  not a replacement, completes its governed writer.

## Traceability

- Baseline objectives: `OBJ-TWSO-001`, `OBJ-TWSO-002`.
- Baseline acceptance: `AC-TWSO-001`, `AC-TWSO-002`, `AC-TWSO-003`.
- Requirement: `BI-EDC0DAF2#Acceptance`.
- Contract: design `## Contract`.
- Flow: design `## Ordered fix sequence` and this plan's atomic delivery
  sequence.
- Verification: `AC-ORDER-RED`, `AC-ORDER-GREEN`, `AC-GATE`, and
  `AC-LIVE-REPLAY`.

## Risks and rollback

The narrow risk is changing message order for providers that accepted the old
invalid sequence. Tests preserve the ordinary path and constrain the change to
hydrated terminal-writer replay. Rollback is the single fix PR; if live replay
regresses a hosted adapter, revert through the normal PR and merge queue, then
advance the canonical runtime through `/ops/self-upgrade`. No migration or data
rollback is involved.

Documentation impact: the design and this plan are the durable contributor
contract. The repair does not add owner-facing UX or change public product
behavior.
