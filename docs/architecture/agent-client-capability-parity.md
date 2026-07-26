# Agent-Client Capability Parity Tracker

**Status:** Living record — the external coding clients change weekly; this is the dated, owned source of truth for what each does and what DPF depends on / should adopt.
**Owner:** Enterprise Architect persona / `dpf-platform:dpf-architecture-review`.
**Refresh cadence:** Monthly (see "Refresh ritual"). **Last full refresh:** 2026-06-20. **Last verified:** 2026-06-26 (delivery-surface sweep — see "2026-06-26 refresh" below).
**Standard it serves:** `docs/architecture/context-engineering-standards.md`.

## Why this exists

DPF runs across, and is driven by, external coding agents (Claude Code, Codex, Grok Build, OpenCode) plus our own native local LLM. Their context/memory/tool mechanisms change **weekly** — new token-savers ship (deferred tools, code-execution), conventions converge (`AGENTS.md`), and behaviours regress (the prompt-cache TTL silently reverted 1h → 5m). A point-in-time analysis decays fast. This tracker keeps the design criteria *applicable to subsequent changes* by recording, per client, the capabilities we depend on or could adopt, with a **last-verified date** and a **DPF adoption status**, so the monthly scan diffs against something concrete and files follow-up work.

Adoption status legend: ✅ adopted · ◐ partial/planned · ⬜ not adopted · ➖ n/a · ⚠️ regression to track.

## Capability matrix (verified 2026-06-20)

| Capability | Claude Code | Codex CLI | Gemini CLI | Grok Build | OpenCode | DPF dependency / adoption |
|---|---|---|---|---|---|---|
| **Instruction file** | CLAUDE.md + memory | AGENTS.md (originated) | GEMINI.md | reads CLAUDE.md | AGENTS.md (+reads CLAUDE.md) | `AGENTS.md` canonical; plugin ships skills+hooks cross-surface. ✅ |
| **Compaction style** | summarize + tool-result clearing | encrypted latent-state | `/compress` (lossy) | window scale-out | auto/`/smol` | window-aware `compactAgenticMessages`. ✅ |
| **Out-of-window instruction retention** | system reminders | — | `/memory add` pin | — | Focus-Chain-like | `withPlanReminder` re-injects plan every iteration. ✅ (ahead) |
| **Prompt caching / cache boundary** | static/dynamic boundary; ⚠️ TTL 1h→5m (2026-03) | prefix cache | prefix cache | n/a (beta) | provider-dependent | `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` mirrored; local prefix-KV ◐ (R6 verify). ⚠️ track TTL. |
| **Deferred / search-based tool loading** | Tool Search Tool (`defer_loading`, ~85% list cut) | all tools presented | all enabled | discovers MCP | per-tool wildcard perms | native loop subsets via grants+phase; external CLI path has opt-in **core tier** ◐ (`?tier=core`, R3 Phase 1); model-driven deferral staged (Phase 2). |
| **Code execution / programmatic tool calling** | code-exec w/ MCP (37–98% cut) | sandboxed shell | — | — | — | `run_tool_script` shipped dark ◐ (R4; governed read-only, flag+grant gated, live-verify pending). |
| **Tool-result cap** | ~25K-token default | — | — | — | — | `tool-result-budget.ts` (native + MCP route). ✅ |
| **Subagents / context isolation** | Task subagents | subagents | subagents (tool allowlist) | up to 8 parallel | primary+sub | Build Studio specialists; A2A. ✅ |
| **Skills (progressive disclosure)** | SKILL.md (desc always, body on demand) | skills | — | Claude-skill compatible | — | Block-5 skill *summaries* not bodies. ✅ |
| **Deterministic guards (hooks)** | PreToolUse… | adopted hook protocol | — | reads Claude hooks | — | kernel runtime gate + plugin prechecks. ✅ (ahead) |
| **MCP support** | yes | yes | yes | yes | yes (wildcard perms) | `/api/mcp/v1` JSON-RPC; 242-tool registry. ✅ |
| **Context window (base)** | ~200K | ~200K+ | 1M | 2M (CLI) | provider-dependent | local served ~24,576 (binding). ➖ |

*Sources for the row data are catalogued in the design spec appendix (`2026-06-20-context-engineering-tool-efficiency-design.md`).*

## 2026-06-26 refresh (delivery-surface sweep)

Verified 2026-06-26 against the delivery-surface optimization study (`docs/superpowers/specs/2026-06-26-delivery-surface-optimization-study-design.md`). Deltas since the 2026-06-20 full refresh:

- **Prompt-cache emission (Anthropic):** ⬜→◐ **shipped** — DPF now emits `cache_control:{type:"ephemeral"}` on the stable system prefix for the Anthropic `/messages` path (BI-79A5C00F, PR #2447 merged; `apps/web/lib/routing/anthropic-cache.ts`). 5-minute TTL; **1-hour TTL still a follow-up** (needs the extended-cache beta header). OpenAI/xAI caching remains automatic; cloud hit-rate observability still ⬜.
- **Prompt-cache TTL:** ⚠️ Anthropic default remains **5 minutes** (reverted from 1h ~2026-03) — re-confirm each refresh; it changes the break-even for long sessions.
- **Deterministic guards (hooks):** Codex hooks are now **officially documented** (plugin-bundled + managed-trust); DPF has structural hook wiring for Claude/Codex/Grok (`packages/dpf-skill-pack/hooks/plugin-hooks-wired.test.mjs`). **Functional proof on Codex/Grok still pending** (BI-14E9F7CE), including the Grok `GROK_PLUGIN_ROOT` vs `CLAUDE_PLUGIN_ROOT` portability seam.
- **Lean tool surface:** external CLI **`?tier=core`** discovery is documented in AGENTS.md §8 (opt-in, ~22 tools).
- **Code-graph for external sessions:** ⬜→◐ a **code-graph-first standing rule** added to AGENTS.md §8 for direct Claude/Codex/Grok sessions (BI-0FD9E685).
- **Unified WIP across surfaces:** capsule-plane foundation shipped (BI-937128F6; `apps/web/lib/build/unified-wip.ts`) + §17 doctrine — the unit of WIP is the WorkCapsule, not the Build Studio build. The **enforced** admission cap is now wired to that plane: the two build-entry gates (`createFeatureBuild`, `promote_to_build_studio`) derive their decision from the unified, **pool-aware** pressure (`apps/web/lib/build/unified-wip-query.ts` → `decideUnifiedWip`), so a promote is blocked only when the finite pool it contends on (`gatingPool`) is saturated across ALL surfaces — not a BS-only build count. Per-pool capacities are named constants in `wip-cap.ts` (`WIP_POOL_CAPACITY`); the live `bs-sandbox` limit stays `BUILD_WIP_CAP=3` (unchanged). bs-sandbox pressure is still read from the authoritative `FeatureBuild` count — build-studio capsule status is not synced on build terminality, so counting those capsules would mis-gate.
- **Cross-surface review:** golden-triangle activation policy for independent deliberation on external artifacts (BI-A245FE00; `apps/web/lib/deliberation/external-review-activation.ts`).
- **MCP token var:** active standard is **`DPF_MCP_BEARER_TOKEN`** (stale `DPF_MCP_TOKEN` survives only in the gitignored local `.mcp.json`).
- **Grok Build (xAI):** GA CLI launched 2026-05-25; reads `.claude/` directly (CLAUDE.md, marketplaces, skills, MCP) but exposes `GROK_PLUGIN_ROOT` (the hook seam above).

## 2026-07-24 refresh (BI-14E9F7CE closeout — Grok hook portability)

Reconciles the "Functional proof on Codex/Grok still pending" line above (2026-06-26 refresh) with work that landed in between and was not cross-referenced back to this tracker:

- **The `GROK_PLUGIN_ROOT` vs `CLAUDE_PLUGIN_ROOT` seam named above turned out to be moot for actual enforcement.** BI-883FC2FC live-probed real Grok 0.2.87 / Codex 0.142.x sessions and found the deeper root cause: **Grok's hook-execution plane ignores the plugin-bundled `hooks/hooks.json` entirely** (a plugin shows `has_hooks=true` in `grok inspect` yet contributes `total_hooks=0` — confirmed live, not inferred). So whether `${CLAUDE_PLUGIN_ROOT}` resolves inside that file never mattered for Grok's guard enforcement; the token is inert there either way. The actual delivery path Grok honors is a **global** `~/.grok/hooks/dpf-guards.json`, written by `packages/dpf-skill-pack/scripts/update_agent_toolchain.py::install_grok_hooks` with **fully pre-resolved absolute paths baked in by the Python installer at install time** — no runtime env-var substitution involved at all. Codex is analogous: `~/.codex/hooks.json` via `install_codex_hooks`, gated by Codex's own interactive hook-trust step (tracked separately, BI-66EBEA06 — out of this BI's scope).
- **Static trace could not confirm the shared `hooks/hooks.json`'s `${CLAUDE_PLUGIN_ROOT}` substitution mechanics are safe to alter.** Official Claude Code docs (fetched 2026-07-24) confirm `${CLAUDE_PLUGIN_ROOT}` is substituted as literal host-side text before a shell ever sees it (shell-agnostic today); wrapping it in POSIX fallback syntax (`${CLAUDE_PLUGIN_ROOT:-$GROK_PLUGIN_ROOT}`) would force that resolution to depend on the downstream shell instead — an unverifiable regression risk on Windows Claude Code installs (DPF's own `run-hook.mjs` comment asserts Windows hooks run under PowerShell, not Git Bash, which cannot be confirmed live without a session restart). **No change was made to `hooks/hooks.json`** for this reason, matching the same judgment call PR #2455 made for this BI's first slice.
- **What DID land (BI-14E9F7CE, this refresh):** a drift guard (`packages/dpf-skill-pack/scripts/update_agent_toolchain_test.py::GrokCodexGuardSyncTest`) asserting `GROK_HOOK_GUARDS` / `CODEX_BASH_GUARDS` / `CODEX_ASK_GUARDS` / `CODEX_WRITE_GUARDS` can never silently diverge from `hooks/hooks.json`'s actual blocking guards (classified by `emitDeny(` usage) — closing the realistic version of "guard hooks may silently not fire": a future blocking guard added to `hooks.json` without a matching addition to those hand-maintained tuples.
- **What remains genuinely unverified:** whether BI-883FC2FC's live-probe findings (Grok 0.2.87, Codex 0.142.x) still hold on current client versions — these clients change weekly per this tracker's own framing, and no live Grok/Codex session was exercised in this pass (static trace + prior evidence only). Re-verify at the next monthly refresh.
- **MCP token var:** re-confirmed clean — no active setup snippet references bare `DPF_MCP_TOKEN`; the one surviving reference (`e2e/fixtures/evidence.ts`) is a deliberate `DPF_MCP_BEARER_TOKEN ?? DPF_MCP_TOKEN` back-compat fallback landed by PR #2455, not drift.

**Refresh ritual — operationalization (BI-4B8EABF8 follow-up).** The monthly ritual below is documented; wiring it as an actual `scheduledAgentTask` on the existing `agent-task-scheduler.ts` / `agent-task-dispatch.ts` substrate (read official docs → diff this tracker → file a BI per material drift → record sources + verification age) is the remaining code slice. No new cron — reuse the cognitive-load-migration scan substrate.

## Governance outcomes (G1–G9) — multi-client parity

**Spec:** [`docs/superpowers/specs/2026-07-26-multi-client-governance-parity-design.md`](../superpowers/specs/2026-07-26-multi-client-governance-parity-design.md)  
**Plan:** [`docs/superpowers/plans/2026-07-26-multi-client-governance-parity.md`](../superpowers/plans/2026-07-26-multi-client-governance-parity.md)  
**Last verified (live install sample):** 2026-07-26. Outcomes are **required**; mechanisms may differ per client (thin adapters).

| Outcome | Meaning |
|---------|---------|
| **G1 Skills** | `dpf-platform` skills installed and loadable |
| **G2 Competitive** | Known competitive process plugins **disabled** (disable-not-delete), not merely warned |
| **G3 Plane-1 hooks** | lease / lease-punt / root-clone / compose / decision-routing / plan-backlog fire and can deny |
| **G4 Session plane** | SessionStart process-spine + competitive; SessionEnd/Stop uncommitted + lease/capsule release where events exist |
| **G5 MCP** | `DPF_MCP_BEARER_TOKEN` wired; tools reachable when portal not quiescing |
| **G6 Capsule** | Work claims a capsule / FeatureBuild; orphans detectable |
| **G7 Worktree lifecycle** | Canonical sibling base; Tier-A reaping; no nested-root sprawl as steady state |
| **G8 Headless-safe** | Always-approve / non-interactive still honors deny; no operator TUI required |
| **G9 Readiness** | `record_surface_readiness` / bootstrap readiness observable |

| Client | G1 | G2 | G3 | G4 | G5 | G6 | G7 | G8 | G9 | Notes (2026-07-26) |
|--------|----|----|----|----|----|----|----|----|----|---------------------|
| **Claude Code** (host) | ✅ | ⚠️ warn | ✅ dual plane | ✅ plugin | ✅ | ◐ | ◐ create hook; reap manual | ✅ | ◐ | Competitive still warn-only |
| **Codex CLI** (host) | ✅ | ✅ disable | ✅ if hook-trust | ✅ | ✅ | ◐ | ◐ | ✅ | ◐ | Hook-trust fail-open until trusted |
| **Grok Build** (host) | ✅ | ⚠️ warn | ✅ global only | ⬜ | ✅ | ◐ | ⬜ | ✅ | ◐ | Plugin hooks ignored; Session plane missing |
| **Grok** (Build Studio sandbox) | ⬜ | ⬜ | ⬜ | ⬜ | ◐ | ✅ BS | ➖ | ⚠️ no guards | ⬜ | **P0:** `grok plugin list` empty in sandbox |
| **Antigravity (agy)** | ◐ pack | ⚠️ warn | ⬜ unproven | ⬜ | ◐ MCP wire | ◐ | ⬜ | ❓ | ⬜ | Hooks pending functional proof |
| **Build Studio** (agentic in-portal) | ✅ seed skills | ➖ | runtime gates | ➖ | ✅ | ✅ | ➖ | ✅ phase HITL | ◐ | Not CLI-hook based |
| **OpenCode** (suggested / BS dispatch) | ⬜ | ⬜ | ⬜ | ⬜ | ◐ | ✅ BS | ➖ | ❓ | ⬜ | Complete adapter after Grok BS seed |
| **Gemini CLI** (suggested) | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ❓ | ⬜ | Document checklist; bootstrap when product pulls |
| **Cursor** (compat / optional) | ⬜ | ⬜ | ◐ via Grok compat paths | ⬜ | ⬜ | ⬜ | ⬜ | ❓ | ⬜ | Hook event aliases; not first-class bootstrap |

**Backlog (filed 2026-07-26):** BI-F4A1A0DC (docs/matrix), BI-BCA23DBB (Grok host plane + competitive), BI-C5F9A232 (BS Grok seed), BI-42FA7DD8 (worktree Tier-A reap), BI-A4BEFE99 (remaining clients equalize).

## What this currently tells us (the open adoption gaps)

- **Governance parity (2026-07-26):** Grok BS seed + competitive disable + worktree Tier-A reap are the highest-leverage closes (see G1–G9 table). Token economy rows below remain separate.
- **R3 — deferred tools on `/api/mcp/v1`** (⬜): external CLIs pull the full JWT-scoped surface; adopt the Tool Search pattern.
- **R4 — code execution in the native loop** (⬜): the single biggest local-window token lever; sandbox already exists.
- **R6 — local prefix-KV cache** (◐): confirm DMR/llama.cpp reuses the static prefix.
- **⚠️ prompt-cache TTL**: re-confirm each refresh; the 5-minute default changes the break-even math for long sessions.

## Refresh ritual (monthly — how this stays fresh)

Reuse existing substrate; **no new cron, no new system**:

1. **Trigger.** A monthly `scheduledAgentTask` (the `agent-task-scheduler.ts` / `agent-task-dispatch.ts` substrate already used by the cognitive-load-migration scan) dispatches the refresh to the Enterprise Architect persona on the 1st.
2. **Method.** For each client, read the *official docs* (the `dpf-platform:claude-api` skill rule applies — never answer from memory) and diff against this matrix. The `claude-code-guide` agent type and web research cover the non-Anthropic clients.
3. **Output.** Update the cells + `Last verified` dates here; for each new token-saver worth adopting or each regression/deprecation, **file a backlog item** (`dpf-file-backlog-item`) linked to the context-engineering epic, and update `context-engineering-standards.md` if a criterion shifts.
4. **Graph projection (planned).** Project the matrix as nodes/edges in the living-architecture-graph (EP-ARCH-GRAPH-LIVE) so staleness is queryable and the Parity Engine surfaces drift automatically — the durable home once R-graph wiring lands.

## Related

- `docs/architecture/context-engineering-standards.md` — the criteria this keeps current.
- `docs/superpowers/specs/2026-06-20-context-engineering-tool-efficiency-design.md` — research + sources.
- `docs/superpowers/specs/2026-06-16-living-architecture-graph-and-operational-bridge-design.md` — the graph home for the projected tracker.
