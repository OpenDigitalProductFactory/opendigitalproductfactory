# Code Intelligence Graph Adoption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make DPF's existing code graph a visible, governed, routinely used code intelligence layer for Build Studio and external coding agents.

**Architecture:** First expose and observe the current file-level graph without overstating what it knows. Then refactor the refresh pipeline into focused modules before adding deterministic TypeScript, route, Prisma, prompt, MCP-tool, and test extraction into Neo4j. Build Studio consumes graph facts through typed query services and MCP tools, with freshness warnings and audit rows preserved.

**Tech Stack:** Next.js 16, TypeScript, Prisma 7, PostgreSQL, Neo4j, Vitest, Docker Compose, DPF MCP JSON-RPC at `/api/mcp/v1`.

**Execution posture (DPF conventions):**
- Run each task in a feature branch off `main` via `git worktree add` so parallel sessions can't sweep each other's staged files. Stage with explicit paths (no `git add -A`) and prefer `git commit --only <files>` when concurrent sessions are possible.
- Every commit is `git commit -s` (DCO).
- Before pushing, sweep `git log origin/main..HEAD`, open PRs, and recent main commits for overlap with concurrent work.
- Architectural decisions live in the spec (`docs/superpowers/specs/2026-05-13-code-intelligence-graph-adoption-design.md`). If a task discovers a forced deviation, update the spec first, then the plan, then code.

---

## Source Documents

- Design spec: `docs/superpowers/specs/2026-05-13-code-intelligence-graph-adoption-design.md`
- Current refresh implementation: `apps/web/lib/integrate/code-graph-refresh.ts`
- Current graph read API: `apps/web/lib/integrate/code-graph-access.ts`
- Current impact API: `apps/web/lib/integrate/change-impact.ts`
- Current MCP tools: `apps/web/lib/mcp-tools.ts`
- Current Build Studio route context: `apps/web/lib/tak/route-context-map.ts`
- Current grants: `apps/web/lib/tak/agent-grants.ts`, `packages/db/data/agent_registry.json`, `packages/db/src/seed.ts`

## File Structure

### Existing Files to Modify

- `apps/web/lib/tak/route-context-map.ts`  
  Add current graph tools to `/build` domain tools so Build Studio coworkers receive them in route context.

- `apps/web/lib/tak/route-context-map.test.ts`  
  Prove `/build` exposes `get_code_graph_freshness` and `inspect_build_code_impact`.

- `apps/web/lib/tak/agent-grants.test.ts`  
  Prove Build Specialist grants include `code_graph_read` after registry and seed changes.

- `packages/db/data/agent_registry.json`  
  Add `code_graph_read` to the registry-backed Build Specialist grant list.

- `packages/db/src/seed.ts`  
  Add `code_graph_read` to `HARDCODED_COWORKER_GRANTS["build-specialist"]`.

- `apps/web/components/admin/McpTokenManager.tsx`  
  Default new MCP tokens to the coding-agent read scopes so new Codex and Claude Code tokens include `code_graph_read`.

- `apps/web/lib/actions/mcp-tokens.test.ts`  
  Prove `code_graph_read` appears in the external MCP scope list when the grant map includes graph tools.

- `apps/web/lib/actions/code-intelligence.ts`  
  New server action that returns `getCodeGraphFreshness()` to authenticated Build Studio UI clients.

- `apps/web/components/build/BuildStudio.tsx`  
  Fetch graph freshness and render the Code Intelligence status card in the graph view.

- `apps/web/lib/integrate/code-graph-refresh.ts`  
  Convert to a compatibility shell that re-exports the refactored refresh pipeline.

- `apps/web/lib/integrate/change-impact.ts`  
  Keep current behavior, then switch imports to the refactored code graph module and later use graph-backed related-test queries.

- `apps/web/lib/mcp-tools.ts`  
  Add graph-backed tools after structural extraction lands: `search_code_graph`, `trace_code_surface`, `find_related_tests`.

- `apps/web/lib/tak/agent-grants.ts`  
  Map new graph-backed tools to `code_graph_read`.

- `packages/db/data/grant_catalog.json`  
  Add new graph-backed tools to `code_graph_read.honored_by_tools`.

- `packages/db/src/neo4j-schema.ts`  
  Add Code Intelligence constraints and indexes for structural nodes.

- `apps/web/lib/integrate/build-agent-prompts.ts`  
  Add graph-use instructions to Build Studio context without requiring graph precision when freshness is missing or file-only.

- `apps/web/lib/routing/cli-adapter.ts` and `apps/web/lib/routing/codex-cli-adapter.ts`  
  Add graph tool names to the tool keyword pattern while `BI-931303FF` remains open.

### New Files to Create

- `apps/web/lib/mcp-token-scopes.ts`  
  Shared coding-agent MCP token scope defaults.

- `apps/web/lib/mcp-token-scopes.test.ts`  
  Tests for scope defaults and intersection behavior.

- `apps/web/components/build/CodeIntelligenceStatusCard.tsx`  
  Compact Build Studio panel showing graph status, indexed files, source branch, commit, and warnings.

- `apps/web/components/build/CodeIntelligenceStatusCard.test.tsx`  
  Static render tests for missing, ready, dirty, and error states.

- `apps/web/lib/integrate/code-graph/constants.ts`  
  Graph keys, job constants, extension allow-list, and path exclude rules.

- `apps/web/lib/integrate/code-graph/git-snapshot.ts`  
  Git root, head, branch, dirty-state, tracked-file, and changed-file helpers.

- `apps/web/lib/integrate/code-graph/path-filter.ts`  
  Pure file-extension and exclude matching.

- `apps/web/lib/integrate/code-graph/hash.ts`  
  Content checksum helpers.

- `apps/web/lib/integrate/code-graph/state-store.ts`  
  Prisma reads and writes for `CodeGraphIndexState` and `CodeGraphFileHash`.

- `apps/web/lib/integrate/code-graph/neo4j-projection.ts`  
  Neo4j schema, clear, sync, and delete operations.

- `apps/web/lib/integrate/code-graph/reconcile.ts`  
  Refresh planning and reconcile orchestration.

- `apps/web/lib/integrate/code-graph/scheduler.ts`  
  Scheduled job registration and queueing.

- `apps/web/lib/integrate/code-graph/types.ts`  
  Shared graph fact, node, edge, confidence, and query result types.

- `apps/web/lib/integrate/code-graph/index.ts`  
  Public exports for the graph module.

- `apps/web/lib/integrate/code-graph/extractors/typescript.ts`  
  TypeScript/TSX import, export, and local symbol extraction.

- `apps/web/lib/integrate/code-graph/extractors/next-routes.ts`  
  Next.js route extraction from `apps/web/app/**/{page,layout,route}.tsx?`.

- `apps/web/lib/integrate/code-graph/extractors/prisma.ts`  
  Prisma model extraction from `packages/db/prisma/schema.prisma`.

- `apps/web/lib/integrate/code-graph/extractors/mcp-tools.ts`  
  MCP tool definition extraction from `apps/web/lib/mcp-tools.ts`.

- `apps/web/lib/integrate/code-graph/extractors/tests.ts`  
  Test-file relationship extraction from file paths and imports.

- `apps/web/lib/integrate/code-graph/graph-queries.ts`  
  Typed query service for graph search, surface tracing, and related-test discovery.

- `apps/web/lib/integrate/code-graph/*.test.ts` and `apps/web/lib/integrate/code-graph/extractors/*.test.ts`  
  Focused tests for each pure extraction and query behavior.

## Work Allocation

This plan intentionally spends one implementation slice on refactoring before structural expansion. That keeps about 20 percent of the work focused on lowering complexity in `code-graph-refresh.ts` and preventing the graph from becoming another oversized integration file.

---

### Task 1: Make the Existing Graph Usable by Build Studio and External Agents

**Files:**
- Modify: `apps/web/lib/tak/route-context-map.ts`
- Modify: `apps/web/lib/tak/route-context-map.test.ts`
- Modify: `apps/web/lib/tak/agent-grants.test.ts`
- Modify: `packages/db/data/agent_registry.json`
- Modify: `packages/db/src/seed.ts`
- Create: `apps/web/lib/mcp-token-scopes.ts`
- Create: `apps/web/lib/mcp-token-scopes.test.ts`
- Modify: `apps/web/components/admin/McpTokenManager.tsx`
- Modify: `apps/web/lib/actions/mcp-tokens.test.ts`

- [ ] **Step 1: Add failing route-context coverage for Build Studio graph tools**

Add this test to `describe("ROUTE_CONTEXT_MAP /build operator-contract tooling", ...)` in `apps/web/lib/tak/route-context-map.test.ts`:

```ts
it("delivers code graph tools so Build Studio can inspect source freshness and changed-file coverage", () => {
  const buildRoute = ROUTE_CONTEXT_MAP["/build"];
  expect(buildRoute).toBeDefined();
  expect(buildRoute!.domainTools).toContain("get_code_graph_freshness");
  expect(buildRoute!.domainTools).toContain("inspect_build_code_impact");
});
```

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/tak/route-context-map.test.ts
```

Expected: FAIL because `/build` does not yet include both graph tools.

- [ ] **Step 2: Expose graph tools in the Build Studio route context**

In `apps/web/lib/tak/route-context-map.ts`, add these entries inside the `/build` `domainTools` array after the codebase-access tools:

```ts
      // Code intelligence (freshness plus changed-file coverage).
      "get_code_graph_freshness",
      "inspect_build_code_impact",
```

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/tak/route-context-map.test.ts
```

Expected: PASS.

- [ ] **Step 3: Add failing grant coverage for Build Specialist**

Add this test to the `agent registry grant lookup` describe block in `apps/web/lib/tak/agent-grants.test.ts`:

```ts
it("gives build-specialist access to read-only code graph tools", () => {
  const grants = getAgentToolGrants("build-specialist");
  expect(grants).toEqual(expect.arrayContaining(["code_graph_read"]));
  expect(isToolAllowedByGrants("get_code_graph_freshness", grants ?? [])).toBe(true);
  expect(isToolAllowedByGrants("inspect_build_code_impact", grants ?? [])).toBe(true);
});
```

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/tak/agent-grants.test.ts
```

Expected: FAIL because Build Specialist lacks `code_graph_read`.

- [ ] **Step 4: Add `code_graph_read` to Build Specialist grants**

In `packages/db/data/agent_registry.json`, find the `build-specialist` agent and add `"code_graph_read"` inside `config_profile.tool_grants`.

In `packages/db/src/seed.ts`, update `HARDCODED_COWORKER_GRANTS["build-specialist"]` to include `"code_graph_read"`:

```ts
    "build-specialist":    ["file_read", "code_graph_read", "backlog_read", "backlog_write", "architecture_read", "build_plan_write", "registry_read", "sandbox_execute", "deployment_plan_create", "iac_execute", "release_gate_create", "release_plan_create", "release_plan_read"],
```

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/tak/agent-grants.test.ts
```

Expected: PASS.

- [ ] **Step 5: Add coding-agent MCP scope defaults**

Create `apps/web/lib/mcp-token-scopes.ts`:

```ts
export const CODING_AGENT_MCP_TOKEN_SCOPES = [
  "architecture_read",
  "backlog_read",
  "code_graph_read",
  "file_read",
  "spec_plan_read",
] as const;

export function defaultMcpTokenScopes(availableScopes: string[]): string[] {
  const available = new Set(availableScopes);
  const defaults = CODING_AGENT_MCP_TOKEN_SCOPES.filter((scope) => available.has(scope));
  return defaults.length > 0 ? [...defaults] : ["backlog_read"].filter((scope) => available.has(scope));
}
```

Create `apps/web/lib/mcp-token-scopes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CODING_AGENT_MCP_TOKEN_SCOPES, defaultMcpTokenScopes } from "./mcp-token-scopes";

describe("defaultMcpTokenScopes", () => {
  it("includes code graph read scope for coding-agent tokens", () => {
    const scopes = defaultMcpTokenScopes([
      "architecture_read",
      "backlog_read",
      "code_graph_read",
      "file_read",
      "spec_plan_read",
    ]);

    expect(scopes).toEqual([...CODING_AGENT_MCP_TOKEN_SCOPES]);
  });

  it("only returns scopes currently exposed by the MCP scope list", () => {
    expect(defaultMcpTokenScopes(["backlog_read", "spec_plan_read"])).toEqual([
      "backlog_read",
      "spec_plan_read",
    ]);
  });

  it("returns an empty list when no coding-agent read scope is available", () => {
    expect(defaultMcpTokenScopes(["marketing_read"])).toEqual([]);
  });
});
```

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/mcp-token-scopes.test.ts
```

Expected: PASS.

- [ ] **Step 6: Use the coding-agent scope defaults in the MCP token UI**

Modify `apps/web/components/admin/McpTokenManager.tsx`:

```ts
import { defaultMcpTokenScopes } from "@/lib/mcp-token-scopes";
```

Replace both `new Set(["backlog_read"])` defaults with a helper call:

```ts
const [formScopes, setFormScopes] = useState<Set<string>>(new Set<string>());
```

Inside the `useEffect` that loads `scopesResult.scopes`, after `setScopes(scopesResult.scopes);`, add:

```ts
      const defaultScopes = defaultMcpTokenScopes(scopesResult.scopes);
      setFormScopes(new Set(defaultScopes));
```

Update `openForm()`:

```ts
  function openForm() {
    setFormName("");
    setFormCapability("read");
    setFormScopes(new Set(defaultMcpTokenScopes(scopes)));
    setFormExpires("90");
    setView({ kind: "form", error: null });
  }
```

Add this assertion to `apps/web/lib/actions/mcp-tokens.test.ts` in the authenticated `listAvailableMcpScopes` test:

```ts
      tool_d: ["code_graph_read"],
```

Update the expected scopes:

```ts
    expect(result.scopes).toEqual(["backlog_read", "backlog_write", "code_graph_read", "spec_plan_read"]);
```

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/actions/mcp-tokens.test.ts apps/web/lib/mcp-token-scopes.test.ts
```

Expected: PASS.

- [ ] **Step 7: Add the grant-catalog ↔ agent-grants drift invariant**

This invariant exists because grant-runtime regressions in DPF history have all come from one side of the map being patched without the other (e.g., the agent-grant-seeding gap, 2026-04-18). The seed is the source of truth; the runtime must match.

Add to `apps/web/lib/tak/agent-grants.test.ts`:

```ts
import grantCatalog from "../../../../packages/db/data/grant_catalog.json" assert { type: "json" };
import { TOOL_GRANT_MAP } from "./agent-grants";

it("every tool in the runtime grant map is honored by exactly one grant in the catalog", () => {
  const catalog = grantCatalog as Record<string, { honored_by_tools?: string[] }>;
  const catalogToolToGrants = new Map<string, string[]>();
  for (const [grant, entry] of Object.entries(catalog)) {
    for (const toolName of entry.honored_by_tools ?? []) {
      catalogToolToGrants.set(toolName, [...(catalogToolToGrants.get(toolName) ?? []), grant]);
    }
  }

  for (const toolName of Object.keys(TOOL_GRANT_MAP)) {
    const honoring = catalogToolToGrants.get(toolName);
    expect(honoring, `tool ${toolName} missing from grant_catalog.json`).toBeDefined();
    expect(honoring!.length, `tool ${toolName} appears under multiple grants`).toBe(1);
  }
});
```

If `TOOL_GRANT_MAP` is not exported, export it from `agent-grants.ts` for this test. Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/tak/agent-grants.test.ts
```

Expected: PASS. This test prevents future tool additions from passing CI when only one side of the map is updated.

- [ ] **Step 8: Run the adoption-slice verification**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/tak/route-context-map.test.ts apps/web/lib/tak/agent-grants.test.ts apps/web/lib/actions/mcp-tokens.test.ts apps/web/lib/mcp-token-scopes.test.ts apps/web/lib/mcp-tools.test.ts
pnpm --filter web typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit Task 1**

Use explicit paths (no `git add -A`) and `--only` to scope the commit when concurrent sessions may have staged files:

```powershell
git status --short
git commit -s --only `
  apps/web/lib/tak/route-context-map.ts `
  apps/web/lib/tak/route-context-map.test.ts `
  apps/web/lib/tak/agent-grants.test.ts `
  packages/db/data/agent_registry.json `
  packages/db/src/seed.ts `
  apps/web/lib/mcp-token-scopes.ts `
  apps/web/lib/mcp-token-scopes.test.ts `
  apps/web/components/admin/McpTokenManager.tsx `
  apps/web/lib/actions/mcp-tokens.test.ts `
  -m "feat: expose code graph to build agents"
```

Note: `git commit --only <files>` ignores anything staged outside this list, so parallel work in another session can't ride along.

---

### Task 2: Add a Build Studio Code Intelligence Status Panel

**Files:**
- Create: `apps/web/lib/actions/code-intelligence.ts`
- Create: `apps/web/components/build/CodeIntelligenceStatusCard.tsx`
- Create: `apps/web/components/build/CodeIntelligenceStatusCard.test.tsx`
- Modify: `apps/web/components/build/BuildStudio.tsx`

- [ ] **Step 1: Add failing component tests**

Create `apps/web/components/build/CodeIntelligenceStatusCard.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CodeIntelligenceStatusCard } from "./CodeIntelligenceStatusCard";
import type { CodeGraphFreshness } from "@/lib/integrate/code-graph-access";

function freshness(overrides: Partial<CodeGraphFreshness> = {}): CodeGraphFreshness {
  return {
    graphKey: "source-code",
    available: true,
    indexStatus: "ready",
    lastIndexedAt: new Date("2026-05-13T01:30:00Z"),
    lastIndexedBranch: "my-changes",
    lastIndexedHeadSha: "f5cfa13b044b0000000000000000000000000000",
    workspaceDirty: false,
    indexedFileCount: 2756,
    lastError: null,
    warnings: [],
    summary: "Code graph is ready for 2756 indexed files.",
    ...overrides,
  };
}

describe("CodeIntelligenceStatusCard", () => {
  it("renders ready graph status with source branch and commit", () => {
    const html = renderToStaticMarkup(<CodeIntelligenceStatusCard freshness={freshness()} />);
    expect(html).toContain("Code intelligence");
    expect(html).toContain("ready");
    expect(html).toContain("2,756 files");
    expect(html).toContain("my-changes");
    expect(html).toContain("f5cfa13b044b");
  });

  it("renders missing graph state", () => {
    const html = renderToStaticMarkup(<CodeIntelligenceStatusCard freshness={freshness({
      available: false,
      indexStatus: "missing",
      lastIndexedAt: null,
      lastIndexedBranch: null,
      lastIndexedHeadSha: null,
      indexedFileCount: 0,
      warnings: ["The code graph has not been built yet."],
    })} />);
    expect(html).toContain("missing");
    expect(html).toContain("The code graph has not been built yet.");
  });

  it("renders dirty workspace warning", () => {
    const html = renderToStaticMarkup(<CodeIntelligenceStatusCard freshness={freshness({
      workspaceDirty: true,
      warnings: ["Uncommitted local changes may not be reflected in graph-backed analysis."],
    })} />);
    expect(html).toContain("Uncommitted local changes");
  });
});
```

Run:

```powershell
pnpm --filter web exec vitest run apps/web/components/build/CodeIntelligenceStatusCard.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 2: Implement the status component**

Create `apps/web/components/build/CodeIntelligenceStatusCard.tsx`:

```tsx
"use client";

import { AlertTriangle, CheckCircle2, GitBranch, Network } from "lucide-react";
import type { CodeGraphFreshness } from "@/lib/integrate/code-graph-access";

type Props = {
  freshness: CodeGraphFreshness | null;
};

function shortSha(value: string | null): string {
  return value ? value.slice(0, 12) : "no commit";
}

function formatIndexedAt(value: Date | string | null): string {
  if (!value) return "not indexed";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "not indexed";
  return date.toLocaleString();
}

export function CodeIntelligenceStatusCard({ freshness }: Props) {
  if (!freshness) {
    return (
      <section className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3 shadow-dpf-xs">
        <div className="flex items-center gap-2 text-sm font-semibold text-[var(--dpf-text)]">
          <Network className="h-4 w-4 text-[var(--dpf-muted)]" aria-hidden="true" />
          Code intelligence
        </div>
        <p className="mt-2 text-xs text-[var(--dpf-muted)]">Loading graph status...</p>
      </section>
    );
  }

  const ready = freshness.available && freshness.indexStatus === "ready";
  const StatusIcon = ready ? CheckCircle2 : AlertTriangle;
  const statusColor = ready ? "text-[var(--dpf-success)]" : "text-[var(--dpf-warning)]";

  return (
    <section
      data-testid="code-intelligence-status-card"
      className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3 shadow-dpf-xs"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--dpf-text)]">
            <Network className="h-4 w-4 text-[var(--dpf-muted)]" aria-hidden="true" />
            Code intelligence
          </div>
          <p className="mt-1 text-xs text-[var(--dpf-muted)]">
            {freshness.indexedFileCount.toLocaleString()} files indexed at {formatIndexedAt(freshness.lastIndexedAt)}
          </p>
        </div>
        <div className={`inline-flex items-center gap-1 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-xs font-medium ${statusColor}`}>
          <StatusIcon className="h-3.5 w-3.5" aria-hidden="true" />
          {freshness.indexStatus}
        </div>
      </div>

      <div className="mt-3 grid gap-2 text-xs text-[var(--dpf-muted)] sm:grid-cols-2">
        <div className="flex items-center gap-1.5">
          <GitBranch className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="truncate">{freshness.lastIndexedBranch ?? "no branch"}</span>
        </div>
        <code className="truncate rounded bg-[var(--dpf-surface-2)] px-1.5 py-0.5 text-[var(--dpf-muted)]">
          {shortSha(freshness.lastIndexedHeadSha)}
        </code>
      </div>

      {freshness.warnings.length > 0 && (
        <ul className="mt-3 space-y-1">
          {freshness.warnings.map((warning) => (
            <li key={warning} className="flex gap-1.5 text-xs text-[var(--dpf-warning)]">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{warning}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

Run:

```powershell
pnpm --filter web exec vitest run apps/web/components/build/CodeIntelligenceStatusCard.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Add an authenticated server action for graph freshness**

Create `apps/web/lib/actions/code-intelligence.ts`:

```ts
"use server";

import { auth } from "@/lib/auth";
import { getCodeGraphFreshness, type CodeGraphFreshness } from "@/lib/integrate/code-graph-access";

export async function getCodeGraphFreshnessAction(): Promise<CodeGraphFreshness> {
  const session = await auth();
  if (!session?.user?.id) {
    return {
      graphKey: "source-code",
      available: false,
      indexStatus: "unauthorized",
      lastIndexedAt: null,
      lastIndexedBranch: null,
      lastIndexedHeadSha: null,
      workspaceDirty: false,
      indexedFileCount: 0,
      lastError: null,
      warnings: ["Sign in to view code graph status."],
      summary: "Sign in to view code graph status.",
    };
  }

  return getCodeGraphFreshness();
}
```

- [ ] **Step 4: Render the panel in Build Studio**

Modify `apps/web/components/build/BuildStudio.tsx` imports:

```ts
import { CodeIntelligenceStatusCard } from "./CodeIntelligenceStatusCard";
import { getCodeGraphFreshnessAction } from "@/lib/actions/code-intelligence";
import type { CodeGraphFreshness } from "@/lib/integrate/code-graph-access";
```

Add state near the other Build Studio state declarations:

```ts
  const [codeGraphFreshness, setCodeGraphFreshness] = useState<CodeGraphFreshness | null>(null);
```

Add an effect after the flow-state effect:

```ts
  useEffect(() => {
    let cancelled = false;
    getCodeGraphFreshnessAction()
      .then((freshness) => {
        if (!cancelled) setCodeGraphFreshness(freshness);
      })
      .catch(() => {
        if (!cancelled) setCodeGraphFreshness(null);
      });
    return () => { cancelled = true; };
  }, []);
```

In the `buildView === "graph"` block, render the card above `ProcessGraph`:

```tsx
                    <div className="border-b border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-4 py-3">
                      <CodeIntelligenceStatusCard freshness={codeGraphFreshness} />
                    </div>
```

Run:

```powershell
pnpm --filter web exec vitest run apps/web/components/build/CodeIntelligenceStatusCard.test.tsx apps/web/components/build/BuildStudio.test.ts
pnpm --filter web typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```powershell
git status --short
git add apps/web/lib/actions/code-intelligence.ts apps/web/components/build/CodeIntelligenceStatusCard.tsx apps/web/components/build/CodeIntelligenceStatusCard.test.tsx apps/web/components/build/BuildStudio.tsx
git commit -s -m "feat: show code intelligence status in build studio"
```

---

### Task 3: Refactor the Current Code Graph Refresh Module

**Files:**
- Create: `apps/web/lib/integrate/code-graph/constants.ts`
- Create: `apps/web/lib/integrate/code-graph/git-snapshot.ts`
- Create: `apps/web/lib/integrate/code-graph/path-filter.ts`
- Create: `apps/web/lib/integrate/code-graph/hash.ts`
- Create: `apps/web/lib/integrate/code-graph/state-store.ts`
- Create: `apps/web/lib/integrate/code-graph/neo4j-projection.ts`
- Create: `apps/web/lib/integrate/code-graph/reconcile.ts`
- Create: `apps/web/lib/integrate/code-graph/scheduler.ts`
- Create: `apps/web/lib/integrate/code-graph/index.ts`
- Modify: `apps/web/lib/integrate/code-graph-refresh.ts`
- Modify: `apps/web/lib/integrate/code-graph-access.ts`
- Modify: existing tests under `apps/web/lib/integrate/`

- [ ] **Step 1: Move constants without changing values**

Create `apps/web/lib/integrate/code-graph/constants.ts`:

```ts
export const CODE_GRAPH_JOB_ID = "code-graph-reconcile";
export const CODE_GRAPH_JOB_NAME = "Code Graph Reconcile";
export const CODE_GRAPH_JOB_SCHEDULE = "every-15m";
export const CODE_GRAPH_EVENT_NAME = "ops/code-graph.reconcile";
export const CODE_GRAPH_GRAPH_KEY = "source-code";

export const CODE_GRAPH_FILE_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".prisma",
  ".sql",
  ".svg",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);

export const CODE_GRAPH_TRACKED_FILE_EXCLUDES = [
  ".pnpm-store",
  "**/.pnpm-store/**",
  ".next",
  "**/.next/**",
  "node_modules",
  "**/node_modules/**",
];
```

- [ ] **Step 2: Add pure path-filter tests**

Create `apps/web/lib/integrate/code-graph/path-filter.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildListTrackedFilesCommand, shouldIndexCodeGraphPath } from "./path-filter";

describe("shouldIndexCodeGraphPath", () => {
  it("allows DPF source, schema, prompt, and doc extensions", () => {
    expect(shouldIndexCodeGraphPath("apps/web/lib/mcp-tools.ts")).toBe(true);
    expect(shouldIndexCodeGraphPath("apps/web/app/build/page.tsx")).toBe(true);
    expect(shouldIndexCodeGraphPath("packages/db/prisma/schema.prisma")).toBe(true);
    expect(shouldIndexCodeGraphPath("docs/superpowers/specs/example.md")).toBe(true);
  });

  it("rejects unsupported binary and generated file extensions", () => {
    expect(shouldIndexCodeGraphPath("apps/web/public/logo.png")).toBe(false);
    expect(shouldIndexCodeGraphPath("apps/web/.next/build-manifest.js")).toBe(false);
  });
});

describe("buildListTrackedFilesCommand", () => {
  it("includes source extensions and excludes generated dependency folders", () => {
    const command = buildListTrackedFilesCommand();
    expect(command).toContain("git ls-files --");
    expect(command).toContain('"**/*.ts"');
    expect(command).toContain('":(exclude)**/node_modules/**"');
    expect(command).toContain('":(exclude)**/.next/**"');
  });
});
```

Create `apps/web/lib/integrate/code-graph/path-filter.ts`:

```ts
import { lazyPath } from "@/lib/shared/lazy-node";
import { CODE_GRAPH_FILE_EXTENSIONS, CODE_GRAPH_TRACKED_FILE_EXCLUDES } from "./constants";

export function shouldIndexCodeGraphPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  if (normalized.includes("/.next/") || normalized.startsWith(".next/")) return false;
  if (normalized.includes("/node_modules/") || normalized.startsWith("node_modules/")) return false;
  if (normalized.includes("/.pnpm-store/") || normalized.startsWith(".pnpm-store/")) return false;
  return CODE_GRAPH_FILE_EXTENSIONS.has(lazyPath().extname(normalized).toLowerCase());
}

export function buildListTrackedFilesCommand(): string {
  const includeSpecs = Array.from(CODE_GRAPH_FILE_EXTENSIONS)
    .sort()
    .map((extension) => `"**/*${extension}"`);
  const excludeSpecs = CODE_GRAPH_TRACKED_FILE_EXCLUDES
    .map((pathspec) => `":(exclude)${pathspec}"`);

  return `git ls-files -- ${[...includeSpecs, ...excludeSpecs].join(" ")}`;
}
```

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/integrate/code-graph/path-filter.test.ts
```

Expected: PASS.

- [ ] **Step 3: Move git snapshot helpers**

Create `apps/web/lib/integrate/code-graph/git-snapshot.ts` with the existing logic from `code-graph-refresh.ts`:

```ts
import { lazyExec, lazyPath } from "@/lib/shared/lazy-node";
import { buildListTrackedFilesCommand, shouldIndexCodeGraphPath } from "./path-filter";

const exec = lazyExec();

export function getGitRoot(): string {
  const { resolve } = lazyPath();
  return process.env.PROJECT_ROOT
    ? resolve(process.env.PROJECT_ROOT)
    : resolve(process.cwd(), "..", "..");
}

export function normalizeGitOutput(stdout: string): string[] {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function getCurrentHeadSha(gitRoot: string): Promise<string | null> {
  const { stdout } = await exec("git rev-parse HEAD", { cwd: gitRoot, timeout: 10_000 });
  return stdout.trim() || null;
}

export async function getCurrentBranch(gitRoot: string): Promise<string | null> {
  const { stdout } = await exec("git rev-parse --abbrev-ref HEAD", { cwd: gitRoot, timeout: 10_000 });
  return stdout.trim() || null;
}

export async function isWorkspaceDirty(gitRoot: string): Promise<boolean> {
  const { stdout } = await exec("git status --porcelain", { cwd: gitRoot, timeout: 10_000 });
  return stdout.trim().length > 0;
}

export async function listTrackedFiles(gitRoot: string): Promise<string[]> {
  const { stdout } = await exec(buildListTrackedFilesCommand(), {
    cwd: gitRoot,
    timeout: 30_000,
    maxBuffer: 1024 * 1024 * 4,
  });
  return normalizeGitOutput(stdout).filter(shouldIndexCodeGraphPath);
}

export async function getChangedFiles(gitRoot: string, fromSha: string, toSha: string): Promise<string[]> {
  const { stdout } = await exec(`git diff --name-only ${fromSha}..${toSha}`, {
    cwd: gitRoot,
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  return normalizeGitOutput(stdout).filter(shouldIndexCodeGraphPath);
}
```

Add `normalizeGitOutput` tests to `apps/web/lib/integrate/code-graph/git-snapshot.test.ts`.

- [ ] **Step 4: Move hash, state, and projection helpers**

Create `apps/web/lib/integrate/code-graph/hash.ts`:

```ts
import { lazyCrypto } from "@/lib/shared/lazy-node";

export function checksumContent(content: string): string {
  return lazyCrypto().createHash("sha256").update(content).digest("hex");
}
```

Create `apps/web/lib/integrate/code-graph/state-store.ts`:

```ts
import { prisma } from "@dpf/db";

export type CodeGraphIndexStateRecord = {
  graphKey: string;
  indexStatus?: string | null;
  indexedFileCount?: number | null;
  lastIndexedHeadSha: string | null;
  lastIndexedAt?: Date | null;
};

type CodeGraphPrisma = {
  codeGraphIndexState: {
    findUnique(args: { where: { graphKey: string } }): Promise<CodeGraphIndexStateRecord | null>;
    upsert(args: Record<string, unknown>): Promise<unknown>;
  };
  codeGraphFileHash: {
    upsert(args: Record<string, unknown>): Promise<unknown>;
    deleteMany(args: Record<string, unknown>): Promise<unknown>;
    count(args: { where: { graphKey: string } }): Promise<number>;
  };
};

const codeGraphPrisma = prisma as unknown as CodeGraphPrisma;

export async function findCodeGraphIndexState(graphKey: string): Promise<CodeGraphIndexStateRecord | null> {
  return codeGraphPrisma.codeGraphIndexState.findUnique({ where: { graphKey } });
}

export async function markCodeGraphIndexing(
  graphKey: string,
  input: {
    workspaceRoot: string;
    headSha: string | null;
    branch: string | null;
    previousHeadSha: string | null;
    workspaceDirty: boolean;
    observedAt: Date;
  },
): Promise<void> {
  await codeGraphPrisma.codeGraphIndexState.upsert({
    where: { graphKey },
    create: {
      graphKey,
      graphVersion: 1,
      workspaceRoot: input.workspaceRoot,
      indexStatus: "updating",
      lastIndexedBranch: input.branch,
      lastIndexedHeadSha: input.previousHeadSha,
      workspaceDirty: input.workspaceDirty,
      workspaceDirtyObservedAt: input.observedAt,
      lastError: null,
    },
    update: {
      workspaceRoot: input.workspaceRoot,
      indexStatus: "updating",
      lastIndexedBranch: input.branch,
      workspaceDirty: input.workspaceDirty,
      workspaceDirtyObservedAt: input.observedAt,
      lastError: null,
    },
  });
}

export async function markCodeGraphReady(
  graphKey: string,
  input: {
    workspaceRoot: string;
    headSha: string | null;
    branch: string | null;
    workspaceDirty: boolean;
    observedAt: Date;
    indexedFileCount: number;
  },
): Promise<void> {
  await codeGraphPrisma.codeGraphIndexState.upsert({
    where: { graphKey },
    create: {
      graphKey,
      graphVersion: 1,
      workspaceRoot: input.workspaceRoot,
      indexStatus: "ready",
      lastIndexedAt: input.observedAt,
      lastIndexedBranch: input.branch,
      lastIndexedHeadSha: input.headSha,
      workspaceDirty: input.workspaceDirty,
      workspaceDirtyObservedAt: input.observedAt,
      indexedFileCount: input.indexedFileCount,
      lastError: null,
    },
    update: {
      workspaceRoot: input.workspaceRoot,
      indexStatus: "ready",
      lastIndexedAt: input.observedAt,
      lastIndexedBranch: input.branch,
      lastIndexedHeadSha: input.headSha,
      workspaceDirty: input.workspaceDirty,
      workspaceDirtyObservedAt: input.observedAt,
      indexedFileCount: input.indexedFileCount,
      lastError: null,
    },
  });
}

export async function markCodeGraphFailed(
  graphKey: string,
  input: {
    workspaceRoot: string;
    previousHeadSha: string | null;
    branch: string | null;
    workspaceDirty: boolean;
    observedAt: Date;
    error: unknown;
  },
): Promise<void> {
  const lastError = input.error instanceof Error ? input.error.message : "Unknown reconcile failure";
  await codeGraphPrisma.codeGraphIndexState.upsert({
    where: { graphKey },
    create: {
      graphKey,
      graphVersion: 1,
      workspaceRoot: input.workspaceRoot,
      indexStatus: "failed",
      lastIndexedBranch: input.branch,
      lastIndexedHeadSha: input.previousHeadSha,
      workspaceDirty: input.workspaceDirty,
      workspaceDirtyObservedAt: input.observedAt,
      lastError,
    },
    update: {
      workspaceRoot: input.workspaceRoot,
      indexStatus: "failed",
      lastIndexedBranch: input.branch,
      workspaceDirty: input.workspaceDirty,
      workspaceDirtyObservedAt: input.observedAt,
      lastError,
    },
  });
}

export async function upsertCodeGraphFileHash(input: {
  graphKey: string;
  filePath: string;
  checksum: string;
  indexedAt: Date;
}): Promise<void> {
  await codeGraphPrisma.codeGraphFileHash.upsert({
    where: { graphKey_filePath: { graphKey: input.graphKey, filePath: input.filePath } },
    create: {
      graphKey: input.graphKey,
      filePath: input.filePath,
      checksum: input.checksum,
      authority: "git",
      lastIndexedAt: input.indexedAt,
    },
    update: {
      checksum: input.checksum,
      authority: "git",
      lastIndexedAt: input.indexedAt,
    },
  });
}

export async function deleteCodeGraphFileHash(graphKey: string, filePath: string): Promise<void> {
  await codeGraphPrisma.codeGraphFileHash.deleteMany({ where: { graphKey, filePath } });
}

export async function countCodeGraphFileHashes(graphKey: string): Promise<number> {
  return codeGraphPrisma.codeGraphFileHash.count({ where: { graphKey } });
}
```

Create `apps/web/lib/integrate/code-graph/neo4j-projection.ts`:

```ts
import { runCypher } from "@dpf/db";
import { lazyFsPromises, lazyPath } from "@/lib/shared/lazy-node";
import { checksumContent } from "./hash";
import { deleteCodeGraphFileHash, upsertCodeGraphFileHash } from "./state-store";

export function buildCodeFileKey(graphKey: string, filePath: string): string {
  return `${graphKey}:${filePath}`;
}

export async function clearCodeGraph(graphKey: string): Promise<void> {
  await runCypher(
    "MATCH (n:CodeFile {graphKey: $graphKey}) DETACH DELETE n",
    { graphKey },
  );
}

export async function ensureCodeGraphNeo4jSchema(): Promise<void> {
  const statements = [
    "CREATE CONSTRAINT cf_codeFileKey IF NOT EXISTS FOR (n:CodeFile) REQUIRE n.codeFileKey IS UNIQUE",
    "CREATE INDEX cf_graphKey IF NOT EXISTS FOR (n:CodeFile) ON (n.graphKey)",
    "CREATE INDEX cf_path IF NOT EXISTS FOR (n:CodeFile) ON (n.path)",
  ];

  for (const statement of statements) {
    try {
      await runCypher(statement);
    } catch {
      // Reconcile can proceed if an equivalent schema object already exists.
    }
  }
}

export async function syncTrackedFile(graphKey: string, gitRoot: string, filePath: string): Promise<void> {
  const { readFile } = lazyFsPromises();
  const fullPath = lazyPath().resolve(gitRoot, filePath);
  const codeFileKey = buildCodeFileKey(graphKey, filePath);

  try {
    const content = await readFile(fullPath, "utf-8");
    const checksum = checksumContent(content);
    const indexedAt = new Date();

    await runCypher(
      [
        "MERGE (f:CodeFile {codeFileKey: $codeFileKey})",
        "SET f.graphKey = $graphKey,",
        "    f.path = $filePath,",
        "    f.extension = $extension,",
        "    f.checksum = $checksum,",
        "    f.indexedAt = datetime($indexedAt)",
      ].join("\n"),
      {
        codeFileKey,
        graphKey,
        filePath,
        extension: lazyPath().extname(filePath).toLowerCase(),
        checksum,
        indexedAt: indexedAt.toISOString(),
      },
    );

    await upsertCodeGraphFileHash({ graphKey, filePath, checksum, indexedAt });
  } catch {
    await runCypher(
      "MATCH (f:CodeFile {codeFileKey: $codeFileKey}) DETACH DELETE f",
      { codeFileKey },
    );
    await deleteCodeGraphFileHash(graphKey, filePath);
  }
}
```

- [ ] **Step 5: Move refresh planning and reconcile orchestration**

Create `apps/web/lib/integrate/code-graph/reconcile.ts`:

```ts
import { CODE_GRAPH_GRAPH_KEY } from "./constants";
import { getChangedFiles, getCurrentBranch, getCurrentHeadSha, getGitRoot, isWorkspaceDirty, listTrackedFiles } from "./git-snapshot";
import { clearCodeGraph, ensureCodeGraphNeo4jSchema, syncTrackedFile } from "./neo4j-projection";
import { countCodeGraphFileHashes, findCodeGraphIndexState, markCodeGraphFailed, markCodeGraphIndexing, markCodeGraphReady } from "./state-store";
import { prisma } from "@dpf/db";

export type CodeGraphRefreshMode = "noop" | "incremental" | "full";

export type CodeGraphRefreshPlan = {
  mode: CodeGraphRefreshMode;
  changedFiles: string[];
};

export type ReconcileCodeGraphInput = {
  reason: "git-commit" | "git-backup" | "scheduled" | "manual";
  graphKey?: string;
  forceFull?: boolean;
};

export type ReconcileCodeGraphResult = {
  mode: CodeGraphRefreshMode;
  graphKey: string;
  headSha: string | null;
  branch: string | null;
  workspaceDirty: boolean;
  changedFiles: string[];
};

export function planCodeGraphRefresh(input: {
  currentHeadSha: string | null;
  lastIndexedHeadSha: string | null;
  changedFiles: string[];
  diffFailed: boolean;
  forceFull: boolean;
}): CodeGraphRefreshPlan {
  if (input.forceFull || !input.lastIndexedHeadSha || !input.currentHeadSha || input.diffFailed) {
    return { mode: "full", changedFiles: [] };
  }

  if (input.currentHeadSha === input.lastIndexedHeadSha) {
    return { mode: "noop", changedFiles: [] };
  }

  return {
    mode: "incremental",
    changedFiles: input.changedFiles,
  };
}

export async function reconcileCodeGraph(input: ReconcileCodeGraphInput): Promise<ReconcileCodeGraphResult> {
  const graphKey = input.graphKey ?? CODE_GRAPH_GRAPH_KEY;
  const gitRoot = getGitRoot();
  const observedAt = new Date();
  let state = await findCodeGraphIndexState(graphKey);
  let headSha: string | null = null;
  let branch: string | null = null;
  let workspaceDirty = false;

  const lockRows = await prisma.$queryRaw<Array<{ locked: boolean }>>`
    SELECT pg_try_advisory_lock(hashtext(${`code-graph:${graphKey}`})) AS locked
  `;
  if (!lockRows[0]?.locked) {
    return {
      mode: "noop",
      graphKey,
      headSha: null,
      branch: null,
      workspaceDirty: false,
      changedFiles: [],
    };
  }

  try {
    [state, headSha, branch, workspaceDirty] = await Promise.all([
      findCodeGraphIndexState(graphKey),
      getCurrentHeadSha(gitRoot),
      getCurrentBranch(gitRoot),
      isWorkspaceDirty(gitRoot),
    ]);

    await markCodeGraphIndexing(graphKey, {
      workspaceRoot: gitRoot,
      headSha,
      branch,
      previousHeadSha: state?.lastIndexedHeadSha ?? null,
      workspaceDirty,
      observedAt,
    });

    let changedFiles: string[] = [];
    let diffFailed = false;
    if (state?.lastIndexedHeadSha && headSha && state.lastIndexedHeadSha !== headSha && !input.forceFull) {
      try {
        changedFiles = await getChangedFiles(gitRoot, state.lastIndexedHeadSha, headSha);
      } catch {
        diffFailed = true;
      }
    }

    const plan = planCodeGraphRefresh({
      currentHeadSha: headSha,
      lastIndexedHeadSha: state?.lastIndexedHeadSha ?? null,
      changedFiles,
      diffFailed,
      forceFull: input.forceFull ?? false,
    });

    const files = plan.mode === "full" ? await listTrackedFiles(gitRoot) : plan.changedFiles;
    await ensureCodeGraphNeo4jSchema();
    if (plan.mode === "full") {
      await clearCodeGraph(graphKey);
    }
    for (const filePath of files) {
      await syncTrackedFile(graphKey, gitRoot, filePath);
    }
    const indexedFileCount = await countCodeGraphFileHashes(graphKey);
    await markCodeGraphReady(graphKey, {
      workspaceRoot: gitRoot,
      headSha,
      branch,
      workspaceDirty,
      observedAt,
      indexedFileCount,
    });
    return { mode: plan.mode, graphKey, headSha, branch, workspaceDirty, changedFiles: files };
  } catch (error) {
    await markCodeGraphFailed(graphKey, {
      workspaceRoot: gitRoot,
      previousHeadSha: state?.lastIndexedHeadSha ?? null,
      branch,
      workspaceDirty,
      observedAt,
      error,
    });
    throw error;
  } finally {
    await prisma.$executeRaw`
      SELECT pg_advisory_unlock(hashtext(${`code-graph:${graphKey}`}))
    `;
  }
}

export async function ensureCodeGraphInitialized(input: {
  reconcile?: (input: ReconcileCodeGraphInput) => Promise<unknown>;
} = {}): Promise<void> {
  const existingState = await findCodeGraphIndexState(CODE_GRAPH_GRAPH_KEY);
  const needsBootstrap =
    !existingState ||
    (existingState.indexStatus === "failed" && !existingState.lastIndexedHeadSha && !existingState.lastIndexedAt);

  if (!needsBootstrap) return;

  const reconcile = input.reconcile ?? reconcileCodeGraph;
  await reconcile({
    reason: "manual",
    graphKey: CODE_GRAPH_GRAPH_KEY,
    forceFull: true,
  });
}
```

- [ ] **Step 6: Move scheduler code and preserve public imports**

Create `apps/web/lib/integrate/code-graph/scheduler.ts` by moving `registerCodeGraphScheduledJob()` and `queueCodeGraphReconcile()` from the current file.

Create `apps/web/lib/integrate/code-graph/index.ts`:

```ts
export * from "./constants";
export * from "./git-snapshot";
export * from "./hash";
export * from "./path-filter";
export * from "./reconcile";
export * from "./scheduler";
```

Replace `apps/web/lib/integrate/code-graph-refresh.ts` with:

```ts
export * from "./code-graph";
```

Update `apps/web/lib/integrate/code-graph-access.ts`:

```ts
import { CODE_GRAPH_GRAPH_KEY } from "./code-graph";
```

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/integrate/code-graph-refresh.test.ts apps/web/lib/integrate/change-impact.test.ts apps/web/lib/integrate/code-graph/path-filter.test.ts apps/web/lib/integrate/code-graph/git-snapshot.test.ts
pnpm --filter web typecheck
```

Expected: PASS with no behavior change.

- [ ] **Step 7: Commit Task 3**

```powershell
git status --short
git add apps/web/lib/integrate/code-graph-refresh.ts apps/web/lib/integrate/code-graph-access.ts apps/web/lib/integrate/code-graph
git commit -s -m "refactor: split code graph refresh pipeline"
```

---

### Task 4: Add Structural Graph Facts

**Files:**
- Create: `apps/web/lib/integrate/code-graph/types.ts`
- Create: `apps/web/lib/integrate/code-graph/extractors/typescript.ts`
- Create: `apps/web/lib/integrate/code-graph/extractors/next-routes.ts`
- Create: `apps/web/lib/integrate/code-graph/extractors/prisma.ts`
- Create: `apps/web/lib/integrate/code-graph/extractors/mcp-tools.ts`
- Create: `apps/web/lib/integrate/code-graph/extractors/tests.ts`
- Modify: `apps/web/lib/integrate/code-graph/neo4j-projection.ts`
- Modify: `packages/db/src/neo4j-schema.ts`

- [ ] **Step 1: Define shared structural fact types**

Create `apps/web/lib/integrate/code-graph/types.ts`:

```ts
export type CodeGraphNodeKind =
  | "CodeFile"
  | "CodeSymbol"
  | "CodeRoute"
  | "CodeTool"
  | "PrismaModel"
  | "PromptTemplateSource"
  | "TestFile";

export type CodeGraphEdgeKind =
  | "DEFINES"
  | "IMPORTS"
  | "REFERENCES"
  | "IMPLEMENTS_ROUTE"
  | "EXPOSES_TOOL"
  | "USES_MODEL"
  | "USES_PROMPT"
  | "TESTED_BY";

export type CodeGraphConfidence = "exact" | "heuristic";

export type CodeGraphNodeFact = {
  graphKey: string;
  kind: CodeGraphNodeKind;
  key: string;
  name: string;
  filePath: string;
  startLine: number | null;
  endLine: number | null;
  extractor: string;
};

export type CodeGraphEdgeFact = {
  graphKey: string;
  kind: CodeGraphEdgeKind;
  fromKey: string;
  toKey: string;
  filePath: string;
  startLine: number | null;
  endLine: number | null;
  confidence: CodeGraphConfidence;
  extractor: string;
};

export type CodeGraphExtraction = {
  nodes: CodeGraphNodeFact[];
  edges: CodeGraphEdgeFact[];
};

export function mergeExtractions(extractions: CodeGraphExtraction[]): CodeGraphExtraction {
  return {
    nodes: extractions.flatMap((entry) => entry.nodes),
    edges: extractions.flatMap((entry) => entry.edges),
  };
}

export type CodeGraphExtractorInput = {
  graphKey: string;
  filePath: string;
  sourceText: string;
};

export type CodeGraphExtractor = {
  name: string;
  version: string;
  matches(filePath: string): boolean;
  extract(input: CodeGraphExtractorInput): CodeGraphExtraction;
};
```

Then create `apps/web/lib/integrate/code-graph/extractors/index.ts` as the **registry** (the only file that lists extractors). New extractors land by appending here plus a snapshot test — the projection layer iterates this list and does not need editing:

```ts
import type { CodeGraphExtractor } from "../types";
import { typeScriptExtractor } from "./typescript";
import { nextRouteExtractor } from "./next-routes";
import { prismaExtractor } from "./prisma";
import { mcpToolExtractor } from "./mcp-tools";
import { testExtractor } from "./tests";

export const CODE_GRAPH_EXTRACTORS: CodeGraphExtractor[] = [
  typeScriptExtractor,
  nextRouteExtractor,
  prismaExtractor,
  mcpToolExtractor,
  testExtractor,
];
```

Each individual extractor file exports a `CodeGraphExtractor` value, not just a function — for example `export const typeScriptExtractor: CodeGraphExtractor = { name: "typescript", version: "v1", matches, extract };`. Tests assert both the function output **and** that the registry contains the extractor.

- [ ] **Step 2: Extend Neo4j schema for code intelligence**

In `packages/db/src/neo4j-schema.ts`, add constraints and indexes:

```ts
  "CREATE CONSTRAINT cs_symbolKey IF NOT EXISTS FOR (n:CodeSymbol) REQUIRE n.symbolKey IS UNIQUE",
  "CREATE CONSTRAINT cr_routeKey IF NOT EXISTS FOR (n:CodeRoute) REQUIRE n.routeKey IS UNIQUE",
  "CREATE CONSTRAINT ct_toolKey IF NOT EXISTS FOR (n:CodeTool) REQUIRE n.toolKey IS UNIQUE",
  "CREATE CONSTRAINT pm_modelKey IF NOT EXISTS FOR (n:PrismaModel) REQUIRE n.modelKey IS UNIQUE",
  "CREATE CONSTRAINT pts_promptKey IF NOT EXISTS FOR (n:PromptTemplateSource) REQUIRE n.promptKey IS UNIQUE",
  "CREATE CONSTRAINT tf_testFileKey IF NOT EXISTS FOR (n:TestFile) REQUIRE n.testFileKey IS UNIQUE",
  "CREATE INDEX cs_graphKey IF NOT EXISTS FOR (n:CodeSymbol) ON (n.graphKey)",
  "CREATE INDEX cr_graphKey IF NOT EXISTS FOR (n:CodeRoute) ON (n.graphKey)",
  "CREATE INDEX ct_graphKey IF NOT EXISTS FOR (n:CodeTool) ON (n.graphKey)",
  "CREATE INDEX pm_graphKey IF NOT EXISTS FOR (n:PrismaModel) ON (n.graphKey)",
  "CREATE INDEX tf_graphKey IF NOT EXISTS FOR (n:TestFile) ON (n.graphKey)",
```

Mirror these statements in `ensureCodeGraphNeo4jSchema()` inside `apps/web/lib/integrate/code-graph/neo4j-projection.ts`.

- [ ] **Step 3: Add TypeScript extractor tests and implementation**

Create `apps/web/lib/integrate/code-graph/extractors/typescript.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { extractTypeScriptFacts } from "./typescript";

describe("extractTypeScriptFacts", () => {
  it("extracts imports and exported symbols", () => {
    const result = extractTypeScriptFacts({
      graphKey: "source-code",
      filePath: "apps/web/lib/example.ts",
      sourceText: [
        'import { prisma } from "@dpf/db";',
        'import { helper } from "./helper";',
        "export function getThing() { return helper(prisma); }",
      ].join("\n"),
    });

    expect(result.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "CodeSymbol", name: "getThing" }),
    ]));
    expect(result.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "IMPORTS", toKey: "source-code:module:@dpf/db" }),
      expect.objectContaining({ kind: "IMPORTS", toKey: "source-code:module:apps/web/lib/helper" }),
    ]));
  });
});
```

Create `apps/web/lib/integrate/code-graph/extractors/typescript.ts` using the TypeScript Compiler API:

```ts
import ts from "typescript";
import type { CodeGraphExtraction, CodeGraphNodeFact, CodeGraphEdgeFact } from "../types";

const EXTRACTOR = "typescript-ast-v1";

type Input = {
  graphKey: string;
  filePath: string;
  sourceText: string;
};

function lineFor(sourceFile: ts.SourceFile, position: number): number {
  return sourceFile.getLineAndCharacterOfPosition(position).line + 1;
}

function moduleKey(graphKey: string, moduleName: string, filePath: string): string {
  if (moduleName.startsWith(".")) {
    const base = filePath.split("/").slice(0, -1).join("/");
    return `${graphKey}:module:${base}/${moduleName.replace(/^\.\//, "")}`.replace(/\/+/g, "/");
  }
  return `${graphKey}:module:${moduleName}`;
}

export function extractTypeScriptFacts(input: Input): CodeGraphExtraction {
  const sourceFile = ts.createSourceFile(input.filePath, input.sourceText, ts.ScriptTarget.Latest, true);
  const fileKey = `${input.graphKey}:${input.filePath}`;
  const nodes: CodeGraphNodeFact[] = [];
  const edges: CodeGraphEdgeFact[] = [];

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      edges.push({
        graphKey: input.graphKey,
        kind: "IMPORTS",
        fromKey: fileKey,
        toKey: moduleKey(input.graphKey, node.moduleSpecifier.text, input.filePath),
        filePath: input.filePath,
        startLine: lineFor(sourceFile, node.getStart(sourceFile)),
        endLine: lineFor(sourceFile, node.getEnd()),
        confidence: "exact",
        extractor: EXTRACTOR,
      });
    }

    const name = "name" in node && node.name && ts.isIdentifier(node.name) ? node.name.text : null;
    const exported = ts.canHaveModifiers(node) && Boolean(ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
    if (name && exported && (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node))) {
      const symbolKey = `${input.graphKey}:symbol:${input.filePath}:${name}`;
      nodes.push({
        graphKey: input.graphKey,
        kind: "CodeSymbol",
        key: symbolKey,
        name,
        filePath: input.filePath,
        startLine: lineFor(sourceFile, node.getStart(sourceFile)),
        endLine: lineFor(sourceFile, node.getEnd()),
        extractor: EXTRACTOR,
      });
      edges.push({
        graphKey: input.graphKey,
        kind: "DEFINES",
        fromKey: fileKey,
        toKey: symbolKey,
        filePath: input.filePath,
        startLine: lineFor(sourceFile, node.getStart(sourceFile)),
        endLine: lineFor(sourceFile, node.getEnd()),
        confidence: "exact",
        extractor: EXTRACTOR,
      });
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return { nodes, edges };
}
```

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/integrate/code-graph/extractors/typescript.test.ts
```

Expected: PASS.

- [ ] **Step 4: Add route, Prisma, MCP-tool, and test extractors**

Create extractor tests first, then implement each extractor:

`next-routes.test.ts` expected facts:

```ts
expect(extractNextRouteFacts({
  graphKey: "source-code",
  filePath: "apps/web/app/(shell)/build/page.tsx",
}).nodes).toEqual(expect.arrayContaining([
  expect.objectContaining({ kind: "CodeRoute", name: "/build" }),
]));
```

`prisma.test.ts` expected facts:

```ts
expect(extractPrismaFacts({
  graphKey: "source-code",
  filePath: "packages/db/prisma/schema.prisma",
  sourceText: "model FeatureBuild {\n  id String @id\n}\n",
}).nodes).toEqual(expect.arrayContaining([
  expect.objectContaining({ kind: "PrismaModel", name: "FeatureBuild" }),
]));
```

`mcp-tools.test.ts` expected facts:

```ts
expect(extractMcpToolFacts({
  graphKey: "source-code",
  filePath: "apps/web/lib/mcp-tools.ts",
  sourceText: 'const tools = [{ name: "get_code_graph_freshness", description: "Get graph" }];',
}).nodes).toEqual(expect.arrayContaining([
  expect.objectContaining({ kind: "CodeTool", name: "get_code_graph_freshness" }),
]));
```

`tests.test.ts` expected facts (AST-based, not filename-based):

```ts
const result = extractTestFileFacts({
  graphKey: "source-code",
  filePath: "apps/web/lib/integrate/change-impact.test.ts",
  sourceText: 'import { analyzeChangeImpact } from "./change-impact";',
});

expect(result.nodes).toEqual(expect.arrayContaining([
  expect.objectContaining({ kind: "TestFile", name: "change-impact.test.ts" }),
]));

// AST-resolved import → exact-confidence TESTED_BY edge into the imported source file.
expect(result.edges).toEqual(expect.arrayContaining([
  expect.objectContaining({
    kind: "TESTED_BY",
    toKey: "source-code:apps/web/lib/integrate/change-impact.ts",
    confidence: "exact",
  }),
]));
```

And a heuristic fallback case (no resolvable import to a tracked source — fall back to filename-stem matching):

```ts
const fallback = extractTestFileFacts({
  graphKey: "source-code",
  filePath: "apps/web/lib/integrate/orphan-feature.test.ts",
  sourceText: "describe('orphan', () => {});",
});

expect(fallback.edges.some((edge) => edge.confidence === "heuristic")).toBe(true);
```

Implementation rules (binding):
- Use AST parsing for TypeScript files (`ts.createSourceFile`).
- Use line-based parsing for Prisma model declarations.
- Use route path derivation from `apps/web/app` segments, dropping route groups such as `(shell)` and treating `page.tsx`, `layout.tsx`, and `route.ts(x)` as the route entrypoints.
- Test → source resolution **must** prefer AST-resolved imports (relative + path-alias). Mark those `confidence: "exact"`.
- Only when no import resolves to a tracked source may the extractor fall back to filename-stem matching (e.g., `change-impact.test.ts` → `change-impact.ts`). Those edges **must** carry `confidence: "heuristic"`.
- Emit synthetic `ExternalModule` nodes (key `source-code:module:<specifier>`) for unresolved imports so no edge becomes an orphan.

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/integrate/code-graph/extractors
```

Expected: PASS.

- [ ] **Step 5: Project structural facts during file sync**

Extend `syncTrackedFile()` in `apps/web/lib/integrate/code-graph/neo4j-projection.ts` to drive extraction from the registry, not a hand-wired list:

```ts
import { mergeExtractions } from "./types";
import { CODE_GRAPH_EXTRACTORS } from "./extractors";
import { recordExtractionWarning } from "./state-store"; // see Step 5b
```

After the `CodeFile` merge, run every extractor whose `matches()` returns `true` for the path. Surface per-extractor failures as warnings on `CodeGraphIndexState` — never swallow them:

```ts
    const extractions: CodeGraphExtraction[] = [];
    for (const extractor of CODE_GRAPH_EXTRACTORS) {
      if (!extractor.matches(filePath)) continue;
      try {
        extractions.push(extractor.extract({ graphKey, filePath, sourceText: content }));
      } catch (error) {
        await recordExtractionWarning({
          graphKey,
          filePath,
          extractor: extractor.name,
          message: error instanceof Error ? error.message : String(error),
          observedAt: new Date(),
        });
      }
    }
    const extraction = mergeExtractions(extractions);
```

Adding a new extractor in the future requires only: appending to `CODE_GRAPH_EXTRACTORS`, providing a `matches()` predicate, and shipping a snapshot test. The projection layer never changes.

Add helper functions in the same file:

```ts
async function projectNodeFact(fact: CodeGraphNodeFact): Promise<void> {
  const label = fact.kind;
  const keyField = `${label.charAt(0).toLowerCase()}${label.slice(1)}Key`;
  await runCypher(
    [
      `MERGE (n:${label} {${keyField}: $key})`,
      "SET n.graphKey = $graphKey,",
      "    n.name = $name,",
      "    n.path = $filePath,",
      "    n.startLine = $startLine,",
      "    n.endLine = $endLine,",
      "    n.extractor = $extractor",
    ].join("\n"),
    fact,
  );
}

async function projectEdgeFact(fact: CodeGraphEdgeFact): Promise<void> {
  await runCypher(
    [
      "MATCH (from {graphKey: $graphKey})",
      "WHERE any(key IN keys(from) WHERE from[key] = $fromKey)",
      "MATCH (to {graphKey: $graphKey})",
      "WHERE any(key IN keys(to) WHERE to[key] = $toKey)",
      `MERGE (from)-[r:${fact.kind} {graphKey: $graphKey, fromKey: $fromKey, toKey: $toKey}]->(to)`,
      "SET r.filePath = $filePath,",
      "    r.startLine = $startLine,",
      "    r.endLine = $endLine,",
      "    r.confidence = $confidence,",
      "    r.extractor = $extractor",
    ].join("\n"),
    fact,
  );
}
```

Before projecting new facts for a file, delete old structural facts for that `graphKey` and `filePath` so reindexing is idempotent.

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/integrate/code-graph apps/web/lib/integrate/code-graph-refresh.test.ts
pnpm --filter web typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```powershell
git status --short
git add apps/web/lib/integrate/code-graph packages/db/src/neo4j-schema.ts
git commit -s -m "feat: extract structural code graph facts"
```

---

### Task 5: Add Graph-Backed Query Tools

**Files:**
- Create: `apps/web/lib/integrate/code-graph/graph-queries.ts`
- Create: `apps/web/lib/integrate/code-graph/graph-queries.test.ts`
- Modify: `apps/web/lib/mcp-tools.ts`
- Modify: `apps/web/lib/mcp-tools.test.ts`
- Modify: `apps/web/lib/tak/agent-grants.ts`
- Modify: `apps/web/lib/tak/agent-grants.test.ts`
- Modify: `packages/db/data/grant_catalog.json`
- Modify: `apps/web/lib/tak/route-context-map.ts`
- Modify: `apps/web/lib/tak/route-context-map.test.ts`

- [ ] **Step 1: Add typed graph query tests**

Create `apps/web/lib/integrate/code-graph/graph-queries.test.ts` with mocked `runCypher`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  runCypher: vi.fn(),
}));

import { runCypher } from "@dpf/db";
import { searchCodeGraph, traceCodeSurface, findRelatedTests } from "./graph-queries";

const runCypherMock = runCypher as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  runCypherMock.mockReset();
});

describe("graph-queries", () => {
  it("searches structural graph nodes by name", async () => {
    runCypherMock.mockResolvedValue([{ kind: "CodeRoute", name: "/build", path: "apps/web/app/(shell)/build/page.tsx" }]);
    const result = await searchCodeGraph({ query: "build" });
    expect(result.items[0]).toMatchObject({ kind: "CodeRoute", name: "/build" });
    expect(result.warnings).toEqual([]);
  });

  it("traces a route surface", async () => {
    runCypherMock.mockResolvedValue([{ path: "apps/web/app/(shell)/build/page.tsx", relationship: "IMPLEMENTS_ROUTE", confidence: "exact" }]);
    const result = await traceCodeSurface({ route: "/build" });
    expect(result.items[0]).toMatchObject({ relationship: "IMPLEMENTS_ROUTE" });
  });

  it("finds related tests for a source path", async () => {
    runCypherMock.mockResolvedValue([{ testPath: "apps/web/lib/integrate/change-impact.test.ts", confidence: "heuristic" }]);
    const result = await findRelatedTests({ filePath: "apps/web/lib/integrate/change-impact.ts" });
    expect(result.items[0]).toMatchObject({ testPath: "apps/web/lib/integrate/change-impact.test.ts" });
  });
});
```

- [ ] **Step 2: Implement the query service**

Create `apps/web/lib/integrate/code-graph/graph-queries.ts`:

```ts
import { runCypher } from "@dpf/db";
import { CODE_GRAPH_GRAPH_KEY } from "./constants";

type QueryWarning = string;

export type CodeGraphSearchInput = {
  query: string;
  graphKey?: string;
  limit?: number;
};

export type CodeGraphSearchResult = {
  items: Array<{ kind: string; name: string; path: string | null; startLine?: number | null; endLine?: number | null }>;
  warnings: QueryWarning[];
};

export async function searchCodeGraph(input: CodeGraphSearchInput): Promise<CodeGraphSearchResult> {
  const query = input.query.trim();
  if (!query) return { items: [], warnings: ["Search query is empty."] };
  const graphKey = input.graphKey ?? CODE_GRAPH_GRAPH_KEY;
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
  const rows = await runCypher<CodeGraphSearchResult["items"][number]>(
    [
      "MATCH (n)",
      "WHERE n.graphKey = $graphKey AND any(label IN labels(n) WHERE label IN $labels)",
      "  AND toLower(coalesce(n.name, n.path, '')) CONTAINS toLower($query)",
      "RETURN labels(n)[0] AS kind, n.name AS name, n.path AS path, n.startLine AS startLine, n.endLine AS endLine",
      "ORDER BY kind, name",
      "LIMIT $limit",
    ].join("\n"),
    { graphKey, query, limit, labels: ["CodeFile", "CodeSymbol", "CodeRoute", "CodeTool", "PrismaModel", "PromptTemplateSource", "TestFile"] },
  );
  return { items: rows, warnings: [] };
}

export async function traceCodeSurface(input: { route?: string; tool?: string; model?: string; graphKey?: string }) {
  const graphKey = input.graphKey ?? CODE_GRAPH_GRAPH_KEY;
  const target = input.route ?? input.tool ?? input.model ?? "";
  if (!target.trim()) return { items: [], warnings: ["Provide route, tool, or model."] };
  const rows = await runCypher<{ path: string; relationship: string; confidence: string }>(
    [
      "MATCH (n {graphKey: $graphKey})-[r]-(m)",
      "WHERE n.name = $target",
      "RETURN coalesce(m.path, n.path) AS path, type(r) AS relationship, coalesce(r.confidence, 'exact') AS confidence",
      "ORDER BY path",
      "LIMIT 50",
    ].join("\n"),
    { graphKey, target },
  );
  return { items: rows, warnings: [] };
}

export async function findRelatedTests(input: { filePath: string; graphKey?: string }) {
  const graphKey = input.graphKey ?? CODE_GRAPH_GRAPH_KEY;
  const filePath = input.filePath.trim();
  if (!filePath) return { items: [], warnings: ["File path is empty."] };
  const rows = await runCypher<{ testPath: string; confidence: string }>(
    [
      "MATCH (f:CodeFile {graphKey: $graphKey, path: $filePath})-[:TESTED_BY]-(t:TestFile)",
      "RETURN t.path AS testPath, 'heuristic' AS confidence",
      "ORDER BY testPath",
    ].join("\n"),
    { graphKey, filePath },
  );
  return { items: rows, warnings: [] };
}
```

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/integrate/code-graph/graph-queries.test.ts
```

Expected: PASS.

- [ ] **Step 3: Add MCP tool definitions and handlers**

In `apps/web/lib/mcp-tools.ts`, add tool definitions:

```ts
  {
    name: "search_code_graph",
    description: "Search deterministic code graph facts such as routes, tools, models, files, test files, and exported symbols. Returns source paths and freshness warnings.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number" },
      },
      required: ["query"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["ideate", "plan", "review", "ship"],
  },
  {
    name: "trace_code_surface",
    description: "Trace related files for a route, MCP tool, or Prisma model using deterministic code graph edges.",
    inputSchema: {
      type: "object",
      properties: {
        route: { type: "string" },
        tool: { type: "string" },
        model: { type: "string" },
      },
      required: [],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["ideate", "plan", "review", "ship"],
  },
  {
    name: "find_related_tests",
    description: "Find test files related to a source file according to code graph test relationships.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: { type: "string" },
      },
      required: ["filePath"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["plan", "review", "ship"],
  },
```

Add handlers:

```ts
    case "search_code_graph": {
      const { getCodeGraphFreshness } = await import("@/lib/integrate/code-graph-access");
      const { searchCodeGraph } = await import("@/lib/integrate/code-graph/graph-queries");
      const freshness = await getCodeGraphFreshness();
      if (!freshness.available || freshness.indexStatus === "missing" || freshness.indexStatus === "failed") {
        return {
          success: false,
          message: `Code graph is ${freshness.indexStatus}; cannot search.`,
          data: { items: [], warnings: freshness.warnings },
        };
      }
      const result = await searchCodeGraph({
        query: String(params["query"] ?? ""),
        limit: typeof params["limit"] === "number" ? params["limit"] : undefined,
      });
      return {
        success: true,
        message: `Found ${result.items.length} code graph result(s).`,
        data: { ...result, warnings: [...result.warnings, ...freshness.warnings] },
      };
    }

    case "trace_code_surface": {
      const { getCodeGraphFreshness } = await import("@/lib/integrate/code-graph-access");
      const { traceCodeSurface } = await import("@/lib/integrate/code-graph/graph-queries");
      const freshness = await getCodeGraphFreshness();
      if (!freshness.available || freshness.indexStatus === "missing" || freshness.indexStatus === "failed") {
        return {
          success: false,
          message: `Code graph is ${freshness.indexStatus}; cannot trace surface.`,
          data: { items: [], warnings: freshness.warnings },
        };
      }
      const result = await traceCodeSurface({
        route: typeof params["route"] === "string" ? params["route"] : undefined,
        tool: typeof params["tool"] === "string" ? params["tool"] : undefined,
        model: typeof params["model"] === "string" ? params["model"] : undefined,
      });
      return {
        success: true,
        message: `Traced ${result.items.length} related code graph item(s).`,
        data: { ...result, warnings: [...result.warnings, ...freshness.warnings] },
      };
    }

    case "find_related_tests": {
      const { getCodeGraphFreshness } = await import("@/lib/integrate/code-graph-access");
      const { findRelatedTests } = await import("@/lib/integrate/code-graph/graph-queries");
      const freshness = await getCodeGraphFreshness();
      if (!freshness.available || freshness.indexStatus === "missing" || freshness.indexStatus === "failed") {
        return {
          success: false,
          message: `Code graph is ${freshness.indexStatus}; cannot find related tests.`,
          data: { items: [], warnings: freshness.warnings },
        };
      }
      const result = await findRelatedTests({ filePath: String(params["filePath"] ?? "") });
      return {
        success: true,
        message: `Found ${result.items.length} related test file(s).`,
        data: { ...result, warnings: [...result.warnings, ...freshness.warnings] },
      };
    }
```

This makes `success: false` mean "graph cannot answer" instead of "graph answered with nothing." That distinction is the silent-failure prevention rule from the spec — callers can branch on it. Add a test for each handler that mocks `indexStatus: "missing"` and asserts `success === false`.

- [ ] **Step 4: Map grants and route context for new graph tools**

In `apps/web/lib/tak/agent-grants.ts`:

```ts
  search_code_graph: ["code_graph_read"],
  trace_code_surface: ["code_graph_read"],
  find_related_tests: ["code_graph_read"],
```

In `packages/db/data/grant_catalog.json`, add the new names to `code_graph_read.honored_by_tools`.

In `apps/web/lib/tak/route-context-map.ts`, add the new names to `/build` domain tools under the code intelligence comment.

Update tests:

```ts
expect(mapping["search_code_graph"]).toEqual(["code_graph_read"]);
expect(mapping["trace_code_surface"]).toEqual(["code_graph_read"]);
expect(mapping["find_related_tests"]).toEqual(["code_graph_read"]);
```

```ts
expect(buildRoute!.domainTools).toContain("search_code_graph");
expect(buildRoute!.domainTools).toContain("trace_code_surface");
expect(buildRoute!.domainTools).toContain("find_related_tests");
```

Update `apps/web/lib/mcp-tools.test.ts`:

```ts
expect(toolNames).toContain("search_code_graph");
expect(toolNames).toContain("trace_code_surface");
expect(toolNames).toContain("find_related_tests");
```

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/mcp-tools.test.ts apps/web/lib/tak/agent-grants.test.ts apps/web/lib/tak/route-context-map.test.ts apps/web/lib/integrate/code-graph/graph-queries.test.ts
pnpm --filter web typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit Task 5**

```powershell
git status --short
git add apps/web/lib/integrate/code-graph/graph-queries.ts apps/web/lib/integrate/code-graph/graph-queries.test.ts apps/web/lib/mcp-tools.ts apps/web/lib/mcp-tools.test.ts apps/web/lib/tak/agent-grants.ts apps/web/lib/tak/agent-grants.test.ts packages/db/data/grant_catalog.json apps/web/lib/tak/route-context-map.ts apps/web/lib/tak/route-context-map.test.ts
git commit -s -m "feat: add graph-backed code intelligence tools"
```

---

### Task 6: Make Build Studio Use Graph Evidence During Plan, Review, and Ship

**Files:**
- Modify: `apps/web/lib/integrate/build-agent-prompts.ts`
- Modify: `apps/web/lib/integrate/build-agent-prompts.test.ts`
- Modify: `apps/web/lib/integrate/change-impact.ts`
- Modify: `apps/web/lib/integrate/change-impact.test.ts`
- Modify: `apps/web/lib/routing/cli-adapter.ts`
- Modify: `apps/web/lib/routing/codex-cli-adapter.ts`
- Modify: `apps/web/lib/routing/cli-adapter.test.ts`
- Modify: `apps/web/lib/routing/codex-cli-adapter.test.ts`

- [ ] **Step 1: Add prompt tests for graph-use guidance**

In `apps/web/lib/integrate/build-agent-prompts.test.ts`, add:

```ts
it("tells Build Studio agents to use code graph tools when available", () => {
  const context = getBuildContextSection({
    buildId: "FB-GRAPH",
    phase: "plan",
    title: "Graph adoption",
    description: "Use graph",
  } as never);

  expect(context).toContain("get_code_graph_freshness");
  expect(context).toContain("search_code_graph");
  expect(context).toContain("trace_code_surface");
  expect(context).toContain("find_related_tests");
  expect(context).toContain("If graph freshness is missing, stale, or file-only");
});
```

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/integrate/build-agent-prompts.test.ts
```

Expected: FAIL until the prompt is updated.

- [ ] **Step 2: Add graph-use guidance to Build Studio context**

In `apps/web/lib/integrate/build-agent-prompts.ts`, add a section to the generated Build Studio context:

```ts
CODE INTELLIGENCE:
- At the start of Plan, Review, and Ready to Ship, call get_code_graph_freshness.
- For source discovery, prefer search_code_graph or trace_code_surface when the graph is ready, then confirm exact code with read_project_file.
- For verification targeting, call find_related_tests for changed source files, then run the relevant tests.
- If graph freshness is missing, stale, or file-only, say that explicitly and fall back to search_project_files plus read_project_file.
- Do not claim symbol-level blast radius unless trace_code_surface returns structural edges with source paths.
```

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/integrate/build-agent-prompts.test.ts
```

Expected: PASS.

- [ ] **Step 3: Add related-test targeting to change impact**

In `apps/web/lib/integrate/change-impact.test.ts`, add a test that mocks `findRelatedTests` and verifies the report includes `relatedTests`.

Expected report shape:

```ts
expect(result.codeGraph).toEqual(expect.objectContaining({
  relatedTests: expect.arrayContaining(["apps/web/lib/integrate/change-impact.test.ts"]),
}));
```

Update `ChangeImpactReport` in `apps/web/lib/integrate/change-impact.ts`:

```ts
codeGraph: CodeGraphCoverageSummary & {
  relatedTests?: string[];
};
```

After `summarizeCodeGraphCoverage(changedFiles)`, call `findRelatedTests` for each indexed changed file and merge unique test paths:

```ts
const relatedTests = new Set<string>();
for (const filePath of graphCoverage.indexedFiles) {
  const tests = await findRelatedTests({ filePath });
  for (const item of tests.items) relatedTests.add(item.testPath);
}
```

Attach:

```ts
codeGraph: {
  ...graphCoverage,
  relatedTests: [...relatedTests].sort(),
},
```

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/integrate/change-impact.test.ts
```

Expected: PASS.

- [ ] **Step 4: Add graph tool keywords to CLI adapters while adapter work remains open**

In `apps/web/lib/routing/cli-adapter.ts` and `apps/web/lib/routing/codex-cli-adapter.ts`, extend `toolKeywordPattern` with:

```ts
get_code_graph_freshness|inspect_build_code_impact|search_code_graph|trace_code_surface|find_related_tests
```

Add adapter tests that assert these tool names survive prompt/tool bridging when Build Studio passes them.

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/routing/cli-adapter.test.ts apps/web/lib/routing/codex-cli-adapter.test.ts
pnpm --filter web typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit Task 6**

```powershell
git status --short
git add apps/web/lib/integrate/build-agent-prompts.ts apps/web/lib/integrate/build-agent-prompts.test.ts apps/web/lib/integrate/change-impact.ts apps/web/lib/integrate/change-impact.test.ts apps/web/lib/routing/cli-adapter.ts apps/web/lib/routing/codex-cli-adapter.ts apps/web/lib/routing/cli-adapter.test.ts apps/web/lib/routing/codex-cli-adapter.test.ts
git commit -s -m "feat: use graph evidence in build studio"
```

---

### Task 7: Production Verification and Runtime Evidence

**Files:**
- Modify only if failures reveal code defects.

- [ ] **Step 1: Run focused tests**

```powershell
pnpm --filter web exec vitest run apps/web/lib/tak/route-context-map.test.ts apps/web/lib/tak/agent-grants.test.ts apps/web/lib/actions/mcp-tokens.test.ts apps/web/lib/mcp-token-scopes.test.ts apps/web/components/build/CodeIntelligenceStatusCard.test.tsx apps/web/lib/integrate/code-graph apps/web/lib/integrate/change-impact.test.ts apps/web/lib/mcp-tools.test.ts apps/web/lib/integrate/build-agent-prompts.test.ts apps/web/lib/routing/cli-adapter.test.ts apps/web/lib/routing/codex-cli-adapter.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

```powershell
pnpm --filter web typecheck
```

Expected: PASS.

- [ ] **Step 3: Run production build**

```powershell
pnpm --filter web exec next build
```

Expected: PASS with zero TypeScript or Next.js build errors.

- [ ] **Step 4: Verify graph runtime state — structural counts, not just files**

With Docker services running, verify Postgres and Neo4j. The structural counts are what prove Slice 3+4 landed; checking only `CodeFile` would have passed even when only Slice 1 was deployed.

```powershell
docker compose exec -T postgres psql -U dpf -d dpf -c "select \"graphKey\", \"indexStatus\", \"lastIndexedBranch\", \"lastIndexedHeadSha\", \"workspaceDirty\", \"indexedFileCount\", \"lastError\" from \"CodeGraphIndexState\" where \"graphKey\"='source-code';"
docker compose exec -T neo4j cypher-shell -u neo4j -p "$env:NEO4J_PASSWORD" `
  "MATCH (f:CodeFile      {graphKey:'source-code'}) WITH count(f) AS files
   MATCH (s:CodeSymbol    {graphKey:'source-code'}) WITH files, count(s) AS symbols
   MATCH (r:CodeRoute     {graphKey:'source-code'}) WITH files, symbols, count(r) AS routes
   MATCH (t:CodeTool      {graphKey:'source-code'}) WITH files, symbols, routes, count(t) AS tools
   MATCH (p:PrismaModel   {graphKey:'source-code'}) WITH files, symbols, routes, tools, count(p) AS models
   MATCH (x:TestFile      {graphKey:'source-code'}) RETURN files, symbols, routes, tools, models, count(x) AS tests"
docker compose exec -T neo4j cypher-shell -u neo4j -p "$env:NEO4J_PASSWORD" `
  "MATCH (a)-[r {graphKey:'source-code'}]->(b) RETURN type(r) AS rel, count(*) AS n ORDER BY rel"
```

Expected:
- `indexStatus` is `ready`.
- `indexedFileCount` is greater than `0`.
- Structural counts are all `> 0` after Slice 3 lands (routes ≥ 50, tools ≥ 30, models ≥ 50 for the current DPF repo as of 2026-05-12; treat these as smoke-level lower bounds, not assertions).
- Relationship histogram shows non-zero counts for `DEFINES`, `IMPORTS`, `IMPLEMENTS_ROUTE`, `EXPOSES_TOOL`, `USES_MODEL`, and `TESTED_BY`. A zero in any of these is a regression in the corresponding extractor.

- [ ] **Step 5: Verify external MCP graph tools**

Issue or reissue a read-only MCP token from Admin > Platform Development with these scopes:

```text
architecture_read
backlog_read
code_graph_read
file_read
spec_plan_read
```

Call MCP:

```powershell
$body = @{ jsonrpc = "2.0"; id = 1; method = "tools/list"; params = @{} } | ConvertTo-Json -Depth 6
Invoke-RestMethod -Method Post -Uri "http://localhost:3000/api/mcp/v1" -Headers @{ Authorization = "Bearer $env:DPF_MCP_TOKEN" } -Body $body -ContentType "application/json"
```

Expected: tool list includes `get_code_graph_freshness`, `inspect_build_code_impact`, `search_code_graph`, `trace_code_surface`, and `find_related_tests`.

- [ ] **Step 6: Verify Build Studio UI**

1. Read `ADMIN_PASSWORD` from repo-root `.env`.
2. Open the Docker-served app URL from `AUTH_URL` or `APP_URL`.
3. Log in as `admin@dpf.local`.
4. Navigate to `/build`.
5. Confirm the Code Intelligence panel appears in the graph view.
6. Confirm it shows branch, commit, indexed file count, and warnings when the graph is dirty or stale.
7. Ask the Build Studio coworker to review a build and confirm ToolExecution rows record graph tool calls when graph tools are available.

Expected:
- No layout overlap at desktop width.
- Text uses DPF token colors.
- ToolExecution rows exist for graph tool calls during graph-backed review.

- [ ] **Step 7: Record backlog evidence**

Use the governed DPF MCP backlog tool `record_execution_evidence` for the active implementation item:

```json
{
  "itemId": "<active item id>",
  "kind": "ux_verified",
  "summary": "Code intelligence graph tools and Build Studio status panel verified",
  "body": "Verified graph freshness, MCP tool availability, Build Studio UI panel, focused tests, typecheck, and production build."
}
```

If no active backlog item exists, create one under the existing Build Studio or platform-development epic before recording evidence.

- [ ] **Step 8: Commit verification fixes if any were required**

Only run this step when verification changed source files. Use `--only` so concurrent sessions don't get swept in:

```powershell
git status --short
git commit -s --only <changed source files> -m "fix: address code intelligence verification findings"
```

- [ ] **Step 9: Pre-push overlap sweep**

Concurrent Claude sessions may be fixing the same surface. Before pushing this branch:

```powershell
git fetch origin
git log --oneline origin/main..HEAD
git log --oneline --since="14 days ago" origin/main -- apps/web/lib/integrate/code-graph apps/web/lib/integrate/code-graph-refresh.ts apps/web/lib/mcp-tools.ts apps/web/lib/tak/agent-grants.ts packages/db/data/grant_catalog.json
gh pr list --state open --search "code graph OR code intelligence"
```

If any open PR or recent commit overlaps with the files this branch touches, pause and reconcile before pushing. Re-run this sweep before every push, not just once — overlapping work can land mid-execution.

---

## Completion Criteria

- `/build` route context exposes graph tools.
- Build Specialist has `code_graph_read` in registry and seed grants, and the seed-ladder invariant test passes (`grant_catalog.json` ↔ `agent-grants.ts`).
- New MCP coding-agent tokens include `code_graph_read` by default when the scope is available.
- Build Studio visibly displays graph freshness, source branch, commit, file count, and warnings.
- `code-graph-refresh.ts` is no longer the home of every graph responsibility — extractors register through `extractors/index.ts`, not through hand-wired calls.
- Neo4j stores structural graph facts for routes, tools, Prisma models, local imports, symbols, and tests, with synthetic `ExternalModule` nodes filling unresolved import targets so no edge is orphaned.
- MCP exposes graph-backed search, surface tracing, and related-test tools, and these tools return `success: false` (not empty `success: true`) when the graph is `missing` or `failed`.
- Build Studio prompts and impact reports use graph evidence without claiming unsupported precision; ship evidence (`impactReport.codeGraph`) is persisted whenever graph analysis ran.
- Focused tests, typecheck, production build, MCP verification, structural-node counts, and UX verification pass.
- IT4IT touchpoints recorded: Integrate (Build Studio plan/build), Deploy (ship-evidence persistence), Operate (Code Intelligence status panel).
