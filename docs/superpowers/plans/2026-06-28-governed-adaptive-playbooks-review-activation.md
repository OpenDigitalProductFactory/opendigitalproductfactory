# Governed Adaptive Playbooks Review Activation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first integrated operator review loop for Living Playbook candidates: approve, reject, or defer shadow-backed proposals while recording governed evidence and never mutating live autonomy or Work Case state.

**Architecture:** Keep the feature migration-free. A pure TAK review module owns action validation, activation-candidate shaping, risk ceiling checks, and readiness JSON merges; a thin server action writes `DecisionInteraction` plus `CoworkerCapabilityNeed` updates. The existing coworker record Needs & Playbooks panel becomes the compact operator surface, and the read model projects review state from existing JSON so rejected/deferred candidates remain visible without adding a `WorkPattern` table.

**Tech Stack:** Next.js 16 server actions, Prisma 7 via `@dpf/db`, Vitest, React server rendering tests, existing `DecisionInteraction`, `CoworkerCapabilityNeed`, and TAK work-pattern read models.

---

## Chunk 1: Review Semantics

### Task 1: Pure Work Pattern Review Model

**Files:**
- Create: `apps/web/lib/tak/work-pattern-review.ts`
- Create: `apps/web/lib/tak/work-pattern-review.test.ts`
- Reference: `apps/web/lib/tak/work-pattern-shadow-evaluation.ts`
- Reference: `apps/web/lib/tak/work-pattern-types.ts`

- [x] **Step 1: Write failing review model tests**

Add tests for these behaviors:

```ts
import { describe, expect, it } from "vitest";
import {
  buildWorkPatternReview,
  mergeWorkPatternReviewState,
  parseWorkPatternReviewState,
} from "./work-pattern-review";

describe("work-pattern-review", () => {
  it("creates a scoped activation candidate for an approved promotable shadow pattern", () => {
    const reviewedAt = new Date("2026-06-28T12:00:00.000Z");
    const review = buildWorkPatternReview({
      action: "approve",
      needId: "NEED-1",
      agentId: "build-specialist",
      patternKey: "grant-denial|build-specialist|/build",
      routeContext: "/build",
      riskClass: "internal-reversible",
      decisionScope: "platform-wwmd",
      candidate: {
        kind: "grant",
        need: "Missing sandbox lease grant",
        blocks: "Repeated grant denials block verification.",
        fingerprint: "fp-grant",
      },
      shadowEvaluation: {
        samples: 20,
        agreements: 19,
        agreementRate: 0.95,
        riskClass: "internal-reversible",
        currentLevel: "shadow",
        trustRecommendation: { action: "promote", from: "shadow", to: "propose", reason: "enough agreement" },
        decision: "approve-narrower-scope",
        activationAllowed: false,
        improvementTotals: { toolCallDelta: -3, failureDelta: -1, manualTouchDelta: 0, contextTokenDelta: -100, reviewFailureDelta: 0 },
        blockers: [],
      },
      decisionInteractionId: "DI-1",
      reviewerUserId: "user-1",
      reviewedAt,
    });

    expect(review.activationCandidate).toMatchObject({
      state: "candidate",
      activationAllowed: false,
      patternKey: "grant-denial|build-specialist|/build",
      routeContext: "/build",
      proposedAutonomyLevel: "propose",
    });
    expect(review.blockers).toContain("activation-candidate-awaits-governed-promotion");
  });

  it("blocks approval when the shadow decision is not promotable", () => {
    expect(() => buildWorkPatternReview({
      action: "approve",
      needId: "NEED-1",
      agentId: "build-specialist",
      patternKey: "grant-denial|build-specialist|/build",
      routeContext: "/build",
      riskClass: "internal-reversible",
      decisionScope: "platform-wwmd",
      candidate: null,
      shadowEvaluation: null,
      decisionInteractionId: "DI-1",
      reviewerUserId: "user-1",
      reviewedAt: new Date("2026-06-28T12:00:00.000Z"),
    })).toThrow("approval_requires_promotable_shadow_evidence");
  });

  it("preserves rejected and deferred review state in readiness JSON", () => {
    const review = buildWorkPatternReview({
      action: "reject",
      needId: "NEED-1",
      agentId: "build-specialist",
      patternKey: "grant-denial|build-specialist|/build",
      routeContext: "/build",
      riskClass: "internal-reversible",
      decisionScope: "platform-wwmd",
      candidate: null,
      shadowEvaluation: null,
      decisionInteractionId: "DI-1",
      reviewerUserId: "user-1",
      reviewedAt: new Date("2026-06-28T12:00:00.000Z"),
    });
    const merged = mergeWorkPatternReviewState({ readyForReview: true }, review);

    expect(parseWorkPatternReviewState(merged)).toMatchObject({
      action: "reject",
      decisionInteractionId: "DI-1",
      status: "rejected",
    });
  });
});
```

Run: `pnpm --filter web exec vitest run apps/web/lib/tak/work-pattern-review.test.ts`

Expected: FAIL because `work-pattern-review.ts` does not exist.

- [x] **Step 2: Implement the pure module**

Create `apps/web/lib/tak/work-pattern-review.ts` with:

- `WorkPatternReviewAction = "approve" | "reject" | "defer"`
- `WorkPatternReviewStatus = "approved-candidate" | "rejected" | "deferred"`
- `WorkPatternActivationCandidate` carrying `activationAllowed: false`, pattern key, agent, route, decision scope, risk class, current/proposed autonomy level, evidence summary, and blockers
- `WorkPatternReviewState` carrying action, status, reviewer, timestamp, note, `decisionInteractionId`, blockers, and optional activation candidate
- `buildWorkPatternReview(input)` that allows approval only when shadow evaluation says `approve-narrower-scope` and trust recommendation action is `promote`
- `mergeWorkPatternReviewState(readinessJson, review)` that preserves existing readiness fields while adding `workPatternReview` and top-level `activationProposed`
- `parseWorkPatternReviewState(value)` that tolerates missing/old JSON and returns `null` for malformed state
- `workPatternReviewStatusForAction(action)` and `capabilityNeedStatusForReviewAction(action)` helpers, mapping approve to `accepted`, reject to `discarded`, and defer to `deferred`

Keep the module pure: no Prisma, no server-action imports, no React.

- [x] **Step 3: Run the review model test**

Run: `pnpm --filter web exec vitest run apps/web/lib/tak/work-pattern-review.test.ts`

Expected: PASS.

---

## Chunk 2: Governed Write Path

### Task 2: Server Action Writes Decision Evidence and Need State

**Files:**
- Create: `apps/web/lib/actions/work-pattern-review.ts`
- Create: `apps/web/lib/actions/work-pattern-review.test.ts`
- Reference: `apps/web/lib/actions/shared/guards.ts`
- Reference: `apps/web/lib/decision-perspective/default-profile.ts`
- Reference: `apps/web/lib/decision-perspective/persistence.ts`

- [x] **Step 1: Write failing action tests**

Add tests that mock `@dpf/db`, `next/cache`, and the shared guard:

```ts
it("records approval as a DecisionInteraction and scoped activation candidate", async () => {
  const form = new FormData();
  form.set("needId", "NEED-1");
  form.set("agentId", "build-specialist");
  form.set("action", "approve");
  form.set("note", "Approve only for sandbox lease filing.");

  await expect(reviewWorkPatternAction(form)).resolves.toMatchObject({
    status: "recorded",
    action: "approve",
  });

  expect(mockPrisma.decisionInteraction.create).toHaveBeenCalledWith({
    data: expect.objectContaining({
      domainClass: "risk-assessment",
      routeContext: "/platform/ai/agent/build-specialist",
      outcomeType: "recommend",
      humanOutcome: expect.objectContaining({
        type: "work-pattern-review",
        action: "approve",
        clearsGate: false,
      }),
    }),
  });
  expect(mockPrisma.coworkerCapabilityNeed.update).toHaveBeenCalledWith({
    where: { needId: "NEED-1" },
    data: expect.objectContaining({
      status: "accepted",
      reviewerNote: "Approve only for sandbox lease filing.",
    }),
  });
});
```

Also cover:
- Reject records `status: "discarded"` and leaves no activation candidate.
- Defer records `status: "deferred"` and `outcomeType: "defer"`.
- Approval fails before writing when shadow evidence is not promotable.
- Unauthorized users fail through `requireCapability("manage_platform")`.

Run: `pnpm --filter web exec vitest run apps/web/lib/actions/work-pattern-review.test.ts`

Expected: FAIL because action does not exist.

- [x] **Step 2: Implement the server action**

Create `apps/web/lib/actions/work-pattern-review.ts` with `"use server"` and:

- `reviewWorkPatternAction(formData: FormData)`
- `recordWorkPatternReview(input, deps?)` for testable internals
- `requireCapability("manage_platform")`
- load `CoworkerCapabilityNeed` by `needId`, including `assessment.routeContext`
- extract `patternKey`, `decisionScope`, `riskClass`, `shadowTrials`, `currentAutonomyLevel`, and `regulatoryCeiling` from existing evidence/readiness JSON
- evaluate shadow evidence with `evaluateWorkPatternShadowEvidence`
- build the review with `buildWorkPatternReview`
- create a `DecisionInteraction` directly with `createDecisionInteractionId()` and `MARK_DPF_PLATFORM_PROFILE`
- use `domainClass: "risk-assessment"`
- map risk class to decision risk tier:
  - `read-only` -> `low`
  - `internal-reversible` -> `medium`
  - `internal-irreversible` -> `high`
  - `outbound-or-floor` -> `critical`
  - missing -> `medium`
- set `humanOutcome.type = "work-pattern-review"` for every action so reject/defer records never appear as unresolved AI decisions
- update `CoworkerCapabilityNeed` readiness/evidence JSON with the review state and `decisionInteractionId`
- call `revalidatePath("/platform/ai/agent/<agentId>")`

Do not update TrustState, Work Case rows, SkillDefinition, PromptTemplate, or backlog rows.

- [x] **Step 3: Run the action test**

Run: `pnpm --filter web exec vitest run apps/web/lib/actions/work-pattern-review.test.ts`

Expected: PASS.

---

## Chunk 3: Read Model Projection

### Task 3: Project Review State into Living Playbooks

**Files:**
- Modify: `apps/web/lib/tak/work-pattern-read-model.ts`
- Modify: `apps/web/lib/tak/work-pattern-read-model.test.ts`
- Reference: `apps/web/lib/tak/work-pattern-review.ts`

- [x] **Step 1: Write failing read-model expectations**

Extend the existing `getWorkPatternReadModel` test fixture so `NEED-1.readinessJson` contains:

```ts
workPatternReview: {
  action: "approve",
  status: "approved-candidate",
  decisionInteractionId: "DI-REVIEW",
  reviewedAt: "2026-06-28T11:00:00.000Z",
  reviewerUserId: "user-1",
  blockers: ["activation-candidate-awaits-governed-promotion"],
  activationCandidate: {
    state: "candidate",
    activationAllowed: false,
    patternKey: "grant-denial|build-specialist|/build",
    proposedAutonomyLevel: "propose",
  },
}
```

Assert:

```ts
expect(observed?.reviewState).toMatchObject({
  action: "approve",
  decisionInteractionId: "DI-REVIEW",
});
expect(observed?.activationCandidate).toMatchObject({
  activationAllowed: false,
  proposedAutonomyLevel: "propose",
});
expect(observed?.activationProposed).toBe(true);
expect(observed?.evidenceRefs).toEqual(
  expect.arrayContaining([expect.objectContaining({ decisionInteractionId: "DI-REVIEW" })]),
);
```

Run: `pnpm --filter web exec vitest run apps/web/lib/tak/work-pattern-read-model.test.ts`

Expected: FAIL because `reviewState` and `activationCandidate` are not projected.

- [x] **Step 2: Implement read-model projection**

Modify `WorkPatternSummary` and `SummaryAccumulator` to include:

- `reviewState: WorkPatternReviewState | null`
- `activationCandidate: WorkPatternActivationCandidate | null`

In `attachNeed()`:

- parse `row.readinessJson.workPatternReview`
- keep the newest `reviewedAt` review when multiple linked needs exist
- set `activationProposed` true only when the parsed review carries an activation candidate
- add `decisionInteractionId` from the review to evidence refs even if `evidenceJson` is old

- [x] **Step 3: Run the read-model test**

Run: `pnpm --filter web exec vitest run apps/web/lib/tak/work-pattern-read-model.test.ts`

Expected: PASS.

---

## Chunk 4: Operator UI

### Task 4: Add Review Controls to Needs & Playbooks

**Files:**
- Modify: `apps/web/components/platform/coworker-record/NeedsAndPlaybooksPanel.tsx`
- Modify: `apps/web/app/(shell)/platform/ai/agent/[agentId]/page.tsx`
- Modify: `apps/web/app/(shell)/platform/ai/agent/[agentId]/page.test.tsx`
- Reference: `apps/web/lib/actions/work-pattern-review.ts`

- [x] **Step 1: Write failing page rendering test**

Extend the mocked work pattern in `page.test.tsx` with `reviewState: null` and `activationCandidate: null`, then assert the rendered page includes:

```ts
expect(html).toContain("Approve candidate");
expect(html).toContain("Defer");
expect(html).toContain("Reject");
expect(html).not.toContain("Activate playbook");
```

Add a second pattern fixture with `reviewState.action = "approve"` and assert:

```ts
expect(html).toContain("Decision recorded");
expect(html).toContain("activation candidate");
```

Run: `pnpm --filter web exec vitest run 'apps/web/app/(shell)/platform/ai/agent/[agentId]/page.test.tsx'`

Expected: FAIL because the UI does not render review controls/state yet.

- [x] **Step 2: Implement UI changes**

Update the panel:

- `NeedsAndPlaybooksPanel` accepts `canWrite: boolean`
- `PlaybookRow` passes `canWrite`
- When a pattern has shadow evidence, a linked need, and no review state, render a compact form row:
  - hidden `needId`
  - hidden `agentId`
  - hidden `action`
  - hidden `note` with action-specific default text
  - buttons: `Approve candidate`, `Defer`, `Reject`
- Approval button appears only when `shadowEvaluation.decision === "approve-narrower-scope"`
- Use existing `Chip`, `Section`, `LocalTime`, and CSS variables; no new color literals
- Use small dense forms and buttons within the existing row, not a new route, modal, or nested card
- If `canWrite` is false, render review state only
- Render recorded state as `Decision recorded`, action label, `DI-*`, and `activation candidate` when present
- Never render copy implying live activation happened

Update `page.tsx` to pass `canWrite={canWrite}`.

- [x] **Step 3: Run the page rendering test**

Run: `pnpm --filter web exec vitest run 'apps/web/app/(shell)/platform/ai/agent/[agentId]/page.test.tsx'`

Expected: PASS.

---

## Chunk 5: Verification, Refactor, and Handoff

### Task 5: Focused Refactor and Verification

**Files:**
- Review all changed files
- Update this plan checkboxes as work completes

- [x] **Step 1: Refactor after green**

Spend the explicit refactor budget on:

- keeping review parsing/building pure and isolated in `work-pattern-review.ts`
- removing duplicated JSON parsing helpers between the server action and read model where practical without widening scope
- making UI action rendering small enough that `NeedsAndPlaybooksPanel.tsx` remains readable

- [x] **Step 2: Run focused tests**

Run:

```powershell
pnpm --filter web exec vitest run `
  apps/web/lib/tak/work-pattern-review.test.ts `
  apps/web/lib/actions/work-pattern-review.test.ts `
  apps/web/lib/tak/work-pattern-read-model.test.ts `
  'apps/web/app/(shell)/platform/ai/agent/[agentId]/page.test.tsx'
```

Expected: PASS.

- [x] **Step 3: Run source-local typecheck/build gates available in this worktree**

Run:

```powershell
pnpm --filter web typecheck
pnpm --filter web build
```

Expected: PASS, unless the worktree remains `source-only`; if the bootstrap/runtime limitation blocks local execution, record the exact blocker and rely on GitHub CI after push.

- [x] **Step 4: Record capsule evidence**

Use `record_capsule_evidence` for:

- plan written
- focused tests
- typecheck/build or blocked local gate explanation
- PR URL and CI summary once available

- [ ] **Step 5: Commit, push, create ready PR, and fix CI**

Commands:

```powershell
git status --short --branch
git add docs/superpowers/plans/2026-06-28-governed-adaptive-playbooks-review-activation.md apps/web/lib/tak/work-pattern-review.ts apps/web/lib/tak/work-pattern-review.test.ts apps/web/lib/actions/work-pattern-review.ts apps/web/lib/actions/work-pattern-review.test.ts apps/web/lib/tak/work-pattern-read-model.ts apps/web/lib/tak/work-pattern-read-model.test.ts apps/web/components/platform/coworker-record/NeedsAndPlaybooksPanel.tsx 'apps/web/app/(shell)/platform/ai/agent/[agentId]/page.tsx' 'apps/web/app/(shell)/platform/ai/agent/[agentId]/page.test.tsx'
git commit -s -m "feat: add governed playbook review activation"
git push -u origin feat/governed-adaptive-playbooks-review-activation
gh pr create --base main --head feat/governed-adaptive-playbooks-review-activation --title "Add governed playbook review activation" --body-file <prepared-body>
corepack pnpm pr:health <pr-number>
```

Expected: PR opens ready for review, CI passes or failures are investigated and fixed in this branch.

### Completion Notes

- No migration is planned.
- No live autonomy, TrustState, Work Case, SkillDefinition, PromptTemplate, or backlog mutation is allowed in this slice.
- Operator/user testing is intentionally deferred until all integrated slices are complete, per Mark's direction. Internal source-local tests, build gates, and GitHub CI remain required.
