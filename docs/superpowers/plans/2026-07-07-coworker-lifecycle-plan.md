# AI Coworker Lifecycle — implementation plan

- **Epic:** EP-COWORKER-LIFECYCLE · **Spec:** docs/superpowers/specs/2026-07-07-coworker-lifecycle-standard-design.md
- **Kernel decision:** principle_decide 2026-07-07 → option C (full lifecycle epic), confidence high.

## Phase 1 — Definition contract + conformance gate (BI-53ABC4A4)

**Slice 1 (this PR):**
1. `@dpf/db` subpath exports for `workforce-seed`, `agent-model-defaults`, `seed-skills`.
2. Derive `SKILL_WILDCARD_AGENT_IDS` from the roster + bootstrap agents (fixes `docs-specialist`
   phantom + five missing coworkers); `reconcileSkillAssignments` accepts readonly lists.
3. `apps/web/lib/coworker-lifecycle/coworker-definition.ts` — pure contract + LIFE-001…009 checks.
4. Conformance vitest gate + committed baseline (8 LIFE-003 route gaps remain; may only shrink).
5. Model floors for data-steward / dispatcher / legal-operations-counsel.
6. Spec + this plan; epic/BI wiring via MCP.

**Slice 2 (follow-up):**
- Fold `coworker-service-catalog-seed` + professions-registry + registry-mirror alignment checks
  into the gate (LIFE-010…) once their owners confirm intended shape.
- Decide route placement for the 8 unbound coworkers (UX decision per coworker, dpf-ux-fit-review)
  and shrink the baseline to zero.
- Begin the `catalog/agents.ts` single-source consolidation from the 2026-04-28 design, with the
  contract type as the catalog row type.

## Phase 2 — Certification harness (BI-DE9CC88B) — SHIPPED (slice 1)

As-built (apps/web/lib/coworker-lifecycle/):
1. `golden-journeys.ts` — every roster coworker gets a DERIVED read-only probe automatically
   (zero authoring for new coworkers); curated domain journeys replace it where richer
   (marketing/inventory/ops seeded). Journeys are read-only by contract.
2. `certification-oracles.ts` — pure verdicts per journey: ORACLE-SURFACE (non-empty read-only
   tool surface), ORACLE-TOOL (≥1 successful call), ORACLE-PURITY (nothing ran outside the
   surface), ORACLE-FABRICATE / ORACLE-REFUSAL (reuse the production `detectFabrication` /
   `detectToolRefusedDespiteAvailability`); downgraded-provider runs skip prose oracles but
   still require the tool call.
3. `certification-runner.ts` — composes the REAL path (`resolveAutonomousWorkAgent` →
   `resolveAutonomousWorkTools` post-filtered to `sideEffect=false` → `runAgenticLoop` with
   `interactionMode:"chat"`, synthetic threadId, model floor via
   `applyProviderRouteModelPreference`); persists one `AssuranceRun(scopeType='agent',
   adapterKey='coworker-cert')` per coworker + oracle findings (prefix
   `coworker-cert:<agent>:<journey>:<oracle>`, reopen-on-regress, absent-clean per agent —
   patch-intel conventions). Runs as the first superuser; empty sweep on fresh installs.
4. `certification-status.ts` — light reader deriving certified/failed/stale(>8d)/never;
   consumed by the workforce roster without importing the loop.
5. Nightly Inngest job `ops/coworker-certification-nightly` (04:40, quiescence-gated,
   self-serialized) + `ops/coworker-certification.requested` run-now event; catalog entry
   `coworker-certification`.
6. Roster surface: `AgentNeeds.certification`/`certificationAt` + pill on WorkforceRosterPanel.

Deferred to later Phase 2 slices: advise-mode journey variants, sim-harness O1–O7 composition
for the dispatch domain, post-deploy trigger hook, per-coworker journey authoring in the
Phase 1 contract file.

## Phase 3 — Enforced activation (BI-2C4056BF) — SHIPPED (slice 1)

As-built. `Agent.lifecycleStage` becomes load-bearing over its EXISTING vocabulary — "draft"
and "production" are the stored load-bearing states; "defined" and "certified" are derived
facts (roster membership, coworker-cert AssuranceRuns), not new stored stages. Every seeded
agent is already "production", so nothing is grandfathered by migration — the gate simply
blocks states no live agent is in yet:

1. `apps/web/lib/coworker-lifecycle/lifecycle-gate.ts` — `evaluateLifecycleGate(agentRef,
   {purpose})`: draft + retirement always blocked; certification-`failed` blocked only under
   the `COWORKER_LIFECYCLE_STRICT` PlatformConfig flag (seeded off — never/stale-certified
   grandfathered agents keep working); purpose "certification" bypasses (no deadlock);
   unknown agentIds allowed (route-synthetic personas); fail-open on infra errors.
2. Wired at the three resolution chokepoints: `resolveAutonomousWorkAgent` (scheduled tasks,
   spawned child threads, remote MCP task submission — throws `COWORKER_NOT_SUMMONABLE`),
   `sendMessage` in agent-coworker.ts (chat — returns `{error}` to the panel), and
   `resolveTargetOrThrow` in coworker-collaboration.ts (summon/handoff targeting). The
   certification runner passes purpose "certification".
3. Factory door: `establish-coworker.ts` (`establishCoworker` validates slug/fields/known
   grant keys, creates the Agent row at lifecycleStage "draft" + tombstone-honoring grants +
   model floor + principal link, returns the code-side definition checklist;
   `promoteCoworker` flips draft → production only when the agent is in
   COWORKER_AGENT_SEEDS AND holds a passing certification) exposed as the
   `establish_coworker` MCP tool (coworker-establish-pack, `manage_platform` capability,
   `agent_control_read` grant tier, actions establish|promote).

Deferred to later slices: Build Studio + seed converging on the factory door, a server
action UI surface, strict-mode default-on once sweeps are established on live installs.

## Phase 4 — Template/skill/docs (BI-14E4F9AF)
1. Starter template + `dpf-establish-coworker` skill (dual-surface, dpf-skill-pack).
2. AGENTS.md lifecycle contract section; retire the deferred HS-D716F1D52EB3E69F archetype item.

## Verification
- Phase 1: gate runs in required Unit Tests; new-coworker simulation test proves all axes flag.
- Phase 2: certification run against the live install produces AssuranceRun rows for all roster
  coworkers; the 76-never-exercised census drops to zero for roster coworkers.
- Phase 3: an uncertified coworker cannot be summoned (functional test), roster shows stage.
