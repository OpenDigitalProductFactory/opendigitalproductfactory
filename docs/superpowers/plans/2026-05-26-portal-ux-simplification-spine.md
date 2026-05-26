# Portal UX Simplification Spine

| Field | Value |
| ----- | ----- |
| Status | Active working plan |
| Date | 2026-05-26 |
| Branch | `feat/portal-ux-simplification` |
| Primary anchors | [`2026-04-17-portal-navigation-consolidation-design.md`](../specs/2026-04-17-portal-navigation-consolidation-design.md), [`2026-05-20-portal-ux-audit.md`](../audits/2026-05-20-portal-ux-audit.md), [`2026-05-24-vertical-workspace-home-design.md`](../specs/2026-05-24-vertical-workspace-home-design.md), [`2026-05-16-ux-auditor-coworker-design.md`](../specs/2026-05-16-ux-auditor-coworker-design.md) |
| Live backlog anchors | `EP-WWMD-MCP`, `EP-BUILD-STUDIO-UX`, `EP-AI-OPSMAP`, `EP-REDUCTION-GEAR-ARCH` |
| Execution mode | Outside Build Studio until the Build Studio UX/runtime is reliable enough to own this work |

## 1. Decision

Use an architectural simplification spine plus small verified slices.

WWMD/principle review favored this over two weaker paths:

- Do not wait for a perfect crawl of every route before improving obvious wayfinding defects.
- Do not patch isolated bugs without preserving the navigation, audience, and archetype direction.

The platform has already moved toward five primary areas in the AppRail: Workspace, Business, Products, Platform, and Knowledge. The friction is now inside each area: mixed-grain labels, too many sibling choices, empty-state noise, schema vocabulary leaking into UI, and surfaces that ask a user to remember platform internals instead of showing the next useful action.

## 2. Current Evidence

Live crawl against the local portal on 2026-05-26 confirmed:

- `/workspace` is useful but still behaves like a mixed dashboard plus site map. It exposed 117 links and 22 buttons in the main page scrape.
- Workspace KPI tile routing has improved: AI coworkers, open work, customer accounts, finance items, incidents, and builds now route to valid primary destinations.
- The Six-C readiness matrix still links every `Context` cell to `/platform/wiki`, which is a 404. The valid knowledge destination is `/wiki`.
- `/workspace/documents` renders a search-and-empty-state page with no obvious create, upload, or connect-next action.
- `/employee` is reached from a rail item labeled People, but the page identity is Employee. This is a terminology mismatch.
- `/storefront` is reached from a rail item labeled Portal, while the project rulebook reserves `/portal` for external/customer experience and uses `/storefront` for internal management. The label needs to stop training the wrong mental model.
- `/finance` is the strongest internal pattern observed: lifecycle families, useful setup state, and compact operational sections.
- `/platform/ai` and `/platform/ai/operations-map` are high-density and expose unresolved state labels such as unassigned, governance pending, and not assigned. These may be truthful, but they are not yet grouped into operator decisions.
- `/build` still emits unknown/null-heavy states and remains a poor place to run this refactor through Build Studio.

## 3. Design Principles For This Refactor

1. Audience before system map. A founder/operator, dispatcher, clinic scheduler, retail worker, contributor, and customer should not all see the same first screen.
2. The primary shell is a memory aid, not a database menu. Navigation should group by user intent and work object.
3. Every number, status pill, and readiness cell must either drill into the objects that produced it or render as non-clickable explanatory status.
4. Empty state is a setup path, not a wall of zeros.
5. Labels should be literal to the user. Hide schema terms, internal route names, and platform jargon unless the user is in a diagnostic surface.
6. Archetype should change what the user sees first, but not by forking routes or data models. Use the vertical workspace-home substrate when it lands.
7. Theme-aware styling and restrained operational density are non-negotiable.
8. Refactoring is part of each slice. Reserve time to remove mixed concepts or duplicated patterns rather than only layering new UI over old structure.

## 4. Target Shape

### Workspace

`/workspace` becomes the first simplification target because it is both the daily landing page and the place where the new archetype direction will be felt.

Near-term:

- Keep the platform operator command center as the fallback home.
- Remove broken links and decorative status.
- Reduce recall burden by making readiness labels explain themselves in place.
- Make zero/empty states action-oriented.
- Stop using "cockpit" language on the worker-facing workspace surface, per the vertical workspace-home spec.

Medium-term:

- Resolve workspace mode: platform home vs vertical employee home.
- Add a workspace contribution resolver keyed by semantic `StorefrontArchetype.archetypeId`.
- Render archetype-native first slots for configured installs, while preserving platform home as authorized fallback.

### Business

Business area should carry customer, people, finance, compliance, and storefront management with consistent lifecycle navigation.

First cleanups:

- Align People vs Employee naming.
- Rename internal storefront management away from Portal, or make the label explicitly "Storefront".
- Use the Finance nav family pattern as the baseline for Customer, People, and Compliance.
- Replace repeated empty-state blocks with one orchestrating setup state per page.

### Products

Products should focus on product/portfolio/backlog/change work, not become a second operational command center.

First cleanups:

- Preserve Portfolio, Backlog, Architecture, and Changes as work-object families.
- Audit high-density backlog pages for filter affordance, saved views, and "next action" grouping before changing route structure.

### Platform

Platform is for AI workforce, tools, governance, Build Studio, and admin surfaces. It should be powerful but not the default mental model for every user.

First cleanups:

- Split AI Operations into operator questions: who is working, what is blocked, what needs approval, what lacks capability, and what changed.
- Treat Build Studio UX work as a separate stream until its runtime is stable.
- Replace null/unknown literal rendering with intentional "not yet run" or absent states.

### Knowledge

Knowledge is the canonical destination for docs, wiki, and articles.

First cleanups:

- Route all wiki/context links to `/wiki` unless a more specific knowledge object exists.
- Avoid duplicate entry points that imply `/platform/wiki` is real.

## 5. Execution Slices

### Slice 1: Workspace link hygiene and readiness affordance

Scope:

- Fix Six-C `Context` links from `/platform/wiki` to `/wiki`.
- Add regression coverage so workspace readiness links cannot point at the invalid route again.
- Add lightweight title copy to readiness cells so "Context", "Connections", and related labels are interpretable without leaving the page.
- Keep styling token-based.

Verification:

- Run the affected workspace command-center tests.
- Exercise `/workspace` in the browser and confirm Context cells route to `/wiki`, not `/platform/wiki`.

### Slice 2: Workspace first-view simplification

Scope:

- Reduce the first viewport to command strip, core signals, readiness, and work in motion.
- Move lower-frequency launch tiles below the first decision surface or behind a clearer grouped launcher.
- Replace any repeated generic explanation with a compact help/info affordance.

Verification:

- Browser screenshots at desktop and narrow widths.
- Link-count reduction from the current `/workspace` baseline.

### Slice 3: Business terminology alignment

Scope:

- Align People/Employee naming.
- Align Portal/Storefront naming with the rulebook.
- Audit route headings, rail labels, tab labels, and breadcrumbs for mismatches.

Verification:

- Unit coverage for nav constants where practical.
- Browser crawl over Business routes.

### Slice 4: Empty-state orchestration

Scope:

- Start with Documents and Compliance.
- Replace repeated "no data" blocks with a single setup/connection decision per page section.
- Add create/connect/import actions only where the underlying route exists.

Verification:

- Browser crawl of fresh-install empty states.
- No dead CTAs.

### Slice 5: Platform AI operator grouping

Scope:

- Group AI Operations by operator question rather than raw assignment/provider/governance records.
- Preserve dense diagnostics behind drill-ins.
- Align with the UX auditor coworker spec so AGT-906 can later turn these into executable invariants.

Verification:

- Browser crawl of `/platform/ai` and `/platform/ai/operations-map`.
- Evidence that unassigned/governance-pending counts lead to filtered detail.

### Slice 6: Build Studio UX recovery

Scope:

- Continue under `EP-BUILD-STUDIO-UX`, not as part of the shell simplification branch unless a dependency is unavoidable.
- Fix unknown/null rendering and streaming output boundaries before asking Build Studio to run UX refactors.

Verification:

- Build Studio route exercise against the live portal.
- Production build once runtime changes are in scope.

## 6. Working Rules For This Thread

- Use live portal evidence before changing IA.
- Use docs/specs as anchors, but keep current runtime truth separate from future-state design.
- Prefer small PR-sized slices.
- Use MCP/backlog state before filing new work.
- Keep refactoring inside each slice rather than accumulating cleanup debt.
- Do not route this through Build Studio until Build Studio can produce reliable UX verification evidence.
