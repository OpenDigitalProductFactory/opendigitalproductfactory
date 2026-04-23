# Deliberation Pattern Framework V1 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first reusable deliberation framework for DPF, including `review` and `debate` patterns, retrieval-first evidence handling, coworker/MCP entry points, and Build Studio summary + graph support.

**Architecture:** Extend the existing `TaskRun` / `TaskNode` / `TaskNodeEdge` runtime instead of creating a second orchestration system. Persist deliberation-specific metadata, outcomes, claims, and evidence in new Prisma models; seed patterns and personas from repo files; execute every branch through the existing routing pipeline; surface only compact outcomes on `FeatureBuild` and the Build Studio UI.

**Tech Stack:** Next.js 16 App Router, React 19, Prisma 7, Inngest, Vitest, Playwright, pnpm workspaces.

---

## Scope And Non-Goals

- **In scope:** Spec phases 1-3 only from [2026-04-21-deliberation-pattern-framework-design.md](/D:/DPF/docs/superpowers/specs/2026-04-21-deliberation-pattern-framework-design.md): framework foundation, Build Studio `review`, Build Studio `debate`, coworker/MCP invocation, evidence persistence, and Build Studio visualization.
- **Out of scope:** Future patterns (`red-team`, `design-jury`, `evidence-reconciliation`), platform-wide rollout to non-Build-Studio routes, admin CRUD UI for pattern editing, and any governance/HITL changes.
- **Constraint:** Work directly on `main` per repo policy. Commit after each logical task.
- **Constraint:** Do not rely on the unverified Nature DOI from the spec. Runtime code can ship without that citation, but any follow-up docs must replace it with a verified source first.
- **Constraint:** `FeatureBuild` should only store compact deliberation summaries and references, never the heavy branch-by-branch payload inline.

## File Structure Map

### New repo-root assets

- Create: `deliberation/review.deliberation.md`
- Create: `deliberation/debate.deliberation.md`
- Create: `prompts/deliberation/author.prompt.md`
- Create: `prompts/deliberation/reviewer.prompt.md`
- Create: `prompts/deliberation/skeptic.prompt.md`
- Create: `prompts/deliberation/debater.prompt.md`
- Create: `prompts/deliberation/adjudicator.prompt.md`

### New database/runtime files

- Create: `packages/db/src/seed-deliberation.ts`
- Create: `packages/db/src/seed-deliberation.test.ts`
- Create: `apps/web/lib/deliberation/types.ts`
- Create: `apps/web/lib/deliberation/types.test.ts`
- Create: `apps/web/lib/deliberation/registry.ts`
- Create: `apps/web/lib/deliberation/registry.test.ts`
- Create: `apps/web/lib/deliberation/activation.ts`
- Create: `apps/web/lib/deliberation/activation.test.ts`
- Create: `apps/web/lib/deliberation/evidence.ts`
- Create: `apps/web/lib/deliberation/evidence.test.ts`
- Create: `apps/web/lib/deliberation/request-contract.ts`
- Create: `apps/web/lib/deliberation/request-contract.test.ts`
- Create: `apps/web/lib/deliberation/orchestrator.ts`
- Create: `apps/web/lib/deliberation/orchestrator.test.ts`
- Create: `apps/web/lib/deliberation/synthesizer.ts`
- Create: `apps/web/lib/deliberation/synthesizer.test.ts`
- Create: `apps/web/lib/actions/deliberation.ts`
- Create: `apps/web/lib/actions/deliberation.test.ts`
- Create: `apps/web/lib/queue/functions/deliberation-run.ts`
- Create: `apps/web/lib/queue/functions/deliberation-run.test.ts`

### New UI files

- Create: `apps/web/components/deliberation/DeliberationSummaryCard.tsx`
- Create: `apps/web/components/deliberation/DeliberationSummaryCard.test.tsx`
- Create: `apps/web/components/deliberation/DeliberationDrilldown.tsx`
- Create: `apps/web/components/deliberation/DeliberationDrilldown.test.tsx`

### Existing files to modify

- Modify: `packages/db/prisma/schema.prisma`
- Modify: `packages/db/src/seed.ts`
- Modify: `apps/web/lib/mcp-tools.ts`
- Modify: `apps/web/lib/actions/external-evidence.ts`
- Modify: `apps/web/lib/tak/agent-event-bus.ts`
- Modify: `apps/web/lib/tak/thread-progress.ts`
- Modify: `apps/web/lib/routing/recipe-loader.ts`
- Modify: `apps/web/lib/routing/recipe-types.ts`
- Modify: `apps/web/lib/routing/task-router.ts`
- Modify: `apps/web/lib/routing/pipeline-v2.ts`
- Modify: `apps/web/lib/feature-build-types.ts`
- Modify: `apps/web/lib/actions/build-read.ts`
- Modify: `apps/web/lib/build/process-graph-builder.ts`
- Modify: `apps/web/lib/build/process-graph-builder.test.ts`
- Modify: `apps/web/lib/integrate/build-agent-prompts.ts`
- Modify: `apps/web/lib/integrate/build-reviewers.ts`
- Modify: `apps/web/lib/integrate/build-orchestrator.ts`
- Modify: `apps/web/components/build/BuildStudio.tsx`
- Modify: `apps/web/components/build/BuildStudio.test.ts`
- Modify: `apps/web/components/build/ProcessGraph.tsx`
- Modify: `tests/e2e/platform-qa-plan.md`

## Chunk 1: Schema, Seeds, And Canonical Types

### Task 1: Add file-backed deliberation assets and parser/seed tests

**Files:**
- Create: `deliberation/review.deliberation.md`
- Create: `deliberation/debate.deliberation.md`
- Create: `prompts/deliberation/author.prompt.md`
- Create: `prompts/deliberation/reviewer.prompt.md`
- Create: `prompts/deliberation/skeptic.prompt.md`
- Create: `prompts/deliberation/debater.prompt.md`
- Create: `prompts/deliberation/adjudicator.prompt.md`
- Create: `packages/db/src/seed-deliberation.ts`
- Create: `packages/db/src/seed-deliberation.test.ts`
- Modify: `packages/db/src/seed.ts`

- [ ] **Step 1.1: Write the failing seed test** in `packages/db/src/seed-deliberation.test.ts` for three behaviors:
  - discovers `.deliberation.md` files under repo-root `deliberation/`
  - parses frontmatter into `{ slug, name, purpose, defaultRoles, topologyTemplate, activationPolicyHints, evidenceRequirements, outputContract, providerStrategyHints, status }`
  - upsert-skips runtime-overridden DB rows the same way `seed-prompt-templates.ts` skips `isOverridden`

- [ ] **Step 1.2: Run the failing test**
  ```bash
  pnpm --filter @dpf/db exec vitest run packages/db/src/seed-deliberation.test.ts
  ```
  Expected: module-not-found failure for `seed-deliberation.ts`.

- [ ] **Step 1.3: Add the prompt files**
  Use the existing `prompts/*.prompt.md` convention so `loadPrompt("deliberation", "<role>")` works without inventing a second loader.

- [ ] **Step 1.4: Add the two pattern seed files**
  Use frontmatter shaped like:
  ```md
  ---
  slug: review
  name: Peer Review
  status: active
  purpose: Structured multi-agent critique before a normal HITL gate.
  defaultRoles:
    - roleId: author
      count: 1
      required: true
    - roleId: reviewer
      count: 2
      required: true
    - roleId: adjudicator
      count: 1
      required: true
  topologyTemplate:
    rootNodeType: review
    branchNodeType: review
    skepticalNodeType: skeptical_review
    edgeTypes: ["informs"]
  ---
  ```
  Include a matching `debate` file with role IDs `debater`, `skeptic`, `adjudicator`.

- [ ] **Step 1.5: Implement `seed-deliberation.ts`**
  Mirror the patterns from [seed-prompt-templates.ts](/D:/DPF/packages/db/src/seed-prompt-templates.ts) for discovery, frontmatter parsing, and idempotent upsert behavior.

- [ ] **Step 1.6: Wire the new seeder into `packages/db/src/seed.ts`**
  Call it in the same bootstrap pass that seeds prompt templates and skills.

- [ ] **Step 1.7: Re-run the seed test**
  ```bash
  pnpm --filter @dpf/db exec vitest run packages/db/src/seed-deliberation.test.ts
  ```
  Expected: passing parser/upsert tests.

- [ ] **Step 1.8: Commit**
  ```bash
  git add deliberation prompts/deliberation packages/db/src/seed-deliberation.ts packages/db/src/seed-deliberation.test.ts packages/db/src/seed.ts
  git commit -m "feat(deliberation): add file-backed pattern and persona seeds"
  ```

### Task 2: Add Prisma models, migration, and compact Build Studio summary storage

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_add_deliberation/migration.sql`

- [ ] **Step 2.1: Update the Prisma schema**
  Add:
  - `DeliberationPattern`
  - `DeliberationRoleProfile`
  - `DeliberationRun`
  - `DeliberationOutcome`
  - `DeliberationIssueSet`
  - `ClaimRecord`
  - `EvidenceBundle`
  - `EvidenceSource`
  - `TaskNode.deliberationRunId String? @index`
  - `FeatureBuild.deliberationSummary Json?`
  - `isOverridden Boolean @default(false)` on the seed-backed config models so file reseeding does not clobber runtime edits later

- [ ] **Step 2.2: Keep the Build Studio summary compact**
  Use a `FeatureBuild.deliberationSummary` payload shaped like:
  ```ts
  type BuildDeliberationSummary = Partial<Record<"ideate" | "plan" | "review", {
    patternSlug: "review" | "debate";
    deliberationRunId: string;
    consensusState: "consensus" | "partial-consensus" | "no-consensus" | "insufficient-evidence" | "pending";
    rationaleSummary: string;
    evidenceQuality: "source-backed" | "mixed" | "needs-more-evidence";
    unresolvedRisks: string[];
    diversityLabel: string;
  }>>;
  ```

- [ ] **Step 2.3: Generate the migration**
  ```bash
  pnpm db:migrate --name add_deliberation
  ```
  Then open the generated SQL and verify it is additive only. No backfill SQL is needed because every new field/table is nullable or brand new.

- [ ] **Step 2.4: Generate the Prisma client**
  ```bash
  pnpm db:generate
  ```

- [ ] **Step 2.5: Apply the migration locally**
  ```bash
  pnpm db:migrate
  ```
  Expected: migration applies cleanly with no drift.

- [ ] **Step 2.6: Commit**
  ```bash
  git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
  git commit -m "feat(deliberation): add runtime and evidence schema"
  ```

### Task 3: Add the canonical enum/type module and guard tests

**Files:**
- Create: `apps/web/lib/deliberation/types.ts`
- Create: `apps/web/lib/deliberation/types.test.ts`

- [ ] **Step 3.1: Write the failing test**
  Assert that the module exports the exact canonical arrays from spec §6.6, for example:
  ```ts
  expect(DELIBERATION_TRIGGER_SOURCES).toEqual(["stage", "risk", "explicit", "combined"]);
  expect(DELIBERATION_DIVERSITY_MODES).toEqual([
    "single-model-multi-persona",
    "multi-model-same-provider",
    "multi-provider-heterogeneous",
  ]);
  ```

- [ ] **Step 3.2: Run the failing test**
  ```bash
  pnpm --filter web exec vitest run apps/web/lib/deliberation/types.test.ts
  ```

- [ ] **Step 3.3: Implement `types.ts`**
  Export `as const` arrays plus unions and small guards for:
  - pattern status
  - artifact type
  - trigger source
  - adjudication mode
  - activated risk level
  - diversity mode
  - strategy profile
  - consensus state
  - evidence strictness
  - claim type
  - claim status
  - evidence grade
  - evidence source type

- [ ] **Step 3.4: Re-run the type test**
  ```bash
  pnpm --filter web exec vitest run apps/web/lib/deliberation/types.test.ts
  ```

- [ ] **Step 3.5: Commit**
  ```bash
  git add apps/web/lib/deliberation/types.ts apps/web/lib/deliberation/types.test.ts
  git commit -m "feat(deliberation): add canonical runtime enums and guards"
  ```

## Chunk 2: Registry, Evidence, Routing, And Orchestration

### Task 4: Add the pattern registry and activation resolver

**Files:**
- Create: `apps/web/lib/deliberation/registry.ts`
- Create: `apps/web/lib/deliberation/registry.test.ts`
- Create: `apps/web/lib/deliberation/activation.ts`
- Create: `apps/web/lib/deliberation/activation.test.ts`
- Modify: `apps/web/lib/routing/recipe-loader.ts`
- Modify: `apps/web/lib/routing/recipe-types.ts`

- [ ] **Step 4.1: Write the failing registry tests**
  Cover:
  - DB-first load with file fallback
  - prompt-loader-based role prompt composition
  - recipe extraction from the seed file metadata

- [ ] **Step 4.2: Write the failing activation tests**
  Cover:
  - explicit invocation overrides stage default
  - risk escalation upgrades `review` to `debate`
  - no pattern for low-risk/no-default work
  - explicit invocation can strengthen but not weaken required policy

- [ ] **Step 4.3: Run the failing tests**
  ```bash
  pnpm --filter web exec vitest run apps/web/lib/deliberation/registry.test.ts apps/web/lib/deliberation/activation.test.ts
  ```

- [ ] **Step 4.4: Implement the registry**
  `registry.ts` should:
  - load `DeliberationPattern` and `DeliberationRoleProfile` rows from Prisma
  - fall back to file-backed patterns and `loadPrompt("deliberation", roleId)`
  - expose a normalized `ResolvedDeliberationPattern`
  - export a helper that translates pattern metadata into routing recipe entries

- [ ] **Step 4.5: Implement the activation resolver**
  `activation.ts` should accept:
  ```ts
  {
    stage?: "ideate" | "plan" | "build" | "review" | "ship";
    riskLevel: "low" | "medium" | "high" | "critical";
    explicitPatternSlug?: string | null;
    artifactType: DeliberationArtifactType;
    routeContext?: string | null;
  }
  ```
  and return either `null` or a concrete run config with `patternSlug`, `triggerSource`, `strategyProfile`, `diversityMode`, and a human-readable reason string.

- [ ] **Step 4.6: Extend routing recipe support**
  Modify `recipe-types.ts` and `recipe-loader.ts` so branch roles can ask for distinct routing recipes without bypassing the existing routing pipeline.

- [ ] **Step 4.7: Re-run the registry/activation tests**
  ```bash
  pnpm --filter web exec vitest run apps/web/lib/deliberation/registry.test.ts apps/web/lib/deliberation/activation.test.ts
  ```

- [ ] **Step 4.8: Commit**
  ```bash
  git add apps/web/lib/deliberation/registry.ts apps/web/lib/deliberation/registry.test.ts apps/web/lib/deliberation/activation.ts apps/web/lib/deliberation/activation.test.ts apps/web/lib/routing/recipe-loader.ts apps/web/lib/routing/recipe-types.ts
  git commit -m "feat(deliberation): add registry and activation policy"
  ```

### Task 5: Add evidence helpers and retrieval-first admissibility checks

**Files:**
- Create: `apps/web/lib/deliberation/evidence.ts`
- Create: `apps/web/lib/deliberation/evidence.test.ts`
- Modify: `apps/web/lib/actions/external-evidence.ts`

- [ ] **Step 5.1: Write the failing evidence-policy test**
  Cover:
  - Grade `D` claims cannot enter a final outcome
  - source-sensitive artifact types require citations
  - source locators serialize as structured locators, not loose URLs

- [ ] **Step 5.2: Run the failing test**
  ```bash
  pnpm --filter web exec vitest run apps/web/lib/deliberation/evidence.test.ts
  ```

- [ ] **Step 5.3: Implement `evidence.ts`**
  Add helpers to:
  - normalize `EvidenceSource` locators
  - validate admissibility by artifact type and pattern
  - split facts vs. inferences for synthesis output
  - compute `source-backed` / `mixed` / `needs-more-evidence` summary badges

- [ ] **Step 5.4: Keep `ExternalEvidenceRecord` as a compatibility layer**
  Do not overload it with deliberation-only structure. Add only the small helper call paths needed so retrieval events can be mirrored there when the platform already records public-web or external research activity.

- [ ] **Step 5.5: Re-run the evidence test**
  ```bash
  pnpm --filter web exec vitest run apps/web/lib/deliberation/evidence.test.ts
  ```

- [ ] **Step 5.6: Commit**
  ```bash
  git add apps/web/lib/deliberation/evidence.ts apps/web/lib/deliberation/evidence.test.ts apps/web/lib/actions/external-evidence.ts
  git commit -m "feat(deliberation): enforce retrieval-first evidence contracts"
  ```

### Task 6: Add branch request-contract building, orchestration, and async execution

**Files:**
- Create: `apps/web/lib/deliberation/request-contract.ts`
- Create: `apps/web/lib/deliberation/request-contract.test.ts`
- Create: `apps/web/lib/deliberation/orchestrator.ts`
- Create: `apps/web/lib/deliberation/orchestrator.test.ts`
- Create: `apps/web/lib/deliberation/synthesizer.ts`
- Create: `apps/web/lib/deliberation/synthesizer.test.ts`
- Create: `apps/web/lib/queue/functions/deliberation-run.ts`
- Create: `apps/web/lib/queue/functions/deliberation-run.test.ts`
- Modify: `apps/web/lib/routing/task-router.ts`
- Modify: `apps/web/lib/routing/pipeline-v2.ts`
- Modify: `apps/web/lib/tak/agent-event-bus.ts`
- Modify: `apps/web/lib/tak/thread-progress.ts`

- [ ] **Step 6.1: Write the failing request-contract test**
  Assert that each branch role produces a `RequestContract` routed through existing V2 routing and that diversity constraints are expressed as preferences, not hard-pinned model IDs.

- [ ] **Step 6.2: Write the failing orchestrator test**
  Cover:
  - `review` creates author/reviewer/adjudicator nodes and edges
  - `debate` creates position/skeptic/adjudicator nodes and edges
  - branch authority envelopes never widen parent authority
  - diversity degrades honestly when providers are unavailable

- [ ] **Step 6.3: Write the failing synthesizer test**
  Cover:
  - `consensus`
  - `partial-consensus`
  - `no-consensus`
  - `insufficient-evidence`
  - budget-halted outcomes

- [ ] **Step 6.4: Write the failing queue-runner test**
  Cover:
  - resumes an incomplete run
  - does not restart completed branches
  - emits progress events for dispatch, completion, degradation, and finish

- [ ] **Step 6.5: Run the failing runtime tests**
  ```bash
  pnpm --filter web exec vitest run apps/web/lib/deliberation/request-contract.test.ts apps/web/lib/deliberation/orchestrator.test.ts apps/web/lib/deliberation/synthesizer.test.ts apps/web/lib/queue/functions/deliberation-run.test.ts
  ```

- [ ] **Step 6.6: Implement `request-contract.ts`**
  Build role-specific `RequestContract`s that vary:
  - task type
  - minimum capabilities
  - preferred tier
  - whether web/file inputs are required
  - preferred provider/model diversity constraints

- [ ] **Step 6.7: Implement `orchestrator.ts`**
  Responsibilities:
  - create `TaskRun` when caller lacks one
  - create `DeliberationRun`
  - create branch `TaskNode`s / `TaskNodeEdge`s
  - persist requested vs actual diversity
  - enforce `maxBranches` and `budgetUsd`

- [ ] **Step 6.8: Implement `synthesizer.ts`**
  Turn branch outputs into:
  - `DeliberationOutcome`
  - `DeliberationIssueSet`
  - `ClaimRecord` rows
  - compact `FeatureBuild.deliberationSummary` patches

- [ ] **Step 6.9: Implement the async runner**
  `deliberation-run.ts` should reuse the TaskRun/queue style already used by brand extraction:
  - mark run active
  - dispatch branch routes through existing routing
  - persist per-branch `routeDecision`
  - update `TaskNode.status`
  - emit `pushThreadProgress()` events

- [ ] **Step 6.10: Extend progress event types**
  Add event tags in `agent-event-bus.ts` for at least:
  - `deliberation:queued`
  - `deliberation:branch_dispatched`
  - `deliberation:branch_completed`
  - `deliberation:degraded_diversity`
  - `deliberation:completed`

- [ ] **Step 6.11: Re-run the runtime tests**
  ```bash
  pnpm --filter web exec vitest run apps/web/lib/deliberation/request-contract.test.ts apps/web/lib/deliberation/orchestrator.test.ts apps/web/lib/deliberation/synthesizer.test.ts apps/web/lib/queue/functions/deliberation-run.test.ts
  ```

- [ ] **Step 6.12: Commit**
  ```bash
  git add apps/web/lib/deliberation apps/web/lib/queue/functions/deliberation-run.ts apps/web/lib/queue/functions/deliberation-run.test.ts apps/web/lib/routing/task-router.ts apps/web/lib/routing/pipeline-v2.ts apps/web/lib/tak/agent-event-bus.ts apps/web/lib/tak/thread-progress.ts
  git commit -m "feat(deliberation): add orchestration and async execution"
  ```

### Task 7: Add MCP tools and server actions for coworker invocation

**Files:**
- Create: `apps/web/lib/actions/deliberation.ts`
- Create: `apps/web/lib/actions/deliberation.test.ts`
- Modify: `apps/web/lib/mcp-tools.ts`

- [ ] **Step 7.1: Write the failing action/tool test**
  Cover:
  - `start_deliberation`
  - `get_deliberation_status`
  - `get_deliberation_outcome`
  - `autoApproveWhen` for pre-authorized stage/risk invocations
  - refusal when tool authority exceeds parent authority

- [ ] **Step 7.2: Run the failing test**
  ```bash
  pnpm --filter web exec vitest run apps/web/lib/actions/deliberation.test.ts
  ```

- [ ] **Step 7.3: Implement the server action wrapper**
  `actions/deliberation.ts` should:
  - auth-check the user
  - call the activation resolver and orchestrator
  - return stable DTOs for UI and coworker use

- [ ] **Step 7.4: Add the MCP tool definitions**
  Extend [mcp-tools.ts](/D:/DPF/apps/web/lib/mcp-tools.ts) with:
  - `start_deliberation`
  - `get_deliberation_status`
  - `get_deliberation_outcome`

- [ ] **Step 7.5: Use exact enum arrays from `types.ts`**
  Do not duplicate string literals inline; import the canonical arrays to keep the tool schema and TS unions in sync.

- [ ] **Step 7.6: Re-run the action/tool test**
  ```bash
  pnpm --filter web exec vitest run apps/web/lib/actions/deliberation.test.ts
  ```

- [ ] **Step 7.7: Commit**
  ```bash
  git add apps/web/lib/actions/deliberation.ts apps/web/lib/actions/deliberation.test.ts apps/web/lib/mcp-tools.ts
  git commit -m "feat(deliberation): expose coworker tools for deliberation runs"
  ```

## Chunk 3: Build Studio Integration And UX

### Task 8: Integrate deliberation into Build Studio phase flows

**Files:**
- Modify: `apps/web/lib/feature-build-types.ts`
- Modify: `apps/web/lib/actions/build-read.ts`
- Modify: `apps/web/lib/integrate/build-agent-prompts.ts`
- Modify: `apps/web/lib/integrate/build-reviewers.ts`
- Modify: `apps/web/lib/integrate/build-orchestrator.ts`

- [ ] **Step 8.1: Write the failing Build Studio integration test**
  Add focused tests around the pure helpers first:
  - `FeatureBuildRow` includes `deliberationSummary`
  - `build-read.ts` hydrates the JSON summary
  - Build-phase review orchestration now returns a deliberation summary rather than only the old merged reviewer payload

- [ ] **Step 8.2: Run the failing tests**
  ```bash
  pnpm --filter web exec vitest run apps/web/lib/build/process-graph-builder.test.ts apps/web/components/build/BuildStudio.test.ts
  ```
  Expected: failures until new fields and adapters exist.

- [ ] **Step 8.3: Extend `FeatureBuildRow`**
  Add:
  ```ts
  deliberationSummary: BuildDeliberationSummary | null;
  ```

- [ ] **Step 8.4: Hydrate the new field in `build-read.ts`**
  Keep the server action backward-compatible when old builds have `null`.

- [ ] **Step 8.5: Refactor Build Studio review entry points**
  Modify the current review path in `build-reviewers.ts` / `build-orchestrator.ts` so:
  - `ideate` defaults to `review`
  - `plan` defaults to `review`
  - explicit “debate this” requests can launch `debate`
  - the old prompt/JSON parsing helpers are reused where helpful, but the source of truth becomes `DeliberationRun`

- [ ] **Step 8.6: Add concise reason strings into build prompts**
  `build-agent-prompts.ts` should surface why deliberation ran in one sentence, matching the spec’s transparency rule.

- [ ] **Step 8.7: Re-run the targeted Build Studio tests**
  ```bash
  pnpm --filter web exec vitest run apps/web/lib/build/process-graph-builder.test.ts apps/web/components/build/BuildStudio.test.ts
  ```

- [ ] **Step 8.8: Commit**
  ```bash
  git add apps/web/lib/feature-build-types.ts apps/web/lib/actions/build-read.ts apps/web/lib/integrate/build-agent-prompts.ts apps/web/lib/integrate/build-reviewers.ts apps/web/lib/integrate/build-orchestrator.ts
  git commit -m "feat(build-studio): route plan and review through deliberation"
  ```

### Task 9: Add Build Studio summary cards, drill-down, and graph branches

**Files:**
- Create: `apps/web/components/deliberation/DeliberationSummaryCard.tsx`
- Create: `apps/web/components/deliberation/DeliberationSummaryCard.test.tsx`
- Create: `apps/web/components/deliberation/DeliberationDrilldown.tsx`
- Create: `apps/web/components/deliberation/DeliberationDrilldown.test.tsx`
- Modify: `apps/web/lib/build/process-graph-builder.ts`
- Modify: `apps/web/lib/build/process-graph-builder.test.ts`
- Modify: `apps/web/components/build/ProcessGraph.tsx`
- Modify: `apps/web/components/build/BuildStudio.tsx`
- Modify: `apps/web/components/build/BuildStudio.test.ts`

- [ ] **Step 9.1: Write the failing UI tests**
  Cover:
  - summary badges render for pattern/evidence/diversity/consensus
  - no raw prompt/token data appears in the default card
  - process graph adds nested branch nodes for `review` and `debate`
  - drill-down renders claims, objections, and source links when opened

- [ ] **Step 9.2: Run the failing UI tests**
  ```bash
  pnpm --filter web exec vitest run apps/web/components/deliberation/DeliberationSummaryCard.test.tsx apps/web/components/deliberation/DeliberationDrilldown.test.tsx apps/web/lib/build/process-graph-builder.test.ts apps/web/components/build/BuildStudio.test.ts
  ```

- [ ] **Step 9.3: Implement the summary card**
  Use only theme variables:
  - `bg-[var(--dpf-surface-1)]`
  - `border-[var(--dpf-border)]`
  - `text-[var(--dpf-text)]`
  - `text-[var(--dpf-muted)]`

- [ ] **Step 9.4: Implement the drill-down**
  It should show:
  - branch role
  - provider/model/persona identity
  - claims and objections
  - evidence links and locators
  - adjudication notes

- [ ] **Step 9.5: Extend `process-graph-builder.ts`**
  Add a second graph layer under the active phase for:
  - review branch nodes (`reviewer A`, `reviewer B`, optional skeptic, synthesis)
  - debate branch nodes (`position A`, `position B`, skeptic, synthesis)
  Keep phase nodes as the top-level flow.

- [ ] **Step 9.6: Wire the new UI into `BuildStudio.tsx` and `ProcessGraph.tsx`**
  Default view stays summary-first; drill-down is opt-in.

- [ ] **Step 9.7: Re-run the UI tests**
  ```bash
  pnpm --filter web exec vitest run apps/web/components/deliberation/DeliberationSummaryCard.test.tsx apps/web/components/deliberation/DeliberationDrilldown.test.tsx apps/web/lib/build/process-graph-builder.test.ts apps/web/components/build/BuildStudio.test.ts
  ```

- [ ] **Step 9.8: Commit**
  ```bash
  git add apps/web/components/deliberation apps/web/lib/build/process-graph-builder.ts apps/web/lib/build/process-graph-builder.test.ts apps/web/components/build/ProcessGraph.tsx apps/web/components/build/BuildStudio.tsx apps/web/components/build/BuildStudio.test.ts
  git commit -m "feat(build-studio): visualize deliberation summaries and branches"
  ```

### Task 10: Add QA coverage and run the mandatory verification gate

**Files:**
- Modify: `tests/e2e/platform-qa-plan.md`

- [ ] **Step 10.1: Add Build Studio QA cases**
  Append `BUILD-32` onward in [platform-qa-plan.md](/D:/DPF/tests/e2e/platform-qa-plan.md) for:
  - default `review` run in ideate
  - default `review` run in plan
  - explicit `debate` invocation
  - insufficient-evidence outcome
  - constrained-diversity reporting
  - source locator drill-down

- [ ] **Step 10.2: Run the new and affected unit tests**
  ```bash
  pnpm --filter @dpf/db exec vitest run packages/db/src/seed-deliberation.test.ts
  pnpm --filter web exec vitest run apps/web/lib/deliberation/types.test.ts apps/web/lib/deliberation/registry.test.ts apps/web/lib/deliberation/activation.test.ts apps/web/lib/deliberation/evidence.test.ts apps/web/lib/deliberation/request-contract.test.ts apps/web/lib/deliberation/orchestrator.test.ts apps/web/lib/deliberation/synthesizer.test.ts apps/web/lib/actions/deliberation.test.ts apps/web/lib/queue/functions/deliberation-run.test.ts apps/web/lib/build/process-graph-builder.test.ts apps/web/components/deliberation/DeliberationSummaryCard.test.tsx apps/web/components/deliberation/DeliberationDrilldown.test.tsx apps/web/components/build/BuildStudio.test.ts
  ```

- [ ] **Step 10.3: Run web typecheck**
  ```bash
  pnpm --filter web typecheck
  ```

- [ ] **Step 10.4: Run the production build gate**
  ```bash
  cd apps/web && npx next build
  ```
  Expected: zero errors.

- [ ] **Step 10.5: If the build or tests fail, fix them before proceeding**
  Do not defer build fixes.

- [ ] **Step 10.6: Commit the verification and QA update**
  ```bash
  git add tests/e2e/platform-qa-plan.md
  git commit -m "test(deliberation): add QA coverage and verify build"
  ```

## Execution Notes

- Use the existing routing pipeline for every branch. No direct provider pinning.
- Reuse existing prompt and queue patterns wherever possible; the new framework should feel native to DPF, not bolted on.
- If you discover a simpler way to keep `FeatureBuild` compact without losing run references, prefer that, but do not inline heavy evidence payloads onto the build record.
- If implementation pressure forces a scope cut, keep:
  1. schema + seed foundation
  2. registry + orchestration + MCP tools
  3. Build Studio summary UI
  
  and defer richer drill-down/graph detail rather than cutting the runtime model.
