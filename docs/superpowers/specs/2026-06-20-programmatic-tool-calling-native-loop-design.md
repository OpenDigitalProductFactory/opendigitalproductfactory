# Programmatic Tool Calling for the Native Agentic Loop (R4)

**Status:** Spike SHIPPED DARK (flag default-OFF + grant default-deny → inert). Pure logic unit-tested; the sandbox `docker exec` round-trip is **live-verification-pending** (the sandbox cannot run in `dev`). **Do NOT enable the `programmatic_tool_calling` flag until the live runbook in §6 passes.**
**Date:** 2026-06-20
**Standard:** `docs/architecture/context-engineering-standards.md` (P7). **Parent research:** `docs/superpowers/specs/2026-06-20-context-engineering-tool-efficiency-design.md` (R4).

## 1. Why

On the binding ~24,576-token local window, round-tripping every full tool result through the model is the dominant context cost. Programmatic tool calling — the model writes a short script that calls several tools and **filters results in an isolated sandbox**, returning only the small filtered output — is the single biggest token lever (Anthropic measures 37–98% reductions on read-heavy filtering). This is P7 in the standard.

## 2. Design — compose the proven path, invent nothing

The capability is **~80% pre-built**: the CLI execution adapter (`apps/web/lib/routing/cli-adapter.ts`) already mints a short-lived scoped JWT, runs in the sandbox, and lets a model call governed tools that reenter through `/api/mcp/v1 → governedExecuteTool` (kernel gate + agent grants per call, audited). This spike composes that exact pattern for the **native agentic loop** as an ordinary governed tool.

- **`run_tool_script(code, purpose?)`** — a normal `PLATFORM_TOOLS` entry (`requiredCapability: view_platform`, `sideEffect: false`). Because it is dispatched through `governedExecuteTool` like any tool, the **outer** call is itself governed (kernel gate + its own grant).
- **Handler** `runToolScript` (`apps/web/lib/tak/tool-script.ts`): resolves the agent's grants → derives a **read-only** scope set → mints a 5-min `createMcpSessionToken` (`capability: "read"`) → writes the wrapped script + token into the sandbox (base64, `chmod 600`) → `node` runs it → captures the emitted result → **always wipes** script + token → returns the result, capped by `clampToolResultForModel` (R1).
- **Inner `callTool(name, args)`** (in the wrapped script) is a plain `POST {INTERNAL_PORTAL_URL}/api/mcp/v1` with `X-MCP-Session: <jwt>` — i.e. **every inner tool call reenters `governedExecuteTool`** (capability + grant + kernel-gate hooks) and writes a `ToolExecution` audit row. The script has no privileged backdoor.
- **Result convention:** the model's `code` is an async body that calls `callTool` and returns its small result via `emit(value)`. Output is delimited by a marker so the handler extracts exactly the emitted value.

## 3. Two kill-switches (default INERT)

Both are required to activate; either one off ⇒ the feature cannot run:
1. **`tool_script_exec` agent grant** — default-deny (`TOOL_TO_GRANTS`), so `run_tool_script` is invisible to every agent until explicitly granted.
2. **`programmatic_tool_calling` PlatformConfig flag** — default-OFF (`getProgrammaticToolCallingConfig`, fail-closed). The handler refuses when off.

## 4. Security review (kernel-gate-in-code)

This is the review R4 was gated on.

- **Governance is preserved, not bypassed.** The token grants no authority of its own; the MCP route re-gates **every** inner call by user capability + agent grant + kernel runtime gate. A wider scope cannot widen actual access (the route is the authority). The kernel veto on outbound sends still fires inside script-issued calls.
- **Read-only blast radius.** `deriveReadOnlyScopes` strips every side-effecting grant (`_write|_create|_triage|_promote|_execute|_approve|_delete|_send|_publish`) and `tool_script_exec` itself, and mints `capability: "read"`. So a script can read/aggregate but cannot mutate, send, or recurse. (Write-capable scripts are a deliberate future extension, not this spike.)
- **No recursion / fork-bomb.** `tool_script_exec` is excluded from the script's scopes, so a script's attempt to call `run_tool_script` is grant-denied at the route.
- **Token hygiene.** 5-min TTL; written via base64 (never echoed in plaintext into a logged command); `chmod 600`; **wiped in `finally`**; never placed in tool-result `data`, evidence, or logs (mirrors cli-adapter).
- **Containment = the sandbox.** Docker container, CPU/mem/disk limited, command-blocklisted, path-traversal-guarded. The model's code runs *there*, never in the portal process; there is **no `eval`/`new Function` in portal code** (the wrapped script is inlined text the sandbox executes).
- **Residual risk — sandbox egress.** The sandbox has outbound network (needed for npm), so a script could in principle exfiltrate the *read* data it can already see. This is the same trust boundary as the existing CLI-adapter path and `run_sandbox_command`. Documented; mitigated long-term by the planned egress-filtered sandbox network (see `sandbox.ts` create comment). **This is the main reason the flag stays OFF until §6.**
- **Audit.** Every inner call is a `ToolExecution` row (`executionMode: internal-mcp-session`, attributable to `session:<userId>:<agentId>`); the outer `run_tool_script` is audited by the normal path.

## 5. What's verified now vs live-pending

- **Unit-tested (CI):** `parseProgrammaticToolCallingConfig` (defaults/clamps), `deriveReadOnlyScopes` (read-only narrowing, no recursion), `wrapToolScript` (preamble shape, no dynamic eval), `parseToolScriptOutput`. See `apps/web/lib/tak/tool-script.test.ts`.
- **Typecheck (CI):** the handler, tool definition, dispatch case, grant.
- **Live-pending:** the `docker exec node` round-trip and the actual governed reentry from inside the sandbox — these require a running sandbox (`createSandbox` throws in `dev`).

## 6. Live-verification runbook (gate before enabling the flag)

In a non-dev install with a running sandbox:
1. Grant `tool_script_exec` to a single test agent; set `programmatic_tool_calling` `{ enabled: true }`.
2. Run a read-only script (e.g. `const r = await callTool('query_backlog', { status: 'open' }); emit(r.items.length);`) and confirm the returned value matches a direct `query_backlog`.
3. Confirm `ToolExecution` rows exist for the **inner** call with `executionMode: internal-mcp-session`.
4. Negative tests: a script calling a write tool (e.g. `create_backlog_item`) must be **grant-denied** by the route; a script calling `run_tool_script` must be denied (no recursion); after the run, confirm `/workspace/.dpf-mcp-session` is **gone**.
5. Confirm the token never appears in logs, `BuildActivity`, or tool-result `data`.
6. Only then consider enabling for real agents; keep it scoped to read-heavy roles.

## 7. Staged extensions (not in this spike)

- Write-capable scripts (per-call HITL/kernel-gate already applies) once read-only is proven.
- Egress-filtered sandbox network (close the residual risk).
- Loop-native presentation (teach the prompt when to prefer `run_tool_script` over N individual reads) + an eval (R8) measuring the realized token reduction.

## 8. Files

- `apps/web/lib/tak/tool-script.ts` (+ `.test.ts`) — config, scopes, wrapper, parser, handler.
- `apps/web/lib/mcp-tools.ts` — `run_tool_script` definition + dispatch case.
- `apps/web/lib/tak/agent-grants.ts` — `run_tool_script → tool_script_exec` (default-deny).
- Composes: `apps/web/lib/mcp/session-token.ts`, `apps/web/app/api/mcp/v1/route.ts`, `apps/web/lib/integrate/sandbox/sandbox.ts`, `apps/web/lib/mcp-governed-execute.ts`.
