# Business Operating Model — Portfolio Wiring Design

| Field | Value |
|-------|-------|
| **Status** | Historical design record. The operating-model thesis remains useful, but the 2026-08-01 authority notice below supersedes its Product/DigitalProduct and value-stream semantics. **Architect re-review 2026-07-04:** current-state refreshed against origin/main — two Phase-0 preconditions (portfolio-decomposition persistence, BI-230C9EF7 org resolver) and the Decision Governance surfaces (EP-0AF96937) had landed since the original pin. |
| **Date** | 2026-06-07 (authored) · 2026-07-04 (architect current-state refresh) |
| **Author** | Claude (Opus 4.8) with founder (Mark Bodman) |
| **Primary Objective** | Wire each customer company's **top-down business direction** into the two business-critical portfolios — **Products & Services Sold** and **For Employees (→ Workforce)** — so they become populated, operational, and backlog-generating, and so they **ground the immature WWWD decision layer** the way founder principles ground the mature WWMD layer. |
| **Scope** | The "missing middle" between the decision layer (WWMD/WWWD) and the capability-maturity layer: a structured per-company **Business Operating Model** seeded from archetype, refined by the operator + continuous corpus enrichment, consumed by WWWD decisions, and fanned out into the backlog. |
| **Non-Goals** | Does not implement schema, routes, or migrations. Does not re-architect WWMD. Does not duplicate the agent-control-plane maturity model. Does not replace external systems of record (QuickBooks, HRIS, ERP) — those remain `boundary_adapter` conduits. |
| **Original pin / current pin** | Authored against `1470ea1c`; refreshed against `origin/main` at `bebeb339c` (≈900 commits later). §3 reflects the current pin. |
| **Historical inputs** | DPF-owned IT4IT Reference Architecture entity notes, portfolio registry, onboarding/business-context sources, agent-control-plane and archetype designs, decision-surface plan, and EP-AI-WORKFORCE-001. A local G252 text extract was consulted during the original 2026-06-07 draft but is excluded from successor AI evidence under the 2026-08-01 authority notice. |

> **Current authority (2026-08-01).** This document remains the historical design record for the
> operating-model wiring initiative. The
> [Four-Portfolio Archetype and AI Workforce Operating Standard](../../architecture/four-portfolio-archetype-ai-workforce-operating-standard.md)
> now owns portfolio, Product/DigitalProduct, business-value-stream, work-allocation, and AI
> dual-aspect semantics. The
> [Business Commercial Catalog](../../architecture/business-commercial-catalog.md) owns the current
> `ProductLine → Product → ProductOffering → CatalogItem` hierarchy. Those sources supersede any
> statement below that treats every customer offer as a `DigitalProduct` or equates an industry
> value stream with the `Consume` stream of the IT4IT Reference Architecture.
>
> The supplied Open Group PDFs/text extracts and mixed-origin workbooks are not admissible
> generative-AI sources under their current SourceUseDecisions. Mark Bodman's direct
> contributor-origin concepts are a separate permitted source under the current FPAW policy. Precise
> external-standard equivalence requires an authorized edition and qualified human reviewer.

---

## 0. Update Log

**2026-08-01 — semantic convergence.** Reclassified this document as a historical design record,
linked the new operating standard and commercial-catalog authorities, corrected the current market
offer boundary to `ProductLine → Product → ProductOffering → CatalogItem`, and widened the
realization dependency from DigitalProduct/SBOM-only to all four portfolios and non-digital work.

**2026-07-04 — architect current-state refresh (against `origin/main` `bebeb339c`).** Verified every §3 claim against the live worktree. Three items the spec listed as "not yet built" have since **landed**; the design thesis (a structured operating model grounding WWWD and populating the two business portfolios) is **unchanged and still largely un-built** — what shipped are its *preconditions and surfaces*, not the BOM itself.

| Since original pin | Status | Evidence | Effect on this spec |
|---|---|---|---|
| **Persist the archetype `PortfolioDecomposition`** (was "computed but never persisted", §3/§8 Phase 0) | **LANDED** (BI-2D452667) | `BusinessContext.portfolioDecomposition Json?` (schema); `apps/web/lib/onboarding/seed-portfolio-decomposition.ts` seeds once from archetype then operator-refinable; `resolvePortfolioDecomposition()` prefers persisted value | Phase 0 item DONE — strike from the plan; the refinable portfolio shape now exists to build on |
| **Org-profile resolver — BI-230C9EF7** (the WWWD precondition, §3/§5/§8 Phase 0) | **LANDED** (EP-8AF1C996) | `resolveProfileMaterialForOrg()` + `resolveOrgProfileId()` (`apps/web/lib/decision-perspective/material.ts`); `evaluateOrgBusinessDecisionGate()` (`org-business-gate.ts`); `evaluate_org_business_decision` MCP tool (`org-decision-pack.ts`), recording to the `DecisionInteraction` ledger | §5 step 1 precondition DONE — business decisions now resolve by `ownerOrganizationId`, not fall back to `mark-dpf-platform` |
| **Decision Governance surfaces — EP-0AF96937 Phases 1–4** | **SHIPPED** | `/wiki` (governance hub: WWMD/WWWD/WSID cards + live counts), `/wiki/review` (Review & Adjust over the decision ledger), `/wiki/stance` (operator-authored WWWD stance editor → org-overlay `stance` WikiPages), `/wiki/craft`, `/wiki/matrix` | WWWD now has an operator-authored **stance corpus** and actively routes business decisions — but it is still **stance narrative, not a structured operating model**. That grounding (Facets A/B → `PerspectiveMaterial`, §5 step 2) is exactly what this spec still adds. |

**Also confirmed by audit (answers §11 open decisions):** `DigitalProduct.lifecycleStage` exists (default `"plan"`) and `DigitalProduct.bomDocuments` relation exists (§11-Q1 partially answered — reuse, don't add a lifecycle field). `ServiceOffering` exists with `digitalProductId` FK, SLA/OLA refs, and `consumers`. **Still open (unchanged):** `EmployeeProfile` has **no** `portfolioId` FK (Facet B wiring, §4.2), and `Agent` still carries the full workforce field set (§3).

---

## 1. Problem Statement

The platform has matured two layers in parallel:

1. **The decision layer.** **WWMD** ("What Would Mark Do" — the founder/platform kernel) is shipped and live at `apps/web/lib/decision-perspective/build-studio-gate.ts`. It is evidence-gated, ledgered, and actively gating Build Studio plan advancement. It is mature; the work remaining is fine-tuning. **WWWD** ("What Would We Do" — the customer organization's kernel) is **maturing but not yet grounded**. It exists as a container (`DecisionPerspectiveProfile kind=organization`) plus four archetype-templated org-overlay WikiPages (`org-mission`, `org-who-we-serve`, `org-how-we-decide`, `org-supply-chain`) seeded by `seedOrgWwwdCorpus`. **Since this spec was authored** it now resolves and governs: BI-230C9EF7 landed, so business decisions resolve by `ownerOrganizationId` through `evaluateOrgBusinessDecisionGate` instead of falling back to `mark-dpf-platform`, and the Decision Governance surfaces (EP-0AF96937) let the operator author org stance (`/wiki/stance`) and adjust the decision ledger (`/wiki/review`). **What it still lacks is what this spec supplies:** its corpus is *stance narrative*, not a structured model of what the company sells and who/what does its work.

2. **The capability-maturity layer.** The [Four-Portfolio Agent Control Plane Maturity](2026-05-21-four-portfolio-agent-control-plane-maturity-design.md) spec turns the four-portfolio taxonomy into an investment/operations/productization surface — but explicitly for **DPF's own agent control plane** (`installScope = dpf_dogfood`/`canonical`, the recursion). Its design intent table reads the four portfolios as *DPF's* substrate, factory, internal workspace, and market offer.

**The gap is the middle.** Between "how the company decides" (WWWD narrative) and "how mature DPF's platform capabilities are" (maturity scoring), there is no structured representation of **what the customer company actually sells and who/what does its work**. Concretely, verified against the live codebase:

- **WWWD reasons over nothing concrete.** The four WWWD pages are *stance narrative* ("we decide for patient safety first"). They are not grounded in a structured model of the company's actual offerings, workforce, or goals. WWMD matured because it cites concrete, evidence-gated principles; WWWD cannot mature the same way until it has concrete operating-model nouns to reason over.
- **Products & Services Sold is wired to DPF's products, not the customer's offer.** `DigitalProduct.portfolioId` and the `/portfolio/products/[id]` routes exist, but for a real customer (a clinic, a retailer, an MSP) nothing seeds *their* market offer (appointments/treatments, SKUs, service catalog) into this portfolio from their archetype/business context.
- **"For Employees" is too narrow and is not wired to the portfolio.** `EmployeeProfile` exists with a full HR surface at `/employee`, but it has **no FK to a portfolio**. The portfolio meaning excludes the AI agent workforce, even though `Agent` already carries `portfolioId`, `valueStream`, `humanSupervisorId`, `toolGrants`, `executionConfig` (token budgets), and `skills` — i.e. the substrate to model what a non-human identity *needs to contribute* already exists, unconnected to the portfolio lens.
- **Archetype portfolio decomposition — was computed-but-never-persisted; now persisted (LANDED, BI-2D452667).** `readActivationProfile()` validates a `foundational | manufactureAndDeliver | forEmployees | productsAndServicesSold` decomposition (absent/minimal/standard/primary) at runtime. This spec's Phase 0 asked to persist it; that shipped — `BusinessContext.portfolioDecomposition` stores the per-org shape, seeded once from the archetype (`seed-portfolio-decomposition.ts`) then operator-refinable, with `resolvePortfolioDecomposition()` preferring the persisted value. The refinable portfolio shape now exists to drive from; the remaining gap is *populating* the two business portfolios beneath it (Facets A/B).
- **The backlog is not business-driven.** `BacklogItem`/`Epic` are manually authored or sourced from storefront inquiries. Nothing converts business direction → portfolio gaps → backlog. This is precisely Mark's observation: **Build Studio is nearly autonomous on the engineering side; the business side is not, because no signal generates business backlog.**

This historical design addresses a top-down disconnect identified by the operator: leadership's business direction and internal technology management lack a traceable line of sight to customers. DPF's operator-directed four-portfolio model is the proposed fix, but only if the business-facing roles are populated from leadership direction and made load-bearing. No G252 section-level claim from the excluded local material is carried forward here.

## 2. Design Intent

Introduce a per-company **Business Operating Model (BOM)** — not a new substrate, but a *wiring discipline* over existing substrate — that makes the two business-critical portfolios the **top-down anchor** of the whole platform:

```text
Archetype business context (top-down, leadership-defined)
  → seeds the two business-critical portfolios
      • Products & Services Sold  (operator-directed external-value role)
      • Workforce (operator-directed internal-value role + human and AI performers)
  → those portfolios expose typed DPF dependency relationships
      • Foundational  ◀── depended on by
      • Manufacturing & Delivery  ◀── delivers
  → the populated operating model GROUNDS WWWD decisions (concrete nouns, not narrative)
  → gaps + lifecycle transitions in the operating model FAN OUT into the backlog
  → Build Studio executes the engineering; the operating model drives the business backlog
```

The historical design hypothesis is that external-value and workforce roles depend on shared
Foundational and specialized Manufacturing and Delivery realization. The current FPAW standard
supersedes this simplified hierarchy with typed, directional dependencies and permits an explicit
non-applicability/Gap result. The customer-line-of-sight objective remains DPF-owned design intent,
not a verified G252 claim.

### 2.1 Relationship to the existing maturity spec

This spec and the [Four-Portfolio Maturity](2026-05-21-four-portfolio-agent-control-plane-maturity-design.md) spec are **complementary, not overlapping**:

| | Maturity spec (2026-05-21) | This spec (BOM wiring) |
|---|---|---|
| **Subject** | DPF's own agent control plane capabilities | Each customer company's business offer & workforce |
| **Scope** | `dpf_dogfood` / `canonical` (the recursion) | `customer_overlay` / `canonical` (generalization to all businesses) |
| **Question** | "How mature is *our* capability vs. a vendor category?" | "What does *this company* sell, who does the work, and what's the gap?" |
| **Drives** | Investment/operations/productization of the platform | Population of the two business portfolios + business backlog |
| **Shared substrate** | The four-portfolio taxonomy, `Portfolio`, `EaElement`, evidence ledger, backlog fan-out |

The maturity spec measures DPF's portfolios; this spec **populates every customer's** two business portfolios so they have something to measure. They meet at the portfolio taxonomy and the backlog fan-out model.

## 3. Current-State Verification

Originally grounded at `1470ea1c`; **refreshed 2026-07-04 against `origin/main` `bebeb339c`** (≈900 commits later). Verdicts below carry a `[LANDED]` / `[unchanged]` tag where the state moved since authoring (see §0 Update Log for the landed items).

- **Portfolios:** `packages/db/data/portfolio_registry.json` defines exactly four roots: `foundational`, `manufacturing_and_delivery`, `for_employees`, `products_and_services_sold` (registry schema `2.2.0`). The roots are grounded in operator direction and DPF's registry; exact equivalence to IT4IT Reference Architecture or DPPM guide sections is not asserted by this historical record. `[unchanged]`
- **Archetype decomposition:** `packages/storefront-templates/src/activation-profile.ts` `readActivationProfile()` normalizes a `PortfolioDecomposition` (roles `foundational | manufactureAndDeliver | forEmployees | productsAndServicesSold`, scope `absent | minimal | standard | primary`). **Now persisted** to `BusinessContext.portfolioDecomposition`, seeded once from the archetype by `apps/web/lib/onboarding/seed-portfolio-decomposition.ts` then operator-refinable; `resolvePortfolioDecomposition()` prefers the persisted value. `[LANDED — BI-2D452667]`
- **Products portfolio:** `DigitalProduct.portfolioId` FK; `DigitalProduct.lifecycleStage` (default `"plan"`) and `DigitalProduct.bomDocuments` relation exist; routes `/portfolio/products/[productId]`; API `apps/web/app/api/v1/portfolio/[id]/products`. `ServiceOffering` model exists (`digitalProductId` FK, SLA/OLA refs, `consumers`). Still **no archetype→offer seeding for customer offers.** `[partly-landed: lifecycle field now exists → §4.1 / §11-Q1]`
- **Employees:** `EmployeeProfile` (schema ~284–371) with department/position/manager; `/employee` route. **Still no portfolio FK.** `[unchanged — Facet B gap, §4.2]`
- **AI agents:** `Agent` (schema ~2196–2243) already carries `portfolioId`, `valueStream`, `it4itSections`, `humanSupervisorId`, `hitlTierDefault`, `escalatesTo`, `delegatesTo`, `lifecycleStage`; relations `governanceProfile`, `executionConfig` (model, `dailyTokenLimit`, `perTaskTokenLimit`, memory), `toolGrants` (`AgentToolGrant`), `skills`, `coworkerNeeds` (`CoworkerCapabilityNeed`). Baseline reads via `COWORKER_READ_BASELINE_GRANTS` (`apps/web/lib/tak/agent-grants.ts`). `[unchanged]`
- **Identity convergence:** `Principal` + `PrincipalAlias` is the convergence target (`docs/professions/data-architect/wiki/principal-convergence.md`). `User` and `Agent` are pre-2026-05-09 parallel tables not yet converged. `[unchanged]`
- **WWWD:** `seedOrgWwwdCorpus` seeds 4 pages + an org `DecisionPerspectiveProfile`. **Resolver now landed:** `resolveProfileMaterialForOrg()` / `resolveOrgProfileId()` (`apps/web/lib/decision-perspective/material.ts`) resolve by `ownerOrganizationId`; `evaluateOrgBusinessDecisionGate()` (`org-business-gate.ts`) governs business decisions and records to the `DecisionInteraction` ledger; exposed as the `evaluate_org_business_decision` MCP tool (`org-decision-pack.ts`). Operator surfaces shipped (EP-0AF96937: `/wiki`, `/wiki/review`, `/wiki/stance`, `/wiki/matrix`). Active enrichment direction: **EP-CORPUS-BOOTSTRAP**. `[LANDED — BI-230C9EF7 / EP-8AF1C996 + EP-0AF96937]`
- **Backlog:** `BacklogItem` (FKs: `digitalProductId`, `taxonomyNodeId`, `epicId`), `Epic`, `EpicPortfolio` junction. Still **no archetype/business-context generation path.** `[unchanged — the §7 fan-out gap]`

**Live epic anchors to fan into (prefer over new epics):** `EP-CORPUS-BOOTSTRAP`, `EP-BIZ-CAP` (business capability map, taxonomy, employee work), `EP-WWMD-MCP` (decision-surface consolidation), `EP-AI-WORKFORCE-001` (AI workforce consolidation), plus the portfolio-ops epics.

## 4. The Business Operating Model (BOM)

The BOM is the structured, top-down answer to *"what is this company, operationally?"* It is **not a new table family**; it is the disciplined population + linkage of existing substrate, organized as four operating-model facets that map 1:1 to the four portfolios. The two business-critical facets are the focus of this spec.

### 4.1 Facet A — Products & Services Sold (the market offer; DPPM "Provided Externally")

The line-of-sight anchor. Everything else justifies its existence by tracing up to here. *(Full layered decomposition — abstract/commercial/running split, SBOM graph, unit economics, value-stream lifecycle — in §12.1.)*

**What it contains, per company:** the company's actual revenue-generating offerings — for a clinic,
appointment/treatment lines; for retail, product categories/SKU lines; for an MSP, the service
catalog; for DPF itself (the recursion), the portal/agent control plane. The current implementation
represents these through `ProductLine → Product → ProductOffering → CatalogItem`. A linked
`DigitalProduct` is a digital realization or qualifying digital-product facet, not the universal
type of every commercial offer. `ServiceOffering` remains the commitment surface of a
DigitalProduct-provided service; it is not a substitute for the commercial ProductOffering.

- **Distinct lifecycles:** the business Product/Offering lifecycle belongs to the commercial
  hierarchy. The IT4IT Reference Architecture governs only the explicitly linked DigitalProduct lifecycle. The 2026-07-04
  finding that `DigitalProduct.lifecycleStage` exists remains valid for that digital aspect, but it
  is not the lifecycle field for every good or service sold.
- **Consumer domain** (who buys it) — links to the WWWD `who-we-serve` corpus.
- **Bill-of-realization links:** which Workforce, Manufacturing and Delivery, Foundational,
  DigitalProduct, physical-resource, partner, data, and control aspects realize the offer. SBOM is
  one digital-release artifact within that wider dependency graph.

**Seeding (top-down):** the archetype's `PortfolioDecomposition.productsAndServicesSold` scope plus `archetype-business-context.ts` profiles seed *starter offerings* the operator confirms/edits — the same "feels understood on day one, fully editable" discipline already used for the WWWD pages. A `healthcare-wellness` install lands with appointment/treatment offering stubs; `retail-goods` with product-line stubs.

### 4.2 Facet B — Workforce / "For Employees" (humans **and** AI agents; DPPM "Provided Internally" + the workforce itself)

Mark's reframe: "Employees" is too narrow because it excludes the AI agent workforce. *(Full five-block agent record — Identity/NHI, Capability, Management, Governance, Planning — in §12.2.)* This facet has two halves that the current code keeps separate and that this spec unifies under the portfolio lens:

1. **The workforce identities** — *who/what does the work*: humans (`User` → `EmployeeProfile`) **and** non-human identities (`Agent`). The unification target is **Principal convergence**: both resolve to a `Principal` with workforce attributes, so the portfolio can show one workforce spanning both populations.

2. **What the workforce needs to be successful and contribute** — for humans: role, department, manager, tools, access; for AI agents the substrate *already exists* and must be surfaced as first-class portfolio data:
   - **Tools** → `AgentToolGrant` + `COWORKER_READ_BASELINE_GRANTS` (what it's allowed to do)
   - **Tokens / budget** → `AgentExecutionConfig.dailyTokenLimit` / `perTaskTokenLimit` / model assignment (what it can spend)
   - **Skills** → `AgentSkill` (what it knows how to do)
   - **Supervision & escalation** → `humanSupervisorId`, `escalatesTo`, `hitlTierDefault`, `delegatesTo` (how it's governed)
   - **Value-stream alignment** → `valueStream`, `it4itSections` (where it fits in the operating model)
   - **Unmet needs** → `CoworkerCapabilityNeed` (the gap signal — what it's missing to contribute fully)

**The key move:** treat the AI agent workforce exactly like the human workforce in this portfolio — a roster with roles (value streams), needs (tools/tokens/skills), supervisors, and unmet-need gaps. A non-human identity that lacks a grant, a token budget, or a skill it needs for its value stream is a **workforce gap** — and (Facet B → §7) a backlog item, just like an unfilled human role.

**Wiring gaps to close:** (a) link `EmployeeProfile` and `Agent` to `portfolioId = for_employees`; (b) a unified workforce roster view spanning both populations (gated on Principal convergence for the shared identity root, but presentable before convergence via a union projection); (c) surface `CoworkerCapabilityNeed` + human role gaps as the portfolio's "needs" lens.

> **Naming:** the canonical registry key stays `for_employees` (no churn to `portfolio_registry.json`), but the operator-facing label becomes **"Workforce"** (or "Workforce & Internal Enablement"), with a `displayShort` per the maturity spec's §12.4 label-fit invariant. The DPPM "Provided Internally" digital products (the tools the workforce *consumes*) and the workforce *identities themselves* both live here — consumer and contributor in one portfolio.

**2026-07-04 implementation amendment.** The `for_employees` root now explicitly includes AI coworkers as workforce peers, not only human employees. Structural backlog attribution follows this order for AI coworker work: `DigitalProduct` first, `TaxonomyNode` second, linked `CoworkerCapabilityNeed.agent.portfolioId` third, then `EpicPortfolio` as the broad fallback. New AI coworker capability-need backlog filings and Hive Scout coworker-archetype suggestions resolve to the `dpf-ai-workforce` DigitalProduct under `for_employees/workforce_services`; tax-remittance / paying-taxes work resolves to `dpf-tax-remittance` under `for_employees/financial_management/manage_taxes`. Text-only classification is not a valid association path.

**2026-07-06 terminology amendment.** The `for_employees` root now renders as **Workforce** in the portfolio registry. "For Employees" remains a legacy alias and standards cross-reference only; the canonical slug stays `for_employees` to avoid data churn. This aligns the platform with the standards-facing proposal in [`docs/architecture/2026-07-06-it4it-dppm-workforce-portfolio-white-paper.md`](../../architecture/2026-07-06-it4it-dppm-workforce-portfolio-white-paper.md): the internal portfolio should account for employees, contractors, AI coworkers, robots, non-human identities, and any other accountable actor that performs or approves work.

**2026-07-10 seed invariant.** Root taxonomy-node display names are seeded from `portfolio_registry.json`, not from the legacy `taxonomy_v3.json` row label. The taxonomy keeps stable `for_employees` paths and the legacy "For Employees" cross-reference, while the platform-facing root renders as **Workforce** after self-upgrade reseeds the live install.

### 4.3 Facets C & D — Foundational and Manufacturing & Delivery (the dependency floor)

Out of primary scope for this spec, but named because the two business facets **decompose into them** (the DPPM dependency chain). Each offering in Facet A and each workforce capability in Facet B declares what Foundational and Manufacturing & Delivery elements it depends on. This reuses the maturity spec's `dependsOn` DAG discipline (§10.3) at the *business* layer: an offer's effective deliverability is bounded by the maturity of the foundational + delivery elements it rests on.

## 5. Grounding WWWD on the Operating Model

This is how WWWD matures. Today WWWD recall (`recallWikiContext`) returns four narrative stance pages plus any operator-authored stance (`/wiki/stance`). The maturation path:

1. **~~Land the org-profile resolver (BI-230C9EF7).~~ ✅ LANDED (EP-8AF1C996).** The Gate now resolves by `ownerOrganizationId` — `resolveProfileMaterialForOrg()` / `evaluateOrgBusinessDecisionGate()` run business decisions against the org profile instead of falling back to `mark-dpf-platform`, recording each to the `DecisionInteraction` ledger and exposed as the `evaluate_org_business_decision` MCP tool. The precondition is met: WWWD *governs*. **What remains is step 2 — giving it concrete operating-model facts to govern *with*.** Aligns with the decision-surface consolidation plan (2026-05-30): one Gate, WWWD for business decisions, WWMD for platform decisions.

2. **Promote operating-model facts into the WWWD corpus as structured material. — the live frontier of this spec.** Extend `seedOrgWwwdCorpus` / the EP-CORPUS-BOOTSTRAP `enrichOrgCorpus(input)` contract so the populated portfolios become `PerspectiveMaterial`:
   - the market offer (Facet A) → "what we sell / our offerings" material
   - the workforce (Facet B) → "who does our work / our capacity & constraints" material
   - goals/OKRs (captured top-down) → "what we're trying to achieve" material
   This turns WWWD from *stance text* into *stance text grounded in concrete operating facts*, so a WWWD decision can cite "this offering's lifecycle stage" or "we have no workforce covering this value stream" — concrete, the way WWMD cites concrete principles.

3. **Goals as first-class top-down input.** The WWWD layer "is predicated on knowing the goals of the company" (Mark). Capture company goals/objectives during onboarding + continuous enrichment as a dedicated corpus facet, linked to the portfolios they bear on. Goals are the leadership signal that prioritizes which portfolio gaps become backlog (§7).

## 6. Top-Down Capture: where the business direction comes from

The BOM is seeded and refined from the same multi-source pipeline EP-CORPUS-BOOTSTRAP already defines (`enrichOrgCorpus`), extended to populate portfolios, not just wiki pages:

| Source | Feeds | Trust |
|--------|-------|-------|
| Archetype + business-context form (top-down, leadership) | Starter offerings (Facet A), portfolio decomposition scope, mission/goals | High — operator-confirmed |
| Operator/coworker Q&A | Offering details, workforce roles, goals refinement | High |
| Uploaded docs (business plan, service catalog, org chart) | Offering extraction, workforce roster, goals | Medium — derived, reviewable |
| AI-coworker research | Market/offer benchmarking, role benchmarking | Low — human review before authoritative |
| Connected systems of record (QuickBooks, HRIS, ERP — `boundary_adapter`) | Real offerings (invoiced items), real workforce (HRIS), supply chain | High — first-party, but adapter-attributed |
| Coverage gaps discovered in usage | Missing offerings, missing workforce, unmet agent needs | Signal → backlog |

All of it lands through the *one governed corpus contract* (EP-CORPUS-BOOTSTRAP §2), with provenance, evidence grading, dedup, freshness, and human review of low-trust material. **No new corpus store.** External systems stay conduits per the *DPF-as-integration-conduit* principle — customer brings their own account/creds; DPF never enrolls as partner.

## 7. Backlog Fan-Out — making the business side autonomous

This is the payoff: the business backlog becomes a *generated* artifact, the way the engineering backlog is. The operating model is the generator.

**The dispatcher is the Business Capability Map (§12.3, `EP-BIZ-CAP`).** Industry convergence (TOGAF, Gartner SPM, SAFe, OKR cascades) makes the capability map the bridge object between strategy and the two portfolios: heat-map each capability (target − current); a gap closeable by hiring/upskilling/configuring-an-agent routes to **Workforce** backlog, a gap closeable by building/buying routes to **Products & Services** backlog. Prioritization composites three top-down scorers — **WSJF** (cost-of-delay × theme-alignment ÷ size), **MoAR** (objective contribution ÷ effort), and **capability-gap magnitude** — drawing against **adaptive funding guardrails per theme/portfolio**, not annual budgets. Generated items are **problems/outcomes, not prescriptive features** (Build Studio owns solution discovery), and are **proposed, never auto-committed** (PAR gate; AI prioritization is 70–85% accurate, so governance-gated by design).

**Substrate note (2026-07-04 audit — reuse, do not invent):** `BacklogItem` already carries the fields this fan-out needs — `status` (a `"proposed"` value, no new state table), `portfolioId` (the portfolio link), `source` (origin provenance), `proposedOutcome` (the problems/outcomes framing), and `digitalProductId` / `taxonomyNodeId` FKs for offering-origin items. The only residual gap is a *typed* originating-element reference for **non-offering** origins (a workforce gap on `Agent`/`EmployeeProfile`, a goal) — audit whether `source` string-encoding suffices or a polymorphic ref is warranted before adding a column (`schema-audit-before-features`).

**Generation rules (each produces a *proposed* `BacklogItem` linked to its portfolio + the originating operating-model element):**

| Operating-model condition | Generated backlog |
|---|---|
| Offering in Facet A with no delivery path in Manufacturing & Delivery | "Stand up delivery for `<offer>`" |
| Offering with no Foundational dependency satisfied | "Provision foundational `<dep>` for `<offer>`" (DPPM dependency hole) |
| Offering lifecycle transition due (idea→designed, live→retiring) | Lifecycle-advancement work |
| Workforce gap: a value stream an offer needs has no human/agent assigned | "Assign/hire/configure workforce for `<value stream>`" |
| AI agent `CoworkerCapabilityNeed` unmet (missing grant/token/skill) | "Grant/budget/skill `<agent>` to contribute to `<value stream>`" |
| Goal with no portfolio activity advancing it | "No initiative serves goal `<goal>`" — the top-down accountability gap |
| Portfolio concentration skew (one portfolio doing all the work) | Investment signal per maturity spec §12.3 |

**Prioritization is WWWD-governed:** which generated items become active backlog is a *business decision*, run through the Gate against the org profile (WWWD) using the goals facet as the weighting input. This closes the loop Mark named — Build Studio is autonomous on *execution*; the operating model + WWWD make the *what-to-build-for-the-business* autonomous (proposed, governed, then handed to Build Studio).

This reuses the maturity spec's §13 backlog fan-out model and the `propose-acknowledge-reassign` discipline: the platform *proposes* business backlog from operating-model gaps; the operator (or WWWD-arbitrated coworker) acknowledges before it becomes active.

## 8. Phased Plan (fan-out, not one build)

Each phase is an umbrella for BIs filed via the governed path (`dpf-file-backlog-item` → size → triage → link epic). Phases are ordered by dependency; early phases unblock later ones.

**Phase 0 — Foundations & decisions (no user-visible change). ✅ SUBSTANTIALLY COMPLETE (2026-07-04).**
- ~~Persist the archetype `PortfolioDecomposition` to the DB~~ — **DONE (BI-2D452667):** `BusinessContext.portfolioDecomposition` + `seed-portfolio-decomposition.ts` + `resolvePortfolioDecomposition()`.
- ~~Land **BI-230C9EF7** (org-profile resolver)~~ — **DONE (EP-8AF1C996):** `resolveProfileMaterialForOrg()` / `evaluateOrgBusinessDecisionGate()` / `evaluate_org_business_decision`.
- Audit — **partly answered:** `DigitalProduct.lifecycleStage` exists (reuse it); `DigitalProduct.bomDocuments` relation exists. **Still open:** whether `bomDocuments` (or `EaElement`) carries the *typed offering→dependency edges* Facet A needs (`CONTAINS`/`DEPENDS_ON`, §12.1.2), or a minimal extension is required. Resolve in the Phase-1 audit (verify-substrate-first; greenfield only on a written audit).
- Anchor epics: `EP-CORPUS-BOOTSTRAP`, `EP-WWMD-MCP`.
- **Net:** Phase 0 no longer blocks — the fan-out now starts at Phase 1 (Facet A population) with the refinable decomposition and the governing org resolver already in place.

**Phase 1 — Products & Services Sold population (Facet A).**
- Archetype-seeded starter offerings (editable) under `products_and_services_sold`.
- Lifecycle stage + consumer-domain + decomposition edges on each offering.
- Operator surface to confirm/edit the market offer (layer on existing `/portfolio` nav per maturity §12.4, not a new sub-route).
- Anchor: `EP-BIZ-CAP`.

**Phase 2 — Workforce portfolio (Facet B).**
- Relabel `for_employees` → "Workforce"; link `EmployeeProfile` + `Agent` to the portfolio.
- Unified workforce roster (humans + NHIs) union projection; AI-agent "needs" lens surfacing tools/tokens/skills/supervision/unmet-needs.
- Anchor: `EP-AI-WORKFORCE-001`, `EP-BIZ-CAP`.

**Phase 3 — WWWD grounding (§5).** *(Resolver precondition already landed — this phase is now purely the grounding half.)*
- Promote Facet A + Facet B + goals into the WWWD corpus as `PerspectiveMaterial` via `enrichOrgCorpus`, and surface them in the shipped `/wiki/stance` / `/wiki/review` governance surfaces rather than a new one.
- Verify business decisions run through `evaluateOrgBusinessDecisionGate` now **cite operating-model facts** (offering lifecycle, workforce coverage), not only stance narrative.
- Anchor: `EP-CORPUS-BOOTSTRAP`, `EP-WWMD-MCP`, `EP-0AF96937`.

**Phase 4 — Business backlog fan-out (§7, §12.3).**
- Business Capability Map as the dispatcher: heat-map capabilities (target − current); gaps route to the Workforce or Products & Services portfolio.
- Operating-model gap detectors → proposed `BacklogItem`s (PAR-gated), framed as problems/outcomes, not features.
- Composite prioritization (WSJF × theme-alignment, MoAR, capability-gap magnitude) against adaptive funding guardrails; WWWD-governed, goal-weighted.
- Hand-off to Build Studio for execution.
- Anchor: `EP-BIZ-CAP`, portfolio-ops epics.

**Phase 5 — Identity convergence (enabler, parallelizable).**
- Converge `User`/`Agent` onto `Principal` so the workforce roster has one identity root (per `principal-convergence`). Presentable before this via union projection; convergence makes analytics/authorization uniform.

## 9. Acceptance Criteria

The design is successful when later implementation can prove:

1. A fresh install's `products_and_services_sold` portfolio is populated with archetype-appropriate, operator-editable offerings — not DPF's software products (unless the install *is* DPF).
2. The archetype portfolio decomposition is persisted and refinable, not recomputed-and-discarded.
3. The "For Employees" portfolio renders as **Workforce**, listing both human (`EmployeeProfile`) and non-human (`Agent`) identities, with the AI-agent needs lens (tools/tokens/skills/supervision/unmet-needs) visible.
4. Business decisions resolve against the **org WWWD profile** (BI-230C9EF7 landed), and WWWD answers cite concrete operating-model facts, not only stance narrative.
5. Operating-model gaps (offering with no delivery, workforce gap, unmet agent need, unserved goal) generate **proposed** backlog items linked to their portfolio and originating element.
6. Backlog prioritization for business items runs through the Gate against the org profile, weighted by captured goals.
7. **No parallel substrate:** every new concept attaches to the current `Portfolio`,
   `ProductLine` / `Product` / `ProductOffering` / `CatalogItem`, `DigitalProduct`, `Principal` /
   `EmployeeProfile` / `Agent`, `WikiPage`, `PerspectiveMaterial`, EA-assessment, and `BacklogItem`
   substrate; any greenfield is justified by a written audit.
8. **Conduit discipline preserved:** external systems (QuickBooks/HRIS/ERP) feed the model as `boundary_adapter` sources with attribution; DPF never becomes a partner/enrollee.
9. Traceability: every Foundational / Manufacturing & Delivery element can trace *up* to a Products & Services Sold offering it serves (DPPM line-of-sight), or is flagged as an orphan.

## 10. Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Fabricated starter offerings read as wrong/insulting on day one | Archetype starters are broad, true, **editable** stubs (same discipline as `archetype-business-context.ts`); operator confirms before they're authoritative. |
| WWWD grounding promotes unreviewed AI-researched claims into doctrine | EP-CORPUS-BOOTSTRAP review gates: low-trust material is human-reviewed before authoritative (§6). |
| Duplicating the maturity spec / parallel taxonomy | §2.1 boundary: this spec *populates* the two business portfolios; the maturity spec *measures* DPF's capabilities. Shared taxonomy, distinct scope (`customer_overlay` vs `dpf_dogfood`). |
| Treating every customer as a software factory | DPPM §10.2 / maturity §10.2: customer `Manufacturing & Delivery` reflects *their* delivery, not Build Studio; `installScope` separation. |
| Backlog spam from naive gap detection | PAR-gated proposals + WWWD/goal-weighted prioritization; nothing auto-activates. |
| Identity convergence is a large dependency that blocks the workforce view | Workforce roster ships on a union projection *before* convergence; convergence is a parallel enabler (Phase 5), not a blocker. |
| Relabel churn on `portfolio_registry.json` | Keep canonical key `for_employees`; change only the display label + `displayShort`. |
| Persisting decomposition conflicts with runtime `readActivationProfile` | Persisted value becomes the source of truth; runtime computation becomes the *seed* on first install, then refinable (seed-is-bootstrap discipline). |

## 11. Open Decisions for the Implementation Plan

1. ~~Does `DigitalProduct` carry offering **lifecycle stage** and **decomposition/SBOM edges**?~~ **Partly answered (2026-07-04 audit):** `DigitalProduct.lifecycleStage` exists (reuse, don't add) and a `bomDocuments` relation exists. **Still open:** does `bomDocuments`/`EaElement` model the *typed* offering→dependency edges (`CONTAINS`/`DEPENDS_ON`/`BUILD_TOOL_OF`, §12.1.2), or is a minimal extension required?
2. Is the unified workforce roster a DB view, a union projection in a loader, or does it wait for Principal convergence? (Recommend: union projection now, converge later.)
3. Where do **company goals/OKRs** live — a new `WikiPage` pageKind (`goal`), `PerspectiveMaterial`, or an existing objectives model? (verify-substrate-first.)
4. Does business-backlog fan-out reuse the maturity spec's gap→backlog mechanism directly, or need a business-specific generator? (Prefer reuse.)
5. Which `/portfolio` sub-tab anchors the market-offer and workforce surfaces (maturity §12.4 layer-on-existing-nav requires re-use, not a new sub-route)?
6. ~~How is the persisted portfolio decomposition reconciled with `readActivationProfile()` on re-install/upgrade?~~ **Partly answered:** `resolvePortfolioDecomposition()` treats the persisted `BusinessContext.portfolioDecomposition` as source of truth and the archetype computation as first-install seed/fallback (seed-is-bootstrap, matching §10's mitigation). **Still open:** the upgrade path when the archetype template's default decomposition changes after an operator has refined theirs (merge vs. leave-refined-untouched).

Q1, Q6 are now partly answered by the 2026-07-04 audit (see §0). Q2–Q5 resolve in the implementation plan; the Phase-1 audit closes the residual typed-edge question in Q1.

---

## 12. Industry-Grounded Facet Decomposition (2024–2026 research)

This section deepens the two business-critical facets and the strategy→backlog engine with the current external state of the art, so the implementation BIs carry concrete structure rather than re-derive it. Sources are listed in §13 and tagged inline as `[Sn]`. Lineage hypothesis: the Digital Product backbone in the IT4IT Reference Architecture relates to Open Group White Paper **W205, *The Shift to Digital Product* (Bodman & Warfield, 2020)** `[S3f]`; authoritative lineage still requires the applicable source-use and external review.

### 12.1 Facet A — Products & Services Sold: layered decomposition

The original draft asserted exact cross-framework convergence and an object-to-IT4IT-stream table.
That table is superseded and removed because this historical record does not carry a conforming
SourceUseDecision or authorized-edition review for those correspondences. The current FPAW authority
independently distinguishes BusinessProduct, ServiceDefinition, typed Offering, DigitalProduct,
DigitalProductRelease, engagement/contract, and runtime/service instance. Any IT4IT, SID, or CSDM
binding is now explicit, versioned, evidence-backed, and separately rights-governed rather than
inherited from the removed table.

**12.1.1 Service split (do not skip).** SID's signature insight, echoed by CSDM: split the service layer into **Customer-Facing Service (CFS)** vs **Resource-Facing Service (RFS)** `[S1a]`. The same internal service can back multiple sold offerings; modeling them as one hides cost and reuse. For DPF this is the join between a customer offer (Facet A) and the Foundational/Manufacturing capabilities it rests on (Facets C/D) — the dependency edge that gives "IT" line of sight to the customer.

**12.1.2 Decomposition & SBOM.** A Digital Product decomposes recursively into sub-products/components; granular artifacts (repos, microservices, API endpoints) are themselves managed products `[S1c]`. Adopt the SBOM model the industry standardized on (CycloneDX 1.6/1.7) `[S1d]`:
- **Typed relationship edges**: `CONTAINS`, `DEPENDS_ON`, `BUILD_TOOL_OF` — a graph, not a flat list.
- **Internal-vs-external dependency flag** — external deps are the supply-chain risk surface (ties to the WWWD `supply-chain` corpus page already seeded).
- **Stable component identity**: version + hash + **PURL** (package URL — the cross-ecosystem identifier).
- SBOM as an attachable artifact per Release/Instance, so the sold portfolio inherits vulnerability/license exposure from its bill of materials.

**12.1.3 Unit economics per offering.** Capture **both sides** so margin is derivable — the single most valuable metric for this portfolio `[S1d]`:
- **Cost** via the TBM taxonomy (Cost Pools → IT Towers → Products & Services → Consumers), giving product TCO; FinOps supplies real-time cloud consumption inside the Operate stream `[S1d-tbm][S1d-finops]`.
- **Revenue** via SID `ProductOfferingPrice` attached to the Offer.
- **Consumer/allocation dimension** with a **showback-vs-chargeback flag** per consumer relationship (internal BU *or* external customer).

**12.1.4 Lifecycle review is continuous.** DPF should store `last-evaluated` / `last-reviewed`
timestamps for its governance loop and an explicit **Retire/Sunset** terminal state. The original
draft's exact IT4IT value-stream and retirement assertions are not retained; external equivalence is
governed by FPAW mappings against an authorized edition.

### 12.2 Facet B — Workforce: the five-block agent record

2025 was the year **Non-Human Identity (NHI)** became its own security category (OWASP/CSA NHI Top 10, June 2025; PCI DSS 4.0 NHI requirements mandatory March 2025) `[S2a]`. The dominant pattern: model an AI agent's workforce record with **five attribute blocks that mirror a human employee record** `[S2-net]`. DPF's existing `Agent` substrate already carries most of these — the work is surfacing them under the Workforce portfolio lens and filling gaps.

| Block | What it captures (agents) | Standards / vendor pattern | DPF substrate today | Gap |
|-------|---------------------------|----------------------------|---------------------|-----|
| **1. Identity (NHI)** | crypto ID bound to a **named human owner at registration**, credential type/issuer/expiry, scoped access, **delegation chain** ("acting on behalf of"), lifecycle state + kill-switch | Entra Agent ID; Okta/Auth0 for AI Agents (token vault); SPIFFE/SPIRE; OAuth Token Exchange (RFC 8693) `[S2a][S2-net]` | `Principal`/`PrincipalAlias`, `humanSupervisorId` | converge `Agent`→`Principal`; persist credential/expiry + delegation |
| **2. Capability (job + toolkit)** | model assignment (+fallback, **don't hard-pin**), **tools (MCP servers)**, skills, memory store + scope, **token/compute budget**, guardrails | MCP (donated to Linux Foundation / Agentic AI Foundation, Dec 2025) `[S2b]` | `executionConfig` (model, `dailyTokenLimit`, `perTaskTokenLimit`, memory), `toolGrants`, `AgentSkill` | surface as a per-agent **capability manifest** = the job description |
| **3. Management (org placement)** | supervising human / **"manager of agents"**, team/value-stream, **HITL tier**, escalation path, onboarding status | McKinsey "manager of agents"; Gartner span-of-control `[S2c]` | `valueStream`, `it4itSections`, `hitlTierDefault`, `escalatesTo`, `delegatesTo`, `portfolioId` | place agents in the org chart / value stream alongside humans |
| **4. Governance (accountability)** | **autonomy level** (observe / act-with-approval / autonomous-within-guardrails), criticality/risk labels, audit hooks, **certification cadence** (last/next review), revocation state, guardian-agent coverage | Gartner "Guardian Agents" (Reviewer/Monitor/Protector); **proportional governance — uniform governance fails** `[S2d]` | `governanceProfile`, evidence ledger, grants | **autonomy-level + criticality is the load-bearing field** — build first; add certification cadence |
| **5. Planning (capacity)** | worker-type flag (human/agent/hybrid), **shared skill taxonomy** spanning both, capacity unit + cost (token budget = comp), **activity-level task mapping** | Deloitte activity-based blended planning `[S2e]` | `CoworkerCapabilityNeed` (unmet-need gap signal) | a common capability taxonomy + capacity/cost normalization |

**The three things every governance source independently converges on** `[S2-net]` — make these invariants:
1. **Every agent has a named human owner from registration** (no anonymous/"ghost" identities — the top NHI risk).
2. **Every agent has an explicit autonomy tier** (proportional governance; Gartner warns 40% of enterprises will demote/decommission autonomous agents by 2027 due to governance gaps `[S2d]`).
3. **Every agent has a deprovisioning path** (dormant agents retaining access are the #1 NHI failure mode).

**Maturity honesty** `[S2-flags]`: agent *identity/authentication* is real, standardized, buyable now (MCP, SPIFFE, Entra/Okta). Agent *memory* and *authorization* (vs authentication) have **no settled standard yet** — model them but expect churn. The headline counts (150k agents/enterprise by 2028; 40k NHIs/human) are directional vendor projections, not planning-grade.

### 12.3 The Business Capability Map — the bridge that joins both portfolios and dispatches the backlog

The most important cross-cutting finding. Every strategy-to-execution framework (Gartner SPM, OKR cascades, TOGAF, SAFe LPM, Cagan) converges on one object spine, and the **business capability map is the bridge object and the join key between the two portfolios** `[S4-cap][S4-net]`. DPF already has `EP-BIZ-CAP` for exactly this — this research says make it load-bearing.

```text
Vision (stable, multi-year)
  └─ Strategy / Strategic Themes      ← refreshed quarterly, OKR-formatted   [Cagan, SAFe, Gartner SPM]
       └─ Objectives / Key Results                                            [OKR]
            └─ Business Capabilities  ← THE BRIDGE + portfolio join key       [TOGAF]
                 ├─ heat-map gap (target − current) → capability increment
                 └─ routes to →  Products & Services portfolio  OR  Workforce portfolio
                      └─ Investments / Initiatives (optioned, guardrail-funded) [Gartner SPM]
                           └─ Epics → Backlog items (problems/outcomes, not features) [Cagan]
```

**Why this sharpens §7 (backlog fan-out):**
- **The capability map is the dispatcher.** A capability gap closeable by hiring/upskilling/configuring-an-agent → **Workforce** backlog; closeable by building/buying product → **Products & Services** backlog `[S4-cap]`. This is the precise mechanism that routes operating-model gaps to the right portfolio.
- **Generation is defensible from gaps, not invented.** Heat-map a capability (target vs current); a red/amber capability auto-*proposes* a candidate increment with gap size as a sizing input `[S4-cap]`. This is the most evidence-grounded *generation* path — it has provenance, satisfying DPF's governance-approves-evidence posture.
- **Prioritization = a composite of three proven, top-down scorers** `[S4-okr][S4-safe]`, all computable:
  1. **WSJF** = Cost of Delay ÷ Job Size, where **strategic-theme alignment inflates Cost of Delay** (SAFe) — strategy is a direct multiplier on rank.
  2. **MoAR** = objective contribution ÷ effort (Dragonboat/OKR) — reorders as KR actuals move.
  3. **Capability-gap magnitude** = target − current heat-map (TOGAF).
- **Funding = adaptive guardrails per theme/portfolio, not annual budgets** `[S4-spm][S4-safe]`. Each portfolio gets a funding envelope per strategic theme; the backlog draws against it; reallocation is leadership's main lever. This is the top-down control surface.
- **Generate problems/outcomes, not prescriptive features** (Cagan) `[S4-pom]` — Build Studio owns solution discovery. Auto-generating feature backlogs recreates the "feature factory" the product operating model rejects; generating outcome/problem backlog keeps the human/WWWD decision where it belongs.

**AI's honest role (aligns exactly with DPF's PAR + governance gates)** `[S4-ai]`: empirical adoption of AI for backlog prioritization is ~7.3% today; AI identifies high-priority items 70–85% correctly — so **propose, never autonomously commit**. Ship the proven layer (multi-signal scoring + strategy-alignment filtering + candidate-generation-from-gaps, all governance-gated); pilot but don't yet trust real-time autonomous re-prioritization. **SAFe Lean Portfolio Management is the closest existing end-to-end blueprint** `[S4-safe]` and worth mining directly for the §7 implementation.

### 12.4 Source-use boundary (G252 and IT4IT Reference Architecture text)

Mark Bodman's `CA-MB-2026-08-01-IT4IT-PROVENANCE` attestation records bounded contributor provenance
and direct design direction. It does not supply permission for compiled IT4IT Reference Architecture
or DPPM guide material. Their PDFs, text extracts, and mixed-origin derivative workbooks remain
`excluded` or `undetermined` under the complete FPAW decisions, so they are not successor AI
research, paraphrase, mapping, or verification inputs. Exact published definitions, dependency
figures, external conformance, and criteria require an authorized edition, a complete applicable
SourceUseDecision, and qualified human review. The current FPAW standard owns this source/use policy
and the independently expressed bridge semantics.

## 13. References (industry sources, 2024–2026)

**Facet A — products/services decomposition**
- `[S1a]` TM Forum SID / GB922 Product v19.5.1 — ProductSpecification / ProductOffering / OfferingPrice / CFS-RFS: https://www.tmforum.org/resources/standard/gb922-product-v19-5/
- `[S1b]` IT4IT v3 — Introducing Digital Product (Service Catalog demotion; Offer/Subscription): https://digital-portfolio.opengroup.org/it4it-standard/latest/DigitalProduct/introducingdigitalproduct.html
- `[S1c]` JAVC — Digital Products & Digital Product Instances (recursive decomposition): https://javc.nl/understanding-digital-products-and-digital-product-instances-in-the-it4it-framework/
- `[S1d]` CycloneDX specification (SBOM: components/services/dependencies, PURL): https://github.com/CycloneDX/specification ; CycloneDX vs SPDX (2026): https://sbomify.com/2026/01/15/sbom-formats-cyclonedx-vs-spdx/
- `[S1d-tbm]` TBM Council — TBM Model & Taxonomy: https://www.tbmcouncil.org/framework/tbm-model/
- `[S1d-finops]` FinOps Foundation × TBM Council — coexisting disciplines: https://www.finops.org/wg/finops-tbm-navigating-coexisting-disciplines/
- ServiceNow CSDM 4.0 — Business vs Application vs Technical Service: https://www.servicenow.com/community/common-service-data-model/stop-confusing-business-applications-with-business-services-a/ta-p/3439110

**Facet B — AI-agent workforce / NHI**
- `[S2a]` World Economic Forum — Non-Human Identities & AI cybersecurity (OWASP/CSA NHI Top 10, PCI DSS 4.0): https://www.weforum.org/stories/2025/10/non-human-identities-ai-cybersecurity/ ; Microsoft Entra Agent ID: https://learn.microsoft.com/en-us/entra/agent-id/identity-professional/microsoft-entra-agent-identities-for-ai-agents ; Okta for AI Agents (token vault): https://www.okta.com/products/govern-ai-agent-identity/ ; SPIFFE for agentic AI: https://www.hashicorp.com/en/blog/spiffe-securing-the-identity-of-agentic-ai-and-non-human-actors
- `[S2b]` Model Context Protocol → Linux Foundation / Agentic AI Foundation: https://en.wikipedia.org/wiki/Model_Context_Protocol
- `[S2c]` McKinsey — The future of work is agentic ("manager of agents"): https://www.mckinsey.com/capabilities/people-and-organizational-performance/our-insights/the-future-of-work-is-agentic ; Gartner agent-sprawl/span-of-control: https://www.gartner.com/en/newsroom/press-releases/2026-04-28-gartner-identifies-six-steps-to-manage-artificial-intelligence-agent-sprawl
- `[S2d]` Gartner — Guardian Agents: https://www.gartner.com/en/newsroom/press-releases/2025-06-11-gartner-predicts-that-guardian-agents-will-capture-10-15-percent-of-the-agentic-ai-market-by-2030 ; uniform governance fails: https://www.gartner.com/en/newsroom/press-releases/2026-05-26-gartner-says-applying-uniform-governance-across-ai-agents-will-lead-to-enterprise-ai-agent-failure ; SailPoint agent governance: https://www.sailpoint.com/blog/sailpoint-framework-governing-ai-agents
- `[S2e]` Deloitte — autonomous/blended workforce planning: https://www.deloitte.com/us/en/insights/topics/talent/future-of-workforce-planning/autonomous-workforce-planning.html

**IT4IT v3 / DPPM**
- `[S3b]` IT4IT v3 — The Seven Value Streams: https://digital-portfolio.opengroup.org/it4it-standard/latest/DigitalManagement/seven-it4it-value-streams.html
- `[S3c]` IT4IT v3 — Digital Product backbone / functional components & data model: https://digital-portfolio.opengroup.org/it4it-standard/latest/DigitalManagement/functional-components-and-data-model.html
- `[S3f]` Open Group W205 — *The Shift to Digital Product* (Bodman & Warfield, 2020): https://publications.opengroup.org/white-papers/w205
- `[S3-verify]` IT4IT v3.0.1 [public product page](https://publications.opengroup.org/c24a), bibliography/high-level scope only; precise verification requires an authorized edition, SourceUseDecision, and qualified human reviewer

**Strategy → capability → backlog**
- `[S4-spm]` Gartner — Strategic Portfolio Management (2025 MQ / Critical Capabilities): https://www.gartner.com/en/documents/5468395
- `[S4-okr]` Dragonboat — Product OKRs & MoAR: https://dragonboat.io/blog/product-okrs/
- `[S4-cap]` TOGAF — Business Capability Planning: https://pubs.opengroup.org/togaf-standard/business-architecture/business-capability-planning.html
- `[S4-pom]` SVPG — The Product Operating Model (*Transformed*, 2024): https://www.svpg.com/the-product-operating-model-an-introduction/
- `[S4-safe]` SAFe — Lean Portfolio Management & Strategic Themes / WSJF: https://agility-at-scale.com/practices/lean-portfolio-management/
- `[S4-ai]` "The great divide" — empirical study, AI vs traditional backlog prioritization (2026): https://www.sciencedirect.com/science/article/pii/S2590005626002183
