# Decision Shadow Ledger TrustState Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the measured-trust substrate for `BI-DE4BF92F`: persistent `DecisionShadowLedger` rows and per-`coworker x activity x risk` `TrustState`, plus pure agreement/recommendation helpers.

**Architecture:** Keep the first substrate narrow and non-acting. The Prisma models store evidence and aggregate trust state, while `apps/web/lib/autonomy/trust-state.ts` computes agreement windows and calls the existing `recommendTrustChange` core. No UI, prompt, skill, grant, model-route, Work Case, or autonomy-level mutation is introduced in this slice.

**Tech Stack:** Prisma 7 schema/migration, TypeScript, Vitest, existing `apps/web/lib/autonomy/trust-graduation.ts`.

---

## Context

- Epic: `EP-8AF1C996`
- Backlog item: `BI-DE4BF92F`
- Work Capsule: `WC-92CE0102`
- Design source: `docs/superpowers/plans/2026-06-26-progressive-autonomy-trust-graduation-design.md`
- Related spec: `docs/superpowers/specs/2026-06-27-governed-adaptive-playbooks-design.md`
- Already landed: pure trust recommendation core, regulatory ceiling core, shadow projection/read model, playbook review, Work Case staging, and proposal resolution.

## File Structure

- Modify `packages/db/prisma/schema.prisma`
  - Add `DecisionShadowLedger` and `TrustState` models near the task governance runtime area.
  - Use semantic string IDs for agent/activity/risk references and optional source IDs, matching `ToolExecution.agentId` and `TaskRun.taskRunId` conventions.
- Add `packages/db/prisma/migrations/20260628230000_decision_shadow_ledger_trust_state/migration.sql`
  - Create both tables, unique keys, and query indexes.
- Add `apps/web/lib/autonomy/trust-state.ts`
  - Pure types and helpers for ledger rows, trust triples, aggregate agreement windows, and recommendations.
- Add `apps/web/lib/autonomy/trust-state.test.ts`
  - TDD coverage for aggregate state, ignored unresolved rows, regulatory ceiling propagation, and no-action recommendations.
- Modify this plan as tasks complete.

## Refactoring Allocation

Reserve roughly 20 percent of effort for boundary cleanup: keep the agreement-window logic in a reusable pure helper instead of duplicating it inside future TAK or Work Case writers. Do not refactor unrelated autonomy, Work Case, or AI Workforce UI files.

## Task 1: Pure TrustState Helper

**Files:**
- Create: `apps/web/lib/autonomy/trust-state.test.ts`
- Create: `apps/web/lib/autonomy/trust-state.ts`

- [x] **Step 1: Write failing aggregate test**

Test that two reconciled ledger rows for one triple produce `samples=2`, `agreements=1`, `agreementRate=0.5`, and a demotion/hold recommendation from `recommendTrustChange`.

Run:
`pnpm --filter web exec vitest run lib/autonomy/trust-state.test.ts`

Expected: fails because `trust-state.ts` does not exist.

- [x] **Step 2: Implement minimal aggregate helper**

Add `computeTrustStateFromLedger(input)` using resolved rows where `agreement !== null`, defaulting current level to `shadow`.

- [x] **Step 3: Verify green**

Run the same Vitest command.

- [x] **Step 4: Add regulatory ceiling test**

Assert a `regulatoryCeiling: "propose"` on a read-only activity is passed into the recommendation and caps promotion.

- [x] **Step 5: Implement minimal ceiling support**

Thread `regulatoryCeiling` through to `recommendTrustChange`.

## Task 2: Prisma Models and Migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Add: `packages/db/prisma/migrations/20260628230000_decision_shadow_ledger_trust_state/migration.sql`

- [x] **Step 1: Add schema/migration structural test by inspection**

Before editing production schema, decide exact fields and indexes from the plan:
`DecisionShadowLedger`: `ledgerId`, `agentId`, `activityType`, `riskClass`, `autonomyLevel`, proposed/actual/outcome JSON, `agreement`, optional source IDs, metadata, observed/reconciled timestamps.
`TrustState`: unique `(agentId, activityType, riskClass)`, current level, regulatory ceiling, sample/agreement counts, rate, last ledger ID, recommendation JSON, evaluation timestamp.

- [x] **Step 2: Add Prisma models and SQL migration**

Use text columns plus application-level string unions from `trust-graduation.ts`; do not add DB enums in this slice.

- [x] **Step 3: Generate Prisma client**

Run:
`pnpm --filter @dpf/db exec prisma generate`

Expected: succeeds with generated client update.

## Task 3: Verification

**Files:**
- All changed files from Tasks 1-2.

- [x] **Step 1: Focused tests**

Run:
`pnpm --filter web exec vitest run lib/autonomy/trust-state.test.ts lib/autonomy/trust-graduation.test.ts lib/tak/work-pattern-shadow-evaluation.test.ts`

- [x] **Step 2: DB typecheck**

Run:
`pnpm --filter @dpf/db typecheck`

- [x] **Step 3: Web typecheck**

Run:
`pnpm --filter web typecheck`

- [x] **Step 4: Production build**

Run:
`pnpm --filter web build`

- [x] **Step 5: Migration apply check**

Run `prisma migrate deploy` against throwaway database `dpf_codex_decision_shadow_20260628` inside the lease-scoped local Postgres container using this branch's copied schema/migration chain. Confirm `DecisionShadowLedger` and `TrustState` exist, then drop the throwaway database.

- [x] **Step 6: Record evidence**

Attach focused test/typecheck/build evidence to `BI-DE4BF92F` and `WC-92CE0102` before PR.

## Non-Goals

- Do not wire automatic writes from TAK, Work Case, WWMD, skills, prompts, or model routing yet.
- Do not add a UI surface.
- Do not auto-promote or demote live autonomy.
- Do not implement the regulatory policy library; this slice only stores an optional regulatory ceiling on the trust triple.
