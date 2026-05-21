# Four-Portfolio Agent Control Plane Maturity Design

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Date** | 2026-05-21 |
| **Author** | Codex + Mark Bodman |
| **Primary Objective** | Turn the existing four-portfolio taxonomy into an investment, gap-analysis, and operations surface for DPF's agent control plane maturity |
| **Scope** | Portfolio taxonomy, capability maturity scoring, hive-mind refinement, backlog fan-out, and build-first vendor-replacement posture |
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

| Score | Meaning | Investment Interpretation | Operations Interpretation |
|-------|---------|---------------------------|---------------------------|
| 0 | Missing | Create discovery/spec backlog | No operations surface |
| 1 | Isolated primitive | Build foundation and canonical data home | Manual inspection only |
| 2 | Used in one workflow | Expand coverage and close enforcement gaps | Workflow-local status |
| 3 | Used across primary workflows | Productize UX, metrics, and ownership | Basic management surface |
| 4 | Governed and operator-visible | Harden edge cases and automate feedback | Normal operations surface |
| 5 | Self-improving through hive-mind/user feedback | Invest in optimization and monetization | Continuous improvement surface |

MVP target for broad-spectrum vendor replacement is normally score `3` or `4`, depending on risk:

- `3` is acceptable for non-critical or low-risk areas.
- `4` is required for identity, authority, runtime control, tool execution, data access, evidence, spend, and kill switch.
- `5` is an optimization target, not an MVP requirement.

## 6. Initial DPF Maturity Assessment

These scores are an initial design assessment based on repository evidence and live DB fallback. They are not final audited scores.

| Capability | Primary Portfolio | Supporting Portfolios | Current Score | MVP Target | Existing DPF Strength | Main Maturity Gap | Existing Epic Anchor |
|------------|-------------------|-----------------------|---------------|------------|-----------------------|-------------------|----------------------|
| Principal identity and authority | Foundational | For Employees, Products and Services Sold | 3 | 4 | Principal, PrincipalAlias, grants, authority specs | Universal principal propagation, delegated consent, token vault | `EP-TAK-3F9A21`, `EP-COWORKER-RT` |
| MCP and tool governance | Foundational | Manufacturing and Delivery | 3 | 4 | MCP tools, grants, token onboarding, marketplace direction | Gateway hardening, readiness, scope UX, external MCP maturity | `EP-MCP`, `EP-WWMD-MCP` |
| A2A coworker coordination | Manufacturing and Delivery | For Employees | 2 | 4 | A2A spec and coworker runtime work | Task-native handoff, resumability, acceptance evidence | `EP-A2A`, `EP-COWORKER-RT` |
| Work Capsules and runtime control | Manufacturing and Delivery | Foundational | 3 | 4 | WorkCapsule, runtime target direction, Build Studio attachment | Mandatory wrapper across all meaningful agent work | `EP-CAPSULE`, `EP-BUILD-STUDIO` |
| Governance evidence ledger | Manufacturing and Delivery | Foundational, For Employees | 3 | 4 | ToolExecution, receipts, runtime verification, Build Studio evidence | Unified operator evidence UX and cross-surface linking | `EP-CAPSULE`, `EP-AI-OPSMAP` |
| Hive mind and user refinement | For Employees | Manufacturing and Delivery, Products and Services Sold | 2 | 4 | Hive Scout, portal context overlay, contribution direction | Measurable signal capture and promotion rules | `EP-HIVE-SCOUT`, `EP-BIZ-CAP`, `EP-CAPSULE` |
| Observability, evals, and cost ledger | Foundational | Manufacturing and Delivery | 2 | 4 | Cost governance plan, ToolExecution, Grafana/Prometheus | Trace/eval datasets, outcome scoring, cost per useful result | `EP-COST-001`, `EP-AI-OPSMAP` |
| Semantic data and knowledge plane | Foundational | All portfolios | 1 | 3 | Qdrant, Neo4j, docs/specs, backlog, knowledge foundations | Governed semantic metrics, lineage, freshness, policy-aware RAG/query | Candidate effort: Semantic Data Plane |
| Spend/payment authority | Foundational | Products and Services Sold | 1 | 3 | Invoice/Payment models, cost governance, integration harness | Agent spend limits, payment custody, approvals, receipts, freeze controls | Candidate effort: Agent Commerce and Spend Authority |
| Customer-facing agent services | Products and Services Sold | Foundational, For Employees | 2 | 3 | Customer assistant direction, portal/product surfaces | Packaging, trust reports, sellable offers, customer evidence | Candidate effort: Agent Control Plane Productization |
| Cross-layer kill switch | Foundational | All portfolios | 2 | 4 | Grants, runtime records, cost controls, tool execution records | One stop/revoke/freeze operation across runtime, tools, tokens, spend, deployment | Candidate effort: Cross-Layer Kill Switch |

## 7. Investment vs Operations Surface

The same taxonomy node must render differently based on maturity.

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

This prevents the taxonomy from becoming a static catalog. It becomes the operating map for both investment and management.

## 8. Required Capability Record

Implementation should introduce a capability record or assessment layer that links to existing taxonomy nodes rather than overloading `TaxonomyNode` with all maturity semantics. The implementation plan must audit `Portfolio`, `DigitalProduct`, `TaxonomyNode`, `BacklogItem`, `EaElement`, `RuntimeTarget`, `RuntimeVerification`, `ToolExecution`, and related models before adding schema.

Each assessed capability needs these fields at minimum:

| Field | Purpose |
|-------|---------|
| `portfolioId` | One of the four canonical portfolio roots |
| `taxonomyNodeId` | The node where the capability is managed |
| `capabilityCategory` | Agent-control-plane category, such as runtime, identity, data, observability, spend, gateway |
| `maturityScore` | Current 0-5 score |
| `mvpTargetScore` | Required MVP score |
| `strategicOwnership` | `owned_core`, `embedded_accelerator`, `boundary_adapter`, or `avoid` |
| `vendorReplacementConfidence` | Low, medium, high, or verified |
| `existingPrimitives` | DPF models, routes, tools, specs, and epics already covering the capability |
| `maturityGaps` | Enforcement, UX, data, policy, evidence, and workflow gaps |
| `operationalSurface` | Route or product surface where robust capabilities are managed |
| `investmentBacklogLinks` | Epics/backlog items that close maturity gaps |
| `evidenceSources` | Tool executions, runtime verification, Build Studio evidence, PRs, tests, user outcomes |
| `hiveMindSignals` | Feedback signals used to refine routing, prompts, coworkers, tools, and taxonomy placement |
| `lastAssessmentAt` | Timestamp for stale-score detection |
| `assessedBy` | Human, coworker, hive process, or governed automation |

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

## 10. DPF Recursion and Business Archetypes

DPF is recursive:

- DPF sells the portal and agent control plane.
- DPF uses Build Studio to manufacture and improve the portal and agent control plane.
- DPF uses hive-mind contribution to decide investment priorities.
- DPF uses the backlog to convert accepted contributions into product work.

Other business archetypes are different. A clinic, MSP, retailer, manufacturer, or professional services firm sells different goods and services. Their `Products and Services Sold` portfolio should reflect their market offer, not DPF's portal. Their `Manufacturing and Delivery` portfolio should reflect how they deliver those goods and services, not blindly mirror Build Studio.

Therefore, DPF must separate:

- canonical platform capability taxonomy,
- DPF-on-DPF operating truth,
- customer archetype overlays,
- customer local refinements.

This prevents the platform from pretending every customer is a software factory while still letting DPF use itself recursively as the reference implementation.

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

## 12. UX Surface Requirements

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

### 12.2 Management Surface Behavior

When a capability is mature, the UI should feel like an operations console: compact, evidence-rich, and action-oriented.

Expected controls:

- filter by portfolio, score, owner, and strategic ownership
- drill into evidence
- view linked runtime/tool/cost records
- review exceptions
- open improvement backlog
- trigger assessment refresh

### 12.3 Investment Surface Behavior

When a capability is immature, the UI should feel like portfolio investment analysis:

- show the current gap
- show why the gap matters
- show market/vendor pressure
- show build-vs-buy recommendation
- show the next implementation slices
- link to specs/plans/backlog
- show expected maturity lift after each slice

### 12.4 Theme and Design Guardrails

Any UI implementation must follow DPF theme-aware styling:

- no hardcoded colors
- use DPF CSS custom properties
- use compact dashboard typography
- avoid decorative card-heavy marketing layouts
- no nested cards
- preserve dense scanability for portfolio operators

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

The design is successful when later implementation can prove:

1. Each agent-control-plane capability is mapped to one of the four portfolios.
2. Each assessed capability has a current score and MVP target score.
3. Lagging capabilities generate investment/gap-analysis views.
4. Mature capabilities generate operations/management views.
5. Backlog links show which efforts will raise maturity.
6. Evidence links show why a score is credible.
7. Hive-mind signals can refine scores, routing, backlog, and taxonomy placement.
8. Vendor categories are evaluated as `owned_core`, `embedded_accelerator`, `boundary_adapter`, or `avoid`.
9. Customer overlays can refine local taxonomy without mutating the canonical shared taxonomy.
10. DPF-on-DPF recursion is explicit: Build Studio manufactures DPF, and DPF itself is the sold product for the DPF archetype.

## 16. Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Creating a parallel agent taxonomy | Attach capability maturity to the existing four-portfolio taxonomy. |
| Overloading `TaxonomyNode` with maturity state | Audit schema first and prefer a separate assessment record linked to taxonomy nodes. |
| Turning benchmarks into vendor dependencies | Record vendors as references and adapters, not sources of truth. |
| Scoring becoming subjective | Require evidence links and stale-score detection. |
| Customer refinements polluting core taxonomy | Use overlays and governed promotion rules. |
| UI becoming a dashboard blob | Split investment mode from operations mode and keep views portfolio-native. |
| Integration sprawl returning through "accelerators" | Require `strategicOwnership` classification and replaceability review. |

## 17. Open Decisions for the Implementation Plan

1. Should the first implementation create a new `CapabilityMaturityAssessment` model, or should it reuse an existing portfolio quality/EA assessment model?
2. Should the first UI land under `/portfolio`, `/platform/ai/operations`, or both with one canonical data source?
3. Should vendor benchmark data be repo-seeded JSON first, DB-managed later, or managed immediately through the portal?
4. What minimum hive-mind signals are already captured and can be reused without new event models?
5. Which capability scores should be treated as DPF-authored initial seed versus live assessed state?

These decisions should be resolved in the implementation plan after schema and route audit.
