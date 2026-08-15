# Portfolio-shaped information architecture — design

**Status:** draft for operator review · 2026-08-14
**Proposed epic home:** EP-8DC217EB (Vertical Integration Inward — recombine DPF's own functionality)
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
| 4 | *(referenced, separate epic)* coworker navigate-and-act capability | L |

## 8. Acceptance

- Every `shellNav` entry resolves — via a checked-in test — to exactly one FPAW portfolio key or an explicitly declared cross-cut; none is silently unclassified.
- People, AI Workforce, and Coworker Decisions are reachable under one Workforce section without violating section-scoped nav or the breadcrumb guarantee.
- The reconciled spine is previewable via nav-mode on a live install before it becomes default.
- No regression in the EP-NAV-COHERENCE guarantees (§3), asserted by the existing nav tests plus the new trace test.
