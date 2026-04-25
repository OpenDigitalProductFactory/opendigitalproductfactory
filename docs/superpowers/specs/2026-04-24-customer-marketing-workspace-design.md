# Customer Marketing Workspace Design

| Field | Value |
| - | - |
| Date | 2026-04-24 |
| Status | Draft (revised 2026-04-24 after spec review — grounding corrections, enum catalog, capability decision, model shape, phase reorder) |
| Author | Codex + Mark Bodman |
| Scope | Add a strategy-first Marketing workspace under `/customer`, route the right internal coworker there, model campaign and automation operations, and establish the internal source of truth that a future trusted customer-facing marketing coworker can safely consume |

## 1. Problem Statement

Marketing capability exists in pieces today, but it does not exist where users naturally go to manage customer acquisition.

Verified current state:

1. `/customer` is the CRM-facing workspace for accounts, engagements, pipeline, quotes, orders, and funnel analysis.
2. `/storefront` is where the `marketing-specialist` coworker currently lives.
3. `/customer` currently resolves to the `customer-advisor` / customer-success persona.
4. The marketing MCP tools (`get_marketing_summary`, `suggest_campaign_ideas`, `analyze_seo_opportunity`) all key off `view_storefront` capability, so the `customer-advisor` persona on `/customer` cannot invoke them today. The richer marketing specialist skills and campaign-generation affordances all live under `/storefront`.

This creates a discoverability and ownership mismatch:

- Users looking after customers and growth go to `/customer`.
- The archetype-aware marketing specialist is attached to `/storefront`.
- Marketing strategy, campaigns, funnel analysis, and automation are therefore split across domains that feel adjacent rather than unified.

The user direction for this design is clear:

1. Marketing must become part of the customer UX.
2. The workspace must understand the business type, locality, route to market, expertise, and target market before recommending campaigns.
3. The marketing specialist should be proactive, research-aware, creative, and burden-reducing.
4. Campaigns, funnel performance, and automation are ongoing concerns, but strategy is the primary starting point.
5. A future customer-facing AI coworker will need to answer product and service questions with tighter trust controls and GAID badging, but that work belongs in a separate thread and must consume trustworthy internal marketing context rather than inventing its own.

## 2. Goals and Non-Goals

### Goals

1. Add `Marketing` as a first-class domain inside `/customer`.
2. Make the default marketing experience strategy-first, with periodic review and proactive suggestions.
3. Support different business models, localities, and routes to market without flattening them into one generic marketing workflow.
4. Give the marketing specialist a durable internal workspace for strategy, campaigns, funnel analysis, and automation.
5. Reuse the existing business, storefront, and CRM data models where they already represent canonical truth.
6. Establish a clean internal source of truth that a later customer-facing coworker can read from safely.

### Non-Goals

1. Designing the customer-facing AI coworker itself.
2. Building all downstream channel integrations in this spec.
3. Replacing `/storefront` as the canonical public-experience management workspace.
4. Making externally published or customer-visible actions fully autonomous without review.
5. Solving every future analytics or attribution problem up front.

## 3. Current-State Grounding

### 3.1 Routes and Navigation

Verified in the current codebase:

- `/customer` has tabs for `Accounts`, `Engagements`, `Pipeline`, `Quotes`, `Orders`, and `Funnel`.
- `/customer` is currently framed as Customer Success / customer operations.
- `/storefront` is currently the operational home for the marketing specialist and archetype-aware marketing skills.

### 3.2 Existing Marketing Capability

Verified existing capability already in the platform:

- `marketing-specialist` route persona under `/storefront` (see `apps/web/lib/tak/agent-routing.ts`)
- Skills assigned to `marketing-specialist` (six have `.skill.md` files in `skills/storefront/`; `review-inbox` is currently defined inline in `agent-routing.ts` and needs a backing `.skill.md` as part of this work):
  - `campaign-ideas`
  - `content-brief`
  - `review-inbox`
  - `marketing-health`
  - `seo-content-optimizer`
  - `email-campaign-builder`
  - `competitive-analysis`
- MCP tools (all currently require the `view_storefront` capability — see `apps/web/lib/mcp-tools.ts`):
  - `get_marketing_summary`
  - `suggest_campaign_ideas`
  - `analyze_seo_opportunity`

### 3.3 Existing Canonical Data Worth Reusing

The current schema already gives us a solid base:

- `Organization`
  - canonical organization identity, website, and address context
- `BusinessContext`
  - description, value proposition, target market, customer segments, revenue model, company size, and geographic scope
- `StorefrontConfig`
  - current public-facing offer and portal configuration
- `StorefrontArchetype`
  - archetype category, CTA type, activation profile, and marketing skill rules
- `CustomerAccount`
  - customer/target account identity for CRM and relationship management
- `Engagement`
  - early-stage interactions and qualification states
- `Opportunity`
  - pipeline stages and expected revenue outcomes

### 3.4 Core Gap

What is missing is not generic marketing advice. What is missing is a canonical acquisition operating layer:

- no durable `Marketing` home under `/customer`
- no canonical strategy record for route-to-market and positioning
- no internal campaign and automation operating model tied back to customer growth
- no explicit handoff boundary between internal marketing strategy and the future trusted customer-facing coworker

## 4. Design Principles

### 4.1 Strategy Before Campaign

Marketing work starts with understanding the business, market, locality, route to market, and proof of expertise. Campaign execution follows from that context.

### 4.2 Archetype-Aware, Not Generic

The system must continue adapting to the business model. A local trade service, international training organization, nonprofit, HOA, dental practice, and regional MSP all need different campaign patterns, audience language, and measures of success.

### 4.3 One Stable Home

Marketing needs a durable home in `/customer`, not scattered entry points across CRM and storefront surfaces.

### 4.4 Progressive Disclosure

Users should see one stable Marketing domain first, with sub-routes for strategy, campaigns, funnel, and automation. This avoids overloading the top-level customer tab row while keeping the area scalable.

### 4.5 Burden Off, Judgment Intact

The marketing specialist should reduce work by researching, drafting, sequencing, scheduling, and suggesting automations, while leaving externally visible publishing and sensitive customer-facing actions reviewable.

### 4.6 Internal Truth Before External Trust

The internal marketing workspace must become the curated source of truth that a future customer-facing AI can read from. The external coworker should consume approved public-facing context, not raw draft strategy or speculative recommendations.

## 5. Target Information Architecture

### 5.1 Global Placement

Add `Marketing` as a new first-class tab under `/customer`.

Updated customer section nav:

- `Accounts`
- `Engagements`
- `Pipeline`
- `Quotes`
- `Orders`
- `Funnel`
- `Marketing`

Rationale:

1. Marketing is a core customer-acquisition function and belongs with customer growth operations.
2. This aligns the coworker location with the user mental model: people managing growth already live in `/customer`.
3. It avoids forcing users to discover strategy and campaign tooling indirectly through `/storefront`.

### 5.2 Marketing Sub-Routes

Inside `/customer/marketing`, use section-level sub-routes:

- `/customer/marketing`
- `/customer/marketing/strategy`
- `/customer/marketing/campaigns`
- `/customer/marketing/funnel`
- `/customer/marketing/automation`

Navigation rule:

- `Marketing` is one top-level customer tab.
- Strategy, campaigns, funnel, and automation are sibling views inside the Marketing domain.
- No additional top-level customer tabs are introduced for these concerns.

### 5.3 Relationship to `/storefront`

`/storefront` remains the canonical internal management surface for the public portal / storefront experience:

- sections
- items/services
- public presentation
- inbox
- team
- settings

`/customer/marketing` becomes the canonical internal growth workspace:

- strategy
- campaign planning
- funnel diagnosis
- acquisition automation

The two domains overlap, but their primary jobs differ:

- `/storefront` answers: what is the public experience and offer?
- `/customer/marketing` answers: how do we acquire more of the right customers for this business?

**Coworker relocation (relocation, not duplication):**

- The `marketing-specialist` route persona moves from `/storefront` to `/customer/marketing` and its sub-routes. There is one canonical home for the marketing-specialist coworker.
- `/storefront` reverts to a storefront-operations persona focused on sections, items/services, public presentation, inbox triage, team, and settings. (Persona ID and naming for the new storefront-operations role is an implementation-plan task; the existing `marketing-specialist` skill assignments are removed from `/storefront`.)
- This supersedes the `/storefront`-rooted placement implied by `2026-04-11-marketing-specialist-skills-design.md`. Skill files in `skills/storefront/` remain in place as filesystem locations during Phase 1; renaming the directory to `skills/marketing/` is an optional Phase 2 cleanup.

## 6. Workspace Shape

### 6.1 Marketing Landing Experience

The landing view should be strategy-first. It should answer:

1. What kind of business is this?
2. Who are we trying to acquire?
3. In which geography or territory?
4. Through which route to market?
5. What expertise or proof should we establish?
6. Which channels fit this business?
7. Where is acquisition currently leaking?
8. What should we revisit now?

### 6.2 Strategy

`/customer/marketing/strategy` is the canonical strategy record and periodic-review surface.

It should capture:

- business archetype and business-model framing
- locality / service territory / geographic scope
- ideal customer profiles and segments
- route to market
- core offers and entry offers
- differentiators and positioning
- proof assets
  - case studies
  - testimonials
  - certifications
  - outcomes
  - expertise themes
- seasonality and recurring calendar opportunities
- acquisition constraints
  - compliance
  - geography
  - staffing/capacity
  - product maturity
- review cadence and last-reviewed state

The specialist should proactively suggest:

- stale strategy areas
- missing proof
- underrepresented channels
- locality-specific opportunities
- market shifts worth revisiting

### 6.3 Campaigns

`/customer/marketing/campaigns` is the execution-planning layer.

Each campaign should carry:

- objective
- target audience
- locality / segment / territory
- route-to-market fit
- channel mix
- message / offer
- required proof assets
- required approvals
- automation readiness
- status
- expected funnel-stage impact
- expected volume / learning goal

Supported campaign shapes must include, at minimum:

- email campaigns
- LinkedIn / professional social posting plans
- outbound mail
- event attendance or event sponsorship suggestions
- referral motions
- follow-up or nurture campaigns
- authority / content-led campaigns
- locality-specific or season-specific offers

The specialist should be allowed to be creative here, but output must stay concrete and operational.

### 6.4 Funnel

`/customer/marketing/funnel` extends the existing funnel concept into a marketing operating view.

It should emphasize:

- top-of-funnel interaction volume
- engagement conversion
- opportunity conversion
- won volume / won value
- weak relative conversion points
- time-to-convert friction
- seasonality
- locality, channel, and segment breakdowns

This page should answer marketing questions such as:

- which stage is leaking most?
- is the issue volume or conversion?
- which audience or locality converts best?
- are we underperforming seasonally or structurally?
- what kind of campaign might improve the weakest stage?

### 6.5 Automation

`/customer/marketing/automation` is the practical “take the burden off me” layer.

It should distinguish:

- already automated
- ready to automate
- drafted but awaiting approval
- blocked on missing asset
- blocked on missing integration
- intentionally manual

Examples:

- email nurture sequences
- reminders to publish or review content
- scheduled LinkedIn post batches
- outbound follow-up cadences
- event preparation workflows
- task creation for missing proof assets
- inbound routing or follow-up tasks tied to engagement creation

## 7. Specialist Behavior Model

The marketing specialist should behave as a proactive growth partner, not a passive form filler.

Its responsibilities:

1. Understand the business model, locality, route to market, and audience.
2. Suggest creative but grounded acquisition ideas.
3. Produce concrete operational outputs.
4. Recommend and prepare automation where sensible.
5. Continuously review performance and suggest revisions.

### 7.1 Core Action Types

#### A. Creative Recommendations

Examples:

- campaign ideas
- positioning angles
- locality-specific opportunities
- event opportunities
- seasonal motions
- partnership ideas
- thought-leadership themes

#### B. Content and Channel Execution

Examples:

- email campaigns
- LinkedIn post series
- outbound mail sequences
- event outreach kits
- content briefs
- FAQ ideas
- case-study prompts
- call-to-action copy

#### C. Automation Orchestration

Examples:

- recurring campaign cadences
- follow-up sequences
- reminders
- nurture flows
- backlog items for missing assets
- integration-dependent workflows

#### D. Ongoing Review

Examples:

- strategy stale warnings
- weak funnel-stage alerts
- seasonality prompts
- underperforming campaign warnings
- recommended next moves based on historical context

### 7.2 Approval Boundary

The specialist may:

- draft
- recommend
- structure
- sequence
- schedule internally
- prepare automations

The specialist must not silently publish or send externally visible marketing content without reviewable approval.

This is intentionally aligned with the future trusted customer-facing coworker boundary and GAID-style trust expectations.

## 8. Data Model Design

### 8.1 Canonical Reuse

Do not create duplicate identity or market models for data that already has a canonical home.

Use:

- `Organization` for canonical organization identity
- `BusinessContext` for broad business truth
- `StorefrontConfig` / `StorefrontArchetype` for public-offer and archetype context
- `CustomerAccount` / `Engagement` / `Opportunity` for CRM and funnel state

### 8.2 New Canonical Marketing Models

#### `MarketingStrategy`

Purpose:

- one current acquisition strategy record per Organization (the canonical install)
- versioned over time via `MarketingReview` snapshots — never overwritten in place

Scope decision (closes §15 Q1 from prior draft):

- Strategy is **per-Organization**, consistent with single-org-per-install. Per-account positioning belongs on `MarketingCampaign.targetAudience` and `MarketingCampaign.positioningAngle`. Keeping the strategy record canonical lets the future trusted customer-facing AI consume one stable record per install.

Suggested fields (with column shape):

- `strategyId` — String, cuid PK
- `organizationId` — String, FK → Organization, **unique**
- `storefrontId?` — String, FK → StorefrontConfig (nullable)
- `status` — String enum, see §17
- `primaryGoal` — String (free text)
- `routeToMarket` — String enum, see §17
- `localityModel` — String enum, see §17
- `geographicScope` — String (free-text region descriptor)
- `serviceTerritories` — Json (list of `{ name, postalCodes?, radiusMiles? }`)
- `targetSegments` — Json (list of `{ name, description }`)
- `idealCustomerProfiles` — Json (list of `{ name, traits, painPoints }`)
- `entryOffers` — Json (list of `{ name, description, price?, ctaUrl? }`)
- `primaryChannels` — String[] of channel slugs from §17
- `secondaryChannels` — String[] of channel slugs from §17
- `differentiators` — String[] (free-text statements)
- `proofAssets` — Json (list of `{ type, label, url?, accountId? }`; `type` enum from §17)
- `seasonalityNotes` — String (free text)
- `constraints` — Json (`{ compliance?, geography?, capacity?, productMaturity? }`)
- `reviewCadence` — String enum, see §17
- `lastReviewedAt` — DateTime
- `nextReviewAt` — DateTime
- `sourceSummary` — String (where this draft came from: archetype default, AI synthesis, manual)
- `specialistNotes` — String (free text, agent-maintained)

Boundary:

- `BusinessContext` remains broad business truth (description, value proposition, target market, revenue model, company size, geographic scope).
- `StorefrontConfig` / `StorefrontArchetype` remain canonical for the public-facing offer and archetype seed (per CLAUDE.md "Portal Archetype" rule — `StorefrontConfig.archetypeId` is the single source of truth, do not duplicate archetype here).
- `MarketingStrategy` becomes acquisition-specific operating truth and reads `archetypeId` via `StorefrontConfig`.

#### `MarketingCampaign`

Purpose:

- represent campaigns tied to a strategy and (optionally) a customer account

Suggested fields (with column shape):

- `campaignId` — String, cuid PK
- `organizationId` — String, FK → Organization
- `strategyId` — String, FK → MarketingStrategy
- `accountId?` — String, FK → CustomerAccount (nullable; null = broad-audience campaign)
- `name` — String
- `objective` — String enum, see §17
- `targetAudience` — Json (`{ segmentRefs, icpRefs, customDescription? }`)
- `locality?` — String (territory or region; nullable)
- `channelMix` — Json (list of `{ channel, role, weight? }`; `channel` slug from §17, `role` enum: `"primary" | "secondary"`)
- `offer?` — String (free text)
- `positioningAngle?` — String (free text)
- `status` — String enum, see §17
- `startAt?` — DateTime
- `endAt?` — DateTime
- `expectedFunnelStageImpact` — String enum, see §17
- `expectedVolume?` — Int
- `expectedValue?` — Int (cents)
- `successMeasures` — Json (list of `{ metric, target, comparator }`)
- `approvalStatus` — String enum, see §17
- `notes?` — String

Important design rules:

- Channel must not be modeled as "email-only".
- `channelMix` is a structured list so campaigns can span email, LinkedIn, outbound mail, events, and related motions in a single campaign.
- A campaign can exist without `accountId` (broad-audience) but cannot exist without `strategyId`.

#### `MarketingAutomation`

Purpose:

- represent repeatable automation-ready marketing operations
- single source of truth for the §6.5 automation panel state

Suggested fields (with column shape):

- `automationId` — String, cuid PK
- `organizationId` — String, FK → Organization
- `strategyId?` — String, FK → MarketingStrategy
- `campaignId?` — String, FK → MarketingCampaign
- `name` — String
- `type` — String enum, see §17
- `channel` — String, channel slug from §17
- `trigger` — Json (`{ kind: "time" | "event" | "manual", config }`)
- `cadence?` — String (cron expression or natural cadence; nullable for one-shot triggers)
- `status` — String enum, see §17 — drives the §6.5 panel states
- `blockedReason?` — String enum, see §17 (set when `status = "blocked"`)
- `integrationDependency?` — String (slug of required integration; nullable when none)
- `owner?` — String (agentId or userId)
- `lastRunAt?` — DateTime
- `lastResult?` — Json
- `notes?` — String

UI-state mapping (resolves §6.5 panel states to model fields):

| §6.5 panel state | `status` | `blockedReason` |
| - | - | - |
| already automated | `active` | — |
| ready to automate | `ready` | — |
| drafted but awaiting approval | `draft` | — |
| blocked on missing asset | `blocked` | `missing-asset` |
| blocked on missing integration | `blocked` | `missing-integration` |
| intentionally manual | `manual` | — |

Design rule: a single `status` enum drives the panel; `blockedReason` discriminates the two `blocked` sub-states. Do not introduce parallel `executionMode` / `approvalMode` fields — they were considered and rejected to avoid the "which field decides?" ambiguity.

#### `MarketingReview`

Purpose:

- preserve periodic strategy reviews and proactive AI recommendations without overwriting the canonical strategy record

Suggested fields (with column shape):

- `reviewId` — String, cuid PK
- `organizationId` — String, FK → Organization
- `strategyId` — String, FK → MarketingStrategy
- `reviewType` — String enum, see §17
- `summary` — String (markdown)
- `detectedChanges` — Json (list of `{ field, before, after, source }`)
- `funnelAssessment` — Json (`{ weakStage?, deltas?, notes? }`)
- `suggestedActions` — Json (list of `{ kind, target, description, priority }`)
- `stalenessSignals` — Json (list of `{ area, reason }`)
- `createdByAgentId?` — String (nullable when user-initiated)
- `createdAt` — DateTime

### 8.3 Why This Split Matters

This prevents three bad outcomes:

1. stuffing route-to-market logic into `StorefrontConfig`
2. overloading `CustomerAccount` with marketing-operating fields
3. making the future customer-facing coworker infer strategy from incomplete public configuration

## 9. Coworker Routing and Tooling Changes

### 9.1 Route Ownership

`/customer/marketing` should resolve to the marketing specialist, not the customer-success advisor.

Recommended behavior:

- keep generic `/customer` pages on customer-success framing where appropriate
- route `/customer/marketing` and its sub-routes to the `marketing-specialist`

This avoids weakening either persona:

- customer-success remains focused on service adoption and friction
- marketing-specialist remains focused on acquisition, positioning, campaigns, and growth

### 9.2 Capability Model

Current marketing tools are keyed to `view_storefront`. This blocks `/customer/marketing` users from invoking them when their persona only carries `view_customer`.

**Decision: introduce a dedicated marketing capability family in this spec, not later.**

| Capability | Grants |
| - | - |
| `view_marketing` | read marketing strategy, campaigns, funnel breakdowns, automation state |
| `operate_marketing` | create or modify strategy, campaigns, drafts, and automations (does NOT include external publishing) |
| `publish_marketing` | approve and publish externally visible content (gated separately; used by the future trusted customer-facing flow) |

Migration plan (Phase 1):

1. Re-key the three existing MCP tools (`get_marketing_summary`, `suggest_campaign_ideas`, `analyze_seo_opportunity`) from `view_storefront` to `view_marketing` in `apps/web/lib/mcp-tools.ts`.
2. Grant `marketing-specialist` route persona `view_marketing` + `operate_marketing` everywhere it is rooted (`/customer/marketing` and any retained skill grants).
3. Grant `customer-advisor` persona on the broader `/customer` route `view_marketing` (read-only) so customer-success surfaces can show marketing context without owning it.
4. `view_storefront` retains its current scope for storefront sections / items / public presentation.
5. Update `packages/db/src/seed-grants.ts` (or equivalent grant seed) in the same commit as the MCP-tool re-key — re-keying without seed updates is the silent-grant-failure pattern recorded in `project_agent_grant_seeding_gap` (every tool call would silently deny). The migration must include an invariant guard verifying every persona that previously held `view_storefront`-marketing-grants now holds `view_marketing`.

This split keeps internal acquisition marketing, public-experience management, and externally-visible publishing distinct — which is what the §13 customer-facing-coworker boundary depends on.

### 9.3 Skill Surface

The Marketing workspace should expose specialist actions such as:

- review strategy
- refresh market assumptions
- suggest campaigns
- draft email campaign
- draft LinkedIn plan
- plan outbound mail sequence
- suggest event opportunities
- analyze funnel leakage
- review automation opportunities
- create backlog item for missing proof assets

## 10. Workflow Model

The marketing workspace should follow a repeating operating loop:

### 10.1 Understand

- capture or refresh strategy
- confirm business type, locality, route to market, segments, proof, and constraints

### 10.2 Recommend

- generate campaigns and next-best motions grounded in strategy and current performance

### 10.3 Prepare and Automate

- draft assets
- prepare sequences
- schedule internal work
- identify automation-ready workflows

### 10.4 Measure and Revise

- inspect performance
- explain weak points
- propose changes
- flag stale strategy assumptions

This loop should be explicit in both the coworker behavior and the workspace UI.

## 11. Measurement Model

The workspace must evaluate both absolute volume and relative efficiency.

### 11.1 Required Measures

- interaction volume
- engagement creation volume
- opportunity volume
- won volume / won value
- relative step conversion
- overall conversion
- time to convert
- seasonality
- channel breakdowns
- locality breakdowns
- audience / segment breakdowns

### 11.2 Interpretation Rules

The workspace should help users answer:

- is demand too low?
- is top-of-funnel healthy but mid-funnel weak?
- is the issue messaging, audience, offer, or route-to-market fit?
- are there locality-specific wins or weaknesses?
- did performance change because of seasonality or a true strategy problem?

### 11.3 Analysis Inspiration

The measurement design should adopt the strongest proven patterns from funnel analytics:

- step-by-step drop-off visibility
- relative vs overall conversion views
- breakdowns by segment/property/locality/channel
- time-to-convert and friction detection
- seasonality analysis over time

## 12. Research and Benchmarking

This design includes required benchmark research across best-of-breed systems.

### 12.1 Systems Reviewed

#### HubSpot

Source:

- [Use lifecycle stages](https://knowledge.hubspot.com/articles/kcs_article/contacts/use-lifecycle-stages)

What we learned:

- lifecycle stages are useful for aligning marketing and sales handoff
- stage progression should be legible and customizable
- strategy and campaign work should be tied to where a lead/company is in the lifecycle, not just to content output

Pattern adopted:

- keep marketing work connected to CRM stage progression and acquisition lifecycle

Pattern rejected:

- treating lifecycle stage definitions alone as a complete marketing operating model

#### Mailchimp

Sources:

- [Customer Journey glossary](https://mailchimp.com/marketing-glossary/customer-journey)
- [Customer Journey Builder webhooks](https://mailchimp.com/developer/marketing/guides/create-webhook-customer-journey-builder-campaign-manager/)

What we learned:

- marketers need dynamic journey logic, not just one-off sends
- webhooks and external actions are a real part of campaign orchestration
- automation is useful when tied to customer movement through a journey

Patterns adopted:

- automation should be modeled as first-class operational work
- external actions and multi-step flows belong in the design

Patterns rejected:

- making the internal workspace “email campaign builder only”
- assuming retries, delivery guarantees, or external integrations exist before we model approval and blocked states

#### Mautic

Source:

- [Campaigns overview](https://docs.mautic.org/en/5.2/campaigns/campaigns_overview.html)

What we learned:

- campaigns can mix time-driven and contact-driven actions
- segments and workflows are the backbone of real marketing operations
- automation reduces repetitive manual work when workflows are predefined

Patterns adopted:

- campaigns should support both time-based and trigger-based execution
- nurture and contact-driven workflows matter for SMB and service businesses, not just e-commerce

Pattern rejected:

- forcing all marketing work into contact-segmentation mechanics before we have the right internal strategy layer

#### Odoo

Source:

- [Marketing Automation](https://www.odoo.com/documentation/19.0/applications/marketing/marketing_automation.html)

What we learned:

- campaign templates and workflow-oriented automation lower the barrier for operators
- campaign workflows need audience targeting, activities, testing/running, and metrics

Patterns adopted:

- templates and suggested motions should be part of the experience
- automation should show target audience, activities, run state, and metrics

Pattern rejected:

- exposing raw workflow complexity too early in the top-level IA

#### PostHog

Source:

- [Funnels](https://posthog.com/docs/product-analytics/funnels)

What we learned:

- relative vs overall conversion matters
- time-to-convert matters
- seasonality and breakdowns matter
- real paths differ from the ideal imagined funnel

Patterns adopted:

- marketing funnel analysis should show both absolute and relative conversion
- funnel analysis should support locality, channel, and audience breakdowns
- the workspace should explicitly surface weak stages and time-friction

### 12.2 Differentiator

DPF’s differentiator is not “yet another email campaign tool.”

The platform’s unique opportunity is:

1. archetype-aware strategy
2. CRM + storefront + funnel context in one place
3. coworker-assisted creativity plus operational reduction
4. internal truth designed to feed a future trusted customer-facing AI

That combination is stronger than a standalone campaign scheduler.

### 12.3 Anti-Patterns to Avoid

1. Generic marketing jargon detached from business model and locality
2. Email-only worldview
3. Duplicating business identity across multiple models
4. Treating public storefront configuration as a complete marketing strategy
5. Autopublishing without approval and trust controls
6. Funnel analysis without segment, locality, or time context

## 13. Future Customer-Facing Boundary

This spec must explicitly support a later customer-facing coworker, but not define it fully.

### 13.1 Internal Workspace Owns

- strategy
- route-to-market reasoning
- campaign planning
- automation preparation
- operator-facing analysis
- draft recommendations

### 13.2 Future Customer-Facing Coworker Should Read Only

- approved public offers
- approved FAQs
- approved positioning summaries
- approved product and service answers
- trust-badge metadata / GAID identity cues
- approved availability / routing context

### 13.3 Explicit Rule

The future customer-facing coworker must not read directly from raw draft strategy or unapproved campaign plans.

Instead, it should consume a curated, approved subset of marketing truth published from the internal workspace.

## 14. Implementation Guidance

This spec intentionally points toward a layered implementation:

### Phase 1

- Add `Marketing` tab under `/customer` and route `/customer/marketing` (and sub-routes) to the marketing-specialist persona.
- Relocate `marketing-specialist` route persona from `/storefront` to `/customer/marketing` (per §5.3); install replacement storefront-operations persona on `/storefront`.
- Introduce `view_marketing` / `operate_marketing` / `publish_marketing` capability family (per §9.2); re-key the three existing MCP tools and update grant seeds in the same commit.
- Add `MarketingStrategy` and `MarketingReview` Prisma models — the strategy-first landing needs canonical data to read.
- Build strategy-first landing page backed by `MarketingStrategy`; seed an initial draft from `BusinessContext` + `StorefrontConfig.archetypeId` so first load is non-empty.
- Add the `review-inbox` skill `.skill.md` file currently missing from `skills/storefront/`.
- Reuse existing marketing skills and archetype playbooks; do not rename `skills/storefront/` directory in this phase.

### Phase 2

- Add `MarketingCampaign` and `MarketingAutomation` Prisma models.
- Wire campaigns and automation sub-routes to those models.
- Implement proactive suggestion + periodic-review loop (writes `MarketingReview` records).
- Optional: rename `skills/storefront/` → `skills/marketing/` for non-storefront-specific skills.

### Phase 3

- Enrich funnel analysis with marketing-specific breakdowns (channel, locality, segment, time-to-convert) — see §11.
- Connect automation states to real integration providers and scheduling.

### Phase 4

- Publish approved public-facing marketing context (introduces `MarketingPublishedSnapshot` model — out of scope for the §8.2 model design above; defined in a follow-on spec) for the future trusted customer-facing coworker (§13).

## 15. Open Questions

1. Which current `/customer/funnel` features should move into `/customer/marketing/funnel` vs remain as general customer-domain funnel analytics? (Suggested resolution: shared underlying queries; `/customer/funnel` defaults to stage breakdown, `/customer/marketing/funnel` defaults to channel/locality/segment breakdowns.)
2. Once channel integrations arrive, which automations may run without per-action approval and which remain always-reviewable? (Suggested resolution: time-based internal actions auto-run when `approvalStatus = "approved"`; any externally-visible publish stays `approvalStatus = "pending"` until a human or `publish_marketing`-bearing agent approves. Codify in §7.2 boundary update before Phase 3.)
3. When the future trusted customer-facing coworker lands, does `MarketingPublishedSnapshot` need its own approval workflow distinct from `MarketingCampaign.approvalStatus`, or can it reuse the same enum? (Defer to the Phase 4 follow-on spec.)

(Prior draft Q1 — strategy ownership scope — resolved in §8.2: `MarketingStrategy` is per-Organization with a unique FK.)

## 16. Recommended Outcome

Approve a strategy-first `Marketing` workspace under `/customer` as the canonical internal home for customer acquisition work.

This design:

1. fixes the current discoverability gap
2. respects different business models and localities
3. gives the marketing specialist a durable, proactive operating surface
4. keeps `/storefront` focused on public-experience management
5. creates the internal source of truth needed for a later trusted customer-facing AI coworker

## 17. Enum Catalog

Per CLAUDE.md "Strongly-Typed String Enums — MANDATORY COMPLIANCE": every new String field with a fixed value set is declared here as canonical. Implementation must add the TypeScript union types and `as const` arrays to a new `apps/web/lib/marketing.ts` (mirroring the `apps/web/lib/backlog.ts` pattern), and any MCP tool definitions in `apps/web/lib/mcp-tools.ts` must carry matching `enum:` arrays. Source of truth: this table + `marketing.ts`.

### MarketingStrategy

| Field | Valid values |
| - | - |
| `status` | `"draft"` `"active"` `"archived"` |
| `routeToMarket` | `"direct-sales"` `"inbound"` `"outbound"` `"channel-partner"` `"marketplace"` `"referral"` `"hybrid"` |
| `localityModel` | `"hyperlocal"` `"regional"` `"national"` `"international"` `"online-only"` |
| `reviewCadence` | `"weekly"` `"monthly"` `"quarterly"` `"annually"` |
| `proofAssets[].type` | `"case-study"` `"testimonial"` `"certification"` `"outcome"` `"award"` `"press"` |

### MarketingCampaign

| Field | Valid values |
| - | - |
| `status` | `"draft"` `"ready"` `"scheduled"` `"active"` `"paused"` `"complete"` `"archived"` |
| `objective` | `"awareness"` `"acquisition"` `"nurture"` `"reactivation"` `"retention"` `"referral"` `"event"` |
| `expectedFunnelStageImpact` | `"top"` `"engagement"` `"opportunity"` `"won"` `"retention"` |
| `approvalStatus` | `"not-required"` `"pending"` `"approved"` `"rejected"` |
| `channelMix[].role` | `"primary"` `"secondary"` |

### MarketingAutomation

| Field | Valid values |
| - | - |
| `status` | `"manual"` `"draft"` `"ready"` `"active"` `"paused"` `"blocked"` `"archived"` |
| `type` | `"email-nurture"` `"email-broadcast"` `"follow-up-sequence"` `"reminder"` `"scheduled-post-batch"` `"event-prep"` `"asset-task"` `"inbound-routing"` |
| `blockedReason` | `"missing-asset"` `"missing-integration"` `"missing-approval"` `"external-error"` |
| `trigger.kind` | `"time"` `"event"` `"manual"` |

### MarketingReview

| Field | Valid values |
| - | - |
| `reviewType` | `"scheduled"` `"ad-hoc"` `"ai-proactive"` `"post-campaign"` |

### Channels (shared by `MarketingStrategy.primaryChannels`/`secondaryChannels`, `MarketingCampaign.channelMix.channel`, `MarketingAutomation.channel`)

| Valid values |
| - |
| `"email"` `"linkedin"` `"facebook"` `"instagram"` `"x"` `"youtube"` `"tiktok"` `"outbound-mail"` `"event-attend"` `"event-sponsor"` `"referral"` `"partner"` `"content-seo"` `"paid-search"` `"paid-social"` `"podcast"` `"webinar"` `"phone"` |

### Capabilities (introduced in §9.2)

| Valid values |
| - |
| `"view_marketing"` `"operate_marketing"` `"publish_marketing"` |

Rules (mirrors CLAUDE.md):

1. Use only the values listed. Never invent synonyms.
2. Hyphens, not underscores. Multi-word values use hyphens.
3. Adding a new value requires updating `apps/web/lib/marketing.ts` AND the relevant MCP tool definition in `mcp-tools.ts` AND this table — in the same commit.
4. Seed scripts must declare the enum value explicitly; do not rely on Prisma defaults for `type`, `status`, or `channel`.
5. Capability slugs use underscores (matching the existing `view_storefront` / `view_customer` convention) — the hyphen rule applies to data enums, not capability identifiers.
