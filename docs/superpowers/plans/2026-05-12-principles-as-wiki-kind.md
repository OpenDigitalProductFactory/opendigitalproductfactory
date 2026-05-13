# Principles as a Wiki Kind - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Each phase is a separate PR; do not bundle phases.

| Field | Value |
|-------|-------|
| **Spec** | [2026-05-12-principles-as-wiki-kind-design.md](../specs/2026-05-12-principles-as-wiki-kind-design.md) |
| **Spec PR** | [#518](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/518) |
| **Status** | Phase 0 not started |
| **Created** | 2026-05-12 |
| **Chief architect review** | Updated 2026-05-12 after repo and live-MCP verification |
| **Branch base for all phases** | `origin/main`, after Phase -1 verifies whether PR #489 / Principle 9 is present on the implementation base |

**Goal:** Add `principle` as a first-class `WikiPage.pageKind` with tiered taxonomy, explicit signed decision vectors, advisory decision-support tooling, retrieval integration for in-platform coworkers and external MCP agents, and kernel-markdown-driven public docs.

**Architecture:** Extend `WikiPage` with nullable principle-only fields. Constants live in a typed module imported by seed, lint, MCP schemas, and UI. Retrieval splits between Postgres (always-include commandments) and Qdrant (relevance-ranked core/contextual). One advisory MCP tool (`principle_decide`) returns a contribution ledger; one extended MCP tool (`wiki_query`) adds tier/applies-to filters. Public docs are generated from kernel markdown into `docs/principles.md` for the Jekyll site.

**Tech Stack:** Prisma 7, Postgres, Qdrant (`nomic-embed-text`, 768-dim), Next.js (App Router) for portal UI, Jekyll/GitHub Pages for public docs, Vitest, TypeScript, MCP JSON-RPC at `/api/mcp/v1`.

---

## Build Gate (per `AGENTS.md` section 5, applied at the end of every phase)

All four must pass before opening the phase PR:

1. Unit tests — `pnpm --filter <pkg> exec vitest run` for affected files.
2. Production build — `pnpm --filter web build` with zero errors.
3. UX verification — exercise affected portal paths against the running Docker stack (Phase 0 onward whenever UI changes ship).
4. Migration applies cleanly on a fresh DB — Phase 0 only (later phases are additive constants/lint/MCP/content).

Plus: `git commit -s` on every commit (DCO), positional path args to scope staging (`git add -- <path>`), branch from `origin/main`, run `git branch --show-current` before committing and abort if on `main` or detached, use pinned `pnpm --filter ...` commands rather than `npx`, and run `pnpm --filter web exec vitest run` for the full web suite before pushing (per `feedback_run_full_tests_before_push.md`).

---

## Refactor Budget

20 percent of every phase is reserved for cleanup, deletions, and consistency fixes per `feedback_zero_technical_debt.md`. If a phase implementation surfaces dead constants, duplicated string literals, or stale comments, that work lands inside the same PR — not deferred. Each phase PR description must name what was retired.

This is not optional polish. For this plan the first refactor budget is already allocated: centralize wiki kind/status/principle constants, add the missing kernel-slug uniqueness guard, and remove duplicated principle payload names before any retrieval or decision logic lands.

---

## Chief Architect Corrections

This plan was reviewed against the target worktree and the live DPF MCP planning surface. The following corrections are now part of the implementation contract:

1. **Run Phase -1 before implementation.** Live `search_specs_and_plans` returned no indexed match for this exact principles/wiki work, while open epic `EP-TAK-3F9A21` still owns governed memory, MCP, and observability alignment. Implementers must record whether this work is linked under that epic or whether a new backlog item is needed before Phase 0 starts.
2. **Do not trust stale branch assumptions.** The target checkout currently contains Principle 9 and the capacity-continuity spec, even though the design document still describes an older eight-principle branch-local state. Phase -1 reconciles that mismatch and updates the spec/plan pair before content seeding.
3. **Fix the nullable kernel slug uniqueness gap in Phase 0.** `@@unique([organizationId, slug])` does not protect kernel rows where `organizationId IS NULL`. Add a hand-written partial unique index for kernel `WikiPage.slug` in the same schema phase that adds principle fields.
4. **Use canonical payload names.** Qdrant and MCP metadata use `principleTier`, `principleAppliesTo`, `principleDimensions`, and `principlePublic`. Do not introduce short aliases such as `tier` / `appliesTo` in runtime payloads, and do not add a separate `principleOnly` or `isPrinciple` flag when `pageKind === "principle"` already carries that meaning.
5. **Keep local memory out of PR scope.** Reviewed memory can inform candidate principles, but private local memory files are not repo artifacts, are not edited by this plan, and are never bulk-imported. Any promoted principle must be rewritten as product-safe kernel content with public/internal classification.
6. **Treat UI as architecture.** `/wiki?kind=principle`, principle detail pages, admin lint, and decision-ledger rendering must be theme-aware, compact, filterable, and verified in the running portal. Hidden metadata is not a usable governance layer.

---

## Cross-Phase Constants (one source of truth)

The following constants live in `packages/db/src/wiki-taxonomy.ts` (created in Phase 0, task 1) and are imported by seed, lint, MCP schemas, retrieval, and UI. `wiki-store.ts` imports and re-exports these types for compatibility. Never duplicate these string arrays.

```typescript
export const WIKI_PAGE_KINDS = [
  "entity",
  "summary",
  "decision",
  "runbook",
  "index",
  "stance",
  "heuristic",
  "principle",
] as const;
export type WikiPageKind = (typeof WIKI_PAGE_KINDS)[number];

export const WIKI_PAGE_STATUSES = [
  "draft",
  "published",
  "review-needed",
  "archived",
] as const;
export type WikiPageStatus = (typeof WIKI_PAGE_STATUSES)[number];

export const PRINCIPLE_TIERS = ["commandment", "core", "contextual"] as const;
export type PrincipleTier = (typeof PRINCIPLE_TIERS)[number];

export const PRINCIPLE_APPLIES_TO = [
  "in_platform_coworker",
  "external_coding_agent",
  "human",
] as const;
export type PrincipleAppliesTo = (typeof PRINCIPLE_APPLIES_TO)[number];

export const PRINCIPLE_DIMENSIONS = [
  "long_term_maintainability",
  "blast_radius",
  "reusability",
  "evidence_density",
  "human_cognitive_load",
  "capacity_utilization",
  "governance_compliance",
  "public_safety",
  "speed_to_value",
  "schema_grounding",
] as const;
export type PrincipleDimension = (typeof PRINCIPLE_DIMENSIONS)[number];

export const PRINCIPLE_TIER_DEFAULT_WEIGHT: Record<PrincipleTier, number> = {
  commandment: 1.0,
  core: 0.4,
  contextual: 0.1,
};

export const PRINCIPLE_TIER_CAPS: Record<PrincipleTier, number | null> = {
  commandment: 10,
  core: 30,
  contextual: null,
};

export const PRINCIPLE_DECIDE_DEFAULTS = {
  maxPrinciples: 20,
  tieMargin: 0.2,
  contextualSimilarityThreshold: 0.75,
  semanticFallbackWarnRatio: 0.4,
} as const;
```

Reverse-mappings (e.g., dimension index, `isWikiPageKind`, `isPrincipleTier`, `isPrincipleAppliesTo`, `isPrincipleDimension`) are added to the same module as needed.

---

## Phase -1 - Implementation Preflight and Backlog Alignment

**Branch:** same branch as the phase being prepared.

**Objective:** Make sure the implementation base, spec, plan, backlog, and repo truth agree before code changes begin.

- [ ] **Read `AGENTS.md` in the target worktree** and confirm the active branch is not `main` or detached.
- [ ] **Check worktree state:** `git status --short`. If unrelated changes exist, list them in the PR notes and avoid touching them.
- [ ] **Query live planning state through DPF MCP:** `search_specs_and_plans` for `principles wiki kind principle_decide`, `list_epics` for open epics, and recommended work under `EP-TAK-3F9A21`. Record the result in the first PR description.
- [ ] **Reconcile Principle 9 state:** verify whether `docs/architecture/ai-coworker-development-principles.md` contains Principle 9 and whether `docs/superpowers/specs/2026-05-12-ai-capacity-continuity-design.md` exists. If the spec still says "eight branch-local principles" on a branch where nine exist, correct the spec before Phase 3 content seeding.
- [ ] **Re-check current code anchors:** `WikiPageKind` in `packages/db/src/wiki-store.ts`, `WikiPage` in `schema.prisma`, `searchWikiPages` in `apps/web/lib/wiki/embeddings.ts`, `wiki_query` in `apps/web/lib/mcp-tools.ts`, and external MCP gating in `apps/web/app/api/mcp/v1/route.ts`.
- [ ] **Decide backlog linkage:** attach the PR to an existing TAK/GAID governed-memory/MCP backlog item if appropriate, or create a narrow new backlog item through MCP. Do not leave the work orphaned from live planning state.

**Exit criteria:** the plan, design spec, target branch, and live backlog reference the same implementation base and principle count.

---

## Phase 0 - Schema, Constants, and Authoring Contract

**Branch:** `feat/principles-batch-0-schema`

**Objective:** Land the schema migration, typed constants, authoring contract (templates + SCHEMA.md + AUTHORING.md updates), seed parsing, and base UI rendering for the new `principle` page kind. No business logic yet; principles can be authored as kernel markdown and seeded into Postgres and Qdrant.

**Files to create:**

- `packages/db/src/wiki-taxonomy.ts`
- `packages/db/src/wiki-taxonomy.test.ts`
- `packages/db/prisma/migrations/<timestamp>_add_principle_fields_to_wikipage/migration.sql`
- `docs/founder-kernel/wiki/principles/.gitkeep`
- `docs/founder-kernel/_templates/principle.template.md`

**Files to modify:**

- `packages/db/prisma/schema.prisma` (extend `WikiPage` model)
- `packages/db/src/wiki-store.ts` (import/re-export taxonomy types, principle-aware CRUD)
- `packages/db/src/wiki-store.test.ts` (principle CRUD fixtures)
- `packages/db/src/seed-wiki-kernel.ts` (frontmatter parsing for principle fields)
- `packages/db/src/seed-wiki-kernel.test.ts` (principle seeding fixtures)
- `apps/web/lib/wiki/embeddings.ts` (Qdrant payload extension - include canonical `principleTier`, `principleAppliesTo`, `principleDimensions`, and `principlePublic` only for principle pages)
- `apps/web/lib/wiki/embeddings.test.ts`
- `apps/web/components/wiki/WikiPageKindBadge.tsx` (render `principle` label)
- `apps/web/components/wiki/WikiPageList.tsx` (group/sort principles by tier when filtered)
- `apps/web/components/wiki/WikiPageViewer.tsx` (render principle metadata block)
- `docs/founder-kernel/SCHEMA.md` (add `principle` to page-kind contract)
- `docs/founder-kernel/AUTHORING.md` (principle authoring rules + folder convention)
- `docs/founder-kernel/manifest.json` (bump schema version)

### Task 0.1: Author the taxonomy constants module

**Files:**
- Create: `packages/db/src/wiki-taxonomy.ts`
- Test: `packages/db/src/wiki-taxonomy.test.ts`

- [ ] **Write failing test:** assertions for `WIKI_PAGE_KINDS` including `principle` and preserving the existing seven values, `WIKI_PAGE_STATUSES`, `PRINCIPLE_TIERS` length, `PRINCIPLE_DIMENSIONS` matches the spec section 10 list verbatim, `PRINCIPLE_TIER_DEFAULT_WEIGHT.commandment === 1.0`, and type-narrowing helpers `isWikiPageKind(x)` / `isPrincipleTier(x)` / `isPrincipleAppliesTo(x)` / `isPrincipleDimension(x)` work for valid and invalid inputs.
- [ ] **Run test, verify it fails:** `pnpm --filter @dpf/db exec vitest run src/wiki-taxonomy.test.ts` - expect "no module found" or assertion failure.
- [ ] **Implement the module** with the constants block under "Cross-Phase Constants" above, plus the type-narrowing predicates. No external dependencies.
- [ ] **Run test, verify it passes:** same command.
- [ ] **Commit:** `feat(db): add wiki taxonomy constants module` with DCO sign-off.

### Task 0.2: Extend `WikiPageKind` type union

**Files:**
- Modify: `packages/db/src/wiki-store.ts:43` (replace the local `WikiPageKind` declaration with imports/re-exports from `wiki-taxonomy.ts`)
- Modify: `packages/db/src/wiki-store.test.ts`

- [ ] **Write failing test:** `expect(WIKI_PAGE_KINDS).toContain("principle")` and `expect(WIKI_PAGE_KINDS).toHaveLength(8)`. Also test that the existing seven kinds are unchanged.
- [ ] **Run test, verify it fails.**
- [ ] **Modify `wiki-store.ts`** to import `WikiPageKind` and `WikiPageStatus` from `wiki-taxonomy.ts` and re-export them for existing callers. This is the Phase 0 refactor-budget cleanup that prevents a second enum source from appearing.
- [ ] **Run test, verify it passes.**
- [ ] **Commit:** `feat(db): add principle to WikiPageKind union`.

### Task 0.3: Add Prisma schema fields and migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (the `WikiPage` model)
- Create: `packages/db/prisma/migrations/<timestamp>_add_principle_fields_to_wikipage/migration.sql`

- [ ] **Write failing test in `packages/db/src/wiki-store.test.ts`:** create a `WikiPage` with `pageKind: "principle"`, `principleTier: "commandment"`, `principleDirection: "..."`, `principleDimensionVector: { long_term_maintainability: 1.0 }`, `principleDimensions: ["long_term_maintainability"]`, `principleAppliesTo: ["external_coding_agent"]`. Assert all fields round-trip from DB.
- [ ] **Run test, verify it fails** (schema doesn't have the columns yet).
- [ ] **Modify `schema.prisma`** — append the principle-only fields to `WikiPage` exactly as in spec §9:

```prisma
  principleTier             String?
  principleDirection        String?   @db.Text
  principleWeight           Float?
  principleWeightRationale  String?   @db.Text
  principleDimensionVector  Json?
  principleDimensions       String[]  @default([])
  principleAppliesTo        String[]  @default([])
  principlePublic           Boolean   @default(false)
  principlePublicRationale  String?   @db.Text

  @@index([principleTier])
  @@index([principlePublic])
```

- [ ] **Generate migration:** `pnpm --filter @dpf/db exec prisma migrate dev --name add-principle-fields-to-wikipage --create-only`. Inspect the generated SQL — should be additive `ALTER TABLE WikiPage ADD COLUMN ...` only, no destructive changes.
- [ ] **Add the kernel slug uniqueness guard in the same migration:** hand-edit the migration to create a partial unique index for kernel rows, because `@@unique([organizationId, slug])` does not prevent duplicate `slug` values when `organizationId IS NULL`.

```sql
CREATE UNIQUE INDEX IF NOT EXISTS "WikiPage_kernel_slug_key"
  ON "WikiPage"("slug")
  WHERE "organizationId" IS NULL;
```

- [ ] **Add a regression test** that proves two kernel rows with the same slug cannot both be inserted, while an org overlay with the same slug remains legal. This closes a wiki-platform correctness gap discovered during review; it is not principle-specific.
- [ ] **Apply migration:** `pnpm --filter @dpf/db exec prisma migrate dev`.
- [ ] **Regenerate Prisma client:** `pnpm --filter @dpf/db exec prisma generate`.
- [ ] **Run test, verify it passes.**
- [ ] **Run full DB workspace tests:** `pnpm --filter @dpf/db exec vitest run` — all green.
- [ ] **Commit:** `feat(db): add principle-only fields to WikiPage schema` with the migration in the same commit (per `feedback_db_seed_migration_sync.md`).

### Task 0.4: Principle-aware CRUD in `wiki-store.ts`

**Files:**
- Modify: `packages/db/src/wiki-store.ts`
- Modify: `packages/db/src/wiki-store.test.ts`

- [ ] **Write failing tests:** `upsertWikiPage` accepts a `PrincipleUpsertInput` extension; `getWikiPage` returns principle fields when present; `listWikiPagesByKind("principle")` works; passing `pageKind: "principle"` with `principleTier: "commandment"` but missing `principleDirection` should still succeed at the DB layer (validation lives in lint, not the store).
- [ ] **Run tests, verify they fail.**
- [ ] **Implement** the type extension and ensure `upsertWikiPage` / `getWikiPage` pass through the new fields. Add a helper `listPrinciplesByTier(tier, options?)` that filters `pageKind="principle" AND status="published"` and orders by `principleTier` then `title`.
- [ ] **Run tests, verify they pass.**
- [ ] **Commit:** `feat(db): principle-aware CRUD in wiki-store`.

### Task 0.5: Seed parsing for principle frontmatter

**Files:**
- Modify: `packages/db/src/seed-wiki-kernel.ts`
- Modify: `packages/db/src/seed-wiki-kernel.test.ts`

- [ ] **Refactor for testability if needed:** keep the production default pointed at `docs/founder-kernel`, but allow seed parsing tests to pass a temporary kernel directory or fixture string. Do not create a new ad hoc `__fixtures__` convention unless the package already establishes it.
- [ ] **Write fixture markdown** matching the principle template (frontmatter has `pageKind: principle`, `principleTier: commandment`, `principleDirection:`, `principleDimensionVector:` block, `principleAppliesTo:` list, `principlePublic: false`). Do not introduce new short aliases. If legacy authoring docs already contain shorter aliases (`tier`, `direction`, `dimensionVector`, `appliesTo`, `public`), map them explicitly to these canonical DB fields in one parser function and test both forms as compatibility only.
- [ ] **Write failing test:** `seedWikiKernel` reads the fixture, calls `upsertWikiPage`, the resulting row has the correct `principleTier`, `principleDirection`, `principleDimensionVector` (parsed JSON), `principleDimensions` (derived from vector keys), `principleAppliesTo`.
- [ ] **Run test, verify it fails.**
- [ ] **Extend the seed walker** to handle the `principle` kind: parse the new frontmatter keys, validate dimension keys against `PRINCIPLE_DIMENSIONS`, validate `principleTier` and `principleAppliesTo` against their constants, derive `principleDimensions` from `Object.keys(principleDimensionVector)`, refuse to seed (throw with a clear message) if a dimension is unknown - per `feedback_check_tool_signals.md`, a silent skip on bad frontmatter is the failure mode to avoid.
- [ ] **Run test, verify it passes.**
- [ ] **Add a second test for unknown-dimension rejection:** fixture with `principleDimensionVector.fictional_axis: 1.0`. Seeder must throw an error mentioning `fictional_axis` and the allowed dimensions list.
- [ ] **Run test, verify it passes.**
- [ ] **Commit:** `feat(db): parse principle frontmatter in seedWikiKernel`.

### Task 0.6: Qdrant payload extension

**Files:**
- Modify: `apps/web/lib/wiki/embeddings.ts` (the `searchWikiPages` signature stays in Phase 0 - only the payload write path changes for principles)
- Modify: `apps/web/lib/wiki/embeddings.test.ts`

- [ ] **Write failing test:** when a principle page is upserted to Qdrant, its payload includes `principleTier`, `principleAppliesTo`, `principleDimensions`, and `principlePublic`. Non-principle pages do NOT carry those keys at all (absence, not `false` or `null`) - this avoids a backfill of every existing Qdrant payload and keeps the write path purely additive.
- [ ] **Run test, verify it fails.**
- [ ] **Modify the Qdrant write helper** in `embeddings.ts` to include the canonical `principle*` payload keys only when `pageKind === "principle"`. Other page kinds have their existing payload unchanged. No `isPrinciple` or `principleOnly` flag - filters check for `pageKind === "principle"` directly.
- [ ] **Run test, verify it passes.**
- [ ] **Commit:** `feat(wiki): add principle-only Qdrant payload keys`.

### Task 0.7a: UI — `WikiPageKindBadge` for the principle kind

**Files:**
- Modify: `apps/web/components/wiki/WikiPageKindBadge.tsx`
- Modify (or create): adjacent `.test.tsx`

- [ ] **Write failing test:** rendering with `pageKind="principle"` produces a badge labeled "Principle" using the existing badge density and DPF theme tokens (`bg-[var(--dpf-surface-2)]`, `text-[var(--dpf-muted)]` or another approved token consistent with nearby badges, `border-[var(--dpf-border)]`) - no hardcoded colors per `AGENTS.md` section 12.
- [ ] **Run test, verify it fails.**
- [ ] **Implement** the badge case for `principle`. Keep the props API unchanged.
- [ ] **Run test, verify it passes.**
- [ ] **Commit:** `feat(wiki-ui): render principle kind in WikiPageKindBadge`.

### Task 0.7b: UI — `WikiPageList` tier grouping when filtered to principles

**Files:**
- Modify: `apps/web/components/wiki/WikiPageList.tsx`
- Modify (or create): adjacent `.test.tsx`

- [ ] **Write failing test:** when the `kind="principle"` filter is applied, results are grouped by tier in the order Commandments, Core, Contextual, each group labeled with the tier name.
- [ ] **Run test, verify it fails.**
- [ ] **Implement** the grouping logic in `WikiPageList`. Use only theme tokens; long titles must wrap without resizing adjacent rows (per spec §13.1).
- [ ] **Run test, verify it passes.**
- [ ] **Commit:** `feat(wiki-ui): tier-group WikiPageList when filtered to principles`.

### Task 0.8: UI — `WikiPageViewer` principle metadata panel

**Files:**
- Modify: `apps/web/components/wiki/WikiPageViewer.tsx`
- Modify (or create): adjacent `.test.tsx`

- [ ] **Write failing test:** viewer for a principle page shows tier badge, applies-to chips, weight (defaulted from tier if `principleWeight` is null), source count, and a dimension-vector table. Public principles also show a `Public` badge; internal-only principles show `Internal`. All theme-tokenized.
- [ ] **Run test, verify it fails.**
- [ ] **Implement** the metadata block. Keep the body markdown render path unchanged.
- [ ] **Run test, verify it passes.**
- [ ] **Commit:** `feat(wiki-ui): render principle metadata in WikiPageViewer`.

### Task 0.9: Update `SCHEMA.md` and `AUTHORING.md`

**Files:**
- Modify: `docs/founder-kernel/SCHEMA.md:13` (page-kind contract section)
- Modify: `docs/founder-kernel/AUTHORING.md:41` (seed-walker folders + per-kind authoring rules)
- Modify: `docs/founder-kernel/manifest.json` (bump schema version)
- Create: `docs/founder-kernel/_templates/principle.template.md`
- Create: `docs/founder-kernel/wiki/principles/.gitkeep`

- [ ] **Add `principle` to `SCHEMA.md`** under page kinds with the required-sections contract from spec §7.2 (Rule / Why / Applies To / How To Apply / Decision Dimensions / Examples / Sources). Note tier semantics, weight defaults, and that direction + dimension vector are required for commandment/core.
- [ ] **Add `wiki/principles/` to the `AUTHORING.md` folder walker list** with a one-paragraph "principle authoring" subsection: frontmatter shape, public/internal classification, source-citation requirement (at least one `RawSource`).
- [ ] **Bump `manifest.json` schema version** (likely a minor bump — additive new kind).
- [ ] **Create the principle template** at `docs/founder-kernel/_templates/principle.template.md` with frontmatter placeholders for every principle-only field, and a body skeleton with the seven required sections.
- [ ] **Create empty `wiki/principles/.gitkeep`** so the folder lands in git.
- [ ] **Verify the manifest version + schema doc + template stay in sync:** add a small assertion in `seed-wiki-kernel.test.ts` that the template file exists and that `manifest.schemaVersion` matches the version listed at the top of `SCHEMA.md`. Run the test.
- [ ] **Commit:** `docs(founder-kernel): add principle kind to schema, authoring, template`.

### Phase 0 Verification

Run on the principles-spec worktree before opening the PR:

```powershell
pnpm --filter @dpf/db exec vitest run src/wiki-store.test.ts src/seed-wiki-kernel.test.ts src/wiki-taxonomy.test.ts
pnpm --filter web exec vitest run lib/wiki/embeddings.test.ts components/wiki
pnpm --filter web typecheck
pnpm --filter web build
pnpm --filter @dpf/db exec prisma migrate status
```

**UX verification:** rebuild the portal container, seed the kernel with the fixture principle page, visit `/wiki?kind=principle`, confirm the badge and grouped list render correctly in light + dark mode. Open the detail page, confirm metadata panel.

**Exit criteria:**
- Migration applies cleanly on a fresh DB.
- `WikiPage.pageKind = "principle"` round-trips through `wiki-store`, the seed walker, Qdrant payload writes, and the viewer.
- `SCHEMA.md`, `AUTHORING.md`, and the template are consistent.
- No principle content shipped yet — only one fixture used in tests.
- All Phase 0 tests + the full web workspace typecheck + build pass.

**PR:** open against `main`, title `feat(principles): batch 0 — schema, constants, authoring contract`. Per `feedback_no_manual_prs.md`, this work is governance/platform infrastructure (schema + constants + lint substrate), not customer-facing feature delivery — Claude opens these PRs directly. Build Studio is not the intake for principle-system phases. The same direct-PR posture applies to all subsequent phases of this plan.

---

## Phase 1 — Principle Lint and Public Safety

**Branch:** `feat/principles-batch-1-lint`

**Objective:** Land the twelve lint detectors from spec §14 with severity gating, plus the public-safety detector that blocks internal markers from leaking. Extend the admin lint UI so principle findings are filterable. No retrieval or MCP work yet.

**Files to create:**

- `apps/web/lib/wiki/lint/principle-detectors.ts`
- `apps/web/lib/wiki/lint/principle-detectors.test.ts`
- `apps/web/lib/wiki/lint/principle-public-safety.ts`
- `apps/web/lib/wiki/lint/principle-public-safety.test.ts`
- `apps/web/lib/wiki/lint/__fixtures__/principle-valid-commandment.md`
- `apps/web/lib/wiki/lint/__fixtures__/principle-missing-direction.md`
- `apps/web/lib/wiki/lint/__fixtures__/principle-unsafe-public.md`
- `apps/web/lib/wiki/lint/__fixtures__/principle-cap-exceeded/...` (eleven valid commandment fixtures)

**Files to modify:**

- `apps/web/lib/wiki/lint/index.ts` (register principle detectors with the orchestrator)
- `apps/web/lib/wiki/lint/index.test.ts`
- `apps/web/app/(shell)/admin/wiki/lint/page.tsx` (add tier/findingKind filter chips for principles)
- `apps/web/app/(shell)/admin/wiki/lint/page.test.tsx` (or new component test)

### Task 1.1a: Implement `principle-missing-tier`

**Files:**
- Create: `apps/web/lib/wiki/lint/principle-detectors.ts`
- Create: `apps/web/lib/wiki/lint/principle-detectors.test.ts`

- [ ] **Write failing test:** a principle page with `principleTier = null` produces a finding with `findingKind = "principle-missing-tier"`, `severity = "error"`, `blocksPublish = true`.
- [ ] **Run test, verify it fails.**
- [ ] **Implement** the detector with shared types pulled from `wiki-taxonomy.ts` constants.
- [ ] **Run test, verify it passes.**
- [ ] **Commit:** `feat(wiki-lint): principle-missing-tier detector`.

### Task 1.1b: Implement `principle-missing-applies-to`

**Files:**
- Modify: `apps/web/lib/wiki/lint/principle-detectors.ts`
- Modify: `apps/web/lib/wiki/lint/principle-detectors.test.ts`

- [ ] **Write failing test:** a principle page with empty `principleAppliesTo` produces a finding with `findingKind = "principle-missing-applies-to"`, `severity = "error"`, `blocksPublish = true`.
- [ ] **Run test, verify it fails.**
- [ ] **Implement** the detector in the same module.
- [ ] **Run test, verify it passes.**
- [ ] **Commit:** `feat(wiki-lint): principle-missing-applies-to detector`.

### Task 1.2: Implement `principle-missing-direction` (severity by tier)

- [ ] **Write failing test:** commandment principle without `principleDirection` → severity `error`, blocks publish. Core principle without direction → severity `error`, blocks publish. Contextual principle without direction → severity `warn`, does not block.
- [ ] **Run test, verify it fails.**
- [ ] **Implement** the detector with tier-gated severity. Reuse the `PRINCIPLE_TIERS` constant.
- [ ] **Run test, verify it passes.**
- [ ] **Commit:** `feat(wiki-lint): principle-missing-direction detector with tier-gated severity`.

### Task 1.3: Implement `principle-missing-vector` and `principle-vector-dimension-mismatch`

- [ ] **Write failing test:** commandment with empty `principleDimensionVector` → `error`, blocks. Core with empty vector → `warn`, does not block. Vector keys that don't match `principleDimensions` array → `principle-vector-dimension-mismatch`, `warn`, does not block.
- [ ] **Run test, verify it fails.**
- [ ] **Implement** both detectors.
- [ ] **Run test, verify it passes.**
- [ ] **Commit:** `feat(wiki-lint): principle dimension vector consistency detectors`.

### Task 1.4: Implement `principle-unknown-dimension`

- [ ] **Write failing test:** a principle whose `principleDimensions` or `principleDimensionVector` keys contain an out-of-registry value → `error`, blocks publish.
- [ ] **Run test, verify it fails.**
- [ ] **Implement** the detector using `PRINCIPLE_DIMENSIONS` as the allowlist.
- [ ] **Run test, verify it passes.**
- [ ] **Commit:** `feat(wiki-lint): principle-unknown-dimension detector`.

### Task 1.5: Implement `principle-tier-weight-mismatch`

- [ ] **Write failing test:** a principle whose `principleWeight` differs from `PRINCIPLE_TIER_DEFAULT_WEIGHT[tier]` with no `principleWeightRationale` → `warn`, does not block. Same divergence with rationale present → no finding.
- [ ] **Run test, verify it fails.**
- [ ] **Implement** the detector.
- [ ] **Run test, verify it passes.**
- [ ] **Commit:** `feat(wiki-lint): principle-tier-weight-mismatch detector`.

### Task 1.6: Implement `principle-commandment-cap-exceeded`

- [ ] **Write failing test:** seed 11 published kernel commandments, run lint orchestrator, expect a `principle-commandment-cap-exceeded` finding with `severity = "error"`, `blocksPublish = true`, attached to the 11th commandment by `lastReviewedAt` order.
- [ ] **Run test, verify it fails.**
- [ ] **Implement** the detector as a cross-page check inside the orchestrator (each individual page detector is local; this one needs the full set). Reuse `PRINCIPLE_TIER_CAPS.commandment`.
- [ ] **Run test, verify it passes.**
- [ ] **Commit:** `feat(wiki-lint): principle-commandment-cap-exceeded cross-page detector`.

### Task 1.7: Implement `principle-public-missing-rationale` and the public-safety detector

**Files:**
- Create: `apps/web/lib/wiki/lint/principle-public-safety.ts`
- Create: `apps/web/lib/wiki/lint/principle-public-safety.test.ts`

The public-safety detector is the highest-risk lint in this batch. Scope is *internal-leakage signals*, not personal-name censorship. Founder biographical references like "DPF was founded by Mark Bodman" are product-facing per spec §13.4 and must NOT be blocked. It must catch:

- references to local user paths (`C:\Users\...`, `/home/...`, `/Users/...`)
- raw memory file paths (`feedback_*.md`, `project_*.md`, `MEMORY.md` filename references)
- private tokens or secrets (heuristic — strings matching `sk-[A-Za-z0-9]{16,}`, `ghp_[A-Za-z0-9]{20,}`, `dpf_pat_[A-Za-z0-9_-]{16,}`, generic `[A-Za-z0-9_-]{32,}` adjacent to "token" / "key")
- internal-only agent-instruction phrases (literal string matches against a small allowlist: `Drive 100% means don't ask`, `Claude Code`, `Codex CLI`, `<internal-only>` markers) — narrative references to "Claude", "Codex", or "Mark" as people/products are allowed
- unreleased PR claims (`PR #N` where `N` exceeds the highest merged PR number known at lint time, fetched once at orchestrator start — surface as `warn`, not `error`)

- [ ] **Write failing tests** (one per category) using fixtures: each fixture is a principle page body that violates one rule. Lint output must include the matching marker and reason.
- [ ] **Run tests, verify they fail.**
- [ ] **Implement** the detector with regex-based matchers plus a small allowlist (e.g., "Codex" inside a code block fence is allowed since that's reference material; in narrative prose it's flagged).
- [ ] **Run tests, verify they pass.**
- [ ] **Write failing test for `principle-public-missing-rationale`:** `principlePublic = true` AND `principlePublicRationale IS NULL` → `warn`, does not block.
- [ ] **Run test, verify it fails.**
- [ ] **Implement** the rationale detector (one line — colocate in the same file).
- [ ] **Run test, verify it passes.**
- [ ] **Commit:** `feat(wiki-lint): principle public-safety + public-rationale detectors`.

### Task 1.8: Implement `principle-duplicate` and `principle-contradiction-review`

These both require embedding similarity. They piggyback on the existing Qdrant payloads from Phase 0.

- [ ] **Write failing test for `principle-duplicate`:** seed two principles whose `principleDirection` embeddings cosine > 0.9 and titles share ≥3 stemmed words. Expect a `principle-duplicate` finding on the newer page, `warn`, does not block.
- [ ] **Run test, verify it fails.**
- [ ] **Implement** using `searchWikiPages` with `pageKind: "principle"` and a high `scoreThreshold`, plus a small lexical-overlap check on titles.
- [ ] **Run test, verify it passes.**
- [ ] **Write failing test for `principle-contradiction-review`:** seed two principles with overlapping dimension keys but opposing signs (e.g., one favors `speed_to_value: +1`, another favors `speed_to_value: -1`) AND direction embeddings cosine > 0.75. Expect a `principle-contradiction-review` finding on both pages, `warn`, does not block.
- [ ] **Run test, verify it fails.**
- [ ] **Implement** using vector-difference comparison on the shared dimension keys plus the embedding similarity check.
- [ ] **Run test, verify it passes.**
- [ ] **Commit:** `feat(wiki-lint): principle-duplicate and principle-contradiction-review detectors`.

### Task 1.9: Register principle detectors with the lint orchestrator

**Files:**
- Modify: `apps/web/lib/wiki/lint/index.ts`
- Modify: `apps/web/lib/wiki/lint/index.test.ts`

- [ ] **Write failing test:** running the orchestrator over a corpus that includes a principle page invokes every principle detector exactly once per page (or once across the corpus for cross-page detectors).
- [ ] **Run test, verify it fails.**
- [ ] **Register** the new detectors in the orchestrator's detector list. Cross-page detectors get a different hook than per-page ones — follow the existing pattern from `kernel-drift` or similar.
- [ ] **Run test, verify it passes.**
- [ ] **Run the scheduled-job test** to confirm Inngest scheduling still works.
- [ ] **Commit:** `feat(wiki-lint): register principle detectors with orchestrator`.

### Task 1.10: Admin lint UI — principle filter chips

**Files:**
- Modify: `apps/web/app/(shell)/admin/wiki/lint/page.tsx`
- Modify: `apps/web/app/(shell)/admin/wiki/lint/page.test.tsx` (or component-level test)

- [ ] **Write failing test** at `apps/web/app/(shell)/admin/wiki/lint/page.test.tsx` (target invocation: `pnpm --filter web exec vitest run "app/(shell)/admin/wiki/lint/page.test.tsx"` — note the quotes are required so PowerShell does not glob the parentheses): the admin lint page accepts a `?findingKind=principle-*` URL param and filters findings accordingly; a "Principles" filter chip group is shown with chip per principle finding kind.
- [ ] **Run test, verify it fails.**
- [ ] **Implement** the filter chips using DPF theme tokens. Long finding-kind names must wrap.
- [ ] **Run test, verify it passes.**
- [ ] **Commit:** `feat(admin-wiki-lint): principle finding filter chips`.

### Phase 1 Verification

```powershell
pnpm --filter web exec vitest run lib/wiki/lint
pnpm --filter web exec vitest run app/admin/wiki/lint
pnpm --filter web typecheck
pnpm --filter web build
```

**UX verification:** seed a deliberately-broken principle page (missing tier), open `/admin/wiki/lint`, confirm the finding appears, click the principle filter chip, confirm the list narrows.

**Exit criteria:**
- All twelve detectors from spec §14 are implemented, tested, and registered.
- Commandment-cap detector is the only cross-page detector and is correctly invoked once per orchestrator run.
- Public-safety detector blocks publish for internal-marker leaks.
- Admin UI exposes per-finding-kind filter.

**PR:** title `feat(principles): batch 1 — lint detectors and public safety`.

---

## Phase 2 — Retrieval and MCP Tools

**Branch:** `feat/principles-batch-2-retrieval-mcp`

**Objective:** Extend retrieval so principles are surfaced to in-platform coworkers via passive recall, to in-portal and external agents via `wiki_query` filters, and to anyone via the new `principle_decide` advisory tool. The decision math from spec §11 lands here.

**Files to create:**

- `apps/web/lib/wiki/principle-recall.ts`
- `apps/web/lib/wiki/principle-recall.test.ts`
- `apps/web/lib/wiki/principle-search.ts`
- `apps/web/lib/wiki/principle-search.test.ts`
- `apps/web/lib/wiki/principle-decide.ts`
- `apps/web/lib/wiki/principle-decide.test.ts`
- `apps/web/lib/mcp-tools-wiki-query.test.ts` (if not present)
- `apps/web/lib/mcp-tools-principle-decide.test.ts`

**Files to modify:**

- `apps/web/lib/wiki/embeddings.ts:56` (extend `searchWikiPages` with `principleTier`, `principleAppliesTo`, and `principlePublic` payload filters)
- `apps/web/lib/wiki/embeddings.test.ts`
- `apps/web/lib/wiki/recall.ts:70` (orchestrate the new principle-recall alongside the existing single-search path; principle recall is in addition to existing recall, not a replacement)
- `apps/web/lib/wiki/recall.test.ts`
- `apps/web/lib/mcp-tools.ts:1971` (extend `wiki_query` input schema; new `principle_decide` tool)
- `apps/web/lib/mcp-tools.ts:8431` (extend `wiki_query` handler)
- `apps/web/lib/tak/agent-grants.ts:67` (map `principle_decide` to `registry_read`)
- `apps/web/app/api/mcp/v1/route.ts:167` (no code change expected; verify tools/list exposes the new tools for `registry_read` tokens via test)

### Task 2.1: Extend `searchWikiPages` with canonical principle filters

**Files:**
- Modify: `apps/web/lib/wiki/embeddings.ts`
- Modify: `apps/web/lib/wiki/embeddings.test.ts`

- [ ] **Write failing test:** `searchWikiPages({ query, pageKind: "principle", principleTier: "commandment", principleAppliesTo: "external_coding_agent", principlePublic: true })` returns only matching principles; `principleAppliesTo` filter respects array containment.
- [ ] **Run test, verify it fails.**
- [ ] **Extend** `searchWikiPages` to accept optional `principleTier`, `principleAppliesTo`, and `principlePublic` filter args. Translate to Qdrant filter clauses against the canonical payload keys added in Phase 0 (Task 0.6). Keep the existing API stable - all args are optional.
- [ ] **Run test, verify it passes.**
- [ ] **Commit:** `feat(wiki): principle filters in searchWikiPages`.

### Task 2.2: Implement `recallPrincipleContext`

**Files:**
- Create: `apps/web/lib/wiki/principle-recall.ts`
- Create: `apps/web/lib/wiki/principle-recall.test.ts`

The spec §12.1 contract: always inject in-scope commandments (cap 10) from Postgres, then top-N relevant core principles from Qdrant (default N=5), then contextual principles only above `contextualSimilarityThreshold` (default 0.75). Format principles separately from ordinary wiki context so the prompt assembler can distinguish governance from background.

- [ ] **Write failing test for the commandment branch:** when Postgres holds 3 published commandments matching `appliesTo`, `recallPrincipleContext` returns all 3 even if Qdrant is unreachable. Stub Qdrant to throw; commandments still come back.
- [ ] **Run test, verify it fails.**
- [ ] **Implement** the Postgres-first branch using `listPrinciplesByTier("commandment")` from Task 0.4. Filter by `principleAppliesTo` array containment via the helper.
- [ ] **Run test, verify it passes.**
- [ ] **Write failing test for the Qdrant-relevance branch:** seed 6 core principles, query with a context string that semantically matches 2 of them above the relevance threshold, assert top-2 returned.
- [ ] **Run test, verify it fails.**
- [ ] **Implement** the Qdrant relevance branch using `searchWikiPages` with `pageKind: "principle"`, `principleTier: "core"`, top-K=5.
- [ ] **Run test, verify it passes.**
- [ ] **Write failing test for the contextual threshold:** seed 3 contextual principles, query with a string that matches one above 0.75 and two below; assert only the above-threshold one is returned.
- [ ] **Run test, verify it fails.**
- [ ] **Implement** the threshold gate with `scoreThreshold: contextualSimilarityThreshold`.
- [ ] **Run test, verify it passes.**
- [ ] **Write failing test for the formatting contract:** the returned context block uses a distinct header (e.g. `## Governance Principles`) so the prompt assembler can split it from background context.
- [ ] **Run test, verify it fails.**
- [ ] **Implement** the formatter, then add a tiny snapshot test.
- [ ] **Run test, verify it passes.**
- [ ] **Commit:** `feat(wiki): recallPrincipleContext with tiered Postgres + Qdrant strategy`.

### Task 2.3: Wire principle recall into the existing prompt assembler

**Files:**
- Modify: `apps/web/lib/wiki/recall.ts:70`
- Modify: `apps/web/lib/wiki/recall.test.ts`

- [ ] **Write failing test:** the existing `recallWikiContext` invocation now also returns a `principleContext` block (or appends to the existing returned shape with a labeled section). Existing consumers see no regression in the non-principle context block.
- [ ] **Run test, verify it fails.**
- [ ] **Modify** `recallWikiContext` to invoke `recallPrincipleContext` in parallel with its existing search, merge results into the returned shape. If `callingPopulation` is not provided, default to `human` (safest) and skip Postgres-first commandments — they only inject when scope matches.
- [ ] **Run test, verify it passes.**
- [ ] **Commit:** `feat(wiki): wire recallPrincipleContext into recallWikiContext`.

### Task 2.4: Extend `wiki_query` MCP schema and handler

**Files:**
- Modify: `apps/web/lib/mcp-tools.ts:1971` (input schema)
- Modify: `apps/web/lib/mcp-tools.ts:8431` (handler)
- Create: `apps/web/lib/mcp-tools-wiki-query.test.ts`

- [ ] **Write failing test:** `wiki_query` called with `{ query, pageKind: "principle", tier: "commandment", appliesTo: "external_coding_agent", publicOnly: true, limit: 5 }` returns matching principle pages with full principle metadata (`principleTier`, `principleDirection`, `principleDimensions`, `principleAppliesTo`, `principlePublic`) in the structured content.
- [ ] **Run test, verify it fails.**
- [ ] **Extend** the public MCP input schema with the ergonomic optional fields (`tier`, `appliesTo`, `publicOnly`). Update the handler to translate them to `searchWikiPages` canonical args (`principleTier`, `principleAppliesTo`, `principlePublic`). For `pageKind: "principle"`, the response shape includes canonical principle metadata; for other kinds, the shape is unchanged.
- [ ] **Run test, verify it passes.**
- [ ] **Write failing test for backwards compat:** existing `wiki_query` calls without the new fields return the same shape they did before Phase 2.
- [ ] **Run test, verify it passes.**
- [ ] **Commit:** `feat(mcp): wiki_query principle filters and metadata`.

### Task 2.5a: Implement `computeStructuredAlignment`

**Files:**
- Create: `apps/web/lib/wiki/principle-decide.ts`
- Create: `apps/web/lib/wiki/principle-decide.test.ts`

The math contract is in spec §11.2 and the worked example is in §11.4.

- [ ] **Write failing test:** given a principle with `principleDimensionVector = { long_term_maintainability: 1.0, schema_grounding: 0.8, speed_to_value: -0.4 }` and an option with `features = { long_term_maintainability: 0.9, schema_grounding: 0.8, speed_to_value: 0.3 }`, alignment = `((0.9*1.0) + (0.8*0.8) + (0.3*-0.4)) / (|1.0|+|0.8|+|-0.4|) = 1.42 / 2.2 ≈ 0.645`.
- [ ] **Run test, verify it fails.**
- [ ] **Implement** `computeStructuredAlignment(option, principle)` returning the normalized dot product. Skip missing dimensions (treat as 0 on the option side) but track which dimensions were present so the caller can surface coverage warnings.
- [ ] **Run test, verify it passes.**
- [ ] **Commit:** `feat(wiki): computeStructuredAlignment for principle_decide`.

### Task 2.5b: Implement `computeSemanticAlignment` fallback

**Files:**
- Modify: `apps/web/lib/wiki/principle-decide.ts`
- Modify: `apps/web/lib/wiki/principle-decide.test.ts`

- [ ] **Write failing test:** a principle with empty `principleDimensionVector` and a query option falls back to embedding cosine. Use a deterministic stub embedding model so the test is reproducible.
- [ ] **Run test, verify it fails.**
- [ ] **Implement** `computeSemanticAlignment(option, principle)` using the existing embedding helper. Mark the contribution as `mode: "semantic"`.
- [ ] **Run test, verify it passes.**
- [ ] **Commit:** `feat(wiki): computeSemanticAlignment fallback for principle_decide`.

### Task 2.5c: Implement composite score and argmax

**Files:**
- Modify: `apps/web/lib/wiki/principle-decide.ts`
- Modify: `apps/web/lib/wiki/principle-decide.test.ts`

- [ ] **Write failing test:** four principles (two commandments at weight 1.0, one core at 0.4, one contextual at 0.1) and two options, composite score sums correctly per spec §11.4 worked example. Argmax picks the higher composite.
- [ ] **Run test, verify it fails.**
- [ ] **Implement** `computeComposite(options, principles)` and `pickRecommendation(composites, tieMargin)`.
- [ ] **Run test, verify it passes.**
- [ ] **Commit:** `feat(wiki): composite score + argmax for principle_decide`.

### Task 2.5d: Assemble the contribution ledger

**Files:**
- Modify: `apps/web/lib/wiki/principle-decide.ts`
- Modify: `apps/web/lib/wiki/principle-decide.test.ts`

- [ ] **Write failing test:** the returned shape includes one entry per principle (id, name, tier, weight, mode: structured | semantic, alignmentByOption, contributionByOption, missingDimensions). Sum of contributions per option equals composite.
- [ ] **Run test, verify it fails.**
- [ ] **Implement** the ledger assembly.
- [ ] **Run test, verify it passes.**
- [ ] **Commit:** `feat(wiki): contribution ledger assembly for principle_decide`.

### Task 2.6: Guardrails — tie-margin, commandment-conflict, semantic-fallback warnings

**Files:**
- Modify: `apps/web/lib/wiki/principle-decide.ts`
- Modify: `apps/web/lib/wiki/principle-decide.test.ts`

- [ ] **Write failing test:** when `recommendation.margin < tieMargin`, `confidence` is `"low"` and the reasoning string explicitly recommends human review.
- [ ] **Run test, verify it fails.**
- [ ] **Implement** the tie-margin path.
- [ ] **Run test, verify it passes.**
- [ ] **Write failing test:** when a commandment principle has a strong negative contribution toward the top option (e.g., `-0.5` or worse), `commandmentConflict = true` and the principle's id is named.
- [ ] **Run test, verify it fails.**
- [ ] **Implement** the commandment-conflict flag.
- [ ] **Run test, verify it passes.**
- [ ] **Write failing test:** when more than 40% of contributions are semantic (no structured features available), `structuredCoverage = "weak"`.
- [ ] **Run test, verify it fails.**
- [ ] **Implement** the coverage flag using `PRINCIPLE_DECIDE_DEFAULTS.semanticFallbackWarnRatio`.
- [ ] **Run test, verify it passes.**
- [ ] **Write failing test:** when no applicable principles match (empty retrieval), return `recommendation: null`, `confidence: "low"`, and a clear reasoning string.
- [ ] **Run test, verify it fails.**
- [ ] **Implement** the empty-set path.
- [ ] **Run test, verify it passes.**
- [ ] **Commit:** `feat(wiki): principle_decide guardrails — tie-margin, commandment-conflict, coverage`.

### Task 2.7: Register `principle_decide` as an MCP tool

**Files:**
- Modify: `apps/web/lib/mcp-tools.ts` (add tool definition)
- Modify: `apps/web/lib/tak/agent-grants.ts:67` (grant mapping)
- Create: `apps/web/lib/mcp-tools-principle-decide.test.ts`

- [ ] **Write failing test:** `principle_decide` tool exists in `PLATFORM_TOOLS` with `executionMode: "immediate"`, `sideEffect: false`, annotations `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`. Its grant mapping is `registry_read`.
- [ ] **Run test, verify it fails.**
- [ ] **Add the tool definition** with the input schema from spec §11.1 and the output shape from Tasks 2.5–2.6. Description: "Advisory only. Returns a scored recommendation across applicable principles with a contribution ledger. Does not execute the recommended option; the caller retains authority."
- [ ] **Map** the tool to `registry_read` in `agent-grants.ts`.
- [ ] **Run test, verify it passes.**
- [ ] **Write failing test:** `principle_decide` invoked through the in-portal handler returns the contribution ledger shape from Task 2.5. Use a small seeded principle set.
- [ ] **Run test, verify it fails.**
- [ ] **Implement** the handler that calls `principle-decide.ts` and serializes the result.
- [ ] **Run test, verify it passes.**
- [ ] **Commit:** `feat(mcp): principle_decide advisory tool with grant mapping`.

### Task 2.8: External MCP visibility test

**Files:**
- Create or modify: `apps/web/app/api/mcp/v1/route.test.ts` (route-level test)

- [ ] **Write failing test:** issuing a `tools/list` JSON-RPC call against `/api/mcp/v1` with a token whose scope includes `registry_read` returns both the extended `wiki_query` (with new optional fields visible in the input schema) and `principle_decide` in the tools array. A token without `registry_read` does not see them.
- [ ] **Run test, verify it fails** (only because the test is new; the route should already gate by scope).
- [ ] **Verify and patch** any gaps. The expectation per spec §1.1 is that the route already default-denies; this task confirms the new tools are picked up by the existing gating.
- [ ] **Run test, verify it passes.**
- [ ] **Commit:** `test(mcp): external visibility for wiki_query principle filters and principle_decide`.

### Phase 2 Verification

```powershell
pnpm --filter web exec vitest run lib/wiki/embeddings.test.ts lib/wiki/recall.test.ts lib/wiki/principle-recall.test.ts lib/wiki/principle-decide.test.ts lib/mcp-tools-wiki-query.test.ts lib/mcp-tools-principle-decide.test.ts
pnpm --filter web exec vitest run app/api/mcp/v1
pnpm --filter web typecheck
pnpm --filter web build
```

**UX verification:** open a coworker chat, ask a decision-shaped question, confirm the system prompt includes the `## Governance Principles` block from Task 2.2. Call `principle_decide` via the in-portal MCP debugger with two synthetic options and verify the contribution ledger renders end-to-end.

**Exit criteria:**
- `searchWikiPages` accepts canonical `principleTier`, `principleAppliesTo`, and `principlePublic` filters.
- `recallPrincipleContext` returns Postgres-first commandments + Qdrant relevance for core/contextual.
- `wiki_query` MCP accepts the new filters; metadata returned for principles.
- `principle_decide` returns a ledger with structured-vs-semantic flags, tie-margin handling, commandment-conflict flag, coverage flag.
- External MCP tools/list exposes both for `registry_read` tokens.

**PR:** title `feat(principles): batch 2 — retrieval and MCP tools`.

---

## Phase 3 - Seed the First Principle Set

**Branch:** `doc/principles-batch-3-seed-first-set`

**Objective:** Author and seed the first kernel principles. Phase -1 determines the exact count on the implementation base. In the reviewed target checkout, Principle 9 and the capacity-continuity spec are already present, so the expected scope is Principles 1-9. The proposed Proactive Engagement principle is not seeded unless the founder explicitly approves canonical text before this phase starts.

**Pre-check:** before starting, grep the local copy of the AI principles doc for Principle 9 content:

```powershell
Select-String -Path "docs/architecture/ai-coworker-development-principles.md" -Pattern "Principle 9" -Quiet
```

If the result is `True`, scope to Principles 1-9. If `False`, scope to the branch-local principles that exist in the file and update the design spec's current-state table before seeding. Do NOT rely on commit-message grep; PR #489's commit subject is not guaranteed to contain the string "capacity continuity" and could produce a false negative.

**Files to create:**

- `docs/founder-kernel/wiki/principles/specialization-over-generalization.md`
- `docs/founder-kernel/wiki/principles/orchestrator-worker-pattern.md`
- `docs/founder-kernel/wiki/principles/structured-handoffs.md`
- `docs/founder-kernel/wiki/principles/diversity-of-thought.md`
- `docs/founder-kernel/wiki/principles/selective-memory.md`
- `docs/founder-kernel/wiki/principles/tools-must-be-self-documenting.md`
- `docs/founder-kernel/wiki/principles/human-in-the-loop-at-phase-boundaries.md`
- `docs/founder-kernel/wiki/principles/fail-fast-explain-clearly.md`
- (if PR #489 in branch) `docs/founder-kernel/wiki/principles/responsible-capacity-utilization.md`
- (if approved) `docs/founder-kernel/wiki/principles/proactive-engagement.md`
- For each principle, one or more `docs/founder-kernel/raw-sources/...` markdown files where a stable source citation is needed

**Files to modify:**

- `docs/founder-kernel/manifest.json` (page count + source count)
- `docs/architecture/ai-coworker-development-principles.md` — after seeding, replace each section body with a one-line pointer to the wiki kernel page; keep the file as a navigational stub. Do not delete it; some external tools and links rely on it.

### Task 3.1: Author Principle 1 — Specialization Over Generalization

- [ ] **Read** `docs/architecture/ai-coworker-development-principles.md` lines 18–40 for the canonical text.
- [ ] **Write** the kernel page at `docs/founder-kernel/wiki/principles/specialization-over-generalization.md` with frontmatter:
  - `pageKind: principle`
  - `slug: specialization-over-generalization`
  - `title: Specialization Over Generalization`
  - `principleTier: core` (proposed default - finalize during PR review)
  - `principleDirection: Prefer specialist agents with focused tool sets over generalists with broad surfaces.`
  - `principleDimensionVector: { reusability: 0.6, blast_radius: 0.4, human_cognitive_load: -0.3 }` (proposed - finalize during PR review)
  - `principleAppliesTo: [in_platform_coworker]`
  - `principlePublic: true`
  - `principlePublicRationale: Documents DPF's agentic architecture posture for adopters and contributors.`
- [ ] **Author the body** using the required-sections contract from spec §7.2. Source-cite the architecture principles doc itself plus any external research cited in the original (likely Anthropic's "Building Effective Agents" or similar).
- [ ] **Create RawSource markdown** at `docs/founder-kernel/raw-sources/anthropic-building-effective-agents.md` if not already present, with locator + abstract.
- [ ] **Run seed** locally through the package script: `pnpm --filter @dpf/db seed`. Confirm `AUTHORING.md` names the same entry point after Phase 0 updates.
- [ ] **Run lint tests and portal lint check:** `pnpm --filter web exec vitest run lib/wiki/lint`, then open `/admin/wiki/lint` in the rebuilt portal and expect zero principle-related findings on this page.
- [ ] **Commit:** `doc(principles): author Principle 1 — Specialization Over Generalization`.

### Task 3.2 through Task 3.8 — repeat the same shape for Principles 2–8

For each of the remaining branch-local principles:

- Source markdown from `docs/architecture/ai-coworker-development-principles.md` at the documented line ranges
- Author kernel page with proposed `principleTier` + `principleDirection` + `principleDimensionVector` + `principleAppliesTo`
- Create or cite RawSources as needed
- Run seed
- Run lint
- Commit individually so review can focus on one principle at a time

Per-principle proposed tier (subject to PR review):

- Principle 2 — Orchestrator-Worker Pattern → core
- Principle 3 — Structured Handoffs → core
- Principle 4 — Diversity of Thought → core
- Principle 5 — Selective Memory → core
- Principle 6 — Tools Self-Documenting → core
- Principle 7 — Human-in-the-Loop at Phase Boundaries → commandment (high consequence; non-negotiable)
- Principle 8 — Fail Fast, Explain Clearly → core

### Task 3.9 (conditional): Principle 9 — Responsible Capacity Utilization

Only if the Phase 3 pre-check (`Select-String` for "Principle 9" in `docs/architecture/ai-coworker-development-principles.md`) returned `True`.

- [ ] **Source** the canonical text from the rebased copy of `docs/architecture/ai-coworker-development-principles.md`.
- [ ] **Author** the kernel page with `principleTier: core`, `principleDimensionVector: { capacity_utilization: 1.0, governance_compliance: 0.7, human_cognitive_load: -0.2 }`, `principleAppliesTo: [in_platform_coworker, external_coding_agent]`, `principlePublic: true`.
- [ ] **Commit:** `doc(principles): author Principle 9 — Responsible Capacity Utilization`.

### Task 3.10 (conditional): Proactive Engagement principle

If the founder approves the Proactive Engagement principle (currently a conversation artifact, not committed text yet), author it the same way with `principleTier: core`, `principleDimensionVector: { human_cognitive_load: -0.5, evidence_density: 0.5, blast_radius: 0.3 }`, `principleAppliesTo: [in_platform_coworker, external_coding_agent]`. Otherwise defer this principle to Phase 5 or a later iteration.

### Task 3.11: Convert `ai-coworker-development-principles.md` into a stub

**Files:**
- Modify: `docs/architecture/ai-coworker-development-principles.md`

- [ ] **Replace** each principle section body with one line: `> Promoted to the [Founder Kernel](../founder-kernel/wiki/principles/<slug>.md). See the kernel page for the canonical text.`
- [ ] **Keep** the file's intro and Application section since external readers may have bookmarks. Add a banner at the top: "Canonical principle text lives in the founder kernel."
- [ ] **Commit:** `doc(architecture): convert principles doc into kernel-pointer stub`.

### Task 3.12: Update manifest counts

**Files:**
- Modify: `docs/founder-kernel/manifest.json`

- [ ] **Bump** `pageCount` and `sourceCount` to reflect the seeded principles + raw sources.
- [ ] **Commit:** `doc(founder-kernel): bump manifest after Phase 3 seed`.

### Phase 3 Verification

```powershell
pnpm --filter @dpf/db exec vitest run src/seed-wiki-kernel.test.ts
pnpm --filter web exec vitest run lib/wiki/lint lib/wiki/recall.test.ts lib/wiki/principle-recall.test.ts
pnpm --filter web typecheck
pnpm --filter web build
pnpm --filter @dpf/db seed                                        # local seed run
pnpm --filter web exec vitest run lib/wiki/lint                   # local lint test pass
```

**UX verification:** in a freshly-rebuilt portal stack, navigate to `/wiki?kind=principle`, confirm all seeded principles appear grouped by tier. Open each detail page, confirm metadata + body render. Open `/admin/wiki/lint`, confirm zero principle findings.

**Exit criteria:**
- 8 (or 9, or 10) kernel principle pages exist under `docs/founder-kernel/wiki/principles/`.
- All seeded principles pass lint with zero blocking findings.
- `ai-coworker-development-principles.md` is now a stub that points to the kernel.
- Commandment cap is respected: no tier transition crosses 10 commandments.

**PR:** title `doc(principles): batch 3 — seed first principle set`.

---

## Phase 4 — AGENTS.md Governance Pointers

**Branch:** `doc/principles-batch-4-agents-md-pointers`

**Objective:** Selectively promote durable principle prose from `AGENTS.md` into the kernel; replace promoted prose with concise pointers. Keep all operational mechanics (command, branch, verification, worktree, MCP-token, local QA) inline so `AGENTS.md` remains usable for coding agents even when MCP/wiki is unavailable.

**Files to modify:**

- `AGENTS.md` (selective promotion + pointers)
- `docs/founder-kernel/wiki/principles/*.md` (new pages from the promoted prose)
- `docs/founder-kernel/manifest.json` (count bump)

### Task 4.1: Inventory promotable governance in `AGENTS.md`

This task lands as its OWN small PR before Phase 4's main promotion PR opens, so the inventory can be reviewed and revised without coupling to the promotion work. Branch: `doc/principles-batch-4-inventory`. After it merges, return to the main Phase 4 branch (`doc/principles-batch-4-agents-md-pointers`) and proceed with Task 4.2.

- [ ] **Read** `AGENTS.md` end to end. List candidate principles. The audit on 2026-05-12 surfaced ~16 candidates (see spec §1.1 and Appendix A): Never fabricate, Research and use standards, Fix the seed not the runtime, Live state over seed data, Single source of truth, Architecture over shortcuts, Plan before acting on install/seed/template paths, All changes via PR against main, DCO sign-off, Build Gate verification, Backlog lives in PostgreSQL, Theme-aware styling, Research before designing, Design research required, Data Model Stewardship, Principal convergence.
- [ ] **Classify** each candidate as commandment-tier, core-tier, contextual-tier, or "keep inline only" (operational). Commit the inventory as `docs/superpowers/audits/2026-05-12-agents-md-principle-inventory.md`.
- [ ] **Commit and open PR:** `doc(audit): AGENTS.md principle inventory for Batch 4`. Land before Task 4.2.

### Task 4.2: Promote each approved candidate

For each candidate that survives review:

- [ ] **Author** the kernel page at `docs/founder-kernel/wiki/principles/<slug>.md`.
- [ ] **Source-cite** `AGENTS.md` at the section line range plus any external standard the rule traces to.
- [ ] **Run seed + lint** locally.
- [ ] **Replace** the corresponding `AGENTS.md` prose with a one-line pointer: `> Promoted to [<Principle Name>](docs/founder-kernel/wiki/principles/<slug>.md). See the kernel page for rationale.`
- [ ] **Keep operational instructions inline** even when an associated principle is promoted. Example: "DCO sign-off required" — the principle goes to the kernel, but the literal `git commit -s` instruction stays in `AGENTS.md`.
- [ ] **Commit per principle:** `doc(principles): promote <name> from AGENTS.md`.

### Task 4.3: Update `AGENTS.md` preamble

**Files:**
- Modify: `AGENTS.md` (preamble section)

**Gate:** per spec §12.3, this task only runs *after* Phase 2's external MCP visibility test (Task 2.8) has merged and the external `wiki_query` + `principle_decide` tools are confirmed visible to `registry_read` tokens. Adding the pointer before Phase 2 ships would direct agents to a tool they cannot reach.

- [ ] **Verify** Phase 2 has merged by checking `git log origin/main --oneline -- apps/web/lib/wiki/principle-decide.ts` shows the merged commit.
- [ ] **Add a short pointer paragraph** near the top: "For durable DPF governance principles, query `wiki_query` with `pageKind='principle'` when the MCP connector is available. AGENTS.md remains operationally authoritative when MCP is offline."
- [ ] **Verify** the file is still usable as a standalone reference for a coding agent without network access.
- [ ] **Commit:** `doc(agents): add wiki principle discovery pointer`.

### Task 4.4: Bump manifest

- [ ] **Update** `docs/founder-kernel/manifest.json` page count.
- [ ] **Commit:** `doc(founder-kernel): bump manifest after Batch 4 promotion`.

### Phase 4 Verification

```powershell
pnpm --filter @dpf/db exec vitest run src/seed-wiki-kernel.test.ts
pnpm --filter web exec vitest run lib/wiki/lint
pnpm --filter web typecheck
pnpm --filter web build
pnpm --filter @dpf/db seed
pnpm --filter web exec vitest run lib/wiki/lint
```

**UX verification:** confirm `AGENTS.md` still reads end-to-end as a working agent guide (no broken pointer-only sections that leave a coding agent without operational instructions).

**Exit criteria:**
- Only durable governance was promoted; operational mechanics stayed inline.
- Promoted prose in `AGENTS.md` was replaced with concise pointers, not deleted into a void.
- Commandment cap is still ≤10 published commandments.

**PR:** title `doc(principles): batch 4 — AGENTS.md selective governance promotion`.

---

## Phase 5 — Reviewed Memory Promotion

**Branch:** `doc/principles-batch-5-memory-promotion`

**Objective:** Promote durable, reviewed, product-safe memory entries to the kernel. Rewrite — do not bulk-import — so private/local content stays out. Episodic, runtime, branch, and stale-state notes stay in memory.

**Files to modify:**

- `docs/founder-kernel/wiki/principles/*.md` (new pages)
- `docs/founder-kernel/manifest.json`

**Files explicitly not modified by this PR:** local/private memory stores. Entries that inspire a kernel principle may be cleaned up later by the founder or the memory owner, but this repository plan never edits local memory paths and never asks an implementation agent to bulk-read a private memory corpus.

### Task 5.1: Author the memory promotion inventory

- [ ] **Start from a reviewed inventory, not a private-path crawl.** Use memory-derived candidate summaries only when the founder provides them in the thread or when an approved memory-export artifact already exists in the repo. If no reviewed inventory exists, stop and create `docs/superpowers/audits/2026-05-12-memory-principle-inventory.md` from the visible discussion and repo evidence; do not require access to a specific local memory path.
- [ ] **For each candidate**, judge: durable governance (promote) or operational/situational (keep in memory). Use the spec §8 tier criteria and the audit's headcount budget (commandment ≤10, core ~25, contextual unbounded).
- [ ] **Commit** the inventory as `docs/superpowers/audits/2026-05-12-memory-principle-inventory.md` for review.
- [ ] **Commit:** `doc(audit): memory principle inventory for Batch 5`.

### Task 5.2: Promote in three sub-batches, in tier order

Per spec §15 Batch 5, this batch lands as three sub-PRs in this strict order so the commandment cap is enforced at the top before lower tiers expand:

1. **Sub-PR 5.2a** — commandment-tier promotions only. Branch: `doc/principles-batch-5a-memory-commandments`. Lands first because the cap of 10 published commandments is a hard gate and any promotion that exceeds it must be reassigned to core during this PR's review.
2. **Sub-PR 5.2b** — core-tier promotions only. Branch: `doc/principles-batch-5b-memory-core`. Lands second.
3. **Sub-PR 5.2c** — contextual-tier promotions only. Branch: `doc/principles-batch-5c-memory-contextual`. Lands last.

Each sub-batch follows the same shape:

For each approved candidate:

- [ ] **Author** the kernel page with a rewritten principle body — do not paste the memory entry verbatim. The memory entry was written for the founder; the kernel page is for product readers.
- [ ] **Source-cite** the rationale via a public-safe or internal-safe `RawSource`. If the rationale came from a private incident, generalize it: "platform incident in early 2026" rather than naming the dated debugging session, local path, or private memory file.
- [ ] **Run public-safety lint** (Phase 1, Task 1.7) — any local path, memory filename, or internal marker blocks the commit.
- [ ] **Commit per principle:** `doc(principles): promote <name> from memory`.

### Task 5.3: Update manifest counts

- [ ] **Bump** `docs/founder-kernel/manifest.json`.
- [ ] **Commit:** `doc(founder-kernel): bump manifest after Batch 5 promotion`.

### Phase 5 Verification

```powershell
pnpm --filter @dpf/db exec vitest run src/seed-wiki-kernel.test.ts
pnpm --filter web exec vitest run lib/wiki/lint
pnpm --filter web typecheck
pnpm --filter web build
pnpm --filter @dpf/db seed
pnpm --filter web exec vitest run lib/wiki/lint
```

**Manual audit:** read every newly-promoted kernel page front to back. Any sentence that reads like local environment, founder-specific, or branch-specific commentary should be rewritten before the PR opens.

**Exit criteria:**
- Public-safety lint passes on every promoted page.
- No raw memory paths, file names, or local markers leak into kernel content.
- Commandment cap still ≤10.
- Memory entries not promoted remain in memory as-is.

**PR(s):** up to three: `doc(principles): batch 5 — memory promotion (commandment tier)`, `... (core tier)`, `... (contextual tier)`.

---

## Phase 6 — Public Docs Generation

**Branch:** `feat/principles-batch-6-public-docs`

**Objective:** Generate `docs/principles.md` from kernel principle pages for the Jekyll/GitHub Pages public site. Add a script with snapshot-shaped test so drift is caught.

**Files to create:**

- `scripts/generate-public-principles.mjs`
- `scripts/generate-public-principles.test.mjs`
- `docs/principles.md` (the generated output, committed to git so the Jekyll build serves it)

**Files to modify:**

- `docs/_config.yml` (add the new page to navigation if the site uses a manifest; otherwise rely on the default `defaults` block)
- `docs/index.html` and `docs/README.md` (add a link to `/principles/` so visitors can find it)
- `package.json` at the workspace root (script entry, e.g., `"docs:principles": "node scripts/generate-public-principles.mjs"` and `"test:docs:principles": "node --test scripts/generate-public-principles.test.mjs"`)

### Task 6.1: Generation script

**Files:**
- Create: `scripts/generate-public-principles.mjs`

The script reads every markdown file under `docs/founder-kernel/wiki/principles/`, filters to those whose frontmatter has `principlePublic: true`, groups by `principleTier` (commandment / core / contextual), and emits a single `docs/principles.md` with:

- Jekyll front matter
- An intro paragraph explaining what DPF principles are
- Tiered sections (Commandments → Core → Contextual)
- For each principle: title, direction (as hero), rule, why, applies-to chips (as plain text since Jekyll renders to HTML), how-to-apply
- Source citations at the bottom (only the public-safe locators)

- [ ] **Write failing test** for the script with a small fixture directory: input is three principle markdown files (one per tier, all `principlePublic: true`), expected output is a single deterministic `principles.md` matching a stored snapshot.
- [ ] **Run test, verify it fails.**
- [ ] **Implement** the script with a small local YAML-frontmatter parser compatible with the subset already documented in `AUTHORING.md` (top-level scalars, inline arrays, block lists, and safe skipping of nested maps the generator does not need). Do not add a new root dependency and do not rely on root-level `tsx`.
- [ ] **Run test, verify it passes.**
- [ ] **Run the script** against the real kernel: `pnpm docs:principles`. Commit the resulting `docs/principles.md`.
- [ ] **Commit:** `feat(docs): generate public principles markdown from kernel`.

### Task 6.2: Snapshot drift detection

**Files:**
- Modify: `scripts/generate-public-principles.test.mjs`

- [ ] **Write a CI-friendly test** that runs the generator against the real `docs/founder-kernel/wiki/principles/` and asserts the produced output exactly matches the committed `docs/principles.md`. If anyone edits a kernel principle without re-running the script, this test fails — caught before merge.
- [ ] **Run test, verify it passes** (committed output matches).
- [ ] **Commit:** `test(docs): public principles snapshot drift detection`.

### Task 6.3: Public-site navigation

**Files:**
- Modify: `docs/index.html` and `docs/README.md`
- Modify (if needed): `docs/_config.yml`

- [ ] **Add a link** to the principles page from the docs index. Use the existing site's link style.
- [ ] **Add a navigation entry** if `_config.yml` uses a manifest list. Otherwise rely on Jekyll's default link discovery from `index.html`.
- [ ] **Verify locally** with `bundle exec jekyll serve` or the project's documented preview command. Confirm `/principles/` renders.
- [ ] **Commit:** `doc(site): add public principles to navigation`.

### Task 6.4: Add the generator to the build

**Files:**
- Modify: `package.json` (root)

- [ ] **Add** a `docs:principles` script entry.
- [ ] **Add** the same script to the pre-commit or CI gate that's responsible for catching docs drift. If no such gate exists yet, recommend the snapshot test (Task 6.2) as the safety net and document the manual command in `AUTHORING.md`.
- [ ] **Commit:** `chore(scripts): wire public principles generator into package.json`.

### Phase 6 Verification

```powershell
pnpm docs:principles
pnpm test:docs:principles
pnpm --filter web typecheck
pnpm --filter web build
```

**UX verification:** preview the docs site locally (Jekyll or the project's preview command), confirm `/principles/` renders, that internal-only principles are absent, that links from index/README work.

**Exit criteria:**
- `docs/principles.md` exists, is generated by the script, and matches the snapshot.
- Only `principlePublic: true` kernel principles appear on the public site.
- Navigation links exist from `index.html` and `README.md`.
- Snapshot drift test is in CI.

**PR:** title `feat(principles): batch 6 — public docs generation`.

---

## Post-Implementation Audit

After Phase 6 merges, run a final consolidation pass:

- [ ] Confirm no durable principle-shaped rule still lives only in `AGENTS.md`, only in local memory, or only in a spec body. Single-source-of-truth check.
- [ ] Confirm the commandment cap of 10 published kernel commandments is intact.
- [ ] Confirm `principle_decide` returns non-empty contribution ledgers for at least three real DPF decisions (test cases: "Take the quick patch vs refactor"; "Should we register this connector under contribute mode"; "Should we ship Phase 6 docs gen as a follow-up or now"). Capture the ledgers in `docs/superpowers/audits/2026-MM-DD-principle-decide-audit.md`.
- [ ] Run the wiki lint orchestrator over the full kernel + portal corpus and confirm zero blocking principle findings.
- [ ] Update `docs/founder-kernel/manifest.json` to a `1.0.0` schema version if `principle` lands as a stable kind.

---

## Risks and How to Handle Them Mid-Implementation

| Risk | When it surfaces | Response |
|------|------------------|----------|
| Phase 2 retrieval is slow against Qdrant | During Phase 2 UX verification | Profile `searchWikiPages` - index the new canonical payload keys (`principleTier`, `principleAppliesTo`, `principlePublic`) if missing. Do not optimize prematurely; if latency is fine, ship. |
| Phase 3 lint surfaces a contradiction between two seeded principles | During Phase 3 verification | Expected and healthy. `principle-contradiction-review` is `warn`, not `error`. Add a reviewer note explaining the intentional tension; do not silence the detector. |
| Phase 4 `AGENTS.md` becomes harder to read after pointers replace prose | During Phase 4 verification | Restore the original prose with a pointer paragraph appended ("This rule has been promoted to the kernel as `<name>` — see the kernel page for the canonical version and source citations.") rather than full replacement. Keep readability. |
| Phase 5 public-safety lint blocks every promoted memory entry | During Phase 5 verification | Slow down. The blocks are correct — memory was authored for the founder. Rewrite each entry in product-facing language and re-run. Do not loosen the lint. |
| Phase 6 Jekyll build breaks because the generated markdown has YAML edge cases | During Phase 6 UX verification | Add YAML-safe escaping to the generator (quote any value containing colons or hashes). Re-run the snapshot test. |
| Commandment cap hits 10 before all batches finish | Anywhere | Block the next promotion that would push past 10. Reassign a candidate to core via PR review. Do not raise the cap silently — the cap is the principle. |

---

## Out of Scope (deferred to follow-up specs)

- Dimension registry curation tooling - deferred until Phase 2 proves which dimensions are actually used by seeded principles and decision ledgers.
- Org-overlay principles UX (`/wiki?kind=principle&org=<id>`) — spec §18 question 4 recommends yes inside the portal; treat as a Phase 6+1 enhancement.
- `principle_decide` evidence recording for downstream workflows — spec §18 question 6 recommends not in V1.
- Commandment recall caching layer (if relevant under load) — optimize only if Phase 2 verification shows it's needed.
- Build Studio principle preview during planning — Build Studio integration is its own future spec.
- AHP / TOPSIS / weighted-product variants of the decision math — spec Appendix B explicitly notes V1 ships weighted-sum only.

---

## Plan Review Checklist (run plan-document-reviewer before committing)

- [ ] Every phase has explicit branch name, file lists, TDD-shaped tasks, verification commands, and exit criteria.
- [ ] No phase relies on another phase's uncommitted output.
- [ ] Every code change is preceded by a failing test.
- [ ] Every test command is a workspace-pinned `pnpm --filter` invocation.
- [ ] Every batch is independently mergeable (no cross-batch dependencies inside a batch).
- [ ] The commandment cap of 10 is honored across Phases 3–5.
- [ ] No internal markers, memory paths, or private content can leak through Phases 3–6 (Phase 1 lint blocks it).
- [ ] `AGENTS.md` remains operationally authoritative after Phase 4.
- [ ] Public docs render statically from kernel markdown (Phase 6), not from runtime DB.
- [ ] The plan references the spec's line-numbered current-state truths (§1.1) and does not assume PR #489 content.
