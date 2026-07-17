# EP-E431FC8A Phase 3 — capability broker / progressive discovery

**Epic:** EP-E431FC8A · **BI:** BI-FB0A5C82 · **Spec:** `docs/superpowers/specs/2026-07-17-coworker-capability-routing-evidence-integrity-design.md` (§7 P3)

## Goal

Replace model-driven `load_tools` discovery with a **planner-driven capability broker**: classify the turn's intent, proactively select the capability set it needs, and attach those up front — so the common case is served without a discovery round-trip and the surface stays bounded by intent, scaling to large catalogs.

## Design grounding

Existing specs/plans reviewed (via search_specs_and_plans): docs/superpowers/specs/2026-07-17-coworker-capability-routing-evidence-integrity-design.md, docs/superpowers/plans/2026-07-17-ep-e431fc8a-phase2-fidelity-eval-plan.md. Current code substrate reviewed: apps/web/lib/tak/intent-taxonomy.ts (Phase 2), apps/web/lib/actions/coworker-tool-budget.ts (tokenizeIntent/scoreToolIntentRelevance, selectLoadableTools, load_tools shim), apps/web/lib/actions/agent-coworker.ts (tier-0 force-attach).

Design-Grounding-Decision: extends the EP-E431FC8A spec §7 P3; no new contract — the broker reuses the Phase-2 taxonomy + the existing intent-relevance scorer and feeds the existing tier-0 attachment path. `load_tools` stays as the shim. Coworker authority untouched (INV-3): the broker only surfaces already-authorized tools.

## What shipped

1. `apps/web/lib/tak/capability-broker.ts` (pure) — `brokerCapabilities({ routeContext, message, tools, maxBrokered })` → the intent's authoritative tools (from the taxonomy) + top keyword-relevant tools, bounded, present only if already available. Distinct from Phase 1's static route domainTools: it can surface capabilities BEYOND the route (e.g. `/ops/self-upgrade` + a provider question → `resolve_model_selection`).
2. `agent-coworker.ts` — the broker's picks are unioned into the tier-0 force-attach set, so planner-selected capabilities always ride under the cap.

## Verification

- `pnpm --filter web exec vitest run lib/tak/capability-broker.test.ts lib/tak/intent-taxonomy.test.ts lib/tak/evidence-requirement.test.ts lib/actions/coworker-tool-budget.test.ts`
- `pnpm --filter web typecheck && pnpm --filter web build`

## Non-regression

The broker only reprioritizes attachment among already-authorized tools; on a non-live-state turn it returns an empty set (no change). `load_tools` and AUTO_LOAD remain for the long tail.

## Out of scope

Phase 4 (BI-17ACD329) — specialist delegation (MoE) + grant-source reconciliation — reuses this broker + the taxonomy to route sub-tasks to narrow-surface specialists.
