# Needs You Cognitive-Load Redesign Implementation Plan

> **For agentic workers:** Execute this plan in the isolated `feat/needs-you-cognitive-load` worktree using DPF TDD. This is an operator-authorized external build; do not promote these BIs to Build Studio.

**Goal:** Turn the `/workspace` attention surface into a calm owner decision inbox while preserving builder-grade detail one disclosure down.

**Architecture:** Keep `AttentionItem` as the canonical read model over the existing source queues. Add pure owner-projection modules for routing, translation, and weekly batching; render those projections through one reusable decision-card family on both `/workspace` and `/workspace/inbox`. Reuse the existing proactivity levels and change-proposal substrate, and extend the canonical `ExpandableCard` only where needed to keep decision actions outside its disclosure trigger.

**Tech stack:** Next.js 16 server components, React client disclosure wrapper, TypeScript, Prisma read models, Vitest, Testing Library, DPF theme tokens.

**Backlog:** `BI-56A8B7B9`, `BI-11E17FD1`, `BI-0EB88901`, `BI-6A1BB18C`, `BI-501179C0` under `EP-ATTENTION-SURFACE`.

**Design:** `docs/superpowers/specs/2026-07-17-needs-you-cognitive-load-redesign-design.md`.

---

## Architecture and UX fit review

- **Decision:** fits-with-guardrails.
- **Owning area:** Workspace.
- **Canonical routes:** `/workspace` preview and `/workspace/inbox` full queue. `/ops` remains the builder console and gains no owner entry point.
- **Primary persona:** a non-technical owner who needs to decide, not administer platform records.
- **Navigation layer:** existing page content and contextual actions only; no new global or section navigation.
- **Source truth:** `AttentionItem` plus the existing source adapters and proactivity contracts. No model, migration, string enum, or duplicate queue is added.
- **Reuse/convergence:** retain `buildOutsideInCockpit` ordering; introduce a single owner projection consumed by both workspace views; extend `ExpandableCard` with an always-visible action slot instead of creating a second disclosure dialect.
- **Copy guardrails:** grade 9-10, headline at most eight words, no bare acronyms, interim role attribution is exactly “Your COO recommends…”.
- **Detail guardrail:** original stored title, every raw attention/backlog reference available to the read model, timestamps, actor/source, and builder links remain available one click down.
- **AI boundary:** the read model never performs an action on render. Choices navigate to the owning decision surface; technical builder verbs stay in the disclosure.
- **Empty/failure:** preserve the calm empty state and source-failure notice; custodian-routed work appears only as a quiet “AI is handling” strip.
- **Evidence:** pure routing/translation tests, component accessibility/theme tests, targeted attention tests, web typecheck/build, and live `/workspace` plus `/workspace/inbox` browser checks at desktop and narrow widths.

## Refactoring budget

Roughly 20% of the implementation is reserved for architectural cleanup that directly serves this feature:

1. Separate raw attention facts from owner presentation (`owner-decision.ts`).
2. Separate lane selection from outside-in ordering (`owner-routing.ts`).
3. Make both Workspace views consume the same projection (`owner-projection.ts`) instead of maintaining two card dialects.
4. Extend the existing disclosure primitive with an action slot so interactive choices are never nested inside the disclosure trigger.

No unrelated file or route cleanup is in scope.

## Chunk 1: Owner decision contract and routing

### Task 1: Define the plain-language decision-card contract

**Files:**
- Create: `apps/web/lib/attention/owner-decision.ts`
- Create: `apps/web/lib/attention/owner-decision.test.ts`
- Modify: `apps/web/lib/attention/types.ts`

- [ ] Write failing tests for the mandatory headline, business reason, consequence, recommendation, choices, word-based tags, specialist byline, and technical detail fields.
- [ ] Run `pnpm --filter web exec vitest run apps/web/lib/attention/owner-decision.test.ts` and confirm failures come from the missing translator.
- [ ] Implement source-aware translation from raw `AttentionItem` to `OwnerDecisionCard`; keep the raw title out of the owner headline and inside technical detail.
- [ ] Add deterministic acronym expansion/fallback behavior and enforce the eight-word headline limit in the pure translator.
- [ ] Re-run the targeted test and keep it green through refactoring.

### Task 2: Add the proactivity-aware lane classifier

**Files:**
- Create: `apps/web/lib/attention/owner-routing.ts`
- Create: `apps/web/lib/attention/owner-routing.test.ts`
- Modify: `apps/web/lib/attention/types.ts`
- Modify: `apps/web/lib/attention/sources/scheduled-task.ts`
- Modify: `apps/web/lib/attention/sources/paused-ai.ts`
- Modify: `apps/web/lib/attention/sources/agent-proposal.ts`

- [ ] Write failing table tests for owner-decision, weekly-digest, and custodian lanes at quiet/reactive, balanced, and assertive levels.
- [ ] Write failing tests proving money-out and public hard floors always route to the owner.
- [ ] Write failing regression tests proving platform health, AI-readiness plumbing, and non-business build stalls do not enter the owner count.
- [ ] Run the routing test and verify red.
- [ ] Implement pure classification using the existing closed `ProactivityLevel` type. Preserve “quiet” internally and label it “Reactive” only in owner copy.
- [ ] Carry existing per-coworker proactivity evidence from source projections when available; default unresolved items to balanced without adding schema.
- [ ] Re-run affected source and routing tests.

### Task 3: Build one owner projection

**Files:**
- Create: `apps/web/lib/attention/owner-projection.ts`
- Create: `apps/web/lib/attention/owner-projection.test.ts`
- Modify: `apps/web/lib/attention/outside-in.ts`

- [ ] Write failing tests that partition ordered attention into `needsYouNow`, `weeklyDigest`, and `custodian` without duplicating an item.
- [ ] Prove the calm count equals only `needsYouNow.length`.
- [ ] Implement the projection by composing the existing outside-in comparator, routing classifier, and translator.
- [ ] Keep `buildOutsideInCockpit` backward-compatible for unrelated consumers while moving the new owner surface to the projection.

## Chunk 2: Progressive disclosure and calm UI

### Task 4: Extend the canonical expandable card safely

**Files:**
- Modify: `apps/web/components/ui/report-kit/ExpandableCard.tsx`
- Modify: `apps/web/components/ui/report-kit/ExpandableCard.test.tsx`

- [ ] Write a failing component test for an always-visible action slot outside the disclosure trigger.
- [ ] Implement the optional slot without changing existing callers.
- [ ] Prove actions are not nested inside the heading button and disclosure ARIA remains correct.

### Task 5: Render the owner decision-card family

**Files:**
- Create: `apps/web/components/attention/OwnerDecisionCards.tsx`
- Create: `apps/web/components/attention/OwnerDecisionCards.test.tsx`
- Modify: `apps/web/components/workspace-home/OperatorCockpit.tsx`
- Modify: `apps/web/components/workspace-home/OperatorCockpit.test.tsx`
- Modify: `apps/web/components/attention/AttentionInbox.tsx`
- Create or modify: `apps/web/components/attention/AttentionInbox.test.tsx`

- [ ] Write failing render tests for one calm count, question headline, “Your COO recommends…”, plain action labels, word-based tags, and no raw title above the disclosure.
- [ ] Write failing disclosure tests proving original title, source, risk, portfolio/ownership, BI/FB identifiers when present, detected time/actor, and builder links are preserved.
- [ ] Write a failing regression test proving no owner choice links to a backlog record editor.
- [ ] Implement a responsive, theme-token-only card hierarchy with a single-open technical disclosure.
- [ ] Replace raw cockpit rows and raw inbox rows with the shared card family.
- [ ] Render the quiet custodian strip as “Your AI is handling N items — no action needed.”
- [ ] Preserve source-load failures and the honest empty state.

## Chunk 3: Weekly batching and self-tuning

### Task 6: Build the weekly digest projection

**Files:**
- Create: `apps/web/lib/attention/weekly-digest.ts`
- Create: `apps/web/lib/attention/weekly-digest.test.ts`
- Modify: `apps/web/lib/attention/owner-projection.ts`
- Modify: `apps/web/lib/attention/owner-projection.test.ts`

- [ ] Write failing tests for Friday visibility, pre-Friday held counts, hard-floor exclusion, and deterministic next-Friday labels.
- [ ] Implement a read-only digest over the weekly lane with “Looks good, no changes”, “Snooze to next week”, and per-item review destinations.
- [ ] Ensure batchable items never inflate the daily count.

### Task 7: Surface bounded self-tune proposals

**Files:**
- Modify: `apps/web/lib/proactivity/proactivity-change-proposal.ts`
- Modify: `apps/web/lib/proactivity/proactivity-change-proposal.test.ts`
- Modify: `apps/web/lib/attention/owner-decision.ts`
- Modify: `apps/web/lib/attention/owner-decision.test.ts`
- Modify: `apps/web/lib/attention/sources/agent-proposal.ts`
- Modify: `apps/web/lib/attention/sources/sources.test.ts`

- [ ] Write failing tests for a repeated unchanged-approval pattern producing a bounded change proposal only after the threshold.
- [ ] Prove the proposal preserves money/public hard floors and does not grant new authority.
- [ ] Implement the pure candidate builder on the existing `AgentActionProposal` contract; do not add a model.
- [ ] Translate pending proactivity proposals into an owner card with accept/review, decline, and narrow-scope language while retaining the current governance endpoint as the decision owner.

## Chunk 4: Verification and delivery

### Task 8: Source-local gates

- [ ] Run targeted Vitest suites for attention, report-kit disclosure, workspace cockpit, and proactivity proposals.
- [ ] Run `pnpm --filter web typecheck` in a compile-ready environment.
- [ ] Run the affected theme/style scans and confirm no hardcoded UI colors.
- [ ] Inspect `git diff --check` and the branch diff against `origin/main` for scope and stale-base errors.

### Task 9: Canonical runtime and UX evidence

- [ ] Use `pnpm verify:preflight -- --feature-sha <sha>` and obey its verdict.
- [ ] Route production build and runtime-bound checks through the canonical local install or leased `local-integration-ci` environment.
- [ ] Exercise `/workspace` and `/workspace/inbox` as the owner persona with money, public, platform-health, build-stall, digest, and proactivity-proposal fixtures.
- [ ] Verify desktop and narrow viewport: no overlap, no horizontal scroll, actions remain readable, technical detail is one click down, and `/ops` appears only inside technical detail.
- [ ] Record execution evidence against the five BIs.

### Task 10: Governed delivery

- [ ] Re-sweep `origin/main`, open PRs, and BI claims before push.
- [ ] Update the spec with any implementation-grounded contract clarifications; otherwise include a process-spine attestation.
- [ ] Commit with `git commit -s`, push the branch, wait for CI, fix failures, and open one ready-for-review PR against `main`.
- [ ] Mark each BI done only after its acceptance behavior is implemented and canonical evidence is recorded.

## Risks and rollback

- **Risk:** over-translation hides a fact the owner needs. **Control:** raw title and all available source fields remain in technical detail; translator tests cover every source.
- **Risk:** routing hides a genuine business choice. **Control:** money/public hard floors, customer/business blast-radius override, lane table tests, and a visible custodian count.
- **Risk:** digest becomes a second inbox. **Control:** digest items never enter the daily count and surface as a single weekly batch.
- **Risk:** new card dialect fragments the portal. **Control:** one card component shared by both Workspace views and one backwards-compatible enhancement to `ExpandableCard`.
- **Rollback:** revert the owner projection consumers to the existing `buildOutsideInCockpit`/raw `AttentionInbox` rendering. Source adapters and persisted data are unchanged, so rollback requires no migration or data repair.
