# Regulatory Autonomy Runtime Consumer Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `RegulatoryAutonomyPolicy` into runtime autonomy evaluation so Work Case / TAK shadow evidence uses the policy ceiling and persists resolver evidence to `DecisionShadowLedger` and `TrustState`.

**Architecture:** Keep policy matching pure and reuse `resolveRegulatoryAutonomyCeiling`, `computeTrustStateFromLedger`, and `resolveWorkCaseAutonomyEnvelope`. Add one injectable runtime adapter that loads install context and policy rows, records bounded shadow ledger evidence, and refreshes the measured trust read model without promoting live autonomy. Wire the adapter into Living Playbook review because that is the first TAK/Work Case runtime consumer already carrying shadow trials and decision interactions.

**Tech Stack:** Next.js server actions, Prisma 7, TypeScript, Vitest, existing autonomy and Work Case modules.

---

## File Structure

- Create `apps/web/lib/autonomy/regulatory-autonomy-runtime.ts`
  - Loads install region/archetype context.
  - Loads active `RegulatoryAutonomyPolicy` rows.
  - Resolves the effective ceiling for an activity class.
  - Records shadow trial rows in `DecisionShadowLedger`.
  - Recomputes and upserts `TrustState` for the `(agentId, activityType, riskClass)` triple.
- Create `apps/web/lib/autonomy/regulatory-autonomy-runtime.test.ts`
  - Tests default-safe policy resolution from DB context.
  - Tests ledger rows carry `regulatoryPolicyId` and `regulatoryEvidence`.
  - Tests `TrustState` is refreshed from ledger evidence while `currentLevel` remains caller-provided.
- Modify `apps/web/lib/actions/work-pattern-review.ts`
  - Call the runtime adapter during Living Playbook review after the `DecisionInteraction` exists.
  - Prefer DB-resolved regulatory ceiling over stale evidence JSON when evaluating shadow evidence.
  - Keep no live Work Case, skill, prompt, grant, or backlog mutation.
- Modify `apps/web/lib/actions/work-pattern-review.test.ts`
  - Assert policy rows are loaded, shadow ledger rows are created, and trust state is upserted.
  - Keep assertions that live Work Case and prompt/skill/grant surfaces are not mutated.

## Task 1: Runtime Adapter

**Files:**
- Create: `apps/web/lib/autonomy/regulatory-autonomy-runtime.test.ts`
- Create: `apps/web/lib/autonomy/regulatory-autonomy-runtime.ts`

- [x] **Step 1: Write failing DB-context policy test**

Assert `resolveRuntimeRegulatoryAutonomyCeiling` reads `BusinessContext` regional fields, `StorefrontConfig.archetype.category`, and active policy rows, then returns a restrictive policy match.

Run: `pnpm --filter web exec vitest run lib/autonomy/regulatory-autonomy-runtime.test.ts`

Expected: fail because the module does not exist.

- [x] **Step 2: Implement minimal context and policy loader**

Create typed DB interfaces and the runtime resolver that delegates final matching to `resolveRegulatoryAutonomyCeiling`.

- [x] **Step 3: Write failing ledger/trust refresh test**

Assert `recordRegulatoryDecisionShadowEvidence` creates one ledger row per shadow trial with regulatory evidence and upserts `TrustState` from computed agreement state.

- [x] **Step 4: Implement minimal ledger writer and trust updater**

Use deterministic `ledgerId` values based on decision interaction, trial id, and index so retries skip duplicates. Do not mutate live autonomy; `TrustState.currentLevel` remains the evaluated level supplied by the caller.

## Task 2: Work Pattern Review Wiring

**Files:**
- Modify: `apps/web/lib/actions/work-pattern-review.test.ts`
- Modify: `apps/web/lib/actions/work-pattern-review.ts`

- [x] **Step 1: Write failing server-action test**

Mock `businessContext`, `storefrontConfig`, `regulatoryAutonomyPolicy`, `decisionShadowLedger`, and `trustState`. Approving a candidate with shadow trials should create ledger rows and upsert measured trust using the DB-resolved ceiling.

Run: `pnpm --filter web exec vitest run lib/actions/work-pattern-review.test.ts`

Expected: fail because no runtime adapter is invoked.

- [x] **Step 2: Wire the runtime adapter into `recordWorkPatternReview`**

Resolve policy before `buildWorkPatternReview`, pass the resolved ceiling into `evaluateWorkPatternShadowEvidence`, then record ledger/trust evidence inside the existing transaction after `DecisionInteraction` creation.

- [x] **Step 3: Refactor local helper boundaries**

Keep action code readable by extracting small helpers for activity class selection, ceiling selection, and runtime-evidence input construction. Do not refactor unrelated Work Case review behavior.

## Task 3: Verification

**Files:**
- All changed files.

- [x] **Step 1: Focused autonomy tests**

Run: `pnpm --filter web exec vitest run lib/autonomy/regulatory-autonomy-runtime.test.ts lib/autonomy/regulatory-ceiling.test.ts lib/autonomy/trust-state.test.ts lib/autonomy/trust-graduation.test.ts`

- [x] **Step 2: Focused action tests**

Run: `pnpm --filter web exec vitest run lib/actions/work-pattern-review.test.ts lib/tak/work-pattern-shadow-evaluation.test.ts lib/work-management/autonomy-envelope.test.ts`

- [x] **Step 3: Source-local typecheck**

Run: `pnpm --filter web typecheck`

- [x] **Step 4: Build gate**

Run: `pnpm --filter web build`

- [x] **Step 5: Record capsule evidence**

Record test/build evidence on `WC-E6869BA0`. Runtime-bound live install verification remains a later self-upgrade/browser step after the branch lands.

## Non-Goals

- No regulatory policy management UI.
- No seeded real regulatory content.
- No external policy engine.
- No live autonomy promotion, skill/prompt/grant mutation, Work Case mutation, or backlog mutation.
