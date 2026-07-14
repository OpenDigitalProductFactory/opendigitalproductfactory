# BI-CAP-A11BB8BB — coworker tool-surface scope

Backlog item: BI-CAP-A11BB8BB

## Goal

Reduce the in-portal coworker tool surface before local model tool selection degrades, without revoking coworker authority. The affected intake is the inventory specialist capability need: the coworker should keep broad authorized access, but the model should receive a smaller per-turn attached tool set and load deferred tools on demand.

## Current substrate

- `apps/web/lib/actions/agent-coworker.ts` resolves the authorized platform/page tool set, applies mode/build-phase filtering, and then calls `selectCoworkerToolBudget`.
- `apps/web/lib/actions/coworker-tool-budget.ts` already separates authority from attachment: attached tools go to the model, deferred tools remain authorized and are retrievable through `load_tools`.
- `apps/web/lib/tak/context-economy-metrics.ts` defines `LOCAL_TOOL_SELECTION_CLIFF = 15` as the raw-count cliff where small local model tool selection becomes unreliable.
- The gap is in `deriveCoworkerToolCap`: exactly `32_768` served-context local models are currently treated as capable enough for the full 48-tool ceiling, even though the local selection cliff is a count/selection-quality constraint, not just a context-fit constraint.

## Plan

1. Add a failing unit test showing a 32,768-token local served context is capped at the local selection cliff, not at the full 48-tool ceiling.
2. Update `deriveCoworkerToolCap` so local served contexts at or below the 32k line use the `LOCAL_TOOL_SELECTION_CLIFF` ceiling, while larger/unknown contexts preserve the existing full ceiling.
3. Run the source-local budget tests, then the targeted coworker action tests that exercise the filtering/budget path.
4. If the shared fix also covers the near-duplicate marketing-specialist item (`BI-CAP-CBDB9A24`), record evidence there too; otherwise leave it open for the marketing-specific surface.

## Verification

- `pnpm --filter web exec vitest run lib/actions/coworker-tool-budget.test.ts`
- `pnpm --filter web exec vitest run lib/actions/coworker-tool-budget.test.ts lib/actions/agent-coworker-tool-filter.test.ts`

## Rollback

Revert the `deriveCoworkerToolCap` threshold change and its tests. Since this changes attachment only, rollback does not affect coworker grants or persisted authority.
