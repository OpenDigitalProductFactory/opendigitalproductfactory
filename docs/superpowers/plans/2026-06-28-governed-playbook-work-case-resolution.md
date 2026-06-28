# Governed Playbook Work Case Resolution Implementation Plan

> **For agentic workers:** REQUIRED: Use the DPF worktree, planning, TDD, UX-fit, verification, and PR-with-DCO skills for this plan. Steps use checkbox (`- [ ]`) syntax for execution tracking.

**Backlog item:** `BI-8B322CAB` - Governed playbook Work Case proposal resolution rail

**Work capsule:** `WC-F2348719` - Governed playbook Work Case resolution rail

**Goal:** A staged, case-bound Living Playbook proposal should be resolvable by the operator with approve, defer, or reject semantics while preserving DPF's governed Work Case boundary: approval records the next governed step and receipt requirements, but no playbook-owned path mutates Work Case/source state or live autonomy.

**Architecture:** Extend the existing staged proposal projection with a pure resolution helper. The helper consumes `WorkPatternCaseStagingState`, the operator resolution, and optional receipt evidence, then returns a durable JSON state for `CoworkerCapabilityNeed.readinessJson` and `DecisionInteraction` evidence. Server actions persist only review/resolution evidence; actual consequential case transitions remain behind the Work Case governed Action and `CoworkerActionEnvelope`/receipt path.

**Tech Stack:** Next.js 16 server actions, Prisma 7 via `@dpf/db`, Vitest, React server rendering tests, existing TAK work-pattern modules, existing Work Case staged-transition / receipt helpers, existing `NeedsAndPlaybooksPanel` UI.

---

## Grounding

- Design source: `docs/superpowers/specs/2026-06-27-governed-adaptive-playbooks-design.md`.
- Work Case source: `docs/superpowers/specs/2026-06-27-work-management-architecture-design.md`.
- Previous slice plan: `docs/superpowers/plans/2026-06-28-governed-playbook-work-case-staging.md`.
- Open PR overlap sweep: only PR `#2500` (`doc/work-case-wave-6-plan-closeout`) is open and does not touch this implementation path.
- Recent main sweep: `#2498` staged playbooks into Work Cases, `#2497` added portal Work Case drill-down, and `#2496` added adoption views. This slice extends `#2498`.

## UX Fit Review

- Decision: `fits-with-guardrails`
- Owning area: Platform
- Route family: `/platform/ai/agent/[agentId]`
- Primary persona: platform operator reviewing coworker working-method changes before any Work Case or autonomy effect
- Navigation layer touched: contextual row-level actions inside the existing AI Workforce Needs & Playbooks tab
- Reuse/convergence: reuse `NeedsAndPlaybooksPanel`, existing chips/forms, `LocalTime`, and DPF theme variables; no new dashboard, tab row, card family, route, or modal
- Source truth: work-pattern review/readiness JSON projected by TAK read models; Work Case helpers own action, staged-transition, policy, and receipt semantics
- Empty/failure behavior: non-case-bound proposals remain unchanged; unresolved staged proposals show compact approve/defer/reject actions; approved proposals without receipt evidence show a receipt-needed guardrail
- AI boundary: no prompt send; no live activation; no Work Case/source mutation; approval means "approved for governed action path," not "committed"
- Required plan/spec edits: this plan records the fit result and keeps UI copy on "Living Playbook", "proposal", "approval", and "receipt evidence", never "scaffold" or raw ledger/table terms
- Evidence before merge: source-local Vitest, typecheck, production build, and UI rendering coverage for the compact resolution row
- Captured in: this plan and the PR body

`UX-Fit-Decision: compact-existing-needs-playbooks-resolution-row (principle_decide; reuses AI Workforce Needs & Playbooks row, adds contextual approve/defer/reject proposal resolution, keeps Work Case commit behind governed action and receipt evidence)`

## Refactoring Allocation

Reserve roughly 20 percent of the slice for refactoring under green tests:

- Extract proposal resolution into a pure TAK module instead of adding branching to the server action.
- Reuse resolution parsing from both the server action and read model so UI does not inspect ad hoc JSON.
- Keep UI blocker/guardrail labels centralized and concise.
- Avoid widening schema, enums, routes, or dashboard surfaces.

No broad unrelated cleanup belongs in this PR.

---

## Chunk 1: Pure Case Proposal Resolution

### Task 1: Add test-first resolution semantics

**Files:**
- Create: `apps/web/lib/tak/work-pattern-case-resolution.ts`
- Create: `apps/web/lib/tak/work-pattern-case-resolution.test.ts`
- Update: `apps/web/lib/tak/work-pattern-case-staging.ts`
- Update: `apps/web/lib/tak/work-pattern-case-staging.test.ts`

- [x] **Step 1: Write failing pure-module tests**

Cover:

- A stageable proposal approved without receipt evidence becomes `approved-awaiting-receipt`, keeps `commitAllowed: false`, and projects the staged transition to `approved` while retaining a receipt blocker.
- A stageable proposal approved with a valid governed receipt becomes `approved-ready-for-governed-commit`, with receipt coverage captured and `commitAllowed: true`.
- Reject and defer are terminal/non-committable resolution states and do not require a receipt.
- Blocked or non-case-bound staging cannot be approved.
- Parsing persisted resolution state rejects malformed records and preserves existing staging records without a resolution.

Run: `pnpm --filter web exec vitest run lib/tak/work-pattern-case-resolution.test.ts lib/tak/work-pattern-case-staging.test.ts`

Expected first run: fail because the case-resolution module and parser extension do not exist yet.

- [x] **Step 2: Implement the pure module**

Create a pure module that:

- Exports `WorkPatternCaseResolutionState`.
- Accepts `WorkPatternCaseStagingState`, `decisionInteractionId`, `resolverUserId`, `resolvedAt`, `action`, optional note, and optional `ReceiptEnvelope`.
- Uses `projectWorkCaseStagedTransition({ status: "approved" | "rejected" })` where relevant.
- Uses `assertWorkCaseReceiptCoverage` to distinguish missing, invalid, observed, and governed receipts.
- Keeps `activationAllowed: false`, `liveMutationAllowed: false`, and `commitAllowed` false unless an approved proposal has valid required receipt evidence.
- Returns blocker keys for UI copy rather than raw implementation names.

- [x] **Step 3: Extend staging parse/shape**

Add optional `resolution` to `WorkPatternCaseStagingState` and parse it through `parseWorkPatternCaseStagingState` without breaking existing records.

---

## Chunk 2: Server Action and Read Model

### Task 2: Persist proposal resolution evidence

**Files:**
- Update: `apps/web/lib/actions/work-pattern-review.ts`
- Update: `apps/web/lib/actions/work-pattern-review.test.ts`
- Update: `apps/web/lib/tak/work-pattern-read-model.ts`
- Update: `apps/web/lib/tak/work-pattern-read-model.test.ts`

- [x] **Step 1: Write failing action/read-model tests**

Cover:

- Resolving a stageable proposal with `approve` records a new `DecisionInteraction` and updates readiness JSON with `caseStaging.resolution.status: "approved-awaiting-receipt"`.
- Resolving with `reject` or `defer` records terminal non-commit resolution and does not change the original playbook review action.
- Resolution refuses missing/agent-mismatched/non-stageable proposals before writes.
- No `CoworkerActionEnvelope`, Work Case, WorkItem, TrustState, SkillDefinition, PromptTemplate, grant, model-route, source-record, or backlog mutation is attempted.
- Read model surfaces the parsed resolution state.

Run: `pnpm --filter web exec vitest run lib/actions/work-pattern-review.test.ts lib/tak/work-pattern-read-model.test.ts`

Expected first run: fail until the action and read model use the pure resolver.

- [x] **Step 2: Wire the action**

Add `resolveWorkPatternCaseProposal(formData)` and `resolveWorkPatternCaseProposalAction(formData)`.

The action may only persist:

- `DecisionInteraction`
- `CoworkerCapabilityNeed.readinessJson`
- `CoworkerCapabilityNeed.evidenceJson` decision id append

It may not create a `CoworkerActionEnvelope` row in this slice because this route is not executing the Work Case action. It records approval for the governed action path and receipt requirement only.

- [x] **Step 3: Wire the read model**

Ensure `WorkPatternSummary.caseStaging` preserves parsed resolution data so UI code does not inspect raw JSON.

---

## Chunk 3: Compact Operator UI

### Task 3: Resolve proposals in the existing Needs & Playbooks row

**Files:**
- Update: `apps/web/components/platform/coworker-record/NeedsAndPlaybooksPanel.tsx`
- Update: `apps/web/app/(shell)/platform/ai/agent/[agentId]/page.test.tsx`

- [x] **Step 1: Write failing UI test**

Assert that a stageable case-bound Living Playbook row shows:

- `Approve proposal`, `Defer`, and `Reject` actions for unresolved stageable proposals when `canWrite` is true.
- `Approved - receipt evidence needed` after approval without a receipt.
- `Rejected proposal` / `Deferred proposal` for terminal resolutions.
- No visible "scaffold", `ReceiptEnvelope`, `DecisionInteraction`, `CoworkerActionEnvelope`, or raw implementation labels.

- [x] **Step 2: Implement compact disclosure**

Use existing chip/row styles and theme variables. Keep the new controls inside the existing review row. Do not add a dashboard, route, tab, modal, or chat prompt.

---

## Chunk 4: Verification, PR, and Landing

### Task 4: Run source-local gates and PR workflow

**Files:**
- All files touched above.

- [x] **Step 1: Focused tests**

Run:

`pnpm --filter web exec vitest run lib/tak/work-pattern-case-resolution.test.ts lib/tak/work-pattern-case-staging.test.ts lib/tak/work-pattern-review.test.ts lib/actions/work-pattern-review.test.ts lib/tak/work-pattern-read-model.test.ts 'app/(shell)/platform/ai/agent/[agentId]/page.test.tsx'`

- [x] **Step 2: Typecheck**

Run:

`pnpm --filter web typecheck`

- [x] **Step 3: Production build**

Run:

`pnpm --filter web build`

- [ ] **Step 4: PR mechanics**

Before push:

- Re-sweep open PRs and recent `origin/main` for overlap.
- Stage explicit paths only; exclude `.mcp.json`.
- Commit with `git commit -s`.
- Push the branch.
- Open a regular non-draft PR only after the gates pass.
- Include `BI-8B322CAB`, `WC-F2348719`, build-gate evidence, and `UX-Fit-Decision` in the PR body.

---

## Risks and Rollback

- **Risk:** Approval copy implies live case mutation. Mitigation: tests and UI copy say "proposal" and "receipt evidence needed"; no commit action is added.
- **Risk:** Server action creates a parallel write path. Mitigation: tests assert no envelope/case/source/autonomy mutations.
- **Risk:** Receipt handling becomes ad hoc JSON parsing. Mitigation: pure resolver accepts a typed `ReceiptEnvelope` and parser stores only the resolution projection.
- **Risk:** UI gets too crowded. Mitigation: keep controls row-level and hide them after resolution.

Rollback is a revert of this PR. The slice is migration-free and writes only readiness/review JSON plus `DecisionInteraction` evidence.

## Definition of Done

- [ ] Stageable case-bound Living Playbook proposals can be approved, deferred, or rejected.
- [ ] Approval records receipt requirements and does not commit Work Case state.
- [ ] Valid receipt evidence can mark the proposal ready for the governed commit path.
- [ ] No live Work Case/autonomy/source mutation is introduced.
- [ ] Existing Work Case helpers are reused; no parallel table, receipt, action rail, or dashboard is added.
- [ ] Focused tests, typecheck, and production build pass.
- [ ] PR is DCO-signed, pushed, opened non-draft, CI-green, and merged.
