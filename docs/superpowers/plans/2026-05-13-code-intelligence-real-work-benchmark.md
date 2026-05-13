# Code Intelligence Real-Work Benchmark

**Status:** Ready to run after `doc/code-intelligence-graph-adoption` lands on `main` and the Docker-served portal is rebuilt from that commit.

**Purpose:** Measure whether code intelligence graph tools improve real DPF work, not whether they merely appear in a tool list.

**Branch dependency:** `doc/code-intelligence-graph-adoption`

**Primary benchmark item:** `BI-E4E21A7F` - "Seed crashes at seedCities P2002 unique-constraint violation, blocks all later seed steps including seedPromptTemplates"

**Fallback benchmark item:** `BI-LAB-72E4AB` - "Phase 2: Add isolated webhook callback routing and replay"

The primary item is deliberately small enough to finish, but still requires real source discovery across seed logic, database invariants, and tests. The fallback item is better for route/API tracing if the seed item is already resolved by the time this benchmark runs.

**Latest smoke benchmark:** `docs/superpowers/audits/2026-05-13-code-intelligence-benchmark-report.md`

---

## Entry Criteria

Run this benchmark only when all are true:

1. The branch has landed on `main`.
2. The portal image has been rebuilt and restarted from that landed commit.
3. `/api/mcp/v1 tools/list` includes:
   - `get_code_graph_freshness`
   - `inspect_build_code_impact`
   - `search_code_graph`
   - `trace_code_surface`
   - `find_related_tests`
4. `CodeGraphIndexState` for `source-code` is `ready`.
5. Structural graph counts are non-zero for:
   - `CodeFile`
   - `CodeSymbol`
   - `CodeRoute`
   - `CodeTool`
   - `PrismaModel`
   - `TestFile`
6. Relationship counts are non-zero for:
   - `DEFINES`
   - `IMPORTS`
   - `IMPLEMENTS_ROUTE`
   - `EXPOSES_TOOL`
   - `TESTED_BY`

`USES_MODEL` is not an entry criterion until a model-use extractor exists.

---

## Hypothesis

Graph-assisted work should improve at least one of these without making another materially worse:

- Faster first relevant file discovery.
- Fewer broad searches.
- Fewer missed implementation/test files.
- Better verification targeting.
- Clearer stale/missing graph warnings.
- Better plan quality before implementation.
- Less review rework.

If the graph only adds tool chatter, the benchmark should say so.

---

## Benchmark Design

Use two passes against the same backlog item.

### Pass A: Baseline Discovery

Use normal source tools only:

- `search_project_files`
- `read_project_file`
- `list_project_directory`

Stop after producing:

- A proposed implementation file list.
- A proposed test list.
- A 5-8 step implementation plan.
- Known risks or uncertainties.

Do not edit files in Pass A.

### Pass B: Graph-Assisted Discovery

Use graph tools first, then confirm exact code with source reads:

- `get_code_graph_freshness`
- `search_code_graph`
- `trace_code_surface`
- `find_related_tests`
- `read_project_file`

Stop after producing the same artifact shape as Pass A.

Do not edit files in Pass B.

### Optional Pass C: Real Build

After comparing A and B, implement the selected plan through the normal Build Studio path. This pass measures whether graph evidence carries into actual work:

- `ToolExecution` rows for graph calls.
- `ChangeRequest.impactReport.codeGraph` or equivalent build evidence.
- Related tests run.
- Review/ship evidence.

---

## Metrics

Record these for each pass:

| Metric | Baseline | Graph-assisted | Notes |
| --- | --- | --- | --- |
| Time to first relevant file | | | Wall-clock minutes |
| Total tool calls | | | From `ToolExecution` when available |
| Broad searches | | | `search_project_files` / `search_sandbox` |
| Graph calls | | | Graph-assisted pass only |
| Relevant files identified | | | Count and paths |
| Relevant tests identified | | | Count and paths |
| False positives | | | Files read but not relevant |
| Missed files discovered later | | | During implementation/review |
| Graph warning state | | | ready/stale/dirty/missing/failed |
| Plan quality score | | | 1-5 operator judgment |
| Review rework count | | | Number of plan/test corrections |

Plan quality score:

- `1`: unusable; misses core files or proposes wrong architecture.
- `2`: partially useful but needs major correction.
- `3`: workable with normal review.
- `4`: good; minor corrections only.
- `5`: directly actionable and verification-aware.

---

## Evidence Queries

### Graph State

```powershell
docker compose exec -T postgres psql -U dpf -d dpf -c "select \"graphKey\", \"indexStatus\", \"lastIndexedBranch\", \"lastIndexedHeadSha\", \"workspaceDirty\", \"indexedFileCount\", \"lastError\" from \"CodeGraphIndexState\" where \"graphKey\"='source-code';"
```

```powershell
$neo = ((Get-Content .env | Where-Object { $_ -match '^NEO4J_PASSWORD=' }) -replace '^NEO4J_PASSWORD=', '').Trim()
docker compose exec -T neo4j cypher-shell -u neo4j -p $neo --format plain "MATCH (n {graphKey:'source-code'}) RETURN labels(n) AS labels, count(*) AS n ORDER BY n DESC LIMIT 20"
docker compose exec -T neo4j cypher-shell -u neo4j -p $neo --format plain "MATCH (a)-[r {graphKey:'source-code'}]->(b) RETURN type(r) AS rel, count(*) AS n ORDER BY rel"
```

### MCP Tool Availability

```powershell
$cfg = Get-Content .mcp.json -Raw | ConvertFrom-Json
$body = @{ jsonrpc = "2.0"; id = 1; method = "tools/list"; params = @{} } | ConvertTo-Json -Depth 6
$response = Invoke-RestMethod -Method Post -Uri $cfg.mcpServers.dpf.url -Headers @{ Authorization = $cfg.mcpServers.dpf.headers.Authorization } -Body $body -ContentType "application/json"
$response.result.tools | ForEach-Object { $_.name } | Where-Object { $_ -match "code_graph|code_impact|related_tests|code_surface" }
```

### ToolExecution Audit

```sql
select
  "createdAt",
  "agentId",
  "toolName",
  "success",
  "executionMode",
  "routeContext",
  "durationMs"
from "ToolExecution"
where "createdAt" >= now() - interval '2 hours'
  and "toolName" in (
    'search_project_files',
    'read_project_file',
    'list_project_directory',
    'get_code_graph_freshness',
    'search_code_graph',
    'trace_code_surface',
    'find_related_tests',
    'inspect_build_code_impact'
  )
order by "createdAt" asc;
```

### Build Impact Evidence

```sql
select
  "buildId",
  "title",
  "phase",
  "impactReport"
from "FeatureBuild"
where "updatedAt" >= now() - interval '2 hours'
order by "updatedAt" desc
limit 10;
```

---

## Operator Prompts

### Pass A Prompt

```text
Benchmark Pass A, baseline source discovery only.

Use backlog item BI-E4E21A7F as the real work target. Do not edit files and do not create or update backlog records. Use only search_project_files, read_project_file, and list_project_directory for source discovery.

Return:
1. Relevant implementation files.
2. Relevant tests.
3. A 5-8 step implementation plan.
4. Risks or uncertainty.
5. Which files you are least confident about.
```

### Pass B Prompt

```text
Benchmark Pass B, graph-assisted source discovery.

Use backlog item BI-E4E21A7F as the real work target. Do not edit files and do not create or update backlog records. First call get_code_graph_freshness. If the graph is ready, use search_code_graph, trace_code_surface, and find_related_tests before confirming exact code with read_project_file. If the graph is stale, dirty, missing, or failed, say that explicitly and fall back to source search.

Return:
1. Relevant implementation files.
2. Relevant tests.
3. A 5-8 step implementation plan.
4. Risks or uncertainty.
5. Which files you are least confident about.
6. What graph evidence helped or failed to help.
```

### Fallback Item Prompt

Use the same pass structure, replacing `BI-E4E21A7F` with `BI-LAB-72E4AB`.

---

## Decision Rules

After both passes:

- Keep graph prompts as-is if graph-assisted discovery finds the same or better file/test set with fewer broad searches or clearer verification targeting.
- Tune graph prompts if the graph is useful but agents overuse it or fail to confirm source.
- Improve extractors if graph-assisted discovery misses obvious route/tool/model/test relationships.
- Add `USES_MODEL` extraction if Prisma model impact remains mostly manual.
- Do not add semantic/vector retrieval until deterministic graph tools show measurable value or a clear deterministic gap.

---

## Result Template

```text
Benchmark item:
Runtime commit:
Graph status:

Baseline:
- Time:
- Tool calls:
- Files:
- Tests:
- Plan score:
- Misses:

Graph-assisted:
- Time:
- Tool calls:
- Files:
- Tests:
- Plan score:
- Misses:
- Helpful graph evidence:
- Misleading graph evidence:

Decision:
Next tuning slice:
```
