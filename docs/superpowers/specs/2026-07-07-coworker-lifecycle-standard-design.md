# AI Coworker Lifecycle Standard — definition contract, conformance gate, behavioral certification, enforced activation

- **Epic:** EP-COWORKER-LIFECYCLE
- **Backlog:** BI-53ABC4A4 (Phase 1), BI-DE9CC88B (Phase 2), BI-2C4056BF (Phase 3), BI-14E4F9AF (Phase 4)
- **Kernel decision:** `principle_decide` 2026-07-07, option `C-full-lifecycle-epic`, confidence high (composite 11.13, margin 3.44 over the static-gate-only runner-up); governing profile: platform. Top-aligned commandments: Research and Use Standards, Never Assume — Verify, Single Source of Truth, Ship Real Functionality.
- **Status:** Phase 1 slice 1 shipped in this spec's PR; Phases 2–4 designed here, built per plan.

## 1. Problem

Coworker defects surface incrementally, late, and in production, because a coworker has no
defined lifecycle. Evidence gathered 2026-07-07 against the live install and origin/main:

- **88 registered agents; 76 (86%) have never been exercised** — no message, scheduled task,
  engagement, or task run, ever. Only 2 (inventory-specialist, external-catalog-scout) have real
  volume.
- **Definition is scattered across ≥10 hand-aligned places** (roster, grants map, registry mirror,
  route persona map, route-context map, model floors, skill wildcard list, service catalog,
  self-task registry, professions registry). The four-place grant problem is already documented in
  `docs/superpowers/specs/2026-04-28-eliminate-seed-as-data-load-design.md` ("Class B") and its
  consolidation was never implemented.
- **Definition completeness was uneven**: 5/88 agents had any skill assignment (the wildcard list
  had drifted: a phantom `docs-specialist` plus five roster coworkers missing); 18/88 had model
  configs; `AgentGovernanceProfile` has 0 rows; `AgentPerformance` has 0 rows.
- **Mechanism tests are thick, journey coverage is zero-in-CI**: grant vocabulary, advise-mode
  stripping, fabrication detection, and self-task reconcile are all unit-tested, but no pipeline
  ever sends a coworker a message and asserts a real tool call. The playwright e2e specs are
  manual; the coworker-sim-harness is an island consumed only by its own tests.
- **The recurring failure classes are all definition/verification gaps found late**: grant
  drift and false refusals (~13 duplicate `BI-PIR-*` items for one tool), fabrication on weak
  models (#2685), advise-strip surprises (#2576), dropped `modelRequirements` on new dispatch
  paths, fail-open governance profiles.

Without a lifecycle substrate, every new coworker recreates these classes.

## 2. Architecture (kernel-ratified option C)

Four phases, each independently landable; each later phase consumes the earlier one.

### Phase 1 — CoworkerDefinition contract + conformance gate (BI-53ABC4A4)

One assembled, typed view per coworker (`CoworkerDefinition`) plus a cross-source conformance
checker that runs as a **required Unit Tests** vitest gate — not an advisory workflow.

- Module: `apps/web/lib/coworker-lifecycle/coworker-definition.ts` (pure; sources injected).
- Gate: `apps/web/lib/coworker-lifecycle/coworker-definition-conformance.test.ts`.
- Baseline: `coworker-definition-baseline.json` — pre-existing gaps only; the gate fails on any
  NEW finding **and** on stale baseline entries, so the ratchet only tightens. Regeneration is
  sanctioned via `UPDATE_COWORKER_DEFINITION_BASELINE=1` (Module Size Guard `--update` pattern);
  the diff is reviewed in the PR.

Checks (slice 1): LIFE-001 grants present · LIFE-002 every granted key honored by ≥1 tool ·
LIFE-003 reachable via ≥1 route · LIFE-004 route personas bind real agents · LIFE-005 model floor
present · LIFE-006 model-floor rows reference real agents · LIFE-007 ROUTE_AGENT_MAP ↔
ROUTE_CONTEXT_MAP sensitivity agreement (the USE_UNIFIED_COWORKER transition contract) · LIFE-008
skill wildcard reaches every roster coworker and only real agents · LIFE-009 self-tasks reference
roster coworkers.

Complementary, not duplicative: `audit-coworker-personas.ts` / `audit-coworker-tool-grants.ts`
(advisory, registry↔persona and grant-catalog axes) and the seed.test.ts profession-binding
invariant stay as-is. Later slices fold the full single-source `catalog/agents.ts` end-state from
the 2026-04-28 design into this contract.

Slice 1 also fixes drift the gate exposed:
- `SKILL_WILDCARD_AGENT_IDS` is now **derived** from `COWORKER_AGENT_SEEDS` +
  `ONBOARDING_AGENT_GRANTS` (Single Source of Truth) — fixing the `docs-specialist` phantom and
  reaching five previously skill-less coworkers.
- Model floors added for data-steward, dispatcher, legal-operations-counsel (LIFE-005).
- Remaining baseline: 8 LIFE-003 route-binding gaps (compliance-officer, data-architect,
  data-steward, dispatcher, doc-specialist, external-catalog-scout, finance-controller,
  legal-operations-counsel) — route placement is a UX decision handled in the epic, not silently
  invented by the gate.

### Phase 2 — Behavioral certification harness (BI-DE9CC88B) — slice 1 shipped 2026-07-08

Per-coworker certification runs hosted on the **existing** `AssuranceRun`/`AssuranceFinding`
substrate (`scopeType='agent'`, `adapterKey='coworker-cert'` — today used only by
`estate/patch-intel`). For each roster coworker: N golden journey prompts through the REAL chat
path (advise and act) and the scheduled-task path. Oracles assert: a real tool call occurred
(the anti-fabrication oracle reuses `detectFabrication` patterns and the sim-harness O1–O7
oracles), granted tools are not falsely refused (kills the BI-PIR duplicate class at the root),
structured output lands, mode contract respected (advise runs produce no side effects).
Trigger: nightly + post-deploy; results surface as certification state (certified / stale /
failed / never-certified) on the workforce roster. Golden journeys live next to the definition —
the contract from Phase 1 gains a `goldenJourneys` field.

### Phase 3 — Enforced activation lifecycle (BI-2C4056BF) — slice 1 shipped 2026-07-09

`Agent.lifecycleStage` becomes load-bearing: `draft → defined → certified → active`. A coworker
that is not definition-conformant and certified is not summonable and renders honestly on the
roster. One **factory door** (server action + MCP tool) instantiates the canonical template from
any dev surface — Build Studio, MCP clients, seed — closing the two-population drift (19 roster
vs 67 registry agents). Existing agents grandfather to `defined`.

As-built (slice 1): enforcement rides the EXISTING lifecycleStage vocabulary — stored
load-bearing states are `draft` (factory-door creations; blocked by the lifecycle gate at all
three resolution chokepoints) and `production` (summonable); `defined`/`certified` are derived
facts checked at promotion time (roster membership + passing coworker-cert run), not new stored
stages. Strict certification enforcement (blocking failed-certification agents) ships behind
the `COWORKER_LIFECYCLE_STRICT` PlatformConfig flag, seeded off; grandfathered agents keep
working while never/stale-certified. The `establish_coworker` MCP tool (actions
`establish`/`promote`) is the factory door; it returns the code-side definition checklist the
Phase 1 conformance gate enforces.

### Phase 4 — Template, skill, docs (BI-14E4F9AF) — shipped 2026-07-09

Coworker starter template (supersedes deferred HS-D716F1D52EB3E69F), a `dpf-establish-coworker`
skill walking the factory door + certification, and the AGENTS.md lifecycle contract section.
Convention backed by the gates, not by trust.

As-built: skill at `packages/dpf-skill-pack/skills/dpf-establish-coworker/SKILL.md`
(dual-surface); AGENTS.md §8 lifecycle contract; the door-returned checklist serves as the
starter template (generated, so it cannot drift the way a static template file would).
**With this, all four phases of the epic have shipped their first slices** — the lifecycle is
enforced end to end: definition-conformance CI gate (#2696) → nightly behavioral certification
(#2709) → summonability gating + factory door (#2718) → paved-road skill + contract (this PR).

## 3. The de-facto creation checklist (superseded by the establish_coworker door + skill)

A new coworker today touches, in order: `COWORKER_AGENT_SEEDS` → `HARDCODED_COWORKER_GRANTS`
(keys must be honored by `TOOL_TO_GRANTS`) → `agent_registry.json` mirror (if EA/exec profile
needed) → `ROUTE_AGENT_MAP` persona + `route-context-map` sensitivity mirror →
`AGENT_MODEL_CONFIG_DEFAULTS` → skills (`.skill.md` / dpf-skill-pack; wildcard list is now
derived) → `coworker-service-catalog-seed` (if offered as a service) → `COWORKER_SELF_TASKS`
(optional autonomy) → `docs/professions/registry.json`. The Phase 1 gate now fails CI when the
load-bearing subset is incomplete.

## 4. Non-goals (this spec)

- Scoring model/endpoint capability (the golden-set eval substrate does that; it certifies
  models, not coworkers).
- Replacing the advisory persona/grant audits.
- Route-placement UX for the 8 unbound coworkers (epic work items, decided per-coworker).
