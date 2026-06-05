# Portal Navigation And Archetype IA Design

| Field | Value |
| --- | --- |
| Status | Draft audit - ready for founder/architect review |
| Date | 2026-06-05 |
| Owner | Mark Bodman |
| Author | Codex |
| Scope | Internal portal navigation, route hierarchy, human task discovery, archetype-aware workspace entry, consolidation/refactor plan |
| Out of scope | Implementing code changes in this pass, deleting routes, changing permissions, changing external customer `/portal` authentication behavior |
| Primary epic alignment | `EP-REDUCTION-GEAR-ARCH` for archetype-aware workspace and primitive reuse |
| Related backlog | `BI-CD6EE9D8`, `BI-FE002675`, `BI-5B8FE5C1`, `BI-89C19AAF`, `BI-1CCC6264`, `BI-3E8D2CF5`, `BI-CE6AF925`, `BI-FS-001`, `BI-ARCH-4C1E90` |
| Anchor specs/docs | `docs/superpowers/specs/2026-05-24-vertical-workspace-home-design.md`, `docs/superpowers/specs/2026-05-31-archetype-aware-workspace-design.md`, `docs/superpowers/plans/2026-05-31-archetype-aware-workspace.md`, `docs/user-guide/market-archetypes.md`, `docs/user-guide/storefront/index.md` |

## Executive Verdict

DPF has the right ingredients for a scalable portal: a global shell, domain tabs, role permissions, archetype records, workspace-home contributions, and redirect shims for legacy routes. The current human experience still feels hard to use because these pieces are arranged as platform modules first and jobs-to-be-done second.

The visible result is a portal where one admin user sees 17 global rail destinations, many pages repeat the same sibling links as tabs and cards, and `/workspace` acts as a cross-domain launchpad instead of the archetype-specific daily work surface described in the docs. This is not a single broken component. It is an information architecture problem.

The recommended direction is:

1. Keep the current global shell but make it role- and mode-aware.
2. Make `/workspace` the default archetype worker home when an active archetype has a contribution; keep the platform home as an explicit operator mode.
3. Consolidate top-level navigation around durable user jobs, not implementation packages.
4. Convert cross-domain shortcuts into contextual actions and health drill-downs.
5. Move legacy Admin, Storefront, Finance setup, Platform runtime, and Build Studio configuration overlaps into a single route ownership model.
6. Reserve 20% of implementation capacity for refactoring the navigation substrate, matching the workspace-home standards.

## Evidence Gathered

### Live Runtime Sample

Live portal evidence was collected on the canonical install at `http://localhost:3000` after logging in as `admin@dpf.local`.

Observed pages:

- `/workspace`
- `/storefront`
- `/storefront/settings`
- `/customer`
- `/customer/marketing`
- `/finance`
- `/compliance`
- `/ops`
- `/platform`
- `/platform/ai`
- `/platform/tools`
- `/platform/audit`
- `/admin`
- `/build`

Key live observations:

- `/workspace` shows a 17-link primary AppRail: Workspace, Documents, Customer, People, Finance, Compliance, Portal, Portfolio, Backlog, Architecture, AI Workforce, Build Studio, Platform Hub, Admin, Knowledge, Wiki, Docs.
- `/workspace` main content exposed 118 links in the sampled DOM. Many links drill across domains from a health/status matrix: `Connections -> /platform/tools/integrations`, `Capabilities -> /platform/ai`, `Containment -> /platform/ai/authority`, `Context -> /wiki`.
- `/workspace` shows "Workspace home is using the standard view" and sends users to `/storefront` with "Review business setup", even though the setup purpose is worker-home activation.
- The shell header still says "Internal cockpit", which conflicts with the reserved cockpit language in the vertical workspace-home spec.
- `/storefront/settings` shows two stacked navigation layers: the storefront tab row and a settings sub-row. The model is understandable, but the parent label "Portal" is ambiguous because `/portal` is the external customer account surface.
- `/customer/marketing` has customer tabs plus marketing tabs, then includes a literal platform integration path link (`/platform/tools/integrations/email-postmark`) inside a business workflow.
- `/platform`, `/platform/tools`, `/platform/audit`, and `/platform/ai` repeat Platform family tabs and then render cards that link to the same families again.
- `/platform` includes "Core Admin" as a Platform family, while `/admin` has its own Admin family navigation. This creates a cross-context jump disguised as a sibling tab.
- `/finance` exposes setup, overview, family tabs, hub cards, and many sublinks in one screen. It is useful for an accountant, but it is too large to be a first-touch generic Business nav item.
- `/ops` is labeled "Backlog" in the global rail, but the page title is "Operations" and the section tabs include Backlog, Improvements, Changes, Promotions, Self-upgrade, and Dev Loop.
- `/build` preserves the global rail while presenting its own work-control surface and live preview link to `localhost:3035`. This is correct for platform contributors, but a customer-operator should not need to reason about the preview substrate from primary nav.

### Source Evidence

Current navigation and route ownership are mostly code-owned:

- `apps/web/lib/govern/permissions.ts` defines `SHELL_ITEMS` and `SHELL_SECTIONS`, including 17 global rail entries for a superuser.
- `apps/web/components/shell/AppRail.tsx` renders every permitted shell item as a persistent primary rail.
- `apps/web/components/platform/platform-nav.ts` defines Platform families and includes `Core Admin -> /admin` as a Platform peer.
- `apps/web/components/platform/PlatformTabNav.tsx` renders Platform family tabs and active-family subitems.
- `apps/web/app/(shell)/platform/ai/layout.tsx`, `platform/tools/layout.tsx`, `platform/audit/layout.tsx`, and `platform/identity/layout.tsx` each inject `PlatformTabNav`, while `apps/web/app/(shell)/platform/page.tsx` imports it manually.
- `apps/web/components/storefront-admin/StorefrontAdminTabNav.tsx` renders Dashboard, Sections, Items, Team, Inbox, Settings.
- `apps/web/components/storefront-admin/StorefrontSettingsNav.tsx` renders Portal, Your Business, Operating Hours inside Settings.
- `apps/web/components/finance/finance-nav.ts` defines five Finance families and many subitems.
- `apps/web/components/compliance/ComplianceTabNav.tsx` defines Compliance families and subitems inline rather than in a shared nav model.
- `apps/web/components/ops/OpsTabNav.tsx` labels `/ops` as Backlog even though the route title is Operations.
- Redirect shims exist for legacy and migrated routes, including `/admin/storefront -> /storefront`, `/admin/business-context -> /storefront/settings/business`, `/admin/operating-hours -> /storefront/settings/operations`, `/admin/backlog -> /ops`, `/admin/prompts -> /platform/ai/prompts`, `/admin/skills -> /platform/ai/skills`, `/platform/integrations -> /platform/tools/catalog`, `/platform/services -> /platform/tools/services`, `/platform/ai/routing -> /platform/ai/providers`, and `/platform/ai/history -> /platform/audit/ledger`.

### Backlog And Spec Evidence

Live MCP backlog review found relevant existing work rather than a need for a brand-new epic:

- `EP-REDUCTION-GEAR-ARCH` is open and owns the workspace-home substrate direction.
- `BI-CD6EE9D8` tracks Slice 1: canonical navigation inventory under `EP-REDUCTION-GEAR-ARCH`.
- `BI-FE002675` is the MSP workspace-home research/design item.
- `BI-5B8FE5C1` is the vertical workspace primitive library item.
- `BI-89C19AAF` is the vertical workspace home design item.
- `BI-1CCC6264`, `BI-3E8D2CF5`, and `BI-CE6AF925` are the shared workspace resolver/projection/HVAC follow-ons named by existing specs.
- `EP-TRADES-FIELD-SERVICE` and `BI-FS-001` cover field-service/HVAC archetype work.

MCP `search_specs_and_plans` did not find an existing broad portal-navigation IA spec for "navigation portal storefront archetype business setup information architecture." Existing workspace-home specs cover `/workspace`, but not the whole portal navigation consolidation.

### External Standards

This audit follows these external UX standards and benchmarks:

- Material Design: navigation drawers are appropriate for apps with five or more top-level destinations, two or more hierarchy levels, or unrelated destinations. It also cautions against competing primary navigation components. Source: [Material Design Navigation Drawer](https://m2.material.io/components/navigation-drawer).
- NN/g menu design checklist: use clear, familiar labels; avoid internal jargon; communicate current location; provide local navigation for closely related content. Source: [NN/g Menu Design Checklist PDF](https://media.nngroup.com/media/articles/attachments/PDF_Menu-Design-Checklist.pdf).
- GOV.UK service design: map the user's whole problem and design around the journey from the user's perspective. Source: [GOV.UK Map a User's Whole Problem](https://www.gov.uk/service-manual/design/map-a-users-whole-problem).
- GOV.UK service standard: make services simple to use so users can complete the thing they came to do with minimal help. Source: [GOV.UK Service Standard Point 4](https://www.gov.uk/service-manual/service-standard/point-4-make-the-service-simple-to-use/).

## Current-State Map

### Global Shell Today

The AppRail is grouped as:

| Group | Entries |
| --- | --- |
| Workspace | Workspace, Documents |
| Business | Customer, People, Finance, Compliance, Portal |
| Products | Portfolio, Backlog, Architecture |
| Platform | AI Workforce, Build Studio, Platform Hub, Admin |
| Knowledge | Knowledge, Wiki, Docs |

This is a reasonable superuser map for a platform operator. It is not the right default mental model for a clinic scheduler, HVAC dispatcher, MSP service coordinator, retail merchandiser, or restaurant manager.

### Section Navigation Today

| Section | Current navigation model | Issue |
| --- | --- | --- |
| Workspace | No local section nav; command center links everywhere | Cross-domain launchpad, not an archetype work home |
| Storefront | Dashboard, Sections, Items, Team, Inbox, Settings; Settings subnav | Useful, but "Portal" label collides with external `/portal` |
| Customer | Accounts, Engagements, Pipeline, Quotes, Orders, Funnel, Marketing; Marketing has Overview/Strategy | Good sibling model, but marketing also points to platform integrations |
| Finance | Overview, Revenue, Spend, Close, Configuration with many subitems | Strong internal model, but too broad for primary global discovery |
| Compliance | Overview, Licensing, Library, Controls, Assurance, Risk, Operations | Good family model, but "Operations" inside Compliance competes with `/ops` |
| Ops | Backlog, Improvements, Changes, Promotions, Self-upgrade, Dev Loop | Mixed backlog, release, runtime, and contributor workflow |
| Platform | Overview, Identity, AI, Tools, Audit, Core Admin | Crosses into Admin as if Admin is a Platform sibling |
| Admin | Access, Organization, Configuration, Advanced | Still contains surfaces that have moved into Platform or Storefront |
| Build | Custom work-control surface | Correct as a specialized workspace, but too prominent for every business operator |

### Route Ownership Problems

The current route set has three kinds of overlap:

1. **Legacy route overlap:** old Admin routes redirect into Storefront, Ops, Platform AI, and Platform Audit.
2. **Concept overlap:** Storefront setup, Business Context, Finance setup, and archetype setup all describe business shape from different places.
3. **Control-plane overlap:** Platform AI, Audit, Admin Advanced, Build Studio, Ops Dev Loop, and Platform Development all expose pieces of the same contributor/runtime control plane.

## Severity-Ranked Findings

### Critical: Default Navigation Is Platform-Module First, Not Archetype-Work First

The docs say the archetype should shape the customer portal, worker home, coworker emphasis, vocabulary, marketing posture, and contribution applicability. The live global rail still leads with modules. A business operator must translate "Platform Hub", "AI Workforce", "Backlog", "Architecture", and "Portal" into their work.

This violates the market-archetype premise. It also weakens the workspace-home specs because the user can be dropped into an archetype-aware `/workspace` while the surrounding chrome still shouts "platform".

Required direction: `/workspace` resolves the active archetype and its worker-mode navigation. Platform/operator surfaces remain available through an explicit operator switch for authorized users.

### Critical: The Workspace Is A Cross-Domain Launchpad Instead Of A Job Home

The sampled `/workspace` had 118 main links. The command center is useful for platform operations but overloads worker discovery. It links status matrix cells into Wiki, Platform Tools, AI, Authority, Ops, Customer, Finance, Compliance, and Build.

Required direction: worker homes should show the top operating question for the selected archetype. Cross-domain status drilldowns remain available only in platform-operator mode or diagnostic panels.

### High: Global, Section, Local, And Action Navigation Are Blended

Cards and table cells often behave like navigation. Some are legitimate shortcuts; others are status facts that become cross-domain jumps. This makes it unclear whether a user is selecting a sibling page, drilling into a fact, taking an action, or leaving the current work context.

Required direction: each layer gets one job:

- Global rail: durable product/work domains.
- Section tabs: siblings inside one domain.
- Local nav: filters, views, anchors, drawers, or drill-down controls inside one page.
- Contextual actions: create, configure, send, review, open live preview.

### High: Platform And Admin Boundaries Are Blurred

`/platform` lists "Core Admin" as a family tab that links to `/admin`, while `/admin` has its own tab family. Legacy redirects also move Admin pages into Storefront and Platform AI. The result is not wrong technically, but it feels like a nav jump rather than a sibling section.

Required direction: "Admin" should either be a Platform settings family or a separate global operator area, not both. If kept separate, Platform pages should link to Admin as a contextual configuration action, not a Platform family tab.

### High: Setup Is Split Across Storefront, Business, Finance, And Admin

The `/workspace` setup notice points to `/storefront`. Storefront Settings includes "Your Business" and "Operating Hours." Finance has its own setup profile derived from the storefront archetype. Admin Business Context redirects into Storefront settings.

The domain model split is correct: `BusinessContext`, `StorefrontArchetype`, `StorefrontConfig`, and `BusinessModel` are distinct. The UX journey is fragmented.

Required direction: one "Business Setup" journey owns archetype activation, public portal shape, internal workspace activation, finance profile, operating hours, and setup gaps. Domain settings remain as lightweight return/edit surfaces.

### High: Naming Collides Across Audiences

The word "Portal" currently means at least three things:

- `/storefront`: internal admin for the customer-facing public experience.
- `/portal`: external customer account area.
- "Live portal": production-served runtime from topology docs.

The shell header says "Internal cockpit", while workspace-home specs reserve "cockpit" for a platform diagnostic concept.

Required direction:

- Rename internal `/storefront` visible label to "Customer Portal" or "Public Portal".
- Keep `/portal` copy as "Customer Account" or "Customer Portal sign-in".
- Keep runtime docs using "Live portal".
- Replace "Internal cockpit" in the shell header with "Work hub", "Workspace", or archetype-specific worker-home labels.

### Medium: Section Nav Implementation Is Inconsistent

Platform section nav is layout-based for nested areas and manually imported on `/platform`. Finance nav is manually imported into many pages. Compliance nav is layout-based. Admin nav is manually imported into pages. Storefront nav is layout-based.

Required direction: each route family should have one layout-level nav injection. Manual per-page nav imports should be retired except for specialized embedded workflows.

### Medium: Detail Routes Need Breadcrumb Discipline

Many detail routes have local back links, which is good. The global rail still remains fully visible, so a detail page can feel like it is at the same hierarchy depth as a global domain. This matters most for compliance records, finance records, agent details, product details, and Build Studio work capsules.

Required direction: detail pages use breadcrumbs for depth and keep only the parent section active. They should not introduce new global entry points.

### Medium: Build Studio Is Both A Global Domain And A Platform AI Configuration Area

Build Studio appears globally as `/build`, while Build Runtime configuration appears under `/platform/ai/build-studio`. That split is defensible, but the labels must stay clear:

- Build Studio: the work surface for creating/reviewing builds.
- Build Runtime settings: configuration of providers, gates, and runtime policy.

Required direction: keep `/build` global only for users whose work involves platform development. For business operators, Build Studio is a contextual "request improvement" path from the archetype workspace, not a primary rail item.

## Target-State Navigation Model

### Operating Modes

The portal needs two primary internal modes:

| Mode | Audience | Default for | Navigation emphasis |
| --- | --- | --- | --- |
| Worker mode | Business users doing daily work | Any install with an active archetype contribution | Archetype work board, customer work, schedule/queue, money, team, portal, coworker handoffs |
| Platform operator mode | Superusers, contributors, platform admins | Authorized operators and unconfigured installs | Build, AI workforce, runtime, tools, audit, admin, docs |

Mode is not only role. A founder/admin in an HVAC install should be able to switch between "Dispatcher home" and "Platform home". Ordinary workers should default to the archetype home and not see platform-heavy chrome.

### Proposed Global Rail

For worker mode:

| Group | Entries | Notes |
| --- | --- | --- |
| Work | Home, My Queue | Home is archetype-resolved; My Queue is personal/coworker handoff work |
| Business | Customers, Money, Team | Labels adapt by archetype where useful |
| Operations | Schedule/Jobs/Orders/Inventory | Contribution chooses 2-4 visible destinations |
| Growth | Public Portal, Marketing | Only when relevant to role/archetype |
| Support | Knowledge, Help | Docs/Wiki hidden from non-technical workers unless relevant |

For platform operator mode:

| Group | Entries | Notes |
| --- | --- | --- |
| Work | Workspace, Documents | Platform fallback home |
| Delivery | Backlog, Build Studio, Promotions | Consolidates `/ops` and `/build` mental model |
| Platform | AI Workforce, Tools, Runtime, Audit | Runtime includes self-upgrade/dev-loop concepts |
| Business Admin | Customer Portal, Finance, Compliance, People | Operational domains still available |
| Admin | Access, Organization, Configuration | Not duplicated as a Platform family tab |
| Knowledge | Knowledge, Wiki, Docs | Contributor/operator docs |

The current superuser rail can remain during transition, but the product direction is mode-resolved primary navigation.

### Section Navigation Rules

1. A section tab row may only list sibling pages under the same route family.
2. A tab row may not link to a different global domain. Example: Platform tabs should not include `/admin`.
3. If a card opens a sibling page, it can be a shortcut but should not duplicate every tab.
4. If a card starts work, use a button/action label rather than making the whole card a nav item.
5. If a status cell drills into diagnostics, keep it in platform-operator mode or make it an explicit "Inspect" action.
6. Settings/configuration should live under the domain they configure, but first-run setup should remain one guided Business Setup journey.
7. Detail pages use breadcrumbs and parent section active state; they are not global destinations.

## Archetype Navigation Objectives

Navigation should be generated from the same archetype activation profile that shapes the workspace home. The active `StorefrontConfig -> StorefrontArchetype` determines the worker-mode global entries and their vocabulary.

### MSP / IT Managed Services

Market objective: keep client environments healthy, renew agreements, resolve tickets, manage assets, and protect margin.

Primary worker nav:

- Service Desk
- Customers / Sites
- Assets
- Agreements
- Service Health
- Money
- Customer Portal

Consolidation implications:

- Customer sites and managed assets should not be buried under generic Customer or Inventory.
- Tools/integrations that matter to service health should surface as setup gaps or health-board drilldowns, not primary Platform nav.
- Licensing/compliance should appear as a client/service readiness concern when it blocks service delivery.

### Field Service / HVAC / Trades

Market objective: dispatch jobs, manage technician load, prevent missed customer updates, and keep truck/part readiness visible.

Primary worker nav:

- Dispatch
- Jobs
- Customers / Sites
- Schedule
- Inventory / Trucks
- Money
- Customer Portal

Consolidation implications:

- `/workspace` should lead with today's dispatch board, not platform command center.
- Storefront inquiries, jobs, schedule, notifications, and inventory should be one flow.
- Finance setup matters as invoice/payment defaults, not as a separate first-touch domain.

### Healthcare / Wellness Clinic

Market objective: keep appointments ready, forms complete, practitioners balanced, and patient follow-ups reliable.

Primary worker nav:

- Schedule
- Patients
- Readiness
- Follow-ups
- Billing
- Compliance
- Customer Portal

Consolidation implications:

- Compliance and customer communication need to be contextual to appointment readiness.
- Marketing should not be first-touch unless the role is owner/growth.

### Retail / Goods

Market objective: keep orders moving, stock visible, returns handled, and demand signals actionable.

Primary worker nav:

- Orders
- Stock
- Customers
- Receiving
- Returns
- Marketing
- Money

Consolidation implications:

- Inventory, customer, and finance are not separate mental worlds for a merchandiser.
- Marketing belongs to growth/demand and should reuse customer data without jumping to platform integrations.

### Software Platform

Market objective: ship product improvements, support customers, monitor runtime health, and manage subscription/revenue signals.

Primary worker nav:

- Build / Delivery
- Customers
- Support
- Runtime Health
- Revenue
- AI Coworkers
- Knowledge

Consolidation implications:

- This archetype legitimately sees more platform/contributor surfaces.
- It still needs a clear distinction between "run my software business" and "administer DPF internals".

## Consolidation Opportunities

### Business Setup Spine

Consolidate:

- `/storefront/setup`
- `/storefront/settings/business`
- `/storefront/settings/operations`
- `/finance/settings/setup`
- legacy `/admin/business-context`
- legacy `/admin/operating-hours`
- workspace-home activation summaries

Target: one Business Setup journey with domain-specific edit surfaces after completion.

### Customer Growth Surface

Consolidate:

- `/customer`
- `/customer/marketing`
- `/storefront/inbox`
- public portal setup gaps
- marketing integrations setup prompts

Target: Customer/Growth flows stay in business context. Platform integration pages remain setup/configuration destinations behind explicit actions.

### Delivery And Change Operations

Consolidate:

- `/ops` backlog
- `/ops/improvements`
- `/ops/changes`
- `/ops/promotions`
- `/build`
- `/platform/audit/operations`
- `/ops/dev-loop`
- `/ops/self-upgrade`

Target: separate "Delivery" from "Runtime Operations". Backlog and Build Studio are delivery; self-upgrade/dev-loop/runtime targets are platform runtime operations.

### Platform Control Plane

Consolidate:

- `/platform/ai`
- `/platform/tools`
- `/platform/audit`
- `/admin/platform-development`
- `/admin/diagnostics`
- `/admin/backups`
- `/platform/edge-nodes`

Target: Platform owns AI workforce, tools/services, runtime, audit, and diagnostics. Admin owns access/org/configuration.

### Finance And Compliance Setup

Consolidate:

- Finance setup profile derived from archetype
- Compliance licensing/onboard setup
- Business archetype activation

Target: domain pages show setup gaps, but setup decisions flow through Business Setup and carry archetype context.

## Migration Plan

### Phase 0 - Route And Nav Inventory Gate

Create a code-owned route/nav inventory and test that every visible route has:

- one parent domain
- one section family if applicable
- one audience mode (`worker`, `operator`, `customer`, or `diagnostic`)
- one destination kind (`domain-home`, `section-page`, `detail`, `workflow-step`, `settings`, `contextual-action`, `legacy-redirect`)

This phase is read-mostly and should not change user-facing navigation except test-safe metadata.

### Phase 1 - Low-Risk Naming And Context Fixes

Make the easiest changes that reduce confusion without changing route behavior:

- Replace shell "Internal cockpit" copy with "Workspace" or mode-aware text.
- Rename visible `/storefront` global label from "Portal" to "Customer Portal" or "Public Portal".
- Change `/workspace` setup CTA from `/storefront` to the correct setup/business path.
- Remove `/admin` from Platform family tabs; represent it as an admin/configuration action instead.
- Rename `/ops` global label from "Backlog" to "Delivery" or split backlog from runtime operations.
- Replace literal path links in business workflows with human action labels.
- Add tests that legacy redirects still work.

### Phase 2 - Centralize Section Navigation

Refactor section nav into one canonical model:

- Move Finance nav injection to a layout or shared family shell.
- Move Admin nav injection to layout-level.
- Keep Platform nav layout-level across Platform families.
- Move Compliance family definitions into a shared model, matching Finance/Platform patterns.
- Remove duplicated tab/card link sets where cards only mirror tabs.

This is the first meaningful refactor slice.

### Phase 3 - Archetype Worker Navigation

Extend workspace-home resolution to return a `WorkspaceShellContext`:

- `mode`
- `primaryLabel`
- `subtitle`
- `navGroups`
- `showOperatorSwitch`
- `setupGaps`

The global AppRail consumes this context when `/workspace` resolves a vertical contribution. The platform rail remains for operator mode and unconfigured fallback.

### Phase 4 - Consolidate Setup

Create the Business Setup spine:

- archetype selection
- public portal activation
- worker-home activation summary
- finance defaults
- operating hours
- customer/contact baseline
- required integrations/setup gaps

Domain settings pages become return/edit surfaces. They should not each restart the same setup concept.

### Phase 5 - Route Retirement And Redirect Review

After Phase 1-4 settle, classify all redirects:

- keep permanent compatibility redirects
- keep temporary redirects with removal release
- remove dead internal links
- add telemetry for redirects that still receive traffic

Do not delete routes until telemetry shows the link is not used or the redirect has a documented replacement.

## Refactoring Allocation

At least 20% of implementation capacity should be reserved for refactoring. For this effort, refactoring is not polish; it is the main debt reducer.

Required refactor targets:

1. A typed navigation model that owns global, section, and local route metadata.
2. Layout-level section nav injection for Finance, Admin, Platform, Compliance, Storefront, Customer, and Ops/Delivery.
3. Worker-mode AppRail context returned by workspace-home resolution.
4. A redirect inventory test so legacy routes stay intentional.
5. Common nav primitives with consistent theme-aware styling.
6. Removal of manually duplicated tab rows where route layouts can own them.

## Acceptance Criteria

- Every major page has exactly one primary home in the route/nav inventory.
- The primary rail has an operator mode and a worker/archetype mode.
- `/workspace` no longer defaults every configured business to a platform command center.
- Storefront/Public Portal/Customer Account/Live Portal terminology is separated.
- Platform and Admin are no longer sibling tabs inside one Platform family unless Admin is formally absorbed into Platform settings.
- Business setup is one journey with domain edit surfaces, not several competing setup paths.
- Section tabs list only sibling routes.
- Cross-domain actions are labeled as actions, not ambiguous nav siblings.
- Existing legacy redirects are tested and classified.
- UI uses DPF theme tokens and existing nav visual patterns.
- Live portal UX verification covers desktop and mobile for at least one configured archetype and one platform-operator fallback.

## Open Decisions

1. Should the first worker-mode nav prove with MSP or HVAC? Recommendation: MSP if the current install remains `software-platform`/DPF customer-zero; HVAC if `BI-FS-001` lands first and Dale replay is the acceptance path.
2. Should `/ops` become "Delivery" globally, with runtime operations moved into Platform Runtime? Recommendation: yes, but only after redirect and backlog telemetry are captured.
3. Should Admin be absorbed into Platform Settings or remain a separate global operator domain? Recommendation: keep Admin separate for now; remove it from Platform family tabs.
4. Should Marketing remain under Customer or move to Growth? Recommendation: keep route under Customer initially, but label the user-facing family as Growth/Customer Growth where archetypes need it.
5. Should `/storefront` route be renamed technically? Recommendation: no in this effort. Change visible label first; technical route rename has too much migration risk for too little gain.
