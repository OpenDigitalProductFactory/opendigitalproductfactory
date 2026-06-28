# Governed Adaptive Playbooks Shadow Trust Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Slice 3 by evaluating Living Playbook candidates in shadow against existing evidence and projecting trust recommendations without changing live autonomy.

**Architecture:** Add a pure shadow-evidence evaluator that parses bounded trial evidence from existing `CoworkerCapabilityNeed.evidenceJson` / `readinessJson`, computes agreement and improvement deltas, and calls the existing `recommendTrustChange` core. Extend the read model and coworker-record panel to surface that projection. Do not add a `WorkPattern`, `DecisionShadowLedger`, or `TrustState` table, and do not mutate skills, prompts, grants, model routes, Work Case state, or autonomy levels.

**Tech Stack:** Next.js 16 server components, TypeScript, Prisma 7, Vitest, existing TAK work-pattern read model, existing `apps/web/lib/autonomy/trust-graduation.ts`.

---

## Scope

This plan implements the safe first half of Slice 3 from `docs/superpowers/specs/2026-06-27-governed-adaptive-playbooks-design.md`.

Included:

- Pure parsing and evaluation of candidate shadow trials.
- Agreement-window calculation over candidate-vs-actual decisions.
- Improvement delta summaries for tool calls, failures, manual touches, context load, and review failures.
- Trust recommendation projection using the existing regulatory-ceiling-aware trust core.
- Read-model and AI Workforce UI projection.

Excluded:

- New persistence tables or migrations.
- Decision-Shadow Ledger writes.
- TrustState writes.
- Automatic promotion, activation, or demotion.
- Case-bound state changes or governed Action dispatch.
- Any Ornith/model-routing evaluation.

## Refactoring Budget

Reserve roughly 20 percent of effort for structure:

- Keep shadow evaluation in a small pure module instead of bloating `work-pattern-read-model.ts`.
- Keep UI changes inside `NeedsAndPlaybooksPanel.tsx`; verify module-size guard locally.
- Add parsing helpers with closed enum validation instead of ad hoc JSON casts.

## File Structure

Create:

- `apps/web/lib/tak/work-pattern-shadow-evaluation.ts` - pure shadow-trial parser and evaluator.
- `apps/web/lib/tak/work-pattern-shadow-evaluation.test.ts` - TDD coverage for parsing, agreement, deltas, trust recommendations, and no-activation guarantees.

Modify:

- `apps/web/lib/tak/work-pattern-read-model.ts` - collect shadow evidence from capability needs and attach `shadowEvaluation` to each `WorkPatternSummary`.
- `apps/web/lib/tak/work-pattern-read-model.test.ts` - verify shadow evidence links into the grouped read model.
- `apps/web/components/platform/coworker-record/NeedsAndPlaybooksPanel.tsx` - show a compact shadow/trust evidence row for patterns with shadow evidence.
- `apps/web/app/(shell)/platform/ai/agent/[agentId]/page.test.tsx` - include mocked shadow evidence and assert the operator-facing copy renders.
- `docs/superpowers/plans/2026-06-28-governed-adaptive-playbooks-shadow-trust.md` - keep this checklist current.

## Task 1: Pure Shadow Evidence Evaluator

- [x] **Step 1: Write the failing evaluator test**

Add tests for:

- `parseWorkPatternShadowTrials` accepts only bounded trial rows with valid risk/current-level fields.
- `evaluateWorkPatternShadowEvidence` computes samples, agreements, agreement rate, and improvement totals.
- High agreement over enough samples returns a trust recommendation from `recommendTrustChange`, but labels it as an evidence projection, not activation.
- Low agreement over enough samples returns a reject recommendation with evidence.
- Missing risk class returns blockers and no trust recommendation.

Run:

```powershell
corepack pnpm --filter web exec vitest run lib/tak/work-pattern-shadow-evaluation.test.ts
```

Expected: FAIL because the module does not exist.

- [x] **Step 2: Implement the minimal pure evaluator**

Implement:

- `WorkPatternShadowTrial`
- `WorkPatternShadowEvaluation`
- `parseWorkPatternShadowTrials(value: unknown): WorkPatternShadowTrial[]`
- `evaluateWorkPatternShadowEvidence(input): WorkPatternShadowEvaluation`

Use `recommendTrustChange`, `AutonomyLevel`, and `RiskClass` from `apps/web/lib/autonomy/trust-graduation.ts`. Do not import Prisma or mutate anything.

- [x] **Step 3: Verify evaluator test passes**

Run the same Vitest command. Expected: PASS.

## Task 2: Read Model Projection

- [x] **Step 1: Extend the failing read-model test**

Update `work-pattern-read-model.test.ts` so a linked capability need includes:

```ts
evidenceJson: {
  patternKey: "...",
  shadowTrials: [
    { trialId: "S-1", riskClass: "internal-reversible", candidateDecision: "file grant need", actualDecision: "file grant need", agreement: true, toolCallDelta: -2 },
  ],
  currentAutonomyLevel: "shadow",
}
```

Assert the grouped pattern has `shadowEvaluation.samples`, `agreementRate`, improvement deltas, and a non-activation recommendation.

Run:

```powershell
corepack pnpm --filter web exec vitest run lib/tak/work-pattern-read-model.test.ts
```

Expected: FAIL until the read model attaches shadow evidence.

- [x] **Step 2: Attach shadow evidence to summaries**

Extend the accumulator with parsed trials and optional current/regulatory levels from need JSON. Serialize a `shadowEvaluation` using the pure evaluator. If there is no shadow evidence, return `null`.

- [x] **Step 3: Verify read-model tests pass**

Run the same command. Expected: PASS.

## Task 3: Operator UI Projection

- [x] **Step 1: Extend the failing page test**

Update the mocked read model in `page.test.tsx` with a `shadowEvaluation` payload and assert the rendered markup includes:

- `Shadow evidence`
- an agreement percentage
- a non-activation recommendation such as `continue shadow` or `approve narrower scope`

Run:

```powershell
corepack pnpm --filter web exec vitest run -t "Needs & Playbooks"
```

Expected: FAIL until the panel renders the shadow row.

- [x] **Step 2: Render compact shadow evidence**

Update `NeedsAndPlaybooksPanel.tsx`:

- Add a small shadow row under each pattern that has `shadowEvaluation`.
- Show samples, agreement rate, trust action, and strongest delta.
- Use product language: `Shadow evidence`, `continue shadow`, `approve narrower scope`, `reject candidate`.
- Do not add activation buttons.

- [x] **Step 3: Verify page tests and module-size guard**

Run:

```powershell
corepack pnpm --filter web exec vitest run -t "Needs & Playbooks"
node scripts/check-module-size.mjs
```

Expected: PASS.

## Task 4: Gates, Evidence, And PR

- [x] **Step 1: Run focused tests**

```powershell
corepack pnpm --filter web exec vitest run lib/tak/work-pattern-shadow-evaluation.test.ts
corepack pnpm --filter web exec vitest run lib/tak/work-pattern-read-model.test.ts
corepack pnpm --filter web exec vitest run -t "AgentDetailPage"
```

- [x] **Step 2: Run relevant existing suites**

```powershell
corepack pnpm --filter web exec vitest run lib/tak/work-pattern-types.test.ts lib/tak/pattern-observer.test.ts lib/tak/pattern-observer-service.test.ts lib/tak/pattern-observer/observer.test.ts lib/autonomy/trust-graduation.test.ts
```

- [x] **Step 3: Run source gates**

```powershell
node scripts/check-module-size.mjs
corepack pnpm --filter web typecheck
corepack pnpm --filter web build
```

- [ ] **Step 4: Record evidence and publish**

Record results on Work Capsule `WC-7B6FF56A`, commit with DCO sign-off, push, open a ready PR, run `corepack pnpm pr:health <pr>`, and merge through the queue only after the PR is green.
