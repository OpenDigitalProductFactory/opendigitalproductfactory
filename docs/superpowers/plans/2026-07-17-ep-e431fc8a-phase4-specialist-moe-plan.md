# EP-E431FC8A Phase 4 — specialist delegation (MoE), recommend-only

**Epic:** EP-E431FC8A · **BI:** BI-17ACD329 · **Spec:** `docs/superpowers/specs/2026-07-17-coworker-capability-routing-evidence-integrity-design.md` (§7 P4) · **Kernel:** DI-D1C241BCCBF0

## Goal

Complete the mixture-of-experts layer: route a turn whose intent belongs to a specialist coworker to that specialist. Per the kernel decision (recommend-only, composite 10.79, high confidence — least-privilege beats auto-escalation), this ships the routing MECHANISM and makes the grant-source drift visible, WITHOUT unilaterally escalating coworker authority.

## Design grounding

Existing specs/plans reviewed (via search_specs_and_plans): docs/superpowers/specs/2026-07-17-coworker-capability-routing-evidence-integrity-design.md, docs/superpowers/plans/2026-07-17-ep-e431fc8a-phase3-capability-broker-plan.md. Current code substrate reviewed: apps/web/lib/tak/intent-taxonomy.ts (Phase 2), apps/web/lib/tak/capability-broker.ts (Phase 3), apps/web/lib/tak/agent-grants.ts (getAgentToolGrantsAsync DB-first/JSON-fallback), packages/db/src/workforce-seed.ts (HARDCODED_COWORKER_GRANTS), packages/db/data/agent_registry.json, apps/web/lib/mcp-tools.ts (summon_coworker/request_coworker/spawn_work_thread delegation tools).

Design-Grounding-Decision: extends the EP-E431FC8A spec §7 P4; kernel-governed (DI-D1C241BCCBF0) to recommend-only — NO authority change. Reuses the Phase-2 taxonomy + Phase-3 broker; coworker authority untouched (INV-3).

## What shipped

1. `apps/web/lib/tak/specialist-router.ts` (pure) — `SPECIALIST_BY_TASK_CLASS` + `routeToSpecialist({ taskClass, currentAgentId })` → the owning specialist recommendation, or null when the current coworker already owns the class. Recommendation only; ready to drive delegation once governance grants it.
2. `agent-coworker.ts` — computes the recommendation from the brokered intent and LOGS it (`[specialist-router]`) for observability. No delegation, no authority change.
3. `packages/db/src/coworker-grant-consistency.ts` + test — `findGrantDivergences` makes the DB-seed-vs-JSON grant drift VISIBLE and RATCHETED (`KNOWN_GRANT_DIVERGENCES` pins the current 19/20 diverging coworkers; a NEW divergence fails CI).
4. **BI-56E9CEC2** filed (deferred to founder): decide the correct grant set per agent — an authority decision — then make one source authoritative and shrink the known-divergence list.

## Verification

- `pnpm --filter web exec vitest run lib/tak/specialist-router.test.ts lib/tak/capability-broker.test.ts lib/tak/intent-taxonomy.test.ts`
- `pnpm --filter @dpf/db exec vitest run src/coworker-grant-consistency.test.ts`
- `pnpm --filter web typecheck && pnpm --filter web build`

## Non-regression

Router is pure and only logged — no behavior or authority change. The grant guard is additive (a new test). `load_tools`, the broker, and the evidence gate are untouched.

## Governance boundary

Enabling auto-delegation (granting `thread_write` to coordinators + acting on the recommendation) and resolving the grant-set drift are founder-governed (kernel DI-D1C241BCCBF0; BI-56E9CEC2). This PR delivers everything up to that boundary: the epic's MoE routing is mechanically complete and safe, awaiting the governed authority grant to switch from recommend to act.
