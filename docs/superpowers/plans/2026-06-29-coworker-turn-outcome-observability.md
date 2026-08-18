# Coworker Turn Outcome Observability Implementation Plan

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make AI coworker failures actionable and add a compact per-response trace of routing, tools, and handoffs.

**Architecture:** Add a small turn-outcome projection on the coworker path. The backend translates context/tool failures into next-step recovery copy, sends a lightweight trace through the existing completion event, and the client renders a subtle one-line trace under assistant replies after merging it onto the refreshed assistant message.

**Tech Stack:** Next.js 16, React, Prisma, Vitest, existing TAK agentic loop and coworker chat components.

---


> **Rescue note (2026-08-16).** Recovered from a branch that was pushed and never proposed as a PR, found in the 2026-08-15 never-proposed-branch sweep. **The design landed here; the implementation did not.**
>
> - Tracked by `BI-3B01B725` (recovered tail designs). Read it before acting on this document.
> - Preserved implementation: `clean/ux-automation-sweep` @ `3180507da9d068818a68aa1ff7169f64345a6017`, pinned at `refs/salvage/2026-08-15/clean/ux-automation-sweep` and listed in `~/dpf-deleted-remote-branch-tips-2026-08-15.txt`. Restore with `git push origin 3180507da9d068818a68aa1ff7169f64345a6017:refs/heads/clean/ux-automation-sweep`.
> - All backlog ids cited below resolve in this install.
> - No coverage receipt is recorded and none should be until a thread actually starts — a receipt bound to unstarted work would be fiction. This document is deliberately outside the plan-backlog-coverage gate (it carries no bolded backlog-item metadata line).

## Chunk 1: Failure Translation And Trace Metadata

### Task 1: Backend Outcome Summary

**Files:**
- Modify: `apps/web/lib/tak/agentic-loop.ts`
- Modify: `apps/web/lib/actions/agent-coworker.ts`
- Test: `apps/web/lib/tak/agentic-loop.test.ts`
- Test: `apps/web/lib/actions/agent-coworker*.test.ts`

- [x] Write failing tests for context overflow copy that proposes system recovery instead of user-run searches.
- [x] Add a structured `turnTrace` to agentic loop results with provider/model, attached/deferred tool counts, executed tool count, and handoff count.
- [x] Return an actionable recovery message for context overflow.
- [x] Verify tests pass.

### Task 2: Visible Trace Line

**Files:**
- Modify: `apps/web/lib/tak/agent-coworker-types.ts`
- Modify: `apps/web/lib/agent-coworker-data.ts`
- Modify: `apps/web/components/agent/AgentMessageBubble.tsx`
- Test: `apps/web/components/agent/AgentMessageBubble.test.tsx`

- [x] Write failing tests for rendering a one-line under-the-hood summary.
- [x] Extend message rows with optional event-delivered turn trace metadata.
- [x] Render the trace below assistant messages, subtle and non-blocking.
- [x] Verify component tests pass.

### Task 3: Documentation And Gates

**Files:**
- Modify: `docs/superpowers/audits/2026-06-29-portal-ux-automation-sweep.md`

- [x] Record the finding and architecture pattern in the audit note.
- [x] Run focused tests, typecheck, production build, and browser trace rendering smoke.
- [ ] Commit with DCO sign-off and push.
