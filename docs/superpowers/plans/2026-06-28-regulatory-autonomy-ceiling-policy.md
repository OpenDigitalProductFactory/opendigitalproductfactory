# Regulatory Autonomy Ceiling Policy Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a versioned regulatory autonomy policy substrate and pure ceiling resolver for `BI-40CD8ACD`.

**Architecture:** Keep policy evaluation pure and data-driven. Prisma stores versioned policy rows and ledger evidence references; `apps/web/lib/autonomy/regulatory-ceiling.ts` resolves an effective ceiling from supplied policy rows plus install context, and callers pass that ceiling into the existing trust-graduation core.

**Tech Stack:** Prisma 7, TypeScript, Vitest, existing `@dpf/db/regulation-applicability` jurisdiction-basis model, existing autonomy trust core.

---

## Context

- Epic: `EP-8AF1C996`
- Backlog item: `BI-40CD8ACD`
- Work Capsule: `WC-454EDEC3`
- Design: `docs/superpowers/specs/2026-06-28-regulatory-autonomy-ceiling-policy-design.md`
- Existing core: `apps/web/lib/autonomy/trust-graduation.ts` already accepts a `regulatoryCeiling`.
- Previous slice: `BI-DE4BF92F` landed `DecisionShadowLedger`, `TrustState`, and pure trust-state aggregation in PR #2505.

## Refactoring Allocation

Reserve roughly 20 percent of effort for boundary cleanup: keep policy matching in one pure resolver, reuse `@dpf/db/regulation-applicability`, and avoid duplicating ceiling-source wording across Work Case callers.

## File Structure

- Create `apps/web/lib/autonomy/regulatory-ceiling.test.ts`
  - TDD coverage for default-safe behavior, jurisdiction/industry/activity matching, multiple policies, and evidence union.
- Create `apps/web/lib/autonomy/regulatory-ceiling.ts`
  - Pure resolver, types, evidence normalization, and restrictive ceiling reduction.
- Modify `apps/web/lib/work-management/autonomy-envelope.ts`
  - Distinguish regulatory caps from risk caps in the returned reason when `regulatoryCeiling` binds.
- Add/modify `apps/web/lib/work-management/autonomy-envelope.test.ts`
  - One focused regression for regulatory reason wording.
- Modify `packages/db/prisma/schema.prisma`
  - Add `RegulatoryAutonomyPolicy`.
  - Add optional `regulatoryPolicyId` and `regulatoryEvidence` to `DecisionShadowLedger`.
- Add migration `packages/db/prisma/migrations/20260628233000_regulatory_autonomy_policy/migration.sql`
  - Create table, indexes, unique `(policyKey, version)`, and ledger columns.
- Modify `apps/web/package.json` and add `apps/web/scripts/next-build.mjs`
  - Keep the canonical `pnpm --filter web build` gate stable by running the pinned Next build under an explicit Node heap ceiling.

## Task 1: Pure Regulatory Ceiling Resolver

**Files:**
- Create: `apps/web/lib/autonomy/regulatory-ceiling.test.ts`
- Create: `apps/web/lib/autonomy/regulatory-ceiling.ts`

- [x] **Step 1: Write failing default-safe test**

Test unknown policy state:

```ts
const result = resolveRegulatoryAutonomyCeiling({
  policies: [],
  profile: { operatesIn: ["eu"], sellsTo: [], employsIn: [], dataResidency: [] },
  industry: "healthcare-provider",
  activityClass: "patient-message.send",
});

expect(result.ceiling).toBe("propose");
expect(result.defaulted).toBe(true);
expect(result.humanControlRequired).toBe(true);
expect(result.requiredEvidence).toContain("operator-policy-review");
```

Run:
`pnpm --filter web exec vitest run lib/autonomy/regulatory-ceiling.test.ts`

Expected: fail because the module does not exist.

- [x] **Step 2: Implement minimal default resolver**

Add types and return the default-safe `propose` result when no policies match.

- [x] **Step 3: Verify green**

Run the same Vitest command.

- [x] **Step 4: Add matching and most-restrictive tests**

Add tests for:
- EU operating policy caps `patient-message.send` to `propose`.
- A global `autopilot` policy plus EU `propose` policy resolves to `propose`.
- Required evidence keys are deduplicated.
- EU policy does not match a US-only profile.
- A malformed `maxAutonomyLevel` string resolves safely to `propose` with operator-review evidence.

- [x] **Step 5: Implement full resolver**

Filter active/effective policies, match industry/activity, call `regulationApplies`, sort/reduce to the most restrictive ceiling, and return matched policy metadata.

## Task 2: Work Case Cap Reason

**Files:**
- Modify: `apps/web/lib/work-management/autonomy-envelope.test.ts`
- Modify: `apps/web/lib/work-management/autonomy-envelope.ts`

- [x] **Step 1: Write failing reason test**

Add a test where trust is `autopilot`, risk is `read-only`, and `regulatoryCeiling` is `supervised`; expect the reason to mention regulatory policy.

- [x] **Step 2: Implement cap-source wording**

Keep existing behavior, but when the regulatory ceiling is more restrictive than the risk ceiling, return `trust autopilot capped to supervised by regulatory policy`.

- [x] **Step 3: Verify focused tests**

Run:
`pnpm --filter web exec vitest run lib/work-management/autonomy-envelope.test.ts lib/autonomy/regulatory-ceiling.test.ts`

## Task 3: Prisma Policy Substrate

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Add: `packages/db/prisma/migrations/20260628233000_regulatory_autonomy_policy/migration.sql`

- [x] **Step 1: Add schema models**

Add `RegulatoryAutonomyPolicy` near compliance/runtime governance and add regulatory evidence fields to `DecisionShadowLedger`.

- [x] **Step 2: Add migration**

Create table/indexes and alter `DecisionShadowLedger`.

- [x] **Step 3: Generate and validate Prisma**

Run:
`pnpm --filter @dpf/db exec prisma validate`
`pnpm --filter @dpf/db exec prisma generate`

## Task 4: Verification

**Files:**
- All changed files.

- [x] **Step 1: Focused tests**

Run:
`pnpm --filter web exec vitest run lib/autonomy/regulatory-ceiling.test.ts lib/autonomy/trust-graduation.test.ts lib/autonomy/trust-state.test.ts lib/work-management/autonomy-envelope.test.ts`

- [x] **Step 2: DB typecheck**

Run:
`pnpm --filter @dpf/db typecheck`

- [x] **Step 3: Web typecheck**

Run:
`pnpm --filter web typecheck`

- [x] **Step 4: Production build**

Run:
`pnpm --filter web build`

The first canonical build attempt failed with V8 heap exhaustion during Next build-time TypeScript. The package build runner now invokes the pinned Next binary with `--max-old-space-size=8192`, and the same canonical command exits 0.

- [x] **Step 5: Migration apply check**

Under a `local-integration-ci` lease, apply the full migration chain to a throwaway database and confirm `RegulatoryAutonomyPolicy`, `DecisionShadowLedger.regulatoryPolicyId`, and `DecisionShadowLedger.regulatoryEvidence` exist.

- [x] **Step 6: Record evidence**

Record evidence on `BI-40CD8ACD` and `WC-454EDEC3`.

## Non-Goals

- No policy-management UI.
- No seed data for real regulations.
- No runtime policy fetching inside TAK, WWMD, or Work Case routes.
- No automatic autonomy level mutation.
