# MCP tool authorization runbook

**OAuth identity and continuing authority.** The approval binds the human,
client, resource and approved assistant role. The server resolves that role
before the consent screen renders (BI-05E0EA33): it takes the eligible set,
proves the candidates carry the same grants, clearance and tier, and only
then lets the client's self-declared name pick a label inside that class;
a prior consent by the same human for the same name and redirect family wins
over the name. A self-declared name can never choose a coworker outside the
eligible set or widen a scope. The default flow is one Connect action;
`Change` and `Adjust permissions` are disclosures, and a picker is opened
only when eligible coworkers differ in authority. Reconnects, refreshes and
new tasks reuse that consent without another login; each privileged action
checks the human's current permissions, token scope, assistant grants and
room admission. OAuth work claims retain the human owner separately from
assistant attribution. Older connections missing approved identity need one
consent repair through the client's reconnect flow. Never assign an old room
to its caller or substitute a legacy token to repair OAuth.

**Status:** procedure reference. The *rules* — the authorization principle, scope escalation, and grant enforcement — live in [`AGENTS.md`](../../AGENTS.md) §8/§8a and stay always-on. This file holds transport detail, token issuance and rotation, worktree MCP sync, and the grant-intersection mechanics. Relocated from §8 by BI-0020D511 Phase 1; no rule was dropped.

External coding agents use the real MCP JSON-RPC 2.0 transport at `/api/mcp/v1` (`apps/web/app/api/mcp/v1/route.ts`). The older `/api/mcp/tools` and `/api/mcp/call` endpoints remain for in-portal coworker chat and are not the external MCP client contract.

The agent-toolchain updater gives its managed Codex plugin copy a content-derived
cache version. New delivered files therefore replace a stale client cache even
when the source package version is unchanged; identical updates keep the same
version. Installation succeeds only after the cached files match the managed
copy. A dry run leaves both source and client configuration untouched. Restart
the client to load the refreshed plugin; an existing connection is not proof of
the new OAuth configuration. This prevents a stale updater from restoring the
managed bearer override after OAuth setup.

Authorized product surfaces use the six generic `surface_*` MCP tools rather than page-specific side doors. `surface_open` compiles a principal-bound session; every later read or action revalidates the human role, coworker grants, work context, token scope, approval policy, revision, and TTL. Persistent actions re-enter `governedExecuteTool`, so the surface contract never bypasses the authorization path described here.

**How a client authenticates: one authorization server, two grant types.** A client points at `/api/mcp/v1`, gets a `401` whose `WWW-Authenticate` carries `resource_metadata=`, discovers the authorization server from `/.well-known/oauth-protected-resource/api/mcp/v1`, and runs the OAuth 2.1 authorization-code flow with PKCE-S256. A browser opens, the operator approves a named client and a named scope set once, and the client refreshes silently from then on. **No environment variable, no copy-paste, no client restart.** Headless callers with no browser — CI, cron, containers — use the `client_credentials` grant against the same authorization server, with an operator-issued client from Admin > Platform Development. Design: [`docs/superpowers/specs/2026-08-26-mcp-client-self-authentication-design.md`](../superpowers/specs/2026-08-26-mcp-client-self-authentication-design.md).

**Public scopes.** Clients request six public scopes — `dpf.read`, `dpf.work`, `dpf.build`, `dpf.business`, `dpf.operate`, `dpf.admin` — not the 86 internal grant names. `apps/web/lib/auth/oauth-scope-map.ts` owns the mapping and a totality test fails CI when a new internal grant is added without one. The advertised public floor is `dpf.read`, `dpf.work` and `dpf.build`; higher authority uses explicit scopes and the same role/grant intersection. A scope refusal follows the step-up rule below.

**MCP bearer tokens (`dpfmcp_...`) are the legacy path, on a deprecation horizon.** They are issued from Admin > Platform Development > MCP and still resolve; issuance closes when `DPF_MCP_PAT_ISSUANCE_CLOSED=1` and resolution ends at the operator's horizon (`DPF_MCP_PAT_RESOLUTION_DISABLED=1`). Treat `.mcp.json` and `.vscode/mcp.json` as local credential files only; they are ignored by git and must never be committed. An OAuth client stores its own tokens and needs neither file for credentials.

**Endpoint trust for config-resolved tokens:** a `.mcp.json` file is ambient state. It is copied between worktrees, it survives a machine move, and anything with the checkout can write it. A gate script that reads a token out of it therefore checks the endpoint it names before putting that token on the wire: `isAllowedMcpEndpoint` in `scripts/lib/mcp-client.mjs` accepts only `127.0.0.1`, `localhost` and `[::1]` over HTTP or HTTPS. A file naming any other host is a stop, not a fall back to the default endpoint, because sending a live `dpfmcp_...` credential to an unintended host discloses it. To reach a portal that is not on loopback, set `DPF_MCP_BEARER_TOKEN` and `DPF_MCP_URL`: those are stated operator intent and are not narrowed.

**MCP token scopes:** tokens have a coarse `scope` of `read`, `write`, or `admin` plus granular per-tool grants. Default tokens are `read` and cannot call side-effecting tools even if an old token row carries a write grant. Use **Issue write token** in Admin > Platform Development > MCP when an agent must create or update Workrooms, backlog items, Build Studio evidence, runtime coordination records, or other side-effecting MCP records. The portal shows the plaintext token once, writes the local client snippet, and supports revocation without editing config files.

**Scope escalation rule — two shapes, depending on how you authenticated.**

*OAuth caller (step-up, the paved road).* A scope refusal is an HTTP **403** with `WWW-Authenticate: Bearer error="insufficient_scope", scope="<granted> <required>", resource_metadata="..."`. That is a **flow, not a halt**: re-authorize for the named scope set, the operator approves exactly the additional authority on a consent screen, and retry the original call. Retry a bounded number of times and then treat it as a permanent failure — do not loop.

*PAT caller (unchanged contract).* If `/api/mcp/v1` returns an MCP tool result with `structuredContent.error = "insufficient_token_scope"` and `requiredScope` such as `"write"`, stop the MCP workflow and surface the required scope to the operator. Do not fall back to `psql`, Prisma scripts, direct DB edits, or hidden runtime patches to bypass the MCP scope gate. The correct action is to issue a scoped token in the portal, update the client token using the displayed setup command/snippet, call `/api/mcp/token/refresh` with the new token, and retry through MCP.

**Interactive setup defaults to OAuth (BI-A5307F9E).** The shared `mcpClientBearerHeaderRequired` policy accounts for the client and endpoint. Codex uses URL-only configuration on HTTPS and HTTP loopback (`localhost`, `127.0.0.1`, `[::1]`). Bootstrap and updater reruns remove the managed `DPF_MCP_BEARER_TOKEN` override; they preserve user-owned credential overrides and never revoke credentials. Other clients retain their established compatibility requirements where OAuth has not been verified. Grok remains explicitly in that category; remote HTTP is not advertised as secure OAuth.

**Install and rerun behavior.** The default bootstrap does not mint a PAT while OAuth authorization is pending. Its banner separates configuration written from an authenticated connection: sign in through the client's MCP authorization flow (Codex: `codex mcp login dpf`), then verify a governed read and a permitted write. A separate PAT probe does not establish that the client's OAuth session works. Existing user-owned overrides require explicit operator review rather than being silently removed.

**Explicit compatibility.** Select `-AuthMode legacy` on PowerShell or `--auth-mode legacy` on Bash; the standalone updater accepts `--auth-mode legacy`, and all adapters honor `DPF_MCP_AUTH_MODE=legacy`. PowerShell legacy mode retains its mint behavior unless `-NoAutoMint` is set. On Bash, `--auto-mint` explicitly selects legacy mode and enables minting; `--no-auto-mint` prevents issuance. PAT-issuance snippets remain usable compatibility snippets. Managed host-file refresh follows the interactive policy, so issuance does not re-pin an HTTPS client's OAuth config. Existing tokens and the separate headless client-credentials path remain intact.

**Acceptance boundary.** Generator and temporary-home rerun tests verify source behavior. Fresh server install, browser consent, restart, refresh and governed reads/writes must still be exercised during the operator's planned reinstall. Configuration written is not that acceptance evidence.

**Gate scripts authenticate headlessly with a `client_credentials` client (BI-78B653D5).** `pnpm run pregate` (`scripts/gate-worktree.mjs`, `scripts/pregate.mjs`) has no browser, so it cannot ride the client's OAuth session; it speaks the same authorization server through the headless grant instead. Resolution order in `scripts/lib/mcp-credential.mjs`: (1) a `client_credentials` client — `DPF_MCP_CLIENT_ID` + `DPF_MCP_CLIENT_SECRET`, or `{"clientId","clientSecret"}` in `~/.dpf/mcp-client-credentials.json` (path override `DPF_MCP_CLIENT_CREDENTIALS_FILE`; it lives outside every checkout so it can never be committed) — minted by an operator in Admin > Platform Development > MCP; the gate re-mints its short-lived access token itself, so a long run never strands on a stale copy; (2) the legacy `DPF_MCP_BEARER_TOKEN` PAT until its retirement horizon; (3) neither: the gate refuses before any lease work with a message naming both paths. An expired PAT therefore no longer forces an `operator-emergency` push override — issue a credentials client once and the gate runs.

**Connect over loopback https — OAuth, nothing to rotate (BI-FA2C46D7).** On an install with the organization PKI bootstrapped, the client can authorize itself and the token path above stops being needed for desktop clients. Every step is a checked-in script; the operator's only action is one browser consent.

1. `bash scripts/bootstrap-organization-pki.sh --mode authority --hostname localhost --san 127.0.0.1` (re-runnable; reuses the CA). The portal certificate is issued for a year (`DPF_PKI_PORTAL_CERT_DURATION`, default `8760h`) — earlier bootstraps issued a 24h leaf that expired the next day and silently broke LDAPS and any https front (BI-5727522F); a leaf shorter than the configured lifetime is re-issued on the next run. The script starts the Caddy front (`docker-compose.tls.yml`, `:443 → portal:3000`); the installer's compose chain and the autostart unit keep it running because `DPF_ORGANIZATION_TRUST_ENABLED=1` is recorded in `.env`.
2. `DPF_MCP_URL=https://127.0.0.1/api/mcp/v1?tier=full bash scripts/dpf-bootstrap-agent-toolchain.sh`. For an https endpoint the bootstrap resolves the organization root (`DPF_PKI_TRUST_BUNDLE`, then the install's `.env`, then `~/.dpf/pki/root_ca.crt`) and persists `DPF_MCP_URL` and `NODE_EXTRA_CA_CERTS` beside the token in `~/.dpf/agent-toolchain.env` and, on macOS, the launchd user environment — Node clients (Claude Code, Codex, the gate scripts) trust the install's own CA through that variable, so nothing is added to the system keychain. The client config it writes carries **no** `headers.Authorization` (the scheme rule above), which is what lets discovery run. For Claude Code it also carries `oauth.scopes` = `dpf.read dpf.work dpf.build` (BI-3D2FD68C). The portal advertises only `dpf.read` in its protected-resource metadata, on purpose, and a client that requests just the advertisement is read-only for good: progressive disclosure never shows it a write tool, so the `insufficient_scope` step-up has nothing to fire on. The pin is what makes the consent screen list the write scopes; `dpf.business`, `dpf.operate` and `dpf.admin` stay a deliberate operator choice. The pinned set lives once, as `MCP_CLIENT_OAUTH_SCOPE_PIN` in `packages/integration-shared/src/mcp-client-credential-policy.ts`, and the skill pack's Python generator mirrors it. Claude Code reads the pin only when it starts, so restart the desktop client after the bootstrap changes it.
3. Restart the desktop client. On first connection it discovers the authorization server, registers itself (RFC 7591), and opens a browser consent page on the signed-in portal; approve once — the page names the assistant the connection will act as and lists the pinned scopes in plain words (read, work and build for Claude Code); `Adjust permissions` reveals one checkbox per scope if you want to grant less. From then on the access token refreshes silently. `Admin > Platform Development` lists the client beside any remaining PATs. To consent again later (for example after the pin changes), type `/mcp` in the Claude Code composer, pick `dpf`, and choose Authenticate. The desktop app's Settings > Connectors page lists claude.ai connectors only, and the dpf-platform plugin page shows its own copy of the connector as "Not added" because the project's `.mcp.json` entry of the same name takes precedence; neither is the place to sign in. If the consent page stays on screen after Approve, the sign-in still completed: the redirect targets the `claude://` scheme, so the tab never navigates away.

The SessionStart health hook reads the OAuth challenge on https (a `401` naming `resource_metadata` is the healthy answer) and no longer asks for a token there. Headless callers that cannot open a browser use a `client_credentials` client (design Slice 2b) or, until then, a PAT. Liveness: `OAuthRefreshToken` rows become non-zero on the install and a session authenticates with `source=oauth` (BI-CE5F8C0A).

**Token rotation — the PAT fallback only.** Both tools read the token from the `DPF_MCP_BEARER_TOKEN` environment variable. **The commands below are Windows/PowerShell.** On macOS the variable is set with `launchctl setenv DPF_MCP_BEARER_TOKEN <value>` (a shell-profile `export` is not enough — the desktop clients are launched by launchd, not from your shell), and on Linux it follows that host's user-environment mechanism. The portal's token dialog currently offers only the PowerShell form; see BI-B6088EC6. `.mcp.json` references it as `${DPF_MCP_BEARER_TOKEN}`; Codex does the same via `bearer_token_env_var` in `~/.codex/config.toml`. Token rotation from Admin > Platform Development > MCP is:
```powershell
[System.Environment]::SetEnvironmentVariable('DPF_MCP_BEARER_TOKEN', '<new-token>', 'User')
Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:3000/api/mcp/token/refresh' -ContentType 'application/json' -Body '{"token":"<new-token>"}'
```
Then retry the MCP call in the running session. No file edits. No re-registration. ⟦runtime: install-local topology — the `127.0.0.1:3000` literal above is the local bind; on cloud / TAPPaaS re-verify via Admin > Platform Development⟧

**New worktree MCP sync.** ⚠️ `.vscode/mcp.json` is gitignored; **`.mcp.json` is NOT — it is tracked in this repository.** An earlier version of this runbook asserted both were ignored, and that is the assumption under which someone pastes a literal `dpfmcp_` value into a file that is then committed (it has happened: literal tokens exist in local salvage commits touching `.mcp.json`, unpushed). A tracked `.mcp.json` must therefore contain **no credential in any form** — no literal, and now not even a `${DPF_MCP_BEARER_TOKEN}` reference, since it carries no `headers` block at all. Each worktree still needs its own `COMPOSE_PROJECT_NAME` and readiness marker plus its own `COMPOSE_PROJECT_NAME` and readiness marker. For a single new worktree, run the seed script from inside that worktree. To have it born **compile-ready** (a managed dependency bootstrap via the shared pnpm store, instead of source-only — no junction dance), set `DPF_WORKTREE_BOOTSTRAP=1` before seeding; the seed step then runs `scripts/lib/bootstrap-worktree-deps.mjs` fail-safe (BI-3047C122 — off by default so it never slows routine creation). To repair or rotate every linked worktree, run:
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

**Agent-bound `tools/list` ⇄ `tools/call` parity (BI-HDLEMP-04).** When a token is bound to an agent (the headless-employee shape: subject = employee `User`, actor = org `agentId`), `tools/call` runs the full coworker-authority gate, but `tools/list` used to filter on the token scope alone — so the list advertised tools the call layer would reject. `tools/list` (and the `load_tools` candidate set) now apply the gate's two **static** axes so the list tells the truth:

- **Agent grants.** A tool the acting agent's grants do not cover (`agent-grant-denied` at call) is dropped from the list, using the same `isToolAllowedByGrants` predicate the call path uses.
- **Clearance vs role — kept distinct.** *Role* rides on `User.groups → PlatformRole` (the capability/token-scope filter). *Clearance* rides on `Principal.sensitivityClearance` and is a **separate** axis: when the acting human's clearance does not cover the acting agent's data `sensitivity`, every agent-bound call is denied (`sensitivity-clearance-denied`), so the **entire** agent-bound governed surface is dropped from the list (only the `load_tools` meta-tool remains). An agent that cannot be resolved to an active identity is treated the same way (nothing callable). The comparison is uniform across tools because the data sensitivity is the agent's, not the tool's; the shared coercion (`coerceDataSensitivity`) fails closed to `restricted` for any unknown label.

Per-invocation gate axes (route-scope, subject-scope, approval/HITL) are **not** applied to the list — they depend on the call's arguments, and an approval-required tool is still listable because it is callable *after* approval. A **non-agent-bound** operator PAT is unaffected: with no agent there is no agent-grant or agent-sensitivity axis, and the direct-human capability + token-scope contract stands. Headless-employee tokens are agent-bound *by construction* at issuance (`issueEmployeeScopedMcpToken` refuses to mint without an `agentId`), so they always receive this full parity. The role the list resolves for a multi-group human matches the web session exactly (`resolveWorkforcePlatformRole` — first group with a non-null role), so the agent sees the surface the person would.

**Query-time row-scoping on list/search tools (BI-HDLEMP-05).** The `subject-scope-denied` gate scopes *id-addressed* employee tools (e.g. `transition_employee_status`) to the acting human's manager visibility (`canAccessEmployeeScope`), but a *list* tool has no id in its params, so `deriveCoworkerAuthoritySubject` resolves it to the `platform` subject and the gate never fires. `query_employees` therefore now applies a **query-time** `id IN (visible set)` filter, where the visible set is `employeeScopeVisibleIds` (`apps/web/lib/govern/manager-scope.ts`) — the row-level dual of `canAccessEmployeeScope`: **superuser → unrestricted**; everyone else → self ∪ direct ∪ indirect reports. The list returns exactly the rows the caller could open individually — never more. Scope is resolved from the acting human's `userId` via the same `resolveManagerScope` the effective-auth loader uses, so list-scope and record-scope cannot drift. Reference-data list tools (`list_departments`, `list_positions`) are not employee rows and stay unscoped; other-domain list tools (CRM, etc.) carry their own account-scope model.

**Context & token economy (mandatory).** Tool definitions, results, and prompts are a finite-budget resource; the binding window is the **~24,576-token local served window**, not a cloud window, and tool-selection accuracy collapses past ~15 tools (`LOCAL_FALLBACK_MAX_TOOLS`). When adding or changing a model-facing tool: keep its `description` **provenance-free** (no `Phase N`, `(BI-…)`, or source paths — those go in code comments; CI guard: `apps/web/lib/tool-description-hygiene.test.ts`), return **concise, paginated, capped** results (the runtime cap is `apps/web/lib/tak/tool-result-budget.ts`), and prefer **few, consolidated, phase/grant-scoped** tools over growing the 242-tool surface. Standard: [`docs/architecture/context-engineering-standards.md`](../architecture/context-engineering-standards.md). Live client capability facts (refreshed monthly): [`docs/architecture/agent-client-capability-parity.md`](../architecture/agent-client-capability-parity.md).

**Lean MCP surface (client-default):** `tools/list` defaults clients without a proven host-side lazy tool registry (Grok, a customer's generic MCP agent, or an unidentified caller) to a curated core tool set of ~29 broadly useful tools. **Claude Code and Codex bootstrap with `…/api/mcp/v1?tier=full`** because those hosts perform their own lazy search/attachment; “full” populates the authorized host registry and does not mean every definition is attached to the model. User-Agent recognition is only a compatibility fallback—current Codex Streamable HTTP requests omit it—so generated/bootstrap configuration is the correctness seam. This avoids depending on a mid-turn `list_changed` refresh that Codex does not currently perform. The core set still carries the governed live-delivery loop and WWMD kernel discovery for clients without host-side search. Capability, token-scope, and grant gates filter every tier.

**Asynchronous Task delivery:** for ordinary external task submissions, `/api/mcp/v1` commits the `TaskRun` plus its request/authentication snapshot, enqueues the deterministic worker, and returns the durable task handle immediately. An authenticated GET to the same Streamable HTTP endpoint opens SSE and first replays durable status snapshots before sending `notifications/tasks/status`. Treat that notification as a wake-up hint only: its payload is projected from committed task state, but clients still re-read with `tasks/get` and may use `tasks/list`; clients without notification support poll those methods. DPF does not accept caller-supplied webhook URLs, because redirect targets would create a new outbound trust and credential boundary. The default-on path can be disabled with `DPF_EXTERNAL_MCP_TASK_ASYNC=off` for rollback while preserving the prior synchronous execution contract.

POST and GET share the same bearer-token authentication resolver. A stream is token-scoped, notifications contain no bearer material, and authorization is re-established from persisted server-owned context when the background worker claims the task. Opening an SSE connection never grants execution authority, and losing it never changes task state. Duplicate queue delivery is fenced by the canonical `TaskRun` compare-and-set claim; reconciliation is bounded and auditable rather than a second executor.

**Progressive-disclosure recovery:** `load_tools` is always added to the MCP tool list after authorization filtering. When a DPF tool is not attached in the current model turn, call `load_tools` with either `{ "names": ["exact_tool_name"] }` or `{ "query": "the capability needed in natural language" }`. It can only select tools already permitted by the token/grant intersection and loads at most 16 at a time. A successful call appends matches to the per-token session; it never replaces the core floor. A client that receives `notifications/tools/list_changed` may refresh immediately, while every client can re-fetch `tools/list` after the result and use the loaded tool in the same bearer-token session.

Codex Desktop can retain a stale top-level model registry even after the server reports `listChanged: true`; `load_tools` does not force a mid-turn host refresh. DPF therefore writes `?tier=full` into Codex's bootstrap/config URL so its initial registry can search and attach a small task-relevant subset. Inspect `ALL_TOOLS` inside `functions.exec` and invoke a present governed call through `tools.mcp__dpf__<tool_name>(arguments)`. If a fresh task omits a granted non-core tool, first confirm the configured DPF URL contains `tier=full`, then re-run the agent-toolchain bootstrap and start a fresh task. Do not report `load_tools` success as callability and do not bypass MCP with raw JSON-RPC or direct DB access.

**Diagnosis order:**

1. Connection failure or timeout means the DPF MCP server is unavailable; check connector/runtime health. It is not a missing tool or plugin problem.
2. HTTP `401` means the bearer credential is absent, invalid or expired. **For an OAuth client this is self-healing and not a defect** — the challenge carries `resource_metadata`, so the client rediscovers, refreshes or re-authorizes on its own; if it does not, the client is not performing RFC 9728 discovery. For a legacy `dpfmcp_` PAT there is no refresh grant: rotate or reseed the local client configuration, and prefer migrating that client to OAuth. Never print the token.
2b. HTTP `403` with `error="insufficient_scope"` is **not** an auth failure — it is a step-up prompt. See the scope-escalation rule above.
3. Structured `insufficient_token_scope` / `insufficient_tool_grant` means the server is connected but authorization refused the operation. Stop; do not work around the grant intersection.
4. Structured `unknown_tool` means the called name is not in the server grant map. Follow its `recovery` payload: try exact-name `load_tools` when spelling is known, otherwise intent query or `search_tool_marketplace`, then re-list or use the host's programmatic catalog fallback.
5. MCP resources and MCP tools are different discovery surfaces. Listing resources cannot prove that a DPF tool is absent, and installing another plugin is not recovery for an already-connected DPF server.
6. A fresh Codex task with a healthy connector but only the core catalog usually means its configured URL lacks `?tier=full`; this is bootstrap drift, not missing authority. Re-run bootstrap and reconnect. Preserve `?tier=core` for generic-client diagnosis rather than widening every client.
7. Missing task-status notifications are not evidence that the task stopped. Reconnect GET/SSE and immediately call `tasks/get`; use bounded polling while the stream is unavailable. The durable task row is the source of truth, so a dead client can wake later without keeping an agent process alive.

**Client connection dropped mid-session (server healthy) — reconnect, do not rediagnose.** A distinct failure from diagnosis-order #1: the `mcp__dpf__*` tools were callable earlier in the session, then vanished mid-session with "MCP server disconnected", *while the endpoint still returns HTTP 200* to a `tools/list` POST. This is not a server outage, a token problem, or a missing tool — it is the client's HTTP transport being severed and not re-established.

- **Cause.** `dpf` is a remote HTTP transport (`.mcp.json` → `"type": "http"`). Anything that restarts the portal container mid-session kills the in-flight connection — most commonly a **portal self-upgrade** (the session's `gitSha` moves, e.g. `712d9f9bd → bddbc108488`). Claude Code auto-retries a dropped HTTP MCP connection a few times with exponential backoff and then marks the server **failed** for the rest of the session (per current Claude Code docs: up to 5 attempts over ~1–16s). A container restart normally outlasts that retry window, so the server stays failed and every `dpf` tool is silently stranded.
- **The model cannot self-heal this.** Reconnect is a user/harness-level operation; the Agent SDK exposes only server *status* (`mcpServerStatus()` / `get_mcp_status()`), not a reconnect call. Do **not** fall back to `psql`, Prisma scripts, or direct DB edits to route around a stranded `dpf` — that violates the MCP-is-the-coordination-plane contract. Reconnect the transport instead.
- **Minimal recovery (interactive session).** Run `/mcp`, select `dpf`, choose **reconnect** (current builds also accept `/mcp reconnect dpf`). This reuses the existing config — no token re-entry, no workspace-trust re-prompt. If reconnect still fails, restart the client. **Confirm with a read-only call** (e.g. `get_backlog_item`), not just the `/mcp` status line — a status of `connected` is structural; a successful tool call is functional.
- **Non-interactive sessions (headless / cron / SDK) cannot run `/mcp`.** There a dropped `dpf` server stays down for the life of the process, and **restarting the process is the only recovery**. Keep unattended runs short, or gate them on a health probe, so a self-upgrade mid-run does not silently strand every governed tool.
- **Startup advisory.** The `hooks/mcp-health` SessionStart hook (`scripts/hooks/mcp-health.{ps1,sh}`, wired in `.claude/settings.json`) probes this exact endpoint at every session start / resume / `clear` / `compact` and prints reachability plus the reconnect recipe above, so a strand is loud rather than silent. It probes the **endpoint only** — it cannot see the client's MCP attach state, so treat a healthy probe beside absent `dpf` tools as proof of a client-side drop. Silence with `DPF_SKIP_MCP_HEALTH=1`.
- **`localhost` caveat.** The client must target the `127.0.0.1` literal, not `localhost`. On hosts where `localhost` resolves to `::1` and IPv6 is not answering, the client cannot connect even though `127.0.0.1:3000` is healthy; anything that re-resolves `localhost` re-breaks it.

**Operator conformance probe:** after deploying a candidate, run `node scripts/mcp-progressive-disclosure-conformance.mjs --url <nonproduction-MCP-URL>` with `DPF_MCP_BEARER_TOKEN` present only in the environment. The probe never logs the credential. It validates Codex Desktop/CLI and Claude Code full-catalog defaults, the generic-client core default, initialize guidance, exact and intent loading, append-not-swap, notification-aware SSE, notification-blind re-list, same-session use, structured unknown recovery, and authentication-vs-disconnection classification. A protocol-profile pass is not live host acceptance: separately prove a fresh Codex task can find and call a non-core tool from its host registry.

**Code graph first (mandatory for code work).** Before broad text search or any symbol-level blast-radius claim, consult the committed code graph the way Build Studio agents already do: call `get_code_graph_freshness`, then `search_code_graph` / `trace_code_surface` to locate symbols, routes, Prisma models, MCP tools, and prompt sources, and confirm exact code with `read_project_file`; call `find_related_tests` for changed source files. **Do not assert symbol-level blast radius unless `trace_code_surface` returns structural edges.** `get_code_graph_freshness` reports index staleness and a dirty workspace; when the graph is stale or a result is empty, fall back to grep + file reads. **An empty code-graph result is NOT evidence of absence** — read the `trust` vector the read returns: a `low` tier or a `qualify` action means the graph could not answer, not that the substrate is missing (the `trust` vector ships in the code-graph read path; its originating backlog id predates a backlog reset and no longer resolves, so the behaviour is cited from source rather than from an anchor the coordination plane cannot see). This discipline is wired into the Build Studio agent prompts (`apps/web/lib/build/build-agent-prompts.ts`) — it applies identically to direct Claude Code / Codex / Grok sessions, which otherwise never learn the graph exists.

**Coworker lifecycle contract (mandatory for new AI coworkers).** A coworker's lifecycle is `draft → defined → certified → active`, and it is enforced, not conventional (EP-COWORKER-LIFECYCLE; spec: `docs/superpowers/specs/2026-07-07-coworker-lifecycle-standard-design.md`):

1. **Create only through the factory door** — the `establish_coworker` MCP tool (`action: "establish"`) creates the draft Agent row + grants + model floor + principal, and returns the definition checklist. Never create an Agent row by hand or in an ad-hoc seed; that recreates the multi-population drift this lifecycle closed. Draft coworkers are NOT summonable — the lifecycle gate (`apps/web/lib/coworker-lifecycle/lifecycle-gate.ts`) blocks them at chat, scheduled/autonomous dispatch, and summon/handoff.
2. **Complete the definition via PR** — roster entry, durable grants map, route binding + sensitivity mirror, model floor, profession family (the checklist the door returns). The coworker-definition conformance gate in the required Unit Tests job fails on any missing axis; do not extend its baseline for a new coworker.
3. **Earn certification** — the nightly golden-journey sweep (`ops/coworker-certification-nightly`; run-now event `ops/coworker-certification.requested`) exercises every roster coworker through the real execution path with evidence-based oracles; results surface on the workforce roster.
4. **Promote** — `establish_coworker` `action: "promote"` flips draft → production only when the definition landed AND a passing certification exists.

The paved-road walkthrough is the `dpf-establish-coworker` skill (`packages/dpf-skill-pack/skills/dpf-establish-coworker/SKILL.md`).


**Schema questions: `describe_committed_model`, no build required.** `describe_model` resolves the caller's active Build Studio build first and returns `"No active build."` to every external CLI session, so it cannot answer schema questions from Claude Code, Codex or Grok. Use `describe_committed_model({ model_name })` instead — it reads the committed Prisma schema (`packages/db/prisma/schema/*.prisma`, split across domain files; there is no monolithic `schema.prisma`) with the `file_read` grant a read-scoped token can hold. Every result names the tree it read — root, branch, HEAD sha — and carries a trust vector that scores an off-default branch down, so a stale checkout is visible rather than silent. A miss is reported as not-found **in the named tree**, and an unreadable schema directory is reported as a read failure, never as an absence.

## Protocol version window (mechanics landed; contract pending ratification)

The `/api/mcp/v1` transport's advertised protocol revisions are governed by one
constant module, `apps/web/lib/mcp/protocol-versions.ts`: the N/N-1 `MCP_VERSION_WINDOW`
(current + one previous) plus the explicitly-listed grandfathered set
(`2025-03-26`, `2024-11-05`), which may only shrink. The CI guard
`scripts/check-no-adhoc-mcp-protocol-versions.mjs` refuses ad-hoc revision literals on
the transport and any growth of the grandfathered set. The version-window CONTRACT
itself — including retiring the grandfathered revisions — is operator-ratified; the
decision brief is
[`docs/superpowers/specs/2026-08-16-mcp-version-window-contract-brief.md`](../superpowers/specs/2026-08-16-mcp-version-window-contract-brief.md).
No revision has been retired under this section yet.

## Terminal-readiness recovery packets

An `initiative_not_ready` result from BacklogItem or Workroom completion may
include `data.recovery`. The server issues every reviewer route from the exact
live Workroom, current objective baseline, immutable branch head, canonical
source path, provider blob, writer tool, and grant. Dispatch the returned
`requestCoworker` packet unchanged; callers must not choose a different writer,
reviewer, baseline, artifact, or gate.

`objective-mapping` is an evidence proposal for terminal evaluation, not an
initiative approval receipt. The acceptance reviewer records it through
`record_initiative_evidence`, and the canonical terminal repository alone
decides whether the evidence satisfies completion. Missing or ambiguous
Workroom, baseline, source, or eligible writer returns a typed escalation and
no reviewer route.

## When a Workroom scope claim needs a person

`claim_workroom_scope` declares an `authority` consequence, because a forced
claim can take work from another session. One call may narrow that
declaration to ordinary (BI-2D65BD1B). The rule lives in
`apps/web/lib/work-capsules/scope-claim-lease.ts`, and both the authority gate
and the store read it:

| Call | Outcome |
|---|---|
| Claim on your own room: you hold its lease, or the lease is empty or lapsed | Ordinary. An OAuth assistant runs under its human's connection consent. |
| `force: true` | A person approves. |
| Another principal holds the room's live lease | A person approves a forced claim. Without force the store refuses with `lease_held`. |
| Unknown, archived or finished room | Gated, and the store refuses it. |

A per-call refiner (`ToolDefinition.consequenceForCall`) may only narrow. Any
answer other than `null` keeps the declaration, and so does a refiner error.
The decision log records `consequenceRefinement: {declared, reason}` on every
narrowed call.

## Acting-coworker binding — what lets a token join a Work Room

A bearer token carries two separate things: **grants** (what tools it may call)
and an **acting coworker** (who it is). Grants alone are not enough for a Work
Room. Every room handler resolves its caller from `context.agentId`, which the
MCP route reads off the token:

```ts
// apps/web/app/api/mcp/v1/route.ts
agentId: token.agentId ?? undefined,
```

Without it, `post_room_message`, `read_room_messages` and
`invite_room_participant` all refuse with `invalid_caller` — *"requires an
acting coworker"* — no matter how many grants the token holds.

**Bind the identity when you issue the token.** The Admin > Platform
Development > MCP form has an **Acts as coworker** control. It defaults to
*None — cannot join Work Rooms*, and lists only coworkers holding
`work_room_write`, since acting-as is meaningless for an identity that cannot
act in a room. External CLI surfaces have registry identities for exactly this:
`AGT-EXT-CLAUDE`, `AGT-EXT-CODEX`, `AGT-EXT-GROK`.

**Binding grants identity, never admission.** A bound token is *someone*; it is
not thereby *in* any room. Admission stays outcome-scoped per room and
invite-driven through `authorizeWorkRoomAccess` — a coworker cleared for an HR
room is not cleared for a finance room. This is the least-privilege half of the
[multi-agent communication substrate design](../superpowers/specs/2026-08-12-work-room-multi-agent-communication-substrate-design.md) §1.

**Rotation preserves the binding.** Rotating a token changes the secret, not the
identity. Earlier rotation code hardcoded `agentId: null`, so a
room-capable token silently became anonymous and its coworker dropped out of
every room it had joined — with no error on any surface.

### Diagnosing "requires an acting coworker"

```sql
SELECT id, name, scope, "agentId" FROM "McpApiToken" WHERE "revokedAt" IS NULL;
```

`agentId` NULL on the row your client is using is the whole diagnosis. Re-issue
(or rotate) the token with an acting coworker selected. If the dropdown is
empty, no active agent in the registry holds `work_room_write`.

### Diagnosing an empty `load_tools` result

An empty exact-name discovery result now includes a structured `noMatch.reason`.
`unknown-tool-name` means the name is not in the platform registry;
`not-granted` means the known tool is unavailable to the current token; and
`reviewer-route-required` means an initiative review writer must be reached via
`get_backlog_item` and its server-issued `reviewerRoutes` packet. Do not grant or
invoke a reviewer writer directly to work around that boundary.
