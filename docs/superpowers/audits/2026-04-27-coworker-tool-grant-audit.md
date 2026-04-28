# Coworker Tool-Grant Audit — Initial Report

| Field | Value |
|-------|-------|
| **Spec** | [docs/superpowers/specs/2026-04-27-coworker-tool-grant-spec-design.md](../specs/2026-04-27-coworker-tool-grant-spec-design.md) |
| **Generated** | 2026-04-28 |
| **Errors** | 103 |
| **Warnings** | 32 |
| **Baseline** | [2026-04-27-coworker-tool-grant-audit.json](./2026-04-27-coworker-tool-grant-audit.json) |
| **Sibling audit** | [Persona audit](./2026-04-27-coworker-persona-audit.md) — must land first; this audit's GRANT-006 promotes the persona audit's PERSONA-007 from warn to error |

This report is the day-one snapshot. CI uses the JSON baseline alongside it to enforce *no new violations* — every existing finding is grandfathered as known reconciliation work. Each reconciliation PR (per spec §7) shrinks both files in lockstep.

To regenerate after a reconciliation:

```sh
pnpm --filter web exec tsx scripts/audit-coworker-tool-grants.ts \
  --json-out docs/superpowers/audits/2026-04-27-coworker-tool-grant-audit.json
```

The grant catalog itself was bootstrapped from the registry by [scripts/internal/build-grant-catalog.ts](../../../apps/web/scripts/internal/build-grant-catalog.ts) — that script is one-shot and is not run again. Subsequent edits to [packages/db/data/grant_catalog.json](../../../packages/db/data/grant_catalog.json) are by hand.

---

## Headline finding: 73 of 99 registry grants are aspirational

The registry references **99 distinct grant keys**. Only **26 of them are honored by any tool implementation** in [apps/web/lib/tak/agent-grants.ts](../../../apps/web/lib/tak/agent-grants.ts). The other 73 are scope a coworker carries on paper but cannot exercise: a call to any tool requiring one of these grants would default-deny because no tool implementation declares the grant as a requirement.

This is the "aspirational scope" problem the spec calls out. The audit makes it visible by category so reconciliation can proceed value-stream by value-stream.

---

## Findings by invariant

### GRANT-002 — Catalog grant has no honored_by_tools (73 errors)

73 grant keys are present in the registry, present in the catalog, but no tool checks them. Reconciliation choices for each: (a) implement a tool that requires the grant, (b) remove the grant from the registry and the catalog, or (c) keep the grant as planned-scope and add a tracked backlog item to implement the tool.

By category:

- **governance (24):** adr_create, audit_report_create, budget_read, constraint_validate, conway_validate, credential_scan, dependency_audit, dependency_graph_read, evidence_artifact_create, evidence_chain_read, evidence_chain_validate, guardrail_validate, license_check, policy_read, regulatory_compliance_check, risk_score_create, role_registry_read, scoring_model_read, strategy_read, strategy_write, supply_chain_verify, trust_boundary_map, violation_report_create, vulnerability_scan
- **consume (10):** chargeback_write, consumer_onboard, entitlement_provision, financial_read, financial_report_create, order_create, order_write, product_instance_write, subscription_read, subscription_write
- **operate (10):** clip_route, escalation_trigger, incident_create, incident_read, incident_write, pbi_status_write, prod_status_write, retention_record_write, schedule_write, sla_compliance_write
- **integrate (6):** acceptance_package_write, integration_test_create, rollback_plan_create, runbook_execute, sbom_read, sbom_write
- **evaluate (6):** criteria_read, gap_analysis_create, gap_analysis_read, investment_proposal_create, rationalization_report_create, scope_agreement_create
- **explore (5):** architecture_guardrail_read, architecture_write, contract_read, contract_write, roadmap_create
- **release (4):** catalog_publish, change_event_emit, service_offer_read, service_offer_write
- **platform (3):** tool_evaluation_read, tool_evaluation_write, tool_verdict_create
- **portfolio (2):** portfolio_backlog_read, portfolio_backlog_write
- **deploy (2):** resource_reservation_read, resource_reservation_write
- **detect (1):** finding_create

### GRANT-003 — Tool checks grant absent from catalog (30 errors)

[agent-grants.ts](../../../apps/web/lib/tak/agent-grants.ts) defines 134 platform tools mapped to grants. Ten of those grants are not in the catalog — meaning no registry agent declares the grant either. **Any agent invoking a tool requiring one of these grants is denied.** This is the most operationally severe class of finding because it represents tools that no one can call.

Distinct undeclared grants used by tools:

- `admin_read`, `admin_write`
- `code_graph_read`
- `consumer_read`
- `deliberation_create`, `deliberation_read`
- `marketing_read`, `marketing_write`
- `registry_write`
- `web_search`

Reconciliation: for each, decide whether the grant should be added to the catalog and assigned to specific agents in the registry, or whether the tool's required grant should change to one already in the catalog (e.g., `web_search` → `external_registry_search`).

### GRANT-004 — Skill allowedTools not authorized by assigned agent's grants (32 errors)

32 skill files declare `allowedTools` whose tools are not authorized by any grant their `assignTo` agents hold. These skills cannot run as configured.

Affected skills (all):

- skills/admin/setup-branding.skill.md
- skills/build/build-page.skill.md, design-component.skill.md, manage-sandbox.skill.md, ship-feature.skill.md, start-feature.skill.md
- skills/compliance/add-regulation.skill.md, onboard-regulation.skill.md
- skills/customer/add-customer.skill.md
- skills/design/ui-ux-design-intelligence.skill.md
- skills/docs/review-structure.skill.md
- skills/employee/assign-role.skill.md, team-structure.skill.md
- skills/inventory/advance-product.skill.md, inventory-gap-audit.skill.md, version-discovery.skill.md
- skills/ops/create-item.skill.md, epic-progress.skill.md
- skills/platform/add-provider.skill.md
- skills/portfolio/find-knowledge.skill.md, find-product.skill.md, health-summary.skill.md, register-product.skill.md
- skills/storefront/campaign-ideas.skill.md, competitive-analysis.skill.md, email-campaign-builder.skill.md, extract-brand-design-system.skill.md, marketing-health.skill.md, review-inbox.skill.md, seo-content-optimizer.skill.md
- skills/workspace/backlog-status.skill.md, create-task.skill.md

Reconciliation per skill: either grant the assigned agent the missing authority, or pare the skill's `allowedTools` to what the agent actually has. A spot check suggests many of these will resolve when GRANT-003 is fixed — for example, marketing-related skills need `marketing_read`/`marketing_write` which are currently undeclared.

### GRANT-008 — Specialist with no write/execute grants (32 warnings)

32 specialists hold only read-class grants. The audit flags this because specialists are expected to perform actions, but the finding is `warn`-only — some specialists are legitimately read-only advisors. Review each during reconciliation; this is the secondary signal after GRANT-002/003/004 are addressed.

---

## Reconciliation plan

The spec's §7 staged rollout schedules reconciliation across categories. Suggested PR sequence, each shrinking the baseline by one category:

1. **Fix GRANT-003 first.** Adding catalog entries for the 10 undeclared grants (and assigning them to the right registry agents) will resolve a meaningful slice of GRANT-004 in passing. Two PRs: (a) trivially undeclared grants like `web_search` and `admin_*` get catalog entries and agent assignments, (b) `deliberation_*` and `consumer_read` may need design discussion.

2. **Fix GRANT-002 by category.** One PR per value stream — governance is the largest at 24 grants and might split into two. For each grant: implement the tool, or remove the grant.

3. **Re-run GRANT-004 after each PR.** Skills will start passing as their dependencies resolve. Direct skill fixes only for the residue.

4. **Fix GRANT-008 last.** By this point the read-only specialists will be apparent and can be either re-granted or marked as advisor-class explicitly.

5. **No-op final.** When the baseline reaches zero errors, the audit silently keeps drift out.

## What is *not* in this report

- **Persona drift in `# Tools Available` sections.** Tracked separately by the persona audit's PERSONA-007 (currently `warn`). The companion spec promotes that to error (GRANT-006 in the spec); this audit does not yet implement that check because the persona schema is not yet adopted across files. After persona backfill (per the persona audit report), this audit grows GRANT-006.
- **Persona regeneration.** The `regenerate-persona-tools-section.ts` script described in the spec's §6 is not part of PR 1; it lands once the persona schema is in place across files.
- **Runtime grant changes.** The audit reads the seed (canonical source); admin-time runtime overrides via `AgentToolGrant` are out of scope.
