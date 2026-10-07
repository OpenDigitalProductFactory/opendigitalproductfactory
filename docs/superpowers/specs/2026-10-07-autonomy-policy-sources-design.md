---
status: active
---

# Autonomy Policy Sources: WWWD From the Business Context, WWMD for Development

- Date: 2026-10-07
- Backlog: BI-E30C0F4F
- Extends: `2026-06-28-regulatory-autonomy-ceiling-policy-design.md` (table and resolver unchanged; this adds the writers and changes the no-match rule)
- Programme: `docs/superpowers/plans/2026-10-07-autonomous-delivery-program.md`, wave 3 prerequisite
- Status: approved by the operator 2026-10-07

## Operator direction (2026-10-07)

1. "All work should have a method of autonomous decision that can suffice. For human delegation for approval the gate criteria should be clear and traceable to either regulatory or policy based criteria."
2. "No policy found should be rare as we identify the business model at the install with the regulatory context to establish the proper WWWD policies. The portal's policies in WWMD should cover the needs of development along with the WSID of the individual AI coworkers we setup for development work."
3. "Autonomy is predicated on the allocation of budgets and the proper spend rate and objectives of each workroom." Budget and spend are wave 2 of the programme; this design covers the policy half and states where the two meet.

## Problem (measured on the live install, 2026-10-07)

- `RegulatoryAutonomyPolicy` has **0 rows**. Nothing writes it: the June design left writers out on purpose ("no seeded regulation facts", "no UI"), and no later slice added one.
- With no match, the resolver returns `propose` + `humanControlRequired` (June design, rule 6). Every Build Studio eligibility decision therefore carries `regulatory_ceiling_requires_human`, which cites no regulation.
- The same default blocks the only path that creates work-pattern bindings: promotion escalates when `regulatoryHumanControlRequired` (`work-pattern-promotion-policy.ts:113`). There are 0 work-pattern bindings, so every build is also blocked by `active_pattern_binding_missing`. Autonomy cannot start anywhere.
- The inputs already exist. `BusinessContext` records the business model and regulatory scope; the `Regulation` catalogue holds 63 regulations, each with machine-readable `applicability` (basis, jurisdictions, data handling, archetypes). For this operator install (software-platform, operates in the US, processes personal data, sends marketing, deploys automated decisioning, public service) the catalogue already selects, among others: Software Assurance, CCPA/CPRA, State Privacy, Breach Notification, CAN-SPAM, TCPA, ADA/WCAG, CO AI Act, TX TRAIGA and NIST AI RMF.

What is missing is the step from "this regulation applies to this business" to "this activity class may run up to this autonomy level, and here is the rule that says so".

## Research and Benchmarking

- **NIST Risk Management Framework (SP 800-37 Rev. 2) with FIPS 199 categorization and SP 800-53B baselines.** A system is first *categorized* from what it does and the data it handles; the categorization *selects* a control baseline; the organization then *tailors* it. **Adopted** as the shape of this design: the business context is the categorization, the regulation catalogue's applicability selects, and operator rows tailor. **Rejected:** the impact-level vocabulary (low/moderate/high) as the selector; DPF already selects on concrete facts (jurisdiction, data handling, archetype), which is more traceable.
- **AWS Organizations service control policies and Control Tower guardrails.** Policies attach to an organizational unit and are inherited; a mandatory baseline is applied to every account, with elective guardrails added on top. **Adopted:** a platform baseline (WWMD) that every install inherits for platform-development work, with business policies (WWWD) layered per install. **Rejected:** deny-only semantics; an autonomy ceiling needs a level, not just allow/deny.
- **Open Policy Agent decision defaults and decision logs.** OPA returns a defined default when no rule matches and logs the input, policy and result. **Adopted:** the no-match result is defined, and every decision carries the matched policy, its source and the regulation it cites. **Rejected:** a silent restrictive default with no explanation, which is the current behaviour.

## Design

### 1. Three policy sources, one table

`RegulatoryAutonomyPolicy.sourceKind` gains two values next to `operator`:

| Source | Scope | Written by | Example |
| --- | --- | --- | --- |
| `wwmd-baseline` | Every install; platform-development activity classes | Seed, versioned in the repo | `platform-development/*`: ceiling `autopilot`; evidence `independent-review`, `ci-gate`. |
| `wwwd-derived` | One install; business activity classes | Setup completion, from `BusinessContext` + archetype + `Regulation.applicability` | CAN-SPAM applies, so `outbound-marketing-send`: ceiling `supervised`, `humanControlRequired=false`, evidence `unsubscribe-honoured`, `regulationId=CAN-SPAM`. |
| `operator` | One install | Operator (later UI); overrides the other two | Tighten or loosen a derived row, with a reason. |

Every row with `humanControlRequired=true` must carry a `regulationId` or a named policy reference in `rationale`. A row that does not is rejected at write time.

### 2. Derivation: regulation to activity ceilings

A versioned, reviewable catalogue (`packages/db/data/regulatory-autonomy-catalogue.json`) maps each regulation to the activity classes it constrains and the ceiling and evidence it implies. The catalogue is policy-as-data: reviewed in PRs, never generated at runtime.

At setup completion (`setup-completion-seeds.ts`, after `seedRiskPosture`), and again whenever `BusinessContext` changes:

1. Select applicable regulations with the existing `regulationApplies` logic.
2. For each, emit the catalogue's activity rows for this install as `wwwd-derived` policies, each linked by `regulationId`.
3. Supersede (version) rows whose regulation no longer applies; never delete history.
4. Record a decision-log entry listing the regulations matched and the rows written.

Platform-development work on any install resolves against the `wwmd-baseline` rows. The WSID profile of each development coworker bounds what that coworker may do inside the ceiling (grants and tool access, already enforced through `agent_registry.json` and `AgentToolGrant`). The ceiling is never broader than the coworker's grants.

### 3. The no-match rule changes

June rule 6 (no match means `propose` + human control) is replaced:

- **Platform-development activity** cannot be unmatched: the WWMD baseline has a `*` row for it. An unmatched development activity is a seed defect and fails the guard in Verification below.
- **Business activity with no matching row** is a **policy gap**. The work proceeds at `supervised`: an independent AI reviewer approves before consequential steps, per the operator's decision that an AI reviewer may approve designs and plans for all work. The gap is reported as a setup finding and routed to the install's compliance coworker to author or confirm a row. It is not routed to a person as an approval.
- **Human control** happens only where a matched row says so, and the eligibility blocker names that row and its regulation (for example, `regulatory_ceiling_requires_human: HIPAA via policy rap-…`).

### 4. Where budget and objectives meet (programme wave 2)

The policy ceiling answers "how far may this run without a person". Budget answers "may this run at all, and how fast". Autonomous start requires both:

- the item is funded (a `BudgetReservation` against its portfolio's period, programme BI-EF265C9A) and its build carries the portfolio (BI-C2158DA7); and
- the spend rate of its workroom is within the period allowance, and its objective is set (`Workroom.objective` or a linked `ProductObjective`).

This design only adds the policy half. It names the meeting point so wave 2 does not invent a second autonomy gate.

### 5. What changes for the work-pattern binding

With the WWMD baseline in place, Build Studio's standard delivery pattern (ideate → plan → build → review) is promotable for platform-development work. Promotion stops escalating on a missing policy, and the binding's grants stay within the baseline ceiling (July spec §8.1). Moving custody from shadow to enforce remains an operator switch (`DPF_BUILD_AUTONOMOUS_PLAYBOOK_MODE`), taken after the evidence is clean, as documented in `docs/operations/autonomous-build-completion.md`.

## Non-Goals

- No legal advice. The catalogue states which activities a regulation constrains and the evidence it expects; it does not interpret the regulation for a specific customer.
- No policy-management UI in this slice; operator rows are written through a governed MCP tool.
- No change to the resolver's most-restrictive-wins rule or to the table shape beyond `sourceKind` values.
- Budget gating itself (programme wave 2).

## Verification

- Resolver tests:
  - development activity always matches the baseline;
  - a business activity with no row returns `supervised` with a `policy-gap` reason, not human control;
  - a matched row requiring human control returns its `regulationId`.
- Derivation tests: this operator install's `BusinessContext` yields rows for each applicable regulation in the catalogue, and no rows for regulations that do not apply (HIPAA, PCI, FERPA). Changing `BusinessContext` versions the rows.
- Write guard: a `humanControlRequired=true` row without `regulationId` or a policy reference is refused.
- Seed-fit guard: the WWMD baseline covers every platform-development activity class the autonomy code names.
- Live acceptance: on this install, a Build Studio build's eligibility no longer shows `regulatory_ceiling_requires_human`. A work-pattern promotion for the standard delivery pattern reaches `activate` rather than `escalate`.

## Implementation status

- **Slice 1 (BI-E30C0F4F):**
  - The WWMD baseline is seeded on every install and every upgrade (`packages/db/src/seed-autonomy-policy-baseline.ts`). It is versioned, and it never touches a lineage an operator has taken over.
  - The policy-gap rule is in the resolver (`apps/web/lib/autonomy/regulatory-ceiling.ts`).
  - The human-control basis guard is `assertHumanControlHasBasis`.
  - Build eligibility treats `supervised` as satisfied by the build's independent review stage. A person is engaged only on a policy that requires human control or caps the work at `propose` or below.
- **Slice 2:** the WWWD derivation catalogue and setup-completion wiring, plus reporting the `policy-gap-report` evidence to the compliance coworker.

## Operator decisions (2026-10-07)

1. **WWMD baseline ceiling for platform development: `autopilot`.** Every gate, CI and the independent AI review still run; only human approval is removed.
2. **Policy gap for business activity: `supervised`.** An independent AI reviewer approves; the gap is reported to the compliance coworker to author the row.
