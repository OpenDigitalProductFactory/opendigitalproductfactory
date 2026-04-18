# Portal Navigation Consolidation Design

**Date:** 2026-04-17
**Status:** Draft
**Author:** Codex navigation audit
**Purpose:** Consolidate the existing navigation-related specs into one shell-level direction that scales the portal without overlapping menus, duplicate launchpads, or navigation role confusion.

## 1. Inputs

This spec consolidates:

- `docs/superpowers/specs/2026-04-02-product-centric-navigation-refactoring.md`
- `docs/superpowers/specs/2026-04-11-business-setup-unification-design.md`
- `docs/superpowers/specs/2026-03-21-platform-services-ux-design.md`
- `docs/superpowers/specs/2026-03-17-workspace-calendar-activity-feed-design.md`

It is also grounded in the current portal shell and representative live routes:

- `apps/web/app/(shell)/layout.tsx`
- `apps/web/components/shell/Header.tsx`
- `apps/web/components/setup/SetupOverlay.tsx`
- `apps/web/app/(shell)/workspace/page.tsx`
- `apps/web/components/compliance/ComplianceTabNav.tsx`
- `apps/web/components/product/ProductTabNav.tsx`

## 2. Problem Statement

The portal currently asks users "where do I go?" in too many places at once.

Today, these layers all compete:

1. The persistent header global nav
2. The setup progress overlay
3. Workspace launch tiles
4. Section tab rows
5. Local page actions and coworker chrome

This creates overlap, especially on `/workspace`, where onboarding, global navigation, launch tiles, calendar/activity content, and the coworker all appear in the same viewport. The result is a portal that feels larger and harder to navigate than it really is.

The existing specs already point toward the right future state, but they currently stop at their own domain boundaries:

- The product-centric refactor makes `Portfolio` and `DigitalProduct` the anchor
- The business setup spec separates business context from storefront setup
- The platform services spec turns AI, services, and integrations into one coherent hub
- The workspace spec positions workspace as a landing page for work, not a second app map

What is missing is a shell-level navigation rule set that says what belongs in:

- global app switching
- in-area section navigation
- page-local controls
- onboarding/setup
- workspace personalization

## 3. Current-State Evidence

### 3.1 Shell layering conflict

`apps/web/app/(shell)/layout.tsx` mounts the setup overlay, header, page content, and coworker shell together for the main authenticated experience.

`apps/web/components/setup/SetupOverlay.tsx` explicitly renders onboarding controls "on top of real portal pages" and auto-opens the coworker panel. That is useful for guided setup, but it also means onboarding becomes a permanent competing navigation layer while setup is active.

### 3.2 Workspace duplicates structural navigation

`apps/web/app/(shell)/workspace/page.tsx` renders:

- capability tiles
- calendar
- activity feed
- attention strip

This is directionally correct for a dashboard, but the capability tiles currently duplicate product areas already present in the global header. Workspace is acting like both a personal dashboard and a second full application launcher.

### 3.3 Global nav is too wide and too flat

`apps/web/components/shell/Header.tsx` exposes nine top-level destinations:

- My Workspace
- Portfolio
- Backlog
- Inventory
- EA Modeler
- AI Workforce
- Build
- Knowledge
- Docs

That structure reflects internal capability groupings more than end-user mental models.

### 3.4 Tabs are being used past their comfort zone

Current examples:

- Compliance has 14 tabs in `ComplianceTabNav.tsx`
- Product detail has 10 tabs in `ProductTabNav.tsx`
- Admin has a similarly large tab set

That is a smell. Tabs work well for a small set of closely related sibling views. Once a section grows beyond that, the user is scanning a menu strip instead of understanding a section.

### 3.5 Large domains are already too big for flat horizontal navigation

Current route counts under `apps/web/app/(shell)`:

- `finance`: 42 routes
- `platform`: 32 routes
- `compliance`: 24 routes
- `admin`: 19 routes
- `portfolio`: 11 routes

This is large enough that shell rules matter more than page polish.

## 4. Design Principles

### P1. One primary navigation layer

Use one durable app-switching layer for major product areas. Do not ask the header, workspace, and onboarding overlay to all perform primary navigation at the same time.

### P2. Workspace is for "my work," not "the site map"

Workspace should show:

- pinned destinations
- recent pages
- action items
- calendar
- alerts
- active coworker threads

It should not mirror the entire application map.

### P3. Setup is a guided state, not permanent chrome

Setup should be:

- a dedicated `/setup` flow, or
- a lightweight checklist/banner that points back into setup

It should not permanently sit above real work pages once the user is in the shell.

### P4. Tabs are for sibling views, not section sprawl

Use tabs only when the destinations are closely related and easy to scan. When a section gets large, group it into a smaller set of lifecycle or domain tabs and move deeper navigation inside the section.

### P5. Cross-cutting views are secondary

Backlog, inventory, and architecture remain valuable, but they should not outrank product-oriented management paths. They should be reachable from the product area and via search/command palette.

### P6. Top bar is utilities, not the whole IA

The top bar should hold universal actions:

- search / command palette
- create
- notifications / feedback
- platform health
- user/account actions

Primary structure should live in a left app rail or sidebar.

## 5. Best-of-Breed Benchmarks

The recommendation follows established patterns used by scaled multi-product platforms:

- Atlassian moved product navigation from the top bar to the sidebar and kept the top bar for universal actions like search and create: <https://www.atlassian.com/blog/design/designing-atlassians-new-navigation>
- Plane's App Rail separates app switching from context-aware side navigation and explicitly avoids dashboards pretending to be primary apps: <https://plane.so/blog/introducing-apprail-plane-new-navigation>
- Fluent says nav should guide people to the main sections of the app, while tabs are best for a small set of closely related pages: <https://fluent2.microsoft.design/components/web/react/core/nav/usage> and <https://fluent2.microsoft.design/components/web/react/core/tablist/usage>
- Fluent and Carbon both treat breadcrumbs as secondary navigation for hierarchy, not a replacement for primary navigation: <https://fluent2.microsoft.design/components/web/react/core/breadcrumb/usage> and <https://carbondesignsystem.com/components/breadcrumb/usage/>

## 6. Recommended Target Model

### 6.1 Shell hierarchy

The shell should have four layers only:

1. **App rail / primary sidebar**
   Durable product areas
2. **Area navigation**
   Section-level tabs or grouped links inside the selected area
3. **Page canvas**
   The actual page content
4. **Local page actions**
   Filters, saved views, create actions, inspectors, coworker context

Anything that does not fit one of those roles should be demoted or removed.

### 6.2 Primary app rail

Recommended durable top-level areas:

- `Workspace`
- `Business`
- `Products`
- `Platform`
- `Knowledge`

`Docs` should move out of primary navigation and live under Help/Docs utility or inside `Knowledge`, unless it later grows into its own true application.

### 6.3 Area definitions

#### Workspace

Purpose: personal landing page and operational cockpit

Contains:

- pinned destinations
- recent work
- action queue
- calendar
- activity feed
- alerts

Does not contain:

- the full application map
- duplicated top-level domains

#### Business

Purpose: running the business and customer-facing operating context

Recommended area nav:

- Customer
- Finance
- People
- Compliance
- Portal

This aligns with the business setup spec's "Business Context First" direction and keeps storefront/portal configuration in a business context instead of floating between admin and setup concepts.

#### Products

Purpose: digital product lifecycle management

Recommended area nav:

- Portfolio
- Backlog
- Inventory
- Architecture
- Changes

This keeps the product-centric spec intact while demoting cross-cutting views from global top-level status.

#### Platform

Purpose: operating the platform itself

Recommended area nav:

- AI & Services
- Build Studio
- Audit
- Admin

This follows the platform services UX spec, which already wants providers, integrations, services, and operations managed as one coherent hub.

#### Knowledge

Purpose: internal knowledge, help, and documentation

Recommended area nav:

- Knowledge
- Docs

If usage stays low, this can later collapse into a utility/help surface instead of remaining a top-level app.

## 7. Section-Level Rules

### 7.1 Use tab-nav for section organization, but keep it small

Per the platform pattern, section organization should continue to use route-backed tab navigation. However, the current flat tab sets are too large. The fix is not "more tabs." The fix is regrouping.

Rule:

- Target 4-6 visible top-level section tabs
- If a section exceeds that, regroup into lifecycle or domain families
- Put deeper destinations inside the selected family page

### 7.2 Proposed regrouping

#### Product detail

Current product tabs are too many for fast scanning. Regroup into:

- Overview
- Delivery
- Operate
- Architecture
- Commercial
- Team

Example mapping:

- `Delivery`: backlog, changes, versions
- `Operate`: health, inventory
- `Commercial`: offerings
- `Team`: team and knowledge, if knowledge remains product-scoped

#### Compliance

Regroup the current flat tab list into:

- Overview
- Library
- Controls
- Assurance
- Risk
- Operations

Example mapping:

- `Library`: policies, regulations, obligations
- `Controls`: controls, evidence
- `Assurance`: audits, submissions, posture
- `Risk`: risks, incidents, gaps, actions
- `Operations`: onboarding and operational workflows

#### Admin

Regroup into:

- Organization
- Access
- Portal
- Configuration

This reduces admin wayfinding cost and better reflects user intent.

## 8. Setup Placement

The current overlay model is useful during onboarding, but it should not remain part of the everyday shell.

Recommended change:

- Keep hard redirect to `/setup` for true first run
- Run setup as a dedicated guided flow
- After shell entry, incomplete setup appears as:
  - workspace checklist card, and/or
  - global dismissible banner

Do not keep setup progress as a persistent top-of-page navigation bar across the working portal.

## 9. Workspace Changes

Workspace should become a personal dashboard, not a second menu system.

Recommended changes:

- replace the current full capability tile matrix with pinned destinations and recents
- keep calendar and activity feed as first-class content
- surface "continue setup" only as a card/checklist when relevant
- show alerts and tasks that require action

If app-launch cards remain, cap them to the user's pinned or most-used areas rather than all available areas.

## 10. Breadcrumb Rules

Use breadcrumbs only when the user is inside a drill-down hierarchy such as:

- portfolio taxonomy depth
- product detail sub-pages
- record detail pages

Do not use breadcrumbs as a substitute for area navigation or setup progress. They are secondary wayfinding only.

## 11. Implementation Sequence

### Phase 1. Shell consolidation

- Introduce left app rail / primary sidebar
- Reduce top bar to universal utilities
- Move docs out of the primary header

### Phase 2. Setup decoupling

- Remove persistent setup overlay from the working shell
- Convert incomplete setup to dedicated flow + checklist/banner

### Phase 3. Workspace refactor

- Replace full app-launch grid with pinned destinations, recents, and action items
- Keep calendar/activity as the anchor content

### Phase 4. Area regrouping

- Create `Business`, `Products`, `Platform`, and `Knowledge` area navigation
- Move current top-level items into those areas

### Phase 5. Section regrouping

- Compress `Compliance`, `Admin`, and product lifecycle flat tabs into grouped tab families

## 12. Decision

The right move is not a cosmetic cleanup of the current header.

The right move is to consolidate DPF around a best-in-class layered navigation model:

- sidebar/app rail for durable product areas
- small route-backed area tabs for section families
- local page controls for work inside a page
- workspace as personal dashboard
- setup as a dedicated guided flow, not shell chrome

This keeps the direction already present in the repo, while removing the overlap that currently makes the portal feel harder to navigate than it should.
