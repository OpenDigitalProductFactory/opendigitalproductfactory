# Continuous Improvement Flywheel — Design Spec

**Date:** 2026-04-05  
**Status:** Draft  
**Scope:** Platform principle, portfolio governance pattern, data model refactor, backlog integration, and Build Studio handoff  
**Related specs:** `2026-03-16-platform-feedback-loop-design.md`, `2026-03-19-eval-loop-design.md`, `2026-03-20-adaptive-loop-design.md`, `2026-03-26-technical-debt-management-open-fair-design.md`

## Overview

The platform should continuously improve itself by observing how humans, AI coworkers, Build Studio, tools, and routing decisions perform in practice, then converting the highest-value improvement opportunities into governed work. This is not a side workflow. It is a core operating principle of the Digital Product Factory.

The unifying concept remains the **Digital Product**. Every meaningful improvement signal should be traceable to a Digital Product, a portfolio, or a cross-portfolio root cause. That allows the platform to balance the needs of local users with the needs of the whole company, and eventually to contribute reusable improvements back to the common product.

This spec defines a portfolio-aware continuous improvement flywheel that:

- captures interaction and outcome signals across the platform
- evaluates them daily against company-level objectives
- identifies the top 3 improvement opportunities
- files them into the common backlog in `proposed` status
- generates Build Studio execution candidates when appropriate
- supports local-only adaptation and upstream contribution as one governed system

## Problem Statement

The platform already captures several fragments of improvement-related information:

- `ImprovementProposal` captures friction and suggestions from agent conversations
- `PortfolioQualityIssue` captures quality findings linked to products and portfolios
- `BacklogItem` provides the main work queue
- `FeatureBuild` and Build Studio capture implementation execution
- routing, provider, tool, and observation subsystems generate operational evidence

But these remain fragmented in four important ways:

1. **Signals are not normalized.** The platform can observe failures, friction, complaints, retries, empty responses, poor routing choices, stalled builds, or degraded tools, but those do not yet feed one canonical improvement-assessment loop.
2. **Improvement governance is incomplete.** `ImprovementProposal` is useful for conversational friction, but it is not yet the basis of a portfolio-wide daily prioritization system tied directly to company objectives.
3. **The backlog remains too weak as a proposal queue.** The common backlog is the right destination, but it does not yet cleanly distinguish observed opportunities from committed funded work.
4. **Cross-portfolio root causes are under-modeled.** A local complaint may actually be caused by a foundational technology issue or an upstream process defect. The system needs graph-aware reasoning to connect symptoms to leverage points.

The result is that the platform can notice problems, but it cannot yet turn that knowledge into a disciplined self-improvement flywheel.

## Platform Principle

This feature should be treated as an overarching platform principle, not just a route or subsystem.

### Principle Statement

The Digital Product Factory improves itself by:

- observing real work and real outcomes
- evaluating them against the goals of the whole company
- surfacing the highest-leverage opportunities
- governing them in one visible backlog system
- executing them through the normal delivery paths, including Build Studio when appropriate
- contributing reusable improvements back to the common platform when justified

### Why This Matters

This principle is part of:

- product design
- operating model
- portfolio governance
- AI coworker behavior
- Build Studio execution
- product documentation
- external messaging and marketing

The platform should be understandable as a system that does not only help organizations improve their digital products, but also uses those same principles to evolve itself.

## Research & Benchmarking

This design should follow proven patterns where they exist, while deliberately extending them for recursive platform self-improvement.

### Open Source Systems Reviewed

#### Plane

Plane’s intake model emphasizes a **single request entry point** for scattered asks and feedback. Its intake positioning reinforces the value of consolidating requests rather than letting them disappear into email, chat, or side processes. That aligns strongly with the “one common backlog, many views” direction for DPF.

Patterns adopted:

- one intake surface for heterogeneous requests
- normalize scattered signals before routing them
- reduce operational overhead by centralizing asks

Patterns rejected:

- a standalone intake queue disconnected from strategic portfolio evaluation

#### OpenProject

OpenProject’s portfolio management documentation highlights the value of a **single source of truth**, strategic grouping of initiatives, and filtered cross-project views. It reinforces that portfolio governance should sit above operational work, not replace it.

Patterns adopted:

- one underlying work system with multiple filtered views
- high-level portfolio reporting over the same work records
- strategic oversight above project-level detail

Patterns rejected:

- treating portfolio oversight as a separate manual reporting layer

#### Backstage / Spotify Portal Soundcheck

Backstage ecosystem scorecards and Soundcheck show the value of making **technical health visible and actionable to owners** rather than burying quality checks in dashboards no one uses. This is directly relevant to technical and operational improvement signals.

Patterns adopted:

- health scorecards attached to owned entities
- visible, actionable standards rather than passive telemetry
- improvement pressure tied to accountable owners

Patterns rejected:

- scorecards that stop at visibility and do not feed backlog or execution

### Commercial Systems Reviewed

#### Jira Product Discovery

Jira Product Discovery’s core pattern is linking **insights** to **ideas**, then tying ideas to **delivery work** using goals, impact scores, and linked work items. This is highly relevant to separating raw evidence from prioritized execution.

Patterns adopted:

- keep raw evidence separate from prioritized work
- use goals, impact, and linked delivery items
- support many evidence sources, including chats and external systems

Patterns rejected:

- limiting the model to product discovery only, without operational or platform self-improvement signals

#### Productboard

Productboard centralizes customer feedback, links it to feature ideas, and contributes to prioritization using customer importance. This reinforces that evidence should remain linked to work and should influence prioritization continuously.

Patterns adopted:

- feedback linked directly to candidate improvements
- evidence retained behind prioritization decisions
- weighting by importance, not just request count

Patterns rejected:

- a product-only framing that underweights platform and foundational technology improvements

#### ServiceNow APM / Dependency Mapping

ServiceNow’s dependency mapping and APM material strongly reinforce the need for **root-cause visibility across the technology landscape**. This is particularly relevant for cases where customer complaints are downstream symptoms of shared foundational problems.

Patterns adopted:

- evaluate changes and incidents through dependency maps
- support top-down impact reasoning across applications and services
- treat service visibility as essential to root-cause prioritization

Patterns rejected:

- treating root cause analysis as an incident-only concern rather than a backlog investment concern

### What DPF Must Do Differently

Existing tools do parts of this well, but they generally stop at one of these boundaries:

- feedback capture
- product prioritization
- portfolio reporting
- technical scorecards
- delivery execution

DPF’s differentiator is that it must connect all of them:

- human and AI coworker interaction quality
- Build Studio execution quality
- tool and provider quality
- portfolio and product investment decisions
- graph-aware root-cause analysis
- local deployment adaptation
- upstream common-platform contribution

## Design Summary

The recommended v1 design is a **unified improvement flywheel** built on top of the existing common backlog, not a separate improvement work system.

Core flow:

1. **Observe** signals from interactions, outcomes, and operational telemetry.
2. **Normalize** those signals into a common improvement-signal model.
3. **Evaluate** them daily using portfolio, product, and graph context against company-level objectives.
4. **Propose** the top opportunities as `proposed` backlog items in the common queue.
5. **Govern** them through normal portfolio and funding decisions.
6. **Execute** high-value items through ordinary delivery or Build Studio candidate packages.
7. **Contribute back** reusable improvements to the common platform when justified.

## Scope

### In Scope

- daily portfolio-aware improvement evaluation
- top 3 opportunity selection
- shared backlog filing in `proposed` status
- portfolio and Digital Product attribution
- cross-portfolio root-cause recommendations
- Build Studio candidate generation
- company-objective-aware prioritization
- support for local-only and common-platform outcomes
- docs and product-positioning alignment for the flywheel principle

### Out of Scope for v1

- fully autonomous Build Studio execution without review
- automatic git contribution to the common platform
- automatic budget reallocation
- guaranteed causal inference from graph data alone
- replacing the existing backlog with a separate prioritization tool

## Operating Model

### 1. Observe

Collect signals from:

- agent conversations
- coworker-human interaction outcomes
- coworker-coworker handoffs
- Build Studio builds and verification outputs
- tool execution failures and retries
- routing/provider degradation
- memory misses and repeated-user prompts
- backlog aging and stale proposals
- customer complaints and product-level signals
- portfolio quality issues

### 2. Normalize

All observed signals should become structured improvement evidence, regardless of source. Evidence should capture:

- source type
- source ids
- recurrence
- route context
- affected Digital Product
- affected portfolio
- graph references
- suspected root cause
- affected objective or business outcome

### 3. Evaluate

A daily portfolio-level coworker evaluates all open evidence from the perspective of the whole company. This evaluation must use:

- the four IT4IT-aligned portfolios
- Digital Product traceability
- backlog context
- graph dependencies and impact paths
- prior delivery outcomes
- expected effect on company objectives

### 4. Propose

The top improvement opportunities are filed into the common backlog as `proposed` items. They remain visible and attributable, but they do not yet consume delivery capacity.

### 5. Govern

Humans and portfolio-level coworkers reassess them against:

- budget
- timing
- strategic fit
- cross-portfolio leverage
- expected token and engineering cost

### 6. Execute

If approved, improvements move into regular delivery or become Build Studio candidates. Build Studio should be treated as the high-token execution engine for platform-level changes, not as an isolated system.

### 7. Contribute Back

If an improvement is reusable across deployments or strengthens the shared product, the platform can recommend upstream contribution to the main git project.

## Data Model Design

The platform should evolve existing models rather than invent a disconnected subsystem.

### A. New `ImprovementSignal` Model

`ImprovementSignal` becomes the normalized evidence layer. It stores raw observations before they become proposals or backlog items.

Recommended fields:

- `signalId`
- `sourceType`
- `sourceId`
- `title`
- `description`
- `evidence`
- `recurrenceCount`
- `status` (`open`, `suppressed`, `promoted`, `closed`)
- `routeContext`
- `agentId`
- `threadId`
- `buildId`
- `providerId`
- `toolName`
- `digitalProductId`
- `portfolioId`
- `suspectedRootCause`
- `objectiveImpactHypothesis`
- `graphNodeRefs`
- `graphEdgeRefs`
- `createdAt`, `updatedAt`, `lastSeenAt`

Purpose:

- preserve many weak signals without polluting the main backlog
- support grouping, deduplication, and trend analysis
- retain the evidence behind later prioritization decisions

### B. Extend `ImprovementProposal`

`ImprovementProposal` should evolve from a conversation-driven friction record into the governed proposal layer above normalized signals.

Recommended additions:

- `digitalProductId`
- `portfolioId`
- `evaluationRunId`
- `rootCauseType`
- `companyObjective`
- `expectedImpact`
- `expectedEffort`
- `reusePotential`
- `executionRecommendation` (`manual`, `build_studio`, `upstream_candidate`)

Also add join tables:

- `ImprovementProposalSignal`
- `ImprovementProposalPortfolio`
- `ImprovementProposalProduct`

This supports both primary attribution and cross-portfolio effects.

### C. Extend `BacklogItem`

`BacklogItem` should remain the canonical work queue, but it needs stronger proposal support.

Recommended changes:

- add `status = proposed`
- add `portfolioId` directly instead of relying only on `EpicPortfolio`
- add `originType`
- add `originId`
- add `companyObjective`
- add `executionPath`
- add `improvementProposalId`

This enables one backlog with many views, instead of separate hidden queues.

### D. New `ImprovementEvaluationRun`

This model records each daily evaluation cycle.

Recommended fields:

- `runId`
- `startedAt`
- `completedAt`
- `scope` (`global`, `portfolio`, `product`)
- `objectiveSummary`
- `candidateCount`
- `selectedCount`
- `summary`
- `modelMetadata`

Purpose:

- auditability
- explainability of daily top 3 choices
- trend analysis over time

### E. New `ImprovementExecutionCandidate`

This is the handoff object from prioritization to execution.

Recommended fields:

- `candidateId`
- `improvementProposalId`
- `executionPath`
- `briefJson`
- `status` (`ready`, `accepted`, `rejected`, `launched`)
- `featureBuildId`
- `upstreamContributionCandidate`

Purpose:

- materialize proposals into Build Studio-ready packages
- preserve high-token execution briefs outside free-form chat

## Ranking and Prioritization

The top 3 opportunities should be ranked by **expected contribution to company objectives**, not by local noise.

### Ranking Factors

- objective impact
- graph leverage
- recurrence frequency
- breadth of effect
- urgency and risk
- effort and token cost
- reuse potential

### Ranking Behavior

- a cross-portfolio root-cause fix may outrank multiple local symptom fixes
- a customer complaint may remain important, but a foundational technology issue can win if it has greater total objective impact
- local evidence remains visible even when top-down evaluation reframes the recommendation

### Why Neo4j Matters

The graph is not just an architecture artifact. It is part of the investment decision engine.

It should help the evaluator answer:

- which products and portfolios depend on the suspected root cause?
- what would improve if this issue were fixed?
- what downstream complaints are symptoms of a shared upstream problem?
- where is the highest-leverage intervention?

## Governance Model

### Shared Queue, Many Views

The platform should follow a queue-theory-informed principle:

- one common work system
- many filtered views
- no hidden improvement queues

`proposed` backlog items make that possible without pretending every new opportunity is funded.

### Whole vs Local

The system must preserve both:

- **local truth**: the user, coworker, or build observed a real pain point
- **whole-system truth**: the best response may be a different investment with broader objective impact

### Roles

- local coworkers and humans surface signals
- portfolio-level coworkers evaluate the whole
- humans retain final authority on budget, priority, and contribution

## Build Studio Integration

The flywheel should not stop at backlog suggestions. High-value opportunities need a clean path into Build Studio.

### Build Candidate Package

For suitable improvements, the system generates a Build Studio candidate containing:

- problem statement
- evidence summary
- affected products and portfolios
- graph-derived impact summary
- suspected root cause
- expected company objective improvement
- likely implementation path
- reuse and contribution recommendation

### Execution Modes

- `manual`: ordinary engineering flow
- `build_studio`: platform or product improvement suitable for agentic implementation
- `upstream_candidate`: reusable improvement worth contributing back

### Token Governance

Because Build Studio work is high-token and high-impact, daily evaluation should recommend candidate packages, not silently launch builds in v1.

## UX and Reporting

### Daily Improvement Review

Add a portfolio-level review surface that shows:

- top 3 daily opportunities
- evidence behind each recommendation
- affected products and portfolios
- graph leverage summary
- backlog status
- execution recommendation

### Product and Portfolio Views

Each product and portfolio should show:

- open signals
- proposed improvements
- active improvement work
- verified improvements
- investment distribution across the four IT4IT portfolios

### Company-Level View

Add a whole-platform view for:

- where investment is going
- where repeated friction appears
- where root-cause investments are paying off
- which local adaptations should be proposed upstream

## Documentation and Marketing Alignment

This flywheel should become part of the platform narrative.

Suggested positioning:

- the platform continuously improves itself by observing real work
- Digital Product is the common unit of traceability across the lifecycle
- AI coworkers, humans, and Build Studio participate in one governed operating model
- local deployments can evolve safely while reusable improvements can strengthen the shared platform

This principle should appear in:

- user guide documentation
- architecture docs
- AI Workforce docs
- Build Studio docs
- product/marketing messaging

## Migration and Refactoring Considerations

### Required Refactoring

1. **BacklogItem needs direct portfolio linkage.** The current model relies too heavily on `EpicPortfolio` for portfolio-level organization.
2. **Backlog statuses need a proposal state.** Today the practical states are operational work states only.
3. **ImprovementProposal needs scope linkage.** It currently lacks direct `DigitalProduct` and `Portfolio` association.
4. **Signal capture is fragmented.** Current signal sources need a common normalized model.

### Future Refactoring Worth Noting

- unify `PortfolioQualityIssue`, `ImprovementSignal`, and portions of technical debt detection where they overlap
- formalize company objectives as first-class records instead of inferred text
- enrich graph references from simple ids to explainable dependency narratives
- bridge improvement proposals and `WorkItem` if the queue system becomes the dominant execution substrate

## Rollout Plan

### Phase 1

- add `ImprovementSignal`
- extend `ImprovementProposal`
- add `proposed` backlog status
- file top 3 opportunities daily into the common backlog

### Phase 2

- add objective-aware ranking
- add graph leverage scoring
- add portfolio and product rollups

### Phase 3

- generate Build Studio candidate packages
- support human acceptance into active build execution

### Phase 4

- add local-to-common contribution recommendations
- add stronger docs and marketing alignment

## Risks

- false confidence in graph-based causality
- too many weak signals turning into noise
- proposal spam without enough grouping and deduplication
- high token cost if execution is launched too aggressively
- loss of trust if recommendations are not explainable

## Success Criteria

This feature is successful when:

- the platform surfaces 3 high-quality daily improvement opportunities
- those opportunities are visibly linked to products, portfolios, and evidence
- the common backlog remains the canonical queue
- cross-portfolio root-cause investments become visible
- Build Studio execution candidates are materially better scoped
- local adaptations and common-platform contributions are part of one coherent loop

## Notes on Current State

This spec was grounded in the current schema and existing design docs. Live backlog verification from PostgreSQL was unavailable from this workspace due connection refusal on `localhost:5432`, so current-epic overlap could only be checked partially using the local backup snapshot at `backups/epics-backlog-20260330-140253.sql`.
