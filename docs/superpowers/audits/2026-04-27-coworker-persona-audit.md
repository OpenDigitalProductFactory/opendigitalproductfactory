# Coworker Persona Audit — Initial Report

| Field | Value |
|-------|-------|
| **Spec** | [docs/superpowers/specs/2026-04-27-coworker-persona-audit-design.md](../specs/2026-04-27-coworker-persona-audit-design.md) |
| **Generated** | 2026-04-28 |
| **Errors** | 67 (was 89; +5 from registering 9 AGT-WS-* agents in #332, then −27 by migrating those 9 personas in this batch) |
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

49 of the 59 registry agents have no matching persona file. **10 personas have been migrated to the new schema**: Jiminy / AGT-ORCH-000 in #330, then the 9 AGT-WS-* coworkers in this PR (admin-assistant, build-specialist, customer-advisor, ea-architect, hr-specialist, onboarding-coo, ops-coordinator, platform-engineer, portfolio-advisor). The 49 remaining are agents whose persona files still need to be authored or whose existing files still need schema migration (see PERSONA-003).

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

### PERSONA-003 — Persona missing required frontmatter fields (9 errors)

9 persona files still predate the new schema. 12 of the original 21 have been migrated or addressed:
- `coo.prompt.md` migrated as Jiminy in #330
- 9 route-personas migrated as AGT-WS-* in this PR (admin-assistant, build-specialist, customer-advisor, ea-architect, hr-specialist, onboarding-coo, ops-coordinator, platform-engineer, portfolio-advisor)
- `hive-scout-archetype-gap.prompt.md` relocated to `prompts/templates/` in #332 (out of audit scope)
- `shared-identity.prompt.md` exempted with `kind: fragment` in #332

The 9 remaining files needing migration:

- prompts/route-persona/finance-agent.prompt.md *(maps to AGT-900)*
- prompts/route-persona/inventory-specialist.prompt.md *(no registry counterpart — orphan, no UI nav surface)*
- prompts/route-persona/marketing-specialist.prompt.md *(no registry counterpart — orphan, no UI nav surface)*
- prompts/specialist/data-architect.prompt.md *(maps to AGT-BUILD-DA)*
- prompts/specialist/discovery-taxonomy-gap-triage.prompt.md *(no registry counterpart)*
- prompts/specialist/frontend-engineer.prompt.md *(maps to AGT-BUILD-FE)*
- prompts/specialist/qa-engineer.prompt.md *(maps to AGT-BUILD-QA)*
- prompts/specialist/software-engineer.prompt.md *(maps to AGT-BUILD-SE)*
- prompts/specialist/ux-accessibility.prompt.md *(maps to AGT-903)*

Six of these (finance-agent + the 5 specialists with registry counterparts) are next-batch C1 work. Three (inventory-specialist, marketing-specialist, discovery-taxonomy-gap-triage) are still orphaned — no UI nav surface per the #332 directive — and remain on the audit until they're either registered or retired.

### PERSONA-005 — Persona missing required body sections (9 errors)

Same 9 files as PERSONA-003 lack the `# Role / # Accountable For / # Interfaces With / # Out Of Scope / # Tools Available / # Operating Rules` structure. 10 personas now have the structure (Jiminy + 9 AGT-WS-*). Existing prose in the 9 unmigrated files maps reasonably well into `# Operating Rules`; the other five sections are the authoring work.

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
