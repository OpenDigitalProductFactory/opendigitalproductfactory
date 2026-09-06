---
status: active
---

# Portal UX Simplification Spine

| Field | Value |
| ----- | ----- |
| Status | Active working plan + circulation packet |
| Date | 2026-05-26; refreshed 2026-09-06 |
| Branch | Historical: `feat/portal-ux-simplification`; closeout packet: `doc/ux-thread-outcomes-closure` |
| Primary anchors | [`2026-04-17-portal-navigation-consolidation-design.md`](../specs/2026-04-17-portal-navigation-consolidation-design.md), [`2026-05-20-portal-ux-audit.md`](../audits/2026-05-20-portal-ux-audit.md), [`2026-05-24-vertical-workspace-home-design.md`](../specs/2026-05-24-vertical-workspace-home-design.md), [`2026-05-16-ux-auditor-coworker-design.md`](../specs/2026-05-16-ux-auditor-coworker-design.md), [`2026-05-26-pipedrive-crm-marketing-ux-fit-review.md`](../audits/2026-05-26-pipedrive-crm-marketing-ux-fit-review.md), [`2026-09-06-portal-ux-simplification-thread-audit.md`](../audits/2026-09-06-portal-ux-simplification-thread-audit.md), [`2026-09-06-portal-ux-simplification-execution-plan.md`](2026-09-06-portal-ux-simplification-execution-plan.md) |
| Live backlog anchors | `EP-4FF5273F`, `BI-436A9466` (closeout packet), `BI-5A1A3C13` (delegate substrate), `BI-971D6F22` (Workspace first viewport), `BI-36A2CF08` (Workspace coworker trust), `BI-1F0B4184` (Business terminology), `BI-CEB3FDF8` (empty states), `BI-FFCE0D22` (Platform AI source truth), `BI-D8E00326` (CRM marketing follow-on), `EP-WWMD-MCP`, `EP-BUILD-STUDIO-UX`, `EP-AI-OPSMAP`, `EP-REDUCTION-GEAR-ARCH` |
| Execution mode | Outside Build Studio until the Build Studio UX/runtime is reliable enough to own this work |

## Review Packet For Circulation

Use this document as the single review packet for the cross-functional audit pass. Reviewers should comment on factual accuracy, user/persona fit, sequencing, and missing risk. They should not bikeshed visual style in the abstract; every comment should name the route, persona, user harm, and evidence needed.

### Review goals

1. Confirm that the finding register in §2.2 captures the important UX failures without overstating current runtime truth.
2. Confirm the persona acceptance gates in §4: are these the right users, and is any critical persona missing?
3. Confirm the execution order in §6: should any slice move earlier because it blocks trust or discovery?
4. Identify any finding that should be deliberately rejected or deferred, with the reason.
5. Identify the smallest evidence set needed for each slice to be merge-ready.
6. Confirm the UX feature-fit gate is strict enough to stop new feature work from adding another dashboard, tab row, or component family without a clear home.

### Reviewer lanes

| Lane | Reviewer lens | What to check |
| ---- | ------------- | ------------- |
| Founder/operator | Daily control and confidence | Does `/workspace` answer "what needs attention now?" without requiring platform memory? |
| Dispatcher / scheduler | Time-pressure worker flow | Does the vertical workspace direction match job/appointment/exception reality? |
| Retail / service worker | Narrow-task workstation flow | Does the plan avoid burying common actions behind admin/platform concepts? |
| External customer | Customer-native experience | Are `/portal`, `/s/[slug]`, and internal `/storefront` clearly separated? |
| AI operations | Coworker trust and governance | Do the source-truth and provider-fallback slices address the real trust failure? |
| Build Studio | Build/runtime UX | Is Build Studio correctly kept separate until runtime and transcript evidence are reliable? |
| Compliance / audit | Evidence and control clarity | Can each important finding be traced to an evidence item, backlog item, or explicit non-action? |
| Finance / operations | Operational empty states | Do zero-state and setup paths help real operators act instead of reading empty dashboards? |
| Architecture / data | Source of truth and substrate | Does the plan avoid route forks, duplicate models, and presentation-only fixes over data seams? |
| Accessibility / QA | Navigation and visual robustness | Are keyboard route recovery, mobile layout, no-overlap, and failure-mode checks explicit enough? |
| Incoming feature owners | Fit against portal architecture | Does each new feature plan name its owning area, persona, route family, nav layer, component reuse path, empty state, and verification evidence? |

### Feedback format

Ask reviewers to comment in this shape:

```text
Finding or slice:
Persona:
Route(s):
Concern:
Evidence needed:
Recommendation: accept / change / defer / reject
```

## Status Notes

- 2026-09-06 closeout: the current circulatable audit is now [`2026-09-06-portal-ux-simplification-thread-audit.md`](../audits/2026-09-06-portal-ux-simplification-thread-audit.md), and the executable queue is now [`2026-09-06-portal-ux-simplification-execution-plan.md`](2026-09-06-portal-ux-simplification-execution-plan.md).
- 2026-09-06 source inventory: `origin/main` contains 367 page routes and 652 page/API route files. The route-budget baseline covers 205 measured routes. This confirms the simplification problem is now one of recall, routing, and first-use legibility rather than merely a few broken links.
- 2026-09-06 delivery split: PR #5091 merged the `delegate` interaction-shape substrate into source at `874fc01f1e47b0e0e675868a5f338564bfb8416c`, but live served verification still needs self-upgrade/readiness evidence before the outcome is called delivered into the platform.
- 2026-09-06 backlog split: the open human-facing work now has explicit follow-up items: `BI-971D6F22`, `BI-36A2CF08`, `BI-1F0B4184`, `BI-CEB3FDF8`, and `BI-FFCE0D22`.
- The manual audit intake epic was live-verified through DB fallback on 2026-05-26 because MCP transport was unavailable in this session. The epic exists as `open` with zero items. That makes it a valid intake anchor, but accepted findings still need backlog materialization.
- Slice 1 has already landed branch work for the Six-C Context route, readiness affordance, and KPI route regression coverage. The plan below keeps the full Slice 1 scope because 404 recovery still needs to be tightened.
- Treat the 2026-05-20 audit as the baseline evidence, and the `feat/portal-ux-simplification` branch as current in-flight remediation. Do not rewrite baseline findings as if they are current after a slice has fixed them; add status notes instead.
- The Pipedrive CRM Marketing Slice 1 plan was reviewed against this spine on 2026-05-26. It fits as a Business > Customer enhancement if it stays inside Customer IA, removes phase-placeholder tabs, converges component patterns, and avoids surprise coworker actions. See the fit review linked in the anchor table.

## 1. Decision

Use an architectural simplification spine plus small verified slices.

WWMD/principle review favored this over two weaker paths:

- Do not wait for a perfect crawl of every route before improving obvious wayfinding defects.
- Do not patch isolated bugs without preserving the navigation, audience, and archetype direction.

The platform has already moved toward five primary areas in the AppRail: Workspace, Business, Products, Platform, and Knowledge. The friction is now inside each area: mixed-grain labels, too many sibling choices, empty-state noise, schema vocabulary leaking into UI, and surfaces that ask a user to remember platform internals instead of showing the next useful action.

## 2. Current Evidence

The latest manual UX audit (`2026-05-20-portal-ux-audit.md`) plus follow-on local crawl evidence establish the working baseline:

- `/workspace` is useful but still behaves like a mixed dashboard plus site map. It exposed 117 links and 22 buttons in the main page scrape.
- Workspace KPI tile routing is a must-reverify area, not a closed issue. The latest audit observed `OPEN WORK` routing to `/work/backlog` and `CUSTOMER ACCOUNTS` routing to `/customers`, both 404s. If a later crawl shows this repaired, the slice still needs regression coverage so KPI routes cannot drift back.
- Baseline finding: the Six-C readiness matrix linked every `Context` cell to `/platform/wiki`, which is a 404. Current branch status: Slice 1 now routes those cells to `/wiki` and adds title affordance text; keep this finding as a regression guard, not as an unfixed current-state claim.
- `/workspace/documents` renders a search-and-empty-state page with no obvious create, upload, or connect-next action.
- `/employee` is reached from a rail item labeled People, but the page identity is Employee. This is a terminology mismatch.
- `/storefront` is reached from a rail item labeled Portal, while the project rulebook reserves `/portal` for external/customer experience and uses `/storefront` for internal management. The label needs to stop training the wrong mental model.
- `/finance` is the strongest internal pattern observed: lifecycle families, useful setup state, and compact operational sections.
- `/platform/ai` and `/platform/ai/operations-map` are high-density and expose unresolved state labels such as unassigned, governance pending, and not assigned. These may be truthful, but they are not yet grouped into operator decisions.
- The audit also found a source-truth contradiction: `/platform` reported hundreds of standing grants while `/platform/ai` rendered every coworker as `Not assigned / Governance Pending / Unassigned / 0 active grants`. UX grouping must not paper over this until the data seam is reconciled.
- `/workspace` coworker trust is not yet acceptable: the audit captured setup/system prompt text rendered into the transcript and repeated provider-unavailable turns before fallback. A user cannot treat the coworker as a dependable work partner while hidden orchestration leaks into the conversation.
- Default 404 handling can strand users outside the shell. Link hygiene must include the destination experience, not only the source component.
- `/build` still emits unknown/null-heavy states and remains a poor place to run this refactor through Build Studio.

### 2.1 Current branch remediation status

| Finding | Branch status | Evidence |
| ------- | ------------- | -------- |
| Six-C `Context` links route to `/platform/wiki` | Fixed on `feat/portal-ux-simplification` | Unit tests plus browser check: 12 `/wiki` links, 0 `/platform/wiki` links on `/workspace` |
| Six-C labels require recall of internal meaning | Partially fixed | Readiness cells now carry plain-language descriptions in `title` text; visible label redesign remains future work |
| Workspace KPI routes drifted to dead destinations in the audit | Covered by regression test | `buildWorkspaceCommandCenterView` snapshot tiles now assert `/ops`, `/customer`, `/finance`, `/compliance`, `/build`, and `/platform/ai` |
| Broken-route recovery | Open | The previous `/platform/wiki` destination was themed but still a dead-end test candidate; shell recovery is not yet proven |
| Workspace first viewport is too link-heavy | Open | Baseline link count: 117 links, 22 buttons |
| Coworker prompt/provider leakage | Open | Needs runtime exercise after provider state is controlled |
| Platform AI grant/governance contradiction | Open | Needs data-source reconciliation before presentation redesign |

### 2.2 Finding register

| ID | Severity | Route family | Finding | User harm | Current disposition |
| -- | -------- | ------------ | ------- | --------- | ------------------- |
| UX-01 | Important | Workspace | Command center behaves like dashboard plus site map | Founder/operator must remember where work lives | Slice 2 |
| UX-02 | Important | Workspace | KPI routes drifted to invalid destinations in audit | Clicking a metric can strand the user | Slice 1 regression |
| UX-03 | Important | Workspace / Knowledge | Six-C Context linked to `/platform/wiki` | Readiness diagnosis opens a dead route | Slice 1 fixed; keep regression |
| UX-04 | Minor-to-important | Workspace | Six-C labels use platform vocabulary | New users cannot interpret readiness without memory | Slice 1 partial, Slice 2 visible copy |
| UX-05 | Important | Workspace coworker | Prompt/provider failure leaks into transcript | Coworker stops feeling trustworthy | Slice 3 |
| UX-06 | Important | Business | People/Employee and Portal/Storefront labels conflict | Users learn the wrong mental model | Slice 4 |
| UX-07 | Important | Documents / Compliance / Knowledge / Architecture | Empty states do not consistently offer next action | Fresh installs look broken or unfinished | Slice 5 |
| UX-08 | Important | Platform AI | Grant/governance counts disagree across screens | Operators cannot trust AI workforce state | Slice 6 |
| UX-09 | Important | Build Studio | Unknown/null labels and raw streaming text leak | Contributor cannot distinguish state from debug output | Slice 7 |
| UX-10 | Cross-cutting | 404 / route recovery | Missing routes can lose shell context | Users must recover from implementation detail failures | Slice 1 and route QA |
| UX-11 | Cross-cutting | Incoming feature plans | New UI work can bypass IA/component fit review | The portal becomes a patchwork of dashboards, tabs, and one-off widgets | Feature fit gate |

## 3. Design Principles For This Refactor

1. Audience before system map. A founder/operator, dispatcher, clinic scheduler, retail worker, contributor, and customer should not all see the same first screen.
2. The primary shell is a memory aid, not a database menu. Navigation should group by user intent and work object.
3. Every number, status pill, and readiness cell must either drill into the objects that produced it or render as non-clickable explanatory status.
4. Empty state is a setup path, not a wall of zeros.
5. Labels should be literal to the user. Hide schema terms, internal route names, and platform jargon unless the user is in a diagnostic surface.
6. Archetype should change what the user sees first, but not by forking routes or data models. Use the vertical workspace-home substrate when it lands.
7. Theme-aware styling and restrained operational density are non-negotiable.
8. Refactoring is part of each slice. Reserve time to remove mixed concepts or duplicated patterns rather than only layering new UI over old structure.
9. Trust is a first-view requirement. If a link, coworker response, KPI, or status cannot explain what happened and what the user can do next, it does not belong in the primary decision surface.
10. Feature fit comes before feature surface area. Every new UI plan must name its owning area, route family, persona, navigation layer, component reuse path, empty state, and evidence before implementation starts.

## 4. Persona Acceptance Gates

Every slice must name the user it is improving before it changes IA. The same component may serve more than one audience, but the first viewport and verification script must prove the intended user can get work done without learning platform internals.

| Persona | Capability and challenge | Wants first | Must not see by default | Slice verification smoke |
| ------- | ------------------------ | ----------- | ----------------------- | ------------------------ |
| Founder/operator | Broad authority, low tolerance for dead ends; needs confidence that the business is under control | Exceptions, blocked work, setup gaps, and the next decision | Raw schema terms, decorative alarms, shellless 404s | Open `/workspace`; the first useful action is visible, every KPI drills to a valid filtered destination or renders inert with explanation |
| Dispatcher / scheduler | Starts the day under time pressure; thinks in jobs, appointments, people, confirmations, and exceptions | Today's queue, unscheduled work, overload, failed customer updates, coworker handoffs | "Cockpit", GearInterface, platform governance vocabulary | With seeded vertical data, `/workspace` renders the vertical first slots or an honest admin-only unconfigured notice |
| Retail / service worker | Needs fast operational actions on a narrow device or shared workstation | Orders/tasks, low stock, current customer or location exceptions | Admin setup, platform AI internals, broad product architecture | Narrow viewport shows priority action stack without overlap and without requiring horizontal navigation memory |
| Contributor / platform operator | Understands technical surfaces; needs dense diagnostics and accountability | Build/runtime state, AI routing health, governance gaps, receipts | Ambiguous null/unknown labels or raw streaming walls | `/platform/ai`, `/platform/ai/operations-map`, and `/build` group state into operator questions with drill-down to evidence |
| External customer | Needs a simple customer-native path; should not learn internal management routes | Sign in, request, book, pay, approve, or check status | Internal `/storefront`, Platform, Build, Admin, or coworker governance surfaces | Internal labels do not train users that `/portal` is management; customer routes remain distinct from internal Storefront management |

### 4.1 UX Feature Fit Gate

Use this gate before accepting any UI-impacting feature plan, including route additions, tab additions, dashboard bands, metric tiles, coworker launchers, and workflow entry points.

| Gate | Required answer |
| ---- | --------------- |
| Owning area | Which top-level area owns this work: Workspace, Business, Products, Platform, Knowledge, or customer-facing portal? |
| Route family | Which route family is canonical, and which routes must not be created or promoted? |
| Primary persona | Which user gets a simpler first viewport, and what should they not need to remember? |
| Navigation layer | Is the work global nav, section nav, local page nav, or contextual action? Only one layer should change by default. |
| Component convergence | Which existing components or patterns are reused? If new components are required, what duplicated pattern do they retire? |
| Source truth | Which model, service, or read model owns the displayed state? |
| Empty/failure state | What happens on a fresh install, unavailable provider, missing permission, or missing route? |
| AI action boundary | Does any click start coworker work? If yes, preview and confirmation are required. |
| Verification evidence | Which routes, viewports, data fixtures, and failure modes prove the change is usable? |

## 5. Target Shape

### Workspace

`/workspace` becomes the first simplification target because it is both the daily landing page and the place where the new archetype direction will be felt.

Near-term:

- Keep the platform operator command center as the fallback home.
- Remove broken links and decorative status.
- Fix KPI routes before first-view layout work, including the `OPEN WORK` and `CUSTOMER ACCOUNTS` 404s from the latest audit unless newer evidence proves them repaired.
- Reduce recall burden by making readiness labels explain themselves in place.
- Make zero/empty states action-oriented.
- Repair coworker trust boundaries on `/workspace`: no system/setup prompt leakage, no repeated raw provider failure turns, and visible confidence/receipt affordance where the coworker acts.
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
- Reconcile coworker grant/governance source truth before redesigning the presentation. If every coworker appears unassigned while standing grants exist elsewhere, the slice must diagnose the data seam first.
- Treat Build Studio UX work as a separate stream until its runtime is stable.
- Replace null/unknown literal rendering with intentional "not yet run" or absent states.

### Knowledge

Knowledge is the canonical destination for docs, wiki, and articles.

First cleanups:

- Route all wiki/context links to `/wiki` unless a more specific knowledge object exists.
- Avoid duplicate entry points that imply `/platform/wiki` is real.

## 6. Execution Slices

### Slice 1: Workspace link hygiene, 404 recovery, and readiness affordance

Scope:

- Fix audited KPI dead links, including `OPEN WORK` and `CUSTOMER ACCOUNTS`, or capture newer crawl evidence proving those links already route to valid primary destinations.
- Fix Six-C `Context` links from `/platform/wiki` to `/wiki`.
- Add regression coverage so workspace KPI and readiness links cannot point at invalid routes again.
- Add lightweight title copy to readiness cells so "Context", "Connections", and related labels are interpretable without leaving the page.
- Ensure bad links land in themed shell recovery if they occur, with a back-to-workspace path.
- Keep styling token-based.

Verification:

- Run the affected workspace command-center tests.
- Exercise `/workspace` in the browser and confirm KPI tiles and `Context` cells route to valid destinations.
- Browser-check at least one intentionally missing route and confirm the user is not stranded outside the shell.

### Slice 2: Workspace first-view simplification

Scope:

- Reduce the first viewport to command strip, core signals, readiness, and work in motion.
- Move lower-frequency launch tiles below the first decision surface or behind a clearer grouped launcher.
- Replace any repeated generic explanation with a compact help/info affordance.
- Add a persona-first acceptance script for founder/operator and one configured worker persona. The first viewport must answer "what needs my attention now?" before it offers a site map.

Verification:

- Browser screenshots at desktop and narrow widths.
- Link-count reduction from the current `/workspace` baseline.
- Evidence that the primary action and priority exception are visible without scrolling on desktop and mobile.
- No overlapping text, no horizontal overflow, and no navigation layer duplicates between AppRail, section tabs, and local launchers.

### Slice 3: Workspace coworker trust boundary

Scope:

- Stop setup/system prompt text from rendering as assistant content in the `/workspace` coworker transcript.
- Make provider fallback behavior user-safe: either fail over before rendering repeated raw provider-unavailable messages, or show one honest status with retry/fallback context.
- Add confidence, receipt, or "why this answer" affordance for coworker actions that affect work.
- Keep this slice bounded to workspace trust; broader Build Studio transcript cards remain Slice 7.

Verification:

- Browser exercise of `/workspace` coworker with a simple greeting and a work-oriented request.
- No hidden setup instruction text appears in the transcript.
- Provider-unavailable behavior produces a single user-safe state, not repeated failed turns.

### Slice 4: Business terminology alignment

Scope:

- Align People/Employee naming.
- Align Portal/Storefront naming with the rulebook.
- Audit route headings, rail labels, tab labels, and breadcrumbs for mismatches.
- Preserve `/portal` as customer-facing language and use `Storefront` or `Storefront Management` for internal management.

Verification:

- Unit coverage for nav constants where practical.
- Browser crawl over Business routes.
- Confirm an external-customer mental model cannot confuse internal `/storefront` management with customer `/portal` or `/s/[slug]` experiences.

### Slice 5: Empty-state orchestration pattern

Scope:

- Start with Documents, Compliance, Knowledge, and Architecture because the latest audit found empty or action-poor states across those surfaces.
- Replace repeated "no data" blocks with a single setup/connection decision per page section.
- Add create/connect/import actions only where the underlying route exists.
- Create a small reusable empty-state decision model: `create`, `upload`, `connect`, `import`, `configure`, `learn why unavailable`, or `not applicable yet`.
- Hide KPI rows that only display zeros until there is enough configured data to make the metric useful.

Verification:

- Browser crawl of fresh-install empty states.
- No dead CTAs.
- Each empty state offers one clear next step or an honest unavailable explanation for the persona viewing it.

### Slice 6: Platform AI source-truth repair and operator grouping

Scope:

- Reconcile the source-truth mismatch between standing tool-grant counts and coworker cards that render every coworker as unassigned/governance-pending/zero grants.
- Group AI Operations by operator question rather than raw assignment/provider/governance records.
- Preserve dense diagnostics behind drill-ins.
- Align with the UX auditor coworker spec so AGT-906 can later turn these into executable invariants.

Verification:

- Browser crawl of `/platform/ai` and `/platform/ai/operations-map`.
- Evidence that displayed grant/governance counts reconcile with the backing records or render an explicit data-quality warning.
- Evidence that unassigned/governance-pending counts lead to filtered detail.

### Slice 7: Build Studio UX recovery

Scope:

- Continue under `EP-BUILD-STUDIO-UX`, not as part of the shell simplification branch unless a dependency is unavoidable.
- Fix unknown/null rendering and streaming output boundaries before asking Build Studio to run UX refactors.

Verification:

- Build Studio route exercise against the live portal.
- Production build once runtime changes are in scope.

## 7. Backlog And Evidence Handling

- Treat `EP-2b79c5c6-8a63-4184-9076-5257bb271cdd` as the intake epic for the 2026-05-20 manual audit findings until a governed backlog cleanup explicitly moves or supersedes it.
- Before filing new work, query the live backlog for overlap under the intake epic and the owning delivery epic.
- Do not leave audit findings as doc-only observations. Each accepted critical or important finding must map to one execution slice, one backlog item, or one explicit "not doing" decision.
- Treat accepted feature-fit gaps the same way: either amend the feature plan before implementation, file a backlog item under the owning epic, or record an explicit defer/reject decision.
- Group related findings by user harm and route family. Do not create one backlog item per element.
- Record verification evidence with the slice: affected persona, route, viewport, data fixture, result, and screenshots where visual layout is part of the claim.

## 8. Working Rules For This Thread

- Use live portal evidence before changing IA.
- Use docs/specs as anchors, but keep current runtime truth separate from future-state design.
- Prefer small PR-sized slices.
- Use MCP/backlog state before filing new work.
- For any incoming UI plan, run the §4.1 fit gate and capture the result in the plan or a linked audit before implementation starts.
- Keep refactoring inside each slice rather than accumulating cleanup debt. Spend roughly 20% of implementation effort removing mixed concepts, duplicated patterns, or leaky abstractions discovered by that slice.
- Do not route this through Build Studio until Build Studio can produce reliable UX verification evidence.
- No slice is done with screenshots alone. Each UI slice needs a persona task outcome and a failure-mode check.
