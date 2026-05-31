# Decision Perspective Experience Layer Implementation Plan

| Field | Value |
| --- | --- |
| Date | 2026-05-31 |
| Status | Draft |
| Source spec | ../specs/2026-05-31-wwmd-explainability-layer-design.md |
| Epic | EP-WWMD-MCP |
| Backlog items | BI-188950EA, BI-D9F8D35E, BI-1BF0F1D9, BI-141B574A, BI-6C6AD644 |

## Implementation Progress

Direct implementation is underway in worktree `/Users/markbodman/dpf-worktrees/wwmd-explainability` on branch `doc/wwmd-explainability`.

- Task 0 complete: substrate, branch, backlog, profile-mode, and existing review/canvas extension points were checked.
- Task 1 implemented: `apps/web/lib/decision-perspective/canvas.ts` and tests project DecisionInteraction/evaluation data into an operator-safe Decision Canvas view model for WWMD, WWWD, and custom profiles.
- Task 2 implemented: `apps/web/lib/decision-perspective/material-backlinks.ts` and tests provide profile-material/wiki backlinks, citations, prior decisions, caps, and stable missing states.
- Task 3 implemented: `/platform/ai/decisions/[interactionId]` renders the generic Decision Canvas and profile-aware next action.
- Task 4 implemented: `MaterialBacklinksPanel` renders governed backlinks and holds draft/candidate material in review instead of presenting it as doctrine.
- Task 5 implemented: the existing founder-review queue now carries profile labels, WWMD/WWWD mode, Decision Canvas links, owner/operator wording, and a disabled record-outcome action gated on WWMD MCP Sprint 1.
- Task 6 implemented: `research-capture.ts` turns selected Markdown/web capture into draft-only RawSource/WikiPage/PerspectiveMaterial candidate shapes with explicit target profile and secret-looking-content flags.
- Task 7 implemented: `docs/user-guide/ai-workforce/decision-perspective.md` now explains Decision Canvas, material backlinks, research capture, WWMD vs WWWD review, and proposal-only capture behavior.
- Task 8 partially blocked: static checks pass, but Vitest cannot start in the current local toolchain because the `rolldown` native binding fails macOS code-signature loading before tests execute.

## Goal

Add an operator-readable Decision Perspective experience layer inspired by Obsidian's backlinks, local graph, canvas, and bases patterns while keeping DPF's governed decision/wiki substrate authoritative.

WWMD and WWWD are profile modes on the same substrate:

- WWMD applies Mark/DPF platform doctrine to architecture, governance, Build Studio, and agent behavior.
- WWWD applies organization-local doctrine to business policies, customer commitments, and operating choices.
- The Decision Canvas and backlinks services must be profile-aware and must not hardcode WWMD where a `DecisionPerspectiveProfile` can supply the active doctrine.

Because Build Studio is currently unreliable, this plan is written for direct implementation in this repository. It still follows DPF gates: branch discipline, small commits, tests per slice, production build before claiming completion, and UX verification for UI slices.

## Design Review Updates

The source design was reviewed after the WWMD/WWWD clarification and again as a chief-architect pass. The plan now reflects these decisions:

- **Decision first.** The implementation projects existing decision outputs; it does not create a second decision engine.
- **Profile-aware by default.** WWMD and WWWD are `DecisionPerspectiveProfile` modes using one substrate. New route, service, and type names should be generic unless they are explicitly showing WWMD/WWWD labels.
- **Material, not only principle.** The backlinks service and UI handle both wiki-backed principles and profile-local `PerspectiveMaterial`.
- **Review inbox, not only founder review.** WWMD uses founder review wording; WWWD uses owner/operator review wording on the same queue/projection shape.
- **Capture requires an explicit target profile.** Research capture can feed WWMD or WWWD, but only as draft/review-needed candidate material.
- **Extend the existing substrate; do not stand up a parallel directory.** `apps/web/lib/decision-perspective/` already exists on `main` with `view-model.ts` (the `DECISION_INTERACTION_GATE_SELECT` + `DecisionInteractionGateView` projection), `evaluator.ts`, `material.ts`, `persistence.ts`, and `types.ts`. The experience-layer modules are projection/UI extensions of that substrate, not a sibling namespace. `apps/web/lib/founder-review/queue.ts` is already the canonical review-projection home and must be generalized in place rather than shadowed by a new module. Pre-staged work under `apps/web/lib/wwmd-explainability/` (decision-canvas.{ts,test.ts}) must be relocated as part of the first slice.

Implementation consequence: all new service code lives under `apps/web/lib/decision-perspective/` (or extends `apps/web/lib/founder-review/`). Do not create `decision-perspective-experience/` or `wwmd-explainability/` as a directory - both names bake in either WWMD-only framing or unnecessary substrate duplication, which the [`substrate-cleanup-before-substrate-addition`](../../founder-kernel/wiki/principles/substrate-cleanup-before-substrate-addition.md) and [`schema-honesty-over-aspirational-naming`](../../founder-kernel/wiki/principles/schema-honesty-over-aspirational-naming.md) principles reject.

## Current Dependencies

Do not start implementation until the active WWMD MCP Sprint 1 substrate and generic Decision Perspective model are understood:

- `docs/superpowers/specs/2026-05-19-wwmd-mcp-exposure-design.md`
- `docs/superpowers/plans/2026-05-19-wwmd-mcp-exposure.md`
- `docs/superpowers/specs/2026-05-31-wwmd-explainability-layer-design.md`
- `apps/web/lib/decision-perspective/*`
- `apps/web/lib/wiki/principle-decide.ts`
- `apps/web/lib/mcp-tools.ts` `principle_decide` handler
- `packages/db/prisma/schema.prisma` `DecisionInteraction`, `PerspectiveMaterial`, `WikiPage`, `WikiPageLink`, `WikiPageSource`, `RawSource`

If Sprint 1 has not landed locally, implement this plan behind fixtures and typed adapters so it can attach cleanly after Sprint 1 merges.

## Task 0 - Substrate Check

Files: read-only.

- Verify current branch is not `main`.
- Verify `EP-WWMD-MCP` contains BI-188950EA, BI-D9F8D35E, BI-1BF0F1D9, BI-141B574A, and BI-6C6AD644.
- Search for existing `wwmd_evaluate`, `DecisionInteraction`, `DecisionPerspectiveProfile`, `principle_decide`, and founder-review code before adding modules.
- Confirm the canonical extension points and short-circuit any "new sibling directory" instinct: `apps/web/lib/decision-perspective/view-model.ts` (gate-side projection via `DECISION_INTERACTION_GATE_SELECT` / `DecisionInteractionGateView`) and `apps/web/lib/founder-review/queue.ts` (`projectFounderReviewCandidate`, `groupFounderReviewCandidates`, `FounderReviewUnresolvedReason`) already exist. New work extends those files; it does not parallel them.
- Read the existing `FounderReviewUnresolvedReason` union (`principle-gap | evidence-gap | domain-gap | ownership-gap | volunteers-dilemma`). Any new reason value the spec implies (e.g. `conflict-review`) must extend the union with matching `ACTION_BY_REASON` / `LABEL_BY_REASON` map entries and a `normalizeReason` round-trip test - not a parallel taxonomy.
- Confirm whether `questionFingerprint` has landed. If not, avoid depending on it outside optional links.
- Confirm whether any WWWD/business-profile naming exists. If not, keep new service names generic and profile-aware.
- If `apps/web/lib/wwmd-explainability/` exists in the worktree from pre-staged work, plan its relocation into `apps/web/lib/decision-perspective/` as the first commit of Task 1 (one move per file, no logic change, so the rename is reviewable on its own).

Verification:

```bash
git status --short --branch
rg -n "wwmd_evaluate|DecisionInteraction|DecisionPerspectiveProfile|principle_decide|founder-review|PerspectiveMaterial" apps/web packages/db
rg -n "DECISION_INTERACTION_GATE_SELECT|projectFounderReviewCandidate|FounderReviewUnresolvedReason" apps/web/lib
ls apps/web/lib/decision-perspective apps/web/lib/founder-review apps/web/lib/wwmd-explainability 2>/dev/null
```

## Task 1 - Decision Canvas Projection Service

Backlog: BI-D9F8D35E.

Place under the existing decision-perspective namespace; do not create a sibling directory:

- `apps/web/lib/decision-perspective/canvas.ts` (sits beside `view-model.ts`; reuses its helpers - `asRecord`, `normalizeOutcomeType`, `normalizeNumber` - rather than re-deriving them)
- `apps/web/lib/decision-perspective/canvas.test.ts`

If `apps/web/lib/wwmd-explainability/decision-canvas.{ts,test.ts}` exists from pre-staged work, the first commit of this task is a pure rename to the paths above (no logic change), so the substrate consolidation is reviewable on its own.

Design:

- Export `projectDecisionCanvas(input)` as a pure function.
- Canonical input type is `DecisionPerspectiveEvaluationResult` from `apps/web/lib/decision-perspective/types.ts` plus the optional metadata block below. `principle_decide` is a feeder upstream of `evaluateDecisionPerspective`, not a direct canvas input.
- For DB-side callers, also export `fromDecisionInteractionRow(row): DecisionCanvasInput` as a thin adapter. Reuse `DECISION_INTERACTION_GATE_SELECT` from `view-model.ts` rather than declaring a parallel `select` shape; if the canvas needs additional columns, extend the existing select so both projections stay in sync (`single-source-of-truth`).
- Input must carry enough profile metadata to label WWMD vs WWWD without changing the projection shape.
- Include a generic profile block in the view model:
  - `profileId`
  - `profileLabel`
  - `perspectiveMode: "wwmd" | "wwwd" | "custom"`
- Output is an operator-safe view model:
  - `header`
  - `options`
  - `recommendation`
  - `materialPulls`
  - `evidence`
  - `sources`
  - `outcome`
  - `audit`

Rules:

- Strip or sanitize raw strings containing `mcp`, `principle_decide`, and internal skill ids from default prose.
- Keep raw ids in `audit`, not in default cards.
- Do not query the DB from this module.
- Do not use WWMD-specific names in output types unless the field is explicitly profile metadata.
- Keep `recommendation`, `materialPulls`, and `sources` generic enough to carry either principle rows or organization material rows. Keep `principlePulls` only as a compatibility alias if existing UI depends on it.

Tests:

- recommend outcome projects selected option and confidence
- `fromDecisionInteractionRow` round-trips a fixture row into the same view model as the direct-input path
- profile metadata can identify WWMD and WWWD without branching the model
- WWMD defer outcome produces founder-review next action
- WWWD defer outcome produces owner/operator review next action
- commandment conflict sets blocked state
- raw MCP/tool language is hidden from default labels
- audit model preserves ids

Run:

```bash
pnpm --filter web exec vitest run lib/decision-perspective/canvas.test.ts lib/decision-perspective/view-model.test.ts
pnpm --filter web typecheck
```

## Task 2 - Material Backlinks Service

Backlog: BI-1BF0F1D9.

Create under the existing decision-perspective namespace:

- `apps/web/lib/decision-perspective/material-backlinks.ts`
- `apps/web/lib/decision-perspective/material-backlinks.test.ts`

Design:

- Export `getMaterialBacklinks(input)` with injectable DB client for tests.
- Given a principle page id, profile material id, or slug, return:
  - incoming wiki links
  - outgoing wiki links
  - source citations
  - related stances and heuristics
  - prior decision references when available
- Cap the local neighborhood. Default cap: 12 in-links, 12 out-links, 8 sources, 8 decisions.
- Return a stable shape even when a material has no wiki page:
  - `material`
  - `wikiNeighborhood`
  - `sources`
  - `priorDecisions`
  - `openWork`

Rules:

- Use `WikiPageLink`, `WikiPageSource`, `RawSource`, `PerspectiveMaterial`, and `DecisionInteraction` only.
- No Neo4j dependency in V1.
- No global graph rendering in this task.

Tests:

- returns incoming and outgoing links
- prioritizes stance/heuristic neighbors
- handles profile material without a wiki page
- includes citations
- handles missing principle page
- enforces caps

Run:

```bash
pnpm --filter web exec vitest run lib/decision-perspective/material-backlinks.test.ts
pnpm --filter web typecheck
```

## Task 3 - Decision Canvas Route and Components

Backlog: BI-188950EA plus BI-D9F8D35E.

Create or extend, following local route conventions discovered in Task 0:

- `apps/web/app/(shell)/platform/ai/decisions/[interactionId]/page.tsx`
- `apps/web/components/decision-perspective/DecisionCanvas.tsx`
- `apps/web/components/decision-perspective/MaterialPullList.tsx`
- `apps/web/components/decision-perspective/EvidenceSourceList.tsx`

Design:

- Server page loads the decision row and calls the projection service.
- Component renders the canvas blocks from the spec.
- The route is generic. WWMD/WWWD labeling comes from the profile.
- The page chooses review labels from `perspectiveMode`: founder review for WWMD, owner/operator review for WWWD/custom.
- Default view is dense, operational, and theme-aware.
- Audit drawer is collapsed by default.

UI rules:

- Follow [`docs/platform-usability-standards.md`](../../platform-usability-standards.md) (theme tokens `var(--dpf-*)`, prohibited hardcoded colors, WCAG 2.2 AA contrast, baseline form-element styling). Do not introduce a parallel rule list in this plan or the component files.
- No nested cards. No large marketing-style hero. Text must fit in narrow widths.

Tests:

- page renders question, recommendation, options, and next action
- page renders WWMD and WWWD labels from profile metadata
- raw MCP/tool names do not appear in default HTML
- defer outcome shows the correct profile-specific review action

Run:

```bash
pnpm --filter web exec vitest run components/decision-perspective app/\\(shell\\)/platform/ai/decisions
pnpm --filter web typecheck
```

UX verification:

- Start the appropriate local app surface.
- Log in if needed.
- Open a seeded or fixture-backed decision.
- Verify desktop and mobile widths.

## Task 4 - Material Backlinks Panel UI

Backlog: BI-1BF0F1D9.

Create:

- `apps/web/components/decision-perspective/MaterialBacklinksPanel.tsx`
- tests beside the component or route page tests

Design:

- Render one panel per surfaced principle/material, collapsed by default when there are more than three items.
- Show related stances/heuristics first, then citations, then prior decisions.
- Link to `/wiki/[slug]` for wiki pages.
- Link to the Decision Canvas for prior decisions when route exists.

Tests:

- renders linked stance/heuristic/citation groups
- renders profile material without wiki links
- empty panel explains that no governed backlinks exist
- does not render unreviewed capture material as active doctrine

Run:

```bash
pnpm --filter web exec vitest run components/decision-perspective/MaterialBacklinksPanel.test.tsx
pnpm --filter web typecheck
```

## Task 5 - Review Inbox Integration

Backlog: BI-141B574A.

**The substrate already exists on `main`.** Extend it in place; do not create a parallel review module.

Files to extend (not create):

- `apps/web/lib/founder-review/queue.ts` - currently exports `projectFounderReviewCandidate`, `groupFounderReviewCandidates`, `FounderReviewUnresolvedReason`, `DecisionInteractionQueueRow`. This is the canonical review-projection home.
- `apps/web/app/(shell)/platform/ai/founder-review/page.tsx` - already loads `DecisionInteraction` rows with `outcomeType IN ('defer','escalate')` and groups via `groupFounderReviewCandidates`.
- `apps/web/app/(shell)/platform/ai/founder-review/page.test.tsx` - extend with profile-aware cases.

Design - generalize in place:

- Add an optional `perspectiveMode` and `profileLabel` field to `FounderReviewCandidate` (sourced from the row's `DecisionPerspectiveProfile` via the existing select). The persisted enum and queue shape are unchanged; only the projection grows.
- Add a "View Decision Canvas" link on every card pointing at the Task 3 route (`/platform/ai/decisions/[interactionId]`).
- Choose the page-level heading and per-card primary-action label from `perspectiveMode`: WWMD -> "Founder Review" / "Clarify founder principle"; WWWD or `custom` -> "Owner/Operator Review" / "Clarify operating policy".
- If a profile-mode filter is needed in V1, add it as a URL query param (`?mode=wwmd|wwwd`) handled in the page, not as a second route.
- Record-outcome action is split out (see below).

Reason taxonomy - extend the existing union; do not introduce a parallel one:

- Current union: `principle-gap | evidence-gap | domain-gap | ownership-gap | volunteers-dilemma`.
- If the spec's "conflict review" reason is genuinely additive, extend the union to `... | conflict-review`, add matching entries to `ACTION_BY_REASON` and `LABEL_BY_REASON`, and add a `normalizeReason` round-trip test. Otherwise drop "conflict review" from the spec.
- Preserve `volunteers-dilemma` - it is already persisted in production data and the spec's omission is a doc gap, not a deprecation.

Record-outcome action - gated split:

- The wired record-outcome button depends on the `wwmd_record_outcome` MCP handler from WWMD MCP Sprint 1. Until that BI lands, ship the button as disabled-with-tooltip explaining the gate, and add a TODO note citing the Sprint 1 BI id. Do not stub a fake handler.

Tests (extend `page.test.tsx` and `queue.test.ts`):

- existing `principle-gap`, `evidence-gap`, `domain-gap`, `ownership-gap`, `volunteers-dilemma` cards still render with their current labels
- each card renders a "View Decision Canvas" link to `/platform/ai/decisions/[interactionId]`
- WWMD card primary action says "Clarify founder principle"
- WWWD card primary action says "Clarify operating policy"
- if `conflict-review` is added: `normalizeReason("conflict-review")` round-trips, and the label/action maps both contain the key
- raw outcome payload is not shown in default card
- record-outcome button is disabled with the Sprint 1 gate tooltip until the MCP handler exists

Run:

```bash
pnpm --filter web exec vitest run lib/founder-review app/\\(shell\\)/platform/ai/founder-review
pnpm --filter web typecheck
```

## Task 6 - Research Capture Adapter

Backlog: BI-6C6AD644.

Create under the existing decision-perspective namespace:

- `apps/web/lib/decision-perspective/research-capture.ts`
- `apps/web/lib/decision-perspective/research-capture.test.ts`

Design:

- Normalize selected Markdown/web-clip input into a `RawSource` candidate payload.
- Preserve title, url, authors when present, retrievedAt, source type, excerpt, and body preview.
- Mark all outputs as draft/review-needed.
- Return proposed `WikiPage` or `PerspectiveMaterial` candidates only as draft shapes. Do not write in the pure adapter.
- Candidate output must target an explicit profile id; WWMD and WWWD capture use the same shape.
- Candidate output must carry a `targetProfileId` and `targetPerspectiveMode` so review can route it to founder review or owner/operator review.

Rules:

- No bulk vault import.
- No auto-promotion.
- Secret-looking content must be rejected or flagged.

Tests:

- Markdown with frontmatter maps to candidate source metadata
- capture fails validation when no target profile is supplied
- missing URL still creates a local-source candidate
- secret-looking input is flagged
- output cannot be active/promoted/published

Run:

```bash
pnpm --filter web exec vitest run lib/decision-perspective/research-capture.test.ts
pnpm --filter web typecheck
```

## Task 7 - Documentation and Operator Notes

Modify:

- `docs/user-guide/` page chosen after local docs search, or add a short WWMD explainability page if no current home exists.
- Link from the WWMD MCP operator docs if Sprint 1 documentation has landed.

Content:

- Difference between WWMD decision, principle backlink, and research capture.
- Difference between WWMD platform decisions and WWWD organization decisions.
- Capture material is proposal-only.
- When to use founder review.
- When to use operator/owner review.

Run docs/link checks if an existing command is available. Otherwise run at least:

```bash
pnpm --filter web typecheck
```

## Task 8 - Final Verification

Run affected tests:

```bash
pnpm --filter web exec vitest run lib/decision-perspective lib/founder-review components/decision-perspective app/\\(shell\\)/platform/ai/decisions app/\\(shell\\)/platform/ai/founder-review
pnpm --filter web typecheck
```

Run production build before claiming completion:

```bash
cd apps/web && pnpm exec next build
```

For UI slices, verify in browser:

- Decision Canvas default view for a WWMD-profile decision
- Decision Canvas default view for a WWWD/org-profile-style fixture
- audit drawer collapsed and expanded
- material backlinks panel
- founder/operator review inbox
- mobile width

## Commit and PR Notes

- One concern per commit. If pre-staged code under `apps/web/lib/wwmd-explainability/` is being relocated, the rename is its own commit with no logic change, so the substrate consolidation is reviewable on its own.
- DCO sign-off required.
- Do not include unrelated files.
- PR body cites `EP-WWMD-MCP` and the relevant BI ids only - keep durable repo doc focused on what the change does, not the day-of operational state.
- Record the Build Studio bypass on the BI evidence trail (`mcp__dpf__record_external_development_evidence` or BI comment), not in the PR body. This is a transient operational fact about why the work landed via direct branch; it should not become permanent git history.
