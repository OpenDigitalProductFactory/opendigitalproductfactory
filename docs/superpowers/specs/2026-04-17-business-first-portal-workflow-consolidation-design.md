# Business-First Portal Workflow Consolidation

**Date:** 2026-04-17  
**Status:** Draft  
**Author:** Codex navigation audit  
**Purpose:** Turn the portal shell refactor into a true workflow-first information architecture by shrinking shell chrome, consolidating large route families into a smaller set of working hubs, and aligning the product to a small human team supported by AI coworkers.

## 1. Inputs

This spec extends and operationalizes:

- `docs/superpowers/specs/2026-04-17-portal-navigation-consolidation-design.md`
- `docs/superpowers/specs/2026-04-02-product-centric-navigation-refactoring.md`
- `docs/superpowers/specs/2026-03-21-platform-services-ux-design.md`
- `docs/superpowers/specs/2026-04-11-business-setup-unification-design.md`

It is grounded in the current implementation and route footprint:

- `apps/web/app/(shell)/layout.tsx`
- `apps/web/components/shell/AppRail.tsx`
- `apps/web/components/agent/AgentCoworkerShell.tsx`
- `apps/web/app/(shell)/finance/page.tsx`
- `apps/web/app/(shell)/platform/page.tsx`
- `apps/web/app/(shell)/admin/page.tsx`

## 2. Problem Statement

The shell is improved, but the portal still behaves like a set of large route silos rather than a coherent operating environment.

Three issues remain:

1. **The shell is structurally better but visually heavy.**  
   The current left rail is fixed at `320px` in `layout.tsx`, and the open coworker reserves another ~`412px` (`380px` panel width plus edge gaps). On narrower desktop viewports, the working canvas can feel squeezed even when the page content itself is simple.

2. **Major areas still act like launchpads or schema surfaces.**  
   The home pages for `Finance`, `Platform`, and `Admin` still emphasize broad card grids and raw capability exposure. They are better than a flat top nav, but they are not yet optimized for fast human workflows.

3. **The IA still reflects system structure more than operating reality.**  
   The target organization is small on the human side, with most specialist depth provided by AI coworkers. Human users should not need to learn every domain in detail. The product should let them:
   - run the business from a small number of predictable hubs
   - escalate to product/platform depth only when needed
   - use the coworker to bridge unfamiliar domains

The portal therefore needs the next level of refactor:

- lighter shell chrome
- fewer durable destinations
- more workflow-oriented section homes
- clearer distinction between destination pages, drill-down pages, and configuration pages

## 3. Operating Model Assumption

This design assumes the operating model the user described:

- **1-10 human internal operators**
- many external customers, contractors, and fractional staff
- one human often wearing multiple hats
- AI coworkers providing the specialist expertise most humans do not hold directly

This has a direct IA implication:

- the portal should optimize for **high-confidence orchestration**
- not for a large internal department structure
- and not for expert-only navigation

The human user's primary question is not "where is the specialist module?"

It is:

> "What do I need to run next, and which coworker can help me cross the gap?"

## 4. Research & Benchmarking

### 4.1 Systems compared

The recommendations here follow patterns visible in widely used, mature systems and official design guidance:

- **Atlassian new navigation**
  - moved primary product navigation from top bar to sidebar
  - simplified top bar to universal actions like search and create
  - validated the design through staged research and rollout, including early interviews with 16 Jira users and later testing with 160 users
  - source: <https://www.atlassian.com/blog/design/designing-atlassians-new-navigation>

- **Atlassian navigation announcement**
  - emphasizes customizable sidebar, decluttered top navigation, and consistency across products
  - source: <https://www.atlassian.com/blog/announcements/introducing-new-navigation>

- **Plane App Rail**
  - separates app switching from local navigation
  - explicitly rejects "dashboards pretending to be features"
  - treats the rail as a scalability guardrail for multi-product growth
  - source: <https://plane.so/blog/introducing-apprail-plane-new-navigation>

- **Fluent 2 Nav**
  - treats navigation as high-level wayfinding
  - recommends brief labels, clean scanning, minimizable nav, and only limited hierarchy
  - notes nav generally appears inline beside content and is `260px` wide by default
  - source: <https://fluent2.microsoft.design/components/web/react/core/nav/usage>

- **Fluent 2 Breadcrumb**
  - positions breadcrumbs as secondary navigation, never the main system
  - source: <https://fluent2.microsoft.design/components/web/react/core/breadcrumb/usage>

- **Carbon Tabs**
  - tabs are for switching between views in the same context, not for sprawling app navigation
  - source: <https://carbondesignsystem.com/components/tabs/usage/>

### 4.2 Patterns adopted

1. **Sidebar for durable navigation, top bar for utilities**  
   This is now the dominant pattern in complex SaaS and operating systems because it scales better than a wide top nav and preserves more meaning at a glance.

2. **App switching distinct from in-area navigation**  
   The user should first understand which major domain they are in, then which slice of that domain they are working in.

3. **Compact persistent nav, not descriptive card-heavy nav**  
   A persistent rail should orient, not lecture. Rich descriptions belong on landing pages or hover/tooling, not as permanent chrome.

4. **Workflow hubs beat launchpads**  
   Users should land in a small number of working surfaces that combine the tasks they actually perform together, instead of memorizing dozens of raw pages.

5. **AI as bridge, not as replacement for IA**  
   Search and coworker guidance help users move across domains, but they are not substitutes for a coherent navigation model.

### 4.3 Patterns rejected

1. **A large descriptive left rail**
   It improves clarity over a crowded top bar, but it consumes too much permanent space and competes with the page.

2. **Dashboard pages that just restate the site map**
   Workspace and section landing pages should help users act, not repeat global navigation in another format.

3. **Flat route families as destination architecture**
   Pages like `finance/*` and `platform/*` already exceed what a flat, link-first architecture can support comfortably.

## 5. Decision

The portal should optimize around the human north-star workflow:

**Run the business first.**

That means the IA priority order becomes:

1. `Business`
2. `Products`
3. `Platform`
4. `Knowledge`

`Workspace` remains the personal cockpit, not a peer domain full of structural navigation.

## 6. Target Information Architecture

### 6.1 Global structure

The shell should expose these durable areas:

- `Workspace`
- `Business`
- `Products`
- `Platform`
- `Knowledge`

### 6.2 Intended mental model

#### Workspace

Personal cockpit:

- queue
- recent work
- alerts
- active coworker context
- pinned destinations

Not:

- a second site map
- a full launcher for every route family

#### Business

Primary home for human operators:

- Customer
- People
- Finance
- Compliance
- Portal

This becomes the default home for "I need to operate the company today."

#### Products

Secondary domain for lifecycle stewardship:

- Portfolio
- Backlog
- Inventory
- Architecture
- Changes

This is where users go when the question is product-specific rather than business-operational.

#### Platform

Specialist operational domain:

- AI Workforce
- Build Studio
- Tools & Services
- Audit & Governance
- Admin

This should feel like "operate the machine," not "run the business."

#### Knowledge

Low-frequency but important reference:

- Knowledge
- Docs

Over time, this may collapse toward a utility/help pattern if usage remains reference-oriented.

## 7. Shell Changes

### 7.1 Compact rail

The current `320px` rail is too wide for the portal's target operating model.

Recommended desktop target:

- **Default width:** `248px`
- **Expanded comfort ceiling:** `256px`
- **Collapsed mode:** optional follow-on, icon-first or icon+tooltip mode

### 7.2 Rail content rules

The persistent rail should contain:

- short section labels
- compact item labels
- active-state clarity
- minimal supportive copy

It should not contain:

- paragraph-like descriptions for every destination
- card styling that makes the rail feel like page content
- large vertical gaps that push the content area into a narrow strip

### 7.3 Top bar role

The top bar should continue to emphasize:

- search / command
- feedback
- health/status
- account actions

It should not re-accumulate structural navigation.

### 7.4 Coworker interplay

The docked coworker remains correct for desktop, but it increases the importance of a compact left rail. The shell must assume that the coworker is frequently open for power users and still preserve a healthy page canvas.

## 8. Workflow Hub Consolidation

### 8.1 Finance

`Finance` should stop behaving like a broad launchpad of unrelated finance surfaces.

Today the route family already spans:

- `invoices`
- `bills`
- `expense-claims`
- `my-expenses`
- `purchase-orders`
- `suppliers`
- `banking`
- `payment-runs`
- `payments`
- `recurring`
- `reports`
- `assets`
- `settings`

It should consolidate around a small set of operator hubs:

- `Overview`
  - cash position
  - immediate risk
  - setup state
  - due-soon items

- `Revenue`
  - invoices
  - receivables
  - collections
  - expected inflows

- `Spend`
  - bills
  - expenses
  - payables
  - expected outflows

- `Close`
  - recurring schedules
  - reporting cadence
  - approvals
  - month-end or period-end work

- `Configuration`
  - banking
  - taxes
  - org financial settings
  - one-time setup

#### Finance move/merge rules

- pages about current money movement belong under `Revenue` or `Spend`
- pages about reconciliation, schedules, and reporting belong under `Close`
- setup/config pages move behind `Configuration`
- the Finance landing page becomes a working summary, not a card directory
- `banking`, `settings`, and tax/currency/dunning pages move behind `Configuration`
- `reports/*` and `recurring/*` are no longer primary destinations; they are reached through `Close`
- `my-expenses` and `expense-claims` stay discoverable, but should present as part of the broader spend/approval workflow rather than as isolated silos

#### Why this fits the target users

A human wearing multiple hats does not think:

> "I need the fixed asset sub-route."

They think:

> "What money is coming in, what money is going out, and what needs my approval?"

### 8.2 Platform

`Platform` should stop being a mixed capability showroom.

Today the route family already spans:

- `platform/ai/*`
- `platform/audit/*`
- `platform/integrations/*`
- `platform/services/*`
- `platform/tools/*`

It should become four operator groupings:

- `AI Operations`
  - AI workforce
  - routing
  - provider operations
  - coworker authority

- `Tools & Services`
  - MCP catalog
  - activated services
  - integrations
  - service health

- `Governance & Audit`
  - audit trails
  - tool execution log
  - approvals
  - authority and compliance surfaces

- `Core Admin`
  - only the platform-governance and configuration items that truly belong to system administration

#### Platform move/merge rules

- provider/service/integration pages consolidate under `Tools & Services`
- AI-specific pages stay together under `AI Operations`
- audit, ledger, authority, and platform ops move together under `Governance & Audit`
- general-purpose "platform capabilities" launch tiles are demoted in favor of workflow summaries
- duplicate catalog/service paths under both `platform/services` and `platform/tools/services` should converge on one canonical structure
- `platform/integrations`, `platform/services`, and `platform/tools/catalog` should stop competing as separate homes for essentially the same integration lifecycle
- `platform/ai/build-studio` should not compete with the global `Build Studio` destination; it should either reinforce that home or redirect into it

#### Why this fits the target users

Most humans should not live in Platform all day. When they do come here, they are usually solving one of three problems:

- the AI workforce needs attention
- an integration or service is not healthy
- they need governance evidence or controls

The IA should mirror those jobs directly.

### 8.3 Admin

`Admin` should become narrower and quieter.

It should not feel like a general destination for daily work. It should feel like controlled configuration.

Today `Admin` still spans a broad set of tabs and subroutes, including:

- access/user home
- branding
- business context
- business models
- organization settings
- storefront
- reference data
- platform development
- prompts
- skills
- issue reports
- diagnostics

Recommended structure:

- `Organization`
  - organization identity
  - branding
  - business-wide settings that affect how the company presents itself

- `Access`
  - users
  - roles
  - permissions
  - lifecycle controls

- `Configuration`
  - reference data
  - global settings
  - system-level configuration that is not part of everyday operations

- `Advanced`
  - rarely used, sensitive, or expert-only controls

#### Admin move/merge rules

- business-operational setup that supports daily work should move out to `Business` where appropriate
- platform-specialist controls should move to `Platform`
- only durable administrative configuration remains in `Admin`
- `business-context`, `operating-hours`, and most `storefront` setup concerns should align with `Business`
- `platform-development`, `prompts`, `skills`, `diagnostics`, and similar specialist controls should align with `Platform`
- `business-models` remains a deliberate decision point, but should be treated as governed configuration, not as a daily navigation destination

#### Why this fits the target users

In a small organization, "Admin" is often a permission boundary, not a daily workspace. The IA should respect that and reduce the temptation to treat Admin as a catch-all bucket.

## 9. Destination Rules

Use these rules to decide whether a page remains a destination, gets merged, or gets demoted:

### Keep as a destination when

- users intentionally navigate there as part of a recurring workflow
- it summarizes a meaningful unit of work
- it helps users choose what to do next

### Merge into a hub when

- it is mostly a filtered variant of a sibling workflow
- users rarely need it in isolation
- it is one step of a broader operator task

### Demote from destination status when

- it is detail-only
- it exists because the model exists
- it is primarily configuration or reference data
- users reach it from a record or a flow, not from intent

## 10. Concrete First Slice

The first implementation slice should do two things together:

### Slice A: Compact shell

- reduce left rail width from `320px` to compact width
- remove always-visible descriptive density from the rail
- preserve strong active-state orientation

### Slice B: Finance-first consolidation

- redesign `Finance` around the hub model above
- demote setup/config subpages behind a finance configuration surface
- keep links to legacy routes during transition, but stop presenting them as the primary mental model

This is the highest-leverage next slice because:

- humans are most likely to start from business operations
- finance currently has the largest route footprint
- it will prove the hub pattern before applying it to `Platform` and `Admin`

## 11. Migration Sequence

### Phase 1. Compact the shell

- slim the left rail
- reduce descriptive copy
- preserve the docked coworker and main canvas balance

### Phase 2. Consolidate Finance

- build workflow hubs
- demote configuration
- convert the section home from launchpad to operator summary

### Phase 3. Consolidate Platform

- regroup around AI Operations, Tools & Services, Governance & Audit, Core Admin

### Phase 4. Narrow Admin

- move non-admin daily work out
- preserve only true configuration and access management

### Phase 5. Extend the same rules across remaining domains

- Customer
- People
- Portal
- Knowledge

## 12. Success Criteria

This refactor is successful when:

- the left rail feels lighter than the page, not heavier
- a human can name the few places they actually work day to day
- `Finance`, `Platform`, and `Admin` each have clearer, smaller mental models
- detail/config pages stop competing with workflow hubs
- AI coworkers feel like cross-domain specialists augmenting the human, not like a workaround for confusing navigation

## 13. Decision

The portal should now move from **shell cleanup** to **workflow consolidation**.

The recommended path is:

- compact the rail
- prioritize `Business` as the main human operating domain
- consolidate `Finance` first
- then consolidate `Platform`
- then narrow `Admin`

This is the direction most aligned with the strongest modern SaaS patterns, the current route sprawl in DPF, and the user's stated target state of a small human team amplified by AI coworkers.
