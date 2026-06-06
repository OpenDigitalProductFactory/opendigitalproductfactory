# Implementation Plan — Self-Maintaining Data Architecture

| Field | Value |
| ----- | ----- |
| Epic | EP-DATA-ARCH |
| Spec | [docs/superpowers/specs/2026-06-06-data-architecture-self-maintenance-design.md](../specs/2026-06-06-data-architecture-self-maintenance-design.md) |
| WWMD | `opt-coworker-hybrid` (high confidence, 2026-06-06) |
| Owning coworker | AGT-BUILD-DA (Data Architect) |
| Date | 2026-06-06 |
| Status | Draft — EA reviewed and tightened 2026-06-06 |

Build order is bottom-up: deterministic facts first, deterministic mirror second, visible view third, coworker judgment fourth, role/tool reach fifth, triggers last. Reserve about 20% of implementation capacity for convergence/refactoring: shared parser adapter, mirror identity helpers, seed helpers, and tests that prevent future drift.

## Phase 0 — Preflight And Substrate Guard

**Goal:** start each phase from verified current state.

1. Confirm branch is not `main` and note any unrelated uncommitted work.
2. Re-run live backlog check for EP-DATA-ARCH before promoting each BI.
3. Re-sweep `origin/main` for changes to EA schema, code graph, Data Architect prompt, scheduled task substrate, and Prisma version.
4. If any phase proposes new table/tool/agent/status, repeat the substrate verification and prefer extension of existing EA/coworker/scheduled-task surfaces.

**Verify:** capture the status line and backlog item state in the PR notes. This is source-local evidence only.

## Phase 1 — Extract (BI-8579FB2D, medium)

**Goal:** enrich the existing Prisma extractor with fields, relations, cardinality, mapped names, and index metadata.

1. Add a narrow parser adapter, likely `apps/web/lib/integrate/code-graph/extractors/prisma-schema-adapter.ts`.
2. Spike parser choice first:
   - If using `@prisma/internals`, add it deliberately to the appropriate package, pin it, and isolate `getDMMF` behind the adapter.
   - If `@prisma/internals` is unstable under Prisma 7.8.0, use a generated manifest or Prisma-generator-style path instead.
3. Keep `prisma-line-v1` behavior for model line anchors; merge parser facts for semantics.
4. Extend extraction types and Neo4j projection as needed for:
   - `PrismaField`
   - `HAS_FIELD`
   - `RELATES_TO`
   - index/unique metadata sufficient for FK-without-index checks
5. Bump extractor version to `prisma-dmmf-v2` or another honest adapter version.
6. Refactor shared relation/cardinality derivation into pure helpers with fixture coverage.

**Files likely touched:** `apps/web/lib/integrate/code-graph/extractors/prisma.ts`, extractor tests, code-graph types/projection tests, package manifest if a parser dependency is added.

**Verify:** `pnpm --filter web exec vitest run apps/web/lib/integrate/code-graph/extractors/prisma.test.ts` plus affected projection tests. Confirm fixture coverage for mapped names, ignored fields, one-to-one, one-to-many, many-to-many, and indexed FK.

## Phase 2 — Mirror (BI-2167A734, large)

**Goal:** project enriched facts into EA deterministically and idempotently.

1. Add mirror module, likely `apps/web/lib/ea/data-model-mirror.ts`.
2. Define stable mirror keys:
   - Elements: `prisma:model:<ModelName>`
   - Relationships: `prisma:relation:<FromModel>:<fieldOrRelationName>:<ToModel>`
3. Store element keys in `EaElement.infraCiKey` and `properties.sourceKey`; store relationship keys in `EaRelationship.properties.sourceKey`.
4. Add a preflight duplicate scan. If duplicate active rows exist for a source key, write/return a conformance issue and stop the mirror rather than creating more rows.
5. Decide whether code-level duplicate guards are enough for Slice 2. If DB enforcement is needed, add a narrow migration:
   - Inline backfill/dedupe SQL.
   - Unique index/constraint only on the chosen existing EA identity surface.
   - No new mirror table.
6. Upsert one `data_object` `EaElement` per model and one EA relationship per Prisma relation using existing relationship types plus `properties.cardinality`.
7. Mark removed rows instead of hard-deleting.
8. Write an `EaSnapshot` only on material delta.
9. Reuse existing EA Neo4j sync helpers after Postgres commit.

**Files likely touched:** new EA mirror module/tests, `packages/db/prisma/migrations/*` only if uniqueness is DB-enforced, `packages/db/src/seed-ea-archimate4.ts` only if a required type/rule is missing.

**Verify:** unit tests for first run, second run zero diff, add/change/remove, duplicate source-key stop, snapshot-on-delta, no snapshot-on-noop. If migration added, apply it in the governed runtime/sandbox per AGENTS build-gate rules.

## Phase 3 — View (BI-759537CA, medium)

**Goal:** expose a managed Data Model view in the existing EA tool.

1. Seed/upsert `ViewpointDefinition` named `Data Model` with allowed element type `data_object` and selected relationship type slugs.
2. Seed/upsert system-owned `EaView` with `scopeType="data-model"`, `scopeRef="prisma"`, and existing EA layout conventions.
3. Have Phase 2 maintain `EaViewElement` membership for the managed view.
4. Surface `EaSnapshot` history as a local timeline/drawer in the existing EA route. Use report-kit for any table/status/filter/KPI UI.
5. Add honest empty/failure states:
   - No mirror yet: “Data Model view has not been generated yet.”
   - Mirror failed: show latest successful snapshot plus issue summary.
   - Permission missing: explain that architecture-write authority is required.

**Files likely touched:** EA seed helper, EA route/view components, report-kit status intent registry if new EA status strings appear.

**Verify:** component/server tests for seeded view lookup, membership projection, empty state, snapshot timeline. Browser exercise on desktop and mobile widths after runtime deployment or shared lease.

## Phase 4 — Steward Loop (BI-6E5BF91F, large)

**Goal:** let AGT-BUILD-DA add judgment without mutating deterministic structure.

1. Add steward service, likely `apps/web/lib/ea/data-architecture-steward.ts`.
2. Input is the latest mirror snapshot plus current EA elements/relationships.
3. Implement deterministic drift detectors before LLM enrichment:
   - FK without index
   - missing inverse relation
   - ignored/unmapped ambiguity
   - orphaned model
   - no domain annotation
   - off-vocabulary enum
   - duplicate mirror key
   - material relation/cardinality change
4. Write findings as `EaConformanceIssue` with stable issue keys in `detailsJson` so repeat runs update existing open findings instead of duplicating them.
5. Let coworker enrichment propose domain/relationship annotations through `EaViewElement.proposedProperties` or clearly coworker-owned JSON properties, never by changing mirror-owned facts.
6. Material removals/cardinality flips call the decision perspective / WWMD surface and record the decision outcome.
7. Chunk work by domain/model family for cost and context control.

**Files likely touched:** steward module/tests, decision-perspective integration tests, conformance issue read helpers.

**Verify:** fixture tests for every drift rule and no-duplicate finding behavior. Functional test: introduce unindexed FK fixture and confirm the expected `EaConformanceIssue` appears without structural overwrite.

## Phase 5 — Coworker Role / Tools / Skill (BI-A16FDB65, medium)

**Goal:** make the Data Architect callable by Build Studio, schedule, and on-demand chat.

1. Add `packages/dpf-skill-pack/skills/dpf-data-architecture-steward/SKILL.md` with superset DPF skill frontmatter.
2. Update `prompts/specialist/data-architect.prompt.md`:
   - Direct/on-demand data-architecture questions are in scope.
   - Build Studio sandbox schema-task workflow remains in scope and unchanged.
   - The coworker must not mutate mirror-owned facts.
3. Seed grants through existing seed/registry mechanisms. Prefer existing grants/tools:
   - EA read/write
   - ontology graph query
   - `explain_blast_radius`
   - mirror/reconcile invocation only if an existing governed action surface cannot call it safely
4. Add invariant tests so a fresh install has the skill assignment, grants, and scheduled task eligibility.
5. Keep max-10-tools discipline; remove redundant tools rather than widening grants casually.

**Files likely touched:** skill file, `packages/db/src/seed-skills.ts` if needed, agent registry/seed grant files, data-architect prompt, grant tests.

**Verify:** seed tests, skill frontmatter invariant tests, prompt snapshot if existing, and an on-demand route/tool availability test.

## Phase 6 — Triggers (BI-8E274CD3, medium)

**Goal:** make the mirror and steward loop self-maintaining.

1. Build Studio trigger: after schema/migration tasks, run deterministic mirror; dispatch steward pass if mirror delta is material.
2. Governed migration/self-upgrade trigger: after migrations apply in the canonical upgrade path, run mirror. Do not add direct live-portal compose rebuilds or host-coupled scripts.
3. Nightly trigger: seed a `ScheduledAgentTask` + `ScheduledJob` using the existing Hive Scout / discovery triage pattern.
4. On-demand trigger: route “show/refresh/explain data architecture” to AGT-BUILD-DA with preview/confirmation when it will mutate EA state.
5. Add run records or execution evidence so operators can see last run, last status, and last snapshot id.

**Files likely touched:** Build Studio orchestrator hook, self-upgrade/migration post-step hook, scheduled task seed/config/test, coworker route intent mapping, operations-map projection if needed.

**Verify:** unit/integration tests for each trigger. Functional evidence from canonical local install or shared local-CI sandbox: schema change leads to mirror run, Data Model view update, snapshot write, and steward finding when expected.

## Sequencing And Dependencies

```text
P0 preflight
  -> P1 extract
  -> P2 mirror
  -> P3 view
  -> P4 steward
  -> P5 role/tools/skill
  -> P6 triggers
```

P1-P3 are the shippable live-ERD MVP. P4-P5 make it the WWMD-selected coworker hybrid. P6 makes it self-maintaining.

Do not promote P4 before P2 has stable source keys and duplicate guards. Do not promote P6 before P5 has seed-time grants and an on-demand path.

## Build Gate And Evidence

Each phase must name its verification substrate:

- Source-local worktree: targeted unit tests and typecheck only.
- Canonical local install or shared local-CI convergence sandbox: production build, migration apply, and functional/UX evidence.
- Live-install functional verification starts with `pnpm verify:preflight -- --feature-sha <sha>`.

Minimum PR evidence per phase:

- Commands run and substrate.
- Fixture or live object used.
- Snapshot/conformance issue IDs for mirror/steward phases.
- Browser route and viewport for Phase 3+ UI changes.
- Migration evidence if any Prisma migration is added.

## Promotion

Promote Phase 1 (`BI-8579FB2D`) first. Subsequent phases promote only after predecessor evidence is recorded. If the parser dependency spike fails, file the parser-adapter fallback as the first Phase 1 task rather than pushing the risk into mirror/view work.
