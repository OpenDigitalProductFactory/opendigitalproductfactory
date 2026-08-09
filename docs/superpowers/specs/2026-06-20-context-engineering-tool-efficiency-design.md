# Context Engineering & Tool Efficiency — Design & Research

**Status:** VALIDATED — founder greenlit 2026-06-20. The **P0 trio (R1 result-cap, R2 description-lint, R3 deferred external-CLI tools)** and the **keep-fresh / apply-criteria mechanism** are implemented; R3 Phase 2 shipped in PR #4112 and its bootstrap/conformance contract was hardened on 2026-08-08. See the implementation plan `docs/superpowers/plans/2026-06-20-context-engineering-tool-efficiency-implementation.md` and the canonical standard `docs/architecture/context-engineering-standards.md`. Remaining recommendations (R4 code-exec spike, R6, R7, R8, R9) are staged follow-ups. The §10 decisions below are resolved as recommended.

> Note: "R3" in this spec covers two parts — the *enforcement* of the description/result criteria and *deferred tool loading on the external-CLI MCP path*. Both are shipped; the §7 entry is retained as historical design rationale.
**Date:** 2026-06-20
**Author:** Claude (operator `/goal`)
**Seed:** r/ClaudeCode — *"can someone explain the real difference between [Skills vs MCP vs Subagents vs Slash Commands]"* (Reddit blocks automated fetch; thread question confirmed via web search + official sources below).
**Related substrate (extend, do not duplicate):**
- `docs/superpowers/specs/2026-04-03-context-budget-arbitration-design.md` (EP-CTX-001 — the L0/L1/L2 arbitrator)
- `docs/superpowers/specs/2026-05-14-coworker-memory-shape-contracts-design.md`
- `docs/superpowers/specs/2026-05-19-ai-cost-governance.md`
- `docs/superpowers/specs/2026-06-10-local-llm-build-agent-design.md`
- `docs/superpowers/specs/2026-06-19-local-model-policy-single-generation.md`
- `docs/architecture/ai-coworker-development-principles.md`, `docs/architecture/local-llm-build-engine.md`

---

## 0. TL;DR — what this says and what I need validated

**The question, generalized.** The Reddit thread asks how four Claude Code primitives differ — **Skills** (procedural knowledge), **MCP tools** (access), **Subagents** (isolated context), **Slash Commands** (user-triggered). The real answer is a *context-economics* answer: each primitive loads into the model's attention at a different time, at a different token cost, with different persistence. "Using the right one for the job" is the same discipline Anthropic calls **context engineering**: *find the smallest set of high-signal tokens that maximize the likelihood of the desired outcome.* Mark's goal asks us to (a) understand how Claude and the other (weekly-changing) clients do this, and (b) hold DPF's own three context surfaces — the **MCP tool registry**, **Build Studio** (CLI agents + native local LLM), and **AI coworkers** — to the same standard.

**Headline finding: DPF is already sophisticated here, often mirroring or exceeding the public patterns** — and that is exactly why the remaining gaps matter. We have a static/dynamic prompt-cache boundary, a per-tier token-budget arbitrator, window-aware history compaction, an out-of-window plan reminder that *cannot be compacted away*, progressive-disclosure skill summaries, governed long-term memory, and a deterministic kernel veto at tool-call time. The gaps are concentrated and high-leverage:

| # | Gap | Why it matters **for our local-first / budget-GPU strategy** |
|---|-----|--------------------------------------------------------------|
| G1 | **No global tool-*result* size cap.** A single tool can dump unbounded JSON into context. | On a 24,576-token local build window, one fat result blows the budget. Claude Code caps results at 25K tokens; we cap nothing. |
| G2 | **CLOSED.** External-CLI MCP path (`/api/mcp/v1`) now has a client-default lean floor plus per-token `load_tools` exact/intent expansion, append-not-swap, and notification/re-list refresh. | The original context tax motivated R3; current host behavior must still be re-verified as clients change weekly. |
| G3 | **No code-execution / programmatic tool calling in the native loop.** Every tool result round-trips through the model. | Anthropic measures 37–98% token cuts from this. We already have a sandbox to host it. On a small local window this is the single biggest lever. |
| G4 | **242-tool registry / 16K-line switch carries convergence debt + description bloat** (BI-IDs, "Phase 4b/7", file paths leak into model-facing text). | Every leaked token is paid on every `tools/list`. 12 overlapping `search_*` tools and a 7-way `record_*_evidence` family also degrade tool-selection accuracy (which collapses past ~15 tools locally). |
| G5 | **No standing "client capability parity" mechanism.** Clients change weekly; we track them ad hoc. | We will silently fall behind on new token-savers (deferred tools, code-exec) and silently break on deprecations. |

**What I'm asking you to validate (full detail in §10):**
1. Greenlight the **P0 trio** (result-size cap, description lint, deferred tools on the CLI MCP path) — low risk, highest alignment with local-first.
2. Approve **code-execution/PTC in the native loop** as a flagged P1 spike (touches the sandbox boundary).
3. Confirm the **"stay current" mechanism** should *reuse* existing substrate (living-architecture-graph + a monthly scheduled scan) rather than add a new system.
4. Confirm the **durable home** for the validated version: a new `docs/architecture/context-engineering-standards.md` (advisory + eval-backed, mirroring `platform-usability-standards.md`), pointed to from `AGENTS.md`.

Nothing here proposes cloud spend. Per the standing founder directive, DPF stays **fully-local by choice**; every recommendation below makes the *local, small-GPU* path cheaper and more reliable.

---

## 1. The question, and why it matters now

### 1.1 What the article is really about
"Skills vs MCP vs Subagents vs Commands" is a recurring confusion because the four feel interchangeable ("they all give Claude more capability"). They are not — they differ on **when content enters context** and **what it costs**:

| Primitive | What it injects | When it loads | Token profile | Persistence |
|-----------|-----------------|---------------|---------------|-------------|
| **Skill** (`SKILL.md`) | *Procedural knowledge* — how to do a workflow in this context | Name+description always; **body only on invocation** (progressive disclosure) | Cheap until used, then resident | Until task ends |
| **MCP tool** | *Access* — a function the model can call | Schema present **up front** (unless deferred) | Definitions are a standing tax; results round-trip | Whole session |
| **Subagent** | *Isolated work* — a separate context window | On delegation | Main thread pays only the **summary** (~1–2K tokens) returned | Ephemeral; isolated |
| **Slash command** | *User-triggered* prompt/skill | When the user types it | Same as skill, but human-gated | Per invocation |

The lesson — **"use the right primitive for the job"** — is the operational form of context engineering. Skills teach *how*; MCP grants *access*; subagents *isolate* token-heavy exploration; commands *gate* on human intent. Picking wrong wastes context (e.g., a giant MCP server where a skill + two tools would do) or forgets instructions (e.g., procedural rules buried in history instead of a re-injected skill).

### 1.2 Why now (the two forcing functions in Mark's goal)
- **Clients change weekly.** Codex shipped encrypted-latent-state compaction; Anthropic shipped the Tool Search Tool and code-execution-with-MCP; Grok Build launched (May 2026) reading `CLAUDE.md` + Claude skills with a 2M window and 8-way parallel subagents; the prompt-cache TTL silently regressed from 1h → 5m. **A point-in-time analysis is stale in a month.** The design must include a *staying-current* mechanism, not just a snapshot.
- **Local-first / budget-GPU strategy.** DPF runs fully-local by choice (cloud Claude/Codex disabled), optimizing for small GPUs. Every token-efficiency principle that is "nice to have" on a 200K cloud window is **existential** on a 24,576-token local window served by one llama-server on a 24GB 4090. The cheapest token is the one we never process.

---

## 2. The mental model (the durable frame we'll reference)

Three laws govern all of this; everything in §5 derives from them.

1. **Context is a finite resource with diminishing returns.** As tokens grow, recall degrades (transformer n² attention; "context rot" measured across all frontier models). More context ≠ better. *Spend it like a budget; default to removing, not adding.*
2. **Smallest set of high-signal tokens.** The canonical thesis. Optimize signal-to-token ratio, not completeness — in the system prompt, the tool definitions, the examples, and the history alike.
3. **Tool-selection accuracy collapses past a threshold.** ~perfect at ~10 tools, degrading by ~20, collapsing past ~100. DPF's own `LOCAL_FALLBACK_MAX_TOOLS = 15` is this law encoded. Few, consolidated, unambiguous tools beat many.

The four context-engineering moves that follow: **cache** the stable prefix, **defer/retrieve** the situational rest just-in-time, **isolate** heavy work in sub-contexts, and **enforce** non-negotiables deterministically (not via prompt hope).

---

## 3. How Claude Code works (condensed)

Mechanism → how it saves tokens / retains instructions → DPF relevance. (Sources in appendix.)

| Mechanism | Token / retention effect | Knobs / notes (flag = beta/recent) |
|-----------|--------------------------|------------------------------------|
| **Prompt caching** | Stable prefix (tools+system) reused at **0.1×** read; writes 1.25× (5m) / 2× (1h). | ⚠️ Default TTL reverted to **5 min** (~2026-03); set `ttl:"1h"` for long sessions. Min cacheable ~1,024 tok (Opus/Sonnet). |
| **Static/dynamic prompt boundary** | Keeps cacheable instructions stable while history grows. | DPF mirrors this exactly (`SYSTEM_PROMPT_DYNAMIC_BOUNDARY`). |
| **Context editing / tool-result clearing** | Clears old tool results at a token threshold; e.g. 70K→25K. | 🧪 BETA (`context-management-2025-06-27`). `clear_tool_uses_20250919`, keep N recent. |
| **Compaction (`/compact`)** | Summarize-and-reinitialize near the limit; keeps decisions, drops tool-output debris. | Claude Code retains ~5 most-recent files + summary. |
| **Memory tool + `CLAUDE.md` hierarchy** | External, file-based; re-injected post-compaction so instructions survive. | DPF analog: governed-memory + `AGENTS.md`/`CLAUDE.md` pointer. |
| **Tool Search Tool / deferred loading** | Load tool schemas **on demand**: ~72K → ~500 tokens for 50+ tools (**85%↓**), accuracy *up*. Preserves cache. | The direct fix for our G2. |
| **Programmatic tool calling / code execution** | Model writes code to call tools + filter results in-sandbox before they hit context: **37%** (research) to **98.7%** (MCP-as-code) token cuts. | The direct fix for our G3. |
| **Subagents (Task)** | Isolated context; main thread gets only a 1–2K summary. | DPF analog: Build Studio specialists, A2A, my own Agent fan-out. |
| **Skills (progressive disclosure)** | Description always; body on demand. | DPF injects skill id/label/description summaries (not bodies) — same pattern. |
| **Hooks (PreToolUse…)** | **Deterministic** guardrails; not subject to model interpretation. | DPF analog: kernel runtime gate + plugin PreToolUse hooks. |
| **Tool result cap** | Default **25,000-token** ceiling per tool response. | DPF has **no** global cap — our G1. |

---

## 4. How the other (weekly-changing) clients work

| Agent | Context strategy | Instruction file | Tool exposure | Distinctive token lever | vs Claude Code |
|-------|------------------|------------------|---------------|-------------------------|----------------|
| **Codex CLI** (GPT-5.x-Codex) | **Compaction via encrypted latent-state** (`encrypted_content`), not text summary | **`AGENTS.md`** (originated it); closest-wins, 32KiB cap | Built-ins + MCP, all presented | Compaction as long-horizon budget-extender; `reasoning_effort` | Latent-state handoff vs text summary; no deferred tools |
| **Gemini CLI** | **1M window** + `/compress` (lossy on repeat) | **`GEMINI.md`** hierarchical; `/memory add` pins | Built-ins + MCP all exposed; **subagent tool allowlist** | Big window *defers* compaction; subagent isolation | Far larger base window; user-invoked compress |
| **Cursor** | **Embeddings index + RAG** (the outlier) + hybrid grep | `.cursor/rules` (4 modes) + `AGENTS.md`; **auto "Memories"** from chat | Built-ins + MCP + Explore subagent | Retrieves only relevant chunks; Auto vs Max (metered) | Indexes the codebase; richer rule-salience model |
| **Grok Build** (xAI, May 2026) | **2M CLI window**; up to **8 parallel subagents** on branches | **Reads `CLAUDE.md`** + Claude skills/plugins (compat) | Discovers + registers MCP | Horizontal scale-out + fast `grok-code-fast-1` | Claude-Code-compatible clone w/ bigger window |
| **Amp** (Sourcegraph) | No index; subagents + `oracle` high-reasoning tool | `AGENTS.md` up to `$HOME` + `/etc` | Built-ins + MCP; subagents first-class | Mode routing `rush`/`smart`/`deep` | Multi-model routing + dedicated oracle |
| **Aider** | **PageRank repo map** (tree-sitter, token-budgeted); no embeddings | `CONVENTIONS.md` via `--read` | Edit loop; MCP recently added | Sends only ~1K map + added files | Pair-programmer, not autonomous |
| **Cline / Roo** | Cline: no-index ("discovery not retrieval") + Auto Compact + **Focus Chain** (todo re-injected ~every 6 msgs); Roo: default-on **condensing** | Cline `.clinerules` + **Memory Bank** (read in full each task); Roo `.roo/rules` + `AGENTS.md` | MCP; Plan/Act; Roo **Orchestrator** delegates | Cline `/smol`, `/newtask`; no-index avoids stale cost | IDE Plan/Act gate; prescriptive memory ritual |

**Convergent (the field is standardizing — adopt these):** `AGENTS.md` as the cross-tool instruction standard; MCP as table stakes; summarize-and-continue compaction; **subagents with isolated context** as the token strategy; hierarchical closest-wins instruction loading.

**Divergent (the real forks — pick deliberately):** embeddings/index (Cursor, Aider's structural map) **vs** agentic search (everyone else, incl. us and Claude Code); **all-tools vs deferred/search** tool exposure (Claude Code's deferred pattern is comparatively rare — an edge we can exploit); plain-text vs latent-state compaction; single-file vs structured-ritual vs auto-capture memory; **window size as strategy** (Gemini 1M, Grok 2M) vs aggressive compaction in ~200K.

**Why this matters for DPF specifically:** Grok Build and OpenCode **read `CLAUDE.md`/Claude skills natively**, and `AGENTS.md` is now universal — so DPF's instruction substrate (AGENTS.md + the plugin's skills/hooks) is *already* cross-client portable (memory: plugin-native hook distribution). The weekly-churn risk is concentrated on **tool exposure + compaction features**, which is where the parity tracker (§8) focuses.

---

## 5. Durable principles (the canonical list — this is the "reference ourselves" core)

These are the standards we tune against. Each: statement — rationale — how to apply in DPF.

**P1. Spend context like a budget.** Finite, diminishing returns. → Default to removing tokens; treat the 24,576 local window as the binding constraint, not the 200K cloud one.

**P2. Smallest high-signal set.** → Every block (identity, corpus, tools, history) gets a "minimum viable" version; the arbitrator already does this for L0/L1/L2 — extend the discipline to tool *definitions* and *results*.

**P3. Right altitude for instructions.** Not brittle-prescriptive, not vague. Heuristics + decision criteria over hardcoded branches; labeled sections. → Audit the 24-rule identity block and phase prompts for altitude; prefer the kernel registry (data) over prose rules where enforcement matters.

**P4. Just-in-time over front-loading.** Pass handles (paths, IDs, queries), retrieve bodies on demand; structure/metadata is itself signal; hybrid is the default (front-load the small stable core). → DPF already does this (corpus slug-prefix retrieval, skill summaries, L3/L4 deferred-to-tools). Gap: tool *schemas* are still front-loaded on the CLI path (G2).

**P5. Few, consolidated, unambiguous tools.** "If a human can't say which tool to use, neither can the agent." Namespace; onboarding-doc descriptions; actionable errors. → The `search_*`/`record_*_evidence` families are prefix-clustered but functionally distinct (verified) — a human *can* say which (by backend/entity), so they are well-differentiated, not ambiguous; scope EXPOSURE (R3/grants/phase, shipped) rather than blind-merging distinct tools, and eval-gate any faceting via R8. Strip provenance from descriptions (R2, done); keep exposed sets under the 15-tool local cliff.

**P6. Token-efficient tool *results*.** High-signal fields, `response_format` verbosity opt-in, pagination/filtering/**truncation with a hard cap**. → Add the global envelope cap (G1); make concise the default.

**P7. Code execution beats round-tripping.** Have the model write code to call tools and filter results in the execution environment. → Spike PTC in the native loop over the existing sandbox (G3).

**P8. Cache the stable prefix; order prompts cache-first.** Largest stable content first behind breakpoints; volatile content last. → We have the boundary; verify the **local** server (llama.cpp/DMR) actually exploits prefix-KV caching, and order accordingly.

**P9. Isolate heavy work in sub-contexts — but multi-agent costs ~15× tokens.** Only when task value justifies it; poor fit for tightly-coupled/shared-context work (most coding). → Build Studio's specialist isolation is right; don't over-fan-out on coupled build steps.

**P10. Enforce non-negotiables deterministically.** Hooks/runtime gates, not prompt instructions, for security/audit. → DPF's kernel runtime gate is *ahead* of the field here; keep it the enforcement plane, keep prose for guidance.

**P11. Persist + re-inject across compaction.** Plans, memory, and key instructions must survive the sliding window. → `withPlanReminder` already does this for the plan; extend the pattern to governed-memory salience.

**P12. Measure empirically.** Track tokens-per-task, task success, tool-selection accuracy; watch the tool-count cliff; let agents improve their own tools. → Extend the eval-loop + `evaluate_tool`/`report_quality_issue` substrate.

**P13. Do the simplest thing that works.** Add complexity only when an eval proves the need. → Bias every recommendation below toward reusing substrate; spike before building.

---

## 6. DPF current-state evaluation (against §5)

Scored ✅ strong / 🟡 partial / ⚠️ gap. File anchors are `apps/web/lib/...`.

### Scorecard

| Principle | MCP registry | Build Studio | AI coworkers |
|-----------|:---:|:---:|:---:|
| P2 smallest set | 🟡 | ✅ | ✅ |
| P3 altitude | 🟡 | 🟡 | 🟡 |
| P4 just-in-time | 🟡 | ✅ | ✅ |
| P5 few/unambiguous tools | ⚠️ | ✅ (phase subset) | ✅ (grant subset) |
| P6 token-efficient results | ⚠️ | ⚠️ | ⚠️ |
| P7 code execution | ⚠️ | ⚠️ | ⚠️ |
| P8 cache-first | ✅ | ✅ | ✅ |
| P9 isolation | n/a | ✅ | 🟡 |
| P10 deterministic enforce | ✅ | ✅ | ✅ |
| P11 survive compaction | n/a | ✅ | 🟡 |
| P12 measure | 🟡 | 🟡 | 🟡 |

### 6a. The MCP tool registry (shared substrate)
`mcp-tools.ts` — **16,427 lines, 242 tools, ~50K tokens if all exposed**, dispatched by a 252-arm `switch` (~`:5348`) behind the kernel gate (`:5279`).

- ✅ **Multi-layer scoping works.** `getAvailableTools()` (`:4914`) intersects user capability × agent grants (`agent-grants.ts:97`, default-deny) × token scope × runtime mode/phase. The full surface is never sent on the native path; baseline read grants (`agent-grants.ts:79`) keep coworkers functional.
- ✅ **Deterministic kernel veto** before dispatch (refuse/confirm/allow) — the outbound-send guard. Ahead of the field (this is "hooks," done in-process).
- ⚠️ **No result-size cap (G1).** `ToolResult.data` is `JSON.stringify`'d into context with no ceiling; mitigation is per-handler convention only. A single unbounded read floods a local window.
- ⚠️→✅ **Description bloat (G4/P5) — fixed by R2.** ~88KB of descriptions; ~a dozen leaked `BI-xxxxxxxx`, `Phase 4b/7`, and file paths (now CI-guarded out). NOTE (verified 2026-06-20): the `search_*` (×12) / `record_*_evidence` (×7) families are prefix-clustered but **functionally distinct** (different backends / target entities) — the surface lever is **exposure scoping** (R3 core tier + grant/phase subsetting, shipped), NOT consolidation; faceting is R8-eval-gated, see R7. Near-name collisions (`propose_decomposition`/`propose_build_decomposition`) are mitigated by R2 disambiguation.
- 🟡 **Altitude (P3):** good disambiguation in many descriptions ("use X not Y"), undermined by provenance noise.

### 6b. Build Studio (CLI delegation + native local LLM)
Lives in `apps/web/lib/integrate` + `lib/tak` + `lib/inference`.

- ✅ **Cache-first prompt** via `PHASE_PROMPTS` + `PROJECT_CONTEXT` + `withCoworkerInteractionContract()`; static/dynamic boundary.
- ✅ **Window-aware compaction.** `compactAgenticMessages` (`agentic-loop.ts:892`) + `deriveCompactionCaps` (`context-pressure.ts:131`) scale history caps to the *real* model window (learned post-dispatch), floor otherwise.
- ✅ **Instruction retention is excellent (P11).** `withPlanReminder` (`agentic-loop.ts:1121`) re-renders the execution plan into an *ephemeral trailing message every iteration* — **it can never be compacted away** (crash-durable). `enrichToolDescriptions` (`:832`) stickies prior failures/rejections onto tool descriptions. Operator-Contract guards (`detectFabrication`, `phaseRequiresToolCall`, narration/permission nudges) don't trust self-report. This is best-in-class.
- ✅ **Per-phase tool subsetting** (`buildPhases`) keeps the function-calling schema small — and under the 15-tool local cliff.
- ✅ **Install-time served-window right-sizing.** `bootstrap-first-run.ts:206` sets DMR served context to 24,576 so local builds don't silently truncate; OpenCode preflight floor 22,000.
- ⚠️ **No code execution (G3/P7).** Native loop round-trips every tool result. On 24,576 tokens this is the dominant cost.
- ⚠️ **Per-phase subsetting is native-loop only (G2).** External CLIs (claude/codex/grok) hit `/api/mcp/v1` `tools/list` and get the JWT-scoped set, not the phase-scoped set — token tax + selection risk that the native loop already avoids.
- 🟡 **Routing reality (P1/cost):** `pipeline-v2.ts` Stage-5b sorts cloud (`user_configured`) ahead of local (`bundled`); `resolveModelSelectionByPhase` (`phase-model-resolution.ts:448`) exists to flag `local-intent-cloud-reasoning`. Aligned with local-first only if local is actually pinned — worth a verification pass.

### 6c. AI coworkers (runtime)
`prompt-assembler.ts` (8 blocks, boundary `:111`/`:121`) + `agent-coworker.ts` + `context-arbitrator.ts`.

- ✅ **Token-budget arbitration (P2).** Per-tier totals (frontier 6000 / strong 3000 / adequate 1500 / basic 800; `context-arbitrator.ts:47`); L0 always; L1→L2 by priority with compressible fallbacks; **L3/L4 never pre-injected** (tool-retrieved). Exactly the JIT principle. This is the EP-CTX-001 spec realized.
- ✅ **Progressive-disclosure skills (P4).** Block 5 injects skill *id/label/description summaries*, not bodies.
- ✅ **Corpus JIT retrieval.** `resolveProfessionCorpusContext` — slug-prefix lexical, top-3 pages, 320-char excerpts, full-vs-compact chosen under budget; fail-open.
- ✅ **Governed long-term memory.** `buildGovernedMemoryContext` (facts + semantic recall), arbitrated like everything else.
- ✅ **Grant-scoped tools** keep coworkers from seeing all 242; advise-mode strips side-effect tools.
- ⚠️ **Same G1/G6/G7** result-size + code-execution gaps as the registry/loop.
- ✅ **Memory salience across compaction (P11) — verified 2026-06-20.** Memory facts (`factsContext`/`recalledContext`) are arbitrated into the **system prompt** (`agent-coworker.ts:774/861` → `assembleSystemPrompt`), which `compactAgenticMessages` never touches (`agentic-loop.ts:1363` compacts `messages` only; `:1387` passes `systemPrompt` unchanged) and which is rebuilt with fresh arbitration each turn. So facts already survive compaction within a turn and re-enter across turns. `withPlanReminder` exists only because the *plan* lives in the compacted message history; facts do not — so **R9-as-reinjection is a non-problem.** Two REAL residuals remain (both larger): (a) compaction **truncates rather than summarizes**, so a decision/fact stated in a dropped middle message is lost — a summarization-compaction feature, not a reminder; (b) cross-turn recall is **query-driven**, so an old fact may go unsurfaced when the current query is unrelated — a retrieval / durable-write project.
- 🟡 **Isolation (P9):** coworker A2A exists but most coworker turns are single-context; fine (coupled work), just noting we don't over-fan-out.

**Net:** DPF's *instruction-retention* and *budget-arbitration* are at or above the public state of the art. The systematic gaps are all on the **tool I/O economics** axis (G1 results, G2 deferred exposure, G3 code-exec, G4 registry hygiene) — precisely the axis that hurts most on small local windows.

---

## 7. Design recommendations (prioritized, local-first)

Each: problem → proposal → files → effort → expected effect → proposed handle. **Nothing filed yet** — these are for your greenlight.

### P0 — low risk, highest local-first ROI (recommend all three now)

**R1 — Global tool-result envelope cap (fixes G1/P6).**
Add a cross-cutting cap in the result path: truncate `ToolResult.data`/serialized content to a budget (propose **8–12K tokens** default, tier-aware; Claude Code uses 25K on 200K windows — ours must be tighter for 24,576), with an explicit `[truncated N of M; refine with filter/pagination]` notice and a `response_format: concise|detailed` opt-in. Enforce in both `executeTool`/`mcp-governed-execute.ts` and the `/api/mcp/v1` route serializer.
Effort: S–M. Effect: removes the single worst local-window blowup mode. Handle: *proposed BI — tool-result-envelope-cap*.

**R2 — Tool-description lint (fixes G4/P5, token tax on every list).**
A build-time linter + one-pass cleanup: strip `BI-xxxxxxxx`, `Phase N/7`, and source file paths from model-facing `description`s; enforce a length budget and a house style (verb_noun, "use X not Y" disambiguation kept). Keep provenance in code comments/annotations, out of the model payload.
Effort: S. Effect: trims ~the leaked fraction of 88KB off every `tools/list`; improves selection. Handle: *proposed BI — tool-description-lint*.

**R3 — Deferred tool loading on the external-CLI MCP path (fixes G2/P4).**
Adopt Anthropic's Tool Search pattern on `/api/mcp/v1`: mark the long tail `defer_loading`, return a small always-on core + the existing `search_tool_marketplace`/`evaluate_tool` as the discovery entrypoint, expand schemas on reference. Preserves prompt cache. This is also the **first dividend of staying current** — it's a brand-new client feature we can exploit.
Effort: M. Effect: cuts the external-CLI startup tax from ~50K toward single-digit K. Handle: *proposed BI — mcp-route-deferred-tools*.

### P1 — bigger leverage, more surface

**R4 — Programmatic tool calling / code execution in the native loop (fixes G3/P7).** Spike behind a flag: let the build model (then coworkers) emit code that calls tools and filters results inside the **existing sandbox** before results re-enter context. Reuses sandbox isolation; respect the kernel gate inside the code path. Anthropic: 37–98% token cuts. *Touches the security boundary → flagged spike, your explicit go (see §10).* Handle: *proposed BI/spec — native-loop-code-execution-spike*.

**R5 — Per-phase tool-subset parity across delivery paths (fixes G2 tail/P5).** Make `/api/mcp/v1` honor the active build phase (or capsule scope) so external CLIs see the same minimized set the native loop does. Composes with R3. Handle: *proposed BI — cli-path-phase-tool-parity*.

**R6 — Verify + exploit local prefix-KV caching (P8).** Confirm DMR/llama.cpp reuses the prefix KV cache across turns for the static prompt prefix; if not fully, reorder so the served model benefits, and document the local-cache contract alongside the cloud one. Handle: *proposed BI — local-prefix-cache-verification*.

**R7 — Registry convergence (P5) — RE-SCOPED after verification (2026-06-20).** On inspection the `search_*` and `record_*_evidence` families are **functionally distinct, not redundant**: each `search_*` hits a different backend (code graph / project files / sandbox / versioned source / org knowledge / design DB / integrations / marketplace / portfolio / specs / web) with different params; each `record_*` targets a different entity (backlog item / Work Capsule / runtime / FeatureBuild / external handoff). So this is **faceting distinct tools, not deduplication** — a real trade-off, not a free win: it would cut the tool *count* (helping the local 15-tool cliff) but force a messy union-of-params polymorphic tool and a model-behaviour change that could *degrade* selection. Crucially the cliff is **already scoped** for real contexts by the native loop's grant/phase subsetting and R3's core tier, so the marginal benefit is smaller than the name-prefix clustering suggested. **Decision: do NOT blind-merge; eval-gate any faceting via the R8 gauge** (measure `toolSurface` drop vs `toolAccuracy` drop on a real task set) before changing the external tool contract. The genuine residual is naming near-collisions (`propose_decomposition`/`propose_build_decomposition`, `search_knowledge`/`search_knowledge_base`), already mitigated by R2 description disambiguation; renaming is breaking and low-value. The 16K-switch → `*-mcp-handlers.ts` decomposition (a maintainability refactor with **no** model-facing change) remains worthwhile and unblocked. Handle: *EP-ARCH-CONVERGENCE — switch-file decomposition + an R8-gated faceting experiment*.

### P2 — measurement & memory

**R8 — Context/tool eval harness (P12).** Extend `2026-03-19-eval-loop-design.md` + `evaluate_tool`: track tokens-per-task, task success, and **tool-selection accuracy vs the 15-tool local cliff**; gate description/registry changes on it; let an agent propose tool refinements from transcripts. Handle: *proposed BI — context-tool-eval-harness*.

**R9 — Memory salience across compaction (P11) — CLOSED as a non-problem (verified 2026-06-20).** Memory facts live in the system prompt, which compaction never touches and which is rebuilt per turn, so they already survive — generalizing `withPlanReminder` to them would re-inject something that doesn't get compacted. The two REAL residuals are separate, larger items: **R9a** summarization-compaction (compaction currently truncates dropped history rather than summarizing it, so a fact in a dropped middle message is lost; needs a summary pass — an extra inference call, costly on the single-GPU local path) and **R9b** durable cross-turn fact recall (query-driven recall can miss an old, currently-irrelevant-seeming fact). Both warrant their own design; neither is a `withPlanReminder` generalization.

---

## 8. Staying current (the weekly-churn requirement)

A point-in-time doc decays. Reuse substrate — **do not build a new system**:

1. **Agent-Client Capability Parity Tracker (a living record).** One row per external client (Claude Code, Codex, Gemini CLI, Grok Build, OpenCode) × per capability (compaction style, instruction file, deferred tools, code-exec, skills compat, prompt-cache TTL, context window). Each cell: *status, DPF dependency, DPF adoption, last-verified date.* Home it as a node set in the **living-architecture-graph** (EP-ARCH-GRAPH-LIVE) so it's queryable and shows staleness, mirroring the Parity Engine pattern — not a hand-maintained table that rots.
2. **Monthly scheduled scan** (reuse the `scheduledAgentTask` / native cron the cognitive-load-migration scan already uses — *not* a new cron): re-read each client's official docs (the `claude-api` skill already mandates "read the docs, don't answer from memory"), diff against the tracker, and **auto-file BIs** for new token-savers to adopt and deprecations to de-risk. Ownership: Enterprise Architect persona + `dpf-architecture-review` skill.
3. **Conformance tie-in.** Fold the principles (§5) into `docs/architecture/agent-standards-dpf-conformance.md` so reviews check them; the parity tracker feeds the "what changed" delta into each architecture review.

This converts "stay on top of weekly changes" from a hope into a dated, owned, auto-filing loop.

---

## 9. Documentation plan (what we convey + reference)

After you validate this draft:
1. **Durable standard:** extract `docs/architecture/context-engineering-standards.md` — the §5 principles + §6 scorecard + the local-window contract (24,576 budget, 15-tool cliff, result cap). Advisory + eval-backed (not a hard gate initially), mirroring `platform-usability-standards.md`. Point `AGENTS.md` at it (AGENTS.md is the canonical rulebook the other clients also read).
2. **Build/runtime tuning reference:** keep this spec as the rationale-of-record; the standards page is the short "how we spend context" rules; the parity tracker is the live "what the clients do this month."
3. **Convey to others:** a one-page operator/reseller explainer ("why your local model stays fast and on-task") and an architect-facing section in the standards review cadence.

---

## 10. Open decisions for founder validation

My recommendation first in each; these are the only genuine forks (everything else follows from the local-first kernel directive already on record).

1. **Greenlight the P0 trio (R1 result-cap, R2 description-lint, R3 deferred-CLI-tools) now?** — *Recommend yes.* Low risk, highest local-first ROI, R3 banks a brand-new client feature.
2. **Code execution / PTC in the native loop (R4) — approve as a flagged P1 spike?** — *Recommend yes, spike-behind-flag.* Biggest token win but touches the sandbox security boundary, so it needs your explicit go and a kernel-gate-inside-code review, not a silent build.
3. **Stay-current mechanism: reuse living-architecture-graph + monthly scheduled scan (§8), not a new system?** — *Recommend reuse.* Consistent with substrate-first and the no-new-cron rule.
4. **Durable home = new `docs/architecture/context-engineering-standards.md`, advisory + eval-backed, pointed-to from AGENTS.md?** — *Recommend yes, advisory not gating* until R8's eval harness exists.
5. **Registry convergence (R7) — fold under EP-ARCH-CONVERGENCE for later, or pull forward?** — *Recommend fold under the epic;* it's real debt but larger and lower-urgency than the P0 trio.

On your go, I'll file the BIs (substrate-verified, sized, epic-linked) and write the §9 standards extract. I have **not** filed anything yet, per "design and research first."

---

## Appendix — Sources

**Anthropic (primary):** Effective context engineering for AI agents; Writing effective tools for AI agents; Code execution with MCP; Introducing advanced tool use (Tool Search Tool, Programmatic Tool Calling); Building effective agents; How we built our multi-agent research system; Prompt caching & Pricing docs; Context editing; Subagents; Skills; Hooks; Extended thinking.
**Field / other clients:** OpenAI Codex (GPT-5.1/5.2-Codex compaction, AGENTS.md, local config); Gemini CLI (chat compression, GEMINI.md, subagents); Cursor (indexing, rules, memories, Max mode); Amp manual + context-engineering guide; Aider repo map; OpenCode rules/MCP; Cline (why-no-index, Memory Bank) + Roo (intelligent context condensing); Grok Build launch coverage. Chroma Research — *Context Rot*.
**DPF internal:** the related-substrate specs listed in the header; subsystem maps captured in this session (Build Studio, AI coworkers, MCP registry).

*(Full URLs retained in the session research record; to be inlined when this becomes the published standards page.)*
