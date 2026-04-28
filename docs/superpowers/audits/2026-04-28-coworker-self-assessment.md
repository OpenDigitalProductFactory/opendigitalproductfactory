# Coworker Tooling Self-Assessment — Initial Report

| Field | Value |
|-------|-------|
| **Phase** | 1 of 3 (discover gaps) |
| **Generated** | 2026-04-28 |
| **Method** | In-conversation reasoning by Claude Opus 4.7 against a rendered prompt pack ([prompts](./2026-04-28-coworker-self-assessment-prompts.json)). Each response is the model reasoning *as* the named coworker, given that coworker's registry entry, persona (where present), and tool envelope. No production routing layer used — Phase 3 graduates this to `routeAndCall`. |
| **Coworkers assessed** | 50 (all in [packages/db/data/agent_registry.json](../../../packages/db/data/agent_registry.json)) |
| **Sibling audits** | [Persona audit](./2026-04-27-coworker-persona-audit.md) (#316), [Tool-grant audit](./2026-04-27-coworker-tool-grant-audit.md) (#317) |
| **Out of scope** | A2A communication substrate (separate concern, see [docs/prompts/a2a-coworker-substrate-prompt.md](../../prompts/a2a-coworker-substrate-prompt.md)) |
| **Primary goal** | Phase 1 — produce a candid gap census of tool envelope vs. job description across the entire coworker roster, organized by gap class so Phase 2 can ship reconciliation in batches. |

---

## Executive summary

| Verdict | Count | Coworkers |
|---|---|---|
| **blocked** — cannot perform core duties with current envelope | 28 (56%) | nearly every value-stream specialist; most orchestrators |
| **gaps** — meaningful work possible, important capabilities missing | 20 (40%) | Build sub-agents, Explore VS, Operate monitoring, registry-backlog roles |
| **adequate** — tools cover job description | 2 (4%) | AGT-903 (ux-accessibility), AGT-904 (documentation-specialist) |

**75 blocker-level missing-tool findings. 26 important-level findings. 11 ambiguous-boundary findings. 1 over-allocation finding.**

The dominant pattern: **65 of 73 aspirational grants from the tool-grant audit are needed by at least one role.** The 73 aspirational grants are not bloat — they are real role requirements the platform has not yet implemented. Reconciliation is "build the tools," not "delete the grants."

The two adequate coworkers (AGT-903, AGT-904) share a pattern: their job lives in `file_read` + `sandbox_execute` + `backlog_write` + `decision_record_create`, all of which are well-implemented. Roles that depend on value-stream-specific verbs (`policy_read`, `sbom_read`, `incident_read`, `subscription_write`, `chargeback_write`, etc.) are uniformly blocked because those verbs have no tool implementation.

---

## Findings by gap class

### Class 1 — Aspirational grant demand (the headline)

The tool-grant audit flagged 73 grants as having no honoring tool. This self-assessment confirms which of those grants are actually needed by their holders.

**65 of 73 unhonored grants are needed by at least one role.** Top demand:

| Grant key | Coworkers needing it | Roles |
|---|---|---|
| `policy_read` | 3 | AGT-ORCH-000, AGT-100, AGT-S2P-POL |
| `role_registry_read` | 3 | AGT-ORCH-000, AGT-ORCH-100, AGT-ORCH-200 (orchestrators) |
| `sbom_read` | 3 | AGT-ORCH-300, AGT-131, AGT-902 |
| `budget_read` | 2 | AGT-ORCH-000, AGT-900 |
| `strategy_read` | 2 | AGT-ORCH-000, AGT-101 |
| `investment_proposal_create` | 2 | AGT-ORCH-100, AGT-111 |
| `service_offer_read` | 2 | AGT-ORCH-500, AGT-151 |
| `incident_read` | 2 | AGT-ORCH-600, AGT-ORCH-700 |
| `order_create` | 2 | AGT-ORCH-600, AGT-141 |
| `constraint_validate` | 2 | AGT-ORCH-800, AGT-180 |
| `change_event_emit` | 2 | AGT-142, AGT-170 |
| `incident_create` | 2 | AGT-162, AGT-171 |

The full demand map is in [2026-04-28-coworker-self-assessment-responses.json](./2026-04-28-coworker-self-assessment-responses.json) under `unhonored_grants_self_check[]` per coworker, and in [2026-04-28-coworker-self-assessment-aggregation.json](./2026-04-28-coworker-self-assessment-aggregation.json) under `unhonored_demand`.

Eight grants on the aspirational list are **not** named as needed by any holder. Candidates for removal during Phase 2 reconciliation rather than implementation:
- This subset is small enough that each warrants individual review during the per-VS Phase 2 PR — auto-removal is risky because some unnamed grants may protect future workflows the holder didn't think to mention.

### Class 2 — Blocked roles by value stream

**Cross-cutting (4 of 9 blocked):** AGT-ORCH-000 (cannot read strategy/policy/budget), AGT-100 (policy-enforcement, both verbs unhonored), AGT-101 (strategy-alignment, both verbs unhonored), AGT-S2P-POL (policy-specialist, primary verb unhonored), AGT-900 (finance — three verbs unhonored), AGT-902 (data-governance — five verbs unhonored).

**Evaluate (5 of 6 blocked):** AGT-ORCH-100 (cannot read its own VS's outputs), AGT-111 (investment-analysis — five verbs unhonored, worst in roster), AGT-112 (gap-analysis — both inputs and outputs unhonored), AGT-113 (scope-agreement — primary verb unhonored), AGT-190 (security-auditor — seven verbs unhonored).

**Explore (1 of 4 blocked):** AGT-122 (roadmap-assembly — primary verb unhonored). AGT-ORCH-200, AGT-120, AGT-121 functional with gaps.

**Integrate (2 of 8 blocked, 5 gaps):** AGT-131 (sbom-management — both `sbom_read` and `sbom_write` unhonored). AGT-ORCH-300, AGT-130, AGT-132, AGT-140, AGT-142 functional with gaps. The four AGT-BUILD-* sub-agents are listed in `gaps` because they share a `capability_domain` string and need registry-level differentiation, not new tools.

**Deploy (1 of 4 blocked):** AGT-ORCH-400 (cannot read deployments it launches), AGT-141 (cannot write reservations or create orders).

**Release (4 of 4 blocked):** Every Release VS coworker is blocked. AGT-ORCH-500 (offer write), AGT-150 (offer write + contract read), AGT-151 (catalog-publication cannot publish — both verbs unhonored), AGT-152 (subscription-management — three verbs unhonored).

**Consume (3 of 4 blocked):** AGT-ORCH-600 (most under-tooled orchestrator), AGT-161 (order-fulfillment — both verbs unhonored), AGT-162 (service-support — three verbs unhonored).

**Operate (3 of 4 blocked):** AGT-ORCH-700 (cannot read incidents or SLAs), AGT-171 (incident-detection — primary verb unhonored), AGT-172 (incident-resolution — three verbs unhonored).

**Governance (3 of 3 blocked):** AGT-ORCH-800 (every governance verb unhonored), AGT-180 (constraint-validation — primary verb unhonored), AGT-182 (evidence-chain — both verbs unhonored). AGT-181 functional with gaps.

### Class 3 — Ambiguous boundaries between roles

11 explicit boundary disputes surfaced:

1. **AGT-ORCH-000 ↔ AGT-ORCH-800** — both can `decision_record_create`. COO should own strategic-level decisions; governance orchestrator should own constraint-level decisions.
2. **AGT-ORCH-100 ↔ AGT-100** — both can `investment_proposal_create`. Specialist proposes, orchestrator approves.
3. **AGT-ORCH-200 ↔ AGT-110** — orchestrator should not have `roadmap_create`; that's AGT-110's job. Orchestrator's grant should be `roadmap_read` + `roadmap_approve`.
4. **AGT-ORCH-300 ↔ AGT-BUILD-QA** — release gate ownership. QA tests, orchestrator gates; QA results should be a read-input.
5. **AGT-102 ↔ AGT-S2P-PFB** — both claim Portfolio Backlog Item lifecycle. Pick one canonical owner.
6. **AGT-180 ↔ AGT-100** — both have `violation_report_create`. AGT-100 produces policy violations; AGT-180 produces constraint violations. Distinct subtypes; different output shapes.
7. **AGT-S2P-POL ↔ AGT-100** — both have `policy_read` + `policy_write`. Specialist owns the policy lifecycle; enforcement-agent validates. Disambiguate.
8. **AGT-900 ↔ AGT-152** — both have `chargeback_write`. Finance should own the ledger; subscription-management should emit events.
9. **AGT-S2P-PFB ↔ AGT-102** — same as #5 from the other side.
10–11. **AGT-BUILD-DA ↔ AGT-BUILD-SE** — schema vs. application-code division is real but not encoded in the registry. All four AGT-BUILD-* agents share the same `capability_domain` string, which is a registry bug.

### Class 4 — Over-allocations

Only 1 finding — over-allocation is structurally rare in this roster.

- **AGT-ORCH-500** holds `catalog_publish` without companion `service_offer_read` or `service_offer_write`. The grant is "publish without read" — a one-way door. Either add the read side or move publish to AGT-151.

### Class 5 — Registry-level role bugs (surfaced by the assessment)

- **AGT-BUILD-DA / SE / FE / QA share an identical `capability_domain` string** ("Schema design, Prisma migrations, model validation, index optimization; DAMA-DMBOK aligned"). The four roles need distinct capability_domains. This is a registry bug, not a tool gap, but it surfaces as four `gaps` verdicts.
- **Several specialists lack `delegates_to`** — every specialist row shows `delegates_to: ["(none)"]` because the registry's `delegates_to` arrays are empty. This is correct for terminal specialists but means orchestrators name `delegates_to` while the specialists they name don't reciprocate via `escalates_to`. Cross-check is loose.

---

## Reconciliation plan (Phase 2)

The right shape is one PR per **batch**. Each batch picks 1–3 unhonored grants from the demand table, implements the tool(s), updates the catalog's `honored_by_tools`, regenerates the tool-grant audit baseline, and commits — same staged-rollout pattern as #316/#317.

Suggested batch order, optimizing for unblock-impact-per-PR:

| Batch | Scope | Unblocks |
|---|---|---|
| **1** | `policy_read`, `strategy_read`, `budget_read`, `role_registry_read` | AGT-ORCH-000, AGT-100, AGT-101, AGT-S2P-POL, AGT-900, plus orchestrator role-map reads — six coworkers move out of `blocked`. |
| **2** | `sbom_read`, `sbom_write`, `dependency_graph_read` | AGT-ORCH-300, AGT-131, AGT-902 — three coworkers; integrate VS becomes functional. |
| **3** | `incident_create`, `incident_read`, `incident_write`, `escalation_trigger`, `runbook_execute` | AGT-ORCH-600, AGT-ORCH-700, AGT-162, AGT-171, AGT-172 — entire operate VS plus consume support. |
| **4** | `service_offer_read`, `service_offer_write`, `catalog_publish`, `subscription_read/write`, `contract_read/write`, `chargeback_write` | All Release VS (AGT-ORCH-500, AGT-150, AGT-151, AGT-152) plus AGT-900 finance ledger. |
| **5** | `consumer_onboard`, `entitlement_provision`, `order_create`, `order_write`, `product_instance_write` | Consume VS path (AGT-ORCH-600, AGT-160, AGT-161). |
| **6** | `constraint_validate`, `architecture_guardrail_read`, `evidence_chain_read`, `evidence_chain_validate`, `audit_report_create`, `violation_report_create`, `guardrail_validate` | All governance VS (AGT-ORCH-800, AGT-180, AGT-181, AGT-182) plus AGT-100. |
| **7** | `investment_proposal_create`, `gap_analysis_create/read`, `scope_agreement_create`, `rationalization_report_create`, `criteria_read`, `tool_evaluation_*`, `tool_verdict_create`, `risk_score_create`, `financial_read` | Evaluate VS (AGT-ORCH-100, AGT-110, AGT-111, AGT-112, AGT-113, AGT-190). |
| **8** | `iac` status-read, `rollback_plan_create`, `resource_reservation_*`, `change_event_emit`, `deployment_plan_create` follow-ups | Deploy VS rounds out. |
| **9** | Boundary-disambiguation PR — apply the 11 boundary findings as registry-side grant moves (mostly removing duplicates and creating `*_approve` paired grants). | Resolves Class 3 entirely. |
| **10** | AGT-BUILD-* differentiation — give each of DA / SE / FE / QA a distinct `capability_domain` and assign-to map. | Resolves Class 5. |

Each batch completes when (a) the tool implementations land in `apps/web/lib/mcp-tools.ts` and `apps/web/lib/tak/agent-grants.ts`, (b) the grant catalog's `honored_by_tools` is updated, (c) the tool-grant audit baseline (#317) is regenerated and shows the relevant GRANT-002 findings dropping, (d) the persona audit (#316) `# Tools Available` section regeneration script runs against the affected coworkers.

The 8 grants that no role named are candidates for **removal** rather than implementation, but each should be reviewed in the batch where it lives — auto-removal is risky.

---

## What is *not* in this report

- **The "right" answer to ambiguous boundaries.** The 11 boundary findings are the role-holder's view; the canonical resolution lives with the human supervisor (HR-100 for portfolio, HR-200 for explore/integrate, etc.). This audit surfaces the disputes; it does not adjudicate them.
- **Persona content.** This audit was run *before* the persona-audit backfill (#316) ships, so most coworkers had only `capability_domain` to reason from. Re-running this assessment after persona backfill will produce sharper findings — Phase 3 covers continuous re-runs.
- **Multi-coworker workflows.** Some findings hint at workflow gaps (e.g., AGT-ORCH-300 needs to *read* QA results AGT-BUILD-QA produces). Workflow stitching is an A2A concern, tracked separately.
- **Cost.** Phase 1 used in-conversation reasoning; no production model spend. Phase 3's `routeAndCall` graduation will need a cost budget.

## Phase 3 sketch (continuous improvement loop)

The Phase 1 runner is built so Phase 3 can promote it cleanly:

- Replace the prompt-rendering output with a `routeAndCall` dispatcher that uses each coworker's configured model.
- Persist responses to a new `CoworkerSelfAssessment` table (timestamp, agent_id, verdict, JSON payload).
- Add a `Coworker Improvement Loop` coworker (per memory `project_improvement_loops.md`) that reads the trend, files backlog items for recurring complaints, and proposes grant changes for human review.
- Re-run on a cadence (after each Phase 2 batch ships, then monthly).

Phase 3 should land **after** the A2A spec ships — the improvement-loop coworker needs a way to file backlog items addressed to specific peer coworkers, which is an A2A capability.
