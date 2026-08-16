# Coworker Routing Abstraction Implementation Plan

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep routine LLM/provider rerouting automatic and hidden while surfacing only Golden Triangle-relevant deviations.

**Architecture:** Add a pure coworker trace policy helper inside the existing TAK loop boundary. The helper decides whether the one-line trace should show a neutral automatic-routing outcome or a user-visible policy deviation; the agentic loop and Build Studio orchestration paths use it when creating `turnTrace.summary`.

**Tech Stack:** Next.js 16, TypeScript, Vitest, existing TAK agentic loop and AI coworker event path.

---


> **Rescue note (2026-08-16).** Recovered from a branch that was pushed and never proposed as a PR, found in the 2026-08-15 never-proposed-branch sweep. **The design landed here; the implementation did not.**
>
> - Tracked by `BI-3B01B725` (recovered tail designs). Read it before acting on this document.
> - Preserved implementation: `clean/ux-automation-sweep` @ `3180507da9d068818a68aa1ff7169f64345a6017`, pinned at `refs/salvage/2026-08-15/clean/ux-automation-sweep` and listed in `~/dpf-deleted-remote-branch-tips-2026-08-15.txt`. Restore with `git push origin 3180507da9d068818a68aa1ff7169f64345a6017:refs/heads/clean/ux-automation-sweep`.
> - All backlog ids cited below resolve in this install.
> - No coverage receipt is recorded and none should be until a thread actually starts — a receipt bound to unstarted work would be fiction. This document is deliberately outside the plan-backlog-coverage gate (it carries no bolded backlog-item metadata line).

## Chunk 1: Trace Policy

### Task 1: Hide Routine Backend Alternatives

**Files:**
- Modify: `apps/web/lib/tak/agentic-loop.ts`
- Test: `apps/web/lib/tak/agentic-loop.test.ts`

- [x] Write failing tests proving ordinary provider/model fallback is summarized as automatic routing and does not expose provider names.
- [x] Write failing tests proving a Golden Triangle downgrade remains visible as a policy deviation.
- [x] Add a pure helper that builds user-facing trace summaries from route facts.
- [x] Wire agentic loop traces through the helper.
- [x] Run focused tests.

### Task 2: Orchestration Path Alignment

**Files:**
- Modify: `apps/web/lib/actions/agent-coworker.ts`
- Test: existing action/API tests where available

- [x] Apply the same copy posture to Build Studio orchestration traces.
- [x] Keep handoff/tool counts available for diagnostics without naming alternate backend routes.
- [x] Run focused route/API tests.

### Task 3: Documentation And Gates

**Files:**
- Modify: `docs/superpowers/audits/2026-06-29-portal-ux-automation-sweep.md`
- Modify: `docs/superpowers/plans/2026-06-29-coworker-routing-abstraction.md`

- [x] Record the UX principle: automatic routing is backend plumbing; only policy violations need human attention.
- [x] Run typecheck and production build.
- [ ] Commit with DCO sign-off and push.
