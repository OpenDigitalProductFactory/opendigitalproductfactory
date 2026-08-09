# MCP Tool Tiering & Deferred Loading on the External-CLI Path (R3)

**Status:** Phase 1 SHIPPED — core tier on `tools/list`, and it is **on by default for every non-Claude-Code client**, not opt-in. `defaultTierForClient` (`apps/web/lib/mcp/tool-tier.ts`) returns `full` only for a `claude-code/*` user-agent — which defers client-side via ToolSearch — and `core` for everything else; an explicit `?tier=` overrides. Phase 2 (model-driven deferral) SHIPPED — `load_tools` meta-tool + per-token `McpToolSession` short-TTL store + `notifications/tools/list_changed` (emitted over an SSE response on the `load_tools` POST for clients that `Accept: text/event-stream`). `tools/list` returns the tier floor UNION the token's session-loaded tools UNION `load_tools` (append-not-swap, so the lean core stays the floor and the cached prompt prefix survives). See §4 and `apps/web/lib/mcp/tool-session-store.ts`.

> **Status corrected 2026-08-04.** This line previously read "opt-in, default unchanged", which sent a reader looking for an unsolved token problem on external surfaces that is in fact already solved by default. Verified against the code, not the changelog. Tier narrows **discovery only** — `tools/call` still executes any *granted* tool by name (`route.ts`), so the core set is never an authorization boundary and `search_tool_marketplace` keeps the rest reachable.
**Date:** 2026-06-20
**Standard:** `docs/architecture/context-engineering-standards.md` (P4/P5). **Parent research:** `docs/superpowers/specs/2026-06-20-context-engineering-tool-efficiency-design.md` (R3).

## 1. Why

External coding agents (Claude Code, Codex, Grok) reach DPF's tools via the MCP route `/api/mcp/v1`. `tools/list` returns the whole *granted* surface — up to ~50K tokens of definitions before any work begins (the native loop already subsets to ~15–36 via grants+phase, but the external-CLI path did not). This is the G2 gap: a context tax we already know how to avoid, on the surface that changes weekly.

## 2. The constraint that shapes the design

True *model-driven* deferred loading on an MCP **server** is stateful and client-dependent: it needs per-token "loaded set" state plus a refresh contract. DPF therefore supports both `notifications/tools/list_changed` and an explicit `tools/list` re-fetch after `load_tools`; client notification support is an optimization, not a correctness dependency. R3 shipped in two phases:

- **Phase 1 — client-default core tier.** Client-agnostic, stateless, testable, and *non-breaking*. Defines the floor that Phase 2 expands.
- **Phase 2 — model-driven deferral (shipped in PR #4112; bootstrap hardened 2026-08-08).** Exact-name and natural-language intent loading over an authorized per-token session, with append-not-swap refresh behavior.

## 3. Phase 1 — core tier (shipped)

- A curated `CORE_MCP_TOOL_NAMES` (~22 broadly-useful discovery/read/backlog/work-visibility tools, incl. `search_tool_marketplace` so a model can still discover the rest) — `apps/web/lib/mcp/tool-tier.ts`.
- `/api/mcp/v1` `tools/list` honors a `?tier=core` hint: it applies the grant/capability/scope filter first (the authority), then narrows to the core set. The server defaults Claude Code to `full` because that host defers client-side and every other/unknown client to `core`; explicit `?tier=` wins.
- **Tiering affects discovery only, never execution.** `tools/call` still runs any *granted* tool by name regardless of tier — so core tier is a pure context saving with **no loss of capability**, and Phase 2 is purely additive.
- **Drift guard:** a test asserts every `CORE_MCP_TOOL_NAMES` entry exists in `PLATFORM_TOOLS`, so a tool rename can't leave a dangling core entry.

**Operator override:** point the MCP server URL at `…/api/mcp/v1?tier=core|full` in the client config (`.mcp.json` / Codex `config.toml`). Most clients need no override because the server applies the client-aware default.

## 4. Phase 2 — model-driven deferral (shipped)

Compose on Phase 1:
1. `tools/list` returns core ∪ *session-loaded* tools ∪ a `load_tools` tool.
2. `load_tools({ query?, names? })` selects only already-authorized tools, preferring exact names and otherwise ranking natural-language intent against tool names/descriptions. It marks the bounded result set loaded for this token's session and returns summaries.
3. Per-token session state — a short-TTL store keyed by `tokenId` (new `McpToolSession` row or a cache), swept on expiry.
4. Fire `notifications/tools/list_changed` for SSE-capable clients and always return a result that tells notification-blind clients to re-fetch `tools/list`.
5. Put the recovery workflow in the first 512 characters of MCP initialize instructions: resources are not tools, plugin installation is not recovery for an already-connected DPF server, missing grants are authorization failures, and transport failure means the server is unavailable.

This preserves the lean upfront surface without depending on unverified host behavior. DPF's conformance harness (`scripts/mcp-progressive-disclosure-conformance.mjs`) exercises Codex Desktop, Codex CLI, Claude Code, and generic MCP protocol profiles; actual host consumption of `list_changed` remains separate evidence.

## 5. Tests

`apps/web/lib/mcp/tool-tier.test.ts` covers tiering, append-not-swap, exact names, and natural-language intent. `apps/web/app/api/mcp/v1/route.test.ts` covers initialize guidance, listing, session expansion, SSE/JSON behavior, and recovery/error distinctions. `scripts/mcp-progressive-disclosure-conformance.test.mjs` guards the multi-client profile and response parser.

## 6. Files

- `apps/web/lib/mcp/tool-tier.ts` (+ `.test.ts`) — tier resolution, core set, append-not-swap listing.
- `apps/web/lib/tak/tool-intent.ts` — shared bounded exact/intent selection for MCP and native coworkers.
- `apps/web/lib/mcp/load-tools.ts` — meta-tool schema, result/recovery payloads, SSE notification.
- `apps/web/app/api/mcp/v1/route.ts` — initialize, listing, loading, and error-classification contract.
- `scripts/mcp-progressive-disclosure-conformance.mjs` — credential-safe protocol-profile probe.
