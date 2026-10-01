---
status: draft
---

# apps/web: the remaining import cycle, and what project references would actually buy

**Plan:** [dependency diet, move M11 step 2](../plans/2026-09-08-dependency-diet-and-vertical-integration-plan.md) · **Epic:** `EP-8DC217EB` · **Backlog:** `BI-0A3B155F` (M11), `BI-F68CD3E3` (cycle precursor) · **Guard:** [`check-no-web-import-cycle-growth.mjs`](../../../scripts/check-no-web-import-cycle-growth.mjs) · **Doctrine:** [architecture over shortcuts](../../founder-kernel/wiki/principles/architecture-over-shortcuts.md), [report only the verdict you reached](../../founder-kernel/wiki/principles/report-only-the-verdict-you-reached.md)
**Decision:** `rescope_to_measured_levers` (§7), recorded 2026-10-01 as DI-F2DCF2FEDBE7.

## 0. Summary

Plan step 2 assumed three things: the 75-file cycle is a runtime cycle that must be broken; project references for `lib/build`, `lib/actions`, `lib/tak` and `lib/mcp` would make the typecheck incremental and parallel; and the generated Prisma client, 54% of checked lines, is the largest remaining lever. Measured on 2026-09-30, none of the three holds as stated:

1. **No static runtime cycle runs through the MCP hub.** The 75-file component closes only through dynamic `import()` calls, which already defer loading. Only three small static cycles exist (11, 4 and 2 files), all around `lib/ai-inference.ts` and `lib/inference/`. The 75 files matter to the *type* graph, not to how modules load.
2. **The four heavy domains are 13% of check time, and they are not layers.** `components/` and `app/` account for 58% of check time. Directory-shaped domain projects would need 431 upward imports removed from 312 files, and the rest of `lib` imports the domains 366 times.
3. **The Prisma client is lines, not time.** Every generated file carries `// @ts-nocheck`, so tsc parses and binds it but never checks it. Replacing it with prebuilt declarations cut checked TypeScript lines by 63% and check time by nothing (150.8 s before, 152.1 s after).
4. **The web typecheck is already incremental.** `apps/web/tsconfig.json` sets `incremental: true`. A warm run with no change takes 18 s. After a leaf component edit it takes 27 s; after a new export in a widely imported core module, 94 s. A cold run takes 168 s. CI and fresh worktrees always run cold.

The recommended sequence (§6) is: warm-start the typecheck in CI; cut the three static runtime cycles and ratchet the runtime graph to acyclic; make `lib` independent of `app/` and `components/`; then, only if the measured gain still justifies it, add two project references (`lib` and `ui`). The pack-registry inversion stays designed (§4.1) but deferred. Its only benefit is to domain-level projects, and the data does not support those.

## 1. Measurement method

- **Tree.** `origin/main` at `49e419b5b`, plus the open cut-4 branch `claude/m11-cycle-cut-4` at `3e468ea72` (#5825), measured separately.
- **Graph.** The same file set and resolution as the guard: production `apps/web` sources (the set `apps/web/tsconfig.json` checks, minus tests, scripts, e2e, test-support and `.d.ts`), with `@/` and relative specifiers resolved and package imports left outside the graph. The pinned guard TypeScript (6.0.3, `scripts/lib/load-pinned-guard-typescript.mjs`) parses each file, and each edge gets a kind:
  - **value**: a static `import`/`export … from` that binds at least one runtime name. A side-effect `import "x"` counts. An inline `type` specifier does not. A named import counts as value unless the name resolves to an exported `interface` or `type` alias in the target, following `export *` and named re-exports. This matches the isolatedModules elision that SWC and tsc apply. It is conservative: a class or enum used only as a type still counts as value.
  - **dynamic**: `import("x")` in expression position.
  - **type**: `import type`, `export type`, type-only named imports and `import("x").T` type queries.
- **Components.** Tarjan's algorithm finds the strongly connected components (SCCs). Greedy cuts remove, one at a time, the edge whose removal most shrinks the largest remaining SCC.
- **Timing.** One run per configuration in this cloud sandbox (15 GB host, `flock`-serialised, run through `scripts/run-tsc.mjs`), with `--extendedDiagnostics`. `.next/types` was not generated. Treat single-run times as ±5%. Per-directory check time comes from `--generateTrace` `checkSourceFile` spans. The checker charges shared types (React, Prisma) to whichever file needs them first, so the per-directory split is indicative.

A reviewer can reproduce the graph numbers from the guard's own `buildImportGraph` and `largestCycle` exports plus the edge-kind rules above. §8 proposes folding the classifier into the guard, so the numbers stop being a scratch artifact.

## 2. What the graph looks like

### 2.1 Cycle sizes

| Graph | `main` 49e419b5b | cut-4 3e468ea72 | cut-4 + pack-registry cut | + `ai-inference` cut |
|---|---|---|---|---|
| All imports (the guard; project references need this acyclic *between projects*) | **81**, 27, 18, 18, 17, 14, 14, 12, … | **75**, 18, 14, 14, 12, … | **18**, 14, 14, 12, … | **14**, 14, 12, 8, … |
| Static value only (load-order cycles) | **11**, 4, 2 | 11, 4, 2 | 11, 4, 2 | 4, 2 |
| Value + dynamic | **75**, 18, 5, 4, … | 75, 18, 5, 4, … | 18, 5, 4, … | 8, 5, 4, … |

The "runtime 75" in the plan is the value-plus-dynamic graph. Take out the dynamic edges and nothing in it loads in a cycle.

### 2.2 The 75-file component and its hinge

Members span `lib/mcp*` (29), `lib/build` (14), `lib/actions` (6), `lib/tak` (3) and 23 other `lib` files, including `lib/build-pipeline.ts` and `lib/build-flow-state.ts` (`self-upgrade/quiescence`, `inference/ai-provider-data`, `govern/operation-authority`, `browser-drive`, `attention`, and others). Greedy cuts on the all-imports graph:

| # | Edge cut | Kind | Used for | Largest SCC after |
|---|---|---|---|---|
| 1 | `lib/mcp-tools.ts → lib/mcp/pack-registry.ts` | value | `TOOL_PACK_REGISTRY`: `PLATFORM_TOOLS` spreads `.definitions`, and `executeTool` dispatches through `.getHandler(name)` after the kernel gate | 2 within the old component; 18 program-wide on cut-4 |
| 2 | `lib/build/build-on-plan-approval.ts → lib/build/build-orchestrator.ts` | dynamic | lazy start of the build orchestrator after plan approval | 0 within the old component |

Nothing else in `mcp-tools.ts`'s own imports keeps the component together. Twenty edges point back *into* `mcp-tools.ts`: 7 static value imports and 13 dynamic ones.

| Importer | Kind | Names |
|---|---|---|
| `lib/mcp-governed-execute.ts` | value | `PLATFORM_TOOLS`, `executeTool` |
| `lib/tak/agentic-loop.ts` | value | `PLATFORM_TOOLS`, `toolsToOpenAIFormat` |
| `lib/build/build-orchestrator.ts` | value + dynamic | `getAvailableTools`, `toolsToOpenAIFormat` |
| `lib/build/decision-service.ts`, `lib/browser-drive/select-means.ts` | value | `executeTool` |
| `lib/govern/operation-authority.ts`, `lib/tool-audit-helpers.ts` | value | `PLATFORM_TOOLS` |
| `lib/actions/agent-coworker.ts`, `lib/actions/build.ts`, `lib/attention/sources/coworker-envelope.ts`, `lib/build/{build-on-plan-approval,build-pipeline,ideate-on-approval,plan-on-approval}.ts`, `lib/inference/ai-provider-data.ts`, `lib/mcp/packs/{screen,surface}-pack.ts`, `lib/security/response-authority.ts`, `lib/self-upgrade/read-only-tool-signal.ts`, `lib/tak/autonomous-work-run.ts` | dynamic | lazy `executeTool` / `PLATFORM_TOOLS` |

The shortest loop is `pack-registry → packs/screen-pack → (dynamic) mcp-tools → pack-registry`. Cutting the one forward edge is far cheaper than cutting twenty back-edges. The other hubs the plan named (`self-upgrade/quiescence`, `tak/autonomous-work-run`, `mcp-governed-execute`, `build/build-phase-run`) are members of the component, not hinges: none of them is a cut that shrinks it on its own.

### 2.3 The 18-file inference component and the static runtime cycles

`lib/inference/ai-inference.ts` registers the execution adapters for its side effects (`import "../routing/chat-adapter"` and seven more). Each adapter imports `InferenceError` and `classifyHttpError` back through the shim `lib/ai-inference.ts` (`export * from "./inference/ai-inference"`). That loop is the 11-file static runtime cycle. It is safe today only because no adapter touches `InferenceError` while its module is still evaluating (no top-level `extends InferenceError`). One such line would throw a temporal-dead-zone error at startup. Greedy cuts of the 18: the `lib/ai-inference.ts` shim (→ 8), the `lib/ai-provider-internals.ts` shim (→ 4), `routing/codex-cli-adapter → inference/ai-provider-internals` (→ 2), and the dynamic `ai-provider-internals ↔ chatgpt-codex-catalog-mirror` pair (→ 0). The other static cycles are `lib/inference/async-operation-lifecycle ↔ async-operation-provider` (4 files) and `lib/explore/build-process-matrix ↔ feature-build-types` (2).

The remaining all-imports SCCs (27 in `lib/govern/data` on `main`, which cut-4 removes; the `lib/work-management` shape pair at 14; 14 in `lib/build` plus `lib/build-exec-types`; 12 across routing and inference type modules; 17 in `lib/ux-budget/purpose-contracts`, which cut-4 also removes) each sit inside one layer. A project reference does not care about a cycle *inside* a project.

### 2.4 Directories are not layers

Partition the files as `app` (`app/`, `components/`, root files), `mcp` (`lib/mcp/**`, `lib/mcp-*.ts`), `build`, `tak`, `actions` and `core` (the rest of `lib/`). Cross-partition edges, all kinds, on `main`:

| From \ to | core | tak | build | actions | mcp | app |
|---|---|---|---|---|---|---|
| **core** | — | 110 | 103 | 35 | 76 | 42 |
| **tak** | 207 | — | 4 | 3 | 26 | 2 |
| **build** | 292 | 16 | — | 1 | 11 | 0 |
| **actions** | 797 | 61 | 51 | — | 18 | 0 |
| **mcp** | 476 | 65 | 96 | 22 | — | 0 |

The best of the 24 domain orders (`core < tak < build < actions < mcp < app`) still leaves **431 upward edges from 312 files**. With the pack-registry edge cut, every domain still reaches every other domain transitively. 2,032 of 2,856 `core` files (313k lines) reach no domain and no UI file, but that set does not follow directories: only 161 files, in 41 directories, form a downward-closed set at directory granularity. Fifteen greedy "gateway" cuts (for example `deliberation/evidence → actions/external-evidence`, `work-management/semantic-review-room-projection → tak/task-states`, `operate/scheduled-jobs/catalog → build/code-graph/constants`) take impure core files only from 824 to 572. The domains are vertical slices that both use the core and are used by it.

`lib → app/components` has 44 direct edges: 21 targets, mostly plain TypeScript that happens to live under `components/` (`components/twin/*`, `components/ui/report-kit/{index,statusColors}`, seven `*-nav.ts` route tables, `components/monitoring/alert-humanize`), plus five `.tsx` providers that `lib/**/*.tsx` renders. After the pack-registry cut, 69 core files reach UI code.

## 3. What the typecheck spends its time on

| Configuration | Files | Lines of TS | Lines of definitions | Check | Total | Memory |
|---|---|---|---|---|---|---|
| Full web program, cold | 8,179 | 2,587,463 | 271,444 | 150.8 s | 172.0 s | 5.50 GB |
| Same, `@dpf/db` as prebuilt `.d.ts` | 8,159 | 954,011 | 1,742,251 | 152.1 s | 170.1 s | 5.24 GB |
| `lib/**` only (pulls in 61 `components/` files, 1 `app/` file) | 5,849 | 2,337,504 | 227,856 | 59.7 s | 76.0 s | 5.01 GB |
| `app/`+`components/` over prebuilt `lib` and `@dpf/db` declarations ¹ | 5,891 | 278,303 | 1,810,699 | 75.9 s | 87.3 s | 3.45 GB |
| Incremental (`incremental: true`), warm, no change | — | — | — | — | 17.8 s | 3.43 GB |
| Incremental, comment added to `components/ui/Button.tsx` | — | — | — | 8.1 s | 26.7 s | 3.69 GB |
| Incremental, new export in `lib/shared/coerce.ts` | — | — | — | 75.4 s | 94.2 s | 4.96 GB |

¹ Approximate: 13 `lib` files did not emit declarations (below), so 365 resolution errors cut some checking short.

Check time by directory (trace): `components/` 39.4%, other `lib/` 25.9%, `app/` 18.5%, `lib/actions` 5.9%, `lib/mcp*` 3.1%, other packages 2.9%, `lib/build` 2.4%, `lib/tak` 1.8%. The costliest single files are `lib/products/catalog-builder-commands.ts` (2.0 s), `packages/db/src/client.ts` (0.9 s) and `components/build/BuildStudio.tsx` (0.8 s). The program instantiates 5.18 M types; the cost sits in consumer call sites (React props, Prisma generics), not in declarations.

**Declaration-emit readiness.** `composite` requires `declaration`. Emitting declarations for the `lib` program produced 31 `TS2883` errors in 13 files. Each is an exported function whose inferred return type names a Prisma type the file does not import (`BatchPayload`, `WipAdmissionMode`, `SelfUpgradeDispatchStatus`, `SkillDefinitionGroupByOutputType`, and others). Each needs an explicit return type. Two layout traps showed up as well. TS 6 demands an explicit `rootDir` once the program pulls sources from outside `apps/web` (`TS5011`). And with `allowJs`, the emit wrote `.d.mts` files *next to* `scripts/**/*.mjs` sources outside the output directory. A `lib` project must set `allowJs: false` or keep those sources out of its program.

`@dpf/db` declaration emit: 56.7 s, 0 errors, 1.48 M lines of `.d.ts` for the generated client (the source is 1.61 M lines).

## 4. Options for each hinge

### 4.1 `lib/mcp-tools.ts → lib/mcp/pack-registry.ts`

| Option | Cuts the type edge? | Behaviour risk |
|---|---|---|
| **A. Registration at startup.** A leaf holder (`lib/mcp/tool-pack-slot.ts`) exposes `installToolPacks(registry)` and `requireToolPacks()`. A composition module imports `pack-registry` and installs it. `mcp-tools.ts` reads the holder. This is VS Code's `Registry.as(...)` contribution pattern. | Yes | **Registration order**: any path that reaches `executeTool` before the composition module has run sees no tools. That must fail closed (throw `ToolPacksNotInstalled`) and never return an empty catalog, which would silently strip every coworker of its tools. **Entry points**: Next.js `register()` in `instrumentation.ts` runs once per server instance, but Inngest functions, server-action modules, MCP route handlers, scripts and vitest each need the bootstrap import too, and a guard test must list them. **Bundling**: Next.js builds several server bundles, and module state is not guaranteed to be one instance across them (compare the Turbopack chunk-collision work, [2026-09-17 spec](2026-09-17-turbopack-ssr-chunk-collision-resistance-design.md)). The holder must live on `globalThis` under a `Symbol.for` key, the way `packages/db/src/client.ts` keeps the Prisma singleton. **Cold start**: unchanged, because every pack is still loaded eagerly. **`"use server"`**: the holder module must not be a server-action module, since those export only async functions (AGENTS.md §6). |
| **B. Lazy dynamic import** of `pack-registry` inside `executeTool` / `getAvailableTools` | **No.** A dynamic `import()` is still an edge for tsc and for project references. | `PLATFORM_TOOLS` is a synchronous `const` that many modules read at call time, and every one of them would become async. It helps load order, and load order is not broken (§2.1). **Rejected.** |
| **C. Move the registry.** `mcp-tools.ts` becomes the dispatcher kernel, and the consumers import a new `lib/mcp/platform-tools.ts` facade that composes kernel and registry | No, unless the twenty back-edge consumers also move to the facade *and* the facade leaves the packs' dependency closure. They cannot: the packs' handlers are those consumers. | **Rejected**: it relocates the cycle. |
| **D. Split definitions from handlers.** Each pack exports a pure `definitions` module; `PLATFORM_TOOLS` composes definitions only; handler dispatch goes through option A | The catalog edge disappears; the dispatch edge needs A | Touches all 94 packs. It removes the catalog-only reasons for the back-edges (`operation-authority`, `tool-audit-helpers`, `agentic-loop`), which lets those files leave the component. Largest change of the four, lowest runtime risk for catalog readers. |

**Recommendation: defer.** Option A cuts the guard's number from 75 to 18 on cut-4 in one PR, but what it buys is a boundary between `lib/mcp` and the rest of `lib`. §2.4 shows that boundary is not reachable anyway: 431 upward edges remain after the cut. It is also only 3% of check time. If domain projects ever become the goal, use A with a `globalThis` holder, fail-closed reads and an entry-point guard test, then D for the catalog readers. Until then the all-imports guard keeps the component from growing.

### 4.2 `lib/ai-inference.ts` shim and the adapter loop

| Option | Effect | Risk |
|---|---|---|
| **Leaf error module.** Move `InferenceError` and `classifyHttpError` (pure; no Prisma, no registry) into `lib/inference/inference-error.ts`. `ai-inference.ts` re-exports them, so its public API does not change. The eight adapters import the leaf. | The static 11-cycle is gone; the all-imports 18 drops to 8 (§2.1 last column) | None at load time. `instanceof InferenceError` keeps working because only one class definition exists. |
| Retire the two Phase-11 shims (`lib/ai-inference.ts`, `lib/ai-provider-internals.ts`) by pointing their callers (16 and 7 files) at `lib/inference/*` | Takes the 8 to 4. Removes a second name for one module. | Mechanical, wide diff. Worth doing in the same PR only if it stays reviewable. |
| Adapter registration moved out of `ai-inference.ts` (a composition module that imports the adapters) | Cuts the loop from the other side | Same registration-order risk as 4.1 A, for no extra gain. **Rejected.** |

The 4-file `async-operation-*` cycle and the 2-file `explore/build-process-matrix ↔ feature-build-types` cycle take the same fix: the function one side needs moves into the leaf both sides already share (`parseDurableAsyncProviderContextInput`, and the `FEATURE_BUILD_KIND_VALUES` / `isFixContextComplete` group).

**As landed (PR-2).** The leaf is two modules in `lib/routing/`, not `lib/inference/`: `routing/inference-error.ts` (`InferenceError`, `classifyHttpError`) and `routing/provider-message-format.ts` (the tool-call extractors and `formatMessageFor*`, which `chat-adapter` and `responses-adapter` also imported through the shim). `scripts/application-boundaries.json` makes `routing` the innermost context, so an adapter may not import `lib/inference/*`; the old imports only passed because they went through the root shim. The two smaller cycles each closed through a re-export, so each needed an import retarget rather than a move: `async-operation-worker` imports `AsyncOperationLeaseLostError` from `async-operation-store-shared` (where it is defined) instead of through `async-operation-store`, and `checkPhaseGate` is re-exported by the `lib/feature-build-types.ts` shim and the `lib/explore` barrel instead of by `lib/explore/feature-build-types.ts`, which the matrix imports.

### 4.3 `lib → app/components`

Move the plain TypeScript that `lib` needs (twin snapshot types and demo data, `report-kit` status colours and intent styles, the seven `*-nav.ts` route tables, `alert-humanize`, `grid-*` formatters, `value-stream-layout`) under `lib/` (for example `lib/ui-model/`), and leave re-exports in `components/` only where a component already imports the old path. Move the five `lib/**/*.tsx` files that render `components/` providers to `components/`. This is 21 targets and 44 edges, all mechanical.

## 5. Project references, once acyclic

**Layout (two projects, not six).** Keep `apps/web/tsconfig.json` exactly as it is. Next.js reads its `paths`, `jsx` and plugin settings, `next typegen` writes into it, and editors use it as the whole program. Add configs used only by the typecheck:

```
apps/web/tsconfig.typecheck.json   # solution: "files": [], references → lib, ui
apps/web/tsconfig.lib.json         # composite, declaration + emitDeclarationOnly, outDir .tsbuild/lib,
                                   # rootDir set explicitly, allowJs false; include lib/**, types/**
apps/web/tsconfig.ui.json          # references tsconfig.lib.json; include app/**, components/**, root *.ts
```

`run-tsc.mjs` gains `-b apps/web/tsconfig.typecheck.json`. Through the unchanged `@/` alias, an `app/` import of `@/lib/x` resolves to `lib/x.ts`. That file belongs to the referenced project, so tsc loads `.tsbuild/lib/lib/x.d.ts` instead, and `skipLibCheck` (already on) skips re-checking it. The `.tsbuild/` directory is gitignored. Declaration output is about 18 MB for `lib`.

**What it would buy, from §3.** A UI-only change checks the `ui` project over prebuilt `lib` declarations: about 87 s cold, against 168 s today. Peak memory per compile drops from 5.5 GB to 5.0 GB (`lib`) and 3.5 GB (`ui`). The two compiles run one after the other, because `ui` depends on `lib`, so the dependency chain offers no parallelism. A `lib` change that alters its declarations costs about 98 s (`lib` with emit) plus 87 s (`ui`), *slower* than one program. Warm file-level incrementality (§3, 18–94 s) already matches or beats this for edit loops. Project references pay off where warm state is lost (CI, fresh worktrees) and where memory is tight. Warm-starting (§6 PR-1) addresses the first more cheaply.

**The Prisma generated client.** Leave it where it is. It is already unchecked (`@ts-nocheck`), and `skipLibCheck` would skip it as declarations too. Making `@dpf/db` a composite referenced project saved 2–3 s of parse and bind time and about 250 MB, with no change in check time (§3). Revisit only for memory, or when `@dpf/db` becomes a referenced project for other reasons: its own `typecheck` script already compiles `src` and `generated` separately. Correct the plan's §10.1 row ("the largest remaining lever") in the plan's next status update, which the coordinator owns. The lever is line count, not time.

## 6. Recommended PR sequence

| PR | Change | Expected measure after |
|---|---|---|
| **PR-1 (first code PR)** | **Warm-start the web typecheck in CI.** The `typecheck` job restores `apps/web/tsconfig.tsbuildinfo` from an `actions/cache` entry that only pushes to `main` write, keyed on the lockfile and tsconfig hashes with a `main` restore key. PRs read it and never write it. tsc versions each file by a hash of its text, so a restored build-info from `main` is reused for every file the PR leaves unchanged. The ratchet report (`DPF_TSC_PROGRAM_REPORT`) still lists the full program, because `--listFiles` prints every program file in incremental mode as well. | CI web typecheck ≈ 20–95 s on a cache hit (by change type, §3) instead of about 170 s cold. On a miss, same as today. `check-typecheck-baseline.mjs` records `Check time` as informational only, so warm runs do not trip it. Note: this is plan step 3 ("CI shape") territory, landed early because it is where step 2's incremental goal is cheapest. |
| PR-2 | §4.2: leaf `inference-error.ts`, fix the 4- and 2-file static cycles, and a **runtime-acyclic ratchet** (below) | Static value SCCs 11, 4, 2 → none. All-imports largest unchanged at 75 (cut-4 base); the inference component 18 → 8. |
| PR-3 | §4.3: `lib` stops importing `app/` and `components/`; a guard holds the edge count at 0 | `lib → ui` edges 44 → 0 |
| PR-4 | Explicit return types on the 13 files with `TS2883`; `lib` declaration emit clean | 31 → 0 declaration errors |
| PR-5 (conditional) | §5 layout (`lib` + `ui` references), taken only if, after PR-1, the measured CI typecheck on a cache miss or the heap ceiling is still a problem. `check-typecheck-baseline.mjs` learns to sum the per-project `--listFiles` reports. | UI-only change ≈ 87 s cold; peak heap ≈ 5.0 GB |
| Deferred | §4.1 pack-registry inversion (A, then D); domain projects | All-imports 75 → 18. Domain projects still need the 431 upward edges of §2.4 removed first. |

## 7. Decision needed

Whether M11 step 2 is re-scoped from "project references for the four heavy domains" to "warm start, runtime-acyclic, `lib`/`ui` boundary, then two references if still justified". The measurements in §2.4 and §3 argue for it. Two recorded facts would have to change to keep the original scope: a new check-time profile that concentrates cost in the domains, or a decision to physically re-home about 300 files. This belongs to the platform-architecture owner of the cycle baseline. Route it through `principle_decide` with options `rescope_to_measured_levers` vs `domain_projects_as_planned` vs `defer_step_2`. Cost axes, higher meaning worse: domain projects score high on `blast_radius` (312 files touched) and `operator_effort`; re-scoping scores low on both. Filed 2026-10-01, after PR-1 to PR-4 had shipped: `principle_decide` (platform-development) recommended `rescope_to_measured_levers` with high confidence (composite 10.7 against 7.0 for `defer_step_2` and 4.0 for `domain_projects_as_planned`), ledger DI-F2DCF2FEDBE7. The outcome column is not filed: `record_decision_outcome` is refused with `agent-grant-missing`.

## 8. Measurement and ratchets

- **Keep** `check-no-web-import-cycle-growth.mjs` (all imports, shrink-only). Retighten it when cut-4 merges (81 → 75).
- **Add a runtime mode** to the same guard, not a second guard: classify edges as §1 does and fail if the static value graph has any SCC. PR-2 cut all three SCCs (17 files) in the same change, so the mode landed as forbid (budget 0) with no baseline step. The classifier now lives in the guard (`classifyEdges`, `stronglyConnectedComponents`), so §2's static-value numbers are reproducible from it.
- **Add a `lib → ui` edge budget** (44, shrink-only) in the same guard family until PR-3 takes it to 0. *Landed with PR-3 at 0:* `scripts/application-boundaries.json` declares `app` and `components` as `outerLayers`, and `check-application-boundaries.mjs` refuses any import from `apps/web/lib` into them, every kind counted (value, `import type`, dynamic, `import("x").T`). An edge that cannot move yet needs an owned, dated exception in the same file.
- **Typecheck baseline:** `sbom/typecheck-baseline.json` keeps ratcheting lines. After PR-1 its `Check time` stays informational (it measures cache state, not code). Measure cold time with `check-typecheck-baseline.mjs --measure` under `flock`, as today.
- **PR-4 landed (2026-10-01):** `lib` declaration emit went from 31 `TS2883` in 13 files to 0, measured on the same `lib/**` emit config (`declaration`, `emitDeclarationOnly`, explicit `rootDir`, `outDir` outside the tree). The fixes are explicit return types and named Prisma payload types. Two needed an exported name, because the inferred type crossed a module: `TaxWorkspaceState` (and its row types) in `tax-remittance-service.ts`, and the `SelfUpgradeRunRow` interface in `run-store.ts`, which must be an interface because a Prisma model alias does not survive into a caller's inferred type. With `allowJs: false`, 15 more errors remain, all from `.ts` files importing `.mjs` modules that have no `.d.mts` (13 `TS7016` plus 2 knock-on). So a PR-5 `lib` project keeps `allowJs` on with an `outDir`, which writes no `.d.mts` into the tree. No ratchet guard was added.
- **Re-measure before PR-5:** rerun the four §3 configurations on the tree PR-4 leaves behind. PR-5 proceeds only if a UI-only cold check still saves 40% or more against the whole program on CI hardware. Not yet run; recorded as inconclusive on 2026-10-01 (BI-0A3B155F evidence). `scripts/host-resource-runner.mjs` paced heartbeats for a 10-minute lease while the server granted 2, so every run was killed at about 2 minutes (BI-E226C954). After that fix the run queued on host memory reserve, and the resumer flooded the queue (BI-FD487D99). The intended configurations: whole program cold; `lib/**` with declaration emit; and `app/`+`components/` with `@/lib/*` mapped to those declarations. BI-71085BD4 proposes making this a committed measurement with the 40% threshold declared.

## 9. Research and benchmarking

| Source | How it handles this | What DPF adopts or rejects |
|---|---|---|
| **TypeScript handbook, [Project References](https://www.typescriptlang.org/docs/handbook/project-references.html)** | `composite` forces `declaration` and requires every file in the project's `include`. Imports of a referenced project load its output `.d.ts`. It recommends a "solution" `tsconfig.json` with `files: []` and references to the leaf projects, and warns that `tsc -b` acts as if `noEmitOnError` were set and that editors need built outputs. | **Adopt** the solution-file shape, but as a separate `tsconfig.typecheck.json`, so the Next.js and editor `tsconfig.json` keeps its paths and full program. **Adopt** the declaration-readiness work (PR-4) as a precondition. |
| **VS Code, [source code organisation](https://github.com/microsoft/vscode/wiki/Source-Code-Organization) and [`eslint.config.js`](https://github.com/microsoft/vscode/blob/main/eslint.config.js)** | Layers by target runtime (`common`, `browser`, `node`, `electron-*`), enforced by local lint rules `local/code-layering` and `local/code-import-patterns`. Contributions register into registries and services through `registerSingleton`, and per-target `workbench.*.main.ts` entry files import them for side effects. | **Adopt** layer-by-dependency rather than by feature directory (§2.4): the `lib`/`ui` split is DPF's `common`/`browser`. **Adopt** the registration pattern as the documented option for the pack registry (§4.1 A), with DPF's extra constraints (fail closed, `globalThis`, entry-point test), because Next.js server bundles do not share one explicit composition root the way the VS Code workbench does. |
| **Nx, [enforce module boundaries](https://nx.dev/docs/features/enforce-module-boundaries)** | Projects carry tags, and the `@nx/enforce-module-boundaries` lint rule checks imports against `depConstraints` (`sourceTag` → `onlyDependOnLibsWithTags`). | **Adopt the idea, not the tool.** The `lib → ui` budget and the runtime-acyclic mode are the same constraint, expressed in the existing guard family with no new dependency (absorb, don't adopt). **Reject** Nx itself: a workspace orchestrator for one boundary. |
| **TypeScript native port, [announcement](https://devblogs.microsoft.com/typescript/typescript-native-port/) (11 March 2025)** | Reports about 10× faster builds; the VS Code codebase (1.5 M lines) went from 77.8 s to 7.5 s. | **Track, do not adopt yet.** It is the largest known check-time lever, much larger than anything project structure can give. Adopt through the `tool-evaluation` skill when the pinned-guard and `run-tsc.mjs` paths can run it. None of PR-1 to PR-4 conflicts with it. |

## 10. Out of scope

- Editing the dependency-diet plan: the coordinator records status in one follow-up.
- `lib/work-management`'s two 14-file type-only cycles: they sit inside one layer (§2.3).
- The production build (420 s) and the UX route sweep: plan step 3.
