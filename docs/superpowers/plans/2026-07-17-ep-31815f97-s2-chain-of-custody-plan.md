# EP-31815F97 S2 — chain-of-custody through the execute gate

**Epic:** EP-31815F97 · **BI:** BI-F82F4E04 · **Spec:** `docs/superpowers/specs/2026-07-17-coworker-authority-model-completion-design.md` (§3 S2) · **Kernel:** DI-F2CE9FF30BB7 (founder chose chain-first)

## Goal

Make `ToolExecution` join the human-rooted chain-of-custody, so every governed tool call is traceable back to a human (TAK §7.1, GAID §10) — universally, not just in the skill-discovery path.

## Design grounding

Existing specs/plans reviewed (via search_specs_and_plans): docs/superpowers/specs/2026-07-17-coworker-authority-model-completion-design.md. Current code substrate reviewed: apps/web/lib/tak/delegation-authority.ts (DelegationChain engine: startChain/extendChain/getChainOfCustody, per-hop narrowing, MAX_DELEGATION_DEPTH=4), apps/web/lib/mcp-governed-execute.ts (writeAudit + GovernedExecuteContext), packages/db/prisma/schema.prisma (ToolExecution: userId + delegatingUserId dual-principal, no chain link).

Design-Grounding-Decision: extends the EP-31815F97 spec §3 S2; the human origin already lives on `ToolExecution` (userId/delegatingUserId) and the agent→agent hops on `DelegationChain`; this slice adds the JOIN (a nullable `delegationChainId` link) — additive, no authority change (INV-3). The migration is one nullable column + index (non-destructive).

## Model insight

`DelegationChain` models agent→agent hops (origin `startChain` requires from≠to agents); the **human origin** is not a chain row — it is the `ToolExecution.userId`/`delegatingUserId` dual-principal. So "trace to a human" = `ToolExecution` (human) + its linked `DelegationChain` (agent hops, if any). This slice records that link and provides the assembly query.

## Plan (red → green)

1. **Migration (additive, nullable):** add `ToolExecution.delegationChainId String?` + `@@index([delegationChainId])`. Hand-written migration dir `packages/db/prisma/migrations/<ts>_add_toolexecution_delegation_chain_link/migration.sql` (`ALTER TABLE … ADD COLUMN`; `CREATE INDEX`). `pnpm --filter @dpf/db generate`.
2. **Context plumbing:** add `delegationChainId?: string` to `GovernedExecuteContext`; `writeAudit` stamps `delegationChainId: data.context?.delegationChainId ?? null` onto the row.
3. **Thread the chainId** from the delegation-creating paths (skill-discovery / coworker-collaboration, which already hold the active `chainId`) into the `governedExecuteTool` context so sub-agent tool calls carry it. The common direct path (human→single coworker→tool) leaves it null; the human is still on `userId` (traceable).
4. **Custody assembly (pure-ish):** `apps/web/lib/tak/chain-of-custody.ts` — `assembleToolExecutionCustody({ execution, chainLinks })` returns `{ human: {userId, delegatingUserId}, agentId, chain: DelegationLink[], depth }` — pure given the rows; plus a thin DB reader that fetches the `ToolExecution` + `getChainOfCustody(chainId)`. Enforces INV-A3 (every execution yields a human origin) and reuses INV-A4 narrowing (chain built by existing engine).
5. **Tests (red-first):** (a) `writeAudit` stamps `delegationChainId` from context; (b) `assembleToolExecutionCustody` returns human + ordered chain hops for a delegated call, and human-only for a direct call; (c) a delegated sub-agent tool call carries the chainId end-to-end (integration with a mocked chain).

## Verification

- `pnpm --filter web exec vitest run lib/tak/chain-of-custody.test.ts lib/mcp-governed-execute*.test.ts`
- `pnpm --filter @dpf/db generate && pnpm --filter web typecheck && pnpm --filter web build`

## Non-regression

Additive column (nullable) + optional context field → no behavior change when absent. Chain writes/reads are best-effort: a chain failure must never fail a legitimate tool call (logged, not thrown). Authority unchanged (INV-3).

## Out of scope (later slices)

S1 role-baseline (BI-56E9CEC2), S3 live impact-gated autonomy, S4 authority admin UX, S5 govern MoE delegation via extendChain. AuthorizationDecisionLog on the seam + wiring DelegationChainView are follow-ons within S2/S4.
