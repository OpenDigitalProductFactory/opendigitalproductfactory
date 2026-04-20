# Build Studio Code Intelligence Graph — Implementation Plan

**Goal:** Add a DPF-native source-code intelligence graph that improves Build Studio impact analysis, context narrowing, and review quality without turning Build Studio into a graph explorer.

**Architecture:** Build a DPF-specific code graph pipeline that extracts source-code structure from the shared workspace, persists it in the existing Neo4j deployment under a dedicated code namespace, and exposes graph-backed impact/context services to Build Studio phases. The graph informs ideate, plan, review, and ship outputs, while the existing Build Studio process graph and the operational/runtime dependency graph remain separate.

**Reference Input:** `https://github.com/tirth8205/code-review-graph` is the conceptual benchmark for structural parsing, incremental updates, blast-radius queries, and minimal-context tooling. This plan ports those ideas into DPF; it does not embed the upstream Python MCP server.

**Tech Stack:** Next.js App Router, TypeScript, Neo4j 5, Prisma, TypeScript compiler API or `ts-morph`, Vitest, Playwright, existing Build Studio tool/prompt infrastructure.

---

## Summary

- Create a **DPF-specific source-code intelligence graph** to support Build Studio impact analysis, context narrowing, and review support.
- Make it an **AI Coworker capability first**: ideate, plan, review, and ship should cite impact findings and affected code/tests in their results. Do **not** add a graph UI inside Build Studio in v1.
- Persist the graph in the **existing Neo4j deployment**, but keep it as a **separate code namespace** from the current operational/runtime graph.
- Cover **DPF Core only** in v1: TypeScript/TSX, Prisma schema/migrations, prompts, routes/components, and tool references.
- Start implementation by creating a **new epic + backlog item** in the live DB, since the current live backlog has no matching epic for this work.

## Product Decisions Locked

- **First slice:** Build Studio impact analysis first, not a general repository explorer.
- **Persistence model:** Neo4j first.
- **Build Studio UX:** AI-coworker/tool capability first; show impact summaries in Build Studio outputs, not a graph.
- **Future UI placement:** If a graph explorer is added later, it should live under portfolio/taxonomy analysis for the platform itself, not inside Build Studio.
- **Coverage:** DPF Core only in v1.
- **Isolation from existing Neo4j graphs (v1):** The code graph stands on its own merit and must not share nodes or edges with the existing `DigitalProduct` / `TaxonomyNode` / `Portfolio` / `InfraCI` sub-graph. No cross-label edges. No `Code*` node reuses an existing key space. Cross-graph bridges (e.g. `CodeRoute` → `DigitalProduct`, `CodePrismaModel` → `InfraCI`) are **explicitly deferred** — they may become valuable later for operational-to-code blast-radius traces, but v1 proves the code graph in isolation first. This keeps the failure mode of a bad code-graph rebuild contained: it can't corrupt runtime/operational impact analysis.

## Key Changes

### 1. Code Graph Model And Storage

- Extend the Neo4j schema with a dedicated code namespace using labels such as `CodeFile`, `CodeSymbol`, `CodeRoute`, `CodePrompt`, `CodeSkill`, `CodePrismaModel`, `CodeTest`, and `CodeTool`.
- Add relationship types such as `CODE_CONTAINS`, `CODE_IMPORTS`, `CODE_CALLS`, `CODE_DEFINES_ROUTE`, `CODE_USES_MODEL`, `CODE_REFERENCES_PROMPT`, `CODE_REFERENCES_SKILL`, `CODE_INVOKES_TOOL`, and `CODE_COVERS`.
- Keep runtime and source-code traversal separate: existing `InfraCI` and operational impact queries must remain unchanged.
- Store graph identities as stable repo-relative paths and qualified symbol IDs so incremental rebuilds can replace a file's subgraph safely.
- Declare schema additions in [packages/db/src/neo4j-schema.ts](packages/db/src/neo4j-schema.ts) following the existing `CREATE CONSTRAINT … REQUIRE … IS UNIQUE` + `CREATE INDEX … IF NOT EXISTS` style. Uniqueness keys:
  - `CodeFile.path` (repo-relative), `CodeSymbol.qualifiedId`, `CodeRoute.routePath`, `CodePrompt.slug`, `CodeSkill.name`, `CodePrismaModel.name`, `CodeTest.path`, `CodeTool.name`.
  - Secondary indexes on `CodeFile.pkg`, `CodeSymbol.kind`, `CodeSymbol.file`, `CodeTest.kind` (unit|e2e).
- Persist per-file content hashes for incremental rebuild in Postgres via a new Prisma model `CodeGraphFileHash { path @id, sha256, lastIndexedAt, graphVersion }`. Neo4j stores derived structure; Postgres stores the control plane. Migration lives in `packages/db/prisma/migrations/` per CLAUDE.md rules.

### 2. Native DPF Port, Not The Upstream Runtime

- Implement the port in the DPF stack instead of running the upstream Python MCP service.
- Use the TypeScript compiler API or `ts-morph` for TS/TSX symbol, import, route, and component extraction.
- Add DPF-specific enrichers for:
  - Prisma models and relation references from `schema.prisma`
  - migration risk markers from migration SQL
  - prompts from `prompts/**/*.prompt.md` and Build Studio prompt modules
  - skills from `skills/**/*.skill.md` (frontmatter + `composesFrom`, `allowedTools`)
  - tool references from `apps/web/lib/mcp-tools.ts` and coworker tool-invocation sites
  - test coverage links from Vitest and Playwright naming/import patterns
- Support **full rebuild** and **incremental rebuild by changed files + hashes**. Hashes live in the Postgres `CodeGraphFileHash` model (see §1). A rebuild cycle: diff `CodeGraphFileHash` vs. on-disk sha256s → for each changed path, delete that file's outgoing subgraph in Neo4j → re-extract → upsert → update hash row.
- **Parsing target:** the install's existing shared workspace resolved from `PROJECT_ROOT` (currently `/workspace` in the portal container). Reuse the same mounted codebase that Build Studio and codebase tools already read from; do **not** introduce a parallel `/app/source` bind in v1. Build Studio sandboxes are **not** parsed in v1 — sandbox code is ephemeral and has a separate review loop. A later slice may add per-sandbox graphs keyed by `buildId`.
- **Triggers in v1 (all on-demand, no watchers/hooks):**
  1. Admin API route `POST /api/admin/code-graph/rebuild` (mode=full|incremental) — gated to admin role.
  2. Coworker tool `code_graph_rebuild` declared in [apps/web/lib/mcp-tools.ts](apps/web/lib/mcp-tools.ts) with `enum` on `mode` per CLAUDE.md enum mandate.
  3. Portal-init bootstraps an initial full build on first startup if `CODE_GRAPH_ENABLED=true` and `CodeGraphFileHash` is empty. If this trigger is kept, extend `portal-init` to use the same `PROJECT_ROOT=/workspace`, `NEO4J_*` env, and `depends_on: neo4j` wiring as the main portal container.
- **Performance budget (v1 targets on DPF Core scale ~= low thousands of files):**
  - Full rebuild: ≤ 90 s warm, ≤ 180 s cold.
  - Incremental rebuild for ≤ 20 changed files: ≤ 3 s p95.
  - Query latency for `analyzeCodeImpact` on a typical diff: ≤ 500 ms p95.
  - Neo4j node ceiling: 200k nodes / 1M relationships before we revisit partitioning.
  - Exceeding any budget fails the nightly perf-smoke workflow and keeps `CODE_GRAPH_ENABLED` default-off until the budget is met.

### 3. Build Studio Integration

- Add a code-intelligence service layer that exposes:
  - `buildCodeGraph(mode, changedFiles?)`
  - `getMinimalCodeContext(goal, changedFiles?)`
  - `analyzeCodeImpact(entryFiles?, diff?, buildId?)`
  - `findAffectedTests(changedFilesOrSymbols)`
- Wire this into Build Studio flows:
  - ideate/scout: identify related routes, models, prompts, tools, and likely reuse points
  - plan: provide minimal file/symbol context and dependency hotspots for the planner
  - review: surface affected tests, risky symbols, and cross-cutting areas to inspect
  - ship: enrich the existing impact report with code-level blast radius while keeping current route/schema/role impact behavior
- Keep the existing workflow/process graph unchanged in v1. The new code graph informs analysis; it does not replace the current Build Studio process graph or orchestration UI.

### 4. Interfaces And Output Contracts

- Extend existing impact/reporting shapes rather than inventing a new user-facing graph payload.
- Add optional fields to Build Studio evidence outputs such as:
  - `codeImpactSummary`
  - `relatedFiles`
  - `relatedSymbols`
  - `affectedTests`
  - `riskSignals`
  - `reasoningPaths`
  - `graphFreshness`
- Keep `change-impact.ts` backward-compatible for current RFC/change-management consumers, but make it graph-backed when code intelligence is available and heuristic-backed when it is not.
- Add coworker/tool access only where needed for Build Studio phases; do not expose a generic graph explorer tool to end users in v1.
- **Feature flag:** gate the entire slice behind `CODE_GRAPH_ENABLED` (env, default `false` until perf/quality validated). Each Build Studio phase (ideate, plan, review, ship) reads the flag and falls back to current heuristics when off or when Neo4j is unreachable. Flag must be logged at phase start so review output indicates whether graph enrichment was active.
- **`reasoningPaths` shape:** array of `{ from: qualifiedId, to: qualifiedId, via: Array<{ relType, nodeId }>, rationale: string }`. Bounded to top-N paths (N=5) per impact report to keep payloads small.

### 5. UI Boundary

- Do not add a new Build Studio graph tab or in-studio explorer in v1.
- Show graph results only as **summarized evidence** in coworker responses and Build Studio phase artifacts.
- Treat a future interactive graph view as a **portfolio/taxonomy analysis feature** under the platform's own taxonomy area, not as part of Build Studio proper.

## Public Interfaces And Types

- **Neo4j schema additions:** new code-graph labels and relationship types only; no breaking changes to existing runtime graph labels or traversal contracts.
- **Build Studio service API:** new internal code-intelligence service functions for build, query, impact, and test selection.
- **Impact report shape:** additive fields only. Existing consumers must continue working if code-graph enrichment is absent.
- **Tooling contract:** Build Studio tools may request code-graph evidence, but end-user route surfaces remain summary-based in v1.

## Test Plan

- Unit tests for TS/TSX extraction of symbols, imports, route definitions, and component links.
- Unit tests for Prisma, prompt, skill, tool, and test enrichers using DPF-style fixtures.
- Integration tests for Neo4j projection:
  - full rebuild creates expected nodes and edges
  - incremental rebuild updates only changed file subgraphs (verified via `CodeGraphFileHash` diff)
  - code namespace does not interfere with existing `InfraCI` graph queries
- Build Studio integration tests proving:
  - scout findings include graph-backed related code
  - review and ship outputs include affected tests and risk signals
  - fallback behavior works when `CODE_GRAPH_ENABLED=false` and when Neo4j is unreachable (two distinct cases)
- Regression tests for existing change-management flows to confirm old callers still accept the enriched impact report shape.
- **Perf-smoke test** that asserts the §2 performance budget (full/incremental/query latency) on a fixture repo sized to DPF Core order-of-magnitude; runs in CI nightly, not per PR.
- Verification before completion (per CLAUDE.md — never `npx`):
  - `pnpm --filter web exec vitest run` for affected suites at minimum
  - `pnpm --filter web exec next build`
  - add or update QA cases in `tests/e2e/platform-qa-plan.md` for Phase 10 (Build Studio) and Phase 12 (AI Coworker Cross-Cutting)

## Assumptions And Defaults

- v1 is **Build Studio impact analysis first**, not a general-purpose repository exploration product.
- Neo4j is the primary persisted graph store for this slice, but the graph remains **derived from workspace files**, not business authority data.
- DPF Core coverage is enough for the first useful release; broad polyglot support is deferred.
- Existing task scheduling in `task-dependency-graph.ts` stays as-is in v1; the code graph supplies better context and risk information, not a scheduler rewrite.
- If the graph is stale or unavailable, Build Studio must degrade gracefully to current heuristics and explicitly label the result as reduced-confidence.

## Current Repo Grounding

- Existing Build Studio workflow graph: `apps/web/components/build/ProcessGraph.tsx`
- Existing Build Studio process graph builder: `apps/web/lib/build/process-graph-builder.ts`
- Existing operational/runtime graph schema and traversal: `packages/db/src/neo4j-schema.ts`, `packages/db/src/neo4j-graph.ts`
- Existing Build Studio impact analysis entrypoint to enrich: `apps/web/lib/integrate/change-impact.ts`
- Existing task orchestration heuristic that should stay separate in v1: `apps/web/lib/integrate/task-dependency-graph.ts`

## Live Backlog Note

- Live DB check on 2026-04-19 found:
  - `Epic`: 0 rows
  - `BacklogItem`: 4 rows
  - `FeatureBuild`: 1 row, currently in `ideate`
- No existing epic matched this work, so implementation should create a dedicated epic and linked backlog item before development begins.
- **Canonical enum compliance (per CLAUDE.md "Strongly-Typed String Enums — MANDATORY"):**
  - `Epic.status` must be one of `"open" | "in-progress" | "done"` (start with `"open"`).
  - `BacklogItem.status` must be one of `"open" | "in-progress" | "done" | "deferred"`.
  - `BacklogItem.type` must be `"portfolio"` for this work (platform-facing capability, not a customer product).
  - Hyphens only (`"in-progress"`, never `"in_progress"`).
- **FK pitfall:** `BacklogItem.epicId` is the Prisma `cuid` on `Epic.id` — **not** the semantic `EP-…` key. Create the Epic first, read back `Epic.id`, then insert the BacklogItem FK. Do not hand-type `"EP-CODE-GRAPH-001"` into `epicId`.

## Task Decomposition (Ordered, One PR Each)

Per [CLAUDE.md](../../../CLAUDE.md) and [CONTRIBUTING.md](../../../CONTRIBUTING.md) — short-lived intent-named branches, one concern per PR, with Typecheck and Production Build as the required merge gates today.

1. **`feat/code-graph-schema`** — Neo4j schema additions (labels, constraints, indexes) in `neo4j-schema.ts` + Prisma migration adding `CodeGraphFileHash`. No extractors yet. Includes a CI assertion (Cypher-based, run in the integration test suite) verifying **graph isolation**: no edge exists where one endpoint is a `Code*` node and the other is `DigitalProduct | TaxonomyNode | Portfolio | InfraCI`, and no `Code*` node carries any existing runtime label. Merge when migration applies cleanly on fresh install, `initNeo4jSchema()` is idempotent, and the isolation assertion passes on a seeded fixture.
2. **`feat/code-graph-extractors-core`** — TS/TSX extractor (symbols, imports, routes, components) + Prisma enricher. Writes to graph. Unit fixtures only.
3. **`feat/code-graph-extractors-dpf`** — Prompt, skill, tool, and test enrichers. Completes DPF Core coverage.
4. **`feat/code-graph-service`** — Service layer (`buildCodeGraph`, `getMinimalCodeContext`, `analyzeCodeImpact`, `findAffectedTests`) + admin API route + `code_graph_rebuild` tool declaration with enum contracts.
5. **`feat/code-graph-change-impact`** — Enrich `change-impact.ts` with graph-backed fields; keep heuristic path as fallback. Additive schema only.
6. **`feat/code-graph-build-studio-wiring`** — Wire ideate/plan/review/ship phases through `CODE_GRAPH_ENABLED` flag. Log flag state at phase start.
7. **`feat/code-graph-perf-smoke`** — Nightly CI perf-smoke asserting §2 budget. Tune or defer budget constants if real-world numbers diverge materially.

Each PR must update the relevant docs and tests in the same PR, per the expectations in [CONTRIBUTING.md](../../../CONTRIBUTING.md).
