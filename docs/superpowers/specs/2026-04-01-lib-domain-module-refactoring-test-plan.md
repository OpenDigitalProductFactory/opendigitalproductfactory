# Test Plan: lib/ Domain Module Refactoring

**Date:** 2026-04-01
**Companion to:** 2026-04-01-lib-domain-module-refactoring-design.md
**Status:** Draft

## 1. Test Scope

This test plan covers the refactoring of `apps/web/lib/` from a flat directory into IT4IT-aligned domain modules. The refactoring is purely structural -- no behavioral changes. All tests verify that **existing functionality is preserved** through the migration.

## 2. Test Infrastructure

| Layer | Framework | Config | Count |
|---|---|---|---|
| Unit | Vitest 1.6.0 | `apps/web/vitest.config.ts` | 192 files |
| Type checking | TypeScript (`tsc --noEmit`) | `apps/web/tsconfig.json` | N/A |
| Build | Next.js 16 | `apps/web/next.config.ts` | N/A |
| E2E | Playwright 1.52.0 | `playwright.config.ts` | 13 specs |
| Cross-package | Vitest (db, mobile) | Root `pnpm test` | 3 workspaces |

## 3. Gate Definitions

### Gate 1: Unit Tests (every phase)

```bash
pnpm --filter web test
```

**Pass criteria:** All 192 test files pass, zero failures, zero skipped (unless pre-existing).

**What it catches:**
- Broken imports (static `import` / `require`)
- Missing re-exports from barrel files
- Incorrect relative path resolution after file moves
- Accidentally deleted or renamed exports

### Gate 2: Type Check (every phase)

```bash
pnpm --filter web typecheck
```

**Pass criteria:** Zero TypeScript errors.

**What it catches:**
- Import path resolution failures
- Type export gaps in barrel files
- Circular dependency issues surfaced by tsc
- Missing type re-exports

### Gate 3: Production Build (every phase)

```bash
pnpm --filter web build
```

**Pass criteria:** Next.js build completes without errors.

**What it catches:**
- Dynamic import failures (not caught by tsc)
- Tree-shaking issues from barrel re-exports
- Server/client boundary violations from moved files
- Webpack/Turbopack module resolution failures

### Gate 4: E2E Tests (phases 10+)

```bash
npx playwright test
```

**Pass criteria:** All 13 specs pass.

**What it catches:**
- Runtime import failures in server actions
- Dynamic import path errors (`import("@/lib/...")`)
- API route handler resolution
- Full user workflow regressions

### Gate 5: Cross-Package Tests (phases 10+)

```bash
pnpm test
```

**Pass criteria:** All workspace tests pass (web + db + mobile).

**What it catches:**
- Cross-package import breaks
- Shared type export gaps

## 4. Per-Phase Test Matrix

### Phase 1-5 (Low Risk: finance, workforce, shared, deploy, consume)

| Step | Action | Verification |
|---|---|---|
| 1 | Create directory + barrel | Gate 2 (types compile) |
| 2 | Move source files | Gate 1 + Gate 2 |
| 3 | Place shims at old paths | Gate 1 + Gate 2 |
| 4 | Move test files | Gate 1 (tests still pass from new location) |
| 5 | Update internal imports | Gate 1 + Gate 2 |
| 6 | Update consumer imports | Gate 1 + Gate 2 + Gate 3 |
| 7 | Remove shims | Gate 1 + Gate 2 + Gate 3 |

### Phase 6-9 (Medium Risk: release, evaluate, explore, operate)

Same as Phase 1-5, plus:

| Step | Action | Verification |
|---|---|---|
| 8 | Grep for dynamic imports | Manual review + Gate 3 |
| 9 | Update dynamic import paths | Gate 3 (build catches dynamic resolution) |
| 10 | Smoke test affected routes | Manual: visit /portfolio, /ops, /build in browser |

### Phase 10-12 (High Risk: integrate, inference, tak)

Same as Phase 6-9, plus:

| Step | Action | Verification |
|---|---|---|
| 11 | Run full E2E suite | Gate 4 |
| 12 | Run cross-package tests | Gate 5 |
| 13 | Check AI coworker routing | Manual: open AI Coworker on /build, /ops, /portfolio |
| 14 | Check sandbox operations | Manual: create sandbox, run build, promote |

### Phase 13 (Critical: govern -- auth/permissions)

**Special handling required.** `auth.ts` has 73 dependents, `permissions.ts` has 63.

| Step | Action | Verification |
|---|---|---|
| 1 | Create `govern/` directory + barrel | Gate 2 |
| 2 | Move ONE file (e.g., `policy-types.ts`) | Gate 1 + Gate 2 -- verify shim approach works |
| 3 | Move remaining low-dependency files | Gate 1 + Gate 2 after each batch |
| 4 | Move `permissions.ts` with shim | Gate 1 + Gate 2 + Gate 3 |
| 5 | Move `auth.ts` with shim | Gate 1 + Gate 2 + Gate 3 |
| 6 | Update all 73 auth consumers | Gate 1 + Gate 2 + Gate 3 (batch by directory) |
| 7 | Update all 63 permissions consumers | Gate 1 + Gate 2 + Gate 3 (batch by directory) |
| 8 | Full regression | Gate 1 + Gate 2 + Gate 3 + Gate 4 + Gate 5 |
| 9 | Remove shims | Gate 1 + Gate 2 + Gate 3 + Gate 4 |
| 10 | Login/logout flow test | Manual: login, check permissions, logout, re-login |
| 11 | Role-based access test | Manual: verify admin vs user vs agent access |

### Phase 14 (Critical: MCP tools split)

| Step | Action | Verification |
|---|---|---|
| 1 | Snapshot current tool registry | `toolRegistrySnapshot.test.ts` (see S5) |
| 2 | Create per-module `tools.ts` files | Gate 2 |
| 3 | Create `tak/mcp/registry.ts` aggregator | Gate 2 |
| 4 | Verify tool completeness | `registry.test.ts` -- new vs original names |
| 5 | Verify per-agent grants | `agent-grants.test.ts` -- each orchestrator |
| 6 | Run existing mcp-tools tests | Gate 1 (all 9 test files) |
| 7 | Update consumers of `mcp-tools.ts` | Gate 1 + Gate 2 + Gate 3 |
| 8 | Delete `mcp-tools.ts` | Gate 1 + Gate 2 + Gate 3 + Gate 4 |
| 9 | AI Coworker tool usage test | Manual: use tools on /build, /ops, /portfolio |

## 5. New Tests to Write

### 5.1 Barrel Export Snapshot Tests

One per module. Catches accidentally dropped exports.

```typescript
// lib/<module>/index.test.ts
import * as Module from "./index";

test("barrel exports all public symbols", () => {
  expect(Object.keys(Module).sort()).toMatchSnapshot();
});
```

**Files to create (14):**
- `lib/tak/index.test.ts`
- `lib/evaluate/index.test.ts`
- `lib/explore/index.test.ts`
- `lib/integrate/index.test.ts`
- `lib/deploy/index.test.ts`
- `lib/release/index.test.ts`
- `lib/consume/index.test.ts`
- `lib/operate/index.test.ts`
- `lib/govern/index.test.ts`
- `lib/inference/index.test.ts`
- `lib/workforce/index.test.ts`
- `lib/finance/index.test.ts`
- `lib/shared/index.test.ts`
- `lib/integrate/sandbox/index.test.ts`

### 5.2 Tool Registry Completeness Test

Verifies the MCP tools split preserves the full tool set.

```typescript
// lib/tak/mcp/registry.test.ts
import { getAllTools } from "./registry";

// Captured BEFORE the split as a snapshot
const ORIGINAL_TOOL_COUNT = <N>;  // fill in from current mcp-tools.ts

test("tool registry preserves all tools after split", () => {
  const tools = getAllTools();
  expect(tools.length).toBe(ORIGINAL_TOOL_COUNT);
});

test("no duplicate tool names", () => {
  const tools = getAllTools();
  const names = tools.map(t => t.name);
  expect(new Set(names).size).toBe(names.length);
});

test("all tools have valid value stream tag", () => {
  const validStreams = [
    "evaluate", "explore", "integrate", "deploy",
    "release", "consume", "operate", "govern"
  ];
  const tools = getAllTools();
  for (const tool of tools) {
    expect(validStreams).toContain(tool.valueStream);
  }
});
```

### 5.3 Agent Tool Grant Verification Tests

One test per orchestrator.

```typescript
// lib/tak/mcp/agent-tool-grants.test.ts
import { getToolsForAgent } from "./registry";
import agentRegistry from "@dpf/db/data/agent_registry.json";

describe("agent tool grants match registry", () => {
  const orchestrators = agentRegistry.agents.filter(a => a.id.startsWith("AGT-ORCH"));

  for (const orch of orchestrators) {
    test(`${orch.id} (${orch.name}) has all granted tools`, () => {
      const tools = getToolsForAgent(orch.id);
      const toolNames = tools.map(t => t.name);
      for (const grant of orch.tool_grants) {
        expect(toolNames).toContain(grant);
      }
    });
  }
});
```

### 5.4 No-Shim Verification

CI script to run after all phases complete.

```bash
#!/bin/sh
# scripts/check-no-shims.sh
# Verifies all backward-compat shims have been removed
set -e

SHIMS=$(grep -rl 'export \* from "\.\/' apps/web/lib/*.ts 2>/dev/null | grep -v index.ts || true)
if [ -n "$SHIMS" ]; then
  echo "ERROR: Shim re-export files still present in lib/ root:"
  echo "$SHIMS"
  echo ""
  echo "These files should be deleted after all consumers are updated."
  exit 1
fi

echo "OK: No shim files found in lib/ root"
```

### 5.5 Dynamic Import Verification

Grep-based check that no dynamic imports point to old paths.

```bash
#!/bin/sh
# scripts/check-dynamic-imports.sh
# Verifies no dynamic imports reference old lib/ root paths for moved files
set -e

MOVED_MODULES="backlog|portfolio|sandbox|auth|permissions|ai-inference|agent-routing|mcp-tools|process-observer|storefront|workforce|branding"

STALE=$(grep -rn "import(.*@/lib/\(${MOVED_MODULES}\)" apps/web/ --include='*.ts' --include='*.tsx' 2>/dev/null || true)
if [ -n "$STALE" ]; then
  echo "ERROR: Dynamic imports still reference old lib/ paths:"
  echo "$STALE"
  exit 1
fi

echo "OK: No stale dynamic imports found"
```

## 6. Manual Test Checklist

Run after Phase 10+ and after final Phase 14.

### 6.1 Core Workflows

| # | Test | Route | Steps | Expected |
|---|---|---|---|---|
| M1 | Login | /login | Enter credentials, submit | Dashboard loads |
| M2 | Portfolio browse | /portfolio | Navigate tree, click product | Product detail renders |
| M3 | Backlog management | /ops | Create item, change status, assign | Item persists correctly |
| M4 | Build Studio | /build | Open build, interact with AI Coworker | Coworker responds, tools work |
| M5 | Sandbox create | /build | Start a build, verify sandbox spins up | Sandbox container running |
| M6 | Promotion | /build | Promote from sandbox to production | Changes applied, rollback available |
| M7 | AI Coworker routing | /ops, /build, /portfolio | Chat with coworker on each route | Route-appropriate agent responds |
| M8 | MCP tool usage | /build | Ask coworker to use a build tool | Tool executes, result returned |
| M9 | EA view | /ea | Browse architecture models | Models render correctly |
| M10 | Employee mgmt | /employee | View employee list, edit role | Changes persist |
| M11 | Storefront | /storefront | Browse catalog, view offer | Offer details render |
| M12 | Platform settings | /platform | Check AI provider config | Providers listed correctly |
| M13 | Compliance | /compliance | Open compliance dashboard | Controls and posture display |

### 6.2 AI Coworker Agent Routing Verification

For each route, verify the correct orchestrator is engaged:

| Route | Expected Orchestrator | Verification |
|---|---|---|
| /portfolio | AGT-ORCH-100 (Evaluate) | Ask "what investments should we prioritize?" |
| /ops | AGT-ORCH-200 (Explore) | Ask "prioritize the backlog" |
| /build | AGT-ORCH-300 (Integrate) | Ask "plan the next release" |
| /ops (monitoring) | AGT-ORCH-700 (Operate) | Ask "what incidents are open?" |
| /customer | AGT-ORCH-600 (Consume) | Ask "onboard a new consumer" |
| /admin | AGT-ORCH-800 (Governance) | Ask "check architecture compliance" |

## 7. Regression Risk Areas

| Area | Risk | Mitigation |
|---|---|---|
| Auth/login flow | High -- 73 dependents on auth.ts | Phase 13 has dedicated steps; manual login test |
| RBAC/permissions | High -- 63 dependents | Move with auth in same phase; test role separation |
| AI Coworker routing | Medium -- depends on route-context-map | Phase 12 moves this; test each route's agent |
| MCP tool execution | Medium -- 4,455-line split | Phase 14; tool completeness test + per-agent grants |
| Dynamic imports | Medium -- 121 files use import() | Grep-based verification script; E2E covers critical paths |
| Sandbox operations | Medium -- 6 tightly coupled files | Move as unit in integrate/sandbox/; E2E build lifecycle test |
| Storefront | Low -- self-contained | Phase 6; 4 component imports to update |
| Financial validation | Low -- leaf module | Phase 1; zero internal dependents |

## 8. Test Execution Timeline

| Milestone | Tests Run | Time Estimate |
|---|---|---|
| After Phase 1-5 | Gate 1 + Gate 2 + Gate 3 per phase | Quick -- low risk moves |
| After Phase 6-9 | Gate 1 + Gate 2 + Gate 3 + dynamic import grep | Medium -- some consumer updates |
| After Phase 10 | Gate 1-5 + Manual M1-M6 | Full regression -- first high-risk phase |
| After Phase 11 | Gate 1-5 + Manual M7-M8 | AI inference path verification |
| After Phase 12 | Gate 1-5 + Manual M7 (all routes) | Agent routing verification |
| After Phase 13 | Gate 1-5 + Manual M1, M10 | Auth/permissions regression |
| After Phase 14 | Gate 1-5 + Manual M1-M13 + new tests (S5) | Full regression + MCP completeness |
| Final | All gates + all manual + no-shim check + dynamic import check | Acceptance |

## 9. Acceptance Criteria

The refactoring is complete when:

- [ ] All 14 phases committed
- [ ] All 192 existing unit tests pass
- [ ] All 14 new barrel export snapshot tests pass
- [ ] Tool registry completeness test passes
- [ ] Agent tool grant verification tests pass
- [ ] TypeScript compiles with zero errors
- [ ] Next.js production build succeeds
- [ ] All 13 Playwright E2E specs pass
- [ ] No shim files remain in `lib/` root
- [ ] No dynamic imports reference old `lib/` root paths
- [ ] Manual test checklist M1-M13 all pass
- [ ] AI Coworker agent routing verified on all 6 routes
