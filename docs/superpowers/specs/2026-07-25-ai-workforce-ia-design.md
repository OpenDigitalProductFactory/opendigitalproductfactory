# AI Workforce Information Architecture Design

## Status

Accepted design under `EP-UX-SYSTEM`. Availability and authority projections
are merged; the four-area roster and coworker-record consumption are in
delivery under `BI-C810CC5A` and Work Capsule `WC-D6E5F3F4`.

## Problem

DPF has too many AI coworker surfaces exposed as peer destinations. Operators can see AI Workforce, Coworker Decision Engine, Build Studio, Admin/Agents, provider setup, prompts, skills, memory, routing, runtime health, finance AI, marketing/customer AI, identity/authority, and embedded coworker panels, but they cannot quickly answer:

- Which coworker can help with this work?
- Which coworker can interact with customers?
- Is this coworker available for my business type?
- Does this coworker need attention or setup?
- Where do I safely change what this coworker can do?

The current shape exposes implementation machinery before the coworker/work model. This creates cognitive load and makes customer-facing AI capability hard to trust.

## Current Inventory

Static route inventory found:

- `/platform/ai`: 28 page routes.
- `/coworker-decisions`: 13 page routes.
- Additional coworker-adjacent routes under Build Studio, Admin/Agents, EA/Agents redirect, Finance AI, Customer/Marketing, Platform Identity, Providers, Tools, and embedded page panels.

Inventory evidence was captured on 2026-07-25 from worktree SHA `555dcd8069`.

Commands:

```powershell
$routes = rg --files 'apps/web/app/(shell)/platform/ai' | rg 'page\.tsx$'
$routes | ForEach-Object { $_ -replace '^apps/web/app/\(shell\)', '' -replace '\\page\.tsx$', '' -replace '\\','/' } | Sort-Object

$routes = rg --files 'apps/web/app/(shell)/coworker-decisions' | rg 'page\.tsx$'
$routes | ForEach-Object { $_ -replace '^apps/web/app/\(shell\)', '' -replace '\\page\.tsx$', '' -replace '\\','/' } | Sort-Object
```

`/platform/ai` routes:

```text
/platform/ai
/platform/ai/agent/[agentId]
/platform/ai/assignments
/platform/ai/assignments/bindings/[bindingId]
/platform/ai/authority
/platform/ai/browser-sessions
/platform/ai/browser-sessions/setup
/platform/ai/build-studio
/platform/ai/capability-needs
/platform/ai/capacity-continuity
/platform/ai/catalog
/platform/ai/decisions/[interactionId]
/platform/ai/founder-review
/platform/ai/history
/platform/ai/memory
/platform/ai/model-assignment
/platform/ai/operations
/platform/ai/operations-map
/platform/ai/overview
/platform/ai/priority
/platform/ai/priority/outcomes
/platform/ai/prompts
/platform/ai/providers
/platform/ai/providers/[providerId]
/platform/ai/readiness
/platform/ai/routing
/platform/ai/runtime-health
/platform/ai/skills
```

`/coworker-decisions` routes:

```text
/coworker-decisions
/coworker-decisions/[...slug]
/coworker-decisions/craft
/coworker-decisions/craft/[professionKey]
/coworker-decisions/decisions
/coworker-decisions/decisions/[interactionId]
/coworker-decisions/edit/[...slug]
/coworker-decisions/matrix
/coworker-decisions/perspectives
/coworker-decisions/perspectives/[profileId]/voice
/coworker-decisions/proactivity
/coworker-decisions/review
/coworker-decisions/stance
```

The useful existing anchor is already present:

- `/platform/ai/overview` is intended as the AI Workforce directory.
- `/platform/ai/agent/[agentId]` is intended as the per-coworker record.

The problem is not that these pages do not exist. The problem is that too many surrounding management surfaces are equally prominent.

## Design Goal

AI Workforce should behave like a team directory and operating console for AI coworkers, not like an AI infrastructure admin panel.

The default question is:

> Which coworker can help with this kind of work, can they work for my business type, and do they need my attention?

## Non-Goals

This design does not introduce a new agent runtime, new autonomous behavior, or new coworker authority model.

This design does not redesign the prompt, skill, provider, memory, browser-session, or decision schemas except where a read model is needed to display them through the AI Workforce IA.

This design does not rebuild provider setup, Build Studio, customer portal behavior, or the external customer-facing runtime.

This design does not add a new global product area. AI Workforce remains the durable global destination.

## Navigation Model

Global navigation should keep **AI Workforce** as the durable destination.

Inside AI Workforce, use five operator modes as lenses, not as another deep route tree:

1. **Coworkers**
   - Default roster and discovery view.
   - Helps the operator find the right coworker.

2. **Work Monitor**
   - Active work, blocked work, failed work, assignments, recent activity, and review-needed items.
   - Exception-first, not log-first.

3. **Capabilities**
   - Work a coworker can do, connected tools, skills, prompts, model assignment, missing capability gaps, and offer readiness.
   - This is where setup/configuration lives.

4. **Decision Governance**
   - Cross-coworker review queue, proactivity, authority, decision rules, founder review, stance/craft material.
   - Replaces Coworker Decision Engine as a peer navigation destination over time.

5. **Systems Health**
   - Providers, routing, browser sessions, runtime health, Build Studio runtime, infrastructure map.
   - Technical health is available, but not the front door.

These modes should be implemented as shallow section lenses under `/platform/ai`, such as query-backed modes or a small number of shallow routes. They must not become a new third navigation layer.

### Lens Routing Rules

The five AI Workforce modes are bookmarkable section lenses, not a nested route family.

Use canonical shallow routes for durable modes:

- `/platform/ai` or `/platform/ai/overview` -> **Coworkers**
- `/platform/ai/work` -> **Work Monitor**
- `/platform/ai/capabilities` -> **Capabilities**
- `/platform/ai/governance` -> **Decision Governance**
- `/platform/ai/health` -> **Systems Health**

Use query parameters only for local view state inside a lens:

- filters
- grouping
- sort
- selected status
- selected portfolio/work-domain

Do not create nested sub-route trees under each lens. Deep links to technical pages may continue to exist for compatibility, but the visible IA should route through the lens and selected coworker record first.

Record-level tabs may use hash, query, or the existing tab implementation. They should not create a second route hierarchy.

## Roster Design

The roster must lead with customer value and practical availability.

Recommended first-screen order:

1. **Customers and sales**
   - Customer Success Manager, Marketing Strategist, sales, partner, and customer-facing coworkers.
   - Highest trust and value-discovery priority.

2. **Your team**
   - Hiring, onboarding, scheduling, learning, employee support, and workforce-planning coworkers.

3. **Operations and delivery**
   - Storefront, service delivery, fulfillment, customer support operations, and day-to-day coordination.

4. **Platform and back office**
   - Finance, compliance, admin, Build Lead, Platform Engineer, Enterprise Architect, UX Design Critic, Data Architect, External Catalog Scout, and internal improvement coworkers.

The examples above are a target classification, not permission to infer areas
from names, role types, or `Agent.portfolioId`. The source of truth is the
portfolio assigned to each active `CoworkerService`. A coworker with services
in several areas is grouped by the most customer-inward assigned area and keeps
all assigned areas in Work Offered. A coworker with no classified active
service appears under **Other**.

Each coworker card should show:

- Coworker name.
- Plain job statement, for example `Handles intake and follow-up`.
- Interaction badge:
  - `Talks to customers`
  - `Works with partners`
  - `Internal only`
- Availability badge:
  - `Available for your business type`
  - `Setup needed`
  - `Needs attention`
  - `Not available for your business type`
  - `Coverage not defined`
- Approval/autonomy badge:
  - Use the canonical owner labels from Deliverable 2 of
    `docs/superpowers/plans/2026-07-26-ai-workforce-availability-authority-projections.md`.
  - The roster uses the `default-posture` projection. Action-specific grant or
    proposal decisions appear only in scoped offer/work detail.
- Health/attention badge when relevant:
  - `Needs setup`
  - `Blocked`
  - `Provider degraded`
  - `Review needed`
- Primary action: `View coworker`.

The roster should support filters for business area, customer interaction, availability, setup state, approval level, and health. These filters should not replace the four visible groupings above.

## Coworker Record Design

The selected coworker record remains the deep management home. It should not recreate the platform-wide sprawl inside one detail page.

Recommended primary tabs:

1. **Overview**
   - Who this coworker is.
   - What it helps with.
   - Whether it can work for this business.
   - Whether it needs attention.
   - Current approval/autonomy posture.

2. **Work Offered**
   - Services or work this coworker can do.
   - Inputs needed.
   - Outputs produced.
   - Who it helps.
   - Where the work appears in the product.
   - Customer/partner/internal exposure.

3. **Availability**
   - Current business type first.
   - Setup dependencies.
   - Supported archetype categories and leaf archetypes.
   - Not-yet-supported business types.
   - Plain explanation of gaps.

4. **Capabilities**
   - Connected tools.
   - Skills.
   - Prompt/corpus readiness.
   - Model routing summary.
   - Missing capability needs.

5. **Autonomy & Governance**
   - Approval level.
   - Proactivity.
   - Authority boundary.
   - Decision discipline.
   - Escalation rules.

6. **Activity**
   - Recent work.
   - Decisions.
   - Review-needed items.
   - Performance and reliability summary.
   - Links to raw history/logs only when needed.

Technical details such as prompts, memory, provider routing, browser sessions, raw decision rows, raw logs, and runtime traces should appear as contextual panels or advanced disclosures inside these tabs.

## Archetype Availability

Availability must be owner-readable before it becomes a matrix.

Roster-card examples:

- `Available for restaurants`
- `Available after setup`
- `Not available for your business type`
- `Coverage not defined for your business type`

Coworker detail examples:

- `Your business: Restaurant`
- `Status: Available after menu and operating hours are configured`
- `Why: This coworker needs service catalog, hours, and customer contact channels`
- `Other supported business types: Salon, clinic, retail`
- `Not supported yet: Manufacturing, field services`

The availability read model should distinguish:

- explicitly governed universal availability, once that encoding exists
- archetype-category availability
- leaf-archetype availability
- install-specific setup-needed state
- not-applicable state
- coverage gap / future support state

### Availability State Precedence

When multiple availability signals apply, show the most actionable owner-facing state.

Precedence:

1. **Blocked / unsafe**
   - A required provider, tool, authority grant, or policy gate is broken.
   - Show `Needs attention`.

2. **Setup needed**
   - The coworker supports this business type, but install-specific prerequisites are missing.
   - Example: service catalog, operating hours, customer contact channel, approval policy.
   - Show `Setup needed`.

3. **Leaf override**
   - A leaf-archetype rule overrides category-level support.
   - Example: category supports retail, but a regulated pharmacy leaf requires later support.
   - Show the leaf result.

4. **Category available**
   - The current category is explicitly supported and setup prerequisites are satisfied.
   - Show `Available for your business type`.

5. **Not available**
   - The work is not applicable to the current business type.
   - Show `Not available for your business type`.

6. **Coverage not defined**
   - No explicit leaf, category, or governed universal declaration establishes support.
   - Show `Coverage not defined for your business type`; do not infer future intent.

Universal availability must not be inferred from an empty list or `*`. Future intent such as `Coming later` also requires its own governed encoding and must not be inferred from missing coverage. When a governed universal encoding is introduced, it applies only if no stricter category, leaf, setup, or safety signal overrides it.

## Offer as the Core Discovery Object

The internal object may be called an offer, but UI copy should prefer:

- `Work Offered`
- `Services`
- `What this coworker can do`
- `Customer jobs`, when customer-facing

Every offer should answer:

- Who it helps.
- What work it can do.
- What input it needs.
- What it produces.
- Whether it talks to customers, partners, or internal users only.
- What approval level applies.
- Which business types it supports.
- What setup is missing.
- Who governs it.

Offer metadata should own service exposure and applicability:

- internal/external exposure
- risk tier / approval level
- persona targets
- value stream / business area
- archetype/category applicability
- unavailable archetype gaps
- capability dependencies
- governance requirements

### Offer Display Contract

Each displayed work item should resolve to a normalized offer card with:

- `offerId`
- `providerAgentId`
- `displayName`
- `plainJob`
- `whoItHelps`
- `interactionScope`: `talks-to-customers`, `works-with-partners`, or `internal-only`
- `approvalLevel`: owner-readable approval/autonomy label
- `riskLevel`
- `availabilityState`
- `availabilityReason`
- `supportedArchetypeCategories`
- `supportedArchetypeIds`
- `setupDependencies`
- `primaryOutput`
- `governanceSummary`
- `detailHref`

The offer card reads from the coworker offer/service catalog, coworker record, setup state, and governance/authority state. It must not duplicate prompt, skill, or provider configuration data. Those remain supporting records linked through the offer or coworker.

## Decision Governance Migration

Coworker Decision Engine should stop being a peer product destination over time.

Target placement:

- Cross-coworker decision review lives under **AI Workforce > Decision Governance**.
- Per-coworker decision behavior lives in the coworker record under **Autonomy & Governance** and **Activity**.
- Old `/coworker-decisions/*` routes remain as compatibility redirects during migration.
- Decision data remains owned by the governance/decision model, but indexed by coworker, offer, domain, and discipline.

The stable fleet-level review queue must remain discoverable. Decision governance should not be hidden only inside individual coworker records.

Cross-coworker governance includes:

- decision review queue
- founder review
- policy/stance/craft gaps
- decision conflict review
- proactivity defaults
- authority policy summaries
- auditability of unresolved escalations

Per-coworker governance includes:

- that coworker's autonomy setting
- that coworker's proactivity setting
- authority grants and approval boundary
- decisions involving that coworker
- offer-specific approval requirements
- coworker-specific governance gaps

Compatibility rule:

- Existing `/coworker-decisions/*` routes remain readable during migration.
- Visible navigation moves to AI Workforce > Decision Governance.
- Old routes redirect only after equivalent AI Workforce destinations exist and deep-link tests pass.

## Systems Health Placement

Provider/model/runtime infrastructure should be available, but it should not define the primary IA.

Systems Health contains:

- provider status
- model availability
- routing/fallback health
- browser sessions
- runtime health
- Build Studio runtime
- operations map

The operator entry point should be symptom-based:

- `A coworker cannot work`
- `Customer-facing AI is disabled`
- `Provider degraded`
- `Model routing changed`
- `Browser session needs setup`

Raw provider and runtime detail is secondary.

## Build Studio Placement

Build Studio remains a durable product-building workflow outside AI Workforce. It is not demoted into the roster.

AI Workforce represents the coworkers and services that participate in Build Studio:

- Build Lead / build-specialist coworker record.
- Platform Engineer coworker record.
- UX Design Critic coworker record.
- Build-sensitive requirements offer.
- Build runtime health inside Systems Health.
- Build-related decisions inside Decision Governance.

Visible rule:

- Operators start product-building work in Build Studio.
- Operators inspect or configure the AI coworkers who perform that work in AI Workforce.
- AI Workforce links to Build Studio only as a contextual work destination, not as another AI Workforce sub-product.

## Route Migration

Phase 1: Introduce the new AI Workforce IA without removing old routes.

- Keep `/platform/ai/overview` as the roster front door.
- Keep `/platform/ai/agent/[agentId]` as the coworker record.
- Add the five modes as shallow lenses.
- Add customer-facing grouping and availability badges to the roster.

Phase 2: Contextualize management surfaces.

- Link prompts, skills, memory, model assignment, authority, and proactivity from coworker records or the relevant mode.
- Keep direct routes for deep links, but remove them from the long primary tab row.

Phase 3: Migrate Coworker Decision Engine.

- Move decision review and governance into AI Workforce.
- Add compatibility redirects from `/coworker-decisions/*`.
- Keep redirects for at least one release cycle.

Phase 4: Retire redirect-only and low-value peer destinations.

- Use telemetry or access logs before removal.
- Do not remove routes that are still used by embedded links, artifacts, or user guides.

### Route Disposition Table

| Current surface | Target home | Disposition |
| --- | --- | --- |
| `/platform/ai`, `/platform/ai/overview` | AI Workforce > Coworkers | Primary home |
| `/platform/ai/agent/[agentId]` | Coworker record | Primary detail home |
| `/platform/ai/assignments`, `/platform/ai/model-assignment`, `/platform/ai/priority` | AI Workforce > Capabilities; coworker record > Capabilities / Autonomy | Contextualize, then hide from primary nav |
| `/platform/ai/prompts` | AI Workforce > Capabilities; coworker record advanced prompt panel | Contextualize |
| `/platform/ai/skills` | AI Workforce > Capabilities; coworker record > Capabilities | Contextualize |
| `/platform/ai/memory` | Coworker record advanced memory panel; Systems Health for fleet memory issues | Contextualize |
| `/platform/ai/providers`, `/platform/ai/providers/[providerId]` | AI Workforce > Systems Health | Keep as advanced deep link |
| `/platform/ai/routing`, `/platform/ai/runtime-health`, `/platform/ai/operations`, `/platform/ai/operations-map` | AI Workforce > Systems Health | Consolidate as health lens panels/deep links |
| `/platform/ai/browser-sessions`, `/platform/ai/browser-sessions/setup` | AI Workforce > Systems Health | Keep as setup/deep-link panels |
| `/platform/ai/history` | AI Workforce > Work Monitor; coworker record > Activity | Contextualize |
| `/platform/ai/decisions/[interactionId]`, `/platform/ai/founder-review` | AI Workforce > Decision Governance | Primary governance detail |
| `/platform/ai/capability-needs` | AI Workforce > Capabilities; Backlog where promoted | Compatibility redirect or contextual panel |
| `/platform/ai/build-studio` | Build Studio configuration; AI Workforce > Systems Health for runtime | Contextual link, not primary AI Workforce peer |
| `/platform/ai/catalog` | AI Workforce > Capabilities | Contextualize |
| `/platform/ai/authority` | AI Workforce > Decision Governance / coworker record > Autonomy & Governance | Compatibility redirect |
| `/coworker-decisions` | AI Workforce > Decision Governance | Compatibility route during migration |
| `/coworker-decisions/review` | AI Workforce > Decision Governance review queue | Migrate then redirect |
| `/coworker-decisions/proactivity` | AI Workforce > Decision Governance / coworker record > Autonomy & Governance | Migrate then redirect |
| `/coworker-decisions/perspectives`, `/stance`, `/craft`, `/matrix` | AI Workforce > Decision Governance advanced panels | Migrate then redirect |
| `/coworker-decisions/decisions/*` | AI Workforce > Decision Governance decision detail | Migrate then redirect |
| `/admin/agents`, `/ea/agents` | AI Workforce > Coworkers or Platform Identity > Agents, depending user intent | Remove as ordinary coworker entry; keep admin/identity deep link |
| Domain AI pages such as `/finance/spend/ai` | Domain workflow with contextual coworker link | Keep domain workflow; link to coworker record |
| Customer/marketing AI pages | Domain/customer workflows plus `Customers and sales` roster area | Keep workflow; cross-link |

## Guardrails

- No new global nav item for Decision Engine, Coworker Ops, AI Runtime, or AI Governance.
- No third navigation layer.
- No schema-shaped IA: providers, prompts, skills, memory, and browser sessions are support objects, not primary operator destinations unless they are cross-coworker operational work.
- Customer-facing coworkers are prioritized by roster grouping, badges, and sort order, not by creating another route hierarchy.
- The coworker record is the durable management home.
- Fleet modes are for cross-coworker comparison, exception handling, and setup workflows.
- Technical raw detail must use progressive disclosure.
- On phone-width viewports, global and Platform navigation collapse to compact,
  route-aware controls. Their full option sets remain one deliberate action
  away; they must not consume the roster's first viewport.
- The shared AI coworker launcher remains available on mobile and opens as a
  viewport modal rather than a docked or floating desktop panel.

## Acceptance Criteria

- Given a restaurant-like current archetype, an owner can identify coworkers that `Talk to customers`, `Work with partners`, and are `Internal only` from the AI Workforce first viewport without opening provider/admin pages.
- Given coworkers in available, setup-needed, not-available, and coverage-not-defined states, the roster shows one owner-readable availability badge per coworker or offer.
- Given a customer-facing coworker with missing setup dependencies, the roster shows `Setup needed` and the coworker detail explains the missing prerequisite before technical capability data.
- Given a governance user looking for unresolved AI decisions, they can reach the cross-coworker review queue from AI Workforce > Decision Governance without using `/coworker-decisions`.
- Given an operator troubleshooting degraded AI work, Systems Health gives a symptom-oriented entry before raw provider/model/routing tables.
- Given a deep link to an existing `/coworker-decisions/*` route, the route remains readable or redirects to an equivalent AI Workforce governance destination during the compatibility window.
- Given a redirect-only or compatibility route, it does not appear as a visible primary nav destination.
- Given a selected coworker record, the first viewport shows identity, work offered, current-business availability, attention state, and approval/autonomy posture without requiring the operator to inspect prompts, models, or provider routes.
- Given a Build Studio operator, Build Studio remains the place to start product-building work; AI Workforce provides coworker records and runtime/governance context for the coworkers doing that work.
- Given a `390x844` viewport, the AI Workforce title and coworker search are
  visible in the first viewport, the document has no horizontal overflow, and
  optional global/Platform navigation is collapsed.
- Given the same mobile viewport, the shared AI coworker launcher is reachable;
  opening it creates a full-viewport modal with background isolation, scroll
  lock, keyboard dismissal, and restored page state after close.

## Review Synthesis

Three critique lenses were applied:

- UX/cognitive load review.
- Architecture/data ownership review.
- Customer-facing usefulness review.

Accepted critique:

- The roster must not become a new overloaded dashboard.
- Customer-facing coworkers need a first-class `Customers and sales` area.
- Decision governance needs a stable fleet-level review queue.
- The old Coworker Decision Engine should migrate under AI Workforce.
- Five modes should be shallow lenses, not another route tree.
- The coworker record should reduce primary tabs and push raw technical detail into contextual advanced panels.
- Operator copy should avoid `external exposure`, `personas`, and `archetype availability` where plainer terms work.

## Open Questions

These are non-blocking defaults for implementation planning:

- Use the four owner-facing roster areas confirmed by the live audit: `Customers and sales`, `Your team`, `Operations and delivery`, and `Platform and back office`.
- Active service portfolio assignments determine the owner-facing area;
  unassigned work remains in `Other`. Agent workforce placement is not a
  substitute.
- Seeded service applicability determines whether a coworker can support an
  archetype/category. Explicit readiness evidence determines whether matching
  work is available now, setup-needed, or blocked. Unevaluated readiness stays
  `Coverage not defined`.
- If telemetry is unavailable, no route is retired. Routes may be hidden from visible nav only when the new AI Workforce destination exists and compatibility links remain readable.

## Telemetry for Route Retirement

A compatibility route can be hidden from visible nav immediately, but should only be retired after all are true for at least one release cycle:

- No direct task starts originate from the old route.
- Deep-link hits are zero for the route for 30 consecutive days, or every hit is a successful redirect to the equivalent AI Workforce destination.
- Redirect success rate is at least 99%.
- No unresolved support, docs, or artifact links depend on the old route.
- User-guide and in-app links have been updated.
- The equivalent AI Workforce destination has passing route and browser tests.

Telemetry source rule:

- Prefer existing route/page instrumentation if present.
- If route/page instrumentation is not present, add a small route-visit event for legacy AI/coworker routes before any route retirement decision.
- Until that instrumentation exists, the only allowed migration action is visible-nav removal plus compatibility links/redirects. Physical route removal is blocked.

## DPF Vision & Best Practices Alignment

To align the Information Architecture with foundational DPF governance, coworker development principles, and the navigation audit checklist, the following refinements are integrated into the design.

### 1. Archetype Availability Resolution
* **Single Source of Truth**: Availability calculations MUST resolve dynamically against `StorefrontConfig.archetypeId` (as defined in `AGENTS.md` §2). 
* **Resolution Logic**:
  - **Validated evidence only**: Resolve the selected storefront's governed leaf slug and category slug, then validate every `CoworkerService.archetypes` declaration against the storefront-template registry.
  - **Category/Leaf Match**: A validated leaf declaration takes precedence over a validated category declaration. Until a governed universal/category encoding is introduced, catalog filtering keeps exact matching.
  - **Conservative unknown**: Empty declarations, `*`, unknown identifiers, contradictory evidence, or unresolved install context produce `Coverage not defined`; none may imply universal availability.
  - **Prerequisites check**: Evaluate install setup state (for example operating hours, service catalog, or channel configuration) only after positive applicability, to toggle between `Available` and `Setup needed`.

### 2. Specialization & Tool Bloat Guardrails
* **Principle 1 Alignment (Specialization Over Generalization)**: Coworkers are most effective when limited to `< 10` tools (see `docs/architecture/ai-coworker-development-principles.md`).
* **UI Refinement**: Under the **Capabilities** lens and the coworker's **Capabilities** detail tab:
  - Display a count of assigned tools (`backingToolNames`) and skills (`backingSkillIds`).
  - Flag an operational warning/technical-debt indicator if the assigned tool count exceeds **10** (amber warning) or **15** (red alert), suggesting that the coworker should be refactored or decomposed.

### 3. Structured Handoff & Contract Visualizer
* **Principle 3 Alignment (Structured Handoffs)**: Coworkers pass decisions and context schemas via structured handoff documents rather than verbose chat history.
* **UI Refinement**: In the **Work Offered** and **Activity** detail views, render the structured schemas for `requiredInputs` and `producedOutputs` as a readable "Job API Contract". This helps the operator visualize exactly how coworkers interlock inside the orchestrator-worker pipeline.

### 4. Autonomy, Governance, and HITL Boundaries
* **Principle 7 Alignment (Human-in-the-Loop at Phase Boundaries)**: Distinguish between broad workflow gates and tactical execution blockages.
* **UI Refinement**: Under the **Decision Governance** lens and the coworker's **Autonomy & Governance** tab, split controls and lists into:
  - **Phase-Boundary Approvals**: For workflow transitions (e.g., approving a plan to proceed to build).
  - **Consequential Side-Effect Approvals**: For proposal tools (e.g., executing schema migrations, deploying to staging).
  - Provide direct link navigation from decision rows to the global **Paused-Work surface** or cross-process inbox.

### 5. Memory Compaction & Looping Diagnostics
* **Principle 5 Alignment (Selective Memory)**: Surface the efficiency of the vector storage (Qdrant) by showing a breakdown of "Salient Context" (durable decisions, user choices, constraints) vs. transient notes. Provide a compaction/pruning trigger.
* **Principle 8 Alignment (Fail Fast, Explain Clearly)**: In both the **Work Monitor** and **Systems Health** lenses, bubble up active tool repetition looping alerts (e.g. when a coworker hits the 3–5 repetition limit) as high-priority operational exceptions rather than burying them in logs.

### 6. Workspace vs. Configuration Separation
* **Navigation Audit Alignment**: Keep "where to go" controls separated from "what to do" controls.
  - The page route `/platform/ai/agent/[agentId]` is strictly a management, status, and metadata detail view.
  - Active conversation panels, prompt testing, and execution tasks are handled by the sliding **AgentCoworkerPanel** sidebar or the inbox, ensuring the workspace chrome does not compete with the main IA.

## Implementation Notes

This design should be implemented as a sequence of small slices:

1. Roster grouping and labels.
2. Availability badges and offer summary data.
3. Coworker record tab simplification.
4. Five AI Workforce lenses.
5. Decision Governance migration.
6. Route/nav cleanup and redirects.

Each slice should include static-render tests for navigation and copy, plus browser verification for the roster and one selected coworker record.
