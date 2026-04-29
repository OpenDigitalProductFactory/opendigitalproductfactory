# Coworker Persona Audit — Initial Report

| Field | Value |
|-------|-------|
| **Spec** | [docs/superpowers/specs/2026-04-27-coworker-persona-audit-design.md](../specs/2026-04-27-coworker-persona-audit-design.md) |
| **Generated** | 2026-04-28 |
| **Errors** | 89 (was 92; first persona migrated 2026-04-28 — Jiminy / AGT-ORCH-000) |
| **Warnings** | 0 |
| **Baseline** | [2026-04-27-coworker-persona-audit.json](./2026-04-27-coworker-persona-audit.json) |

This report is the day-one snapshot. CI uses the JSON baseline alongside it to enforce *no new violations* — every existing finding is grandfathered as known backfill work. As personas are filled in (PR 2..N per the spec's §5 staged rollout), each fix shrinks both files in lockstep.

To regenerate after a persona change:

```sh
pnpm --filter web exec tsx scripts/audit-coworker-personas.ts \
  --json-out docs/superpowers/audits/2026-04-27-coworker-persona-audit.json
```

Then update this markdown report's counts and lists by hand, or rerun the report-generation step.

---

## Findings by invariant

### PERSONA-001 — Registry agent has no persona file (49 errors)

49 of the 50 agents in [agent_registry.json](../../../packages/db/data/agent_registry.json) have no matching persona file. The 20 remaining un-migrated existing files in `prompts/route-persona/` and `prompts/specialist/` do not yet declare an `agent_id` frontmatter field, so the audit cannot link them to registry entries. **AGT-ORCH-000 (Jiminy / coo-orchestrator) was migrated 2026-04-28** as the first C1 batch — see [2026-04-28-coworker-context-topology.md](./2026-04-28-coworker-context-topology.md) for the topology decision that informed the persona content. All other registry agents remain reported as missing until the new frontmatter is added (see PERSONA-003) and a persona file is created for each (see backfill plan below).

**Orchestrators (9):** AGT-ORCH-000, AGT-ORCH-100, AGT-ORCH-200, AGT-ORCH-300, AGT-ORCH-400, AGT-ORCH-500, AGT-ORCH-600, AGT-ORCH-700, AGT-ORCH-800.

**Evaluate VS specialists (4):** AGT-100, AGT-101, AGT-102, AGT-190.

**Explore VS specialists (4):** AGT-110, AGT-111, AGT-112, AGT-113.

**Integrate VS specialists (3):** AGT-120, AGT-121, AGT-122.

**Deploy VS specialists (3):** AGT-130, AGT-131, AGT-132.

**Release VS specialists (3):** AGT-140, AGT-141, AGT-142.

**Consume VS specialists (3):** AGT-150, AGT-151, AGT-152.

**Operate VS specialists (3):** AGT-160, AGT-161, AGT-162.

**Govern VS specialists (3):** AGT-170, AGT-171, AGT-172.

**Detect / Respond (3):** AGT-180, AGT-181, AGT-182.

**Infrastructure (5):** AGT-900, AGT-901, AGT-902, AGT-903, AGT-904.

**Build sub-agents (4):** AGT-BUILD-DA, AGT-BUILD-SE, AGT-BUILD-FE, AGT-BUILD-QA.

**Recipient-pattern specialists (3):** AGT-S2P-POL, AGT-S2P-PFB, AGT-R2D-PB.

### PERSONA-003 — Persona missing required frontmatter fields (20 errors)

20 persona files predate the schema and lack the new required fields (`agent_id`, `reports_to`, `delegates_to`, `value_stream`, `hitl_tier`, `status`). The 21st (`coo.prompt.md`, now Jiminy) was migrated 2026-04-28. Listed for reference; one fix per file in the backfill PRs.

- prompts/route-persona/admin-assistant.prompt.md
- prompts/route-persona/build-specialist.prompt.md
- prompts/route-persona/coo.prompt.md
- prompts/route-persona/customer-advisor.prompt.md
- prompts/route-persona/ea-architect.prompt.md
- prompts/route-persona/finance-agent.prompt.md
- prompts/route-persona/hr-specialist.prompt.md
- prompts/route-persona/inventory-specialist.prompt.md
- prompts/route-persona/marketing-specialist.prompt.md
- prompts/route-persona/onboarding-coo.prompt.md
- prompts/route-persona/ops-coordinator.prompt.md
- prompts/route-persona/platform-engineer.prompt.md
- prompts/route-persona/portfolio-advisor.prompt.md
- prompts/specialist/data-architect.prompt.md
- prompts/specialist/discovery-taxonomy-gap-triage.prompt.md
- prompts/specialist/frontend-engineer.prompt.md
- prompts/specialist/hive-scout-archetype-gap.prompt.md
- prompts/specialist/qa-engineer.prompt.md
- prompts/specialist/shared-identity.prompt.md
- prompts/specialist/software-engineer.prompt.md
- prompts/specialist/ux-accessibility.prompt.md

Note: `shared-identity.prompt.md` is a composition fragment, not a coworker persona. The schema may need a special-case `kind: fragment` exemption — flagged as a refinement under spec §6 Open Questions.

### PERSONA-005 — Persona missing required body sections (20 errors)

20 of the original 21 persona files lack the `# Role / # Accountable For / # Interfaces With / # Out Of Scope / # Tools Available / # Operating Rules` structure. `coo.prompt.md` (Jiminy) now has all six sections; the other 20 are the backfill work. Existing prose in those files maps reasonably well into `# Operating Rules`; the other five sections are the authoring work.

---

## Backfill plan

The spec's §5 staged rollout schedules backfill in tier/value-stream batches. Suggested PR sequence:

1. **Backfill orchestrators (1 PR, 9 personas)** — AGT-ORCH-000 through AGT-ORCH-800. The COO persona already exists at [coo.prompt.md](../../../prompts/route-persona/coo.prompt.md) and only needs schema migration; the other eight need full authorship from the registry's `capability_domain` and IT4IT section pointers.

2. **Backfill build sub-agents (1 PR, 4 personas)** — AGT-BUILD-DA/SE/FE/QA. The four matching specialist personas already exist and only need migration to the new schema plus the four required sections beyond `# Operating Rules`.

3. **Backfill specialists by value stream (8 PRs, ~30 personas)** — one PR per VS: evaluate, explore, integrate, deploy, release, consume, operate, govern + detect/respond.

4. **Backfill infrastructure agents (1 PR, 5 personas)** — AGT-900..904.

5. **Backfill recipient-pattern specialists (1 PR, 3 personas)** — AGT-S2P-POL, AGT-S2P-PFB, AGT-R2D-PB.

Each backfill PR runs the audit with `--json-out` and commits both the JSON baseline and an updated count in this markdown report. When the baseline reaches zero errors, the gate is silently in full effect for everything new.

## What is *not* in this report

- **Tool-grant correctness.** The companion spec ([2026-04-27-coworker-tool-grant-spec-design.md](../specs/2026-04-27-coworker-tool-grant-spec-design.md)) audits whether each coworker has the right tools. PERSONA-007 in this audit is warn-only; the same check is promoted to error under GRANT-006 once that audit lands.
- **A2A communication.** Tracked separately, see the standalone prompt at [docs/prompts/a2a-coworker-substrate-prompt.md](../../prompts/a2a-coworker-substrate-prompt.md).
- **Runtime persona overrides.** Admin > Prompts can override `PromptTemplate.content` at runtime; the audit only checks the seed (canonical source).
