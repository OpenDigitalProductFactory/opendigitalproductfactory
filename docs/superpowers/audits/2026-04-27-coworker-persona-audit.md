# Coworker Persona Audit — Initial Report

| Field | Value |
|-------|-------|
| **Spec** | [docs/superpowers/specs/2026-04-27-coworker-persona-audit-design.md](../specs/2026-04-27-coworker-persona-audit-design.md) |
| **Generated** | 2026-04-28 |
| **Errors** | 43 (down from 92 day-one. Trajectory: #330 Jiminy → 89, #332 register 9 + #333 migrate 9 → 67, #334 migrate 6 → 49, this PR register 2 + migrate 2 + relocate 1 template → 43) |
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

### PERSONA-001 — Registry agent has no persona file (43 errors)

43 of the 61 registry agents have no matching persona file. **18 personas have been migrated to the new schema**: Jiminy / AGT-ORCH-000 (#330), the 9 AGT-WS-* coworkers from #333 (admin-assistant, build-specialist, customer-advisor, ea-architect, hr-specialist, onboarding-coo, ops-coordinator, platform-engineer, portfolio-advisor), the 6 from #334 (AGT-BUILD-DA/SE/FE/QA, AGT-903 ux-accessibility, AGT-900 finance-agent), and 2 from this PR (AGT-WS-INVENTORY inventory-specialist, AGT-WS-MARKETING marketing-specialist). The 43 remaining are agents whose persona files still need to be authored — primarily the 8 value-stream orchestrators (AGT-ORCH-100..800), 28 value-stream specialists, and 4 infrastructure/recipient-pattern agents.

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

### PERSONA-003 — Persona missing required frontmatter fields (0 errors — RESOLVED)

All 21 original persona files have been migrated, exempted, or relocated:

- `coo.prompt.md` migrated as Jiminy in #330
- 9 route-personas migrated as AGT-WS-* in #333 (admin-assistant, build-specialist, customer-advisor, ea-architect, hr-specialist, onboarding-coo, ops-coordinator, platform-engineer, portfolio-advisor)
- 6 migrated in #334 (data-architect, software-engineer, frontend-engineer, qa-engineer, ux-accessibility, finance-agent)
- 2 migrated in this PR (inventory-specialist, marketing-specialist) after a usage investigation revealed they are wired to seed.ts grants and skills, owning a daily scheduled task (Discovery Taxonomy Gap Triage) and being addressable via calendar scheduler. They got AGT-WS-INVENTORY and AGT-WS-MARKETING registry entries with seed-sourced grants.
- `hive-scout-archetype-gap.prompt.md` relocated to `prompts/templates/` in #332 (a backlog-item template, not a persona)
- `discovery-taxonomy-gap-triage.prompt.md` relocated to `prompts/templates/` in this PR (a scheduled-task documentation file; the actual triage prompt is constructed in code at `packages/db/src/discovery-triage-config.ts:9-17`, not loaded from this file)
- `shared-identity.prompt.md` exempted with `kind: fragment` in #332

### PERSONA-005 — Persona missing required body sections (0 errors — RESOLVED)

All 18 migrated personas now have the six-section structure (`# Role` / `# Accountable For` / `# Interfaces With` / `# Out Of Scope` / `# Tools Available` / `# Operating Rules`). Same migration trail as PERSONA-003.

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
