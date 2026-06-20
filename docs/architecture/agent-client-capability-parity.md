# Agent-Client Capability Parity Tracker

**Status:** Living record — the external coding clients change weekly; this is the dated, owned source of truth for what each does and what DPF depends on / should adopt.
**Owner:** Enterprise Architect persona / `dpf-platform:dpf-architecture-review`.
**Refresh cadence:** Monthly (see "Refresh ritual"). **Last full refresh:** 2026-06-20.
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

## What this currently tells us (the open adoption gaps)

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
