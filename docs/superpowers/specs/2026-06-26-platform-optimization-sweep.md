# Platform Optimization Sweep — Findings & Candidate Epic

**Date:** 2026-06-26
**Status:** **FILED 2026-06-26** — `EP-PLATFORM-OPTIMIZATION` + 8 net-new BIs created in the live backlog; 3 continuations appended to their spine BIs. Analysis delivered; **do not auto-build** — items sit in `triaging` for operator sequencing.
**Author:** Claude (architecture-optimization sweep, 7-agent parallel evidence pass)
**Predecessor:** [EP-PLATFORM-CONSOLIDATION](2026-06-25-platform-consolidation-spine-design.md) — "collapse accidental seams; preserve real runtime/trust boundaries"
**Filed epic:** `EP-PLATFORM-OPTIMIZATION` (spec attached as `specPath`)

---

## 0. Second-sweep review notes

This pass rechecked the draft against the local worktree, recent merge history, and live DPF backlog state on 2026-06-26.

- **Snapshot:** `D:\DPF\.claude\worktrees\affectionate-wright-51ce28` at `187fa273f` (`#2401`), tracking `origin/main` but 3 commits behind (`#2402`, `#2404`, `#2405`). The behind commits look unrelated to the optimization surfaces, but each BI must refresh counts before implementation.
- **Live spine status:** `BI-ARCH-CONTRACTS` is done. `BI-ARCH-TOOLPACKS`, `BI-ARCH-DELIVERY-IA`, `BI-ARCH-BUILDSTUDIO-NS`, `BI-ARCH-SECTIONNAV`, `BI-ARCH-UI-PRIMS`, and `BI-ARCH-PACKAGES` are in progress under `EP-PLATFORM-CONSOLIDATION`. The optimization wave must extend those records where possible.
- **No new backlog created by this document.** Candidate BI IDs below are labels for operator discussion. If approved, query live backlog again before filing and prefer updating existing spine BIs over creating duplicates.
- **Important correction:** `PIR-4QRQV` was not found in the live backlog. The style-drift false positive is verified in code, but it should be treated as an unfiled guard defect to fold into the ratchet BI or attach to `BI-ARCH-UI-PRIMS`.

### 0.1 Filed delivery (2026-06-26)

On operator direction ("deliver this sweep"), the analysis was filed into the live backlog. **One cohesive wave** was chosen (operator §10.1 default): one epic for the net-new BIs, continuations appended to their spine BIs (not duplicated).

- **Epic:** `EP-PLATFORM-OPTIMIZATION` (priority 2, `source=user-request`, this spec attached as `specPath`).
- **8 net-new BIs** (all `triaging` + `proposedOutcome=build` + sized + linked — filed for sequencing, **not** promoted to a build): `BI-OPT-RATCHETS` (M, chore), `BI-OPT-DISPATCH` (L), `BI-OPT-ROUTING-CACHE` (M), `BI-OPT-DB-HOTPATH` (M), `BI-OPT-ACTION-WRAPPER` (M), `BI-OPT-CONVERGENCE-UTILS` (S), `BI-OPT-DEPS` (S, chore), `BI-OPT-FAT-ACTIONS` (L, depends on `BI-OPT-ACTION-WRAPPER`).
- **3 continuations appended to spine BIs** (bodies extended, not duplicated): MCP inline-logic extraction + 7-cluster sequence → `BI-ARCH-TOOLPACKS`; SectionNav `flat` variant + migrate remaining 10 + clone ratchet → `BI-ARCH-SECTIONNAV`; style-drift false-positive cross-ref → `BI-ARCH-UI-PRIMS` (the fix itself lives in `BI-OPT-RATCHETS`).
- **Not built, not promoted.** No product code changed. Next step is operator triage/sequencing of the top-5, starting with `BI-OPT-RATCHETS`.

## 1. Goal & relationship to the consolidation spine

EP-PLATFORM-CONSOLIDATION started correcting the **boundaries** (contracts inverted off Prisma, a `ToolPack` registry, a Delivery home, one `SectionNav` renderer, UI primitives, package rules). Those seams are now in much better shape, but not all are complete. Treat this optimization wave as "reduce the bodies behind the new boundaries" rather than "the spine is finished."

This wave reduces the **bodies behind those boundaries** and **locks the gains so they cannot regress**. The thesis from the spine still holds and is the organizing principle here:

> The mega-module is a *symptom*, not the disease. Find the other god-files and accidental dumps, collapse them parity-first, and codify a guard wherever a refactor establishes an invariant — otherwise the next AI-first capability silently re-grows what we just shrank.

The sweep was run as **7 parallel evidence-gathering agents** (MCP mega-module, Build Studio dispatch, `lib/actions`, AI hot path, DB access, guards+deps, convergence debt). Every finding below carries a file:line and a measurement. Findings that turned out to be *non-problems* are recorded in §7 (Refused) — being honest about ROI is part of the deliverable.

**Scope discipline.** Several findings are **continuations of in-flight spine BIs**, not net-new work (§5.A). The remaining findings are candidate net-new work (§5.B). Per AGENTS.md §6, extend an existing BI whenever the live backlog has a matching owner.

---

## 2. Evidence base — the measured repo

Top source files by LOC (excluding tests/generated/vendor):

| File | LOC | Note |
|---|---:|---|
| `apps/web/lib/mcp-tools.ts` | **15,546** | still 6× the next file; 237 inline `executeTool` cases remain |
| `apps/web/components/platform/AiOperationsMap.tsx` | 2,625 | component |
| `packages/db/src/seed.ts` | 2,489 | seed (excluded from ratchets) |
| `apps/web/lib/actions/agent-coworker.ts` | 2,308 | cohesive (anti-finding, §7) |
| `apps/web/lib/tak/agentic-loop.ts` | 2,093 | the AI hot path |
| `packages/db/src/seed-profession-corpus.ts` | 1,851 | seed/corpus (excluded from ratchets) |
| `apps/web/lib/actions/tax-remittance.ts` | 1,704 | fat server action |
| `apps/web/lib/integrate/build-orchestrator.ts` | 1,635 | cohesive state machine (anti-finding, §7) |
| `apps/web/lib/actions/build.ts` | 1,613 | fat server action |
| `apps/web/components/build/BuildStudio.tsx` | 1,472 | production Build Studio surface |

The second sweep intentionally uses named hot spots rather than broad directory LOC as the ranking input. The important shape is unchanged: the codebase is already disciplined about many indexes, boundaries, and guardrails; the leverage is concentrated in a few oversized bodies, hot-path loaders, and missing ratchets.

---

## 3. Leverage-ranked master table

Leverage = (impact × tractability) discounted by risk and churn. Components shown so the operator can re-rank.

| # | Candidate BI | Bucket | Size | Risk | Primary gain | Why this rank |
|---|---|---|---|---|---|---|
| **1** | **Guard ratchets** (module-size + tool-pack-inline + style-drift false-positive fix) | net-new | M | Low | Maintainability *insurance* | Cheapest, compounding; protects this epic **and** the spine from silent regression. Folds in a verified guard defect. |
| **2** | **MCP inline-logic extraction** | continues BI-ARCH-TOOLPACKS | XL | Low–Med | Kills the 15.5k god-file; defends local tool economy | Biggest single sink; proven parity playbook already exists. |
| **3** | **External-agent dispatch convergence** | net-new | L | Med | ~800 LOC dedup **+ a latent bug** | Dedup *and* correctness; completes the §17 "thin adapters" contract that's half-built. |
| **4** | **Routing-loader request cache** | net-new | M | Low–Med | Perf on the AI hot path | Best pure-perf: removes ~40–60 redundant queries per multi-iteration turn. |
| **5** | **DB hot-path** (BacklogItem `status` index + 2 N+1 batchings) | net-new | S–M | Low | Perf; one user-facing MCP tool | One migration = broad win; collapses an O(nodes×depth) N+1. |
| **6** | **Shared action auth wrapper** | net-new | M | Low | ~500 LOC dedup; auditable auth | Mechanical, broad, provably-identical source. |
| **7** | **Convergence utils** (`slugify` + `toCsv`) + SectionNav tail | net-new + continues BI-ARCH-SECTIONNAV | S-M | Low | Kills *live* drift | Cheapest-per-site wins; finishes a started migration without creating a false abstraction. |
| **8** | **Dependency cleanup** (`react-force-graph-2d`; evaluate `dagre` -> `elkjs`) | net-new | S | Low | Bundle weight | Free win for the unused dep; layout consolidation only if visual parity is cheap. |
| **9** | **Fat server actions → domain modules** | net-new | L | Med–High | Testability | Real, but risk-gated; sequence last; depends on #6. |

---

## 4. Detailed findings — by lens

### 4.1 God-files / mega-modules

**F-A · MCP mega-module — 237 inline handlers remain (continues BI-ARCH-TOOLPACKS).**
`apps/web/lib/mcp-tools.ts` is 15,546 LOC on the reviewed snapshot: a large `PLATFORM_TOOLS` definition literal (`:436`→`:4651`) and an `executeTool` switch (`:4987`→EOF) whose **237 `case` arms** still dominate the file. Five packs already dispatch off-switch via `TOOL_PACK_REGISTRY` (`:434`, `:5090`). Crucially, the body is **cheaper than it reads**: the draft's handler-complexity census shows roughly 100+ arms already delegate to a sibling module (one `await import` + a call) — the "feedback-pack" shape. Only ~26 arms (~6k LOC) carry genuinely heavy inline logic.

Per-cluster sizing and the parity-first extraction sequence (cheap mechanical → XL lift):

| Order | Cluster | #tools | est. handler LOC | Action | Size |
|---|---|---:|---:|---|---|
| 1 | coworker/thread | 11 | 300 | pack-in-place (all thin) | S |
| 2 | marketing | 16 | 432 | pack-in-place (→ `lib/marketing.ts`) | S/M |
| 3 | backlog/epic | 21 | 1,164 | mostly pack-in-place; light lift of 2 (→ `lib/backlog/`) | L |
| 4 | sandbox | 17 | 785 | lift `run_sandbox_command` body (→ `lib/sandbox*`) | M/L |
| 5 | build-evidence/review | 17 | 1,813 | **lift-then-pack** (`reviewDesignDoc` 484, `reviewBuildPlan` 354) | XL |
| 6 | deploy/release | 11 | 1,217 | lift (→ `lib/deploy/`, `lib/release/`) | L/XL |
| 7 | wiki/knowledge + hive | 21 | 1,573 | lift last (`principle_decide` 365, `contribute_to_hive` 374) | XL |

> Sibling domains already exist (`lib/build/`, `lib/backlog/`, `lib/wiki/`, `lib/deploy/`, `lib/release/`). Most extractions are *re-home the call*, not greenfield. **Do the cheap mechanical clusters first to build the parity-test rhythm before the XL lifts.** Smallest clusters (code-graph, build-engine) are not worth standalone packs — batch them.

**F-B · Build Studio dispatch — a half-built adapter contract (net-new, BI #3).**
The `BuildAgentRunner` contract *exists* (`apps/web/lib/integrate/sandbox/agent-runner-types.ts:56`) but every runner is a 30-line pass-through to a legacy `dispatch*Task`; the real duplicated shell lives below it. md5 confirms **byte-identical** blocks across the four CLI dispatchers — the `roleInstructions` record and the `taskPrompt` assembly appear **4×** verbatim. Estimated **~55–65% of each dispatcher (~200 of 380–470 LOC) is near-identical** (temp-file write, `spawn docker exec` + timeout, stderr progress parse, result shaping). The genuinely surface-specific 35–45% is **auth** (4 distinct flows) and the one CLI-invocation line.

Two compounding problems: (1) drift is already happening — opencode silently diverged on the prompt block; grok's progress-parser has fallbacks the others lack. (2) `ideate-dispatch.ts` (746 LOC) re-implements auth a **third** time and still uses the **stale `grok -p - --no-auto-update` invocation that `grok-dispatch.ts:326` documents as removed/broken** — a latent failure waiting on the ideate path.
*Fix:* push the shared shell down into a `runSandboxAgentCli(spec, hooks)` base; each surface supplies only `injectAuth()`, the exec line, and `parseResult()`. **~800 LOC → ~250.**

> **Implemented (BI-OPT-DISPATCH, 2026-06-26).** Shared shell extracted to [`apps/web/lib/integrate/sandbox/agent-cli-runtime.ts`](../../../apps/web/lib/integrate/sandbox/agent-cli-runtime.ts) — housed *with* the `BuildAgentRunner` contract so the contract owns the shell. It exports `runSandboxAgentCli` (the `spawn docker exec` + timeout + stdout/stderr-stream + close/error loop), `buildSpecialistTaskPrompt` + `buildSpecialistInstructions` + `SPECIALIST_ROLE_INSTRUCTIONS` (the md5-confirmed prompt blocks, single-sourced), and `writeSandboxFile` / `ensureSandboxNodeUser` / `sandboxExec`. The four CLI dispatchers (`claude`/`codex`/`grok`/`opencode`-dispatch.ts) and `ideate-dispatch.ts` now delegate the spawn/prompt/temp-file mechanics to this base; the `*-agent-runner.ts` contract adapters are unchanged (they call the dispatchers, which now own only auth + exec-line + parse). **Kept separate** as real protocol differences (not folded): the 4 auth flows (claude OAuth-refresh; codex `auth.json` root; grok `auth.json` + token write-back; opencode credential-free + endpoint preflight), opencode's `--format json` stream parse + `detectOpencodeFatalError`, codex's inline `sh -c` + root exec + resolve-on-any-exit, grok's trap-cleanup runner + generic progress fallbacks, and per-surface temp-file perms (644 vs 600 vs default). **Ideate stale-grok fix:** its `grok -p - --always-approve --no-auto-update < file` invocation (which passed `-` as the literal prompt, ignored the file, and used a removed flag — so the ideate-grok path never ran) is replaced with the proven `grok --prompt-file <file> --always-approve` form from `grok-dispatch.ts`. **Parity:** runtime behavior preserved; the orchestrator's `runner.run` call site is untouched. One intentional unification — claude's sandbox-prep now uses the shared `|| true`-tolerant `ensureSandboxNodeUser` (the grok/opencode form) instead of its stricter inline variant. Verified: 1053 `lib/integrate/` tests pass (incl. `opencode-dispatch.test.ts`, `ideate-dispatch.test.ts`, `agent-runner-contract.test.ts`); `tsc --noEmit` clean on all six changed files (run via a donor toolchain — this worktree is source-only; canonical gate is CI).

**F-C · `lib/actions/` — fat server actions (net-new, BI #6 + #9).**
247 files / 67,164 LOC. The top files are **not** thin auth+validate+delegate wrappers: each carries 50–67 inline `prisma.*` calls, and the headline domains route **0** writes through their rich sibling module (`crm.ts`→`lib/crm/` 0 imports; `ea.ts`→`lib/ea/` 0 imports; `tax-remittance.ts` imports `lib/finance/` *validation* but keeps all 63 writes inline). Two distinct findings fall out — the cheap mechanical one (#6, below) and the risk-gated one (#9, §5.B).

### 4.2 Duplication / convergence debt

**F-D · No shared action auth wrapper — ~500 LOC copy-paste (net-new, BI #6).**
**71 of 247** action files define their own local `require*()` auth helper; the `can()` capability primitive is shared (`@/lib/permissions`) but its `auth()→session→can()→throw` wrapper is not. `requireManageFinance` is **verbatim across 8 finance files** (`ai-provider-finance, ap, assets, banking, expenses, finance, recurring, tax-remittance`). No `withAuth`/`actionWrapper`/`defineAction` exists (0 hits).
*Fix:* `lib/actions/shared/guards.ts` exporting `requireCapability(cap)` + `withCapability(cap, fn)`; replace 71 local helpers with a one-line call-site swap. Auth becomes auditable in one place.

**F-E · Convergence cleanups — live drift (net-new BI #7 + continues BI-ARCH-SECTIONNAV).**
- **Slug generators:** the kebab chain `.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")` is copied **verbatim at ~21 sites**; no shared `slugify` exists. Drift is *already live* — `project-events.ts:490` uses `(^-|-$)`, a cosmetic divergence. Cheapest win on the board (S).
- **SectionNav tail:** the renderer shipped and the reviewed snapshot has **4 of 14** `*TabNav` wrappers consuming it (`Platform`, `Admin`, `Finance`, `Ops`). The 10 unmigrated wrappers (`StorefrontAdmin`, `Product`, `EA`, `Employee`, `Marketing`, `Compliance`, `Customer`, `Audit`, `Identity`, `Workforce`) still carry local markup/active-state behavior. Most are flat-nav variants that should migrate through a `flat` config shape rather than each keeping its own renderer. `StorefrontAdminTabNav` also breaks token hygiene (inline `style={{}}`). The prize is not just ~350 LOC; it is a **ratchet forbidding the next raw clone**.
- **CSV serializers:** 3 independent hand-rolled implementations outside report-kit (`grid-csv.ts`, `actions/reports.ts:171`, `finance/reports route:88`) with *different* escaping/line-endings — a CSV bug fixed in one silently persists in the others. Extract a server-safe `toCsv()`.

### 4.3 Performance — the AI hot path

**F-F · Routing loaders re-run every loop iteration, uncached (net-new, BI #4).**
On **every** agentic-loop iteration (up to 200), `prepareRoute` (`routed-inference.ts:209`, called from `agentic-loop.ts:1431/1439`) rebuilds the full routing pipeline. Three loaders — `loadEndpointManifests` (`routing/loader.ts:98`, a `modelProfile.findMany` + a 35-field `.map` per model), `loadPolicyRules` (`:199`), `loadOverrides` (`:222`) — and the golden-triangle posture reads (`golden-triangle/persistence.ts:205`) are **uncached**, in contrast to siblings that *do* cache (`local-only.ts:39` TTL, `task-requirements.ts:18`). A 10-iteration build turn ≈ **40–60 redundant queries returning identical rows**.
*Fix:* request-scoped memo (a `RoutingDataBundle` threaded into the loop, invalidated only on the rare degrade/cooldown mutation — `markModelDegraded`/`markEndpointUnavailable` are clean hooks) or short TTL caches mirroring the existing pattern. **Re-running the *decision* `routeEndpointV2` per iteration is intentional** (lets a cooled-down endpoint be skipped); cache the *inputs*, not the decision. Rider: `getAvailableTools` runs the full-registry filter + grant DB read **twice** per request and `getAgentToolGrantsAsync` a **third** time (`agent-coworker.ts:1134/1195/1221`) — dedupe to one pass (S).

### 4.4 Performance — database access

**F-G · Concentrated N+1s + one missing core index (net-new, BI #5).**
The schema is heavily indexed, so leverage is in three spots:
- **`BacklogItem.status` has no index.** Confirmed: the model carries only `@@index([portfolioId])` (`schema.prisma:54`) yet `status` is filtered at **25 sites** including hot feeds/selectors (`backlog-selector.ts:101`, `activity-feed-data.ts:223`, `remediation-teeup.ts:184`). Add `@@index([status])` (likely `[status, updatedAt]`). One migration, broad win. (S)
- **EA traversal BFS N+1**, exposed as the `run_traversal_pattern` **MCP tool** (`mcp-tools.ts:14604`): `traversal-executor.ts:84` does `eaRelationship.findMany` **per node, per depth** (maxDepth 6) over a 331+-edge graph. Batch with `where:{ fromElementId:{ in: currentIds } }` per depth step. (M)
- **Model discovery** `findUnique`+write **per model** (`ai-provider-internals.ts:420/487`) — 100s of rows for OpenRouter. Batch to one `findMany({ in })` → `createMany` diff. (M)

### 4.5 Guards & dependency surface

**F-H · Guard hardening — the "make it stick" layer (net-new, BI #1).** Three guard items, independently corroborated (the tool-pack ratchet was found by *both* the MCP agent and the guards agent):
- **Style-drift false positive (verified, not live-filed):** `HEX_RE` (`check-style-drift.mjs:36`) matches all-decimal `#NNNN` tokens of hex-valid length (3/4/6/8), and `scan()` never strips comments before `line.match` (`:70`). `#2401`, `#2395` etc. — which appear in this repo's own comment headers — can falsely register as new hardcoded colors. *Fix:* ignore pure-decimal matches (`m => !/^#[0-9]+$/.test(m)`) and/or strip comments before scanning; add a fixture with `#2401` in a comment and a real `#1a2b3c` color.
- **Module-size ratchet (none exists):** nothing stopped `mcp-tools.ts` reaching 15.5k LOC. Add `check-module-size.mjs` mirroring the style-drift baseline idiom: a frozen `module-size-baseline.json`, an 800-LOC ceiling for new files, and *baselined files may only shrink*. Existing large files get baselined; seeds/generated files are excluded.
- **Tool-pack inline-case ratchet (none exists):** with 237 live cases and `getHandler` consulted first, a new tool added inline silently bypasses the pack architecture. Assert in `tool-registry.test.ts` that no *new* `case` appears outside a frozen baseline — forces new tools into packs and ratchets the inline set down as cases migrate. *This is the enforcement teeth BI-ARCH-TOOLPACKS currently lacks.*
- *Confirmed adequate (no work):* `check-package-boundaries.mjs:20` already blocks `@dpf/db`/Prisma from portable packages.

**F-I · Dependencies — mostly healthy (net-new, BI #8).** `scan:deps` (2,005 components, 0 blocking) and `check:new-deps` run clean. Two genuine candidates:
- **`react-force-graph-2d` (`apps/web/package.json:59`) — declared, 0 usages repo-wide. Remove (free win).** `TopologyGraph.tsx` uses a custom SVG layout, not force-graph.
- **`dagre` + `@types/dagre`** used at 1 site (`lib/graph/layout-hierarchical.ts`); `elkjs` already does layered layout in other graph code. Treat as an evaluation, not an automatic removal: only consolidate if screenshots or graph-layout tests prove visual parity.

---

## 5. Candidate epic & BIs

**Proposed epic: EP-PLATFORM-OPTIMIZATION** — "Reduce the bodies behind the consolidated boundaries, harden the AI hot path, and ratchet the gains so they can't regress."

### 5.A Continuations of in-flight spine BIs (extend, do not duplicate)

| Continuation | Extends | Deliverable | Size |
|---|---|---|---|
| MCP inline-logic extraction | **BI-ARCH-TOOLPACKS** | The §4.1 F-A 7-cluster sequence; cheap-first | XL |
| SectionNav `flat` variant + migrate remaining 10 + clone ratchet | **BI-ARCH-SECTIONNAV** | §4.2 F-E | M |
| Style-drift false-positive fix (verified, unfiled) | **BI-ARCH-UI-PRIMS** guard follow-on or **BI-OPT-RATCHETS** | §4.5 F-H | S |

### 5.B Net-new optimization BIs

| Candidate BI | Finding | Size | Depends on |
|---|---|---|---|
| **BI-OPT-RATCHETS** — module-size + tool-pack-inline ratchets (+ style-drift false-positive fix) | F-H | M | — |
| **BI-OPT-DISPATCH** — converge external-agent dispatch into `BuildAgentRunner`; fix ideate's stale grok call | F-B | L | — |
| **BI-OPT-ROUTING-CACHE** — request-scoped routing-loader cache + dedupe double tool-filter | F-F | M | — |
| **BI-OPT-DB-HOTPATH** — `BacklogItem.status` index + EA-traversal & model-discovery batching | F-G | S–M | — |
| **BI-OPT-ACTION-WRAPPER** — shared `requireCapability`/`withCapability`; replace 71 preambles | F-D | M | — |
| **BI-OPT-CONVERGENCE-UTILS** — shared `slugify` (~21 sites) + server-safe `toCsv` (3 sites) | F-E | S | — |
| **BI-OPT-DEPS** — remove `react-force-graph-2d`; evaluate `dagre`→`elkjs` parity before consolidation | F-I | S | — |
| **BI-OPT-FAT-ACTIONS** — push orchestration out of `tax-remittance`/`build`/`crm`/`ea` into domain modules | F-C | L | BI-OPT-ACTION-WRAPPER |

---

## 6. Recommended sequencing & top-5 walkthrough

**Sequence by leverage, with the cheap protective guard first:**

1. **BI-OPT-RATCHETS (do first).** It is the cheapest item and the multiplier for everything else — including the in-flight spine. Land the module-size + tool-pack ratchets *before* the big extractions so the gains can't be silently undone, and fold in the verified style-drift false-positive fix while touching the guard harness. M, low risk.
2. **MCP inline-logic extraction (BI-ARCH-TOOLPACKS continuation).** The headline god-file. Run the cheap mechanical clusters (coworker, marketing, backlog) first to build the parity-test rhythm, then the XL lift-then-pack clusters. Gated by the ratchet from step 1 so each extraction is permanent. XL.
3. **BI-OPT-DISPATCH.** Best dedup-plus-correctness item: ~800 LOC collapsed into the §17 adapter contract that's already half-built, and it removes a latent stale-grok failure on the ideate path. L.
4. **BI-OPT-ROUTING-CACHE.** The best pure-performance win, on the most latency-sensitive code in the platform. M.
5. **BI-OPT-DB-HOTPATH.** Cheap, low-risk perf: one index migration with a broad blast radius plus two N+1 collapses (one behind a user-facing MCP tool). S–M.

Then the second tranche in parallel as capacity allows: **BI-OPT-ACTION-WRAPPER** (#6) → unblocks **BI-OPT-FAT-ACTIONS** (#9); **BI-OPT-CONVERGENCE-UTILS** (#7) and **BI-OPT-DEPS** (#8) are independent quick riders.

**Execution-shape note (lesson from the spine).** Deep stacked PRs fought the merge queue last wave (cumulative `base=main` squashes reorder and absorb lower PRs). These BIs are deliberately **independent** — prefer one-concern PRs, not a stack. The MCP extraction is the only multi-slice item; ship it as independent per-cluster PRs, each green on the existing parity tests.

---

## 7. Refused / anti-findings (honest ROI)

The sweep deliberately looked for reasons *not* to act. These are confirmed non-problems — touching them is churn-for-churn's-sake:

- **EA reconcilers are already converged.** The 15 `reconcile-*.ts` files share the seam `buildXModel() → applySysmlModel()` (the shared engine); the per-domain files are the small mappings, and #2385 deliberately bought per-domain failure isolation. Collapsing them into one `reconcile(domain,…)` would *re-entangle* what was just isolated. **Leave it.**
- **`agent-coworker.ts` (2,308) is not a dump.** 12 small exported actions + a cohesive conversation-snapshot/portal-context bridge. Splitting by LOC alone fragments one concept.
- **`build-orchestrator.ts` (1,635) is one cohesive phase state machine.** `runBuildOrchestrator` is a single linear gated flow; only leaf helpers (a 35-line sanitize regex, parsers) are worth relocating — and that's low priority.
- **`compliance.ts` (987, 45 exports)** is what a *healthy* action file looks like — many small cohesive actions. Do not split for size.
- **Dispatch auth must stay 4 strategies.** OAuth-refresh / `auth.json` / token-write-back / credential-free-preflight are real protocol differences, not duplication. No new `ExternalAgentDispatcher` type — push the body *into* the contract that exists.
- **Don't shrink the platform tool registry for token reasons.** The model never sees the whole registry; the attach cap (48, window-scaled) + defer/`load_tools` already bound the payload. Token pressure is solved. The registry's real tax is *authority resolution* (F-F rider), not the prompt.
- **124 `*Panel` / 38 `*Card` components** are domain-distinct; no structural-twin evidence. Collapsing would manufacture a false abstraction.
- **`recharts`, `undici`, `pg`, `nanoid`** are single canonical libs behind clean seams — no duplicate doing the same job.
- **Hot-path micro-opts** (`enrichToolDescriptions` rebuild, full-registry filter cost) are capped CPU work, no I/O — refuse until proven hot.

---

## 8. Verification strategy (per BI)

All BIs satisfy the standard build gate (targeted vitest, `pnpm --filter web build`, UX exercise where applicable, migration apply) plus:

- **Ratchets:** the guard must pass on current `main` after baselining, and a deliberately-oversized fixture must fail it. Style-drift false-positive fixture: a `#2401`-in-comment case must pass; a real `#1a2b3c` must still fail.
- **MCP extraction:** existing parity nets stay green — `tool-registry.test.ts`, `mcp-governed-execute.test.ts`, and the per-domain `mcp-tools-*.test.ts`. Definition discovery + grant gating + execute dispatch unchanged per cluster.
- **Dispatch convergence:** per-surface dispatch tests (`opencode-dispatch.test.ts` et al.) green; the four auth flows exercised; opencode's JSON-stream/fatal-error path preserved.
- **Routing cache:** add a test asserting the loaders are invoked once per request (not per iteration) and that a degrade event invalidates. No change to routing *decisions*.
- **DB:** migration applies cleanly; an `EXPLAIN` or query-count assertion on the traversal/selector paths shows the N+1 collapsed.
- **Action wrapper / fat-actions:** the moved logic must be covered by existing domain tests *before* the move; behavior-preserving.

---

## 9. Research & benchmarking

This extends the external benchmarking in the [consolidation spine §4](2026-06-25-platform-consolidation-spine-design.md) (Nx module boundaries, Backstage catalog/plugin model, MCP tools spec) rather than repeating it. Patterns adopted in this wave:

- **Baseline/ratchet CI guards** — the local idiom already proven in `check-style-drift.mjs` and `check-no-bare-working-write.mjs` (frozen allowlist; entries may only shrink). Cheaper than adopting a heavyweight boundary tool; mirrors the "fitness function" pattern from *Building Evolutionary Architectures*.
- **Thin adapters behind a stable contract** (AGENTS.md §17) — the `BuildAgentRunner` convergence is the textbook ports-and-adapters application: one shell, per-surface strategy objects for the genuinely-variant auth/exec.
- **Request-scoped memoization** for invariant-per-request data on a hot loop — standard practice; the codebase already does it selectively (`local-only.ts` TTL, `task-requirements.ts`), so this generalizes an existing pattern rather than importing a new one.

---

## 10. Open decisions for the operator

1. **Epic shape:** one EP-PLATFORM-OPTIMIZATION, or fold the three continuations back into their spine BIs and file only the 8 net-new ones under a smaller epic? (Recommendation: use one candidate epic only if the operator wants a single optimization wave; otherwise attach continuations to the spine and file the net-new BIs individually.)
2. **Module-size ceiling:** 800 LOC (forces ~39 current files onto the baseline) or 1000 (smaller baseline, looser)? (Recommendation: 800 new-file ceiling, 1000 hard cap, baseline the existing >1000 set.)
3. **MCP extraction granularity:** one multi-slice BI under BI-ARCH-TOOLPACKS, or split the 7 clusters into 7 trackable child BIs? (Recommendation: child BIs — independent PRs, easier to sequence cheap-first.)
4. **Fat-actions appetite:** do all four headline files (`tax-remittance`/`build`/`crm`/`ea`), or start with `tax-remittance` only (its validation seam already exists) and reassess?
5. **`dagre`→`elkjs`:** worth the visual-parity verification, or leave two working layout libs alone? (Recommendation: leave it alone unless visual parity can be proven cheaply.)

---

*End of analysis. Filed 2026-06-26 as `EP-PLATFORM-OPTIMIZATION` (+8 net-new BIs, +3 spine-BI continuations); no product code changed; items left in `triaging` for operator sequencing. Recommended first build: `BI-OPT-RATCHETS`.*
