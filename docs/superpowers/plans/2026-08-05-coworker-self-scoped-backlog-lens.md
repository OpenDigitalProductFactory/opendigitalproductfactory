# Plan — Coworker self-scoped backlog lens (`list_my_backlog` + `dpf-my-surface-backlog`)

- **BI:** BI-474A1F55 (portfolio / feature / build / medium) — EP-COMPETENCE-FLYWHEEL
- **Date:** 2026-08-05
- **Author:** scoping session (three-agent substrate sweep + two operator-ratified forks)

**For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Goal / definition of done

Give every AI coworker a common, tight, sensitivity-safe way to **see the backlog scoped to its own surface & occupation**, **open a BI**, and **file a BI** for its own capability evolution — enforced by identity, not by a filter it could widen. DoD = the BI-474A1F55 acceptance criteria.

## Operator-ratified decisions

1. **Delivery = agent tools + one tight skill** (phase 1). No portal panel in this BI.
2. **Default scope = portfolio-area ∪ profession-capability-linked BIs ∪ owned/claimed** (widest self-scope; owned/claimed always folded in). Profession→capability degrades gracefully to area+owned when trace-links are unpopulated.

## Grounded substrate (verified 2026-08-05)

| Concern | Location | Note |
|---|---|---|
| Caller identity | `context.agentId` from session token (`app/api/mcp/v1/route.ts`, `lib/mcp/session-token.ts`) | Already forwarded to every pack handler as `(params, userId, context)` |
| Scope hydration | `loadCoworkerProfile()` / `requireCurrentCoworker()` in `lib/mcp/packs/coworker-capability-pack.ts:45-155` | Module-private today; extract to shared `coworker-scope.ts` |
| Coworker portfolio link | `Agent.portfolioId` (schema.prisma:3308); `CoworkerService.portfolioId`/`personas`/`valueStreams`/`archetypes` (1829-1874) | Coworker → portfolio node |
| Occupation | `docs/professions/registry.json` `families[].roles` | agentId ↔ profession family |
| BI scope columns | `BacklogItem.portfolioId`/`taxonomyNodeId`/`digitalProductId`/`epicId`/`agentId`/`claimedByAgentId` (schema.prisma:2091-2214, indexed) | No `surface`/`occupation` column exists |
| Capability trace | `BusinessCapability` (8585, `parentId` tree) + `BusinessCapabilityTraceLink` (8608: `capabilityId`/`targetType`/`targetId`) + `BacklogItem.businessCapabilityLinks` (2201) | Profession→capability→BI bridge |
| Taxonomy/portfolio tree | `Portfolio` (747), `TaxonomyNode` (2042, `parentId` "TaxonomyTree") | Subtree descent |
| Read handlers | `lib/mcp/packs/backlog-pack-read-tools.ts` (`getBacklogItem` etc.) | Reuse `scopeData`/`backlogScopeSelect` from `backlog-scope-metadata.ts` |
| Pack registration | `lib/mcp/pack-registry.ts:66,146` | Register the new pack here |
| Grant vocabulary | `lib/tak/agent-grants.ts` `TOOL_TO_GRANTS` + `COWORKER_READ_BASELINE_GRANTS` | `list_my_backlog` → `["backlog_read"]` |
| Local/sensitivity limits | `docs/architecture/context-engineering-standards.md` | 24,576-tok window; `LOCAL_FALLBACK_MAX_TOOLS = 15`; skill body < 500 lines; `riskBand` |
| Skill dual-surface shape | `packages/dpf-skill-pack/skills/dpf-file-backlog-item/SKILL.md:1-28` | Mirror Surface A + Surface B + enforces |
| Pack test invariant | `lib/mcp/packs/coworker-capability-pack.test.ts` | Why a dedicated pack, not the capability pack (uniform-`registry_read` assertion) |

## Phases

### Phase 1 — Shared scope resolver (`coworker-scope.ts`) + tests  *(internal sequencing)*
- **New:** `apps/web/lib/mcp/packs/coworker-scope.ts` exporting:
  - `requireCurrentCoworker(context)` — moved from `coworker-capability-pack.ts` (re-exported there to keep behavior identical).
  - `resolveCoworkerBacklogScope(agentId, routeContext)` → `{ portfolioIds: string[], taxonomyNodeIds: string[], capabilityLinkedItemIds: string[], ownedAgentIds: string[], degraded: boolean }`.
    - Portfolio: coworker `Agent.portfolioId` (+ `CoworkerService.portfolioId`); taxonomy subtree = descendants of the coworker's taxonomy root(s) via `TaxonomyNode.parentId`.
    - Occupation: resolve the coworker's profession family from `registry.json` → its business-capability ids (via the family→capability mapping; if none resolvable, set `degraded=true`) → `BusinessCapabilityTraceLink` where `targetType` = BacklogItem → item ids.
    - Owned: `[agentId]` (matched against BI `agentId`/`claimedByAgentId`).
- **Refactor:** `coworker-capability-pack.ts` imports `requireCurrentCoworker` from the shared module (delete local copy). No behavior change.
- **Verify:** `pnpm --filter web vitest run coworker-scope` — unit tests for union, subtree descent, and `degraded` path (empty capability links → area+owned, no throw).

### Phase 2 — `list_my_backlog` tool + `coworker-backlog-lens` pack + grant  *(the shippable read lens)*
- **New:** `apps/web/lib/mcp/packs/coworker-backlog-lens-pack.ts`:
  - Definition `list_my_backlog` — inputSchema `{ status?, workType?, limit? }` (NO scope ids). Tight description (word-budget aware). `requiredCapability: "view_platform"`, `readOnlyHint: true`, `sideEffect: false`, all buildPhases.
  - Handler: `requireCurrentCoworker(context)` → `resolveCoworkerBacklogScope` → single `prisma.backlogItem.findMany` with `where: { OR: [ {portfolioId in ...}, {taxonomyNodeId in ...}, {itemId in capabilityLinkedItemIds}, {agentId}, {claimedByAgentId} ], ...status/workType }`, reusing `backlogScopeSelect`/`scopeData`. Return items + a status roll-up (`open`/`in-progress`/`done` counts within the slice) + `scope` echo (which portfolio/profession) + `degraded` flag.
  - `grants: { list_my_backlog: ["backlog_read"] }`.
- **Register** in `pack-registry.ts` (import + array).
- **Grant map:** add `list_my_backlog: ["backlog_read"]` to `TOOL_TO_GRANTS` in `agent-grants.ts`.
- **Verify:** pack test asserting (a) union membership, (b) **cross-portfolio isolation** — a portfolio-B-only BI never appears for a portfolio-A caller, (c) grant mirrors `TOOL_TO_GRANTS`, (d) status roll-up correctness, (e) `degraded` graceful path.

### Phase 3 — Self-scoping create default  *(small; ships with the lens)*
- Thin path so a coworker filing via the skill gets `portfolioId` + `agentId` auto-stamped from identity without passing ids. Options: (a) a `defaultsFromCoworker` helper the skill invokes, or (b) reuse `create_backlog_item` and stamp in a small wrapper `file_my_backlog_item` if the local model can't be trusted to omit ids. **Decide at build time** from whether `create_backlog_item` already tolerates identity-derived defaults; prefer NO new tool (keep under the tool cliff) — resolve scope inside the skill via `get_my_coworker_profile` + `create_backlog_item`. Only add `file_my_backlog_item` if the skill path proves unreliable on a local model.
- **Verify:** filing through the skill path produces a BI stamped with the caller's `portfolioId`+`agentId`.

### Phase 4 — `dpf-my-surface-backlog` skill  *(shippable; depends on Phase 2)*
- **New:** `packages/dpf-skill-pack/skills/dpf-my-surface-backlog/SKILL.md`, dual-surface frontmatter:
  - Surface A: `allowed-tools: mcp__dpf__list_my_backlog mcp__dpf__get_backlog_item mcp__dpf__create_backlog_item mcp__dpf__get_my_coworker_profile`.
  - Surface B: `category: ops`, `assignTo: ["*"]` (common tool), `taskType: workflow`, `triggerPattern` matching "my backlog / BIs for my surface / what's in my queue / file a BI for my area", `agentInvocable: true`, `riskBand: medium`, `composesFrom: ["dpf-file-backlog-item"]`.
  - Body < 500 lines: when-to-use / see-my-backlog (list_my_backlog) / open (get_backlog_item) / file-for-my-area (self-scoped create) / the symbiotic-evolution framing / guardrails (never widen scope; sensitive items stay in-slice).
- **Verify:** skill-pack mirror-field + seed-loader tests green; body length under budget.

## Backlog coverage

- **Umbrella BI:** BI-474A1F55
- **Decision:** `atomic` — one BI, one branch, one PR.
- **Receipt:** `cmsgq4czk0knw01o4x80vp05t` (BacklogItemActivity)
- **Deliverable graph (all internal sequencing, none independently shippable):**
  - `scope-resolver` → (none)
  - `list-my-backlog` → depends on `scope-resolver`
  - `self-scoping-create` → depends on `scope-resolver`
  - `surface-backlog-skill` → depends on `list-my-backlog`, `self-scoping-create`
- **Rationale:** the skill is inert without the tool, and the tool without the skill leaves coworkers without the guided path; splitting ships half-capabilities. Verify with `check_plan_backlog_coverage(itemId=BI-474A1F55, planPath=…, receiptId=cmsgq4czk0knw01o4x80vp05t)`.

## Risks & rollback

- **Word-budget regression:** a new MCP tool adds its description to `/platform/audit/authority` (known trap). Keep `list_my_backlog` description tight; expect a module/word-budget baseline update in the same PR.
- **Tool-cliff:** net +1 coworker tool (`list_my_backlog`); open/create reuse existing. Stay under `LOCAL_FALLBACK_MAX_TOOLS = 15`. Phase 3 deliberately avoids a second new tool unless forced.
- **Profession→capability sparsity:** if the family→capability mapping is weak, the occupation arm contributes little — hence `degraded` + graceful area+owned fallback. Not a correctness risk, a coverage one; surfaced in the response.
- **Query breadth:** the `OR` union across portfolio/taxonomy/capability/owner must stay indexed — all four columns are indexed; capability arm resolves to an id list first (bounded).
- **Isolation regression is the load-bearing test:** cross-portfolio leakage is the one behavior that must never regress; it is an explicit Phase 2 test.
- **Rollback:** remove the pack from `pack-registry.ts` + the `TOOL_TO_GRANTS` entry + disable the skill (disable-not-delete). Scope resolver + capability-pack refactor are behavior-preserving; the `requireCurrentCoworker` re-export makes Phase 1 independently revertible.
