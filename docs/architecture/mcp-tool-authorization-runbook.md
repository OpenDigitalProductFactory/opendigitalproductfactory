# MCP tool authorization runbook

**Status:** procedure reference. The *rules* — the authorization principle, scope escalation, and grant enforcement — live in [`AGENTS.md`](../../AGENTS.md) §8/§8a and stay always-on. This file holds transport detail, token issuance and rotation, worktree MCP sync, and the grant-intersection mechanics. Relocated from §8 by BI-0020D511 Phase 1; no rule was dropped.

External coding agents use the real MCP JSON-RPC 2.0 transport at `/api/mcp/v1` (`apps/web/app/api/mcp/v1/route.ts`). The older `/api/mcp/tools` and `/api/mcp/call` endpoints remain for in-portal coworker chat and are not the external MCP client contract.

Authorized product surfaces use the six generic `surface_*` MCP tools rather than page-specific side doors. `surface_open` compiles a principal-bound session; every later read or action revalidates the human role, coworker grants, work context, token scope, approval policy, revision, and TTL. Persistent actions re-enter `governedExecuteTool`, so the surface contract never bypasses the authorization path described here.

**How a client authenticates: one authorization server, two grant types.** A client points at `/api/mcp/v1`, gets a `401` whose `WWW-Authenticate` carries `resource_metadata=`, discovers the authorization server from `/.well-known/oauth-protected-resource/api/mcp/v1`, and runs the OAuth 2.1 authorization-code flow with PKCE-S256. A browser opens, the operator approves a named client and a named scope set once, and the client refreshes silently from then on. **No environment variable, no copy-paste, no client restart.** Headless callers with no browser — CI, cron, containers — use the `client_credentials` grant against the same authorization server, with an operator-issued client from Admin > Platform Development. Design: [`docs/superpowers/specs/2026-08-26-mcp-client-self-authentication-design.md`](../superpowers/specs/2026-08-26-mcp-client-self-authentication-design.md).

**Public scopes.** Clients request six public scopes — `dpf.read`, `dpf.work`, `dpf.build`, `dpf.business`, `dpf.operate`, `dpf.admin` — not the 86 internal grant names. `apps/web/lib/mcp/oauth-scope-map.ts` owns the mapping and a totality test fails CI when a new internal grant is added without one. Only `dpf.read` is advertised in `scopes_supported`, so a client that requests everything advertised gets read access; everything above it arrives through step-up (see the scope-escalation rule below).

**MCP bearer tokens (`dpfmcp_...`) are the legacy path, on a deprecation horizon.** They are issued from Admin > Platform Development > MCP and still resolve; issuance closes when `DPF_MCP_PAT_ISSUANCE_CLOSED=1` and resolution ends at the operator's horizon (`DPF_MCP_PAT_RESOLUTION_DISABLED=1`). Treat `.mcp.json` and `.vscode/mcp.json` as local credential files only; they are ignored by git and must never be committed. An OAuth client stores its own tokens and needs neither file for credentials.

**Endpoint trust for config-resolved tokens:** a `.mcp.json` file is ambient state. It is copied between worktrees, it survives a machine move, and anything with the checkout can write it. A gate script that reads a token out of it therefore checks the endpoint it names before putting that token on the wire: `isAllowedMcpEndpoint` in `scripts/lib/mcp-client.mjs` accepts only `127.0.0.1`, `localhost` and `[::1]` over HTTP or HTTPS. A file naming any other host is a stop, not a fall back to the default endpoint, because sending a live `dpfmcp_...` credential to an unintended host discloses it. To reach a portal that is not on loopback, set `DPF_MCP_BEARER_TOKEN` and `DPF_MCP_URL`: those are stated operator intent and are not narrowed.

**MCP token scopes:** tokens have a coarse `scope` of `read`, `write`, or `admin` plus granular per-tool grants. Default tokens are `read` and cannot call side-effecting tools even if an old token row carries a write grant. Use **Issue write token** in Admin > Platform Development > MCP when an agent must create or update Workrooms, backlog items, Build Studio evidence, runtime coordination records, or other side-effecting MCP records. The portal shows the plaintext token once, writes the local client snippet, and supports revocation without editing config files.

**Scope escalation rule — two shapes, depending on how you authenticated.**

*OAuth caller (step-up, the paved road).* A scope refusal is an HTTP **403** with `WWW-Authenticate: Bearer error="insufficient_scope", scope="<granted> <required>", resource_metadata="..."`. That is a **flow, not a halt**: re-authorize for the named scope set, the operator approves exactly the additional authority on a consent screen, and retry the original call. Retry a bounded number of times and then treat it as a permanent failure — do not loop.

*PAT caller (unchanged contract).* If `/api/mcp/v1` returns an MCP tool result with `structuredContent.error = "insufficient_token_scope"` and `requiredScope` such as `"write"`, stop the MCP workflow and surface the required scope to the operator. Do not fall back to `psql`, Prisma scripts, direct DB edits, or hidden runtime patches to bypass the MCP scope gate. The correct action is to issue a scoped token in the portal, update the client token using the displayed setup command/snippet, call `/api/mcp/token/refresh` with the new token, and retry through MCP.

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
