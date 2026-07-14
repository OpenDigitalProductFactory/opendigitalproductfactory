# Governed surface MCP tool agency guard plan

Date: 2026-07-14  
Backlog item: BI-F9204A97  
Epic: EP-8C706944  
Status: planned

## Summary

BI-F9204A97 closes the agency-by-construction gap where a portal page can read a governed queue or decision surface, but a coworker working through MCP tools cannot. The triggering example was the Founder Review / Decision Governance queue: the page-level read existed in `apps/web/lib/founder-review/queue.ts`, but the coworker initially lacked a matching read tool and had to ask the user to paste screen content.

The first concrete instance has now landed on `main`: `list_open_decision_reviews` in `apps/web/lib/mcp/packs/founder-review-pack.ts` exposes the same unresolved DecisionInteraction residue that `/platform/ai/founder-review` and `/coworker-decisions` render. The remaining BI-F9204A97 work is the durable convention and guard: every governed data surface must either register matching read/act MCP coverage or carry an explicit exemption.

## Grounded substrate

- `apps/web/lib/founder-review/queue.ts` owns the canonical Founder Review projection: `DecisionInteractionQueueRow`, blank/noise filters, dedupe, grouping, and action labels.
- `apps/web/app/(shell)/platform/ai/founder-review/page.tsx` and `apps/web/app/(shell)/coworker-decisions/page.tsx` consume that projection for human-facing review surfaces.
- `apps/web/lib/mcp/packs/founder-review-pack.ts` now defines `list_open_decision_reviews`, a read-only MCP tool that wraps the same unresolved review residue.
- `apps/web/lib/tak/decision-governance-route-context.ts` tells coworkers the page data and directs them to call `list_open_decision_reviews` rather than ask the user to paste the queue.
- `apps/web/lib/mcp-tools.ts` defines `ToolDefinition`, `screenSurface`, `sideEffect`, tool annotations, and imports `TOOL_PACK_REGISTRY`.
- `apps/web/lib/tak/agent-grants.ts` is the grant-policy source for tool visibility.
- `scripts/check-guards.mjs` is the ratchet entry point: every `scripts/check-no-*.mjs` guard and sibling `*.test.mjs` is discovered automatically by `pnpm check:guards` and CI's Repo Guard Loop.
- `AGENTS.md` already requires code-graph-first grounding, lean MCP tool descriptions, and screen/tool alignment via `screenSurface`; BI-F9204A97 should add the governed-surface convention there instead of creating a parallel process note.

No existing spec or implementation plan was found for BI-F9204A97 via `search_specs_and_plans`. Code graph freshness was high-trust at the time of planning.

## Definition of done

1. A durable convention says what counts as a governed data surface and what tool coverage it must ship with.
2. The convention is encoded in a source-controlled registry or manifest, not inferred from route names alone.
3. A repo guard fails when a registered governed surface names a required MCP tool that is not present in the platform tool catalog.
4. The guard passes for the landed Founder Review / Decision Governance read tool.
5. The guard has a self-test proving both the failing and passing cases.
6. `AGENTS.md` points future agents at the convention so a fresh thread is steered before code review.

## Implementation plan

### Phase 1 — Add the governed surface contract

Create a small shared registry, tentatively `apps/web/lib/mcp/governed-surface-tool-contracts.ts`, that is pure data and cheap to import from Node guard scripts.

Each row should include:

- `surfaceId`: stable slug, for example `decision-governance.open-reviews`.
- `routes`: human-facing routes/lenses, for example `/platform/ai/founder-review` and `/coworker-decisions`.
- `readModel`: canonical source module, for example `apps/web/lib/founder-review/queue.ts`.
- `requiredReadTools`: MCP tool names that must exist, for example `list_open_decision_reviews`.
- `requiredActTools`: MCP tool names only when the action is safe and already governed. For Founder Review, keep this empty for now because resolution is a human HITL action in the owning workflow.
- `exemption`: optional structured rationale when a surface intentionally has no coworker-readable tool.

Verification:

- Typecheck/import smoke test for the registry.
- The first registry row describes the existing Founder Review / Decision Governance open-review surface and references `list_open_decision_reviews`.

### Phase 2 — Build the guard

Add `scripts/check-no-governed-surface-without-mcp-tool.mjs`.

Guard behavior:

- Load or parse the governed surface registry.
- Build the platform tool-name set from the MCP tool catalog. Prefer a lightweight exported helper if the current `PLATFORM_TOOLS` import is safe in a Node guard; otherwise add a small generated/static extraction helper that reads the tool-pack registry without executing handlers.
- For every registry row, require each `requiredReadTools` and `requiredActTools` entry to exist in the catalog.
- Fail with a clear message naming `surfaceId`, route(s), read model, and missing tool(s).
- Allow explicit exemptions, but require a non-empty rationale and owner note so exemptions are visible debt, not silent gaps.

Verification:

- Add `scripts/check-no-governed-surface-without-mcp-tool.test.mjs`.
- Self-test covers:
  - missing required read tool fails;
  - present required read tool passes;
  - exemption without rationale fails;
  - exemption with rationale passes.
- `node --test scripts/check-no-governed-surface-without-mcp-tool.test.mjs`
- `node scripts/check-no-governed-surface-without-mcp-tool.mjs`
- `pnpm check:guards`

### Phase 3 — Document the convention in AGENTS.md

Add the rule near AGENTS.md §8 Tool Authorization / context economy:

> Governed data surfaces are coworker-reachable by default. When a page exposes a governed queue, decision surface, approval list, work item, or other operator-actionable dataset, the same source projection must be registered in the governed-surface tool contract with a matching read MCP tool, and an act tool where the action is safely governable. If no tool is appropriate, register an explicit exemption with rationale.

The rule should point to the registry and guard, not copy tool names into prose. Single source of truth stays in the registry.

Verification:

- `git diff --check`
- `pnpm check:guards` includes the new guard.

### Phase 4 — Backfill the first concrete surface

Register the existing Founder Review / Decision Governance surface:

- Surface: `decision-governance.open-reviews`
- Routes: `/platform/ai/founder-review`, `/coworker-decisions`
- Read model: `apps/web/lib/founder-review/queue.ts`
- Required read tool: `list_open_decision_reviews`
- Required act tools: none in this BI
- Rationale for no act tool: resolution remains a human HITL action after reviewing the Decision Canvas; coworker agency is read/recommend, not unilateral resolution.

Verification:

- Guard passes with this surface registered.
- Existing tests for `apps/web/lib/mcp/packs/founder-review-pack.test.ts` still pass.
- Existing Founder Review page tests still pass.

### Phase 5 — Optional follow-on sweep

After the guard lands, run a targeted sweep for other high-value governed surfaces that are page-readable but not coworker-readable: approval queues, attention queues, work capsules, compliance findings, and finance approval lists. File separate BIs for missing tools instead of expanding this PR into a broad migration.

Verification:

- Search/code-graph evidence recorded on any follow-on BIs.
- No new surfaces added to the registry without either tool coverage or explicit exemption.

## Risks and mitigations

- **False positives from heuristic route scanning.** Avoid by using an explicit registry first; do not infer every route with a server query is governed.
- **MCP tool-surface bloat.** Keep the convention aligned with the lean MCP surface standard. Prefer consolidated read tools with capped, paginated results over one tiny tool per card.
- **Unsafe action authority.** The rule is read-by-default, act-only-when-governed. Human-only HITL resolution should be documented as no act tool rather than forced into an unsafe write.
- **Stale registry rows.** Make the guard name missing tools and routes loudly; future route/file moves should update the registry in the same PR.
- **Heavy guard imports.** Keep the registry pure-data and avoid importing Prisma/runtime handlers from the guard.

## Rollback

If the guard blocks unrelated work due to an implementation flaw, revert the guard script and self-test first while leaving the registry and AGENTS.md convention in place. The existing `list_open_decision_reviews` tool is read-only and can remain safely even if the guard needs adjustment.

## Evidence to capture when implemented

- `node --test scripts/check-no-governed-surface-without-mcp-tool.test.mjs`
- `node scripts/check-no-governed-surface-without-mcp-tool.mjs`
- `pnpm check:guards`
- `pnpm --filter web exec vitest run apps/web/lib/mcp/packs/founder-review-pack.test.ts apps/web/app/(shell)/platform/ai/founder-review/page.test.tsx`
- `pnpm --filter web typecheck`
- Production build only if the implementation touches runtime page/tool behavior beyond the registry and guard.

