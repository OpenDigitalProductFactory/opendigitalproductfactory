---
title: Shared Change Reviewer Control Implementation Plan
date: 2026-07-27
status: active
item: BI-67E23B70
epic: EP-BUILD-65837F
spec: docs/superpowers/specs/2026-07-27-shared-change-reviewer-control-design.md
---

# Shared Change Reviewer Control Implementation Plan

> **For agentic workers:** execute this plan one independently reviewable
> backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for
> red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's
> completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Objective

Close the semantic-review timing gap between Build Studio and external coding
surfaces with one independently authored review contract and one governed
Change Reviewer coworker. Preserve GitHub as a second oracle and reuse the
existing evidence, activation, and finding-verification substrate.

## Backlog coverage

Coverage receipt: `cms2n13cq023t01qqh8pfe5c2` (`decomposed`).

| Deliverable | Backlog item | Depends on |
|---|---|---|
| Governed Change Reviewer definition and lifecycle | BI-DED7D653 | — |
| Shared semantic review contract and fresh receipt | BI-1B83AA84 | BI-DED7D653 |
| External and Build Studio transition wiring | BI-877EEA34 | BI-DED7D653, BI-1B83AA84 |
| Deterministic enforcement and outcome telemetry | BI-BD3F687C | BI-877EEA34 |

Umbrella: BI-67E23B70.

## Phase 1 — Define the Change Reviewer

Backlog item: `BI-DED7D653`.

Deliverables:

1. Add `change-reviewer` to `COWORKER_AGENT_SEEDS`.
2. Add the factory-approved read-only grants to
   `HARDCODED_COWORKER_GRANTS`.
3. Bind the coworker to the Build Studio/delivery route in
   `apps/web/lib/tak/agent-routing.ts` and mirror confidential sensitivity in
   `apps/web/lib/tak/route-context-map.ts`.
4. Add a strong model floor in
   `packages/db/src/agent-model-defaults.ts`.
5. Map the role into the software-development profession family in
   `docs/professions/registry.json`.
6. Add a curated read-only golden journey in
   `apps/web/lib/coworker-lifecycle/golden-journeys.ts`.
7. Seed the new definition as `draft` and refactor reseeding to preserve the
   live lifecycle stage, so deploy cannot bypass certification or undo a later
   explicit promotion.

TDD:

- First extend coworker-definition conformance expectations and watch the
  missing axes fail.
- Add the minimum complete definition and re-run the focused conformance,
  workforce seed, routing, model-default, and golden-journey tests.

Verification:

- The coworker definition conformance suite names no missing axis.
- Grants contain no write/advance/publish authority.
- The golden journey is read-only and proves an evidence-bearing review.
- A seed/reseed cannot promote the draft or demote an explicitly promoted
  coworker.

Rollback:

- Revert the definition PR. The factory-created live draft remains
  non-summonable and can be abandoned without production authority.

## Phase 2 — Consolidate the shared contract and receipt

Backlog item: `BI-1B83AA84`.

Deliverables:

1. Extract surface-neutral change-review types, prompt construction, result
   parsing, and version constants from Build Studio-specific code.
2. Define pure receipt creation/freshness functions over capsule, base/head
   tree, diff digest, policy version, reviewer version, and specialist set.
3. Reuse `ExternalEvidenceRecord` and `WorkCapsuleActivity` for persistence and
   projection.
4. Generalize verified-finding review to accept code artifacts while
   preserving current plan-review behavior.
5. Keep the finding-substrate guard green; add no Prisma model.

TDD:

- Add failing unit cases for stable freshness, code-change invalidation,
  rebase invalidation, policy/reviewer invalidation, specialist-set
  invalidation, and low-risk auto-pass evidence.
- Add failing compatibility cases that preserve current Build Studio review
  output.
- Implement and refactor under the green suite.

Verification:

- Focused contract and compatibility tests pass.
- `scripts/check-finding-substrate.mjs` passes.
- Typecheck and production build pass through the correct source-local/shared
  sandbox gates.

Rollback:

- Keep Build Studio's existing call site behind an adapter until compatibility
  tests prove the shared contract; reverting the adapter restores the prior
  behavior without data migration.

## Phase 3 — Wire both delivery paths

Backlog item: `BI-877EEA34`.

Deliverables:

1. Add the native review operation/tool used by external delivery surfaces.
2. Wire `decideExternalReviewActivation` into that operation and the capsule
   evidence path.
3. Update `dpf-finishing-a-development-branch` and `dpf-pr-with-dco` so the
   semantic review occurs on a stable local commit before `pregate`/first
   publication.
4. Add an assembled-change Build Studio invocation before
   verification/promotion, preserving existing task-level reviews.
5. Route high-risk/content-specific changes into existing specialist branches
   in coordination with `BI-663A6346`.

TDD:

- Add failing tests that show runtime code requires review, docs can auto-pass,
  stale receipts trigger re-review, loops stop after two repairs, and both
  surfaces emit the same evidence shape.
- Implement external and Build Studio adapters under those tests.

Verification:

- Simulated Codex/Claude/Grok delivery reaches review before publication.
- A Build Studio assembled change reaches the same contract.
- Work Capsule activity renders one coherent review event on both paths.
- No UI route is added; existing timeline UX remains scannable.

Rollback:

- A policy switch returns adapters to shadow-only mode without removing stored
  evidence.

## Phase 4 — Enforce and learn

Backlog item: `BI-BD3F687C`.

Deliverables:

1. Collect shadow-mode review/GitHub/CI outcome pairs.
2. Define measured precision/unique-yield thresholds.
3. Add a fast hook/control that validates receipt freshness or an evidenced
   policy exemption without invoking an LLM.
4. Project outcome metrics into existing process-spine telemetry.
5. Ratchet enforcement only after measured signal quality is acceptable.

TDD:

- Add failing hook cases for missing, stale, valid, and explicitly exempt
  receipts.
- Add outcome-correlation tests across local receipt and GitHub/CI result.

Verification:

- Hook latency is deterministic and does not depend on model/network calls.
- Applicable runtime changes cannot publish without fresh evidence.
- Metrics distinguish accepted findings, false positives, and post-PR misses.

Rollback:

- Return enforcement to shadow mode while retaining receipts and telemetry.

## Completion gate

The umbrella is complete only when:

- all four child BIs are done through separate reviewable PRs;
- the coworker has passed behavioral certification and was promoted through
  `establish_coworker(action="promote")`;
- Build Studio and at least one supported external surface have produced
  equivalent fresh receipts on real changes;
- critical-finding verification is active for code review;
- deterministic enforcement is calibrated from shadow evidence;
- focused tests, production build, UX/timeline verification, finding-substrate
  guard, local merged-code gate, and PR health are green;
- user/contributor architecture and workflow documentation is current.
