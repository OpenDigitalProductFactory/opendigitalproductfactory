# AI Workforce Information Architecture Design

## Status

Revised design under independent review in `EP-UX-SYSTEM`. Availability and
authority projections are merged; declaration integrity is owned by
`BI-97CD9E4B` and five-lens/surface consolidation by `BI-F2278856`.

- Primary placement WWMD: `DI-D27A79E99964`
- State/action WWMD: `DI-B17F4DE8FD51`

Interactive review artifact:
[`2026-07-30-ai-workforce-five-lens-prototype.html`](assets/2026-07-30-ai-workforce-five-lens-prototype.html).

## Problem

DPF has too many AI coworker surfaces exposed as peer destinations. Operators can see AI Workforce, Coworker Decision Engine, Build Studio, Admin/Agents, provider setup, prompts, skills, memory, routing, runtime health, finance AI, marketing/customer AI, identity/authority, and embedded coworker panels, but they cannot quickly answer:

- Which coworker can help with this work?
- Which coworker can interact with customers?
- Is this coworker available for my business type?
- Does this coworker need attention or setup?
- Where do I safely change what this coworker can do?

The current shape exposes implementation machinery before the coworker/work model. This creates cognitive load and makes customer-facing AI capability hard to trust.

## Current Inventory

The refreshed current-main inventory contains 33 canonical non-redirect Purpose
routes under `/platform/ai` and `/coworker-decisions`, plus 8 compatibility
redirects for 41 total AI routes. Adjacent surfaces remain under Build Studio,
Admin/Agents, EA/Agents, Finance AI, Customer/Marketing, Platform Identity,
Providers, Tools, and embedded page panels. The disposition registry below is
exhaustive for both routes and launcher mounts.

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

Inside AI Workforce, use five operator lenses, not another deep route tree:

1. **Coworkers**
   - Default roster and discovery view.
   - Helps the operator find the right coworker.

2. **Work**
   - Read-only projection of active AI-linked work, recent outcomes, and the
     canonical domain destination that owns each action.
   - Needs you remains the only actionable attention/approval queue.

3. **Decisions**
   - Policy quality, recurring exceptions, doctrine/stance/craft gaps, evidence,
     decision history, and post-decision learning.
   - Human-required actions deep-link to their canonical Needs you record.

4. **Setup**
   - Services, tools, skills, prompts, model/provider assignment, browser
     provisioning, declaration gaps, and install/catalog blockers.
   - Capability needs remain Backlog-owned.

5. **Health**
   - Providers, routing, browser sessions, runtime health, Build Studio runtime, infrastructure map.
   - Technical health is available, but not the front door.

These lenses are shallow sections under `/platform/ai`. They must not become a
new third navigation layer.

### Lens Routing Rules

The five AI Workforce lenses are bookmarkable sections, not a nested route
family.

Use canonical shallow routes for durable lenses:

- `/platform/ai/coworkers` -> **Coworkers**
- `/platform/ai/work` -> **Work**
- `/platform/ai/decisions` -> **Decisions**
- `/platform/ai/setup` -> **Setup**
- `/platform/ai/health` -> **Health**

`/platform/ai` and `/platform/ai/overview` remain compatibility entries to
Coworkers until telemetry permits retirement.

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
- Primary action is state-specific: named Ask for ready/permitted work, typed
  recovery for blocked/remediation work, or View when no work action exists.
- `View coworker` is the consistent secondary route when another primary exists.

The roster should support filters for business area, customer interaction, availability, setup state, approval level, and health. These filters should not replace the four visible groupings above.

## Coworker Record Design

The selected coworker record remains the deep management home. It should not recreate the platform-wide sprawl inside one detail page.

The first viewport shows identity, plain job, primary business area, default
action service, derived availability/action, and one short reason. The default
action service appears first; aggregate summary appears second when different;
sibling services follow.

Owner-readable sections cover Work offered, Availability and recovery,
Governance posture, and recent Activity. Technical details such as prompts,
memory, tool/grant bindings, provider routing, browser sessions, raw decision
rows, logs, and runtime traces remain under `OwnerFirstDisclosure`. Do not
recreate the route sprawl as six peer record tabs.

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

## Decisions Migration

Coworker Decision Engine should stop being a peer product destination over time.

Target placement:

- Cross-coworker decision evidence lives under **AI Workforce > Decisions**.
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
- Visible navigation moves to AI Workforce > Decisions.
- Old routes redirect only after equivalent AI Workforce destinations exist and deep-link tests pass.

## Health Placement

Provider/model/runtime infrastructure should be available, but it should not define the primary IA.

Health contains:

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
- Build runtime health inside Health.
- Build-related decisions inside Decisions.

Visible rule:

- Operators start product-building work in Build Studio.
- Operators inspect or configure the AI coworkers who perform that work in AI Workforce.
- AI Workforce links to Build Studio only as a contextual work destination, not as another AI Workforce sub-product.

## Route Migration

Phase 1: Introduce the new AI Workforce IA without removing old routes.

- Add `/platform/ai/coworkers` as the new roster front door while
  `/platform/ai/overview` remains a page until the redirect phase.
- Keep `/platform/ai/agent/[agentId]` as the coworker record.
- Add the five lenses as shallow sections.
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

### Canonical Route Disposition Registry

Classes are closed: `canonical-home`, `contextual-deep-link`,
`advanced-deep-link`, `compatibility-redirect`, and `retirement-candidate`.
Needs you remains the only owner of human-required actions; Backlog owns
capability gaps; Audit Ledger owns immutable history; Build Studio owns product
build execution; Platform Identity owns principals.

The source registry is machine-readable and separates observed state from the
target IA:

```ts
type AiRouteLifecycleDisposition = {
  routeId: string;
  sourcePath: string | null;
  currentDisposition: "absent" | "page" | "redirect";
  targetRouteId: string | null;
  contextMapping: {
    schemaVersion: "ai-route-context-mapping.v1";
    query: Array<{ sourceKey: string; targetKey: string; required: boolean }>;
    pathParams: Array<{ sourceKey: string; targetKey: string; required: boolean }>;
    entityRefs: Array<{ kind: string; sourceKey: string; targetKey: string }>;
    focus: { sourceKey: string; targetKey: string } | null;
    returnTo: { mode: "preserve" } | { mode: "set"; targetRouteId: string };
  } | null;
  targetDisposition:
    | "canonical-home"
    | "contextual-deep-link"
    | "advanced-deep-link"
    | "compatibility-redirect"
    | "retirement-candidate";
  lifecyclePhase: "add-target" | "retain" | "redirect-after-target" | "observe-for-retirement" | "retire";
  activationPrerequisites: string[];
  retirementEvidenceRefs: string[];
};
```

The five new lens rows begin `absent/add-target`. Existing page rows begin
`page`; the eight existing redirects begin `redirect`. A target redirect cannot
activate until `targetRouteId` names a registry row whose route exists and whose
activation prerequisites have passed. Retained/canonical rows point to
themselves. A retirement row may clear `targetRouteId` only in the terminal
`retire` phase after its retirement evidence passes. Redirect validation also
proves the declared query, entity, focus, and return-context mapping rather than
accepting destination prose as evidence.
Redirect and context-changing rows require `contextMapping`; a self-retained
row may use null only when no context transform occurs. Unknown source/target
keys, duplicate target keys, missing required inputs, or a `returnTo.targetRouteId`
that does not resolve fail the transition.
Retirement cannot activate until telemetry, embedded-link, artifact, and
user-guide evidence is attached. The table below is the owner-readable
projection of that source registry; its Class column is the **target**
disposition, not an assertion that the transition already happened.

| Current route | Operator job | Class | Destination / action owner | Migration and acceptance |
| --- | --- | --- | --- | --- |
| `/platform/ai/coworkers` | Find a coworker by work | canonical-home | Coworkers | New route; directory Purpose and browser tests |
| `/platform/ai/work` | See AI-linked work and owning destinations | canonical-home | Work projects canonical work; owning domains keep actions | New route; projection/ownership parity |
| `/platform/ai/decisions` | Review decision evidence and policy quality | canonical-home | Decisions; Needs you keeps human actions | New route; no queue/count duplication |
| `/platform/ai/setup` | Resolve fleet/coworker setup | canonical-home | Setup; Backlog keeps capability gaps | New route; permission/recovery fixtures |
| `/platform/ai/health` | Diagnose AI operational health | canonical-home | Health | New route; symptom/action/evidence fixtures |
| `/platform/ai` | Enter AI Workforce | compatibility-redirect | Coworkers | Preserve query/return context; redirect test |
| `/platform/ai/overview` | Find a coworker by work | compatibility-redirect | Coworkers | Redirect after `/coworkers` exists; preserve filters |
| `/platform/ai/agent/[agentId]` | Understand/manage one coworker | canonical-home | Coworker record | Preserve Agent id; dynamic record fixture |
| `/platform/ai/assignments` | Configure priority/models | advanced-deep-link | Setup | Bookmark and permission fixture |
| `/platform/ai/assignments/bindings/[bindingId]` | Inspect one model/resource binding | advanced-deep-link | Setup | Preserve binding id and return route |
| `/platform/ai/authority` | Understand coworker authority | compatibility-redirect | Coworker record / Decisions | Preserve selected Agent and focus |
| `/platform/ai/browser-sessions` | Diagnose browser capacity | advanced-deep-link | Health | Symptom-first Health link |
| `/platform/ai/browser-sessions/setup` | Provision browser profile | contextual-deep-link | Setup | Preserve profile/service context |
| `/platform/ai/build-studio` | Configure build runtime | contextual-deep-link | Build Studio owns execution; Health owns runtime status | No peer nav; canonical-owner link test |
| `/platform/ai/capability-needs` | Review missing capability | compatibility-redirect | Backlog | Preserve need id/origin |
| `/platform/ai/capacity-continuity` | Understand capacity policy | advanced-deep-link | Health | Progressive guidance, not peer nav |
| `/platform/ai/catalog` | Manage service declarations | advanced-deep-link | Setup | Declaration permission/recovery fixture |
| `/platform/ai/decisions/[interactionId]` | Inspect one decision | canonical-home | Decisions | Preserve interaction id and Needs you link |
| `/platform/ai/founder-review` | Review doctrine exceptions | contextual-deep-link | Decisions; Needs you owns actions | No local queue/count |
| `/platform/ai/history` | Inspect immutable AI activity | compatibility-redirect | Audit Ledger | Preserve filters and entity refs |
| `/platform/ai/memory` | Inspect coworker/fleet memory | advanced-deep-link | Coworker record; Health for fleet faults | No peer nav; selected Agent fixture |
| `/platform/ai/model-assignment` | Configure models | compatibility-redirect | Setup assignments | Preserve Agent/filter context |
| `/platform/ai/operations` | Enter build operations | compatibility-redirect | Build Studio | Preserve build/work refs |
| `/platform/ai/operations-map` | Diagnose AI work topology | advanced-deep-link | Health | Owner summary first; topology disclosed |
| `/platform/ai/priority` | Configure model priority | compatibility-redirect | Setup assignments | Preserve selected Agent |
| `/platform/ai/priority/outcomes` | Review routing outcomes | contextual-deep-link | Work; Health for failure | Link to owning work receipt |
| `/platform/ai/prompts` | Manage prompt assets | advanced-deep-link | Setup | Selected coworker/filter context |
| `/platform/ai/providers` | Configure/diagnose providers | advanced-deep-link | Setup for config; Health for incidents | Split actions by owner |
| `/platform/ai/providers/[providerId]` | Inspect one provider | advanced-deep-link | Setup / Health | Preserve provider id |
| `/platform/ai/readiness` | Resolve fleet setup blockers | contextual-deep-link | Setup | No Available without current evidence |
| `/platform/ai/routing` | Configure providers/routing | compatibility-redirect | Setup providers | Preserve filters/context |
| `/platform/ai/runtime-health` | Diagnose runtime | contextual-deep-link | Health | Symptom/action/evidence fixture |
| `/platform/ai/skills` | Manage skill assets | advanced-deep-link | Setup | Selected coworker/filter context |
| `/coworker-decisions` | Enter decision governance | compatibility-redirect | Decisions | Remove global peer after target exists |
| `/coworker-decisions/[...slug]` | Read decision doctrine | advanced-deep-link | Decisions knowledge | Preserve slug/anchors |
| `/coworker-decisions/craft` | Browse craft corpus | advanced-deep-link | Decisions | Profession filter fixture |
| `/coworker-decisions/craft/[professionKey]` | Read profession corpus | advanced-deep-link | Decisions | Preserve profession key |
| `/coworker-decisions/decisions` | Review decision history | compatibility-redirect | Decisions | No duplicate action queue |
| `/coworker-decisions/decisions/[interactionId]` | Inspect decision | compatibility-redirect | Decisions detail | Preserve interaction id |
| `/coworker-decisions/edit/[...slug]` | Edit governed knowledge | advanced-deep-link | Decisions | Permission/slug fixture |
| `/coworker-decisions/matrix` | Inspect principle matrix | advanced-deep-link | Decisions | Progressive disclosure |
| `/coworker-decisions/perspectives` | Manage perspectives | advanced-deep-link | Decisions / coworker record | Selected profile context |
| `/coworker-decisions/perspectives/[profileId]/voice` | Configure profile voice | advanced-deep-link | Coworker record / Decisions | Preserve profile id |
| `/coworker-decisions/proactivity` | Set fleet/coworker proactivity | contextual-deep-link | Decisions / coworker record | Authority warning; selected Agent |
| `/coworker-decisions/review` | See unresolved decisions | compatibility-redirect | Decisions projects evidence; Needs you owns actions | Count/action parity test |
| `/coworker-decisions/stance` | Manage business stance | advanced-deep-link | Decisions | Organization/profile permission fixture |

Adjacent canonical owners:

| Surface | Disposition |
| --- | --- |
| `/admin/agents`, `/ea/agents` | Platform Identity for principals; compatibility link to Coworkers for team discovery |
| `/finance/spend/ai` | Finance-owned spend workflow with contextual coworker links |
| Customer/Marketing pages | Domain workflows with typed named-work launchers and Coworkers cross-links |
| Build Studio | Build-owned workflow with contextual coworker launchers |

### Canonical Launcher Disposition Registry

Launcher classes are `generic-context`, `named-coworker`, `named-service`,
`support`, and `compatibility`. All classes open the one shared
`AgentCoworkerShell`; none creates another conversation product.

Every source row uses an exact file path plus export/caller identifier. Grouping
below is presentation only; the guard expands each path/export into its own row.

| Exact current caller/mount | Class | Contract and action boundary | Acceptance |
| --- | --- | --- | --- |
| `apps/web/components/agent/AgentCoworkerShell.tsx#AgentFAB` | generic-context | Route context + return destination; no invented service claim | One global launcher, selected-context preview |
| `apps/web/components/platform/coworker-record/RosterView.tsx#RosterView` | named-service | Canonical/provider Agent + selected service/offer + revision | Same service owns placement and Ask |
| `apps/web/app/(shell)/platform/ai/agent/[agentId]/page.tsx#default` | named-service | Selected record service/offer | Service mismatch fails closed |
| `apps/web/app/(shell)/platform/ai/providers/page.tsx#default`; `apps/web/components/platform/ProviderSuitabilityGuide.tsx#ProviderSuitabilityGuide` | support | Platform-support context; configuration remains Setup-owned | No provider mutation on open |
| `apps/web/app/(shell)/platform/ai/runtime-health/page.tsx#default`; `apps/web/components/monitoring/LogIssuesPanel.tsx#LogIssuesPanel` | support | Health symptom/evidence context | No incident resolution on open |
| `apps/web/components/product/direction/ProductRoadmap.tsx#ProductRoadmap` | named-coworker or named-service when declared | Product/work ref + return route | Durable work receipt |
| `apps/web/app/(shell)/customer/marketing/page.tsx#default`; `apps/web/app/(shell)/customer/marketing/strategy/page.tsx#default` | named-service | Marketing offer + customer work context | Campaign service preserved |
| `apps/web/components/customer/PipelineStageInspector.tsx#PipelineStageInspector`; `apps/web/components/customer/EmptyPipelineGuidance.tsx#EmptyPipelineGuidance` | named-service | Customer-stage offer + work ref | Customer context preserved |
| `apps/web/components/compliance/licensing/LicensingWorkspacePanel.tsx#LicensingWorkspacePanel` | named-service | Compliance offer + license ref | Authority rechecked on submit |
| `apps/web/components/finance/AiSpendWorkspace.tsx#AiSpendWorkspace` | named-service | Finance offer + spend context | Finance remains canonical owner |
| `apps/web/components/finance/OwnerFirstFinanceView.tsx#OwnerFirstFinanceView`; `apps/web/components/finance/AiFinanceCoworkerAskButton.tsx#AiFinanceCoworkerAskButton` | named-service | Finance offer + owner-view context; dispatches through the shared named-work target | Both Finance mounts preserve the same service, permission, and return context |
| `apps/web/components/build/BuildStudio.tsx#BuildStudio` | generic-context | Active build/work ref | Build Studio remains action owner |
| `apps/web/components/build/BuildStudioWorkflowActionCard.tsx#BuildStudioWorkflowActionCard` | named-service when action declares service; otherwise generic-context | Phase/action + build ref | No generic prompt presented as named work |
| `apps/web/components/build/ReleaseDecisionPanel.tsx#ReleaseDecisionPanel` | named-service when declared | Release-governance offer + build ref | Consequential action still approval-gated |
| `apps/web/components/admin/IssueReportPanel.tsx#IssueReportPanel` | support | Issue evidence + return route | No issue mutation on open |
| `apps/web/components/setup/SetupOverlay.tsx#SetupOverlay` | support | Setup step/recovery context | Explicit auto-open exception; no auto-send |
| `apps/web/components/portal-context/HiveMindCandidateList.tsx#HiveMindCandidateList` | named-coworker | Candidate/work context | Identity visible before send |
| `apps/web/components/monitoring/AlertBanner.tsx#AlertBanner`; `apps/web/components/monitoring/PlatformHealthIndicator.tsx#PlatformHealthIndicator` | support | Alert/symptom evidence | Health action owner preserved |

The source registry contains every table row as structured data. Its guard:

1. compares `/platform/ai` and `/coworker-decisions` routes from
   `route-purpose.generated.json` plus the compatibility redirect registry;
2. scans imports and mounts of `AskCoworkerButton`, `AgentWorkLauncher`,
   `AgentFAB`, and launcher wrappers, plus every call or import of
   `dispatchAgentPrompt` and every direct `open-agent-panel` emitter;
3. fails CI for missing, duplicate, stale, or ownerless dispositions;
4. validates observed page/redirect state against `currentDisposition` and
   refuses a lifecycle phase whose activation prerequisites/evidence are absent;
   every non-null `targetRouteId` must resolve to an activated registry route,
   redirect rows require one, and context-preservation fixtures must match the
   structured `contextMapping`; the guard rejects missing mappings, duplicate
   target keys, unknown keys, and unresolved return destinations;
5. requires Purpose, deep-link, permission, and return-context fixtures for
   every new route or launcher.

## Guardrails

- No new global nav item for Decision Engine, Coworker Ops, AI Runtime, or AI Governance.
- No third navigation layer.
- No schema-shaped IA: providers, prompts, skills, memory, and browser sessions are support objects, not primary operator destinations unless they are cross-coworker operational work.
- Customer-facing coworkers are prioritized by roster grouping, badges, and sort order, not by creating another route hierarchy.
- The coworker record is the durable management home.
- Fleet lenses are for cross-coworker comparison, evidence, setup, and health
  projection.
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
- Given a governance user looking for unresolved AI decisions, they can reach
  Decisions evidence and the canonical Needs you action without using
  `/coworker-decisions`.
- Given an operator troubleshooting degraded AI work, Health gives a
  symptom-oriented entry before raw provider/model/routing tables.
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
- Five lenses should be shallow sections, not another route tree.
- The coworker record should reduce primary tabs and push raw technical detail into contextual advanced panels.
- Operator copy should avoid `external exposure`, `personas`, and `archetype availability` where plainer terms work.

## Open Questions

These are non-blocking defaults for implementation planning:

- Use the four owner-facing roster areas confirmed by the live audit: `Customers and sales`, `Your team`, `Operations and delivery`, and `Platform and back office`.
- The deterministic applicable, ready, permitted default action service owns
  primary business-area placement. Every service portfolio remains a filter
  membership; Agent workforce placement is not a substitute. When no service
  is actionable, the deterministic recovery service owns placement.
- Seeded service applicability determines whether a coworker can support an
  archetype/category. Explicit readiness evidence determines whether matching
  work is available now, setup-needed, or blocked. Unevaluated/stale readiness
  is `Readiness not checked`; undeclared applicability is `Coverage not
  defined`.
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
* **UI Refinement**: Under **Setup** and the coworker record's advanced
  Capabilities disclosure:
  - Display a count of assigned tools (`backingToolNames`) and skills (`backingSkillIds`).
  - Flag an operational warning/technical-debt indicator if the assigned tool count exceeds **10** (amber warning) or **15** (red alert), suggesting that the coworker should be refactored or decomposed.

### 3. Structured Handoff & Contract Visualizer
* **Principle 3 Alignment (Structured Handoffs)**: Coworkers pass decisions and context schemas via structured handoff documents rather than verbose chat history.
* **UI Refinement**: In the **Work Offered** and **Activity** detail views, render the structured schemas for `requiredInputs` and `producedOutputs` as a readable "Job API Contract". This helps the operator visualize exactly how coworkers interlock inside the orchestrator-worker pipeline.

### 4. Autonomy, Governance, and HITL Boundaries
* **Principle 7 Alignment (Human-in-the-Loop at Phase Boundaries)**: Distinguish between broad workflow gates and tactical execution blockages.
* **UI Refinement**: Under the **Decisions** lens and the coworker's Governance section, split controls and lists into:
  - **Phase-Boundary Approvals**: For workflow transitions (e.g., approving a plan to proceed to build).
  - **Consequential Side-Effect Approvals**: For proposal tools (e.g., executing schema migrations, deploying to staging).
  - Project the canonical `AttentionItem` and its existing owner action. A
    general `/workspace/inbox` link may open the full Needs you queue, but a
    row-specific action must preserve the item's real owner/context and must not
    invent an unsupported Inbox deep-link parameter.

### 5. Memory Compaction & Looping Diagnostics
* **Principle 5 Alignment (Selective Memory)**: Use the canonical,
  storage-neutral memory projection to show "Salient Context" (durable
  decisions, user choices, constraints) separately from transient notes. This
  IA remains read-only; compaction or pruning belongs to the owning memory
  workflow and is not introduced here.
* **Principle 8 Alignment (Fail Fast, Explain Clearly)**: In both **Work** and
  **Health**, bubble up active tool-repetition alerts (for example the 3-5
  repetition limit) as high-priority operational exceptions instead of burying
  them in logs.

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
5. Decisions migration.
6. Route/nav cleanup and redirects.

Each slice should include static-render tests for navigation and copy, plus browser verification for the roster and one selected coworker record.
