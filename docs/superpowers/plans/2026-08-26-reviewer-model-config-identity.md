---
status: active
backlog_item: BI-B4BACA27
workroom: WC-0B0295EC
design: docs/superpowers/specs/2026-08-26-reviewer-model-config-identity-design.md
---
# Reviewer model configuration identity convergence plan

**For agentic workers:** execute this plan one independently reviewable backlog item at a
time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation,
`dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim,
and `dpf-pr-with-dco` for handoff.

## Outcome

Deliver BI-B4BACA27 as one atomic repair. A model pin saved for an operator-visible coworker
slug governs a threadless TaskRun addressed to the canonical `AGT-*` identity, while grants
and durable attribution remain canonical.

## Phase 1 — Pure identity/configuration contract

Files:

- Add `apps/web/lib/routing/effective-agent-model-config.ts`.
- Add `apps/web/lib/routing/effective-agent-model-config.test.ts`.

Red:

1. Canonical Portfolio and Change Reviewer inputs prefer their registered slug.
2. Alias inputs produce the same bounded identity set.
3. Alias configuration wins over a conflicting canonical row and reports the shadowed row.
4. Canonical-only legacy configuration remains a readable fallback.
5. Unknown identities remain exact and issue one-key lookup.

Green/refactor: implement the pure resolver by composing only from
`@dpf/db/agent-identity`. Do not add a table, map, or second alias registry.

Verification: run the focused resolver suite in the compile-ready/shared verification
environment and confirm the test count matches the authored cases.

## Phase 2 — Dispatch consumes the effective configuration

Files:

- Modify `apps/web/lib/mcp-task-submit.ts`.
- Modify `apps/web/lib/mcp-task-submit.test.ts`.

Red: address a TaskRun to `AGT-WS-PORTFOLIO`, resolve the runtime agent to either identity
form, return both model-config rows, and assert that the alias pin becomes
`preferredProviderId`/`preferredModelId`. Assert separately that tool resolution and
`executeAutonomousAgenticLoop.agentId` remain `AGT-WS-PORTFOLIO`.

Green: replace the one-key `findUnique` with the resolver's bounded identity query and
selection. Preserve null/error fallback and all initiative-review narrowing.

Verification: focused `mcp-task-submit` suite plus web typecheck.

## Phase 3 — Operator surface reads and writes the same contract

Files:

- Modify `apps/web/lib/actions/agent-model-config.ts` and add/extend its focused test.
- Modify `apps/web/app/(shell)/platform/ai/assignments/page.tsx`.
- Modify `apps/web/components/platform/AgentModelAssignmentTable.tsx` only if needed for
  the shadowed-row disclosure; add/extend its focused test when changed.

Red:

1. Saving `AGT-WS-PORTFOLIO` writes `portfolio-advisor`.
2. The assignment projection selects the same alias row used by dispatch.
3. A differing canonical fallback renders a compact warning naming the ignored legacy key;
   matching rows do not render a warning.

Green: normalize writes and project reads through the shared resolver. Keep existing
permissions, validation, theme tokens, and revalidation behavior.

UX verification: authenticated desktop, narrow, and mobile widths on Priority & Models;
confirm the selected provider/model, warning disclosure, save feedback, keyboard focus,
and light/dark theme remain usable. Then submit one preview-only threadless packet and
verify the routing decision uses the same pin without changing canonical attribution.

## Phase 4 — Complete and ship

1. Run every focused functional suite and web typecheck in a compile-ready environment.
2. Run `pnpm run pregate:preflight`; resolve every source/doc/UX impact finding.
3. Commit the stable exact tree with DCO sign-off and obtain a fresh native semantic review.
4. On genuine semantic PASS, record the receipt and run the governed exact-tree pregate.
5. Push, open one ready-for-review DCO PR, read bot findings, run `pnpm pr:health`, and use
   the protected merge queue.
6. Publish through the official immutable release workflow. Upgrade the development install
   exactly once and verify health/data preservation.
7. In live runtime, save the Portfolio Analyst pin, submit one fresh immutable BI-47ACE2C7
   research handoff, and prove the canonical TaskRun selects the pinned long-context,
   tool-capable endpoint and can reach its governed writer.
8. Notify the BI-SIG and WordPress owners that the routing dependency is live; do not infer
   or fabricate either downstream receipt.

## Backlog coverage

Decision: **atomic**. The resolver, dispatch read, and operator read/write convergence are
not independently safe: shipping any one alone leaves the UI/runtime contradiction in
place. BI-B4BACA27 is the sole delivery BI. The genuine server-issued coverage receipt is
pending the immutable design research gate and will be inserted here before production
source is claimed or edited.

## Risks and rollback

- Risk: alias precedence changes an install that intentionally configured both rows.
  Mitigation: the preferred key follows the existing UI/default contract and the shadowed
  conflict is surfaced instead of deleted.
- Risk: identity normalization leaks into authority. Mitigation: tests bind model requirements
  to the effective config while asserting grants and TaskRun agent IDs remain canonical.
- Risk: an unknown agent loses its config. Mitigation: the resolver returns the original key
  unchanged when no registered pair exists.
- Rollback: revert the PR. No migration or destructive backfill is involved.

