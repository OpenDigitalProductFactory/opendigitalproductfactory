# Inspectable and watched business analysis — implementation plan

- **Backlog:** `BI-36358ACF`
- **Work capsule:** `WC-6D044755`
- **Design:** [Inspectable and watched business analysis](../specs/2026-08-12-inspectable-watched-business-analysis-design.md)
- **Branch:** `feat/watched-analysis-ui`

## Delivery phases

### 1. Canonical contracts and shared organization boundary

- Start with failing tests for typed materiality capabilities and the versioned watched-plan parser/evaluator.
- Extract current-organization resolution from the Performance provider into one reusable module; preserve exact single-org compatibility and multi-org refusal behavior.
- Add `organizationId` to the ready server read model so deterministic execution can verify task scope without a second identity query.
- Refactor budget: this shared identity seam plus pure watch evaluation is the reserved consolidation work; no parallel page-local helper.

### 2. Governed schedule and deterministic run evidence

- Add `business-analysis-watch` to the closed scheduled-task kind tuple.
- Validate organization scope and structured config before task creation.
- Add an authenticated server action that revalidates plan/fingerprint, resolves the current organization, captures a fresh baseline, and schedules one typed task.
- Add a deterministic scheduler branch that evaluates the watch, records fingerprint/freshness in `TaskRun.progressPayload`, updates the typed task config, and advances the baseline only on material change.
- Bound the owner/org watch query to 20 recent tasks.

### 3. Owner-first Performance interaction

- Test-drive a `BusinessAnalysisWorkspace` component with accepted, clarification, refusal, stale-source, saved, existing-watch, and material-change states.
- Place one compact disclosure after the owner brief and before trends.
- Reuse report-kit notices/status badges and existing form tokens; add no route or global/section navigation.
- Keep the empty Performance state unchanged except for an honest explanation that questions require a computed snapshot.

### 4. Verification and delivery

- Run targeted package/web tests, typecheck, production build, theme scan, and UX budget checks.
- Capture a measured UX-fit manifest covering the exact UI files.
- Freeze a DCO-signed commit and obtain fresh exact high-assurance semantic review.
- Run exactly one governed `pnpm run pregate`, then open a ready non-draft PR, pass `pr:health`, and enter the protected merge queue.
- Advance only through normal `/ops/self-upgrade`, preflight `CAN-TEST`, and authenticated live `/performance` acceptance.

## Test map

| Contract | Primary test |
| --- | --- |
| Materiality axes and metric capability | `packages/storefront-templates/src/performance-metric-catalog.test.ts` |
| Watch parse, fingerprint, freshness, material change | `apps/web/lib/performance/business-analysis-watch.test.ts` |
| Current-org isolation and legacy refusal | `apps/web/lib/performance/performance-organization-context.test.ts` plus existing provider tests |
| Schedule scope/config validation | `apps/web/lib/operate/scheduled-jobs/agent-task-core.test.ts` |
| Authenticated creation | `apps/web/lib/actions/business-analysis-watch.test.ts` |
| Deterministic scheduled execution evidence | focused scheduler test |
| Inspectable preview and watched-result UX | `apps/web/components/performance/BusinessAnalysisWorkspace.test.tsx` |
| Route composition and honest empty state | `apps/web/app/(shell)/performance/page.test.tsx` |

## Out of scope

- New analytics or watch tables.
- Natural-language-to-SQL or unbounded free-form metric inference.
- Multi-metric formulas, target/prior-year execution not present in the current read model, or cross-organization watch administration.
- The separate populated live-acceptance fixture tracked by `BI-721DE20F`.
- The Windows managed-worktree readiness defect tracked by `BI-BDD167E9`.
