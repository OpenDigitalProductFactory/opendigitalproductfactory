# Governed MCP Backlog Surface — Design Spec

| Field | Value |
|-------|-------|
| **Epic** | Platform Infrastructure / Build Studio Governance |
| **Status** | Draft |
| **Created** | 2026-04-25 |
| **Author** | Claude Opus 4.7 for Mark Bodman |
| **Scope** | `apps/web/lib/mcp-tools.ts`, `apps/web/lib/tak/agent-grants.ts`, `apps/web/app/api/mcp/`, `apps/web/lib/backlog/` (new), `packages/db/prisma/schema.prisma` |
| **Aligns with** | [2026-04-11-platform-mcp-tool-server-design.md](./2026-04-11-platform-mcp-tool-server-design.md) (delivery transport), [2026-04-21-backlog-triage-build-studio-design.md](./2026-04-21-backlog-triage-build-studio-design.md) (lifecycle), [2026-04-23-build-studio-governed-backlog-delivery-design.md](./2026-04-23-build-studio-governed-backlog-delivery-design.md) (governed lifecycle) |
| **Distinct from** | TAK / GAID Standards Family ([2026-04-18-tak-gaid-standards-family-design.md](./2026-04-18-tak-gaid-standards-family-design.md)) — this spec consumes TAK identity / authority contracts but does not modify them |
| **Primary Goal** | A single domain-level MCP surface for backlog and planning workflows usable by both in-platform AI coworkers and external coding agents (Claude CLI, Codex, VS Code MCP), governed by the same auth, grants, and audit pipeline. |

---

## 1. Problem Statement

The repository has a strong domain layer for backlog work — `Epic`, `BacklogItem`, `FeatureBuild`, the lifecycle state machine in [governed-backlog-workflow.ts](../../apps/web/lib/governed-backlog-workflow.ts), the TAK grant model, and `ToolExecution` audit. But the **agent-facing contract** for that domain is fragmented and partially missing:

1. **The MCP surface for backlog is incomplete.** The existing tools cover create/update/triage/promote/query, but lack: a single-item read, an explicit epic/item link operation, spec/plan search, evidence capture, and a "next recommended work" entry point that mirrors how a human PM picks the next item. External coding agents (Codex, VS Code MCP, Claude CLI) need these to be productive without inventing their own workflow.
2. **Audit is uneven.** [agentic-loop.ts:953](../../apps/web/lib/tak/agentic-loop.ts#L953) writes `ToolExecution` rows for tools called inside the in-platform agentic loop. The REST gateway at [/api/mcp/call](../../apps/web/app/api/mcp/call/route.ts) does **not** write `ToolExecution`, and an MCP JSON-RPC endpoint (per the [Platform MCP Tool Server spec](./2026-04-11-platform-mcp-tool-server-design.md)) is not yet implemented. A tool called by an external coding agent today would land an effect on the DB without an audit row.
3. **Domain semantics leak into raw CRUD.** `update_backlog_item` accepts arbitrary patch fields. `create_backlog_item` with `epicId` performs a string-to-cuid resolution inline. Without explicit domain operations like `link_backlog_item_to_epic`, agents end up doing table-shaped writes and the lifecycle invariants in `governed-backlog-workflow.ts` are easy to bypass.
4. **No single "what should I work on next?" surface.** AGENTS.md tells agents to consider items with existing designs first, then dependencies, then impact — but that's prose. There is no callable tool that returns a ranked list grounded in the spec/plan inventory and the live backlog state.
5. **Live drift confirms the contract is loose.** `BacklogItem.type` already has a `feature` value in the DB even though the canonical enum is `{portfolio, product}` — that's the kind of corruption a domain-shaped contract is supposed to prevent.

This spec defines a **governed MCP backlog surface**: nine tools that together cover read, write, link, search, evidence, and recommendation, all enforced through the existing TAK grant model and a new shared governed-execution wrapper that centralizes audit so direct REST and JSON-RPC paths get the same audit trail as the in-platform agentic loop.

## 2. Non-Goals

- **Replacing the Platform MCP Tool Server.** That spec defines the *transport* (JSON-RPC, session tokens, agent-scoped tool listing). This spec defines the *contents* of the backlog domain on that transport. The two compose; neither blocks the other.
- **Unifying with TAK/GAID identity refresh.** This spec consumes the `Agent` / `AgentToolGrant` model as it stands today. If the TAK/GAID work later renames `agentId` semantics or adds GAID-compliant identifiers, the grant call site and audit row will pick that up automatically because both already live behind `getAgentToolGrantsAsync()`. We do not refactor the identity layer here.
- **Inventing a new prioritization framework (WSJF, ICE, RICE).** `get_next_recommended_work` ranks using fields and signals that already exist (`priority`, `effortSize`, has-spec, has-active-build, lifecycle stage). A future spec can replace the ranking function without changing the tool contract.
- **External arbitrary SQL.** `admin_query_db` is an existing escape hatch and stays out of scope; the goal is to remove the *need* for arbitrary SQL by exposing complete domain operations.
- **Replacing existing tools.** `create_backlog_item`, `update_backlog_item`, `triage_backlog_item`, `promote_to_build_studio`, `query_backlog`, `create_build_epic` keep their names and current semantics. New tools are additive.

## 3. Tool Surface

The backlog surface is the following nine tools. Existing tools that already cover a goal are reused as-is; gaps are filled by new tools. All tools live in [mcp-tools.ts](../../apps/web/lib/mcp-tools.ts) so that the in-platform `/api/mcp/call` REST gateway, the planned JSON-RPC MCP server, and the in-platform agentic loop all dispatch through the same registry.

| Goal | Tool | Status | Required grant |
|------|------|--------|----------------|
| `list_epics` | `list_epics` (new) | New | `backlog_read` |
| `list_backlog_items` | `list_backlog_items` (new) | New, replaces shape of `query_backlog` for items | `backlog_read` |
| `get_backlog_item` | `get_backlog_item` (new) | New | `backlog_read` |
| `create_backlog_item` | `create_backlog_item` | Existing — kept | `backlog_write` |
| `update_backlog_item_status` | `update_backlog_item_status` (new) | New, narrower than `update_backlog_item` | `backlog_write` |
| `link_backlog_item_to_epic` | `link_backlog_item_to_epic` (new) | New | `backlog_write` |
| `search_specs_and_plans` | `search_specs_and_plans` (new) | New | `spec_plan_read` (new grant) |
| `record_execution_evidence` | `record_execution_evidence` (new) | New | `backlog_write` + writes ToolExecution |
| `get_next_recommended_work` | `get_next_recommended_work` (new) | New | `backlog_read` |

`query_backlog` and `update_backlog_item` are kept for backward compatibility — Build Studio and several coworkers already call them. The new tools provide narrower, intent-explicit alternatives that external agents should prefer.

### 3.1 `list_epics`

Returns epics filtered by status, with item-count rollups. Read-only, no side effects.

Input:
```ts
{
  status?: "open" | "in-progress" | "done";   // default: any non-done if omitted
  hasOpenItems?: boolean;                     // narrow to actively worked epics
  limit?: number;                              // default 25, max 100
}
```

Output:
```ts
{
  success: true,
  epics: Array<{
    epicId: string;          // semantic, e.g. "EP-BUILD-9F749C"
    title: string;
    status: "open" | "in-progress" | "done";
    itemCount: { total: number; open: number; inProgress: number; done: number };
    hasSpec: boolean;        // any spec/plan file references this epicId
    updatedAt: string;       // ISO
  }>;
}
```

### 3.2 `list_backlog_items`

Returns items filtered by status, type, epic, or claim. The replacement for `query_backlog` for items (epics get their own tool above). Read-only.

Input:
```ts
{
  status?: "open" | "in-progress" | "done" | "deferred" | "triaging";
  type?: "portfolio" | "product";
  epicId?: string;                  // semantic id; resolved server-side
  unclaimed?: boolean;              // claimedById = null AND claimedByAgentId = null
  hasActiveBuild?: boolean;
  limit?: number;                   // default 25, max 100
}
```

Output: array of item summaries with `itemId`, `title`, `status`, `type`, `priority`, `effortSize`, `epicId`, `lifecycleLabel` (computed via `deriveLifecycleLabel`), `hasActiveBuild`, `updatedAt`.

### 3.3 `get_backlog_item`

Returns a single item with full relations needed for an agent to act on it. Read-only.

Input: `{ itemId: string }` (semantic id, e.g. `BI-PORT-005`).

Output: full DTO including: item core fields, lifecycle label, linked epic summary, linked digital product, linked active `FeatureBuild` summary (id, phase, draftApprovedAt, sandboxId), spec/plan files that reference the itemId or its epic (paths only — body is fetched via `read_project_file`), and recent `BacklogItemActivity` entries (last 10).

If the item is missing, returns `{ success: false, error: "not_found" }` — never throws.

### 3.4 `create_backlog_item` (existing — kept)

No contract changes. The `type` enum is enforced at the schema level (`portfolio` / `product`) so agent calls cannot reintroduce the `feature` drift seen in the live DB. A separate one-line migration normalizes existing `feature` rows to `product` and is part of the implementation plan, not this spec.

### 3.5 `update_backlog_item_status`

A narrower alternative to `update_backlog_item` that only changes status, captures a reason, and runs the lifecycle invariants. Side-effecting.

Input:
```ts
{
  itemId: string;
  status: "open" | "in-progress" | "done" | "deferred";
  reason?: string;                   // free-text rationale for audit
  resolution?: string;               // required when status=done
}
```

Behavior:
- Rejects illegal transitions (e.g., `done` → `triaging`). Legal transitions are enumerated in §4.2.
- When `status=done`, sets `completedAt`, attempts an epic-completion check (auto-close epic if all items reach `done`/`deferred` — this matches the AGENTS.md stewardship rule).
- When `status=in-progress` without an active build, allows it (the user may be tracking work that isn't a Build Studio job) but emits a warning in the result.
- Writes a `BacklogItemActivity` row tagged `kind: "status_change"` with the prior and new status.

`update_backlog_item` (existing) keeps its broader patch surface for callers that need it (Build Studio, internal coworkers); external agents are pointed at `update_backlog_item_status` for the common case so their writes are easier to reason about.

### 3.6 `link_backlog_item_to_epic`

Explicit linkage operation. Side-effecting.

Input:
```ts
{
  itemId: string;
  epicId: string | null;       // null unlinks
}
```

Behavior:
- Resolves `epicId` (semantic) to the cuid via the existing pattern.
- Updates `BacklogItem.epicId`.
- Recomputes the source and target epic's open-item count and, if the target epic is currently `done` and we just attached an open item, flips it back to `open` (mirrors AGENTS.md's "stale open items cause the epic to appear incomplete" stewardship — same logic in reverse).
- Writes a `BacklogItemActivity` row tagged `kind: "epic_link"` capturing prior and new epic.

This replaces the inline `epicId`-passing in `create_backlog_item` for the post-create case, where today an agent has to use `update_backlog_item` (broader surface) just to link an item.

### 3.7 `search_specs_and_plans`

Searches the design-spec and implementation-plan files under `docs/superpowers/specs/` and `docs/superpowers/plans/`. Read-only. Returns matched files, title (from frontmatter or first H1), date, and a snippet around the first match per file.

Input:
```ts
{
  query: string;                     // free text; matched against title and body
  kind?: "spec" | "plan";            // restrict to one tree
  matches?: number;                  // max results, default 10, max 25
  itemId?: string;                   // optional: also match files referencing this BI- id
  epicId?: string;                   // optional: also match files referencing this EP- id
}
```

Output:
```ts
{
  success: true,
  results: Array<{
    path: string;                    // relative to repo root
    kind: "spec" | "plan";
    title: string;
    date: string;                    // YYYY-MM-DD inferred from filename or frontmatter
    snippet: string;                 // ~240 chars around first match
    referencedItemIds: string[];     // BI-... ids found anywhere in the file
    referencedEpicIds: string[];     // EP-... ids found anywhere in the file
  }>;
}
```

Implementation notes (informational — see Plan):
- Files are read from disk on each call. Counts are small enough (<200 markdown files) that a full text scan is fine. If this becomes hot we add the same Postgres FTS index we use for backlog semantic memory.
- Matching is a case-insensitive substring scan over title + body. We do not embed semantic search here — `search_knowledge_base` already exists for semantic and is a different surface.
- `referencedItemIds` / `referencedEpicIds` are extracted via regex `/\b(BI|EP)-[A-Z0-9-]+/g` so an agent can correlate a spec to live backlog state with `get_backlog_item`.

### 3.8 `record_execution_evidence`

Attaches an evidence record to a backlog item — a structured artifact that says "this happened, here's the proof." Side-effecting.

Input:
```ts
{
  itemId: string;
  kind: "test_pass" | "test_fail" | "build_pass" | "build_fail"
      | "ux_verified" | "spec_review" | "manual_check" | "external_link";
  summary: string;                   // short headline, <= 240 chars
  url?: string;                      // links to artifact (PR, CI run, screenshot, etc.)
  body?: string;                     // longer notes, <= 8000 chars
  toolExecutionId?: string;          // when the evidence was produced by a prior tool call
}
```

Output: `{ success: true, activityId: string, recordedAt: string }`.

Behavior:
- Writes a `BacklogItemActivity` row tagged `kind: "evidence"` with a `payload` JSON capturing the structured fields above.
- The audit row in `ToolExecution` (written by the governed wrapper, §4.4) is the canonical proof of the call. The activity row is the per-item view used by the UI.
- This is the **shared successor** alluded to in the goals: `ToolExecution` for the cross-cutting audit, `BacklogItemActivity` for the per-entity timeline. We do NOT extend `EvidenceBundle` (which is scoped to deliberation runs in Build Studio) for this — see §6.

### 3.9 `get_next_recommended_work`

Returns a short ranked list of items the caller could pick up. Read-only.

Input:
```ts
{
  count?: number;                    // default 3, max 10
  epicId?: string;                   // narrow to one epic
  forAgentId?: string;               // optional — only items grant-claimable by this agent
  excludeItemIds?: string[];         // items already considered or rejected
}
```

Output:
```ts
{
  success: true,
  recommendations: Array<{
    itemId: string;
    title: string;
    rationale: string;               // human-readable why-this-rank
    rank: number;                    // 1-based
    score: number;                   // opaque float, monotonic
    signals: {
      hasSpec: boolean;
      hasPlan: boolean;
      hasActiveBuild: boolean;
      claimedByOther: boolean;
      effortSize: string | null;
      priority: number | null;
      epicStatus: string | null;
    };
  }>;
}
```

Ranking function v1 (exposed as `apps/web/lib/backlog/recommend.ts`):

1. Filter to items with `status ∈ { open, triaging }` and `claimedById IS NULL` and `claimedByAgentId IS NULL` (or matching `forAgentId`).
2. Drop items in `excludeItemIds`.
3. Score (higher is better):
   - `+5` if a spec file under `docs/superpowers/specs/` references the itemId or its epic.
   - `+3` if a plan file under `docs/superpowers/plans/` references the itemId or its epic.
   - `+2` if `priority IS NOT NULL` (small bonus, then `+priority/10` capped at `+2`).
   - `+1` if `effortSize IN { small, medium }` (preference for shippable chunks).
   - `+1` if `triageOutcome = "build"` (already triaged toward a build).
   - `-2` if `hasActiveBuild=true` (someone else is already working it).
4. Sort by score desc, then by `priority` asc (lower number = higher priority), then `updatedAt` desc.
5. Return top `count` with `rationale` derived from which signals fired.

This is intentionally simple and tunable. It mirrors AGENTS.md's stated heuristic ("items with existing designs first, then dependencies between items, then impact"). When the platform's prioritization model improves, only this ranking function changes.

## 4. Governance Architecture

### 4.1 Three layers of enforcement (unchanged)

The existing model — User capability ⨉ Agent grants ⨉ Tool definition — is correct and stays. This spec adds rows to the existing tables, not new tables.

```
                   /api/mcp/call (REST, session cookie)
                                ▼
       /api/mcp (JSON-RPC, session token — see Platform MCP Tool Server)
                                ▼
                   in-platform agentic-loop.ts
                                ▼
              +---------------------------------+
              |   governedExecuteTool(...)      |   ← NEW (§4.4)
              |  user cap → agent grant →       |
              |  audit row (ToolExecution) →    |
              |  executeTool(...)               |
              +---------------------------------+
                                ▼
                      mcp-tools.ts dispatcher
```

Today, only the agentic-loop path writes `ToolExecution`. The new wrapper centralizes that so REST and JSON-RPC get audit "for free."

### 4.2 New grants and the lifecycle invariant

`TOOL_TO_GRANTS` in [agent-grants.ts](../../apps/web/lib/tak/agent-grants.ts) gets these entries:

```ts
list_epics:                  ["backlog_read"],
list_backlog_items:          ["backlog_read"],
get_backlog_item:            ["backlog_read"],
update_backlog_item_status:  ["backlog_write"],
link_backlog_item_to_epic:   ["backlog_write"],
search_specs_and_plans:      ["spec_plan_read"],
record_execution_evidence:   ["backlog_write"],
get_next_recommended_work:   ["backlog_read"],
```

`spec_plan_read` is a new grant key. Most coworkers that have `backlog_read` should also receive `spec_plan_read` — this is a seed change in [packages/db/data/agent_registry.json](../../packages/db/data/agent_registry.json) and the `seed.ts` grant assignment loop. Default-deny stays in force; tools omitted from the map are still rejected by `isToolAllowedByGrants`.

Legal status transitions enforced by `update_backlog_item_status` (and shared from `apps/web/lib/backlog/transitions.ts`):

```
triaging ──▶ open ──▶ in-progress ──▶ done
   │          │            │
   ▼          ▼            ▼
deferred   deferred      deferred
   │          │            │
   ▼          ▼            ▼
discarded  open          open       (re-open from deferred is allowed)
```

`done → done` is a no-op success. `done → anything` requires `backlog_admin_write` (a new grant gated on superuser by default). `triaging → done` is rejected — the triage step exists for a reason.

### 4.3 No table-shaped APIs leak out

`list_backlog_items` returns `epicId` as the **semantic** id (`EP-...`), not the cuid. `link_backlog_item_to_epic` accepts the semantic id. The cuid is an internal join key and never appears in the agent-facing contract. This matches the [memory note](../../C:/Users/Mark%20Bodman/.claude/projects/d--DPF/memory/project_backlog_epic_fk_pitfall.md) where Prisma FK confusion has bitten the project before.

### 4.4 Governed execution wrapper

A new module `apps/web/lib/mcp-governed-execute.ts` exposes:

```ts
export async function governedExecuteTool(args: {
  toolName: string;
  rawParams: Record<string, unknown>;
  userId: string;
  context?: { agentId?: string; threadId?: string; routeContext?: string; taskRunId?: string };
  source: "rest" | "jsonrpc" | "agentic-loop";  // for audit attribution
}): Promise<ToolResult>;
```

Behavior:

1. Look up tool def in `PLATFORM_TOOLS`. Reject `not_found`.
2. If `tool.requiredCapability` is set and `context.userContext` cannot satisfy it, reject `forbidden_capability`.
3. If `context.agentId` is set, resolve `getAgentToolGrantsAsync(agentId)` and reject via `isToolAllowedByGrants` — `forbidden_grant`.
4. Time the call. Invoke `executeTool(...)`.
5. Always write a `ToolExecution` row (fire-and-forget but with error logging — never silent on the audit path itself), with `success`, `parameters`, `result`, `durationMs`, `auditClass`, `capabilityId`, and `executionMode = source`.
6. Return the `ToolResult`.

The **agentic loop keeps its own audit write**, but it stops doing the grant check itself (it already calls `executeTool` directly today and grants are checked elsewhere — see existing flow). The cleanest move is for `agentic-loop.ts` to call `governedExecuteTool` instead of `executeTool` and remove its inline `prisma.toolExecution.create`. That collapses three audit/permission paths into one. This change is small but worth doing in this spec because it closes the audit gap that motivates the work.

Three call sites change:

- [apps/web/app/api/mcp/call/route.ts](../../apps/web/app/api/mcp/call/route.ts) — replace `executeTool(...)` with `governedExecuteTool({ source: "rest", ... })` and remove the inline `can(...)` call (the wrapper does it).
- [apps/web/lib/tak/agentic-loop.ts](../../apps/web/lib/tak/agentic-loop.ts) line 953 region — replace direct `executeTool` + `toolExecution.create` with `governedExecuteTool({ source: "agentic-loop", ... })`.
- The forthcoming JSON-RPC route from the Platform MCP Tool Server spec — its `tools/call` handler calls `governedExecuteTool({ source: "jsonrpc", ... })`. That route is not delivered by *this* spec, but the wrapper is ready for it.

### 4.5 BacklogItemActivity model

`BacklogItemActivity` is a new lightweight model. It is **not** a generic event log — it is the per-item timeline that the UI and `get_backlog_item` read.

```prisma
model BacklogItemActivity {
  id              String      @id @default(cuid())
  backlogItemId   String      // FK to BacklogItem.id
  kind            String      // "status_change" | "epic_link" | "evidence" | "claim" | "comment"
  summary         String      // <= 240 chars, headline for the UI timeline
  payload         Json        // structured per-kind detail
  recordedAt      DateTime    @default(now())
  recordedById    String?     // User.id, optional — null when agent-only
  recordedByAgentId String?   // Agent.agentId
  toolExecutionId String?     // FK to ToolExecution.id when produced by a tool call

  backlogItem     BacklogItem @relation(fields: [backlogItemId], references: [id], onDelete: Cascade)
  @@index([backlogItemId, recordedAt(sort: Desc)])
  @@index([kind, recordedAt(sort: Desc)])
}
```

This is added in a Prisma migration with no backfill (new table). It complements but does not replace `ToolExecution` (cross-cutting audit) or `EvidenceBundle` (Build Studio deliberation evidence).

## 5. External Coding Agent Use

External use is enabled by the Platform MCP Tool Server spec's transport. This spec ensures every tool added here is well-shaped for that transport:

- **Stable names.** All nine tools have agent-friendly names that match the spec table above. They will not be renamed once shipped — the names are the contract.
- **JSON-Schema input schemas** with `enum` constraints on every status/type/kind field, so MCP-capable clients can render dropdowns or validate before sending.
- **Idempotency where possible.** `update_backlog_item_status` with `status` already at the requested value is a no-op success. `link_backlog_item_to_epic` to the current epic is a no-op success. `record_execution_evidence` is intentionally not idempotent — duplicate evidence is fine.
- **`autoApproveWhen` on the new mutations.** The existing `executionMode: "proposal"` flow can still be used by HITL-tier agents. For the Codex / VS Code agents that work autonomously inside a Build Studio sandbox, we set `autoApproveWhen` on `update_backlog_item_status` and `link_backlog_item_to_epic` so they execute immediately when the agent has the right grants — this is exactly the [proposal-trap memory](../../C:/Users/Mark%20Bodman/.claude/projects/d--DPF/memory/project_proposal_trap_silent_failure.md) lesson applied.

## 6. Why not `EvidenceBundle` for `record_execution_evidence`?

`EvidenceBundle` is keyed to `deliberationRunId`, which is the Build Studio deliberation/branch graph. It records "claim-source" pairs for a structured argument, not "this build passed." Forcing backlog evidence through it would either require fabricating a deliberation run or denormalizing the evidence model. `BacklogItemActivity` is the right shape: cheap to write, indexed for timeline reads, and clearly per-item.

`ToolExecution` remains the audit record of record. `BacklogItemActivity` is the user-visible timeline. They are written together in the governed wrapper.

## 7. Live State Reconciliation (one-time, in implementation)

The pre-implementation DB scan (run during research) found:

- `BacklogItem.type = "feature"` exists in live data — non-canonical. A small data migration normalizes `feature → product`. The `type` enum on `create_backlog_item` already only allows `portfolio | product`, so once normalized this drift cannot reappear via tool calls.
- All sample `BacklogItem` rows have `epicId = NULL`. This is allowed by the schema and not a corruption — it's just visible scope for `link_backlog_item_to_epic`.
- 354 `AgentToolGrant` rows seeded; no `epic_*` grant keys. Backlog/epic operations all gate on `backlog_read` / `backlog_write`. We keep that — splitting the grant further is more governance overhead than it pays for at this scale.

Both are addressed in the implementation plan, not in this spec body.

## 8. Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Audit-wrapper change in `agentic-loop.ts` regresses the in-platform agent path | Phased migration: wrapper added alongside the existing `executeTool` call; switch over only after the new wrapper passes parity tests; keep the old code path behind a `DPF_USE_GOVERNED_WRAPPER` env flag for one release. |
| `search_specs_and_plans` reads ~200 markdown files per call | Acceptable today (sub-100ms on the dev box). If it becomes hot, the same Postgres FTS pattern used for backlog semantic memory is the next step. |
| Ranking in `get_next_recommended_work` is naive and may surface bad recommendations | The function lives in `apps/web/lib/backlog/recommend.ts` and is unit-tested with explicit fixtures. It is replaceable without changing the tool contract. |
| External coding agents may attempt arbitrary SQL via `admin_query_db` after this lands | Out of scope here, but the existence of this surface reduces the *justification* for using the SQL escape hatch. A future restriction on `admin_query_db` (e.g., superuser only via grants) is now safe to make. |
| `BacklogItemActivity` grows unbounded | Indexed `(backlogItemId, recordedAt desc)`; UI and tool reads always paginate. Long-term TTL is a future concern. |

## 9. Test Plan (informational — full plan in implementation document)

- Unit: ranking function with fixtures (no spec, with spec, with active build, with claim).
- Unit: legal/illegal status transitions in `update_backlog_item_status`.
- Unit: `link_backlog_item_to_epic` semantic→cuid resolution and the epic auto-reopen behavior.
- Unit: `search_specs_and_plans` regex extraction of `BI-*` / `EP-*` references; snippet windowing.
- Integration: `governedExecuteTool` writes a `ToolExecution` row for each of REST, JSON-RPC, and agentic-loop sources, with correct `executionMode` field.
- Integration: agent without `backlog_read` is rejected at the wrapper before `executeTool` runs (no DB read happens, no `BacklogItem` row is loaded).
- Integration: agent with `backlog_read` but not `backlog_write` is rejected on `record_execution_evidence` and the failure itself is audited.
- Lifecycle: end-to-end `create_backlog_item → link_backlog_item_to_epic → update_backlog_item_status(in-progress) → record_execution_evidence(test_pass) → update_backlog_item_status(done)` produces a clean activity timeline and a closed epic if it was the last item.

## 10. Out-of-Scope Follow-ups (recorded for later)

- Migrating the existing `update_backlog_item` callers to either `update_backlog_item_status` or `update_backlog_item_metadata` (a future split). Today the patch surface is too broad.
- Restricting `admin_query_db` to superuser-only via grants once the domain coverage here is exercised.
- Adding `apps/web/lib/backlog/transitions.ts` as the canonical transition table consumed by both `update_backlog_item_status` and the existing `update_backlog_item` write path so they stay aligned.
- Splitting `backlog_write` into `backlog_create`, `backlog_update`, `backlog_evidence_write` if the scale of agents and audit volume warrants finer-grained governance.

---

## 11. External Client Use — Mode 1 Installation

The same nine-tool surface is exposed to **external** MCP clients (Claude Code, Codex CLI, VS Code MCP) running on the user's host. This is the Mode 1 unlock: a fresh install gives the user a working backlog interface from their preferred coding agent, not just from inside the portal's Build Studio.

### 11.1 Why a separate transport from the in-portal one

The existing endpoints at `/api/mcp/tools` (POST list) and `/api/mcp/call` (POST execute) are the in-portal coworker chat's bespoke REST contract — despite the URL, they are not actual MCP-protocol endpoints. The chat UI calls them, no need to churn that surface. The [Platform MCP Tool Server spec](./2026-04-11-platform-mcp-tool-server-design.md) had additionally proposed an internal JSON-RPC endpoint scoped to `localhost` inside the Docker network for the platform's own CLI processes (e.g. `claude -p` inside the sandbox).

For an external coding agent on the user's laptop, neither fits. We need:

- A real **MCP JSON-RPC 2.0** endpoint (`initialize`, `notifications/initialized`, `tools/list`, `tools/call`) that any MCP-capable client (Claude Code, Codex CLI, VS Code MCP) can talk to without translation.
- A reachable URL the desktop client can hit (`http://localhost:3000/api/mcp/v1` for Mode 1; TLS-fronted for deployed installs).
- A long-lived bearer credential (paste once into the client's `mcp.json`).
- An identity that resolves to a real `User` row, not an in-portal session cookie.

We add a new endpoint at `/api/mcp/v1` that speaks the canonical protocol (per the in-tree spec snapshot at [docs/Reference/mcp/](../../docs/Reference/mcp/), version `2025-11-25`), authenticates by `Authorization: Bearer <token>`, and routes through the same `governedExecuteTool` as the in-portal paths so tools, grants, and audit are one pipeline.

### 11.2 Credentials and identity — relationship to contribution mode

DPF's contribution-mode work added an install-level GitHub credential in [PlatformDevConfig](../../packages/db/prisma/schema.prisma) — singleton row with `clientId` (per-install UUID), `gitAgentEmail` (`agent-<sha256(clientId)[:16]>@hive.dpf`), `contributionModel` (`maintainer-direct` | `fork-pr`), and an encrypted GitHub token via [platform-dev-config.ts](../../apps/web/lib/actions/platform-dev-config.ts). That credential is **outbound**: it authenticates the install to GitHub when the contribution pipeline pushes code or opens PRs.

The MCP API token is **inbound**: it authenticates an external client to DPF when it calls the backlog tools.

These cannot be the same literal token (different audiences, different validators), but they are the same shape of problem and they share three concrete things:

1. **One identity model.** Both ride the same `User` row. The MCP token is issued to a logged-in user; the contribution pipeline runs commits attributed to the install's `gitAgentEmail` but signed-off by the user who triggered the work. When an external-MCP write becomes a contribution, the audit chain is unbroken: `MCP token → User → install GitHub bind → upstream PR`. This is the strong-attribution chain the [obfuscated-not-anonymous](../../C:/Users/Mark%20Bodman/.claude/projects/d--DPF/memory/feedback_obfuscated_not_anonymous.md) rule wants.
2. **One settings surface.** `/admin/platform-development` already hosts contribution-mode config. We co-locate MCP token issuance there as a sibling section ("External Coding Agent Access"). Same admin view, same revoke flow, same audit.
3. **One write-attribution gate.** Read-only MCP tokens issue freely. **Write-capable** MCP tokens require `PlatformDevConfig.contributionModel` to be set (i.e., the contribution path is wired). This guarantees that any external-MCP write that ever turns into code can be attributed end-to-end. If contribution mode is not configured, write-capable tokens are blocked at issuance with a pointer to set it up first.

### 11.3 Token model — `McpApiToken`

A new Prisma model. The name is intentionally MCP-transport-specific (not `AgentApiToken` — the token is owned by a User, not an Agent — and not just `ApiToken` because that name is already taken by the V1 customer-portal JWT-refresh model).

```prisma
model McpApiToken {
  id              String    @id @default(cuid())
  userId          String                 // issuing user
  agentId         String?                // optional: bind to a specific agent identity
  name            String                 // human label, e.g. "Mark's Claude Code (laptop)"
  tokenHash       String    @unique      // sha256 of the secret; secret never stored
  prefix          String                 // first 12 chars, for display (e.g. dpfmcp_AB12)
  scopes          String[]  @default([]) // grant keys the token may exercise (subset of user's grants)
  capability      String    @default("read") // "read" | "write" — write requires contribution-mode
  lastUsedAt      DateTime?
  expiresAt       DateTime?              // null = no expiry; UI defaults to 90 days
  revokedAt       DateTime?
  revokedReason   String?
  createdAt       DateTime  @default(now())
  user            User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, revokedAt])
  @@index([tokenHash])
}
```

Token format: `dpfmcp_<24 random bytes base32>`. Base32 alphabet is Crockford-ish (no I/L/O/U) so tokens are easier for humans to verify visually. Stored as `sha256(secret)`; the plaintext is shown to the user **once** at issuance and never recoverable — same pattern as GitHub PATs.

`scopes` is a subset of the user's effective grants, chosen at issuance. A user with `backlog_read`, `backlog_write`, `spec_plan_read` can mint a token with only `backlog_read` for a low-trust laptop. The MCP request's effective grants are `tokenScopes ∩ userGrants ∩ (agentGrants if agentId set)`.

### 11.4 External JSON-RPC endpoint

`apps/web/app/api/mcp/v1/route.ts` implements MCP JSON-RPC 2.0 per the in-tree spec snapshot at [docs/Reference/mcp/](../../docs/Reference/mcp/) (version `2025-11-25`). Specifically:

- [docs/Reference/mcp/spec/basic/lifecycle.mdx](../../docs/Reference/mcp/spec/basic/lifecycle.mdx) — `initialize` handshake, `notifications/initialized`
- [docs/Reference/mcp/spec/basic/transports.mdx](../../docs/Reference/mcp/spec/basic/transports.mdx) — Streamable HTTP (we use the single-POST flow, not SSE)
- [docs/Reference/mcp/spec/server/tools.mdx](../../docs/Reference/mcp/spec/server/tools.mdx) — `tools/list`, `tools/call`, annotations
- [docs/Reference/mcp/schema/schema.ts](../../docs/Reference/mcp/schema/schema.ts) — canonical types

```http
POST /api/mcp/v1
Authorization: Bearer dpfmcp_...
Content-Type: application/json

{ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }
```

Handler steps:

1. **Transport guards** (per spec MUST):
   - Validate `Origin` header when present (DNS rebinding protection); CLI clients with no Origin are allowed.
   - Refuse non-TLS requests except when the host is `localhost`/`127.0.0.1` (Mode 1).
2. Parse `Authorization: Bearer` header. If absent → 401 with `WWW-Authenticate: Bearer realm="DPF MCP"`.
3. `resolveMcpApiToken(plaintext)` (sha256 + lookup). Reject revoked or expired with 401 + `WWW-Authenticate`. Lazy `lastUsedAt` update on success.
4. Parse JSON-RPC envelope. Standard JSON-RPC error codes: `-32700` (parse), `-32600` (invalid request), `-32601` (method not found), `-32602` (invalid params), `-32603` (internal). Notifications (no `id`) → 202 Accepted with no body.
5. **`initialize`** → `{ protocolVersion: "2025-11-25", serverInfo, capabilities: { tools: { listChanged: false } }, instructions }`.
6. **`tools/list`** → load `User` (platformRole, isSuperuser); return tools where the user has the required capability **and** the token's scopes intersect the tool's required grants. Each tool carries `annotations` (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) per the MCP spec.
7. **`tools/call`** → token-scope pre-check (clear `isError:true` message on mismatch, no wrapper roundtrip); side-effecting tools rejected with `isError:true` for read-only tokens; otherwise `governedExecuteTool({ source: "external-jsonrpc", context: { agentId: token.agentId, apiTokenId: token.tokenId }, ... })`. Response shape: `{ content: [{ type: "text", text: <JSON-serialized ToolResult> }], isError: !success, structuredContent: result.data }` — text block carries the full structured result for clients without structured-content support; structured field mirrors `ToolResult.data` for clients that read it directly (per the 2025-11-25 spec).
8. **`ping`** → empty result.
9. The audit row in `ToolExecution` records `executionMode: "external-jsonrpc"` and the `apiTokenId` so each external call is traceable to a specific token.

`GET /api/mcp/v1` returns 405 with `Allow: POST` — we don't implement SSE since stateless single-POST is sufficient for synchronous tool calls and matches the spec's "stateless server" pattern.

### 11.4a Authorization model — GitHub PAT, not OAuth 2.1

The MCP spec requires OAuth 2.0 resource-server discovery via Protected Resource Metadata for fully compliant authorization. We **intentionally** use the GitHub-PAT pattern instead — tokens are issued by an admin from inside the portal, not via OAuth flow. The trade-off:

- Real-world MCP clients (Claude Code, Codex CLI, VS Code MCP) accept arbitrary `Authorization: Bearer X` in their `mcp.json`, so the user experience works.
- We return `WWW-Authenticate: Bearer realm="DPF MCP"` on 401 so clients that perform OAuth discovery don't fail with an opaque error — they just won't find the discovery document and fall back to the prompt-the-user path.
- We do not implement `/.well-known/oauth-protected-resource`, do not advertise an authorization server, and do not validate token audience via RFC 8707.
- A future PR can add an OAuth flow alongside if any client requires it. The token model already separates issuance (`issueMcpApiToken`) from resolution (`resolveMcpApiToken`), so an OAuth issuer would just add a new issuance entry point.

This is documented as the install's authorization model so reviewers and downstream maintainers know it is a deliberate design decision, not a missing feature.

### 11.5 Issuance flow

Settings page at `/admin/platform-development` gains a new section:

- **External Coding Agent Access**
  - Status: contribution-mode wired? (Yes/No, with a "configure" link)
  - Existing tokens table: name, prefix, capability (read/write), scopes, last used, expires, revoke button
  - "Generate token" button →
    - Modal: `name`, `capability` (radio: read / write — write disabled with explainer if contribution-mode unset), `scopes` (multi-select, defaulted from user's grants), `expiresIn` (dropdown: 30/60/90/180 days/never, default 90), optional `agentId` (dropdown of agents the user can act as)
    - Submit → server action mints secret, hashes, persists, returns plaintext **once** to the modal with copy button and a setup snippet for Claude Code / Codex / VS Code (see §11.6)

The token primitives live at [apps/web/lib/auth/mcp-api-token.ts](../../apps/web/lib/auth/mcp-api-token.ts):

```ts
export async function issueMcpApiToken(input: {
  userId: string;
  name: string;
  capability: "read" | "write";
  scopes: string[];
  expiresInDays: number | null;
  agentId?: string | null;
}): Promise<IssueMcpTokenResult>;     // ok|error union including contribution_mode_required

export async function revokeMcpApiToken(tokenId: string, reason: string): Promise<{ ok: boolean }>;

export async function resolveMcpApiToken(plaintext: string): Promise<ResolvedMcpToken | null>;
```

The session-scoped server actions wrap these with NextAuth identity in [apps/web/lib/actions/mcp-tokens.ts](../../apps/web/lib/actions/mcp-tokens.ts) — they are what the settings UI calls.

`issueMcpApiToken` enforces the contribution-mode gate when `capability=write`:

```ts
if (input.capability === "write") {
  const cfg = await prisma.platformDevConfig.findUnique({ where: { id: "singleton" } });
  if (!cfg?.contributionModel) {
    return { ok: false, error: "contribution_mode_required", message: "..." };
  }
}
```

### 11.6 Setup snippets (returned to the user at issuance)

For Claude Code (`~/.claude/mcp.json`):

```json
{
  "mcpServers": {
    "dpf": {
      "url": "http://localhost:3000/api/mcp/v1",
      "headers": { "Authorization": "Bearer dpfmcp_<your-token>" }
    }
  }
}
```

For Codex CLI / VS Code MCP: equivalent `.mcp.json` with the same URL and bearer header. The portal returns the snippet pre-filled with the user's token at issuance time. The token is shown **once**.

### 11.7 Mode 1 vs deployed installs

| Concern | Mode 1 (single install on user's box) | Deployed (multi-user, hosted) |
| ------- | ------------------------------------- | ----------------------------- |
| Endpoint URL | `http://localhost:3000/api/mcp/v1` | `https://<host>/api/mcp/v1` (TLS required) |
| Token transport | HTTP (local-only) | HTTPS — endpoint refuses non-TLS via `request.url.startsWith("http://")` check (allowed for `localhost` only) |
| Token expiry | Default 90 days, "never" allowed | Default 90 days, "never" disabled in UI for non-superusers |
| Rate limiting | Lax (single user) | Per-token rate limit (out of scope here, tracked as follow-up) |
| Network exposure | Bound to `localhost`/`127.0.0.1` by default | Behind the existing portal's reverse proxy / TLS |

The endpoint code path is identical for both — only the policy guards and infra fronting differ.

### 11.8 What this gives you on day one

After this lands, on a fresh install:

1. User runs the install, completes setup wizard.
2. User configures contribution mode (existing flow).
3. User clicks "Generate MCP token" on the same admin page, picks "write," gets a token.
4. User pastes the token into Claude Code's `mcp.json`.
5. From Claude Code on their laptop, the user can `list_backlog_items`, `get_next_recommended_work`, `record_execution_evidence`, etc. — every action is audited via `ToolExecution` with the issuing user, the token id, and `executionMode: "external-jsonrpc"`.
6. If they then ask Claude Code to make a code change that lands as a contribution PR, the chain `MCP token → user → install GitHub bind → PR` is intact.

This is the Mode 1 backlog interface the spec set out to deliver.

> **Implementation note (2026-04-26):** §11 shipped in the PR that introduced this section's edits. Token model, JSON-RPC route, settings UI, and contribution-mode gate are all live. The `AgentApiToken` name in the original draft was renamed to `McpApiToken` (the token is User-owned, not Agent-owned, and the name is now MCP-transport-specific). The endpoint settled on `/api/mcp/v1` rather than the verbose `/api/mcp/external/jsonrpc` because the URL is the canonical MCP endpoint going forward — the `external/jsonrpc` qualifier was misleading since the same endpoint can also accept session-cookie auth in a future iteration if we want to migrate the in-portal chat UI off its bespoke REST.

### 11.9 Risks and mitigations specific to §11

| Risk | Mitigation |
| ---- | ---------- |
| Stolen token gives full backlog write access | Tokens are scoped at issuance (subset of user grants), expirable, and revocable from the same admin page. `lastUsedAt` is shown in the UI so unused tokens are easy to spot and revoke. |
| Long-lived tokens drift from current grants | The MCP request resolves `tokenScopes ∩ userGrants` at every call — if the user loses a grant, every token loses it too on the next call. |
| External writes bypass contribution attribution | Write-capable tokens cannot be issued unless `PlatformDevConfig.contributionModel` is set. Read tokens never need this. |
| Token plaintext leaks via logs | Endpoint never logs the `Authorization` header. Audit row stores `apiTokenId`, not the plaintext or hash. |
| TLS bypass on a deployed install | The endpoint refuses non-TLS requests except when the host is `localhost`/`127.0.0.1` (Mode 1). |
