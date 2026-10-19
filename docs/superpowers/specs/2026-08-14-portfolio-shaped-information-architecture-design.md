---
status: active
---
# Portfolio-shaped information architecture — design

**Status:** draft for operator review · 2026-08-14. Direction approved by the founder 2026-09-25 after the navigation and surface review; §9 amends it so each area is workroom-shaped.
**Proposed epic home:** EP-8DC217EB (Vertical Integration Inward — recombine DPF's own functionality). Execution slices for §9: EP-2FB6C0CC.
**Supersedes nothing; extends:** the EP-NAV-COHERENCE nav model (its *mechanics* are DONE and are constraints here, not open design space).
**Source analysis:** "The UX Has No Spine" (UX surface & navigation analysis, 2026-08-14).

---

## 1. Problem

DPF's own published operating standard (`DPF-FPAW`, `docs/architecture/four-portfolio-archetype-ai-workforce-operating-standard.md`) places every governed aspect of a business into **four portfolios** — `products_and_services_sold`, `for_employees` (Workforce), `manufacturing_and_delivery`, `foundational`. This is the platform's canonical, model-backed organizing spine (runtime keys: `productsAndServicesSold | forEmployees | manufactureAndDeliver | foundational`, persisted on `PortfolioDecomposition`).

The primary rail organizes into **six sections** that do not correspond to those portfolios (`apps/web/lib/navigation/portal-shell-sections.ts`): Workspace, Business, Products, Delivery, Platform, Knowledge. The six mix three different organizing principles at once — *whose work* (Workspace), *what domain* (Business/Products/Delivery), and *plumbing* (Platform/Knowledge) — so the model's clean spine is invisible in navigation.

Consequences (evidenced in the source analysis):
- **Workforce is one portfolio but three UI homes** — `/employee` (Business), `/platform/ai` (Platform), `/coworker-decisions` (Knowledge). Managing "who does the work" crosses three rail sections.
- Common owner jobs cross 2–3 rail sections and route groups mid-flow (product lifecycle spans Products→Delivery→Platform; customer lifecycle spans shell→storefront→portal).
- The prior nav program fixed **mechanics** (no cross-rail teleport, one `SectionNav` renderer, global breadcrumb, worker/operator mode) but never the **taxonomy**. Coherent rail, still-lost owner.

## 2. Goal & non-goals

**Goal:** make the primary navigation legible against the four-portfolio spine the platform already models, without regressing the coherence guarantees already shipped.

**Non-goals:**
- Not a rewrite of the nav model. `portal-navigation-model.ts` stays the single source; this changes the *section taxonomy* it maps into (`shellNav.sectionKey`), not the per-route records.
- Not a change to the FPAW standard or `PortfolioDecomposition`.
- Not a removal of worker/operator mode — this composes with it.

## 3. Constraints inherited from EP-NAV-COHERENCE (must not regress)

- Section-scoped secondary nav never teleports across rail sections.
- Every destination carries a global breadcrumb home.
- Worker ("Simple") mode is always one toggle from operator ("Full"); no mode strands a role away from a surface it can reach.
- One `SectionNav` renderer; no per-surface tab-nav clones (ratchet-guarded).

## 4. Proposal

### 4.1 Reconcile the six sections toward the four portfolios

Target rail spine (operator mode), each section keyed to an FPAW portfolio, plus two orthogonal cross-cuts that are honestly *not* portfolios:

| Rail section | FPAW portfolio | Absorbs today's |
|---|---|---|
| **Workspace** *(cross-cut: "my work")* | — | Workspace, Needs-you, performance |
| **Customers & Revenue** | `products_and_services_sold` | Customer/CRM, Marketing, Storefront, Rental, Portfolio (goods sold) |
| **Workforce** | `for_employees` | People, AI Workforce, Coworker Decisions |
| **Make & Deliver** | `manufacturing_and_delivery` | Build, Delivery, Ops/backlog, EA/architecture |
| **Foundation** | `foundational` | Platform hub, Identity, Tools, Admin, Audit |
| **Knowledge** *(cross-cut: reference)* | — | Docs, knowledge base |

The two cross-cuts (Workspace, Knowledge) stay first-class but are *labeled as cross-cuts*, not pretend-domains — this is the honest fix for "Workspace maps to no portfolio."

### 4.2 First slice — unify Workforce (highest signal, lowest blast radius)

Bring `/employee`, `/platform/ai`, and `/coworker-decisions` under one **Workforce** rail section (people + AI coworkers = one portfolio in the model). Internally they remain distinct surfaces with section-scoped nav (per the coherence constraint); the change is the `shellNav.sectionKey` grouping and the section label, not the routes. This proves the reconciliation on the exact case that most violates the model, before touching the larger sections.

### 4.3 Mechanism

- Change is localized to `shellNav.sectionKey` assignments in `portal-navigation-model.ts` and the `PORTAL_SHELL_SECTIONS` definitions — the existing single source.
- Add an explicit, lossless map from each section to its FPAW exchange key (or `cross-cut`) so the rail taxonomy is *traceable* to the standard (the standard already requires this adapter mapping for camelCase→snake_case).
- Ship behind the existing `nav-mode` cookie as an operator-previewable spine so it can be validated on a live install before it becomes default (mirrors how worker/operator already gates rail shape).

### 4.4 Compose with the coworker-as-navigator gap

The analysis found the UX coworker is a page-attached copilot with **no navigation capability**. A portfolio-shaped rail and a navigating coworker are complementary: the rail makes the structure legible for humans; the coworker makes it *traversable by intent* ("pay this supplier" → routes + acts). This spec covers the rail; the coworker capability is EP-UX-SYSTEM / coworker-epic work and is referenced, not built here.

### 4.5 Connections cockpit — the Foundation instance (augmentation for external dependencies)

Operator finding (2026-08-16): external-dependency configuration is the worst-case of the six-section problem. Setting or seeing a connection (an API key, a provider credential, an MCP server, a discovery collector) is spread across **8 top-level surfaces in 4 unrelated nav sections** (`/platform/tools/{built-ins,services,catalog,integrations,discovery}`, `/platform/ai/providers`, `/admin/settings`, `/finance/spend`) plus 13 per-connector sub-pages — and the same `PlatformKeysPanel` is duplicated in two of them with divergent hard-coded key lists. Cost/billing visibility compounds it: a mature AI-only spend stack exists (`TokenUsage.costUsd`, `AiProviderFinanceProfile`, `/finance/spend/ai`), while Brave, YouTube, and every `IntegrationCredential`/`McpServer`/`DiscoveryConnection` carry only a `configured` flag — no usage, no cost, no threshold. No unified inventory exists (the SBOM is code deps, not services).

This is a **Foundation** concern (the `foundational` section already absorbs Platform/Tools/Admin), so it is the sharpest concrete case for this spec's reconciliation — and it augments the design in two ways the rail-only proposal did not cover:

- **A single Connections cockpit** in Foundation over a **unified external-dependency registry** (unions PlatformConfig keys, `ModelProvider`, `IntegrationCredential`, `McpServer`, `DiscoveryConnection`), with **uniform cost/billing on every dependency** — generalizing the existing AI-cost pattern (`AiProviderFinanceProfile`) to non-AI deps, plus per-dependency usage + free-tier/budget threshold alerts. The 8 legacy surfaces become views/deep-links onto the one registry (the Phase-2 de-dupe pass, made concrete). This is the *cost* dimension the rail proposal is silent on.
- **In-dialog provisioning as the first concrete instance of §4.4.** Rather than send the operator to a surface, the coworker detects a missing connection mid-task and requests + provisions it in the conversation (tell-don't-act; extends `agent-external-access-permission.ts`), so the surface is the fallback, not the default. This is exactly the "traversable by intent → routes + acts" capability §4.4 references — the Connections cockpit is where it first ships.

Tracked as **BI-2A0180A9** under this epic (EP-8DC217EB). It honors §3/§6 (no parallel nav model; the cockpit is a Foundation surface over the existing single nav source, not a new registry).

## 5. Research & benchmarking

How comparable business platforms bind a domain model to primary navigation:

- **SAP Fiori launchpad (spaces & pages).** Navigation is organized into *spaces* that map to business roles/areas, not to the underlying module tree; a role sees a curated space. Adopt: role/portfolio-shaped top level over a raw module tree. Reject: SAP's per-role hand-curation doesn't scale to DPF's archetype variety — DPF should *derive* the spine from the FPAW placement + capability activation it already computes.
- **ServiceNow workspaces.** Task-oriented workspaces (Agent, Dispatcher) group cross-table work by *what the person is doing*, distinct from the admin app-nav. Adopt: the Workspace cross-cut ("my work") as a first-class peer to the domain sections — validates keeping Workspace, but labeled as a cross-cut. 
- **Odoo apps.** One rail item per installed "app"; clean but flat, and it leaks the build-time module boundary to users (DPF's current six-section problem in a different form). Reject flat-module-as-nav; it's precisely what produces "26 top-level domains".
- **Microsoft Dynamics 365 areas/groups.** Two-level area→group→subarea sitemap tied to the security model. Adopt: portfolio→section→surface as a model-tied two-level spine; DPF already has the capability/permission gating to drive it.

**Adopted stance:** derive a portfolio-shaped, capability-gated two-level spine from substrate DPF already computes (FPAW placement + `getActiveOrgCapabilities` + nav-mode), rather than hand-curating per role (SAP) or exposing the module tree (Odoo).

## 6. §1 substrate check (no parallel utilities)

- **No new nav model.** Extends `portal-navigation-model.ts` / `portal-shell-sections.ts`; no second registry.
- **No new taxonomy.** Reuses the FPAW four-portfolio keys already persisted on `PortfolioDecomposition`; adds only a section→portfolio adapter map (the standard already mandates the key adapter).
- **No new mode system.** Reuses the `nav-mode` cookie for operator preview.
- **No coherence regression.** Section-scoped nav, breadcrumb, and the one-renderer ratchet are unchanged; only `sectionKey` groupings move.

## 7. Phased plan

| Phase | Deliverable | Size |
|---|---|---|
| 0 | Section→FPAW-portfolio adapter map + trace test asserting every `shellNav` entry resolves to a portfolio or an explicit cross-cut | S |
| 1 | **Workforce unification slice** — regroup People + AI Workforce + Coworker Decisions under one Workforce section (behind nav-mode preview) | M |
| 2 | Label & de-dupe pass (folds in the quick wins: "Portal"→"Storefront Setup", drop `/platform/ai` vs `/overview` duplicate, "AI Coworkers"→"Agent Identities", rail-label↔H1 alignment) | S |
| 3 | Reconcile remaining sections to the portfolio spine; make it the default after live-install validation | L |
| 3b | **Connections cockpit (§4.5)** — unified external-dependency registry + one Foundation surface + uniform cost/billing + in-dialog provisioning (BI-2A0180A9); first concrete instance of the §4.4 capability | L |
| 4 | *(referenced, separate epic)* coworker navigate-and-act capability | L |

### 7.1 Resolved — the phase-2 label pass is correct as written *(raised 2026-08-15, resolved 2026-08-16)*

Phase 2 lists `"AI Coworkers"` → `"Agent Identities"`. This was queried on the grounds that it renamed an operator word into a machinery word. **That objection was wrong and is withdrawn.**

An AI coworker *has* an agent identity; they are two objects, not two names for one. The identity is the GAID record — the `Agent Identity Document` (AIDoc), badging and assurance claims, portable authorization classes, and the chain-of-custody receipts that make a coworker's actions attributable. That is specified normatively in `docs/architecture/GAID.md` alongside TAK and TAK-JSI, each with a conformance-test suite, and it is the platform's central claim rather than an implementation detail. A surface that manages those records is correctly labelled **Agent Identities**, and the rail should say so.

The companion spec's lexicon rule has been corrected accordingly (*Interaction Shape Graph* §3.4): standard-bearing vocabulary is **taught, not hidden**, and the check derives that list from the normative corpus so ease-of-use work cannot soften it away.

## 8. Acceptance

- Every `shellNav` entry resolves — via a checked-in test — to exactly one FPAW portfolio key or an explicitly declared cross-cut; none is silently unclassified.
- People, AI Workforce, and Coworker Decisions are reachable under one Workforce section without violating section-scoped nav or the breadcrumb guarantee.
- The reconciled spine is previewable via nav-mode on a live install before it becomes default.
- No regression in the EP-NAV-COHERENCE guarantees (§3), asserted by the existing nav tests plus the new trace test.

## 9. Amendment 2026-09-25 — each area is workroom-shaped

### 9.1 Founder direction and evidence

The navigation and surface review of 2026-09-25 (EP-2FB6C0CC) found three problems:

- The rail follows how DPF is built, not what people come to do. 7 of 22 rail labels open a page with a different title.
- Several jobs have more than one home: coworkers 4, workrooms 3, access 2.
- Most settings sit under Admin or Platform, away from the work that reads them. The GitHub contribution setting is the calibration case: Admin › Advanced › Platform Development, then a wizard.

WWMD DI-3CAD53D55BC5 chose this spec's portfolio spine with activity labels.

The founder approved moving forward the same day and added the governing direction for this amendment:

> Workrooms were introduced after the portal was first built, and the layout should reflect them. Admin and setup align to the activities that require and use them, so authorized humans and AI coworkers are managed with the work going on in each area.

### 9.2 What already exists (no new model)

Every part of an area already has a substrate. This amendment adds no table, registry or nav renderer.

| Area part | Existing substrate |
|---|---|
| The area itself | A rail section keyed to one FPAW portfolio (§4), and `Workroom.portfolioRole` on each room (`work-coordination.prisma`). |
| Its rooms | Workroom instances, nested by `WorkroomRelation(contains)`. The archetype standing-room tree is in `packages/storefront-templates/src/standing-rooms.ts`, with top rooms per portfolio. The canonical inventory is `/ops/workrooms`; the inspector is `/workspace/cases/[caseKey]` (2026-09-07 portfolio-work-activity spec). |
| Its coworkers | Route ownership (`ROUTE_AGENT_MAP`, `lib/tak/agent-routing.ts`, projected into `AuthorityBinding scopeType=route`); work-shape coordinator bindings (`AuthorityBinding scopeType=workroom`); and room participants (`WorkroomParticipant`, one `Principal` model for humans and agents). |
| Its people | Work-shape stage roles (`role:finance-owner`, `role:customer-owner`, …), inherited accountability (PWA-04), room participants, and platform roles (HR-000…HR-600). |
| Its setup | The settings the area's runtime reads. The 2026-09-25 settings sweep traced 42 settings surfaces to their runtime readers; the review packet carries the table. |

`Agent.portfolioId` records where a coworker is *employed* (AI coworkers are Workforce capacity, PAAW §6), not the area it serves. So it is **not** used for area membership.

### 9.3 The area template

Every portfolio section (Serve & grow, Team, Improve & deliver, Run the platform) renders the same three section-nav entries through the existing `SectionNav`, ahead of the area's own activity pages. The two cross-cuts (Today, Learn) do not get the template.

1. **Work.** The rooms placed in this portfolio. This is a filtered view of the canonical `/ops/workrooms` inventory (`one-home-per-capability`: a scoped view of the existing home, not a new dashboard). It is grouped by standing room, then live rooms. Unplaced rooms stay in the inventory's exception group; they are never guessed into an area.
2. **Team.** The humans and AI coworkers who work here, with what they may do:
   - who owns the area's pages;
   - who coordinates its standing rooms;
   - who is in its live rooms;
   - which people hold its owner roles.

   Each row links to the one canonical record: `/workforce/[agentId]` for a coworker, the People record for a person, and the authority binding in context. Team is a projection. It never becomes a second directory or a second permission model.
3. **Setup.** The settings this area's work reads. **A setting's home is the area whose runtime reads it.** A setting read by two or more areas, and identity, access, security and platform upkeep, stays in Run the platform, and each area that uses it links to it in context (PWA-08).

Admin, as a separate rail entry, shrinks to Run the platform › Setup, which keeps users and roles, sign-in and federation, authorization bindings, file storage, backups, scheduled jobs, audit and data stewardship. The Advanced holding tab is retired (BI-3ED24FA2).

### 9.4 Where setup moves (from the settings sweep)

| Area | Setup it gains | Leaves |
|---|---|---|
| Serve & grow | Storefront profile, business hours, capabilities, sections and items; branding; outbound email (SMTP, Postmark); the archetype (read-only) | Admin › Organization / Configuration; Platform › Tools › Integrations (Postmark) |
| Team | AI providers and routing, priority and models, prompts, skills, workroom posture defaults, coworker reading level; work locations (reference data) | Platform › AI Operations; Admin › Configuration |
| Improve & deliver | Contributing & GitHub (contribution mode, GitHub connection, private paths, git remote), governed backlog lane, Build Studio engine settings, stall thresholds, tokens for external coding agents | Admin › Advanced › Platform Development; Platform › AI › Build Runtime; `/admin/build-studio/stall-thresholds` |
| Funding (wherever Finance sits) | QuickBooks and Stripe connections join the existing `/finance/settings` | Platform › Tools › Integrations |
| Run the platform | Keeps the cross-cutting setup listed in §9.3, plus the Connections cockpit (BI-2A0180A9) for dependencies shared across areas | — |

Moves keep their routes or leave a redirect with an expiry (`supersession-is-a-mechanical-act`), and every in-app link points at the new home.

The sweep also found controls that do nothing. Each goes to the review's exercise pass (BI-595245CC) before any move:
- The Scheduled Jobs page shows the backup job, but the backup cron is fixed in code.
- Dunning has no scheduler.
- Stripe, QuickBooks and Entra/LDAP credentials have no runtime reader.
- `resolveBmrAuthority` has no callers.

### 9.5 Research — where comparable products put setup

- **Jira.** Project settings (people, roles, workflows, permissions) live with the project; global admin keeps identity, security and billing. *Adopt:* setup with the work, global admin for cross-cutting concerns only. *Reject:* per-project permission schemes as a separate model; they are a known source of permission sprawl. DPF keeps one `Principal` / `AuthorityBinding` model, and Team only projects it.
- **Linear.** Each team owns its members, workflow states and settings; workspace settings hold security, billing and integrations. *Adopt:* the area's own members and settings, one click from its work.
- **GitHub.** Repository settings and collaborators live with the repository; organization settings hold members, SSO and policies. *Adopt:* the same two-level split. *Reject:* duplicating member lists per repository; the Team view links to one record.

### 9.6 Dependencies

The template works on today's data, and each gap below shows as an honest empty state, never a guess:

- **BI-C30A4694:** 60% of rooms have no portfolio yet, so Work stays thin until placement lands.
- **BI-CB525EC6:** the owner roles are not bound to people yet, so Team shows the unbound role as the next step.
- **BI-8E51C422:** no value-stream team definitions exist yet (0 rows), so definitions stay at `/ea/workrooms`.
- **BI-2DBC4D2D:** coworker surface consolidation. Team links to its one directory.
- **BI-30AB0979:** Business administration's portfolio placement.

### 9.7 Objectives and acceptance for this amendment

**OBJ-AREA-SPINE:** The rail is the portfolio spine with activity labels: at most 18 Full-mode entries, each traceable to one FPAW portfolio key or a declared cross-cut.

**OBJ-AREA-WORK:** Each portfolio section shows the work going on in it as a filtered view of the one workroom inventory.

**OBJ-AREA-TEAM:** Each portfolio section shows the humans and AI coworkers who work there, and what they may do, as a projection of existing bindings, participants and roles.

**OBJ-AREA-SETUP:** Each setting has one home: the area whose runtime reads it, or Run the platform when it is cross-cutting.

**OBJ-AREA-NO-REGRESSION:** The §3 coherence guarantees and the UX surface budgets hold while the rail changes.

| Acceptance | Objectives | Statement |
|---|---|---|
| AC-AREA-SPINE | OBJ-AREA-SPINE | A nav-model test resolves every `shellNav` entry to one portfolio key or a declared cross-cut, and Full mode has at most 18 rail entries. |
| AC-AREA-WORK | OBJ-AREA-WORK | Each portfolio section's Work entry opens `/ops/workrooms` scoped to that portfolio, and a test asserts both views list the same rooms. |
| AC-AREA-TEAM | OBJ-AREA-TEAM | Team reads only route and work-shape `AuthorityBinding` rows, `WorkroomParticipant` rows and owner roles, and every row links to its canonical record without copying it. |
| AC-AREA-SETUP | OBJ-AREA-SETUP | A test maps every settings panel to exactly one area, or to Run the platform with its linking areas; the Admin rail entry and Advanced tab are retired. |
| AC-AREA-OUTCOME | OBJ-AREA-SPINE, OBJ-AREA-SETUP | Operations to outcome measured on the running portal go down for the review's activity map; rail to Connect GitHub is at most 3. |
| AC-AREA-GUARDS | OBJ-AREA-NO-REGRESSION | Section-scoped nav, breadcrumb and the one-SectionNav ratchet pass, and the route budget sweep shows lower shell word counts with a deliberately re-frozen baseline. |
