# Plan — Governed MCP Backlog Surface

| Field | Value |
| ----- | ----- |
| **Spec** | [2026-04-25-governed-mcp-backlog-surface-design.md](../specs/2026-04-25-governed-mcp-backlog-surface-design.md) |
| **Branch** | `feat/mcp-backlog-surface` (one branch per the AGENTS.md PR workflow) |
| **Estimated PRs** | 1 — single coherent surface, ships together |
| **Dependencies** | None blocking. Aligns with but does not require the [Platform MCP Tool Server](../specs/2026-04-11-platform-mcp-tool-server-design.md) JSON-RPC implementation. |

---

## 0. Pre-flight

- Confirm working directory is the per-session worktree, not `d:\DPF` directly (per [feedback memory](../../../C:/Users/Mark%20Bodman/.claude/projects/d--DPF/memory/feedback_worktree_per_session.md)). For this implementation, since no concurrent session is active, working in `d:\DPF` on a feature branch is acceptable.
- `git checkout -b feat/mcp-backlog-surface` from `main`. **Do not commit on `main`** (AGENTS.md core rule).
- Confirm pre-commit hook: `git config core.hooksPath` returns `.githooks`.

## 1. Schema migration — `BacklogItemActivity`

File: new migration `packages/db/prisma/migrations/<timestamp>_backlog_item_activity/migration.sql`.

Steps:

1. Add the model to [packages/db/prisma/schema.prisma](../../../packages/db/prisma/schema.prisma) per spec §4.5. Also add the inverse relation `activities BacklogItemActivity[]` to `BacklogItem`.
2. `pnpm --filter @dpf/db exec prisma migrate dev --name backlog_item_activity` to generate the DDL. **Do not** use `npx prisma` (CLAUDE.md).
3. The migration is purely additive (new table + indexes); no backfill SQL is needed.
4. Verify the migration applies cleanly against the live dev DB.

## 2. Data normalization — one-time `BacklogItem.type` cleanup

The DB scan found `type = "feature"` rows. Add a separate data-only migration `<timestamp>_normalize_backlogitem_type` that runs:

```sql
UPDATE "BacklogItem" SET "type" = 'product' WHERE "type" = 'feature';
```

This migration must commit **before** the type-narrowed tool definitions land, so the new tool schemas are consistent with the data. Per AGENTS.md schema rules, the SQL is inline in the migration file.

## 3. New module: `apps/web/lib/backlog/transitions.ts`

Pure-function module exporting:

```ts
export const BACKLOG_STATUSES = ["triaging", "open", "in-progress", "done", "deferred"] as const;
export type BacklogStatus = (typeof BACKLOG_STATUSES)[number];

export function isLegalTransition(from: BacklogStatus, to: BacklogStatus): boolean;
export function requiresAdminGrant(from: BacklogStatus, to: BacklogStatus): boolean; // done -> *
```

Tests in `transitions.test.ts` cover every legal pair from the spec table and a sampling of illegal pairs.

## 4. New module: `apps/web/lib/backlog/recommend.ts`

Pure-function ranking module per spec §3.9. Inputs:

```ts
type Candidate = {
  itemId: string;
  title: string;
  status: string;
  priority: number | null;
  effortSize: string | null;
  triageOutcome: string | null;
  hasActiveBuild: boolean;
  claimedById: string | null;
  claimedByAgentId: string | null;
  epicId: string | null;
  epicStatus: string | null;
  hasSpec: boolean;
  hasPlan: boolean;
  updatedAt: Date;
};

export function rankCandidates(items: Candidate[], opts: { excludeItemIds?: string[]; forAgentId?: string }): RankedCandidate[];
```

The DB query that produces `Candidate[]` lives in the tool handler (§5), not here. This module is just the ranking math, so it is trivially unit-testable with fixtures.

## 5. New module: `apps/web/lib/backlog/spec-plan-search.ts`

Pure file-system reader exporting:

```ts
export async function searchSpecsAndPlans(opts: {
  query: string;
  kind?: "spec" | "plan";
  matches?: number;
  itemId?: string;
  epicId?: string;
}): Promise<SpecPlanResult[]>;
```

Implementation:

- Read `docs/superpowers/specs/*.md` and `docs/superpowers/plans/*.md` from disk via `fs/promises.readdir` + `readFile`. Repo root resolved via `process.cwd()` — the portal runs from the repo root in dev and from `/app` in Docker, both of which contain `docs/superpowers/`.
- For each file: extract title (frontmatter `title:` if present, else first H1 heading, else filename), date (filename prefix `YYYY-MM-DD` if present), and the body.
- Match: case-insensitive substring on title and body. If `itemId` or `epicId` is supplied, also match on those (literal).
- Snippet: 240 chars centered on first match, with `...` ellipses.
- Reference extraction: regex `/\b(BI|EP)-[A-Z0-9-]+\b/g` over the body.
- Cache by file mtime — re-read on cache miss only.

Tests cover: title extraction, date extraction, snippet windowing on edge cases (match at start/end), reference extraction, cache invalidation by mtime.

## 6. New module: `apps/web/lib/mcp-governed-execute.ts`

Per spec §4.4. Surface:

```ts
export type GovernedExecuteSource = "rest" | "jsonrpc" | "agentic-loop";

export async function governedExecuteTool(args: {
  toolName: string;
  rawParams: Record<string, unknown>;
  userId: string;
  userContext: { platformRole: string; isSuperuser: boolean };
  context?: { agentId?: string; threadId?: string; routeContext?: string; taskRunId?: string };
  source: GovernedExecuteSource;
}): Promise<ToolResult>;
```

Steps inside:

1. `const tool = PLATFORM_TOOLS.find(t => t.name === toolName);` — return `{ success: false, error: "unknown_tool" }` if missing.
2. If `tool.requiredCapability` and `!can(userContext, tool.requiredCapability)` — return `{ success: false, error: "forbidden_capability" }`. Audit the failure (so the rejection is itself logged).
3. If `context.agentId` is present, `const grants = await getAgentToolGrantsAsync(context.agentId)` and `if (!isToolAllowedByGrants(toolName, grants))` — return `{ success: false, error: "forbidden_grant" }`. Audit the failure.
4. `const t0 = Date.now(); const result = await executeTool(toolName, rawParams, userId, context); const durationMs = Date.now() - t0;`
5. `prisma.toolExecution.create({ data: { ... executionMode: source, ... } }).catch(err => console.error("[governed-execute] audit write failed", err));` — never silent.
6. `return result;`

Tests:

- Mocked `executeTool` returns `{ success: true }`; assert audit row written with correct `executionMode`.
- Capability rejection writes audit with `success: false` and never invokes `executeTool`.
- Grant rejection same.
- Audit write failure does not throw to caller (but does log).

## 7. New tool definitions in `mcp-tools.ts`

Add the seven new tools to `PLATFORM_TOOLS` per spec §3, in this order (grouped near the existing backlog tools):

1. `list_epics`
2. `list_backlog_items`
3. `get_backlog_item`
4. `update_backlog_item_status`
5. `link_backlog_item_to_epic`
6. `search_specs_and_plans`
7. `record_execution_evidence`
8. `get_next_recommended_work`

For each tool:

- Add the `ToolDefinition` to `PLATFORM_TOOLS`.
- Add the `case "tool_name":` block to `executeTool()`.
- The handlers delegate domain logic to the new modules (`transitions.ts`, `recommend.ts`, `spec-plan-search.ts`) or to a thin Prisma read.
- All write-side handlers also write a `BacklogItemActivity` row in the same transaction as their primary write (use `prisma.$transaction` so the activity is consistent with the state change).

For `update_backlog_item_status`:

- Resolve the item by `itemId` (semantic).
- Check `isLegalTransition(item.status, newStatus)`. If illegal, return `{ success: false, error: "illegal_transition", message: "..." }`.
- If `newStatus = "done"` set `completedAt`. Run epic-auto-close: if every other item in the same epic is `done`/`deferred`, flip the epic to `done`.
- Write the `BacklogItem` update and the `BacklogItemActivity` row in one transaction.

For `link_backlog_item_to_epic`:

- Resolve `epicId` semantic→cuid (or null for unlink).
- Read prior `epicId` for the activity payload.
- Update item, recompute target epic status (re-open if it was `done` and we just attached an open item), write the activity row — all in one transaction.

For `record_execution_evidence`:

- Verify `itemId` exists.
- Validate `kind` against the enum.
- Write a `BacklogItemActivity` row with `kind: "evidence"` and `payload: { kind, summary, url, body, toolExecutionId }`.

## 8. Grant map updates in `agent-grants.ts`

Add the new entries per spec §4.2 to `TOOL_TO_GRANTS`:

```ts
list_epics:                 ["backlog_read"],
list_backlog_items:         ["backlog_read"],
get_backlog_item:           ["backlog_read"],
update_backlog_item_status: ["backlog_write"],
link_backlog_item_to_epic:  ["backlog_write"],
search_specs_and_plans:     ["spec_plan_read"],
record_execution_evidence:  ["backlog_write"],
get_next_recommended_work:  ["backlog_read"],
```

Update [packages/db/data/agent_registry.json](../../../packages/db/data/agent_registry.json): for every agent that already has `backlog_read`, also add `spec_plan_read`. This keeps existing agents productive on day one.

The grant seeding loop in `packages/db/src/seed.ts` reads from this JSON, so no separate code change to the seed is needed beyond the JSON edit.

## 9. Wire the new wrapper into call sites

Three edits, each small:

a. [apps/web/app/api/mcp/call/route.ts](../../../apps/web/app/api/mcp/call/route.ts):

- Replace direct `executeTool(...)` call with `governedExecuteTool({ ..., source: "rest" })`.
- Remove the inline `can(...)` check (the wrapper does it).
- Pass `userContext: { platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser }`.

b. [apps/web/lib/tak/agentic-loop.ts](../../../apps/web/lib/tak/agentic-loop.ts) line ~920–973:

- Behind a `DPF_USE_GOVERNED_WRAPPER` env flag (default `true` in dev, default `false` in production until verified):
  - When enabled, replace the `executeTool` + `prisma.toolExecution.create` block with a single `governedExecuteTool({ ..., source: "agentic-loop" })`.
  - When disabled, keep the existing path verbatim.
- The flag is removed in a follow-up PR after one release on dev.

c. The forthcoming `/api/mcp/jsonrpc` route (out of scope here) is documented to call `governedExecuteTool({ ..., source: "jsonrpc" })`. Add a one-line comment in the wrapper module pointing to the spec.

## 10. Tests

All new test files live next to their modules. We use Vitest, the project's existing convention.

| File | Coverage |
| ---- | -------- |
| `apps/web/lib/backlog/transitions.test.ts` | Legal/illegal transitions; admin-only transitions |
| `apps/web/lib/backlog/recommend.test.ts` | Ranking with/without spec, with active build, with claim, with epic narrowing |
| `apps/web/lib/backlog/spec-plan-search.test.ts` | Title/date extraction; snippet windowing; reference regex; mtime cache |
| `apps/web/lib/mcp-governed-execute.test.ts` | Capability rejection, grant rejection, success path, audit write under each `source` value, audit failure does not throw |
| `apps/web/lib/mcp-tools.backlog.test.ts` | One integration test per new tool: happy path + one failure case (illegal transition for status; missing item for evidence; epicId resolution for link; etc.) |

Existing `agent-grants.test.ts` gets new assertions for the new grant entries (default-deny when grant is absent; allowed when present).

`/api/mcp/call` route gets a focused integration test that asserts a successful tool call writes a `ToolExecution` row with `executionMode = "rest"` (the audit gap closure).

## 11. Verification

Per AGENTS.md verification gate:

1. `pnpm --filter web typecheck` — must pass cleanly. Done before every commit by the pre-commit hook; run manually before PR open as a belt-and-suspenders check.
2. `pnpm --filter web vitest run apps/web/lib/backlog apps/web/lib/mcp-governed-execute apps/web/lib/mcp-tools.backlog` — all green.
3. `cd apps/web && npx next build` — must complete with zero errors.
4. **Manual UX check (optional but recommended):** spin up the portal, open the AI coworker on the Build Studio backlog page, and confirm the existing tools still work (regression check on `query_backlog`, `create_backlog_item`).
5. Fresh-DB sanity: rebuild the portal-init container so the new migration applies; confirm seed runs without warnings about missing tools or grants.

## 12. PR

- Title: `feat(mcp): governed backlog surface — list/get/status/link/search/evidence/recommend`
- Body sections (per AGENTS.md commit-message convention):
  - **Summary** — three bullets covering: new tools added, audit gap closed, no breaking changes to existing tools.
  - **Spec / plan links** — to the two new docs.
  - **Migration** — explicit callout that two migrations land (new table + data normalization) and they are purely additive.
  - **Test plan** — checklist with the verification steps above.
- Every commit signed off (`git commit -s`) per the DCO requirement.

## 13. External Client Support (spec §11) — additional implementation

This sub-plan delivers the Mode 1 external-client surface described in spec §11. It can ship in the same PR as the rest, or split into a follow-up PR if the diff is too large for one review — the core surface (§§1–12 above) is independently useful.

### 13.1 Schema migration — `AgentApiToken` and `ToolExecution.apiTokenId`

New migration `<timestamp>_agent_api_token`:

1. Add `AgentApiToken` model per spec §11.3 (User has-many).
2. Add nullable `apiTokenId String?` column to `ToolExecution` plus index `@@index([apiTokenId])`.
3. No backfill — both are additive.

### 13.2 New module: `apps/web/lib/auth/agent-api-token.ts`

Surface:

```ts
export async function issueAgentApiToken(input: {
  userId: string;
  name: string;
  capability: "read" | "write";
  scopes: string[];
  expiresInDays: number | null;
  agentId?: string;
}): Promise<{ tokenId: string; plaintext: string }>;

export async function revokeAgentApiToken(tokenId: string, reason: string): Promise<void>;

export async function resolveAgentApiToken(plaintext: string): Promise<{
  tokenId: string;
  userId: string;
  agentId: string | null;
  scopes: string[];
  capability: "read" | "write";
} | null>;
```

`issueAgentApiToken`:

- Generates 24 random bytes, encodes base32, prefixes `dpfmcp_`.
- Hashes with sha256 (Node `crypto.createHash`).
- Computes `expiresAt = capability==="write" ? gate-checks contribution-mode : ...`
- Inserts row with `tokenHash` only — plaintext returned to caller exactly once and never persisted.
- If `capability === "write"`, reads `PlatformDevConfig` and throws if `contributionModel` is null.

`resolveAgentApiToken`:

- Hashes input, single `findUnique({ tokenHash })` query.
- Returns null if missing, revoked (`revokedAt != null`), or expired (`expiresAt < now()`).
- Updates `lastUsedAt` (fire-and-forget).

Tests in `agent-api-token.test.ts`:

- Issue read token without contribution-mode set → succeeds.
- Issue write token without contribution-mode set → throws with the expected message.
- Issue write token with contribution-mode set → succeeds.
- Revoke then resolve → returns null.
- Expired token → returns null.
- Tampered plaintext (one char off) → returns null without throwing.

### 13.3 New endpoint: `apps/web/app/api/mcp/external/jsonrpc/route.ts`

JSON-RPC 2.0 handler. POST only. Steps per spec §11.4:

1. Read `Authorization: Bearer <token>` header. If absent → JSON-RPC error `{ code: -32001, message: "unauthorized" }`.
2. `resolveAgentApiToken(plaintext)`. If null → same error.
3. Parse JSON-RPC envelope. Support methods: `initialize`, `notifications/initialized`, `tools/list`, `tools/call`. Mirrors the future internal JSON-RPC spec so external clients see one stable contract.
4. For `tools/list`: load `User`, call `getAvailableTools(userContext, { agentId: token.agentId, unifiedMode: true })`, intersect with `token.scopes` (a tool is included only if `TOOL_TO_GRANTS[tool.name]` shares at least one entry with `token.scopes`).
5. For `tools/call`: invoke `governedExecuteTool({ source: "external-jsonrpc", userContext, context: { agentId: token.agentId, apiTokenId: token.tokenId }, ... })`. Wrapper additionally rejects if the tool's required grants do not intersect `token.scopes`.
6. TLS guard: reject when `request.url.startsWith("http://")` and host is not `localhost` / `127.0.0.1`. Returns JSON-RPC `{ code: -32002, message: "tls_required" }`.

The wrapper signature gets a `context.apiTokenId?: string` field; the audit write includes `apiTokenId` and sets `executionMode: "external-jsonrpc"`.

Tests in `apps/web/app/api/mcp/external/jsonrpc/route.test.ts`:

- Missing bearer → `-32001`.
- Bad bearer → `-32001`.
- Valid read token, `tools/list` → returns only tools whose grants intersect token scopes.
- Valid write token, `tools/call` on `update_backlog_item_status` → succeeds, audit row written with `apiTokenId` set and `executionMode = "external-jsonrpc"`.
- Read-only token, `tools/call` on `update_backlog_item_status` → `forbidden_grant` and audited as a failure.
- HTTP request to non-localhost host → `tls_required`.

### 13.4 Settings UI — `External Coding Agent Access` section

File: extend `apps/web/app/(shell)/admin/platform-development/page.tsx` and add a new client component `apps/web/components/admin/AgentApiTokenManager.tsx`.

UI:

- "External Coding Agent Access" card under the existing contribution-mode card.
- Status indicator: contribution mode wired (yes/no) — links to the same page's contribution-mode card if not.
- Existing tokens table (server-fetched): `name`, `prefix`, `capability`, `scopes` (chips), `lastUsedAt`, `expiresAt`, "Revoke" button.
- "Generate token" button → modal:
  - `name` (text)
  - `capability` (radio: read / write — write disabled with explainer copy when contribution-mode unset)
  - `scopes` (multi-select, defaulted to current user's grants)
  - `expiresIn` (dropdown: 30/60/90/180 days/never)
  - optional `agentId` (dropdown of agents the user can act as)
- On submit: server action returns `{ tokenId, plaintext }`. Modal switches to "copy once" view with the plaintext, the prefix, and a tabbed "Setup snippet" (Claude Code / Codex / VS Code) with the user's URL pre-filled. After dismissal, plaintext is gone.

Tests:

- Component renders existing tokens.
- Modal disables "write" radio when contribution-mode unset; renders the explainer.
- Generate flow returns plaintext into the copy-once view.
- Revoke calls the server action and refreshes the list.

### 13.5 Audit-log viewer surfacing of external sources

The existing `/platform/ai/authority` Tool Execution Log already filters by `agentId`/`userId`/`toolName`. Add a filter chip for `executionMode IN ("rest", "external-jsonrpc", "agentic-loop", "jsonrpc")` and a column showing the masked token prefix when `apiTokenId` is set. This is a small UI extension, not a redesign.

### 13.6 Verification additions for §11

In addition to the §11 verifications already listed:

- Spin up the portal in dev. Issue a read-only token from `/admin/platform-development`. Configure Claude Code with the printed `mcp.json`. Run `claude --mcp dpf` and call `list_backlog_items` — confirm rows return and a `ToolExecution` row with `executionMode = "external-jsonrpc"` lands.
- Issue a write token after configuring contribution mode. Call `record_execution_evidence` from Claude Code. Confirm the activity row is written and the audit row carries `apiTokenId`.
- Revoke the token from the UI; the next call from Claude Code returns `unauthorized`.

### 13.7 Updated PR description

The PR now also notes:

- New external MCP endpoint at `/api/mcp/external/jsonrpc` (bearer-token authenticated).
- New `AgentApiToken` model with token issuance UI co-located with contribution mode.
- Write tokens gated on contribution mode being configured.
- All external traffic audited with the new `apiTokenId` column on `ToolExecution`.

If the diff exceeds reviewable size, split as: PR 1 = §§1–12 (domain surface + audit-gap fix), PR 2 = §13 (external client). Both behind the same epic.

---

## 14. Out-of-scope follow-up tickets to file at PR time

These should be raised as new backlog items on PR open so they are not lost:

1. JSON-RPC `/api/mcp/jsonrpc` route delivering this surface to external CLI clients (Codex, VS Code MCP) — gated on the [Platform MCP Tool Server](../specs/2026-04-11-platform-mcp-tool-server-design.md) work.
2. Restricting `admin_query_db` to superuser-only via a new grant `arbitrary_sql_read`, now that the domain coverage reduces the need.
3. Splitting `update_backlog_item` into `update_backlog_item_metadata` + the new `update_backlog_item_status`, then deprecating the broad-patch surface.
4. Periodic `BacklogItemActivity` archival policy if volume becomes a concern (not expected in the first six months).

---

## Implementation order (do not parallelize within this PR)

1. Schema migration (table) — commit
2. Data migration (type normalization) — commit
3. `transitions.ts` + tests — commit
4. `recommend.ts` + tests — commit
5. `spec-plan-search.ts` + tests — commit
6. `mcp-governed-execute.ts` + tests — commit
7. New tool definitions + handlers + grant entries — commit (largest commit; one tool per logical sub-step is fine but a single commit is acceptable since they share a registry)
8. Wire `/api/mcp/call` to the wrapper, integration test asserting audit row written — commit
9. Wire `agentic-loop.ts` to the wrapper behind the env flag — commit
10. PR open
