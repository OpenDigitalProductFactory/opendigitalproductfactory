# Platform MCP Tool Server Implementation Plan

> **For agentic workers:** REQUIRED: Use `superpowers:subagent-driven-development` (if subagents are available) or `superpowers:executing-plans` to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Claude CLI text-only tool prompt shim with a real MCP server surface for platform tools, so MCP-capable CLI adapters can discover and invoke platform tools directly while preserving platform auth, tool grants, build-phase filtering, approval flows, and audit logging.

**Architecture:** Extend the existing platform MCP surface from a simple authenticated REST listing endpoint into a JSON-RPC MCP server route, add short-lived signed session tokens for CLI-launched internal access, update the Claude CLI adapter to mount the server via `--mcp-config`, and teach the agentic loop to treat CLI adapters with native MCP tool execution as single-pass responders instead of re-running platform tool loops locally.

**Tech Stack:** Next.js App Router route handlers, TypeScript, Auth.js session context, `jose` JWT signing/verification, existing `getAvailableTools()` / `executeTool()` platform tool registry, Claude CLI sandbox runner, Vitest, and existing Docker internal networking (`portal` service).

---

## 1. Current State Check

### Live backlog state

Checked the live PostgreSQL database, not seed data.

- `Epic` rows: `0`
- relevant MCP/CLI/tool backlog items: `0`

That means there is no live epic to anchor this work to right now. If implementation begins immediately, create or update a live epic first so progress is tracked in the actual backlog.

### Dirty worktree warning

The repository already has many unrelated modified and untracked files, including MCP- and routing-adjacent paths such as:

- `apps/web/lib/routing/cli-adapter.ts`
- `apps/web/lib/routing/cli-adapter.test.ts`
- `apps/web/lib/mcp-tools.ts`
- `packages/db/src/seed.ts`
- `docker-compose.yml`
- multiple uncommitted route/admin/prompt files

Do not revert or normalize this worktree. Make the implementation on top of the current state and isolate edits to the files listed in this plan.

---

## 2. Spec Evaluation Summary

The spec is directionally right and matches a real product gap: the current Claude CLI adapter still injects platform tools as plain text into the system prompt, so Claude CLI cannot actually call them. That blocks Build Studio and other routed CLI use cases from using platform tools when the execution adapter is `claude-cli`.

The main implementation adjustment is that the repo already contains partial MCP infrastructure and a few assumptions in the spec do not match the current code.

### What already exists

- [`apps/web/app/api/mcp/tools/route.ts`](d:\DPF\apps\web\app\api\mcp\tools\route.ts) already exists, but only returns a cookie-authenticated REST tool list.
- [`apps/web/app/api/mcp/call/route.ts`](d:\DPF\apps\web\app\api\mcp\call\route.ts) already exists as a simple REST tool execution route.
- [`apps/web/lib/mcp-tools.ts`](d:\DPF\apps\web\lib\mcp-tools.ts) already centralizes tool exposure and execution.
- [`apps/web/lib/tak/mcp-server-tools.ts`](d:\DPF\apps\web\lib\tak\mcp-server-tools.ts) already handles the opposite direction: external MCP servers exposed as platform tools.
- [`apps/web/lib/routing/cli-adapter.ts`](d:\DPF\apps\web\lib\routing\cli-adapter.ts) already has the Claude CLI adapter and already contains a dormant stream parser.
- [`docs/superpowers/specs/2026-03-14-agent-execution-design.md`](d:\DPF\docs\superpowers\specs\2026-03-14-agent-execution-design.md) explicitly deferred full MCP JSON-RPC support until external MCP clients became a priority. This spec is the natural follow-up.

### Required corrections to the spec before implementation

1. **`/api/mcp/tools` is not a new route**
   - It already exists and must be upgraded or made dual-mode.
   - Decide whether to preserve the current REST behavior for any in-repo callers or fully migrate callers to JSON-RPC.

2. **Audit logging is not inside `executeTool()`**
   - The spec assumes `ToolExecution` records happen automatically when `executeTool()` is called.
   - In reality, audit insertion currently lives in [`agentic-loop.ts`](d:\DPF\apps\web\lib\tak\agentic-loop.ts), after execution.
   - MCP tool calls must add audit logging explicitly, or both code paths should share a new `recordToolExecution()` helper.

3. **`getAvailableTools()` does not yet handle all route/build filters described**
   - It already handles role/capability filtering, agent grants, and external MCP tools.
   - It does **not** currently take `buildPhase` or route-domain tool subsets directly.
   - Either extend `getAvailableTools()` or apply a second filter layer in the route.

4. **The spec references `result.adapterType`, but that field does not exist**
   - `AdapterResult`, `FallbackResult`, and `RoutedInferenceResult` do not carry adapter identity today.
   - The loop-short-circuit behavior for CLI-native MCP execution needs a real propagated field or a reliable equivalent derived from the route decision.

5. **The example MCP URL using `localhost` is wrong for the sandbox**
   - From the sandbox, `localhost` is the sandbox container, not the `portal` container.
   - Use an internal URL such as `http://portal:3000/api/mcp/tools`, ideally via a dedicated environment variable.

6. **The proposed token payload is incomplete**
   - The spec's token example only shows `userId`, `agentId`, `routeContext`, and `threadId`.
   - `tools/list` filtering also needs either:
     - embedded `platformRole` / `isSuperuser`, or
     - a DB/session lookup during token verification.

7. **Proposal tools need a reusable approval path**
   - The spec says proposal tools should return `approval_required` and persist a proposal.
   - The current proposal flow is coupled to the agent loop and UI conversation handling.
   - Extract or add a route-safe proposal creator instead of hand-waving this step.

8. **"Internal Docker network only" is not the real security boundary**
   - The Next app is served from the `portal` container and may be reachable through host port exposure.
   - The real protection is the signed short-lived token and route-side authorization checks.
   - Network placement is defense in depth, not the primary security guarantee.

9. **Seeding the platform as an MCP server has implications**
   - If the platform registers itself in `McpServer`, health checks and tool discovery may run without a per-user session token.
   - Make `initialize` safe without session auth, and ensure any registry-side health checks do not require `tools/list`.

### Recommendation

Proceed with implementation, but treat the current spec as a strong design direction rather than a copy-paste build script. The implementation should be based on the existing MCP/tooling codepaths and should extract shared helpers where the current spec assumes behavior that the codebase does not actually provide yet.

---

## 3. Target Design Decisions

These decisions close the biggest gaps between the spec and the current repo.

### A. Route compatibility strategy

Use a dual-mode transition:

- keep [`/api/mcp/tools`](d:\DPF\apps\web\app\api\mcp\tools\route.ts) as the canonical endpoint
- accept JSON-RPC MCP requests there
- optionally preserve the existing simple REST `POST` response shape during the transition if anything still depends on it
- leave [`/api/mcp/call`](d:\DPF\apps\web\app\api\mcp\call\route.ts) in place until all direct callers are verified, then deprecate it

This avoids breaking any untracked in-flight work that may still hit the old endpoints.

### B. Session token strategy

Create a dedicated helper in [`apps/web/lib/mcp/session-token.ts`](d:\DPF\apps\web\lib\mcp\session-token.ts) using `jose` and `NEXTAUTH_SECRET`.

Required claims:

- `userId`
- `platformRole`
- `isSuperuser`
- `agentId` (optional)
- `threadId` (optional)
- `routeContext` (optional)
- `buildPhase` (optional)
- `domainTools` (optional array)
- `mode` (optional: `advise` or `act`)

Token lifetime:

- 5 minutes max
- reject expired or malformed tokens with `401`

### C. Tool filtering strategy

Use [`getAvailableTools()`](d:\DPF\apps\web\lib\mcp-tools.ts) for base filtering, then apply a second route-specific filter layer for:

- build phase restrictions
- route/domain tool subsets
- proposal/immediate execution mode shaping

If this route-side layer proves stable, fold those arguments back into `getAvailableTools()` in a second pass.

### D. Tool execution audit strategy

Extract a shared helper, for example:

- [`apps/web/lib/tak/tool-execution-audit.ts`](d:\DPF\apps\web\lib\tak\tool-execution-audit.ts)

Both:

- [`agentic-loop.ts`](d:\DPF\apps\web\lib\tak\agentic-loop.ts)
- MCP `tools/call` handling

should call the same helper after every execution or proposal creation attempt.

### E. CLI adapter behavior

The Claude CLI adapter should:

- stop serializing tool descriptions into prompt text
- generate an MCP config file in the sandbox
- pass `--mcp-config <path>`
- use `--output-format stream-json`
- parse the streamed assistant events into final text and usage
- return metadata that tells the caller the adapter executed in native-MCP mode

### F. Agentic loop behavior

When routed inference uses a CLI adapter with native MCP enabled, the platform loop should not re-run a local tool loop over assistant output. The loop should treat the adapter response as already tool-resolved unless the adapter explicitly returns unresolved platform tool calls.

---

## 4. File-Level Implementation Plan

## Phase 1 - Add session-token infrastructure

- [ ] Create [`apps/web/lib/mcp/session-token.ts`](d:\DPF\apps\web\lib\mcp\session-token.ts)
  - export `createMcpSessionToken(payload)`
  - export `verifyMcpSessionToken(token)`
  - use `jose` `SignJWT` and `jwtVerify`
  - read signing secret from `NEXTAUTH_SECRET`
  - enforce `aud` / `iss` values specific to MCP internal sessions if practical

- [ ] Add tests for the token helper
  - create [`apps/web/lib/mcp/session-token.test.ts`](d:\DPF\apps\web\lib\mcp\session-token.test.ts)
  - verify round-trip payload
  - verify expiration rejection
  - verify tamper rejection
  - verify missing-secret failure behavior

### Notes

- Prefer a dedicated helper over reusing [`apps/web/lib/api/jwt.ts`](d:\DPF\apps\web\lib\api\jwt.ts), because the API token helper is solving a different lifecycle and persistence problem.

## Phase 2 - Upgrade `/api/mcp/tools` into a JSON-RPC MCP route

- [ ] Replace or extend [`apps/web/app/api/mcp/tools/route.ts`](d:\DPF\apps\web\app\api\mcp\tools\route.ts)
  - accept MCP JSON-RPC requests
  - support:
    - `initialize`
    - `notifications/initialized`
    - `tools/list`
    - `tools/call`
  - return MCP-compliant JSON-RPC envelopes

- [ ] Decide auth rules per method
  - `initialize`: allow without session token
  - `notifications/initialized`: allow without token or no-op
  - `tools/list`: require `X-MCP-Session`
  - `tools/call`: require `X-MCP-Session`

- [ ] Add route-local helpers
  - `parseJsonRpcRequest`
  - `jsonRpcResult`
  - `jsonRpcError`
  - `getMcpSessionFromHeaders`
  - `filterToolsForMcpSession`

- [ ] Shape `tools/list` output from `PlatformToolDefinition`
  - `name`
  - `description`
  - `inputSchema`

- [ ] Implement `tools/call`
  - validate tool name
  - validate user capability and grants via shared tool lookup
  - for immediate tools:
    - call `executeTool(toolName, args, userId, context)`
    - record audit log
    - return structured MCP content
  - for proposal tools:
    - create proposal record through shared helper
    - record audit log
    - return structured approval-needed content

- [ ] Add tests in [`apps/web/app/api/mcp/tools/route.test.ts`](d:\DPF\apps\web\app\api\mcp\tools\route.test.ts)
  - initialize success
  - tools/list with valid token
  - tools/list with expired token -> `401`
  - tools/call immediate tool success
  - tools/call unknown tool -> JSON-RPC error
  - tools/call unauthorized tool -> JSON-RPC error
  - tools/call proposal tool -> approval-required response

### Notes

- If anything still depends on the existing REST shape from this route, keep a compatibility branch for non-JSON-RPC payloads until callers are migrated.
- Do not remove [`/api/mcp/call`](d:\DPF\apps\web\app\api\mcp\call\route.ts) in the same commit unless every caller is confirmed.

## Phase 3 - Extract shared tool execution audit logging

- [ ] Create a shared helper, likely [`apps/web/lib/tak/tool-execution-audit.ts`](d:\DPF\apps\web\lib\tak\tool-execution-audit.ts)
  - input should cover:
    - `agentId`
    - `userId`
    - `toolName`
    - `parameters`
    - `result`
    - `success`
    - `executionMode`
    - `routeContext`
    - `durationMs`
  - keep fire-and-forget semantics only if existing callers already rely on it and tests remain stable

- [ ] Refactor [`apps/web/lib/tak/agentic-loop.ts`](d:\DPF\apps\web\lib\tak\agentic-loop.ts) to use the helper

- [ ] Call the same helper from MCP `tools/call`

- [ ] Add focused tests if there is an existing test home for agentic loop tool execution audit behavior

### Notes

- This is the cleanest way to align the implementation with the spec's audit guarantee without lying about what `executeTool()` currently does.

## Phase 4 - Add route/build-phase filtering for MCP exposure

- [ ] Review current route/build filtering logic
  - [`apps/web/lib/actions/agent-coworker.ts`](d:\DPF\apps\web\lib\actions\agent-coworker.ts)
  - [`apps/web/lib/mcp-tools.ts`](d:\DPF\apps\web\lib\mcp-tools.ts)

- [ ] Implement one of these approaches:
  - preferred first pass: route-local post-filtering after `getAvailableTools()`
  - optional second pass: extend `getAvailableTools()` with `buildPhase` and `domainTools`

- [ ] Verify `save_phase_handoff` and other phase-specific tools behave the same in the MCP path as in the in-process path

### Notes

- Keep filtering behavior functionally identical to the existing Build Studio / coworker path before trying to "simplify" anything.

## Phase 5 - Update Claude CLI adapter to use native MCP

- [ ] Modify [`apps/web/lib/routing/cli-adapter.ts`](d:\DPF\apps\web\lib\routing\cli-adapter.ts)
  - generate a short-lived MCP session token before sandbox execution
  - write an MCP config file into the sandbox workspace
  - use internal portal URL, not localhost
  - pass `--mcp-config`
  - switch to `--output-format stream-json`
  - remove tool-description prompt injection

- [ ] Reuse or finish the existing stream parser in the file
  - parse assistant text deltas
  - capture final text
  - capture usage if present
  - tolerate non-tool invocations and partial event noise

- [ ] Return adapter metadata indicating native MCP mode
  - either add `adapterType`
  - or another explicit field consumed by the loop short-circuit

- [ ] Update [`apps/web/lib/routing/cli-adapter.test.ts`](d:\DPF\apps\web\lib\routing\cli-adapter.test.ts)
  - assert no plain-text tool injection
  - assert MCP config is created
  - assert `--mcp-config` is passed
  - assert `stream-json` is passed
  - assert stream output parsing still returns final assistant text

### Notes

- Introduce an env var for the internal endpoint if one does not already exist, such as `DPF_PORTAL_INTERNAL_URL` or `MCP_PLATFORM_SERVER_URL`.
- Defaulting to `http://portal:3000` is acceptable inside Docker, but make the dependency explicit.

## Phase 6 - Teach routed inference and the agentic loop about adapter identity

- [ ] Decide the propagation path
  - add `adapterType?: string` to:
    - [`apps/web/lib/routing/adapter-types.ts`](d:\DPF\apps\web\lib\routing\adapter-types.ts)
    - fallback result types
    - routed inference result types
  - or attach an explicit `nativeToolExecution` boolean derived from the execution plan

- [ ] Update the provider fallback/routing chain so the final result carries this metadata

- [ ] Modify [`apps/web/lib/tak/agentic-loop.ts`](d:\DPF\apps\web\lib\tak\agentic-loop.ts)
  - if response came from CLI native MCP mode, do not re-run local platform tool execution over the assistant output
  - preserve existing loop behavior for direct providers and non-MCP adapters

- [ ] Add or update tests around the loop behavior
  - native-MCP CLI response does not trigger duplicate platform tool execution
  - direct providers still use the existing local loop

### Notes

- This is the most likely place for accidental double-execution bugs, so test coverage here matters more than cleverness.

## Phase 7 - Proposal flow extraction

- [ ] Identify the current proposal creation path in the agent loop / action approval flow

- [ ] Extract a shared helper that can be called from both:
  - the current agent loop path
  - MCP `tools/call`

- [ ] Return a stable MCP response shape for approval-needed outcomes

Suggested shape:

```json
{
  "content": [
    {
      "type": "text",
      "text": "Approval required before executing create_invoice."
    }
  ],
  "approval_required": true,
  "proposalId": "..."
}
```

- [ ] Ensure audit logging also captures proposal attempts

### Notes

- If proposal extraction grows too large, phase it:
  - Phase 7a: immediate tools only
  - Phase 7b: proposal tools

But do not claim the full spec is done until proposal tools work.

## Phase 8 - Seed self-registration carefully

- [ ] Review [`packages/db/src/seed.ts`](d:\DPF\packages\db\src\seed.ts) `seedMcpServers()` behavior

- [ ] Add the internal platform MCP server registration only if it will not break health/discovery
  - name: `mcp-dpf-platform`
  - url: internal portal MCP route

- [ ] Verify health behavior
  - `initialize` should succeed without user token
  - any tool-list discovery path that expects auth should fail gracefully and not mark the server permanently unhealthy for the wrong reason

### Notes

- If the server catalog cannot represent a per-user authenticated tool server cleanly, defer the seed registration to a follow-up and ship the CLI adapter integration first. The adapter does not need the DB seed entry to work.

## Phase 9 - QA plan and regression coverage

- [ ] Update [`tests/e2e/platform-qa-plan.md`](d:\DPF\tests\e2e\platform-qa-plan.md)
  - add at least one coworker/build-flow test that verifies platform tools work through the CLI adapter path
  - add an incomplete-information case where the adapter does not guess missing required tool fields

- [ ] Run affected unit tests with Vitest
  - session token tests
  - MCP route tests
  - CLI adapter tests
  - any updated agentic loop tests

- [ ] Run production build gate
  - `cd apps/web && npx next build`

- [ ] If any migration or seed behavior changed materially, verify the affected DB workflow still applies cleanly

---

## 5. Suggested Commit Sequence

Keep commits small and reversible on `main`.

1. `Add MCP session token helper and tests`
2. `Upgrade platform MCP route to JSON-RPC tool list/call flow`
3. `Share tool execution audit logging across loop and MCP route`
4. `Switch Claude CLI adapter to native MCP config`
5. `Prevent duplicate tool loops for native-MCP CLI adapters`
6. `Add proposal flow support and QA coverage`

If self-registration in `seed.ts` is risky or blocked by discovery semantics, commit it separately or defer it.

---

## 6. Risks and Mitigations

### Risk: duplicate tool execution

If the platform loop keeps executing tool calls after Claude CLI already executed them through MCP, side effects could happen twice.

**Mitigation:** propagate explicit adapter/native-MCP metadata and add loop tests before shipping.

### Risk: auth mismatch between sandbox and portal

If the adapter writes `localhost` into the MCP config, the sandbox will target itself instead of the portal.

**Mitigation:** require an explicit internal URL and test the generated config.

### Risk: proposal tools work in-process but not via MCP

The existing approval flow is likely coupled to conversation state.

**Mitigation:** extract proposal creation into a helper and land that before claiming full parity.

### Risk: seed registration creates noisy health failures

Self-registering a per-user-authenticated MCP endpoint in the generic server catalog can produce misleading health checks.

**Mitigation:** treat seed registration as optional follow-up unless initialize-only health is enough.

### Risk: breaking existing internal callers of `/api/mcp/tools`

The route already exists and may have in-flight consumers not visible in committed code.

**Mitigation:** support compatibility mode briefly or verify all callers before removing the old shape.

---

## 7. Open Questions To Resolve During Implementation

- Does any committed or untracked code still call the old REST shape of [`/api/mcp/tools`](d:\DPF\apps\web\app\api\mcp\tools\route.ts)?
- Is there already a reusable proposal-creation helper hidden in the action approval flow, or does it need to be extracted fresh?
- Should build-phase/domain filtering live permanently in [`getAvailableTools()`](d:\DPF\apps\web\lib\mcp-tools.ts), or remain an MCP/session-specific wrapper concern?
- Should the adapter propagate `adapterType`, or is `nativeToolExecution: true` the simpler contract?
- Is self-registration in `seed.ts` actually needed for the first release, or is direct adapter-mounted MCP enough?

---

## 8. Definition of Done

This work is done when all of the following are true:

- Claude CLI adapters stop receiving platform tools as prompt text and instead mount the platform via MCP config.
- The platform exposes a working JSON-RPC MCP endpoint at [`/api/mcp/tools`](d:\DPF\apps\web\app\api\mcp\tools\route.ts).
- `tools/list` and `tools/call` enforce signed short-lived session auth.
- Platform tool filtering still respects role capability, agent grants, and applicable build/route restrictions.
- Immediate tools execute through MCP and create `ToolExecution` audit records.
- Proposal tools return approval-needed results and persist proposals.
- The agentic loop does not double-execute tools after native-MCP CLI calls.
- Affected Vitest coverage passes.
- `cd apps/web && npx next build` passes cleanly.

---

## 9. Recommended First Implementation Slice

If you want the safest delivery order, start with this thin vertical slice:

1. session-token helper
2. JSON-RPC `initialize` + `tools/list`
3. CLI adapter MCP config wiring
4. native-MCP loop short-circuit
5. immediate `tools/call`
6. proposal `tools/call`
7. optional seed self-registration

That gets real end-to-end value quickly while leaving the trickiest approval-path integration until the basic MCP transport is proven.
