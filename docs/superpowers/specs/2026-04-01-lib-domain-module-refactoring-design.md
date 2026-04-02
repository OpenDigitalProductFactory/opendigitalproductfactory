# Spec: lib/ Domain Module Refactoring (IT4IT-Aligned)

**Date:** 2026-04-01
**Status:** Draft
**Author:** Claude Code (with Mark Bodman)
**Relates to:** IT4IT v3.0.1, TAK Architecture, Agent Registry, Portfolio Registry

## 1. Problem Statement

`apps/web/lib/` contains **244 source files and 192 test files** in a largely flat directory structure. Files spanning agent routing, build pipelines, portfolio management, AI inference, MCP tools, auth, and financial validation all coexist at the same level. The 4,455-line `mcp-tools.ts` is a monolith that defines tool schemas for all 7 IT4IT value streams in a single file.

This makes it difficult to:
- Understand which code supports which IT4IT value stream
- Know where to add new functionality for a given agent orchestrator
- Reason about change impact when modifying shared modules
- Onboard contributors who need to understand domain boundaries

The platform already has strong IT4IT alignment in its **agent registry** (43 agents across 7 value streams + governance) and **portfolio registry** (4 canonical portfolios). The code structure should reflect this alignment.

## 2. Goals

1. **Organize lib/ into domain modules aligned to IT4IT value streams** so that code, tools, and tests for each value stream are co-located
2. **Decompose mcp-tools.ts** into per-value-stream tool definition files
3. **Preserve all existing functionality** -- zero behavioral changes, all 192 tests pass, all 13 E2E specs pass
4. **Enable incremental migration** -- barrel re-exports ensure no import breakage during transition
5. **Align code ownership with agent ownership** -- each orchestrator's supporting code lives in its value-stream module

## 3. Non-Goals

- Refactoring the `lib/routing/` subdirectory (already well-organized, 35 tests)
- Refactoring the `lib/slot-engine/` subdirectory (already barrel-exported, 6 tests)
- Refactoring `lib/actions/` (40 test files, high-risk, separate effort)
- Refactoring `lib/api/` (271 API route imports, separate effort)
- Creating separate `packages/` workspaces per value stream
- Changing any runtime behavior, API contracts, or database schemas

## 4. Target Module Structure

### 4.1 IT4IT Value Stream Modules

```
apps/web/lib/
|
+-- tak/                    <-- Trusted AI Kernel (cross-cutting substrate)
|   +-- routing/                Agent router, route-context-map, sensitivity
|   +-- orchestration/          Agentic loop, task classifier, prompt assembly
|   +-- coworker/               AI Coworker UI substrate
|   +-- actions/                Event bus, action registry, grants
|   +-- mcp/                    MCP server protocol (not tool definitions)
|   +-- index.ts                Barrel re-export
|
+-- evaluate/               <-- IT4IT S5.1 -- AGT-ORCH-100
|   +-- portfolio.ts            /portfolio route support
|   +-- portfolio-data.ts
|   +-- portfolio-search.ts
|   +-- matching-engine.ts      AGT-110 rationalization
|   +-- improvement-data.ts     AGT-111 investment analysis
|   +-- proposal-data.ts        AGT-113 scope agreement
|   +-- review-data.ts
|   +-- tool-evaluation.ts      AGT-190 security audit
|   +-- tool-evaluation-data.ts
|   +-- tools.ts                MCP tools: registry_read, investment_proposal_create, gap_analysis_read
|   +-- index.ts
|
+-- explore/                <-- IT4IT S5.2 -- AGT-ORCH-200
|   +-- backlog.ts              /ops route support (backlog mgmt)
|   +-- backlog-data.ts
|   +-- ea-data.ts              /ea route (AGT-121 architecture)
|   +-- ea-structure.ts
|   +-- ea-types.ts
|   +-- reference-model-types.ts
|   +-- decomposition.ts        AGT-120 backlog decomposition
|   +-- complexity-assessment.ts
|   +-- feature-build-types.ts
|   +-- feature-build-data.ts
|   +-- tools.ts                MCP tools: backlog_read/write, roadmap_create, architecture_read
|   +-- index.ts
|
+-- integrate/              <-- IT4IT S5.3 -- AGT-ORCH-300
|   +-- build-pipeline.ts       /build route (Ideate>Plan>Build>Review)
|   +-- build-exec-types.ts
|   +-- build-project-context.ts
|   +-- build-reviewers.ts
|   +-- build-agent-prompts.ts  AGT-130 release planning
|   +-- contribution-pipeline.ts
|   +-- change-executor.ts
|   +-- change-impact.ts
|   +-- security-scan.ts        AGT-131 SBOM
|   +-- manifest-generator.ts
|   +-- codebase-tools.ts
|   +-- git-utils.ts
|   +-- coding-agent.ts
|   +-- sandbox/
|   |   +-- sandbox.ts
|   |   +-- sandbox-db.ts
|   |   +-- sandbox-pool.ts
|   |   +-- sandbox-promotion.ts  AGT-132 release acceptance
|   |   +-- sandbox-workspace.ts
|   |   +-- sandbox-source-strategy.ts
|   |   +-- index.ts
|   +-- tools.ts                MCP tools: sbom_read, release_gate_create, build_plan_write
|   +-- index.ts
|
+-- deploy/                 <-- IT4IT S5.4 -- AGT-ORCH-400
|   +-- rollback-strategies.ts  AGT-140 rollback planning
|   +-- version-tracking.ts
|   +-- tools.ts                MCP tools: iac_execute, deployment_plan_create
|   +-- index.ts
|
+-- release/                <-- IT4IT S5.5 -- AGT-ORCH-500
|   +-- storefront-actions.ts   Storefront routes
|   +-- storefront-data.ts      AGT-151 catalog publication
|   +-- storefront-types.ts
|   +-- storefront-middleware.ts
|   +-- storefront-auth.ts      AGT-152 subscription
|   +-- branding.ts
|   +-- branding-presets.ts
|   +-- tools.ts                MCP tools: service_offer_read, catalog_publish, subscription_read
|   +-- index.ts
|
+-- consume/                <-- IT4IT S5.6 -- AGT-ORCH-600
|   +-- onboarding-data.ts      /customer route (AGT-160)
|   +-- onboarding-prompt.ts
|   +-- discovery-data.ts       AGT-161 order fulfillment
|   +-- tools.ts                MCP tools: consumer_onboard, order_create, incident_read
|   +-- index.ts
|
+-- operate/                <-- IT4IT S5.7 -- AGT-ORCH-700
|   +-- process-observer.ts     /ops route (AGT-170 monitoring)
|   +-- process-observer-hook.ts
|   +-- process-observer-triage.ts  AGT-171 incident detection
|   +-- metrics.ts
|   +-- health-probe-bridge.ts
|   +-- quality-queue.ts
|   +-- endpoint-test-registry.ts
|   +-- endpoint-test-runner.ts
|   +-- playwright-runner.ts
|   +-- tools.ts                MCP tools: telemetry_read, incident_create, change_event_emit
|   +-- index.ts
|
+-- govern/                 <-- IT4IT S6 -- AGT-ORCH-800 + AGT-ORCH-000
|   +-- auth.ts                 Cross-cutting governance
|   +-- auth-utils.ts
|   +-- permissions.ts          AGT-180 constraint validation
|   +-- principal-context.ts
|   +-- approval-authority.ts   AGT-S2P-POL policy
|   +-- user-governance.ts
|   +-- governance-data.ts
|   +-- governance-types.ts
|   +-- governance-resolver.ts  AGT-181 architecture guardrails
|   +-- credential-crypto.ts
|   +-- password.ts
|   +-- password-reset.ts
|   +-- social-auth.ts
|   +-- provider-oauth.ts
|   +-- compliance-types.ts     AGT-902 data governance
|   +-- regulatory-monitor-types.ts
|   +-- policy-types.ts         AGT-100 policy enforcement
|   +-- tools.ts                MCP tools: constraint_validate, policy_read, evidence_chain_read
|   +-- index.ts
|
+-- inference/              <-- AI capability layer (Foundational portfolio)
|   +-- ai-inference.ts
|   +-- async-inference.ts
|   +-- routed-inference.ts
|   +-- ai-provider-internals.ts  /platform route
|   +-- ai-provider-data.ts
|   +-- ai-provider-priority.ts
|   +-- ai-provider-types.ts
|   +-- ai-profiling.ts
|   +-- ollama.ts
|   +-- ollama-url.ts
|   +-- embedding.ts
|   +-- semantic-memory.ts
|   +-- bootstrap-first-run.ts  (depends on ollama — moved here from shared/)
|   +-- index.ts
|
+-- workforce/              <-- IT4IT People (For Employees portfolio)
|   +-- workforce-data.ts       /employee route
|   +-- workforce-types.ts
|   +-- workforce-context.ts
|   +-- leave-data.ts
|   +-- timesheet-data.ts
|   +-- calendar-data.ts
|   +-- index.ts
|
+-- finance/                <-- ITFM -- AGT-900
|   +-- banking-validation.ts
|   +-- finance-validation.ts
|   +-- expense-validation.ts
|   +-- recurring-validation.ts
|   +-- ap-validation.ts
|   +-- asset-validation.ts
|   +-- currency-symbol.ts
|   +-- index.ts
|
+-- shared/                 <-- No domain affiliation
|   +-- actions.ts
|   +-- csv-parser.ts
|   +-- file-parsers.ts
|   +-- file-upload.ts
|   +-- email.ts
|   +-- safe-render.ts
|   +-- feature-flags.ts
|   +-- ical-parser.ts
|   +-- docs.ts
|   +-- bmr-resolver.ts
|   +-- address-validation.ts
|   +-- address-data.ts
|   +-- address-types.ts
|   +-- index.ts
|
+-- routing/                <-- EXISTING (unchanged)
+-- slot-engine/            <-- EXISTING (unchanged)
+-- actions/                <-- EXISTING (unchanged, future effort)
+-- api/                    <-- EXISTING (unchanged)
+-- ea/                     <-- EXISTING (unchanged)
```

### 4.2 Portfolio-to-Module Mapping

The 4 portfolios are governance scopes, not code boundaries. But each portfolio has primary modules:

| Portfolio (IT4IT S6) | Primary Modules | Orchestrators | Routes |
|---|---|---|---|
| **Foundational** | `tak/`, `inference/`, `govern/`, `shared/` | AGT-ORCH-000, AGT-ORCH-800 | /platform, /admin |
| **Manufacturing & Delivery** | `integrate/`, `deploy/`, `operate/` | AGT-ORCH-300, 400, 700 | /build, /ops |
| **For Employees** | `explore/`, `workforce/`, `finance/` | AGT-ORCH-200, AGT-900 | /ops, /employee, /ea |
| **Products & Services Sold** | `evaluate/`, `release/`, `consume/` | AGT-ORCH-100, 500, 600 | /portfolio, /customer, storefront |

### 4.3 Agent-to-Module Mapping

| Orchestrator | Module | Specialists |
|---|---|---|
| AGT-ORCH-000 (COO) | `govern/` | AGT-100, AGT-101, AGT-102 |
| AGT-ORCH-100 (Evaluate) | `evaluate/` | AGT-110, AGT-111, AGT-112, AGT-113, AGT-190 |
| AGT-ORCH-200 (Explore) | `explore/` | AGT-120, AGT-121, AGT-122 |
| AGT-ORCH-300 (Integrate) | `integrate/` | AGT-130, AGT-131, AGT-132 |
| AGT-ORCH-400 (Deploy) | `deploy/` | AGT-140, AGT-141, AGT-142 |
| AGT-ORCH-500 (Release) | `release/` | AGT-150, AGT-151, AGT-152 |
| AGT-ORCH-600 (Consume) | `consume/` | AGT-160, AGT-161, AGT-162 |
| AGT-ORCH-700 (Operate) | `operate/` | AGT-170, AGT-171, AGT-172 |
| AGT-ORCH-800 (Governance) | `govern/` | AGT-180, AGT-181, AGT-182 |
| Cross-cutting (AGT-900..903) | `finance/`, `govern/`, `shared/` | Finance, Architecture, Data Gov, UX/A11y |

### 4.4 MCP Tools Decomposition

The monolithic `mcp-tools.ts` (4,455 lines) splits into per-module `tools.ts` files:

| New File | Tool Grants | Lines (est.) | Agents Served |
|---|---|---|---|
| `evaluate/tools.ts` | registry_read, investment_proposal_create, gap_analysis_read | ~450 | AGT-ORCH-100 |
| `explore/tools.ts` | backlog_read/write, roadmap_create, architecture_read | ~600 | AGT-ORCH-200 |
| `integrate/tools.ts` | sbom_read, release_gate_create, build_plan_write, sandbox tools | ~800 | AGT-ORCH-300 |
| `deploy/tools.ts` | iac_execute, deployment_plan_create, resource_reservation_read | ~300 | AGT-ORCH-400 |
| `release/tools.ts` | service_offer_read, catalog_publish, subscription_read | ~400 | AGT-ORCH-500 |
| `consume/tools.ts` | consumer_onboard, order_create, incident_read | ~350 | AGT-ORCH-600 |
| `operate/tools.ts` | telemetry_read, incident_create, change_event_emit | ~450 | AGT-ORCH-700 |
| `govern/tools.ts` | constraint_validate, policy_read, evidence_chain_read | ~500 | AGT-ORCH-800/000 |
| `tak/mcp/registry.ts` | Tool registry aggregator (imports all module tools.ts) | ~200 | All |

A new `tak/mcp/registry.ts` imports and re-exports all per-module tool definitions, providing backward compatibility for code that currently imports from `mcp-tools.ts`.

## 5. Migration Strategy

### 5.1 Backward-Compatible Barrel Exports

The `@/*` path alias resolves to `apps/web/*`. When a file moves from `lib/backlog.ts` to `lib/explore/backlog.ts`, we place a **shim** at the old path:

```typescript
// lib/backlog.ts (shim -- remove after all imports updated)
export * from "./explore/backlog";
```

This ensures **zero import breakage** during migration. Shims are removed once all consumers are updated.

### 5.2 Phased Execution Order

Migration proceeds in dependency order -- leaf modules first, core modules last.

| Phase | Module(s) | Risk | Files | Tests | Rationale |
|---|---|---|---|---|---|
| **Phase 1** | `finance/` | Low | 7 src + 7 test | 7 | Leaf module, zero internal dependents |
| **Phase 2** | `workforce/` | Low | 6 src + 3 test | 3 | Leaf module, 5 component imports |
| **Phase 3** | `shared/` | Low | 15 src + 6 test | 6 | Utilities, few cross-imports |
| **Phase 4** | `deploy/` | Low | 2 src + 2 test | 2 | Thin module, few dependents |
| **Phase 5** | `consume/` | Low | 3 src + 1 test | 1 | Thin module |
| **Phase 6** | `release/` | Medium | 7 src + 5 test | 5 | Storefront has 4 component imports |
| **Phase 7** | `evaluate/` | Medium | 10 src + 4 test | 4 | Portfolio has 8 component imports |
| **Phase 8** | `explore/` | Medium | 10 src + 6 test | 6 | Backlog has 7 component + dynamic imports |
| **Phase 9** | `operate/` | Medium | 9 src + 4 test | 4 | Process observer has dynamic imports |
| **Phase 10** | `integrate/` | High | 20 src + 15 test | 15 | Build pipeline + sandbox, many cross-imports |
| **Phase 11** | `inference/` | High | 12 src + 12 test | 12 | 20+ dependents on ai-inference |
| **Phase 12** | `tak/` | High | 20 src + 15 test | 15 | Agent routing is load-bearing |
| **Phase 13** | `govern/` | Critical | 17 src + 10 test | 10 | auth (73 deps) + permissions (63 deps) |
| **Phase 14** | MCP tools split | Critical | 1 src > 9 files | 9 | 4,455-line monolith, many dependents |

Each phase is a **separate commit** (or PR for high/critical phases).

### 5.3 Per-Phase Migration Steps

For each phase:

1. **Create target directory** and `index.ts` barrel
2. **Move source files** to the new directory
3. **Place shims** at old locations (`export * from "./module/file"`)
4. **Move test files** alongside their source files
5. **Update relative imports** within moved files
6. **Run vitest** -- all 192 tests must pass
7. **Run typecheck** (`pnpm --filter web typecheck`) -- zero errors
8. **Update consumers** (components, actions, API routes) to use new paths
9. **Remove shims** once all consumers are updated
10. **Run vitest + typecheck again** -- confirm clean

### 5.4 Dynamic Import Handling

121 files use dynamic `import()`. These are NOT caught by TypeScript path resolution at build time. Each phase must:

1. Grep for `import("@/lib/<moved-file>")` across the entire codebase
2. Update dynamic import paths to new locations
3. Verify at runtime (E2E tests cover the critical paths)

Known dynamic imports by module:

| Module | Dynamic Import Targets |
|---|---|
| `integrate/` | `@/lib/sandbox`, `@/lib/sandbox-promotion`, `@/lib/codebase-tools`, `@/lib/git-utils`, `@/lib/build-reviewers`, `@/lib/coding-agent` |
| `govern/` | `@/lib/auth` (signOut), `@/lib/approval-authority` |
| `inference/` | `@/lib/routed-inference`, `@/lib/semantic-memory` |
| `operate/` | `@/lib/endpoint-test-runner` |
| `explore/` | `@/lib/change-impact` |
| `tak/` | `@/lib/agent-event-bus` |

## 6. Testing Strategy

### 6.1 Test Pyramid

```
                    E2E (13 Playwright specs)
                   /                          \
              Integration (API endpoint tests)
             /                                  \
        Unit (192 vitest files -- primary gate)
```

### 6.2 Per-Phase Verification

**Every phase MUST pass all three gates before merging:**

| Gate | Command | Pass Criteria |
|---|---|---|
| **Gate 1: Unit** | `pnpm --filter web test` | All 192 tests pass, zero failures |
| **Gate 2: Types** | `pnpm --filter web typecheck` | Zero TypeScript errors |
| **Gate 3: Build** | `pnpm --filter web build` | Next.js production build succeeds |

### 6.3 Full Regression (After Phase 10+)

After Phase 10 (integrate/) and all subsequent phases, run the **full regression**:

| Gate | Command | Pass Criteria |
|---|---|---|
| **Gate 4: E2E** | `npx playwright test` | All 13 specs pass |
| **Gate 5: Cross-package** | `pnpm test` (root) | All workspace tests pass |

### 6.4 MCP Tools Split Verification (Phase 14)

The mcp-tools.ts split requires special verification:

1. **Tool registry completeness** -- the aggregated registry in `tak/mcp/registry.ts` must export the exact same tool set as the original `mcp-tools.ts`. Write a dedicated test:
   ```typescript
   // tak/mcp/registry.test.ts
   import { getAllTools as getNewTools } from "./registry";
   import { ORIGINAL_TOOL_NAMES } from "./original-tool-manifest";
   
   test("tool registry is complete after split", () => {
     const newToolNames = getNewTools().map(t => t.name).sort();
     expect(newToolNames).toEqual(ORIGINAL_TOOL_NAMES.sort());
   });
   ```

2. **Per-agent tool grants** -- verify each orchestrator can still access its granted tools:
   ```typescript
   test("AGT-ORCH-300 has integrate tools", () => {
     const tools = getToolsForAgent("AGT-ORCH-300");
     expect(tools.map(t => t.name)).toContain("sbom_read");
     expect(tools.map(t => t.name)).toContain("release_gate_create");
   });
   ```

3. **Existing mcp-tools tests** -- the 9 existing test files (`mcp-tools.test.ts`, `mcp-tools-ea.test.ts`, `mcp-tools-integrations.test.ts`, etc.) must all pass against the new split structure.

### 6.5 Import Integrity Test

Add a CI-level check that no shim files remain after migration is complete:

```bash
# scripts/check-no-shims.sh
# Fails if any shim re-export files remain in lib/ root
SHIMS=$(grep -rl 'export \* from "./' apps/web/lib/*.ts 2>/dev/null | grep -v index.ts)
if [ -n "$SHIMS" ]; then
  echo "ERROR: Shim files still present:"
  echo "$SHIMS"
  exit 1
fi
```

### 6.6 New Module Test Template

Each new module's `index.ts` barrel must be tested to ensure it re-exports all public symbols:

```typescript
// <module>/index.test.ts
import * as Module from "./index";

test("barrel exports all public symbols", () => {
  // Snapshot test -- if a symbol is accidentally dropped, this fails
  expect(Object.keys(Module).sort()).toMatchSnapshot();
});
```

## 7. Future Alignment

### 7.1 New Agent Rule

When a new specialist agent is added to the registry (e.g., AGT-173 for post-incident review):

1. Its supporting code goes in the corresponding value-stream module (`operate/`)
2. Its tool definitions go in that module's `tools.ts`
3. The tool is registered in `tak/mcp/registry.ts` via the module's barrel export
4. Tests go alongside the source in the module directory

### 7.2 New Value Stream Rule

If IT4IT adds a new value stream (unlikely but possible), it gets a new top-level directory under `lib/` with the same structure: source files, `tools.ts`, `index.ts` barrel, and co-located tests.

### 7.3 New Portfolio Rule

Portfolios are data-layer constructs (see `portfolio_registry.json`). Adding a 5th portfolio requires no code structure changes -- it is a seed data and governance change, not a module change.

### 7.4 Route Domain Alignment

When new routes are added, they should map to existing value-stream modules:

| New Route Pattern | Module | Rationale |
|---|---|---|
| `/deploy/*` | `deploy/` | IT4IT S5.4 |
| `/release/*` | `release/` | IT4IT S5.5 |
| `/incidents/*` | `operate/` | IT4IT S5.7 |
| `/catalog/*` | `release/` | AGT-151 catalog publication |
| `/governance/*` | `govern/` | IT4IT S6 |

### 7.5 MCP Tool Addition Rule

New MCP tools MUST be added to the appropriate value-stream `tools.ts`, NOT to a central file. The `tak/mcp/registry.ts` aggregator picks them up automatically via barrel imports.

## 8. Dependency Risk Matrix

### 8.1 High-Dependency Modules (move last)

| File | Dependents | Module | Migration Phase |
|---|---|---|---|
| `auth.ts` | 73 | `govern/` | Phase 13 |
| `permissions.ts` | 63 | `govern/` | Phase 13 |
| `ai-inference.ts` | 20 | `inference/` | Phase 11 |
| `mcp-tools.ts` | 54 (test) + 4 (lib) | split across all | Phase 14 |
| `agent-routing.ts` | 8 | `tak/` | Phase 12 |

### 8.2 Dynamic Import Risks

| File | Dynamic Callers | Risk |
|---|---|---|
| `@/lib/sandbox` | Multiple action files | Must update `import()` paths |
| `@/lib/auth` | Multiple action files (signOut) | Must update `import()` paths |
| `@/lib/routed-inference` | agentic-loop, coding-agent | Must update `import()` paths |
| `@/lib/approval-authority` | governance actions | Must update `import()` paths |

### 8.3 Circular Dependency Risks

| Cycle | Modules Involved | Mitigation |
|---|---|---|
| auth <> permissions | `govern/` internal | Both in same module -- no cross-module cycle |
| agent-routing <> ai-inference | `tak/` <> `inference/` | Interface extraction: `tak/` depends on inference types only |
| mcp-tools <> sandbox | `tak/mcp/` <> `integrate/` | Registry imports tool definitions, not implementations |

## 9. Rollback Plan

Each phase is a separate commit. If a phase breaks:

1. `git revert <phase-commit>` -- reverts the file moves
2. Re-run `pnpm --filter web test` to confirm revert is clean
3. Diagnose the issue in the reverted state
4. Re-attempt with fixes

The shim-based approach means partial migration is always valid -- some modules can be reorganized while others remain at lib/ root.

## 10. Success Criteria

| Criterion | Measurement |
|---|---|
| All 192 unit tests pass | `pnpm --filter web test` exits 0 |
| Zero TypeScript errors | `pnpm --filter web typecheck` exits 0 |
| Production build succeeds | `pnpm --filter web build` exits 0 |
| All 13 E2E specs pass | `npx playwright test` exits 0 |
| No shim files remain | `scripts/check-no-shims.sh` exits 0 |
| mcp-tools.ts eliminated | File deleted, tools split across 8 module `tools.ts` files |
| Barrel export snapshots captured | Each module has `index.test.ts` with snapshot |
| Zero runtime import errors | No `MODULE_NOT_FOUND` in application logs |

## 11. Open Questions

1. **Should `lib/actions/` be reorganized in the same effort?** It has 40 test files and 112 component imports. Recommendation: defer to a follow-up spec.
2. **Should the `lib/routing/` barrel be moved under `tak/routing/`?** It already works well. Recommendation: leave in place, add a re-export from `tak/` if needed.
3. **Should `lib/ea/` (2 files) merge into `explore/`?** The EA route serves the Explore value stream. Recommendation: yes, merge.
