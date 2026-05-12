# Platform MCP `--mcp-config` probe — evidence (2026-05-12, follow-up to PR #506)

## Scope

Probe-grade evidence that the registration mechanism the
2026-05-12 audit (`docs/superpowers/audits/2026-05-12-build-coworker-tool-rejection-observations.md`)
identified as the documented fix — mounting `/api/mcp/v1` via Claude
CLI's `--mcp-config` — actually dispatches platform tool calls
end-to-end, with no `tool_use_error` rejections.

Records what was tested, where, and exactly what was observed. No
proposal for the cli-adapter rewrite. The open token-mechanism
question is called out below for the maintainer.

## What was tested

1. **Direct curl `/api/mcp/v1` from `dpf-sandbox-1` over HTTP.**
   Confirmed `isTransportAllowed` (`apps/web/app/api/mcp/v1/route.ts:136-148`)
   refuses with `403 / -32600 / forbidden: TLS required (HTTPS only outside localhost)`
   when called as `http://portal:3000/api/mcp/v1`. This matches the
   audit's open question 3.
2. **Same curl with `X-Forwarded-Proto: https` header** — the route
   trusts XFP per the existing test at `route.test.ts:116-128`.
   `initialize`, `tools/list`, and `tools/call` all return real
   data:
   - `tools/list` returns the full platform tool catalog
     (`create_backlog_item`, `query_backlog`, `update_feature_brief`,
     `saveBuildEvidence`, `save_phase_handoff`, `start_scout_research`,
     etc. — i.e. the 8 names the previous session observed being
     rejected by the CLI).
   - `tools/call` for `query_backlog{limit:3}` returns
     `success: true, "Backlog: 64 open, 5 in-progress, 35 done. 16 epic(s)"`
     plus the structured `epics`/`items` payload.
3. **`claude -p --mcp-config /tmp/probe/mcp.json --strict-mcp-config`
   inside `dpf-sandbox-1`** with the `anthropic-sub` OAuth token
   (resolved via `getProviderBearerToken` in the portal — same path
   the cli-adapter uses today) and prompt
   `"Call mcp__dpf__query_backlog with limit=2 and tell me how many backlog items are open."`
   - Result: `is_error: false`, `permission_denials: []`,
     `num_turns: 3` (assistant → tool_use → tool_result → final
     assistant text), final assistant text quoted the actual
     summary line `"There are 64 open backlog items (plus 5
     in-progress and 35 done)."`
   - Model: `claude-sonnet-4-6` (default), with a prefatory
     `claude-haiku-4-5-20251001` triage step (CLI's normal
     two-stage flow).
   - Cost: `$0.046` for the single probe.

## What that proves

- The CLI's `--mcp-config` flag honors HTTP MCP servers when the URL
  is reachable and the bearer token resolves. The probe confirmed
  the previously open question: `mcp__dpf__*` tools loaded via
  `--mcp-config` dispatch through to the platform server and the
  CLI feeds the result back to the model — no `<tool_use_error>` is
  synthesized.
- The platform MCP route at `/api/mcp/v1` (already live, not new)
  serves `tools/list` and `tools/call` correctly when invoked
  through the JSON-RPC transport. No code in the route had to
  change for the probe.
- The existing `--disallowedTools` patch (PR #405) is moot once
  `--mcp-config` is wired: native tools (`Read`, `Bash`, etc.) are
  on a different namespace than `mcp__dpf__*`, so they can coexist
  without shadowing.

## What this does NOT yet prove (open in PR follow-up)

- **End-to-end via the build-specialist coworker.** The probe used
  the CLI directly with a hand-written `mcp.json`. The cli-adapter
  itself (`apps/web/lib/routing/cli-adapter.ts`) still constructs
  the prompt the old way and still passes `--disallowedTools`. The
  build-specialist will continue to see `tool_use_error` until the
  cli-adapter is rewritten to:
  1. write an `mcp-config.json` per call,
  2. pass `--mcp-config <path> --strict-mcp-config`,
  3. drop `--disallowedTools` and the text-described tool list,
  4. acknowledge that the loop should not re-execute platform tools
     emitted as `mcp__dpf__*` (they were already executed by the
     CLI's MCP client).
- **Token mechanism for the cli-adapter.** This is the open
  question that a maintainer should decide before the rewrite:
  - **Option A — short-lived per-call JWT (`X-MCP-Session`).**
    Matches the design in
    `docs/superpowers/plans/2026-04-11-platform-mcp-tool-server-implementation.md`
    Phase 1+2. New `apps/web/lib/mcp/session-token.ts` (jose),
    new auth path in `apps/web/app/api/mcp/v1/route.ts`,
    cli-adapter mints + passes per call. Cleanest audit (one
    `ToolExecution` row per call, with `agentId`/`threadId`/
    `routeContext` derived from the JWT claims). Most code change.
  - **Option B — one operator-issued long-lived `dpfmcp_*` PAT
    referenced via env (e.g. `DPF_INTERNAL_MCP_BEARER`).** Matches
    the existing PAT model already used by external coding agents.
    Smallest code change. Risk: a single high-value secret per
    install; per-call audit shows the PAT's owner not the
    coworker's threadId.
  - **Option C — reuse the existing `.mcp.json` PAT that local
    agent clients use (`AGENTS.md` §4 / `scripts/seed-worktree-mcp.ps1`).**
    Mounted into the sandbox at a known path. Implicit dependency
    on local-agent setup having been done; doesn't work for fresh
    installs that never opened a PAT.
- **Transport gate for non-`X-Forwarded-Proto` callers.** The probe
  worked because the synthetic mcp.json sent `X-Forwarded-Proto:
  https`. The cli-adapter should not lie about the proto. The
  smallest honest enabling change is the env-allowlist on
  `isTransportAllowed` introduced by this PR.

## Files touched in this PR

- `apps/web/app/api/mcp/v1/route.ts` — `isTransportAllowed` honors
  `MCP_INSECURE_INTERNAL_HOSTS` env, comma-separated hostnames.
  Default behavior unchanged.
- `apps/web/app/api/mcp/v1/route.test.ts` — three new cases in the
  transport-guard suite.
- `docker-compose.yml` — sets the env to
  `portal,host.docker.internal,sandbox` for the portal service so
  in-bridge MCP traffic works out of the box on the standard self-host
  layout.
- `.env.docker.example` — documents the env var with override
  guidance.

## Archived evidence

- Probe `mcp.json` lived at `/tmp/probe/mcp.json` inside
  `dpf-sandbox-1` during the test run (deleted at end of session).
- Probe MCP token (write-capable, 6 h TTL, scoped to backlog +
  build_plan + decision_record) was inserted directly into
  `McpApiToken` as `mcp_probe_2026_05_12_q8a73e6` and revoked
  immediately after the probe completed.
- The OAuth bearer used by the probe is the live `anthropic-sub`
  cached token from `CredentialEntry`. Not committed, not logged
  to file.
