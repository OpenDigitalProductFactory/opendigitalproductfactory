# MCP Tool Tiering & Deferred Loading on the External-CLI Path (R3)

**Status:** Phase 1 SHIPPED — core tier on `tools/list`, and it is **on by default for every non-Claude-Code client**, not opt-in. `defaultTierForClient` (`apps/web/lib/mcp/tool-tier.ts`) returns `full` only for a `claude-code/*` user-agent — which defers client-side via ToolSearch — and `core` for everything else; an explicit `?tier=` overrides. Phase 2 (model-driven deferral) SHIPPED — `load_tools` meta-tool + per-token `McpToolSession` short-TTL store + `notifications/tools/list_changed` (emitted over an SSE response on the `load_tools` POST for clients that `Accept: text/event-stream`). `tools/list` returns the tier floor UNION the token's session-loaded tools UNION `load_tools` (append-not-swap, so the lean core stays the floor and the cached prompt prefix survives). See §4 and `apps/web/lib/mcp/tool-session-store.ts`.

> **Status corrected 2026-08-04.** This line previously read "opt-in, default unchanged", which sent a reader looking for an unsolved token problem on external surfaces that is in fact already solved by default. Verified against the code, not the changelog. Tier narrows **discovery only** — `tools/call` still executes any *granted* tool by name (`route.ts`), so the core set is never an authorization boundary and `search_tool_marketplace` keeps the rest reachable.
**Date:** 2026-06-20
**Standard:** `docs/architecture/context-engineering-standards.md` (P4/P5). **Parent research:** `docs/superpowers/specs/2026-06-20-context-engineering-tool-efficiency-design.md` (R3).

## 1. Why

External coding agents (Claude Code, Codex, Grok) reach DPF's tools via the MCP route `/api/mcp/v1`. `tools/list` returns the whole *granted* surface — up to ~50K tokens of definitions before any work begins (the native loop already subsets to ~15–36 via grants+phase, but the external-CLI path did not). This is the G2 gap: a context tax we already know how to avoid, on the surface that changes weekly.

## 2. The constraint that shapes the design

True *model-driven* deferred loading on an MCP **server** is stateful and client-dependent: it needs per-token "loaded set" state plus `notifications/tools/list_changed` re-fetch, and only helps clients that honor `list_changed`. So we split R3:

- **Phase 1 (this PR) — operator/session-selectable core tier.** Client-agnostic, stateless, testable, and *non-breaking*. Delivers the token cut for sessions that opt in, and defines the core set Phase 2 builds on.
- **Phase 2 (staged) — model-driven deferral.** The full Tool-Search-style pattern, built on Phase 1's core set.

## 3. Phase 1 — core tier (shipped)

- A curated `CORE_MCP_TOOL_NAMES` (~22 broadly-useful discovery/read/backlog/work-visibility tools, incl. `search_tool_marketplace` so a model can still discover the rest) — `apps/web/lib/mcp/tool-tier.ts`.
- `/api/mcp/v1` `tools/list` honors a `?tier=core` hint: it applies the grant/capability/scope filter first (the authority), then narrows to the core set. `resolveMcpToolTier` defaults to `full`, so **existing clients are unaffected**.
- **Tiering affects discovery only, never execution.** `tools/call` still runs any *granted* tool by name regardless of tier — so core tier is a pure context saving with **no loss of capability**, and Phase 2 is purely additive.
- **Drift guard:** a test asserts every `CORE_MCP_TOOL_NAMES` entry exists in `PLATFORM_TOOLS`, so a tool rename can't leave a dangling core entry.

**How an operator opts a CLI into the lean surface:** point the MCP server URL at `…/api/mcp/v1?tier=core` in the client config (`.mcp.json` / Codex `config.toml`). The CLI's model then sees ~22 tools instead of the full granted set; it can still call any granted tool, and `search_tool_marketplace` surfaces the rest.

## 4. Phase 2 — model-driven deferral (staged)

Compose on Phase 1:
1. `tools/list` returns core ∪ *session-loaded* tools ∪ a `load_tools` tool.
2. `load_tools({ query?, names? })` marks matching tools loaded for this token's session and returns their summaries.
3. Per-token session state — a short-TTL store keyed by `tokenId` (new `McpToolSession` row or a cache), swept on expiry.
4. Fire `notifications/tools/list_changed`; `list_changed`-aware clients (Claude Code, Codex) re-fetch and gain the loaded tools.
This yields the headline model-driven reduction (Anthropic's Tool Search reports ~85% upfront cut) without operator involvement. Deferred because it is stateful + client-dependent + not locally verifiable (same constraints that made R4 a dark spike); it needs its own schema migration and a live-verification pass.

## 5. Tests

`apps/web/lib/mcp/tool-tier.test.ts` — `resolveMcpToolTier` (default-full, case-insensitive core), `selectToolsByTier` (full=identity, core=subset), and the `CORE_MCP_TOOL_NAMES` drift + lean-size guards. The route wiring is typecheck-validated; end-to-end `tools/list` filtering is exercised in CI's web suite.

## 6. Files

- `apps/web/lib/mcp/tool-tier.ts` (+ `.test.ts`) — tier resolution, core set, pure selection.
- `apps/web/app/api/mcp/v1/route.ts` — `handleToolsList` tier param + `?tier=` dispatch.
- Docs: `AGENTS.md` §8 (opt-in instructions), `context-engineering-standards.md` (P4), `agent-client-capability-parity.md` (R3 row).
