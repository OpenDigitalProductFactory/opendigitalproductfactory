# Governed Playbook Work Case Staging Implementation Plan

> **For agentic workers:** REQUIRED: Use the DPF worktree, planning, TDD, UX-fit, verification, and PR-with-DCO skills for this plan. Steps use checkbox (`- [ ]`) syntax for execution tracking.

**Backlog item:** `BI-6F6C0675` - Governed adaptive playbooks Slice 5: Work Case staged proposal path

**Work capsule:** `WC-9D3CA4E6` - Governed Playbook Work Case Staging

**Goal:** Approved case-bound Living Playbook candidates should project into the existing Work Case staged-proposal rail with sponsor, authority, policy, and receipt guardrails. This slice must remain proposal-only: it records the staging state in review/readiness JSON and UI, but it must not mutate live Work Case state, TrustState, skills, prompts, grants, model routes, WorkItems, source records, or autonomy levels.

**Architecture:** Extend the current governed work-pattern review model with a pure Work Case staging projection. Reuse existing Work Case substrate (`action-registry`, `policy-envelope`, `receipt-coverage`, `staged-transition`, source refs, and accountability context) instead of adding a new table, enum, dashboard, or runtime rail. The server action continues to write only `DecisionInteraction` and `CoworkerCapabilityNeed` readiness/review JSON.

**Tech stack:** Next.js 16 server actions, Prisma 7 via `@dpf/db`, Vitest, React server rendering tests, existing TAK work-pattern modules, existing Work Case management helpers, existing `NeedsAndPlaybooksPanel` UI.

---

## Grounding

- Design source: `docs/superpowers/specs/2026-06-27-governed-adaptive-playbooks-design.md`.
- Work Case source: `docs/superpowers/specs/2026-06-27-work-management-architecture-design.md`.
- Previous slice: `docs/superpowers/plans/2026-06-28-governed-adaptive-playbooks-review-activation.md`.
- Existing code substrate:
  - `apps/web/lib/tak/work-pattern-review.ts`
  - `apps/web/lib/tak/work-pattern-types.ts`
  - `apps/web/lib/tak/work-pattern-read-model.ts`
  - `apps/web/lib/actions/work-pattern-review.ts`
  - `apps/web/lib/work-management/action-registry.ts`
  - `apps/web/lib/work-management/accountability.ts`
  - `apps/web/lib/work-management/policy-envelope.ts`
  - `apps/web/lib/work-management/receipt-coverage.ts`
  - `apps/web/lib/work-management/staged-transition.ts`
  - `apps/web/components/platform/coworker-record/NeedsAndPlaybooksPanel.tsx`

## UX Fit Review

- Decision: `fits-with-guardrails`
- Owning area: Platform
- Route family: `/platform/ai/agent/[agentId]`
- Primary persona: platform operator reviewing coworker behavior before granting any live agency
- Navigation layer touched: local row-level disclosure inside the existing AI Workforce Needs & Playbooks tab
- Reuse/convergence: reuse `NeedsAndPlaybooksPanel`, existing chips, `LocalTime`, and DPF theme variables; no new dashboard, tab row, card family, or Work Case route dependency
- Source truth: work-pattern readiness/review JSON projected by TAK read models; Work Case policy/receipt/staged-transition helpers own proposal semantics
- Empty/failure behavior: non-case-bound candidates remain unchanged; blocked case-bound candidates show a compact blocked reason; no empty Work Case dashboard
- AI boundary: no prompt send and no live activation; this is a recorded proposal preview awaiting governed Work Case action and receipt evidence
- Required plan/spec edits: this plan records the fit result and keeps UI copy on "Living Playbook" / "Work Case proposal," never "scaffold" or raw ledger terms
- Evidence before merge: source-local Vitest, typecheck, production build, and UI rendering coverage for the compact row
- Captured in: this plan and the PR body

`UX-Fit-Decision: compact-existing-needs-playbooks-row (principle_decide; reuses AI Workforce Needs & Playbooks row, avoids duplicate Work Case dashboard, shows staged proposal guardrails without live activation)`

## Refactoring Allocation

Reserve roughly 20 percent of the slice for refactoring under green tests:

- Extract Work Case staging into a pure TAK module rather than folding more branching into the server action.
- Keep parsing and summary helpers typed and reusable so the read model and UI do not parse ad hoc JSON.
- Remove any duplicated status-label logic introduced by the slice before PR.

No broad unrelated cleanup belongs in this PR.

---

## Chunk 1: Pure Case Staging Projection

### Task 1: Add test-first Work Case staging semantics

**Files:**
- Create: `apps/web/lib/tak/work-pattern-case-staging.ts`
- Create: `apps/web/lib/tak/work-pattern-case-staging.test.ts`
- Update: `apps/web/lib/tak/work-pattern-review.ts`
- Update: `apps/web/lib/tak/work-pattern-review.test.ts`

- [x] **Step 1: Write failing pure-module tests**

Cover:

- Approved case-bound review plus metadata with `workCaseBinding`, `governedActionKey`, `authorityMode`, `sponsorPrincipalId`, receipt policy, and `workCaseRef` returns a `stageable` proposal.
- The stageable proposal projects through `projectWorkCaseStagedTransition` as `awaiting-decision`, `input-required`, and `committable: false`.
- Missing receipt policy, unknown action key, unsupported source/action, missing authority, or missing sponsor returns `blocked` with operator-readable blocker keys.
- Non-case-bound approval returns `not-case-bound`.
- Rejected/deferred review returns `not-case-bound` and never stages.

Run: `pnpm --filter web exec vitest run lib/tak/work-pattern-case-staging.test.ts lib/tak/work-pattern-review.test.ts`

Expected first run: fail because the case-staging module and parser extension do not exist yet.

- [x] **Step 2: Implement the pure module**

Create a pure module that:

- Exports `WorkPatternCaseStagingState`.
- Reads case binding from `WorkPatternMetadata`.
- Parses the first available `workCaseRef` evidence into a `WorkCaseRef`.
- Resolves the governed action with `getWorkCaseAction`.
- Builds a supervised `WorkCasePolicyEnvelope` with accountability context from the binding.
- Uses `evaluateWorkCasePolicy` for static guardrails.
- Uses `projectWorkCaseStagedTransition({ status: "proposed" })` for the proposal projection.
- Uses `assertWorkCaseReceiptCoverage` only to identify receipt guardrails; a missing receipt is "required before commit," not permission to execute.
- Returns a proposal rail descriptor for a future governed `CoworkerActionEnvelope` without writing an envelope row.

- [x] **Step 3: Extend review state parsing**

Update `WorkPatternReviewState`, `parseWorkPatternReviewState`, and related tests so case staging is preserved in readiness JSON while old review JSON still parses.

---

## Chunk 2: Server Action and Read Model

### Task 2: Persist staging projection with review evidence

**Files:**
- Update: `apps/web/lib/actions/work-pattern-review.ts`
- Update: `apps/web/lib/actions/work-pattern-review.test.ts`
- Update: `apps/web/lib/tak/work-pattern-read-model.ts`
- Update: `apps/web/lib/tak/work-pattern-read-model.test.ts`

- [x] **Step 1: Write failing action/read-model tests**

Cover:

- Approving a case-bound candidate stores `workPatternReview.caseStaging.status: "stageable"` in readiness JSON.
- The related `DecisionInteraction` outcome/evidence includes the same staging state.
- Missing policy/receipt/sponsor metadata stores `blocked` with blocker keys.
- Non-case-bound candidates keep the prior activation-candidate behavior.
- No `CoworkerActionEnvelope`, Work Case, WorkItem, TrustState, SkillDefinition, PromptTemplate, grant, model-route, source-record, or backlog mutation is attempted.

Run: `pnpm --filter web exec vitest run lib/actions/work-pattern-review.test.ts lib/tak/work-pattern-read-model.test.ts`

Expected first run: fail until the action and read model call the pure projection.

- [x] **Step 2: Wire the action**

After `buildWorkPatternReview`, parse metadata from existing readiness/evidence JSON and attach case staging before creating `DecisionInteraction` and updating `CoworkerCapabilityNeed`.

The action may only persist:

- `DecisionInteraction`
- `CoworkerCapabilityNeed.status`
- `CoworkerCapabilityNeed.reviewerNote`
- `CoworkerCapabilityNeed.readinessJson`
- existing review timestamp/user fields already owned by the previous slice

- [x] **Step 3: Wire the read model**

Expose `caseStaging` through `WorkPatternSummary` via parsed review state so UI code does not inspect raw JSON.

---

## Chunk 3: Compact Operator UI

### Task 3: Show proposal status in the existing Needs & Playbooks row

**Files:**
- Update: `apps/web/components/platform/coworker-record/NeedsAndPlaybooksPanel.tsx`
- Update or add the nearest component/page rendering test for this panel.

- [x] **Step 1: Write failing UI test**

Assert that a reviewed case-bound Living Playbook row shows:

- `Work Case proposal staged` for stageable proposals.
- `receipt required before commit` as the guardrail copy.
- `Case proposal blocked` for blocked staging.
- No live activation language beyond the existing "candidate record only" warning.
- No user-facing "scaffold", `ReceiptEnvelope`, `DecisionInteraction`, or raw implementation labels.

- [x] **Step 2: Implement compact disclosure**

Use existing chip/row styles and theme variables. Keep the new copy in the existing review row, below the decision chips. Do not add a dashboard, route, tab, or modal.

---

## Chunk 4: Verification, PR, and Landing

### Task 4: Run source-local gates and PR workflow

**Files:**
- All files touched above.

- [x] **Step 1: Focused tests**

Run:

`pnpm --filter web exec vitest run lib/tak/work-pattern-case-staging.test.ts lib/tak/work-pattern-review.test.ts lib/actions/work-pattern-review.test.ts lib/tak/work-pattern-read-model.test.ts 'app/(shell)/platform/ai/agent/[agentId]/page.test.tsx'`

- [x] **Step 2: Typecheck**

Run:

`pnpm --filter web typecheck`

- [x] **Step 3: Production build**

Run:

`pnpm --filter web build`

- [ ] **Step 4: PR mechanics**

Before push:

- Sweep open PRs and recent `origin/main` for overlap.
- Stage explicit paths only; exclude `.mcp.json`.
- Commit with `git commit -s`.
- Push the branch.
- Open a regular non-draft PR only after the gates pass.
- Include `BI-6F6C0675`, `WC-9D3CA4E6`, build-gate evidence, and `UX-Fit-Decision` in the PR body.

---

## Risks and Rollback

- **Risk:** Treating a missing receipt as approval to commit. Mitigation: encode it as `required-before-commit`, keep `committable: false`, and assert this in tests.
- **Risk:** UI copy implies live activation. Mitigation: tests and copy keep "proposal" and "candidate record only"; no "activate" command is added.
- **Risk:** Parallel substrate gets introduced accidentally. Mitigation: no migration, no new model, no envelope writes; Work Case helpers own semantics.
- **Risk:** Case metadata is incomplete on existing records. Mitigation: return blocked state with plain blocker copy instead of throwing from the read model.

Rollback is a revert of this PR. Because the slice is migration-free and writes only readiness/review JSON already owned by the previous slice, rollback does not require schema repair or runtime data migration.

## Definition of Done

- [x] Case-bound approved Living Playbook candidates project to governed Work Case staged proposals with policy and receipt guardrails.
- [x] Non-case-bound candidates retain existing review activation behavior.
- [x] No live Work Case/autonomy/source mutation is introduced.
- [x] Existing Work Case helpers are reused; no parallel table or dashboard is added.
- [x] Focused tests, typecheck, and production build pass.
- [ ] PR is DCO-signed, pushed, opened non-draft, CI-green, and merged.
