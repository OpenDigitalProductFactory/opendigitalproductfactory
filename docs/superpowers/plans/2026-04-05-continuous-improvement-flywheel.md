# Continuous Improvement Flywheel Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a portfolio-aware continuous improvement flywheel that turns observed platform/product friction into graph-aware, company-objective-ranked backlog proposals and Build Studio execution candidates.

**Architecture:** Add a thin orchestration layer over existing improvement, backlog, portfolio-quality, and Build Studio systems. Normalize raw evidence into a new `ImprovementSignal` model, evaluate it daily into governed proposals, materialize approved opportunities into the common backlog with `proposed` status, and generate execution candidate briefs for Build Studio when improvements are implementation-ready.

**Tech Stack:** Prisma/PostgreSQL, Next.js App Router, server actions, React server/client components, Neo4j-backed dependency context, Vitest, Next production build

---

## File Structure

### New Files

- `packages/db/prisma/migrations/<timestamp>_continuous_improvement_flywheel/migration.sql`
  - Schema and data backfill for `ImprovementSignal`, `ImprovementEvaluationRun`, `ImprovementExecutionCandidate`, `BacklogItem.status = proposed`, and direct `portfolioId`/origin fields on `BacklogItem`
- `apps/web/lib/improve/improvement-signal.ts`
  - Signal normalization types, builders, and dedup helpers
- `apps/web/lib/improve/improvement-evaluator.ts`
  - Daily ranking logic, objective scoring, and top-3 selection
- `apps/web/lib/improve/improvement-execution-candidate.ts`
  - Build Studio candidate brief generation and execution-path recommendation
- `apps/web/lib/improve/improvement-signal.test.ts`
  - Unit tests for normalization and grouping
- `apps/web/lib/improve/improvement-evaluator.test.ts`
  - Unit tests for ranking, top-3 selection, and cross-portfolio prioritization
- `apps/web/lib/improve/improvement-execution-candidate.test.ts`
  - Unit tests for Build Studio brief packaging
- `apps/web/app/(shell)/ops/improvements/page.tsx`
  - Improvement flywheel review surface
- `apps/web/components/ops/improvement-flywheel-dashboard.tsx`
  - UI for signals, proposals, top-3 list, and execution candidates
- `docs/user-guide/ai-workforce/continuous-improvement-flywheel.md`
  - User-facing documentation for the platform principle and workflow

### Modified Files

- `packages/db/prisma/schema.prisma`
  - Add new models and extend `ImprovementProposal`/`BacklogItem`
- `apps/web/lib/improvement-data.ts`
  - Expand proposal queries to include product/portfolio scope, evaluation linkage, and execution recommendations
- `apps/web/lib/operate/process-observer-triage.ts`
  - Emit normalized improvement signals instead of only direct backlog items
- `apps/web/lib/actions/quality.ts`
  - Feed product and route quality findings into `ImprovementSignal`
- `apps/web/lib/actions/agent-coworker.ts`
  - Capture key interaction failure/success signals where appropriate
- `apps/web/lib/integrate/build-pipeline.ts`
  - Emit Build Studio execution outcome signals
- `apps/web/lib/explore/backlog.ts`
  - Support `proposed` backlog status and origin metadata
- `apps/web/lib/explore/backlog.test.ts`
  - Coverage for new backlog status and origin fields
- `apps/web/app/api/v1/ops/backlog/route.ts`
  - Accept proposal-origin and portfolio-linked backlog creation
- `apps/web/app/api/v1/ops/backlog/[id]/route.ts`
  - Update/transition proposed backlog items
- `apps/web/lib/evaluate/portfolio-data.ts`
  - Add rollups for proposed improvements and investment distribution
- `apps/web/lib/tak/agent-routing.ts`
  - Extend portfolio-level coworker capability language around daily improvement evaluation
- `apps/web/lib/mcp-tools.ts`
  - Add tools for generating improvement proposals and execution candidates if needed

---

## Chunk 1: Data Model Foundations

### Task 1: Extend Prisma schema for the flywheel core

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Test: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add the failing schema expectations**

Document the required additions in the schema before editing:

- `ImprovementSignal`
- `ImprovementEvaluationRun`
- `ImprovementExecutionCandidate`
- `BacklogItem.status` supports `proposed`
- `BacklogItem.portfolioId`, `originType`, `originId`, `companyObjective`, `executionPath`, `improvementProposalId`
- `ImprovementProposal.digitalProductId`, `portfolioId`, `evaluationRunId`, `rootCauseType`, `companyObjective`, `expectedImpact`, `expectedEffort`, `reusePotential`, `executionRecommendation`

- [ ] **Step 2: Update `schema.prisma` with minimal new models and relations**

Add focused Prisma model changes only for fields and relations defined by the spec. Keep relation naming explicit and consistent with the current schema style.

- [ ] **Step 3: Run Prisma format/generate validation**

Run: `pnpm --filter @dpf/db generate`
Expected: Prisma client generates without schema errors

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/schema.prisma
git commit -m "feat: add continuous improvement flywheel schema"
```

### Task 2: Create migration with backfill rules

**Files:**
- Create: `packages/db/prisma/migrations/<timestamp>_continuous_improvement_flywheel/migration.sql`
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Generate migration skeleton**

Run: `pnpm --filter @dpf/db migrate`
Expected: Prisma creates a new migration folder and SQL skeleton

- [ ] **Step 2: Add data backfill SQL**

Backfill rules:

- set existing backlog rows to remain in their current statuses
- backfill new `BacklogItem.portfolioId` from `EpicPortfolio` where possible
- migrate existing `ImprovementProposal` scope from route context if deterministically inferable, otherwise leave nullable

- [ ] **Step 3: Verify migration applies cleanly**

Run: `pnpm --filter @dpf/db migrate`
Expected: Migration applies without drift

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat: add flywheel migration and backlog backfill"
```

---

## Chunk 2: Signal Capture and Normalization

### Task 3: Create normalized improvement-signal model code

**Files:**
- Create: `apps/web/lib/improve/improvement-signal.ts`
- Test: `apps/web/lib/improve/improvement-signal.test.ts`

- [ ] **Step 1: Write the failing normalization tests**

Include tests for:

- repeated conversation friction becomes one grouped signal with incremented recurrence
- product-scoped findings preserve `digitalProductId`
- platform-wide findings remain portfolio/global-scoped
- graph refs and suspected root cause are optional, not mandatory

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web exec vitest run apps/web/lib/improve/improvement-signal.test.ts`
Expected: FAIL because the module does not exist yet

- [ ] **Step 3: Implement minimal normalization code**

Create:

- signal type definitions
- dedup key generation
- recurrence merge behavior
- source normalization helpers

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web exec vitest run apps/web/lib/improve/improvement-signal.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/improve/improvement-signal.ts apps/web/lib/improve/improvement-signal.test.ts
git commit -m "feat: add normalized improvement signal model"
```

### Task 4: Redirect observation sources into normalized signals

**Files:**
- Modify: `apps/web/lib/operate/process-observer-triage.ts`
- Modify: `apps/web/lib/actions/quality.ts`
- Modify: `apps/web/lib/actions/agent-coworker.ts`
- Modify: `apps/web/lib/integrate/build-pipeline.ts`
- Test: `apps/web/lib/operate/process-observer-triage.test.ts`

- [ ] **Step 1: Write/extend failing tests for signal emission**

Add cases proving:

- process observer can emit signal records before or alongside backlog filing
- quality findings can target product/portfolio-linked signals
- Build Studio failures create execution-quality signals

- [ ] **Step 2: Run focused tests to verify failures**

Run: `pnpm --filter web exec vitest run apps/web/lib/operate/process-observer-triage.test.ts`
Expected: FAIL on missing signal behavior

- [ ] **Step 3: Implement minimal source-to-signal hooks**

Do not over-automate yet. Add thin emission points only where the source already has structured findings.

- [ ] **Step 4: Re-run focused tests**

Run: `pnpm --filter web exec vitest run apps/web/lib/operate/process-observer-triage.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/operate/process-observer-triage.ts apps/web/lib/actions/quality.ts apps/web/lib/actions/agent-coworker.ts apps/web/lib/integrate/build-pipeline.ts apps/web/lib/operate/process-observer-triage.test.ts
git commit -m "feat: capture improvement signals from observation sources"
```

---

## Chunk 3: Daily Evaluation and Top-3 Ranking

### Task 5: Implement company-objective-aware ranking

**Files:**
- Create: `apps/web/lib/improve/improvement-evaluator.ts`
- Test: `apps/web/lib/improve/improvement-evaluator.test.ts`

- [ ] **Step 1: Write failing ranking tests**

Cover:

- local complaint loses to higher-leverage cross-portfolio root cause
- recurrence alone does not win over company-objective impact
- evaluator returns only top 3 items
- graph leverage boosts shared-root-cause candidates

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter web exec vitest run apps/web/lib/improve/improvement-evaluator.test.ts`
Expected: FAIL because evaluator is missing

- [ ] **Step 3: Implement minimal evaluator**

Implement:

- score composition function
- top-3 selection
- explainability fields for why each item ranked where it did

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter web exec vitest run apps/web/lib/improve/improvement-evaluator.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/improve/improvement-evaluator.ts apps/web/lib/improve/improvement-evaluator.test.ts
git commit -m "feat: rank improvement opportunities by company objective impact"
```

### Task 6: Add evaluation-run persistence and proposal creation

**Files:**
- Modify: `apps/web/lib/improvement-data.ts`
- Modify: `apps/web/app/api/v1/ops/backlog/route.ts`
- Modify: `apps/web/app/api/v1/ops/backlog/[id]/route.ts`
- Modify: `apps/web/lib/explore/backlog.ts`
- Test: `apps/web/lib/explore/backlog.test.ts`

- [ ] **Step 1: Write failing tests for `proposed` backlog support**

Add cases for:

- creating a backlog item in `proposed` status
- preserving proposal origin metadata
- portfolio-linked proposed items

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web exec vitest run apps/web/lib/explore/backlog.test.ts`
Expected: FAIL on unsupported status or metadata

- [ ] **Step 3: Implement minimal proposal persistence**

Add:

- `proposed` status handling
- origin metadata flow
- evaluation run linkage

- [ ] **Step 4: Run tests to verify it passes**

Run: `pnpm --filter web exec vitest run apps/web/lib/explore/backlog.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/improvement-data.ts apps/web/app/api/v1/ops/backlog/route.ts apps/web/app/api/v1/ops/backlog/[id]/route.ts apps/web/lib/explore/backlog.ts apps/web/lib/explore/backlog.test.ts
git commit -m "feat: persist proposed backlog items for flywheel output"
```

---

## Chunk 4: Build Studio Handoff

### Task 7: Generate execution candidate briefs

**Files:**
- Create: `apps/web/lib/improve/improvement-execution-candidate.ts`
- Test: `apps/web/lib/improve/improvement-execution-candidate.test.ts`

- [ ] **Step 1: Write failing tests for execution candidate generation**

Cover:

- proposal becomes Build Studio candidate with evidence summary
- candidate carries impacted products/portfolios
- candidate distinguishes `manual`, `build_studio`, and `upstream_candidate`

- [ ] **Step 2: Run tests to verify failures**

Run: `pnpm --filter web exec vitest run apps/web/lib/improve/improvement-execution-candidate.test.ts`
Expected: FAIL because the module is missing

- [ ] **Step 3: Implement minimal candidate generator**

Generate a brief JSON object containing:

- improvement hypothesis
- evidence summary
- suspected root cause
- graph leverage summary
- impacted products/portfolios
- expected objective outcome

- [ ] **Step 4: Run tests to verify passes**

Run: `pnpm --filter web exec vitest run apps/web/lib/improve/improvement-execution-candidate.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/improve/improvement-execution-candidate.ts apps/web/lib/improve/improvement-execution-candidate.test.ts
git commit -m "feat: add Build Studio execution candidates for improvements"
```

### Task 8: Connect approved candidates to Build Studio

**Files:**
- Modify: `apps/web/lib/integrate/build-pipeline.ts`
- Modify: `apps/web/lib/explore/feature-build-data.ts`
- Modify: `apps/web/lib/integrate/build-agent-prompts.ts`

- [ ] **Step 1: Write failing integration test or data-shape assertion**

Add a focused test proving a candidate brief can be consumed by Build Studio as structured context.

- [ ] **Step 2: Run the focused test to verify failure**

Run: `pnpm --filter web exec vitest run apps/web/lib/explore/feature-build-data.test.ts`
Expected: FAIL on missing candidate support

- [ ] **Step 3: Implement minimal Build Studio handoff**

Pass the candidate brief into the build context without launching builds automatically.

- [ ] **Step 4: Re-run the focused test**

Run: `pnpm --filter web exec vitest run apps/web/lib/explore/feature-build-data.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/integrate/build-pipeline.ts apps/web/lib/explore/feature-build-data.ts apps/web/lib/integrate/build-agent-prompts.ts
git commit -m "feat: wire improvement candidates into Build Studio context"
```

---

## Chunk 5: UX, Rollups, and Documentation

### Task 9: Add the improvement flywheel review UI

**Files:**
- Create: `apps/web/app/(shell)/ops/improvements/page.tsx`
- Create: `apps/web/components/ops/improvement-flywheel-dashboard.tsx`
- Modify: `apps/web/lib/evaluate/portfolio-data.ts`

- [ ] **Step 1: Write component/data tests for the dashboard**

Cover:

- top 3 list rendering
- proposal counts by status
- portfolio/product attribution display
- execution recommendation display

- [ ] **Step 2: Run the failing tests**

Run: `pnpm --filter web exec vitest run apps/web/components/ops/improvement-flywheel-dashboard.test.tsx`
Expected: FAIL because the UI is missing

- [ ] **Step 3: Implement minimal theme-aware UI**

Use existing CSS variables only and follow the established ops/portfolio page patterns.

- [ ] **Step 4: Run tests and build check**

Run:
- `pnpm --filter web exec vitest run apps/web/components/ops/improvement-flywheel-dashboard.test.tsx`
- `pnpm --filter web exec next build`

Expected:
- tests PASS
- build succeeds

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/(shell)/ops/improvements/page.tsx apps/web/components/ops/improvement-flywheel-dashboard.tsx apps/web/lib/evaluate/portfolio-data.ts
git commit -m "feat: add improvement flywheel review dashboard"
```

### Task 10: Document the platform principle and workflow

**Files:**
- Create: `docs/user-guide/ai-workforce/continuous-improvement-flywheel.md`
- Modify: relevant user-guide index pages if needed

- [ ] **Step 1: Write the documentation**

Include:

- what the flywheel is
- how top 3 opportunities are generated
- why the backlog uses `proposed`
- how Build Studio candidates fit in
- how local vs common-platform contribution works

- [ ] **Step 2: Review for consistency with the spec**

Ensure terminology matches:

- Digital Product
- four IT4IT portfolios
- common backlog
- Build Studio candidate

- [ ] **Step 3: Commit**

```bash
git add docs/user-guide/ai-workforce/continuous-improvement-flywheel.md
git commit -m "docs: add continuous improvement flywheel guide"
```

---

## Final Verification

### Task 11: Run epic-level verification

**Files:**
- Modify: only if fixes are needed after verification

- [ ] **Step 1: Run focused Vitest suites**

Run:

```bash
pnpm --filter web exec vitest run apps/web/lib/improve/improvement-signal.test.ts apps/web/lib/improve/improvement-evaluator.test.ts apps/web/lib/improve/improvement-execution-candidate.test.ts apps/web/lib/explore/backlog.test.ts apps/web/lib/operate/process-observer-triage.test.ts
```

Expected: PASS

- [ ] **Step 2: Run Prisma validation**

Run:

```bash
pnpm --filter @dpf/db generate
```

Expected: PASS

- [ ] **Step 3: Run production build**

Run:

```bash
pnpm --filter web exec next build
```

Expected: build succeeds with no new errors

- [ ] **Step 4: Commit any final fixups**

```bash
git add <touched files>
git commit -m "test: verify continuous improvement flywheel end to end"
```

---

## Notes for the Implementer

- Keep the common backlog canonical. Do not build a parallel hidden queue.
- Preserve explainability for why a top-3 item ranked highly.
- Use graph context as an influence, not as magical proof of causality.
- Keep Build Studio launch human-governed in v1; generate candidates, do not auto-run builds.
- If live PostgreSQL is unavailable during implementation, state clearly when using schema/spec defaults instead of runtime truth.
