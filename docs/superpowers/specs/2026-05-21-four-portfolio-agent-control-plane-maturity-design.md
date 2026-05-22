# Four-Portfolio Agent Control Plane Maturity Design

| Field | Value |
|-------|-------|
| **Status** | Draft — UX-audit absorption pass applied 2026-05-22 (after consistency pass) |
| **Date** | 2026-05-21 |
| **Author** | Codex + Mark Bodman |
| **Reviewers** | Chief-architect pass (Claude, 2026-05-21): added evidence-gated scoring (§5.1), `riskTier`-derived MVP targets (§5.2), confidence decay (§5.3), Productize Mode (§7.3), capability-record extensions (§8), assessment cadence (§8.1), capability dependency graph + effective maturity invariant (§10.3), productize promotion loop (§10.4), `boundary_adapter` qualifying criteria (§11), architectural acceptance criteria (§15.2), and four new risks (§16). Consistency-review pass (Claude, 2026-05-22): resolved `claimed`-decay contradiction with `claimed_overdue` alert (§5.3), marked derived fields in capability record (§8), reframed §6 bootstrap scores as `claimed` per §5.1 gate, added `riskTier` authoring governance (§5.2.1), required `MaturityScoreEvent` audit log (§8 + AC #19), added governance-bottleneck risk and tiered cadence (§8.1, §16), made mode precedence explicit (§7.0), and qualified MCP's multi-vendor status in `boundary_adapter` criteria (§11). UX-audit absorption pass (Claude, 2026-05-22, after consistency PR #1001 merged): folded the six `/portfolio`-relevant findings from [`audits/2026-05-20-portal-ux-audit.md`](../audits/2026-05-20-portal-ux-audit.md) into new §12.0 (audit-grounded acceptance gates), §12.1 count-source-of-truth + drill-through + empty-state invariants, §12.2 counter-reconciliation gate, §12.3 portfolio-concentration signal, §12.4 label-fit + layer-on-existing-nav invariants, §12.5 maturity-surface audit gates pending AGT-906, AC #12, five risk rows in §16, and three new open decisions in §17 (#9–#11). |
| **Primary Objective** | Turn the existing four-portfolio taxonomy into an investment, gap-analysis, operations, and productization surface for DPF's agent control plane maturity |
| **Scope** | Portfolio taxonomy, capability maturity scoring, hive-mind refinement, backlog fan-out, build-first vendor-replacement posture, and recursion-driven productization |
| **Non-Goals** | This spec does not implement schema, routes, or backlog mutations. It defines the operating model that later plans should implement. |
| **Primary Inputs** | `docs/Reference/digital_product_portfolio_mgmt.txt`, `packages/db/data/portfolio_registry.json`, `docs/superpowers/specs/2026-03-10-portfolio-route-design.md`, `docs/superpowers/specs/2026-03-21-digital-product-unified-ontology-design.md`, `docs/superpowers/specs/2026-04-14-taxonomy-to-action-v4-v5-design.md` |

## 1. Problem Statement

The agent infrastructure market is fragmenting into separate vendor products for runtime, identity, authorization, observability, evals, data access, commerce, gateways, and governance. Large organizations often pay for these tools separately, then pay again to integrate them. The integration cost is not only financial. Each independent codebase adds brittleness, separate roadmaps, security review overhead, support variance, and operational sprawl.

DPF has already implemented many of the primitives those vendors sell as isolated products:

- principal and alias identity foundations
- agent grants and authority concepts
- A2A and coworker coordination direction
- MCP tooling and tool marketplace direction
- Work Capsules, Build Studio, runtime targets, and evidence recording
- cost telemetry and budget-governance plans
- hive-mind and user feedback surfaces
- the four-portfolio DPPM taxonomy

The current gap is maturity, not conceptual absence. DPF needs a way to answer:

1. Where do we already cover the broad market category well enough to avoid a vendor dependency?
2. Where do we have immature primitives that need investment backlog?
3. Where is a capability mature enough to become a management and operations surface?
4. Where should open-source code accelerate us without becoming another integration dependency?
5. Where should customer-specific refinements stay local rather than polluting the canonical model?

This spec defines the four-portfolio taxonomy as the decision surface for those answers.

## 2. Design Intent

The four portfolio roots remain canonical:

| Portfolio | DPF Meaning |
|-----------|-------------|
| **Foundational** | The platform substrate: identity, authority, MCP, runtime substrate, data plane, model gateway, observability, policy, token vault, cost controls, kill switch, and technical shared services. |
| **Manufacturing and Delivery** | The factory that manufactures and changes digital products: Build Studio, sandbox execution, work capsules, A2A build workflows, verification, release, evidence, and contribution processing. |
| **For Employees** | The internal operating workspace: portal UX, AI coworkers, hive mind, approvals, internal knowledge, feedback capture, coworker routing, and daily management. |
| **Products and Services Sold** | The market-facing offer: for DPF, the portal and agent control plane itself; for other business archetypes, their actual goods and services. |

The agent control plane maturity model must attach to these portfolios rather than create a new parallel taxonomy. The four-portfolio tree is already "Goldilocks-grained": specific enough to route work and measure maturity, but not so deep that every customer nuance becomes core product structure.

The desired pattern is:

```text
Canonical four-portfolio taxonomy
  -> DPF capability maturity scoring
  -> investment gaps and backlog fan-out
  -> operational management surfaces
  -> hive-mind and customer feedback signals
  -> selective promotion of proven local refinements
```

## 3. Current-State Verification

### 3.1 Repository Grounding

The repository already anchors the four portfolios in several places:

- `packages/db/data/portfolio_registry.json` defines `foundational`, `manufacturing_and_delivery`, `for_employees`, and `products_and_services_sold`.
- `docs/superpowers/specs/2026-03-10-portfolio-route-design.md` defines the `/portfolio` route around the four roots.
- `docs/superpowers/specs/2026-03-21-digital-product-unified-ontology-design.md` treats portfolio boundaries as ontological partitions.
- `docs/superpowers/specs/2026-04-14-taxonomy-to-action-v4-v5-design.md` states that taxonomy must drive product placement, backlog routing, coworker specialization, governance, workflow/tool activation, cost, quality, and accountability views.

### 3.2 Live Backlog Check

The DPF MCP endpoint was attempted first, but the current token returned `unauthorized: invalid or expired token`. Per AGENTS.md, this pass used explicit live DB fallback for read-only overlap checks.

Relevant live epics already exist:

| Epic | Status | Relevance |
|------|--------|-----------|
| `EP-CAPSULE` | in-progress | Work Capsule control harness and Build Studio attachment |
| `EP-COWORKER-RT` | in-progress | Autonomous coworker runtime and grant/persona audit |
| `EP-MCP` | in-progress | MCP tooling, token onboarding, connectivity hardening |
| `EP-A2A` | open | A2A coworker team orchestration |
| `EP-AI-OPSMAP` | open | AI operations map and failure routing |
| `EP-BIZ-CAP` | open | Business capability map, taxonomy, employee work |
| `EP-BUILD-STUDIO` | open | Build Studio intake, brief, provider runner, implementation |
| `EP-COST-001` | open | AI cost governance, model tiering, budget enforcement |
| `EP-INT-2E7C1A` | open | Integration harness and private deployment foundation |
| `EP-TAK-3F9A21` | open | TAK/GAID auth, agent identity, governed memory |
| `EP-WWMD-MCP` | open | WWMD MCP exposure |

This spec should therefore fan work into existing epics where possible. New epics should be created only for capability areas not already owned.

## 4. Research and Benchmarking

### 4.1 Market Pattern

Current vendor products are converging on the same seven control points:

1. A governed actor identity
2. A scoped runtime
3. A tool and data permission boundary
4. A budget or spend boundary
5. A trace, eval, and evidence ledger
6. A human override path
7. A gateway that can stop, route, or reshape execution

DPF should build these as one owned control plane, not integrate one vendor per control point.

### 4.2 Commercial Benchmarks

| Vendor/Product | Useful Pattern | DPF Posture |
|----------------|----------------|-------------|
| Cloudflare Agents and Workflows | Durable agents, scheduled work, workflow handoff, agent identity as a durable object-like runtime pattern | Use as runtime design benchmark. Do not depend on it as the core runtime. |
| AWS Bedrock AgentCore | Bundles runtime, memory, identity, gateway, tools, browser/code execution, and observability | Confirms DPF should aggregate these categories as one control plane. Use as competitive benchmark, not dependency. |
| Auth0 for AI Agents / Token Vault | Delegated OAuth access, token custody, consent, third-party API access for agents | Build DPF authority and token-vault model. Use Auth0/Okta/WorkOS/Entra only as optional identity-edge adapters. |
| Snowflake Cortex Agents / Databricks Mosaic AI Agent Framework | Governs agents close to data, tools, lineage, and enterprise datasets | Build DPF semantic data plane. Treat warehouses as adapters. |
| Stripe Agentic Commerce / Agent Toolkit | Agent commerce, payment tokenization, merchant-side transaction protocols | Use Stripe as first payment rail adapter. DPF owns spend policy, approvals, and receipts. |
| Datadog LLM Observability, LangSmith, Braintrust | Traces, evals, observability, datasets, outcome review | Build DPF trace/eval ledger around `ToolExecution`, receipts, runtime verification, and OpenTelemetry conventions. |

### 4.3 Open-Source Accelerators

| Project/Standard | Useful Pattern | DPF Posture |
|------------------|----------------|-------------|
| LangGraph | Durable graph execution and human-in-the-loop interrupts | Candidate embedded accelerator for bounded agent workflows, not a platform dependency. |
| Temporal / Inngest | Durable execution, retries, event-driven workflow state | DPF already uses Inngest. Temporal is a benchmark or alternate substrate option. |
| OpenTelemetry GenAI semantic conventions | Portable GenAI traces and span attributes | Adopt as export and naming convention for DPF telemetry. |
| Langfuse | Self-hostable LLM observability, traces, evals, datasets, prompt analytics | Candidate self-hosted accelerator for eval/trace UX, with DPF as source of authority. |
| OpenFGA / OPA | Fine-grained authorization and policy evaluation | Candidate policy engine patterns. DPF remains the source of authority and grant semantics. |
| Cube | Open-source semantic layer for consistent agent and human analytics | Candidate accelerator for semantic metrics. DPF owns capability and data-product semantics. |
| OpenMetadata / DataHub | Metadata, lineage, observability, data governance | Candidate accelerators for data catalog and lineage, not mandatory dependencies. |

## 5. Capability Maturity Coverage Score

The MVP metric is not whether a feature exists. The metric is whether it is mature enough to cover a vendor category without needing that vendor as a core dependency.

### 5.1 Score Definitions (Evidence-Gated)

Each score is gated by observable evidence in the repository, schema, or live install, not by author judgement. A score may only be claimed when the gate criteria are citable.

| Score | Meaning | Gate Criteria (all required) |
|-------|---------|------------------------------|
| 0 | Missing | No primitive exists in repo, schema, or live install. |
| 1 | Isolated primitive | Schema or code exists for the concept; no live workflow consumes it end-to-end. |
| 2 | Used in one workflow | At least one primary workflow exercises it end-to-end with recorded evidence (`ToolExecution`, `RuntimeVerification`, Build Studio evidence, or equivalent). |
| 3 | Used across primary workflows | Two or more primary workflows depend on it; evidence is generated continuously, not by spot test. |
| 4 | Governed and operator-visible | Owner assigned, operations surface live, policy/kill-switch hooks wired, exception/regression alerts active, and score evidence is continuously refreshed. Dependency maturity does not change the raw score; it bounds `effectiveMaturity` (§10.3). |
| 5 | Self-improving through hive-mind/user feedback | Hive-mind signals (§9) measurably tune routing, prompts, coworkers, thresholds, or scores; the improvement is auditable. |

A capability's **effective score** is bounded by its dependency capabilities (§10.3). Reporting a score of 4 while a load-bearing dependency sits at 2 is a defect, not a milestone — see `effectiveMaturity` in §8.

### 5.2 MVP Target Derivation (RiskTier, not per-row authoring)

MVP target is derived from the capability's risk tier, not authored per row. This prevents seed drift and forces the designer to justify "why is this critical" rather than picking a target number.

| Risk Tier | MVP Target | Applies When |
|-----------|------------|--------------|
| `critical` | 4 | A failure or compromise would breach safety, identity integrity, authority correctness, evidence ledger, kill-switch reachability, or spend custody. |
| `elevated` | 4 | Capability is on the primary runtime, tool, data, or governance path for any `owned_core` agent workflow. |
| `standard` | 3 | Capability supports an internal workflow; degraded operation does not breach safety, evidence, or spend invariants. |
| `low` | 3 | Capability is convenience or cosmetic; degraded operation is recoverable without governance impact. |

Score `5` is never an MVP requirement. It is an optimization milestone reserved for capabilities that have a working improvement loop and an audit trail proving the loop changed behavior.

### 5.2.1 RiskTier Authoring Governance

Because MVP target derives from `riskTier`, `riskTier` becomes the load-bearing investment-pressure knob. Without governance, every record drifts to `critical` and the maturity surface loses signal.

**Rules:**

1. `critical` and `elevated` require a citable **breach scenario** — a one-sentence statement of what fails if the capability fails — recorded on the capability record. `standard` and `low` may be set without ceremony.
2. Promotion from `standard → elevated` or `elevated → critical` is a governance change reviewed on the §8.1 cadence; demotion is also governed (a capability quietly downgraded to dodge an MVP gap is the same defect as inflating a score).
3. `riskTier` changes are evidence-linked events on the §8 audit log alongside score changes.
4. The seed must not exceed roughly one-third of capabilities at `critical` without an explicit kernel-principle justification per row; the writer warns when this ratio is crossed.

### 5.3 Confidence and Decay

A score is paired with a `confidenceGrade` (§8):

| Grade | Meaning |
|-------|---------|
| `verified` | Evidence reviewed by governance within the last 30 days; outcomes recorded. |
| `evidenced` | Continuous evidence stream within the last 30 days; not yet governance-reviewed. |
| `claimed` | Score authored from primitives; no continuous evidence stream has ever flowed. |
| `stale` | Evidence stream existed and has now been silent for > 30 days, OR a governance review existed and is now > 90 days old. |

**Precedence (highest to lowest):**

1. Fresh governance review (≤ 30 days) AND any evidence ever recorded → `verified`. A fresh review re-confirms the score; it overrides a stale evidence signal.
2. Fresh continuous evidence (≤ 30 days) AND no recent governance review → `evidenced`.
3. Evidence stream once existed and has lapsed (> 30 days silent) OR review existed and lapsed (> 90 days) → `stale`.
4. No evidence stream has ever flowed AND no review → `claimed`. Fresh-authored seed rows stay `claimed` indefinitely until evidence flows; they do not decay to `stale` on age alone, because there was nothing to go silent.

A `stale` score automatically demotes the **effective** score by 1 (floor 0) until refreshed. This is the anti-rot rule — without it, the maturity surface drifts into a vanity dashboard. `claimed` does not demote on age; it carries its own "unproven" visual treatment instead.

**`claimed_overdue` alert (separate from decay):** a row that has carried `confidenceGrade = claimed` for more than 60 days surfaces a `claimed_overdue` alert on the operations surface and enqueues a re-assessment task per §8.1. Dead-on-arrival capabilities — those that never generated a single evidence event after seeding — are themselves a signal worth surfacing. The alert is the visibility mechanism; the `effectiveMaturity` calculation is unchanged.

## 6. Initial DPF Maturity Assessment (Bootstrap, `claimed`)

These scores are bootstrap seed values authored from repository evidence and live DB fallback. **Per §5.1, none of these scores have passed the evidence gate yet**; they are recorded for routing and UX wiring only. Every row in this table is seeded with `confidenceGrade = claimed`, will surface a `claimed_overdue` alert per §5.3 after 60 days without evidence flow, and must be re-derived by the assessment cadence in §8.1 before any vendor-replacement or productization claim depends on them. This is the [seed-is-bootstrap-calibration-is-runtime](../../../docs/founder-kernel/wiki/principles/) discipline in action — the table exists to be replaced by lived evidence, not to be defended.

| Capability | Primary Portfolio | Supporting Portfolios | Risk Tier | Bootstrap Score (claimed) | Derived MVP Target | Existing DPF Strength | Main Maturity Gap | Existing Epic Anchor |
|------------|-------------------|-----------------------|-----------|---------------|--------------------|-----------------------|-------------------|----------------------|
| Principal identity and authority | Foundational | For Employees, Products and Services Sold | `critical` | 3 | 4 | Principal, PrincipalAlias, grants, authority specs | Universal principal propagation, delegated consent, token vault | `EP-TAK-3F9A21`, `EP-COWORKER-RT` |
| MCP and tool governance | Foundational | Manufacturing and Delivery | `elevated` | 3 | 4 | MCP tools, grants, token onboarding, marketplace direction | Gateway hardening, readiness, scope UX, external MCP maturity | `EP-MCP`, `EP-WWMD-MCP` |
| A2A coworker coordination | Manufacturing and Delivery | For Employees | `elevated` | 2 | 4 | A2A spec and coworker runtime work | Task-native handoff, resumability, acceptance evidence | `EP-A2A`, `EP-COWORKER-RT` |
| Work Capsules and runtime control | Manufacturing and Delivery | Foundational | `elevated` | 3 | 4 | WorkCapsule, runtime target direction, Build Studio attachment | Mandatory wrapper across all meaningful agent work | `EP-CAPSULE`, `EP-BUILD-STUDIO` |
| Governance evidence ledger | Manufacturing and Delivery | Foundational, For Employees | `critical` | 3 | 4 | ToolExecution, receipts, runtime verification, Build Studio evidence | Unified operator evidence UX and cross-surface linking | `EP-CAPSULE`, `EP-AI-OPSMAP` |
| Hive mind and user refinement | For Employees | Manufacturing and Delivery, Products and Services Sold | `standard` | 2 | 3 | Hive Scout, portal context overlay, contribution direction | Measurable signal capture and promotion rules | `EP-HIVE-SCOUT`, `EP-BIZ-CAP`, `EP-CAPSULE` |
| Observability, evals, and cost ledger | Foundational | Manufacturing and Delivery | `elevated` | 2 | 4 | Cost governance plan, ToolExecution, Grafana/Prometheus | Trace/eval datasets, outcome scoring, cost per useful result | `EP-COST-001`, `EP-AI-OPSMAP` |
| Semantic data and knowledge plane | Foundational | All portfolios | `elevated` | 1 | 4 | Qdrant, Neo4j, docs/specs, backlog, knowledge foundations | Governed semantic metrics, lineage, freshness, policy-aware RAG/query | Candidate effort: Semantic Data Plane |
| Spend/payment authority | Foundational | Products and Services Sold | `critical` | 1 | 4 | Invoice/Payment models, cost governance, integration harness | Agent spend limits, payment custody, approvals, receipts, freeze controls | Candidate effort: Agent Commerce and Spend Authority |
| Customer-facing agent services | Products and Services Sold | Foundational, For Employees | `standard` | 2 | 3 | Customer assistant direction, portal/product surfaces | Packaging, trust reports, sellable offers, customer evidence | Candidate effort: Agent Control Plane Productization |
| Cross-layer kill switch | Foundational | All portfolios | `critical` | 2 | 4 | Grants, runtime records, cost controls, tool execution records | One stop/revoke/freeze operation across runtime, tools, tokens, spend, deployment | Candidate effort: Cross-Layer Kill Switch |

## 7. Investment vs Operations Surface

The same taxonomy node must render differently based on maturity.

### 7.0 Mode Precedence

The three modes are not arbitrary tabs. They have a fixed precedence so the UI cannot show a "ready to package" affordance on top of an unmet MVP gap:

1. **Investment Mode (§7.1)** — applies when `effectiveMaturity < mvpTargetScore`. Always wins. The UI does not show Operations or Productize affordances while a gap is open.
2. **Operations Mode (§7.2)** — applies when `effectiveMaturity >= mvpTargetScore`. Default at-or-above-target view.
3. **Productize Mode (§7.3)** — **overlay only** on Operations Mode when `productizationStatus ∈ {eligible, candidate}`. Never replaces Operations and never appears on a row in Investment Mode, even if `maturityScore` (the raw, un-cascaded number) would qualify. The gate is `effectiveMaturity`, not `maturityScore` — see §10.3 and AC #14.

A capability whose own score qualifies for productize but whose dependency floor pulls `effectiveMaturity` below target stays in Investment Mode with a dep-blocked annotation. This prevents the "ready to sell" claim from outrunning the substrate.

### 7.1 Lagging Capability Mode

If a capability is below its MVP target, the portal should treat it as an investment and gap-analysis surface:

- current score and target score
- why the gap matters
- vendor category pressure
- existing DPF primitives
- missing enforcement and UX surfaces
- recommended build-first backlog
- related specs and epics
- open-source accelerators
- risk if bought/integrated instead
- next smallest implementation slice

### 7.2 Robust Capability Mode

If a capability meets or exceeds its MVP target, the portal should treat it as an operations surface:

- owner and accountable portfolio
- operational health
- usage and adoption
- cost and budget status
- tool/runtime/data policy exceptions
- evidence quality
- hive-mind feedback trends
- recent regressions
- improvement backlog
- export/adaptor status

### 7.3 Productize Mode

If a capability is `productizationStatus ∈ {eligible, candidate}` (§10.4), the portal overlays a "ready to package" affordance on top of operations mode:

- packaging checklist status (trust report, parity matrix, customer-facing evidence sample, pricing hypothesis)
- last `productizationStatus` transition with evidence link
- 14-day score-change watch (anti-inflation guard)
- candidate `Products and Services Sold` taxonomy slot
- governance reviewer and decision queue link

This mode is what closes the DPF recursion loop — mature internal capability → candidate sellable product — without making productization a side-channel that bypasses the maturity model. It also prevents the taxonomy from becoming a static catalog; the taxonomy becomes the operating map for investment, management, and monetization.

## 8. Required Capability Record

Implementation must **audit before adding**. `EaElement` is the most likely existing carrier — it already models architecture elements with relationships and could be extended with a `MaturityAssessment` companion model rather than greenfielding a new top-level entity. The audit set is: `Portfolio`, `DigitalProduct`, `TaxonomyNode`, `BacklogItem`, `EaElement`, `RuntimeTarget`, `RuntimeVerification`, `ToolExecution`, and any existing portfolio quality/scorecard models. Greenfielding only after this audit demonstrates none of them fit.

`capabilityCategory` is an enumerated set, aligned to the seven control points from §4.1:

```text
runtime | identity_authority | tool_gateway | data_plane | budget_spend
        | evidence_eval | human_override | composition_helper
```

`composition_helper` is the escape hatch for cross-cutting capabilities (e.g. kill switch) that compose multiple control points rather than owning one.

Each assessed capability needs these fields at minimum. **Source = `authored`** means the field is written by a human, coworker, or governance process; **Source = `derived`** means the field is computed in the single-writer module (§8.1) and must never be mutated directly by routes, UX, or migrations.

| Field | Source | Purpose |
|-------|--------|---------|
| `portfolioId` | authored | One of the four canonical portfolio roots |
| `taxonomyNodeId` | authored | The node where the capability is managed |
| `capabilityCategory` | authored | Enumerated category from the set above |
| `riskTier` | authored (governed, §5.2.1) | `critical` / `elevated` / `standard` / `low` — derives `mvpTargetScore` per §5.2 |
| `riskTierRationale` | authored | One-sentence breach scenario required when `riskTier ∈ {critical, elevated}` per §5.2.1 |
| `maturityScore` | authored (evidence-gated, §5.1) | Current 0-5 raw score; intent only — gating logic reads `effectiveMaturity` |
| `mvpTargetScore` | derived | Computed from `riskTier` per §5.2 |
| `effectiveMaturity` | derived | `min(maturityScore, min(dependsOn.effectiveMaturity))`, then -1 if `confidenceGrade = stale` (floor 0). This is the number all UX and gating logic must read. |
| `dependsOn` | authored | Capability records this capability requires to function (§10.3); forms a DAG, cycles rejected at write time |
| `strategicOwnership` | authored | `owned_core`, `embedded_accelerator`, `boundary_adapter`, or `avoid` |
| `vendorReplacementConfidence` | authored | `low` / `medium` / `high` / `verified` — `verified` requires a recorded parity checklist and at least one production replacement |
| `installScope` | authored | `canonical` / `dpf_dogfood` / `customer_overlay` — scores from different scopes never aggregate silently |
| `archetypeScope` | authored | Null for canonical; business archetype identifier when overlay |
| `kernelPrinciples` | authored | Founder Kernel principle slugs this capability enforces (e.g. `destructive-actions-require-explicit-go`, `evidence-before-diagnosis`) |
| `existingPrimitives` | authored | DPF models, routes, tools, specs, and epics already covering the capability |
| `maturityGaps` | authored | Enforcement, UX, data, policy, evidence, and workflow gaps |
| `operationalSurface` | authored | Route or product surface where robust capabilities are managed |
| `investmentBacklogLinks` | authored | Epics/backlog items that close maturity gaps |
| `evidenceSources` | authored / ingested | Tool executions, runtime verification, Build Studio evidence, PRs, tests, user outcomes |
| `evidenceFreshness` | derived | Age of newest evidence supporting the score; drives `confidenceGrade` |
| `confidenceGrade` | derived | `verified` / `evidenced` / `claimed` / `stale` per §5.3 |
| `claimedOverdue` | derived | True when `confidenceGrade = claimed` AND `lastAssessmentAt > 60d`; surfaces alert per §5.3 |
| `hiveMindSignals` | ingested (governed, §9) | Feedback signals used to refine routing, prompts, coworkers, tools, and taxonomy placement |
| `productizationStatus` | authored (governed, §10.4) | `not_eligible` / `eligible` / `candidate` / `productized` per §10.4 |
| `lastAssessmentAt` | derived | Timestamp of most recent score or grade event |
| `assessedBy` | authored | Human, coworker, hive process, or governed automation |

### 8.1.A MaturityScoreEvent Audit Log

Capability records produce immutable `MaturityScoreEvent` rows on every change to `maturityScore`, `riskTier`, `confidenceGrade`, `productizationStatus`, `dependsOn`, or `strategicOwnership`. Each event carries:

- `capabilityId`, `field`, `previousValue`, `newValue`
- `actor` (human, coworker, or governed automation identifier)
- `evidenceLinks` (PRs, tool executions, runtime verification, Build Studio acceptance, hive-mind signal batches)
- `governanceReviewId` when the change went through review
- `transitionContextRef` (e.g. the `productizationStatus = candidate` transition that the score change is being checked against under §10.4)

This log is what makes §10.4's "any score change within 14 days of candidate transition triggers governance review" enforceable. Without it, anti-inflation is folklore. The §8.1 single-writer is the only mutator. The log is append-only; correction is by compensating event, never by edit.

### 8.1 Assessment Cadence and Governance

Scores rot unless the act of scoring is itself a governed process. The implementation plan must establish:

- **Continuous re-scoring**: hive-mind signal capture (§9) and evidence streams (§5.3) update `evidenceFreshness` and may auto-demote `confidenceGrade` without human action.
- **Tiered review cadence** (sustainable at growth):
  - `critical`: quarterly review of score, `vendorReplacementConfidence`, and `riskTier`.
  - `elevated`: semi-annual by default; quarterly if `confidenceGrade` has moved or `productizationStatus` is `eligible` or `candidate`.
  - `standard` / `low`: opportunistic — reviewed only when triggered by a PR touch, a `claimed_overdue` alert, a hive-mind signal pattern (§9.2), or a dependency cascade change.
- **Reviewer**: WWMD-arbitrated coworker per `docs/superpowers/specs/2026-05-17-wwmd-decision-perspective-kernel-design.md` is the default reviewer of record. Human escalation is automatic when the WWMD outcome is `defer` or `escalate`, when score change exceeds one point, or when a `productizationStatus` transition is at stake. This keeps the cadence sustainable without rubber-stamping.
- **Triggered re-assessment**: any landed PR that touches a capability's `existingPrimitives` enqueues a re-assessment task on its record. Score changes are evidence-linked PR-by-PR, not batch-edited.
- **Single writer**: maturity scoring logic lives in one module (`packages/maturity` candidate per §17.6). Routes, UX, and reports read derived values; nothing else mutates `effectiveMaturity`, `mvpTargetScore`, `confidenceGrade`, `evidenceFreshness`, `claimedOverdue`, or `lastAssessmentAt`.

## 9. Hive-Mind Refinement Loop

The hive mind is the refinement mechanism for the Goldilocks taxonomy. It must not rewrite the canonical taxonomy casually. It should gather evidence and route promotion decisions.

### 9.1 Signal Sources

- users accepting or rejecting coworker recommendations
- repeated manual rerouting of work
- prompts or skills that produce accepted outcomes
- failed tool calls and permission blocks
- approval friction
- runtime recoveries
- Build Studio acceptance failures
- customer-facing assistant outcomes
- evidence quality ratings
- backlog items repeatedly created under the same local refinement

### 9.2 Refinement Outcomes

| Signal Pattern | Outcome |
|----------------|---------|
| Local terminology only | Keep as customer overlay |
| Repeated gap in one customer | Create local backlog and candidate taxonomy note |
| Repeated gap across customers | Propose shared taxonomy refinement |
| Repeated operational failure in mature node | Create improvement backlog under existing node |
| Repeated routing success | Strengthen coworker/tool/prompt defaults |
| Repeated vendor pressure | Raise investment priority and vendor-replacement confidence review |

### 9.3 Promotion Rule

Customer refinements promote to the shared taxonomy only when they are:

1. evidenced by multiple installs or repeated usage,
2. useful for routing or management,
3. not merely customer vocabulary,
4. tied to backlog/evidence,
5. reviewed through a governed taxonomy change process.

## 10. Recursion, Archetypes, Dependencies, and Productization

### 10.1 DPF Recursion

DPF is recursive:

- DPF sells the portal and agent control plane.
- DPF uses Build Studio to manufacture and improve the portal and agent control plane.
- DPF uses hive-mind contribution to decide investment priorities.
- DPF uses the backlog to convert accepted contributions into product work.

### 10.2 Customer Archetypes

Other business archetypes are different. A clinic, MSP, retailer, manufacturer, or professional services firm sells different goods and services. Their `Products and Services Sold` portfolio should reflect their market offer, not DPF's portal. Their `Manufacturing and Delivery` portfolio should reflect how they deliver those goods and services, not blindly mirror Build Studio.

Therefore, DPF must separate:

- canonical platform capability taxonomy,
- DPF-on-DPF operating truth (`installScope = dpf_dogfood`),
- customer archetype overlays (`installScope = customer_overlay`, `archetypeScope` set),
- customer local refinements (overlays with no promotion intent).

This prevents the platform from pretending every customer is a software factory while still letting DPF use itself recursively as the reference implementation. Scores from different `installScope` values are never aggregated silently — a capability at 4 in `dpf_dogfood` and 1 in a fresh customer install must surface both, with the smaller number driving any "ready to sell" claim.

### 10.3 Capability Dependency Graph and Effective Maturity

Capabilities are not islands. A cross-layer kill switch (§6) is only as strong as the runtime, tool gateway, identity, and spend authority it must stop. An evidence ledger is only as credible as the tool execution records it ingests. The maturity model treats this explicitly.

**Rules:**

1. Each capability record names its `dependsOn` set — other capability records it must call through to function.
2. The dependency relationship is a DAG. Cycles are rejected at write time; this is enforced by the writer module, not by social convention.
3. `effectiveMaturity = min(maturityScore, min(dependsOn.effectiveMaturity))`, then -1 if `confidenceGrade = stale` (floor 0).
4. **All gating logic, UX badges, vendor-replacement claims, and productization eligibility (§10.4) read `effectiveMaturity`, never `maturityScore` directly.** This is the single most important invariant in the design — without it, the model lies whenever its dependencies regress.
5. Authoring a `maturityScore` higher than the dependency floor is permitted (it expresses intent) but the dashboard renders the effective number prominently and the raw score as muted secondary text with a "blocked by `<dep>`" annotation.

**Example:** "Cross-Layer Kill Switch" depends on `runtime`, `tool_gateway`, `identity_authority`, `budget_spend`, `evidence_eval`. If any of those is at 2, the kill switch's effective maturity is 2, regardless of how complete the kill-switch UX itself is. The investment surface (§7.1) then surfaces the *dependency* as the unblocking work, not the kill switch.

### 10.4 Productize Promotion Loop

The DPF recursion principle says that mature internal capabilities should become sellable. The maturity model encodes this rather than leaving it as folklore.

**Eligibility rule:** a capability becomes `productizationStatus = eligible` when ALL of the following hold:

1. `strategicOwnership = owned_core`
2. `effectiveMaturity >= mvpTargetScore`
3. `confidenceGrade in {evidenced, verified}`
4. `installScope = canonical` (overlays are not productizable; they are install-local)
5. No open `critical`-severity exceptions in the operations surface

**State machine:**

```text
not_eligible  ──(criteria met)──▶  eligible
                                      │
                       (governed go)  ▼
                                  candidate  ──(packaging, trust report,
                                                customer evidence shipped)──▶  productized
                                      │
                       (regression)   ▼
                                  not_eligible (or eligible, if score still meets target)
```

**Surface rendering:** a third UX mode — "Productize Mode" (§7.3) — is required when `productizationStatus ∈ {eligible, candidate}`. This mode does not replace operations mode; it overlays a "ready to package" affordance on top.

**Anti-pattern guard:** productization pressure must not become an incentive to inflate scores. The implementation must record `productizationStatus` transitions as evidence-linked events, and any score change within 14 days of a `candidate` transition triggers governance review. This protects the score from becoming a sales artifact.

## 11. Build-vs-Buy Policy

The default posture is build-first for core control-plane capabilities.

| Classification | Rule |
|----------------|------|
| `owned_core` | DPF owns the source of truth, policy semantics, UX, evidence, and lifecycle. Vendors may only appear as optional edge adapters. |
| `embedded_accelerator` | DPF may use open-source code or libraries when they are self-hostable, replaceable, and do not own the DPF control point. |
| `boundary_adapter` | DPF integrates through a stable external protocol because the external system is a customer-owned system of record or payment/identity rail. |
| `avoid` | Do not adopt. The tool duplicates DPF core, creates brittle dependency, or forces vendor-owned control semantics. |

Core capabilities that should normally be `owned_core`:

- identity authority semantics
- agent runtime state
- MCP and tool policy
- evidence ledger
- maturity scoring
- taxonomy placement
- backlog fan-out
- hive-mind refinement
- kill switch
- cost and budget policy
- customer/product ownership mapping

Capabilities that can be `boundary_adapter`:

- enterprise IdP edge integration
- payment rail
- customer warehouse
- customer ticketing system
- customer CRM/ERP source of record
- optional observability export

**`boundary_adapter` qualifying criteria** (all must hold; otherwise it is an `embedded_accelerator` or it is `avoid`):

1. The external system is owned by the customer or by a market-wide rail (Stripe, Plaid, an enterprise IdP), not by a single vendor whose disappearance would strand DPF.
2. The integration is over an open or multi-vendor protocol (OIDC, OAuth2, OpenTelemetry, SCIM, ACH, FHIR, SQL), not a proprietary client SDK with no replaceable peer. MCP is an interface DPF *exposes and consumes* as `owned_core` policy surface — it is not yet a multi-vendor peer protocol the way OIDC is, so MCP-based access to a single-vendor agent surface (e.g. one provider's hosted MCP) does not qualify a dependency as `boundary_adapter` on this criterion alone.
3. DPF retains the source of truth for the corresponding `capabilityCategory` (identity *authority* stays at DPF even when identity *edge* is Okta).
4. The adapter is swap-out testable: at least one alternate provider in the same category has a documented adapter path, even if not yet implemented.
5. Customer data flowing through the adapter remains attributable in the DPF evidence ledger; the adapter does not become a black-box gap in `evidenceSources`.

A `boundary_adapter` that fails any of these criteria during review must be reclassified — either upgraded to `owned_core` (rare; the external system is genuinely customer-owned but the protocol is proprietary) or downgraded to `avoid` (the dependency is vendor lock-in dressed up).

## 12. UX Surface Requirements

### 12.0 Audit-Grounded Acceptance Gates

The 2026-05-20 portal UX audit ([`docs/superpowers/audits/2026-05-20-portal-ux-audit.md`](../audits/2026-05-20-portal-ux-audit.md)) walked `/portfolio` and `/portfolio/architecture` and recorded six findings that any maturity-surface implementation must address before it can ship. Two are critical, four are important:

| Audit Ref | Finding | §12 Subsection |
|-----------|---------|----------------|
| S2.4 / S2.6 | "1 alert firing" chip on `/portfolio` with no drill-through; `OPEN BACKLOG = 121 (20 in progress)` on `/portfolio` situation summary disagrees with `/workspace` (`OPEN WORK = 156`) and `/ops` (`440 items across 51 epics`) — three counters, three values, no source of truth | §12.1, §12.2 |
| S2.4 | Inner-rail label truncates to "Products and Services S…" — the four-portfolio name does not fit the AppRail width | §12.4 |
| S2.4 | 117 products concentrated in one of four portfolios — distribution skew is invisible on the `/portfolio` root, so the operator cannot tell that "Products and Services Sold" is doing all the work | §12.3 |
| S2.4 | `/portfolio/architecture` shows an empty state with no guidance on how to populate it | §12.1 |
| S2.10 (positive) | `/knowledge` portfolio sub-tabs are the working sub-nav pattern — maturity overlays must layer on this rather than introducing a new navigation mode | §12.4 |
| S2.8 | `/platform/ai` shows every coworker as "0 active grants" while `/platform` shows `STANDING TOOL GRANTS = 517`. Generalizes to: any maturity dashboard counter must reconcile against its source-of-truth aggregate when both are visible | §12.1 |

[AGT-906](../specs/2026-05-16-ux-auditor-coworker-design.md) (UX-auditor coworker, in design) is the gating reviewer of record for these criteria. Until AGT-906 is shipped, implementation reviewers apply the 22-lens rubric manually using the May 20 audit as the worked example.

### 12.1 Portfolio Route

The `/portfolio` experience should become the natural home for capability maturity because portfolio is already the management lens. Each root portfolio and taxonomy node should be able to show:

- maturity score summary
- MVP target
- operational state
- investment gaps
- linked epics and backlog
- evidence coverage
- vendor replacement confidence
- hive-mind signals
- customer overlay differences

**Count source-of-truth invariant** (absorbs audit BI-CANDIDATE-S2-08): every numeric surface rendered on `/portfolio` (open backlog, alert count, evidence count, exception count, product count, maturity-coverage tally) must read from a **single named projection** shared across `/workspace`, `/portfolio`, and `/ops`. If a counter cannot be reconciled to one such projection, it is removed rather than displayed. The maturity dashboard is forbidden from introducing a fourth "open work" number.

**Drill-through invariant** (absorbs S2.4 "1 alert firing" finding): no chip, badge, or alarm on a maturity surface renders without a destination route. `N alerts firing` chips drill into the underlying `BacklogItem` / `ToolExecution` failure / `RuntimeVerification` regression list, filtered to the chip's scope. Decorative status pills are forbidden — same lesson as the Six-C matrix per audit §4.1.

**Empty-state invariant** (absorbs `/portfolio/architecture` finding): every maturity-surface route that can legitimately be empty (no capabilities scored, no evidence yet flowed, no architecture modeled) ships with a first-load guidance card naming the next action — "Run capability assessment", "Seed initial scores from §6 bootstrap", "Open epic EP-…" — not a blank canvas.

### 12.2 Management Surface Behavior

When a capability is mature, the UI should feel like an operations console: compact, evidence-rich, and action-oriented.

Expected controls:

- filter by portfolio, score, owner, and strategic ownership
- drill into evidence
- view linked runtime/tool/cost records
- review exceptions
- open improvement backlog
- trigger assessment refresh

**Counter reconciliation gate** (absorbs S2.8 generalization): when an operations-mode surface shows both an aggregate counter (e.g. "STANDING TOOL GRANTS 517") and per-row values that should sum or filter into that aggregate (e.g. each coworker's "active grants" count), the writer module verifies the two views agree at render time and surfaces a reconciliation failure as itself a maturity defect — not as silent UI drift.

### 12.3 Investment Surface Behavior

When a capability is immature, the UI should feel like portfolio investment analysis:

- show the current gap
- show why the gap matters
- show market/vendor pressure
- show build-vs-buy recommendation
- show the next implementation slices
- link to specs/plans/backlog
- show expected maturity lift after each slice

**Portfolio-concentration signal** (absorbs S2.4 "117 of N in one portfolio" finding): if one of the four portfolio roots holds more than 3× the median product / capability / epic count of the other three, that concentration imbalance renders on `/portfolio` root as an investment-mode signal with its own §7.1 framing — "this portfolio is doing 80% of the catalog's work; investment in the other three is the gap." Without this surface, skewed distribution is invisible and the four-portfolio taxonomy quietly degenerates into a one-portfolio operation.

### 12.4 Theme and Design Guardrails

Any UI implementation must follow DPF theme-aware styling:

- no hardcoded colors
- use DPF CSS custom properties
- use compact dashboard typography
- avoid decorative card-heavy marketing layouts
- no nested cards
- preserve dense scanability for portfolio operators

**Label-fit invariant** (absorbs S2.4 "Products and Services S…" finding): portfolio root names — including `Products and Services Sold` and `Manufacturing and Delivery` — must render in full at every supported viewport width. If AppRail or inner-rail width is constrained, the portfolio record carries a documented `displayShort` variant (e.g. "Sold", "Manufacturing") used in lieu of CSS truncation. Truncating the canonical taxonomy label with `…` is forbidden — it destroys the operator's ability to scan the taxonomy.

**Layer-on-existing-nav invariant** (absorbs S2.10 positive finding): the maturity surface MUST be a render mode on existing `/portfolio` and `/portfolio/product/[id]` sub-tab structure, not a new sub-route. The `/knowledge` sub-tab pattern is the working precedent and the implementation copies it. Introducing a new top-level `/portfolio/maturity` tab is rejected at review.

### 12.5 Maturity Surface Audit Gates (for review)

Every maturity-surface PR must satisfy the following lenses from the AGT-906 22-lens rubric before merge, regardless of automated checks:

- `functionality` — every interactive element has a verified destination; no decorative chips
- `data-completeness` — no field renders as "Not assigned" / "Unknown" / "—" when a source-of-truth count says data exists (per S2.8 generalization)
- `confidence-signal` — system prompts, coworker setup instructions, and `[tool-trace]` debug output never render in operator-visible transcripts or panels (per S2.7)
- `object-oriented-ux` — every numeric surface drills into the query that produced it (per S2.4 Six-C matrix lesson)
- `literal-copy` — operator-facing labels use plain language, not schema vocabulary (per §4.1 Six-C column-header finding)
- `millers-law` — at most two header tiers above the first content row (per §4.1 workspace header-stack finding)

This is the manual interim gate until AGT-906 ships; once AGT-906 is live, these become its acceptance-evidence assertions per [`2026-05-16-ux-auditor-coworker-design.md`](../specs/2026-05-16-ux-auditor-coworker-design.md).

## 13. Backlog Fan-Out Model

This specification is the umbrella. Work should splay out into smaller efforts rather than one large implementation.

### 13.1 Existing Epic Fan-Out

| Effort | Preferred Epic |
|--------|----------------|
| Work Capsule and runtime attachment maturity | `EP-CAPSULE` |
| Coworker runtime and A2A task maturity | `EP-COWORKER-RT`, `EP-A2A` |
| MCP gateway/tool exposure maturity | `EP-MCP`, `EP-WWMD-MCP` |
| Cost, budget, and model routing maturity | `EP-COST-001` |
| Hive-mind and user contribution refinement | `EP-HIVE-SCOUT`, `EP-BIZ-CAP` |
| Build Studio manufacturing maturity | `EP-BUILD-STUDIO` |
| Integration benchmark and private deployment posture | `EP-INT-2E7C1A` |
| Identity, TAK, GAID, governed memory | `EP-TAK-3F9A21` |
| Operator maps and failure routing | `EP-AI-OPSMAP` |

### 13.2 Candidate New Efforts

Only create these if overlap review confirms no existing epic owns them:

| Candidate Effort | Purpose |
|------------------|---------|
| Agent Control Plane Maturity Surface | Capability assessment model, scoring, portfolio UX, investment/operations mode |
| Semantic Data Plane | Governed metrics, lineage, freshness, data contracts, policy-aware RAG/query |
| Agent Commerce and Spend Authority | Agent spend limits, approvals, receipts, payment adapter, freeze controls |
| Cross-Layer Kill Switch | Stop/revoke/freeze across runtime, tools, tokens, spend, deployment, evidence preservation |
| Vendor Benchmark and Replacement Confidence | Market category tracking, build-vs-buy scoring, open-source accelerator registry |

### 13.3 Suggested First Slices

1. **Capability Assessment Foundation**
   - Audit existing models.
   - Add or reuse a record for capability maturity assessments.
   - Seed initial categories and scores for the agent control plane.

2. **Portfolio Maturity Surface**
   - Add read-only maturity summaries to `/portfolio`.
   - Render investment mode for below-target capabilities.
   - Render operations mode for target-met capabilities.

3. **Evidence and Backlog Rollup**
   - Link assessments to epics, backlog items, runtime verification, tool executions, and Build Studio evidence.
   - Surface stale or weak evidence.

4. **Hive-Mind Signal Capture**
   - Capture user acceptance/rejection and rerouting signals.
   - Attribute signals to portfolio/taxonomy/capability records.

5. **Vendor Replacement Confidence**
   - Track commercial benchmark category, DPF score, owned-core posture, and adapter/accelerator status.
   - Show where DPF can replace a vendor category versus where an adapter is still needed.

6. **Semantic Data Plane Deep Dive**
   - Design the data/knowledge control plane separately.
   - This is the weakest maturity area and should get its own spec.

## 14. Refactoring Budget

Each implementation slice should reserve roughly 20 percent of effort for refactoring that directly reduces future integration sprawl.

Priority refactors:

- extract runtime coordination and evidence-linking logic out of oversized MCP handlers
- centralize maturity scoring and capability ownership rules
- separate vendor benchmark data from operational assessment data
- keep taxonomy structure separate from customer overlays and maturity assessments
- centralize authority and policy evaluation interfaces
- normalize evidence links across Build Studio, Work Capsules, runtime verification, tool execution, PRs, and backlog

Refactoring is not cosmetic here. It is part of the anti-sprawl strategy.

## 15. Acceptance Criteria

The design is successful when later implementation can prove the following. **Functional criteria** describe what users see; **architectural criteria** describe invariants the implementation must preserve.

### 15.1 Functional

1. Each agent-control-plane capability is mapped to one of the four portfolios.
2. Each assessed capability has a current score and an MVP target score *derived from `riskTier`*, not authored per row.
3. Lagging capabilities generate investment/gap-analysis views.
4. Mature capabilities generate operations/management views.
5. Capabilities at `productizationStatus ∈ {eligible, candidate}` generate productize-mode views (§7.3).
6. Backlog links show which efforts will raise maturity.
7. Evidence links show why a score is credible, with `confidenceGrade` visible.
8. Hive-mind signals can refine scores, routing, backlog, and taxonomy placement.
9. Vendor categories are evaluated as `owned_core`, `embedded_accelerator`, `boundary_adapter`, or `avoid`, with `boundary_adapter` decisions backed by the §11 qualifying criteria.
10. Customer overlays can refine local taxonomy without mutating the canonical shared taxonomy.
11. DPF-on-DPF recursion is explicit: Build Studio manufactures DPF, and DPF itself is the sold product for the DPF archetype.
12. The maturity surface passes the §12.0 / §12.5 audit gates derived from the 2026-05-20 portal UX audit: every numeric surface drills into a single named projection; every status chip has a destination; portfolio root labels render full at every viewport width; one-portfolio concentration imbalance renders as an investment signal; the surface layers on existing `/portfolio` sub-tab nav, not a new sub-route.

### 15.2 Architectural (invariants the implementation must preserve)

12. **No parallel taxonomy**: the maturity model attaches to existing `Portfolio` / `TaxonomyNode` / `EaElement`; greenfielded substrate is justified by a written audit that proves the existing models cannot carry the concept.
13. **Single source of maturity logic**: `effectiveMaturity` and `confidenceGrade` are computed in one module; routes, UX, and reports read derived values and never mutate them.
14. **Dependency cascade enforced**: every UX badge, gate, vendor-replacement claim, and productization eligibility check reads `effectiveMaturity`, not `maturityScore`.
15. **Scope isolation**: scores from different `installScope` values never aggregate silently; any roll-up renders the minimum prominently.
16. **Evidence decay active**: `evidenced` and `verified` scores without fresh evidence (per §5.3 thresholds) demote to `stale` and lose 1 effective point automatically. `claimed` scores do NOT decay on age, but a `claimed` row older than 60 days surfaces a `claimed_overdue` alert and enqueues a re-assessment task. Both rules are wired in code, not in policy documents.
17. **Anti-inflation guard**: score changes within 14 days of a `productizationStatus = candidate` transition route through governance review. Enforceable because every change is logged per AC #19.
18. **DAG enforcement**: the writer for `dependsOn` rejects cycles at write time, not at render time.
19. **Immutable score history**: every mutation to `maturityScore`, `riskTier`, `confidenceGrade`, `productizationStatus`, `dependsOn`, or `strategicOwnership` emits a `MaturityScoreEvent` row per §8.1.A. The log is append-only; correction is by compensating event.
20. **Single mutator**: only the `packages/maturity` (or equivalent) writer module mutates derived fields. Migrations that allow direct UPDATE on `effectiveMaturity`, `mvpTargetScore`, `confidenceGrade`, `evidenceFreshness`, `claimedOverdue`, or `lastAssessmentAt` from other code paths are rejected in review.

## 16. Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Creating a parallel agent taxonomy | Attach capability maturity to the existing four-portfolio taxonomy. |
| Overloading `TaxonomyNode` with maturity state | Audit schema first; prefer extending `EaElement` or a separate assessment record linked to taxonomy nodes. |
| Turning benchmarks into vendor dependencies | Record vendors as references and adapters, not sources of truth. |
| Scoring becoming subjective | Require §5.1 evidence gates, §5.3 decay, and §8.1 governed cadence. |
| Customer refinements polluting core taxonomy | Use overlays and governed promotion rules. |
| UI becoming a dashboard blob | Split investment / operations / productize modes and keep views portfolio-native. |
| Integration sprawl returning through "accelerators" | Require `strategicOwnership` classification and the §11 `boundary_adapter` qualifying criteria. |
| **Dependency-cascade blindness** — capability scored 4 while a load-bearing dep is at 2; kill switch claimed governed while runtime substrate is immature | `effectiveMaturity = min(self, deps)` enforced in single writer module (§10.3); UX renders effective number prominently with dep-blocked annotation. |
| **Productization pressure inflating scores** — sales narrative pushes scores up to unblock a candidate offering | §10.4 anti-pattern guard: any score change within 14 days of `candidate` transition triggers governance review; transitions are evidence-linked events. |
| **Hive-mind feedback hijack** — biased or manipulated signal sources cause unwarranted score movement or routing changes | Signal sources carry provenance and weight; score deltas from hive-mind inputs are auditable and reversible; the writer rejects signal batches without provenance metadata. |
| **Score rot in `dpf_dogfood` masking customer reality** — DPF's own install scores carry the dashboard while a fresh customer install would score far lower | `installScope` separation (§10.2); any "ready to sell" or `productizationStatus = eligible` claim requires `installScope = canonical` and validation against at least one non-dogfood install. |
| **Governance-bottleneck rubber-stamping** — once the capability count grows past ~20 critical/elevated rows, uniform quarterly review by humans becomes unsustainable and degrades to rubber-stamp approval | Tiered cadence in §8.1: `critical` quarterly, `elevated` semi-annual (quarterly only when status changes), `standard`/`low` opportunistic. WWMD-arbitrated coworker as reviewer of record with automatic human escalation on `defer`/`escalate`, multi-point score moves, or productization transitions. |
| **`riskTier` inflation** — every record drifts to `critical` to demand more investment budget, neutralizing the §5.2 derivation | §5.2.1 governance: `critical`/`elevated` require a citable breach scenario; tier changes are logged events; writer warns when the `critical` share of the catalog crosses ~one-third without explicit kernel-principle justification. |
| **Mode-precedence violation** — UX shows Productize affordance on a capability whose raw `maturityScore` qualifies but whose `effectiveMaturity` is dragged below target by a dependency | §7.0 fixed precedence (Investment > Operations, Productize as Operations-only overlay) enforced against `effectiveMaturity`, not `maturityScore`; AC #14 already requires this for all gating logic. |
| **Counter drift on `/portfolio`** — the maturity dashboard introduces a fourth or fifth "open work" number that disagrees with `/workspace`, `/portfolio` situation summary, and `/ops` (per 2026-05-20 audit S2.6: 121 vs 156 vs 440) | §12.1 count source-of-truth invariant: every numeric surface reads from one named projection shared across the three routes; counters that cannot reconcile are removed rather than displayed; AGT-906 enforces at review time. |
| **Decorative status pills** — "N alerts firing" / "blocked" chips render without drill-through (per audit S2.4 `/portfolio`, §4.1 Six-C matrix) | §12.1 drill-through invariant: every chip resolves to a filtered list of underlying objects; no decorative pills permitted on maturity surfaces; AGT-906 lens `functionality` blocks ship. |
| **Portfolio-name truncation** — canonical taxonomy labels render as "Products and Services S…" in constrained rails, destroying scanability of the four-portfolio model | §12.4 label-fit invariant: portfolio records carry `displayShort`; CSS `…` truncation of canonical labels is forbidden. |
| **Hidden one-portfolio concentration** — 117 of N products live in one of four portfolios and the dashboard does not surface the skew (per audit S2.4) | §12.3 portfolio-concentration signal: imbalance > 3× median renders as an investment-mode finding on `/portfolio` root with §7.1 framing. |
| **Maturity overlay invents new navigation** — implementation adds a `/portfolio/maturity` sub-tab instead of layering on existing sub-tab nav | §12.4 layer-on-existing-nav invariant: maturity is a render mode on existing routes; new top-level sub-routes rejected at review. |

## 17. Open Decisions for the Implementation Plan

1. Should the first implementation create a new `CapabilityMaturityAssessment` model, or extend `EaElement` (or another existing portfolio quality/scorecard model) with a maturity companion? The §8 audit must answer this before any migration is written.
2. Should the first UI land under `/portfolio`, `/platform/ai/operations`, or both with one canonical data source?
3. Should vendor benchmark data be repo-seeded JSON first, DB-managed later, or managed immediately through the portal?
4. What minimum hive-mind signals are already captured and can be reused without new event models? Specifically, can `ToolExecution`, `RuntimeVerification`, Build Studio acceptance events, and existing coworker feedback rows carry the §9 signal payload, or is a new `MaturitySignal` event model required?
5. Which capability scores should be treated as DPF-authored initial seed versus live assessed state? Per §5.3, seed scores carry `confidenceGrade = claimed` (which does not auto-decay), and per §6 the §6 table is the canonical bootstrap. The `claimed_overdue` alert at 60 days is the visibility mechanism that prevents seed from becoming the resting state — seed is bootstrap, never the resting state.
6. Where does the single-writer module for `effectiveMaturity` and `confidenceGrade` live? Candidate: a `packages/maturity` module consumed by both API routes and Build Studio gates.
7. Who is the governed reviewer of record for `critical` and `elevated` quarterly reviews? Human-only, or WWMD-arbitrated coworker grounded in `docs/superpowers/specs/2026-05-17-wwmd-decision-perspective-kernel-design.md` with human escalation?
8. How are `productizationStatus = candidate` transitions surfaced for governance — Build Studio brief, dedicated portal queue, or both?
9. Which existing `/portfolio` sub-tab is the maturity render mode's primary anchor — `/portfolio` root, `/portfolio/architecture`, `/portfolio/product/[id]/health`, or all three with different scope? The §12.4 layer-on-existing-nav invariant requires re-use of an existing tab, not a new one — the plan must pick which. The 2026-05-20 audit notes `/portfolio/architecture` is currently an empty state (good landing point if seeded properly) and `/portfolio/product/[id]/health` already exists as a per-product surface (good candidate for per-capability detail).
10. What is the single named projection for "open work" that `/workspace`, `/portfolio`, `/ops`, and the maturity dashboard all read from per §12.1? BI-CANDIDATE-S2-08 from the audit owns the audit/repair of existing counters; the maturity plan must subscribe to that projection rather than spawning a fifth one.
11. Is the matching `displayShort` variant for portfolio root names (§12.4 label-fit invariant) authored on the `Portfolio` record itself, on the `portfolio_registry.json` seed, or derived from an inflection rule? Authoring on the record is most explicit; deriving is brittle for two-word names ("Sold" vs "Services").

These decisions should be resolved in the implementation plan after schema and route audit.
