# Code Intelligence Graph Adoption Design

**Date:** 2026-05-13
**Status:** Approved — ready for plan execution
**Owner:** Build Studio / Platform Development
**Reviewed by:** Chief Architect (2026-05-12)
**Related current implementation:** `apps/web/lib/integrate/code-graph-refresh.ts`, `apps/web/lib/integrate/code-graph-access.ts`, `apps/web/lib/integrate/change-impact.ts`
**Related backlog:** `BI-931303FF`, `BI-PIR-04c0c75c`, `EP-BUILD-9F749C`

### Framework alignment

- **IT4IT v3 value streams:** Primary surface is **Integrate** (Build Studio build/compose flow). Touchpoints exist in **Deploy** (release-gate evidence on `ChangeRequest.impactReport.codeGraph`), **Release** (verification targeting via related tests), and **Operate** (freshness, drift, dirty-workspace observability). The graph is a Digital Product Backbone capability that supports Integrate without owning Strategy, Demand, or Consume.
- **TAK conformance:** All graph reads are `TAK-Basic` tool executions — authority mediated by `code_graph_read`, every call writes a `ToolExecution` audit row, freshness warnings prevent unsafe narration, and no LLM is in the extraction path so fabrication risk is bounded to the query/summarization side. Graph extractors are deterministic and replayable.
- **Hive mind / recursive self-improvement:** Each install runs its own graph against its own source. Cross-install value comes from the **extractor catalogue and schema** (Code Intelligence node/edge taxonomy, extractor versions), not from sharing graph data. New extractors are contributable artifacts that the hive promotes as platform improvements.
- **Principles-as-vectors compatibility:** The graph is decision substrate. Edges carry `confidence` and `extractorVersion` so downstream principle-weighted scoring (impact, risk, blast radius) can aggregate evidence without hand-curated precedence.

---

## Problem

DPF has a working first slice of a code graph, but it is not yet a practical code intelligence layer.

Current runtime truth observed on 2026-05-13:

- `CodeGraphIndexState` exists and the `source-code` graph is `ready`.
- The scheduled `code-graph-reconcile` job runs every 15 minutes.
- Neo4j contains 2,756 `CodeFile` nodes for `graphKey = "source-code"`.
- The graph records committed file freshness and file coverage, not symbols, imports, routes, tests, tools, Prisma models, prompts, or ownership relationships.
- The available external MCP token did not include `code_graph_read`, so external agents could not call `get_code_graph_freshness` or `inspect_build_code_impact`.
- Current `ToolExecution` rows showed no calls to `get_code_graph_freshness` or `inspect_build_code_impact`; related usage was limited to `read_project_file`.
- The Build Studio route context did not expose the graph tools in its domain tool list, even though `apps/web/lib/mcp-tools.ts` registers them and `apps/web/lib/tak/agent-grants.ts` maps them to `code_graph_read`.
- The currently indexed runtime workspace was `/workspace` on branch `my-changes`, not the host root checkout. That is valid for the running portal, but the UI needs to make this source-of-truth distinction visible.

The result: the graph is alive, but agents mostly continue to use plain text search, direct file reads, or generic reasoning. That is fine for narrow tasks, but it leaves Build Studio without a dependable way to answer multi-hop questions such as:

- Which route, component, tool, prompt, and Prisma models make up this feature surface?
- If this file changes, what tests and user-facing routes should be reviewed?
- Is this build touching code that the current graph did not index?
- Did the Build Studio coworker actually use graph evidence before moving through plan, review, or ship?

---

## Goals

1. Make the current code graph visible, callable, and auditable before expanding it.
2. Refactor the current graph implementation into smaller units before adding more extraction logic.
3. Extend the graph from file coverage to deterministic code intelligence for DPF's TypeScript, Next.js, Prisma, prompt, and MCP-tool surfaces.
4. Keep lexical search, source reads, graph traversal, and future semantic retrieval as separate layers with clear responsibilities.
5. Use the graph in Build Studio by default for ideation grounding, implementation planning, review impact, test targeting, and ship evidence.
6. Preserve DPF governance: permissions, tool grants, ToolExecution audit rows, freshness warnings, and no fabricated blast-radius claims.

## Non-Goals

- Do not replace `rg`, `git grep`, `read_project_file`, or `search_source_at_version`. Exact text search remains the right tool for exact strings and errors.
- Do not adopt an external SaaS search platform as the runtime dependency for this slice.
- Do not claim precise call-graph or symbol-level blast radius until the graph stores the supporting edges.
- Do not index secrets, `.env` files, generated dependency folders, or uncommitted host edits as authoritative source.
- Do not build a vector/semantic code search layer in the first implementation slice. It can be added after deterministic graph facts are reliable.

---

## Research & Benchmarking

### Open-Source and Open-Protocol References

| Reference | Relevant architecture | Adopt | Reject or defer |
| --- | --- | --- | --- |
| Sourcegraph code search and code navigation | Sourcegraph separates fast text search from code navigation. Its architecture docs describe `zoekt` trigram indexing for default branches, fallback search for unindexed code, and separate precise code navigation indexes. See https://sourcegraph.com/docs/admin/architecture. | Keep DPF lexical search separate from graph traversal. The graph should enrich impact and navigation; it should not become a slow text-search substitute. | Defer a dedicated trigram or inverted index because DPF already has `git grep`/`rg` style search for the local repo. |
| SCIP | SCIP models documents, occurrences, symbols, and semantic roles for code navigation. Sourcegraph recommends starting with occurrences and progressively adding richer features. See https://sourcegraph.com/docs/code-navigation/writing-an-indexer. | Use SCIP's progression as a shape: file -> document -> symbol occurrence -> reference -> implementation. Keep deterministic snapshot tests for extractor output. | Do not adopt the full SCIP upload workflow in this slice. DPF can map equivalent facts into Neo4j first. |
| CodeQL | CodeQL creates a database by extracting syntactic AST data plus semantic name-binding and type information, then queries that database. See https://codeql.github.com/docs/codeql-overview/about-codeql/. | Treat code intelligence as extracted facts, not LLM-written summaries. For TypeScript, use compiler APIs to extract imports, exports, declarations, and type-aware facts over time. | Do not build or depend on a full CodeQL database for the first DPF-native graph expansion. |
| Kythe | Kythe uses explicit node kinds, edge kinds, stable names, and reverse-edge post-processing. See https://www.kythe.io/docs/schema/. | Define DPF graph node keys and edge types explicitly. Every edge should trace back to a file, line range, and extractor version. | Do not import Kythe's full VName and schema complexity unless DPF later needs multi-language precision at that level. |
| TypeScript Compiler API | The TypeScript API exposes `Program`, `CompilerHost`, `SourceFile`, AST traversal, and builder programs. See https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API. | Use TypeScript's parser/compiler API for DPF's TS/TSX graph facts instead of regex-only extraction. Start with AST facts that do not require a full type checker, then add type-aware facts where needed. | Do not make every graph refresh run a full expensive typecheck. Graph extraction should be cheaper than the build gate. |

### Commercial Product References

| Product | Relevant architecture | Adopt | Reject or defer |
| --- | --- | --- | --- |
| GitHub code navigation | GitHub uses tree-sitter based code navigation for definitions/references and symbol search across repositories. See https://docs.github.com/en/enterprise-cloud@latest/repositories/working-with-files/using-files/navigating-code-on-github. | Auto-extract symbols and references for common languages without manual user setup. Start with TypeScript/JavaScript and active branch constraints. | Do not promise cross-repository navigation until DPF models multiple repos and permissions. |
| Glean Code Search | Glean positions code search as a shared AI layer with crawling, permissions, activity signals, lexical and semantic indices, MCP access, and agentic looping. See https://docs.glean.com/security/how-code-search-works. | Make code intelligence a shared platform tool, not a hidden Build Studio helper. Combine lexical search, graph facts, freshness, permissions, and agent-loop guidance. | Defer semantic vector indexing and activity-based ranking until deterministic graph facts are useful. |
| Sourcegraph Enterprise | Sourcegraph combines code search, code navigation, telemetry, batch changes, and permissions around repository sync. See https://sourcegraph.com/docs/admin/architecture. | Export telemetry and make graph freshness/usage visible. Let operators see when the graph is stale, missing coverage, or unused. | Do not copy Sourcegraph's multi-repo architecture wholesale; DPF's immediate need is its installed workspace and sandbox/portal build flow. |

### Recent Research Signals

- Repository Intelligence Graph (RIG) reports that deterministic, evidence-backed repository maps improve coding-agent accuracy and reduce completion time when answering repository-structure questions. See https://arxiv.org/abs/2601.10112.
- Reliable Graph-RAG for Codebases reports that deterministic AST-derived graphs outperform LLM-extracted knowledge graphs for multi-hop codebase reasoning, with lower indexing cost and lower hallucination risk. See https://arxiv.org/abs/2601.08773.

DPF should therefore prefer deterministic AST/build/tool extraction over LLM-inferred graph generation.

---

## Target Architecture

### Layer 1: Source Snapshot and Freshness

The existing slice remains the base:

- `CodeGraphIndexState` records graph key, status, indexed branch/head, workspace root, dirty state, file count, and last error.
- `CodeGraphFileHash` records per-file checksums for committed files.
- Neo4j stores `CodeFile` nodes keyed by `codeFileKey`.
- Inngest scheduled and event-driven reconciliation keeps the graph fresh.

Required improvement: expose the source snapshot clearly in Build Studio and graph tool responses. The user and agent must know which workspace root, branch, and commit the graph represents.

### Layer 2: Deterministic Extractors

Create a focused code-graph module folder:

- `apps/web/lib/integrate/code-graph/git-snapshot.ts`
- `apps/web/lib/integrate/code-graph/file-projection.ts`
- `apps/web/lib/integrate/code-graph/typescript-extractor.ts`
- `apps/web/lib/integrate/code-graph/next-route-extractor.ts`
- `apps/web/lib/integrate/code-graph/prisma-extractor.ts`
- `apps/web/lib/integrate/code-graph/mcp-tool-extractor.ts`
- `apps/web/lib/integrate/code-graph/prompt-extractor.ts`
- `apps/web/lib/integrate/code-graph/test-extractor.ts`
- `apps/web/lib/integrate/code-graph/graph-writer.ts`
- `apps/web/lib/integrate/code-graph/graph-queries.ts`

Each extractor emits plain data first. Neo4j writes are a separate projection step. This keeps extraction testable without a live graph database.

**Extractor registry pattern.** Extractors register through a typed list (`code-graph/extractors/index.ts`) rather than being hand-wired into `syncTrackedFile`. New extractors land by appending to the registry plus a fixture-based snapshot test. The registry pattern is what makes "add an extractor" a contributable hive-mind improvement instead of an integration-file edit.

**Extraction budget.** Per-file extraction must stay well under build-gate cost. Targets for the first slice: median TypeScript-AST extraction time ≤ 25 ms per file, full reindex of `apps/web` ≤ 30 s on a developer laptop, incremental reindex of ≤ 50 changed files ≤ 3 s. If an extractor cannot meet this it ships behind a feature flag and is excluded from incremental refresh.

### Layer 3: Graph Facts

Initial nodes:

| Node label | Key | Source |
| --- | --- | --- |
| `CodeFile` | `source-code:<path>` | tracked committed files |
| `CodeSymbol` | `source-code:<path>#<export-or-declaration>` | TS/TSX AST declarations |
| `CodeRoute` | route path | Next app route files |
| `CodeTool` | MCP/platform tool name | `apps/web/lib/mcp-tools.ts` |
| `PrismaModel` | model name | `packages/db/prisma/schema.prisma` |
| `PromptTemplateSource` | prompt path or slug | `prompts/**/*.prompt.md` |
| `TestFile` | file path | `*.test.ts`, `*.test.tsx`, e2e plans |

Initial edges:

| Edge | Meaning |
| --- | --- |
| `DEFINES` | `CodeFile -> CodeSymbol`, `CodeFile -> CodeTool`, `CodeFile -> PrismaModel` |
| `IMPORTS` | `CodeFile -> CodeFile` for resolvable local imports |
| `IMPLEMENTS_ROUTE` | `CodeFile -> CodeRoute` |
| `USES_MODEL` | `CodeFile -> PrismaModel` when static extraction finds model usage |
| `EXPOSES_TOOL` | `CodeFile -> CodeTool` for MCP tool definitions and execution branches |
| `TESTED_BY` | `CodeFile|CodeSymbol|CodeRoute|CodeTool -> TestFile` |
| `USES_PROMPT` | `CodeFile -> PromptTemplateSource` for prompt loaders or route persona references |

Every node and edge must carry:

- `graphKey`
- `headSha`
- `sourcePath`
- `sourceLineStart` and `sourceLineEnd` when available
- `extractorVersion`
- `indexedAt`

Edges additionally carry `confidence` ∈ `{ "exact", "heuristic" }`. `exact` is reserved for facts derivable from AST or a structured schema (Prisma, MCP tool registry, Next route file layout). Filename- or naming-convention guesses are always `heuristic`.

**Import targets and orphan edges.** A TypeScript import may resolve to (a) another tracked `CodeFile`, (b) a workspace package the graph indexes, or (c) an external module the graph does not own. To avoid orphan edges, the projection MUST either resolve the import to an existing node *or* materialize a synthetic `ExternalModule` node keyed by `source-code:module:<specifier>`. Edge writes never depend on a target existing at write time — the projection is order-independent. Queries that need only first-party paths filter on `target.kind <> "ExternalModule"`.

**Prompt source vs prompt entity.** `PromptTemplateSource` is the **file** under `prompts/**/*.prompt.md` — the seed input. The runtime `Prompt` row in Postgres (editable via Admin > Prompts) is a distinct entity. The graph models the source; it does not duplicate the runtime row. Build Studio that needs the live prompt body reads Postgres; Build Studio that needs to find which file defines a prompt reads the graph. Both must agree on the slug.

### Layer 4: Graph Query Service

Graph consumers should call typed service functions, not raw Cypher:

- `getCodeGraphFreshness()`
- `summarizeCodeGraphCoverage(paths)`
- `searchCodeGraph(query, filters)`
- `traceCodeSurface(pathOrRouteOrTool)`
- `traceChangeImpact(paths)`
- `findRelatedTests(paths)`
- `explainGraphConfidence(input)`

Each response should include:

- Matching files/nodes
- Relationship path summary
- Confidence and freshness warnings
- Exact source paths and line ranges
- Whether the answer used file-only, symbol-level, or route/tool/model edges

### Layer 5: Tool Surface

Keep existing tools:

- `get_code_graph_freshness`
- `inspect_build_code_impact`

Add after the semantic graph exists:

- `search_code_graph`: find files, routes, tools, models, tests, prompts, and symbols using graph facts plus lexical filters.
- `trace_code_surface`: explain the connected implementation surface for a route, tool, model, or file.
- `find_related_tests`: return likely tests and verification targets for changed files.
- `explain_code_graph_confidence`: explain whether graph evidence is fresh enough to rely on.

All graph tools are read-only and require `code_graph_read`.

### Layer 6: Build Studio Integration

Build Studio should use code intelligence as a normal part of the phase flow:

- Ideate: use graph search to find similar routes, tools, models, prompts, and tests before drafting a design.
- Plan: use graph impact to identify affected modules and split build tasks.
- Build: use related tests and implementation surface to guide sandbox work.
- Review: use trace impact to decide which verification paths matter.
- Ship: persist graph evidence in `ChangeRequest.impactReport.codeGraph` and release-gate evidence.

This must not hide behind chat text. The build record should preserve what graph evidence was used.

### Layer 7: UI and Observability

Add a compact Code Intelligence status surface in Build Studio:

- Graph status: ready, updating, failed, missing.
- Indexed workspace root, branch, commit, and file count.
- Dirty workspace warning.
- Last indexed time and last use time.
- Last graph-backed tool result for the active build.
- Confidence badge: file-only, structural, or symbol-aware.

UI must follow DPF theme tokens from `AGENTS.md`: no hardcoded colors, use `var(--dpf-*)` tokens, accessible labels, and responsive layout.

---

## Governance and Permissions

1. `code_graph_read` remains the grant for read-only code intelligence.
2. Build Specialist and relevant external MCP tokens must receive `code_graph_read` only when their users also have `view_platform`.
3. Tool execution must continue to write `ToolExecution` records.
4. Graph answers must not include files the existing path-security rules would block.
5. If the graph is stale, missing, dirty, or file-only, tools must say that explicitly.
6. Graph-generated recommendations must remain advisory unless backed by source paths and line ranges.
7. Build Studio runtime issues in `BI-931303FF` must be addressed before relying on graph tools in Claude/Codex CLI-backed Build Studio loops.
8. **Seed is the source of truth for grants.** New tools that require `code_graph_read` are added to `packages/db/data/grant_catalog.json` (`honored_by_tools`) **and** to seed-side hardcoded coworker grants. An invariant test in the seed test suite must assert that every tool referenced by `agent-grants.ts` exists in `grant_catalog.json`, so runtime grants and seed grants cannot drift. Patching only the runtime path is forbidden.

## Silent-Failure Prevention

Extraction and projection failures must never appear as success. The following rules are normative.

1. An extractor failure on a single file MUST be recorded as a per-file warning attached to the next `CodeGraphIndexState` update, with extractor name, file path, and error message. Files that consistently fail surface in the Build Studio status panel.
2. `syncTrackedFile()` MUST NOT swallow Neo4j write errors. The current swallow-and-delete fallback is acceptable only for missing source files; projection errors propagate and mark the reconcile as `failed`.
3. Tool handlers (`search_code_graph`, `trace_code_surface`, `find_related_tests`) MUST return `success: false` when the underlying graph is `missing` or `failed`. Returning empty `items` with `success: true` is forbidden.
4. Any contribution-to-hive flow that involves graph evidence MUST verify the evidence was actually produced before declaring success — the same gap that caused the `contribute_to_hive` silent-failure incident.

---

## Implementation Slices

### Slice 1: Adoption and Observability

- Expose existing graph tools in `/build` route context.
- Grant `code_graph_read` to Build Specialist and the local MCP token path used for coding agents.
- Add tests proving graph tools are delivered to Build Studio.
- Add a Build Studio Code Intelligence status panel using current `getCodeGraphFreshness()`.
- Persist graph use in build evidence or `ToolExecution` summaries without adding new graph semantics.

### Slice 2: Refactor the Current Graph Module

- Split `code-graph-refresh.ts` into focused modules.
- Keep public exports compatible.
- Preserve current tests and add pure tests around git snapshot planning, file filtering, and graph projection.

### Slice 3: Structural Graph Facts

- Add TypeScript/TSX local import extraction.
- Add Next route extraction.
- Add Prisma model extraction.
- Add MCP tool extraction.
- Add test-file relation heuristics.
- Extend Neo4j schema with `CodeSymbol`, `CodeRoute`, `CodeTool`, `PrismaModel`, `PromptTemplateSource`, and `TestFile`.

### Slice 4: Graph-Backed Build Studio Tools

- Add `search_code_graph`, `trace_code_surface`, and `find_related_tests`.
- Update Build Studio ideate/plan/review prompts to use graph evidence when available.
- Persist `impactReport.codeGraph` for shipped builds.

### Slice 5: Confidence, Evaluation, and Tuning

- Add graph confidence levels.
- Add evaluation fixtures for known feature surfaces.
- Measure whether graph-backed flows reduce tool calls, missing-file misses, and plan/review rework.
- Decide whether to add semantic/vector retrieval after deterministic graph usage is measurable.

---

## Acceptance Criteria

- Build Studio exposes and can call graph freshness and impact tools with `code_graph_read`.
- The graph status panel shows current source root, branch, commit, index status, indexed file count, and stale/dirty warnings.
- The graph module is decomposed into testable units without changing current behavior.
- Structural graph facts include at least route, tool, model, local import, and test-file relationships for the DPF web app.
- New graph tools return source paths, line ranges where available, confidence, freshness warnings, and no unsupported precision claims.
- Review and ship flows persist graph evidence onto build/RFC records when graph analysis runs.
- Tests cover extraction, graph query behavior, route tool exposure, grant mapping, change-impact integration, and the grant-catalog ↔ agent-grants drift invariant.

### Measurable success (post-merge, observed over 2 weeks of Build Studio activity)

- ≥ 80% of Build Studio builds that reach the Plan phase record at least one graph-tool `ToolExecution` row (`get_code_graph_freshness`, `search_code_graph`, or `trace_code_surface`).
- ≥ 50% of builds that ship attach a non-empty `impactReport.codeGraph` block.
- 0 builds ship with stale-graph warnings unacknowledged in the ship evidence.
- Median full-reindex wall time ≤ 30 s on the reference dev environment; median incremental reindex ≤ 3 s for ≤ 50 changed files.
- 0 silent-failure reports of "graph said empty when it should have said missing" after Slice 1 ships.

---

## Risks

| Risk | Mitigation |
| --- | --- |
| Graph answers overstate precision | Include confidence levels and require source paths/line ranges. Do not call file-only coverage "blast radius." |
| Refresh becomes expensive | Keep lexical search and graph extraction separate. Start with incremental changed-file extraction. Avoid full TypeScript typecheck on every graph refresh. |
| Tool exposure remains blocked by CLI adapter behavior | Track this under `BI-931303FF`; graph adoption should not be considered complete until the active Build Studio runtime can call platform tools. |
| Neo4j schema grows without query discipline | Keep raw Cypher behind typed query functions and add tests for result shape. |
| UI adds noise | Keep the Code Intelligence panel compact and status-oriented, with detailed evidence available on demand. |
| Grant catalog drifts from runtime grant map | Add invariant test: every tool in `agent-grants.ts` must appear under exactly one entry in `grant_catalog.json.honored_by_tools`; every coworker hardcoded grant must exist in the catalog. Test runs in CI. |
| Extractor failures hide as empty results | Per-file extractor errors recorded as `CodeGraphIndexState` warnings; tool handlers return `success: false` when the graph is `missing` or `failed`. |
| Orphan graph edges to unresolved imports | Projection materializes synthetic `ExternalModule` nodes keyed by specifier so edges always have endpoints; queries filter on first-party labels when needed. |
| Test-relationship heuristic produces noise | Resolve test → source via AST import resolution; only when that fails fall back to filename-stem matching and tag the edge `confidence: "heuristic"`. |

---

## Decisions

These were open questions during draft; recording them as decisions so the plan executes without re-litigating.

1. **Extraction workspace — portal canonical.** The reconcile job runs against the portal workspace at `getGitRoot()`. The sandbox workspace produces build-scoped diff evidence (already covered by `inspect_build_code_impact`); it does not maintain its own steady-state graph. Rationale: one source of truth, no cross-workspace ambiguity in tool responses.
2. **Storage split — Neo4j for facts, Postgres for state.** Nodes, edges, and relationship metadata live in Neo4j. `CodeGraphIndexState`, per-file checksums, evidence references, and `ToolExecution` rows live in Postgres. Rationale: Postgres is the audit-and-state plane (it must back up cleanly with the rest of the install); Neo4j is the query plane.
3. **SCIP — deferred.** Use DPF-native extraction in the first slice. Node and edge names are chosen to be compatible enough that a future SCIP import/export adapter can be added without remodeling. Re-evaluate when DPF needs cross-language precision beyond TypeScript/Prisma/Next.
4. **Semantic / vector retrieval — deferred.** Add only after deterministic graph facts are routinely used in Build Studio and the success metrics above are being measured. The retrieval layering in the target architecture already leaves room for it.
5. **Re-indexes are background jobs.** Full and incremental reindexes are Inngest jobs; the UI never blocks on them. The coworker panel surfaces "graph refreshing" state and notifies on completion, matching the platform's general async-job posture.
