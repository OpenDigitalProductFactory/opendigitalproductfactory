---
status: approved
---
# Portfolio-shaped information architecture — design

**Status:** operator-directed implementation slice · amended 2026-08-28
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

### 4.2 First slice — one AI Coworkers home inside Workforce

The original “group the existing routes” slice is too weak. Live operator evidence on 2026-08-28 showed the failure mode: self-upgrade reported an AI coworker working, its generic link opened a live-only activity page that was already empty, and identity versus operational details were split between the top-level **AI Coworkers** and **AI Workforce** destinations. Finding the complete picture took roughly ten minutes.

The slice therefore establishes `/workforce` as the one canonical AI Coworkers home:

- the directory remains the front door and every row still opens the coworker's identity;
- current and retained recent activity are part of the same page, not a competing platform-admin destination;
- live and recent activity cover every governed AI actor that can block an upgrade, even when that actor's registry type is `specialist` rather than `coworker`;
- a skipped self-upgrade persists the blocker task-run identity, actor identity, title, and capture time in its existing completion-evidence envelope, then deep-links to that retained activity;
- provider/routing, skills, scheduling, governance, and build-runtime controls remain advanced links from this home and from an individual identity; they are not another top-level roster;
- `/platform/ai/right-now` remains a compatibility deep link into the activity view, while the primary navigation exposes only the canonical home.

The activity view distinguishes identities from execution envelopes:

- **Coworkers** are the governed roster identities the organization can configure, schedule, and supervise.
- **External & platform work** is governed activity from Codex/Claude/Grok desktop sessions, Build Studio, specialists, and native runtimes, projected through their Workrooms and TaskRuns. It is visible in the same journey but is never relabeled as a roster coworker.
- **Usage reconciliation** derives from TokenUsage and reports roster, external/specialist, and unattributed buckets. A missing join is an explicit limitation, not permission to infer a Workroom from timing or prompt text.
- **Workroom detail** is the context boundary: objective, executor, branch/build context, activity journal, evidence, and status. An inventory link using a semantic `WC-*` identity must resolve to that same projection.
- **Operations Map history** is the deeper replay altitude. Its selected time window is explicit, URL-addressable, and traversable backward/forward so the operator can investigate an earlier load spike without dragging an unlabeled scrubber across months of evidence.

This is still one concern: an operator must be able to answer “which AI coworker is this, what is it doing, and how do I manage it?” without choosing between identity and operations taxonomies. It reuses the existing roster, workforce-activity, TaskRun, self-upgrade evidence, and navigation models; no new registry or event store is introduced.

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

The 2026-08-28 amendment also benchmarked current agent-management control planes:

- **Microsoft Agent 365.** Its Agent Registry is the central inventory and management surface, while its all-agents activity view keeps in-progress and recent completed work together and drills from an agent into activity details. Microsoft is explicitly converging previously separate registry experiences into one control plane. Adopt the unified inventory→activity journey and retained recent tasks. Reject copying the remaining split into a separate identity-admin portal: DPF already has one canonical agent record and can disclose its advanced identity controls in context. Sources: [Agent Registry](https://learn.microsoft.com/en-us/microsoft-365/admin/manage/agent-registry?view=o365-worldwide), [agent activity](https://learn.microsoft.com/en-us/microsoft-agent-365/observe-agents-microsoft-365-copilot), [registry convergence](https://learn.microsoft.com/en-us/entra/agent-id/agent-registry-convergence).
- **ServiceNow AI Control Tower.** It unifies inventory, performance/value, risk, and governance around each AI system, agent, and workflow. Adopt one fleet cockpit with progressive disclosure for operational and governance detail. Reject a KPI-first landing that displaces the human-readable coworker directory; DPF's operator begins with “who,” not an abstract asset inventory. Source: [AI Control Tower solution brief](https://www.servicenow.com/content/dam/servicenow-assets/public/en-us/doc-type/resource-center/solution-brief/sb-ai-control-tower.pdf).
- **Microsoft's agent tools registry.** Tools and MCP servers are centrally governed but remain a nested tools concern under Agents. Adopt advanced links nested from the coworker home; reject making Tools, Providers, or Build Runtime competing roster destinations. Source: [Agent Tools registry](https://learn.microsoft.com/en-us/microsoft-365/admin/manage/manage-tools-for-agent?view=o365-worldwide).

**Amended stance:** the canonical object is the AI coworker. Inventory, current/recent work, identity, cost, and ordinary controls converge around it; fleet plumbing is disclosed from that home. Operational evidence must outlive the instantaneous live-state window that produced it.

The 2026-08-31 operator-activity amendment benchmarked execution and observability control planes:

- **Langfuse sessions and traces.** Langfuse models observations as individual steps, traces as one request/agent run, and sessions as the grouping for multi-trace interactions; its metrics retain cost and token breakdowns by session, user, model, and feature. Adopt the hierarchy: routed calls remain observations, TaskRuns remain execution units, and Workrooms group the governed multi-step context. Reject installing Langfuse or copying its data into a second ledger; DPF already owns the canonical evidence. Sources: [data model](https://langfuse.com/docs/observability/data-model), [sessions](https://langfuse.com/docs/observability/features/sessions), [metrics](https://langfuse.com/docs/metrics/overview).
- **GitHub Actions run history.** GitHub presents recent and completed workflow runs in one list, then drills into a run summary, job graph, steps, and logs. Adopt current+historical continuity and stable detail drill-through. Reject a build-specific activity taxonomy: DPF's Workroom spans every execution surface. Sources: [run history](https://docs.github.com/en/actions/how-tos/monitor-workflows/view-workflow-run-history), [visualization graph](https://docs.github.com/en/actions/how-tos/monitor-workflows/use-the-visualization-graph).
- **Grafana time controls.** Grafana makes relative/absolute ranges, zoom, reset, refresh, and URL-carried `from`/`to` values first-class; current releases also support stepping a full time span backward or forward. Adopt presets, exact window labeling, bounded stepping, and shareable window state. Reject dashboard-global complexity and arbitrary query syntax on this owner-facing surface. Sources: [dashboard time controls](https://grafana.com/docs/grafana/latest/visualizations/dashboards/use-dashboards/), [time-range pan and zoom](https://grafana.com/whats-new/2026-01-15-time-range-pan-and-zoom/).

**Activity stance:** one human journey, three canonical altitudes. AI Coworkers answers *who and what now/recently*; Workroom answers *why, where, and with which evidence*; Operations Map answers *how activity and routing changed over time*. Navigation composes those altitudes rather than merging their models or duplicating their ledgers.

## 6. §1 substrate check (no parallel utilities)

- **No new nav model.** Extends `portal-navigation-model.ts` / `portal-shell-sections.ts`; no second registry.
- **No new taxonomy.** Reuses the FPAW four-portfolio keys already persisted on `PortfolioDecomposition`; adds only a section→portfolio adapter map (the standard already mandates the key adapter).
- **No new mode system.** Reuses the `nav-mode` cookie for operator preview.
- **No new activity ledger.** Recent activity projects existing `TaskRun` rows; self-upgrade retains the exact blocker reference in `SelfUpgradeRun.completionEvidence`.
- **Workroom is the external-execution envelope.** Desktop coding agents and Build Studio remain external/platform executors projected through existing Workroom and WorkroomActivity records, not synthetic coworker identities.
- **Usage gaps stay visible.** TokenUsage is reconciled losslessly into known roster, external/specialist, and unattributed buckets; the read model never invents attribution.
- **Actor parity at the safety boundary.** The activity projection covers the same live TaskRun population as the self-upgrade quiescence detector instead of assuming every governed actor has `Agent.type=coworker`.
- **No coherence regression.** Section-scoped nav, breadcrumb, and the one-renderer ratchet are unchanged; only `sectionKey` groupings move.

## 7. Phased plan

| Phase | Deliverable | Size |
|---|---|---|
| 0 | Section→FPAW-portfolio adapter map + trace test asserting every `shellNav` entry resolves to a portfolio or an explicit cross-cut | S |
| 1 | **Workforce unification slice** — one `/workforce` directory + current/recent roster and governed-executor activity; usage reconciliation; compatibility deep links; one primary AI-coworker destination; retained self-upgrade blocker identity; resolvable Workroom detail links; navigable Operations Map history | L |
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
- The primary navigation presents one AI-coworker destination; operators do not choose between “AI Coworkers” and “AI Workforce.”
- `/workforce` moves from fleet status to a coworker identity and ordinary controls without crossing to another main-menu domain; advanced fleet plumbing is nested, not competing.
- Current activity includes every governed TaskRun actor that can block self-upgrade, regardless of whether its registry type is `coworker` or `specialist`.
- Recent activity retains completed/failed/waiting TaskRuns long enough to explain an operational event after live work ends.
- An `activity-in-flight` self-upgrade skip persists and renders the named actor and task-run identity, and its link lands on the matching retained activity.
- `/platform/ai/right-now` remains a non-competing compatibility route into the canonical activity experience.
- Live and recent Workrooms from external/platform executors appear in a clearly labeled lane with objective, executor kind, status, time, and a working detail link.
- TokenUsage totals reconcile into roster, external/specialist, and unattributed buckets without dropping or guessing rows.
- Every `WC-*` inventory link resolves to its matching Workroom detail while legacy encoded case keys continue to work.
- Operations Map offers named time presets, exact start/end, one-window backward/forward movement, reset-to-live, and refresh-stable URL state.
- The reconciled spine is previewable via nav-mode on a live install before it becomes default.
- No regression in the EP-NAV-COHERENCE guarantees (§3), asserted by the existing nav tests plus the new trace test.
