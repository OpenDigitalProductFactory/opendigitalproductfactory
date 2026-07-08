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

## Phase 2 — Certification harness (BI-DE9CC88B)
1. `goldenJourneys` on the contract (per coworker: prompt, mode, expected tool call(s), oracle).
2. Runner: iterate roster → real chat/scheduled path → oracles (real-tool-call, no-false-refusal,
   no-fabrication via detectFabrication patterns + sim-harness O1–O7, advise-no-side-effect).
3. Persist as `AssuranceRun(scopeType='agent', adapterKey='coworker-cert')` + findings.
4. Nightly + post-deploy trigger (scheduled-jobs catalog); inference budget via the existing
   admission/budget gates; local-model floor respected via AgentModelConfig.
5. Roster surface: certification state chip (certified/stale/failed/never) on WorkforceRosterPanel.

## Phase 3 — Enforced activation (BI-2C4056BF)
1. lifecycleStage state machine + summonability gate in resolveAgentForRoute/summon_coworker.
2. Factory door: server action + MCP tool `establish_coworker` instantiating the template;
   Build Studio + seed converge on it. Grandfather existing agents to `defined`.

## Phase 4 — Template/skill/docs (BI-14E4F9AF)
1. Starter template + `dpf-establish-coworker` skill (dual-surface, dpf-skill-pack).
2. AGENTS.md lifecycle contract section; retire the deferred HS-D716F1D52EB3E69F archetype item.

## Verification
- Phase 1: gate runs in required Unit Tests; new-coworker simulation test proves all axes flag.
- Phase 2: certification run against the live install produces AssuranceRun rows for all roster
  coworkers; the 76-never-exercised census drops to zero for roster coworkers.
- Phase 3: an uncertified coworker cannot be summoned (functional test), roster shows stage.
