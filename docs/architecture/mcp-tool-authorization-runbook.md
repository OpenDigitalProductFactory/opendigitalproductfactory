# MCP tool authorization runbook

**Status:** procedure reference. The *rules* — the authorization principle, scope escalation, and grant enforcement — live in [`AGENTS.md`](../../AGENTS.md) §8/§8a and stay always-on. This file holds transport detail, token issuance and rotation, worktree MCP sync, and the grant-intersection mechanics. Relocated from §8 by BI-0020D511 Phase 1; no rule was dropped.

External coding agents use the real MCP JSON-RPC 2.0 transport at `/api/mcp/v1` (`apps/web/app/api/mcp/v1/route.ts`). The older `/api/mcp/tools` and `/api/mcp/call` endpoints remain for in-portal coworker chat and are not the external MCP client contract.

Authorized product surfaces use the six generic `surface_*` MCP tools rather than page-specific side doors. `surface_open` compiles a principal-bound session; every later read or action revalidates the human role, coworker grants, work context, token scope, approval policy, revision, and TTL. Persistent actions re-enter `governedExecuteTool`, so the surface contract never bypasses the authorization path described here.

MCP bearer tokens use the `dpfmcp_...` pattern and are issued from Admin > Platform Development > MCP. Treat `.mcp.json` and `.vscode/mcp.json` as local credential files only; they are ignored by git and must never be committed.

**MCP token scopes:** tokens have a coarse `scope` of `read`, `write`, or `admin` plus granular per-tool grants. Default tokens are `read` and cannot call side-effecting tools even if an old token row carries a write grant. Use **Issue write token** in Admin > Platform Development > MCP when an agent must create or update Work Capsules, backlog items, Build Studio evidence, runtime coordination records, or other side-effecting MCP records. The portal shows the plaintext token once, writes the local client snippet, and supports revocation without editing config files.

**Scope escalation rule:** if `/api/mcp/v1` returns an MCP tool result with `structuredContent.error = "insufficient_token_scope"` and `requiredScope` such as `"write"`, stop the MCP workflow and surface the required scope to the operator. Do not fall back to `psql`, Prisma scripts, direct DB edits, or hidden runtime patches to bypass the MCP scope gate. The correct action is to issue a scoped token in the portal, update the client token using the displayed setup command/snippet, call `/api/mcp/token/refresh` with the new token, and retry through MCP.

**Token rotation — Claude Code and Codex:** Both tools read the token from the `DPF_MCP_BEARER_TOKEN` Windows user environment variable. `.mcp.json` references it as `${DPF_MCP_BEARER_TOKEN}`; Codex does the same via `bearer_token_env_var` in `~/.codex/config.toml`. Token rotation from Admin > Platform Development > MCP is:
```powershell
[System.Environment]::SetEnvironmentVariable('DPF_MCP_BEARER_TOKEN', '<new-token>', 'User')
Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:3000/api/mcp/token/refresh' -ContentType 'application/json' -Body '{"token":"<new-token>"}'
```
Then retry the MCP call in the running session. No file edits. No re-registration. ⟦runtime: install-local topology — the `127.0.0.1:3000` literal above is the local bind; on cloud / TAPPaaS re-verify via Admin > Platform Development⟧

**New worktree MCP sync:** `.mcp.json` and `.vscode/mcp.json` are gitignored, so each worktree needs local MCP config plus its own `COMPOSE_PROJECT_NAME` and readiness marker. For a single new worktree, run the seed script from inside that worktree. To have it born **compile-ready** (a managed dependency bootstrap via the shared pnpm store, instead of source-only — no junction dance), set `DPF_WORKTREE_BOOTSTRAP=1` before seeding; the seed step then runs `scripts/lib/bootstrap-worktree-deps.mjs` fail-safe (BI-3047C122 — off by default so it never slows routine creation). To repair or rotate every linked worktree, run:
```powershell
.\scripts\sync-mcp-worktrees.ps1
```
The sync scripts copy MCP config, preserve non-root Compose isolation, and refresh `.dpf-worktree-readiness.json` so agents know whether the worktree is `compile-ready` or `source-only`.

Agent `tool_grants` in `agent_registry.json` are enforced at runtime.

**Advise-safe tool classification** — stated once in §8a below.

 `getAvailableTools()` (`apps/web/lib/agent-grants.ts`) intersects:

1. User role capabilities (`PERMISSIONS[capability].roles` for the user's `platformRole`)
2. Agent grants (`config_profile.tool_grants`)

Both must permit the tool. The `TOOL_TO_GRANTS` record maps platform tool names to grant categories. Tools not in the mapping are allowed by default.

Every tool call writes to `ToolExecution` (`agentId`, `userId`, `toolName`, `parameters`, `result`, `success`, `executionMode`, `routeContext`, `durationMs`, `createdAt`). Visible at `/platform/ai/authority`.

**Context & token economy (mandatory).** Tool definitions, results, and prompts are a finite-budget resource; the binding window is the **~24,576-token local served window**, not a cloud window, and tool-selection accuracy collapses past ~15 tools (`LOCAL_FALLBACK_MAX_TOOLS`). When adding or changing a model-facing tool: keep its `description` **provenance-free** (no `Phase N`, `(BI-…)`, or source paths — those go in code comments; CI guard: `apps/web/lib/tool-description-hygiene.test.ts`), return **concise, paginated, capped** results (the runtime cap is `apps/web/lib/tak/tool-result-budget.ts`), and prefer **few, consolidated, phase/grant-scoped** tools over growing the 242-tool surface. Standard: [`docs/architecture/context-engineering-standards.md`](../architecture/context-engineering-standards.md). Live client capability facts (refreshed monthly): [`docs/architecture/agent-client-capability-parity.md`](../architecture/agent-client-capability-parity.md).

**Lean MCP surface (client-default):** `tools/list` defaults **non-Claude-Code** clients (Codex, Grok, a customer's own agent, or an unidentified caller) to a curated core tool set of ~29 broadly useful tools instead of the full granted surface, cutting the upfront token tax for clients that have no client-side deferral. **Claude Code keeps the full surface** because it defers the catalogue client-side (ToolSearch). The core set includes (1) the governed live-delivery loop (`get_quiescence_status`, `get_self_upgrade_queue_status`, `request_self_upgrade`, `repair_promoter_image`, `record_runtime_verification`) and (2) **WWMD kernel discovery** (`principle_decide`, `wiki_query`) so peer CLIs that lack ToolSearch can still satisfy AGENTS.md kernel consults without opting into the full catalogue. Capability, token-scope, and grant gates still filter those tools per caller. Any caller opts back to the full surface with `…/api/mcp/v1?tier=core|full` (in `.mcp.json` / Codex `config.toml` / Grok `config.toml`). Tiering is discovery-only — the model can still call any granted tool by name, and `search_tool_marketplace` surfaces the rest.

**Code graph first (mandatory for code work).** Before broad text search or any symbol-level blast-radius claim, consult the committed code graph the way Build Studio agents already do: call `get_code_graph_freshness`, then `search_code_graph` / `trace_code_surface` to locate symbols, routes, Prisma models, MCP tools, and prompt sources, and confirm exact code with `read_project_file`; call `find_related_tests` for changed source files. **Do not assert symbol-level blast radius unless `trace_code_surface` returns structural edges.** `get_code_graph_freshness` reports index staleness and a dirty workspace; when the graph is stale or a result is empty, fall back to grep + file reads. This discipline is wired into the Build Studio agent prompts (`apps/web/lib/integrate/build-agent-prompts.ts`) — it applies identically to direct Claude Code / Codex / Grok sessions, which otherwise never learn the graph exists.

**Coworker lifecycle contract (mandatory for new AI coworkers).** A coworker's lifecycle is `draft → defined → certified → active`, and it is enforced, not conventional (EP-COWORKER-LIFECYCLE; spec: `docs/superpowers/specs/2026-07-07-coworker-lifecycle-standard-design.md`):

1. **Create only through the factory door** — the `establish_coworker` MCP tool (`action: "establish"`) creates the draft Agent row + grants + model floor + principal, and returns the definition checklist. Never create an Agent row by hand or in an ad-hoc seed; that recreates the multi-population drift this lifecycle closed. Draft coworkers are NOT summonable — the lifecycle gate (`apps/web/lib/coworker-lifecycle/lifecycle-gate.ts`) blocks them at chat, scheduled/autonomous dispatch, and summon/handoff.
2. **Complete the definition via PR** — roster entry, durable grants map, route binding + sensitivity mirror, model floor, profession family (the checklist the door returns). The coworker-definition conformance gate in the required Unit Tests job fails on any missing axis; do not extend its baseline for a new coworker.
3. **Earn certification** — the nightly golden-journey sweep (`ops/coworker-certification-nightly`; run-now event `ops/coworker-certification.requested`) exercises every roster coworker through the real execution path with evidence-based oracles; results surface on the workforce roster.
4. **Promote** — `establish_coworker` `action: "promote"` flips draft → production only when the definition landed AND a passing certification exists.

The paved-road walkthrough is the `dpf-establish-coworker` skill (`packages/dpf-skill-pack/skills/dpf-establish-coworker/SKILL.md`).
