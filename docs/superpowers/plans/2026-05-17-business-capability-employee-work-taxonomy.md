# Business Capability and Employee Work Taxonomy Implementation Plan

> **For agentic workers:** This is a governed planning document — it does not implement runtime product changes. Use superpowers:executing-plans only for the backlog-capture and taxonomy chunks (2–5). Chunk 1 research is already completed; do not re-run it. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a business capability and employee-work taxonomy that connects DPF portfolios, current product surfaces, AI coworkers, and native/external integrations, while expanding QuickBooks parity into a long-tail backlog that can be worked alongside other priorities.

**Architecture:** Use the existing portfolio, taxonomy, backlog, employee, work queue, capability inventory, native integration, and coworker-need models before adding schema. Capture structured context in backlog bodies first; promote fields only after usage proves the shape. Keep provider parity under `EP-INT-2E7C1A` and use portfolio/taxonomy context as classification, not as a replacement for the integration epic.

**Tech Stack:** DPF MCP backlog tools, Next.js 16 app routes, Prisma models in `packages/db/prisma/schema.prisma`, native integration catalog in `apps/web/lib/tools/native-integration-catalog.ts`, docs under `docs/superpowers/plans`.

**Scope guard:** This is a planning/spec thread. It creates the governed backlog capture needed for implementation, but it does not implement runtime product changes.

**Related QuickBooks input:** the QuickBooks small-business OS parity spec and readiness snapshot were inspected from the sibling worktree `D:\DPF-small-business-os-parity`. Current `origin/main` does not yet contain those readiness files, so this plan treats them as approved branch input with a merge-state caveat.

---

## Live Backlog And Source State

The live DPF MCP backlog tools were used first for backlog, epic, and portfolio-context work. During `BI-407125DA`, no DB fallback was used. During `BI-0E6D42B3`, the current-coworker MCP tools existed but failed because this external Codex session has no current coworker `agentId`; direct live PostgreSQL fallback was used only to confirm seeded coworker status and `CoworkerCapabilityNeed` coverage. Seed files were not used as live status.

Initial open epic scan on 2026-05-17 found no dedicated business-capability or employee-work taxonomy epic. A later reviewed/backlog continuation found the dedicated epic now exists:

- `EP-BIZ-CAP` - Business Capability Map / Taxonomy / Employee Work.

Adjacent active containers remain:

- `EP-INT-2E7C1A` - Integration Harness: Benchmarking and Private Deployment Foundation.
- `EP-ARCH-8D4F2A` - Archetype Model V2: Unified Business Archetypes.
- `EP-TAK-3F9A21` - TAK/GAID Refresh: Auth, Agent Identity, and Governed Memory Alignment.

`EP-INT-2E7C1A` already owns connector family benchmarks for finance/payments, CRM/sales, communications, HR/payroll, identity, service desk, knowledge, project/work, and device management. That makes it the right main epic for the integration/provider parity long tail.

Current decision: use `EP-BIZ-CAP` for employee-work taxonomy, capability-to-surface matrix, coworker coverage map, commercial-market taxonomy UX, and backlog context model. `EP-INT-2E7C1A` continues to own provider parity and integration harness work.

The MCP surface available in this session exposed backlog item creation and item-to-epic linking but not a general create-epic tool. `BI-BCCC9C7B` captures that durable MCP gap under `EP-ARCH-8D4F2A`; this taxonomy track is no longer blocked because `EP-BIZ-CAP` now exists.

Follow-up evidence from `docs/Reference/4_portfolio_Reworked_V3_Definitions_IT4IT.xlsx` showed the original taxonomy workbook carries commercial-market and representative-product guidance, especially:

- `Common Commercial Market and Products`
- `Generic Commercial Market and Products`
- sector-specific commercial market/product columns such as banking, insurance, healthcare provider, retail/eCommerce, telecommunications, manufacturing, energy, chemicals, and utilities

That workbook-derived detail is already partly in seeded data. `packages/db/data/taxonomy_v3.json` includes `enrichment.sampleServices`, `enrichment.offeringConsiderations`, and `enrichment.commercialMarket`, and `packages/db/src/seed.ts` writes that object to `TaxonomyNode.enrichment`. Current portfolio taxonomy UX does not show it: `apps/web/lib/portfolio/portfolio-node-view-model.ts` only projects enrichment `standards`, `patterns`, and `references`, and `apps/web/components/portfolio/PortfolioNodeEnrichment.tsx` only renders those fields.

Implication: the gap is not a source-data gap. It is a taxonomy UX/view-model gap that hides market/product intelligence that should help connect capabilities, integrations, and build-vs-buy posture.

Portfolio context search found relevant taxonomy nodes already in live portfolio data:

- `for_employees/develop_and_manage_business_capabilities`
- `for_employees/develop_and_manage_business_capabilities/manage_business_processes`
- `for_employees/evaluate_and_plan_portfolio_investments/review_and_balance_4_portfolios/refine_employee_facing_portfolio_taxonomy`
- `for_employees/evaluate_and_plan_portfolio_investments/review_and_balance_4_portfolios/refine_external_facing_portfolio_taxonomy`
- `for_employees/financial_management/manage_project_accounting`
- `for_employees/financial_management/manage_treasury_operations`

## Current DPF Surface Inventory

### Portfolio And Backlog Spine

Existing models:

- `Portfolio` owns products, agents, work queues, knowledge articles, inventory entities, and epic links.
- `DigitalProduct` links to `Portfolio`, `TaxonomyNode`, `BacklogItem`, feature builds, business models, and work queues.
- `TaxonomyNode` already classifies products, backlog items, inventory, EA elements, and discovery rules.
- `BacklogItem` already has `digitalProductId`, `taxonomyNodeId`, `epicId`, `accountableEmployeeId`, `agentId`, and coworker capability-need links.
- `EpicPortfolio` links epics to portfolios.

Implication: do not create a new taxonomy system first. Use `TaxonomyNode` plus structured backlog context now, then add first-class fields only after the template proves stable.

### Employee And Work Spine

Existing models and surfaces:

- `EmployeeProfile` is already rich: user link, department, position, manager, location, communication bindings, leave, compliance, timesheets, expenses, change ownership, and finance-work ownership.
- `WorkQueue`, `WorkItem`, and `WorkItemMessage` already support queue routing, assignment to users or agents, urgency, evidence, hierarchy, and channel-aware messages.
- `/employee` exists as the employee route.
- Employee communication fabric has shipped or planned channel bindings, delivery attempts, and reachability posture.
- MCP tools already expose employee search/create/status transition, feedback, finance period summaries, marketing metrics, integration search, capability inventory, and coworker capability-needs workflows.

Implication: employee taxonomy should not become another HR portal. It should classify work employees do, the surfaces they use, the coworkers that help them, and the integrations those workflows depend on.

### Native Integration Spine

`apps/web/lib/tools/native-integration-catalog.ts` currently lists these native anchors:

| Integration | Category | Employee jobs supported |
| --- | --- | --- |
| ADP Workforce Now | HR/payroll | HR/payroll admin, bookkeeper/accountant, owner/operator |
| QuickBooks Online | Finance/accounting | Bookkeeper/accountant, owner/operator, sales/admin |
| Stripe Billing & Payments | Payments | Bookkeeper/accountant, sales/admin, owner/operator |
| Microsoft 365 Communications | Communications | Owner/operator, admin assistant, service ops, support |
| HubSpot CRM & Marketing | CRM/marketing | Sales/BD, marketer, customer support |
| Google Marketing Intelligence | Marketing intelligence | Marketer, owner/operator |
| Facebook Lead Ads | Lead capture | Marketer, sales/BD |
| Facebook Pages | Local social presence | Marketer, customer support |
| Google Business Profile | Local presence | Marketer, owner/operator, customer support |
| Mailchimp Marketing | Email marketing | Marketer, sales/BD |

Route inventory confirms native integration pages for ADP, communications, Facebook Lead Ads, Facebook Pages, Google Business Profile, Google Marketing Intelligence, HubSpot, Instagram Business, Mailchimp, Microsoft 365 Communications, QuickBooks, Stripe, and WhatsApp Business.

### Operational Product Surfaces

Current shell route families include:

- Finance: invoices, payments, payment runs, banking, bills, suppliers, expense claims, purchase orders, recurring, reports, close, assets, settings, AI spend.
- Customer: CRM, opportunities, quotes, sales orders, engagements, marketing.
- Storefront: setup, items, sections, inbox, settings, team.
- Employee: employee route and employee actions.
- Workspace: documents and my queue.
- Platform: tools, integrations, services, AI, audit, identity, edge nodes.
- Portfolio: portfolio tree, product detail, backlog, changes, architecture, knowledge, inventory, offerings, team, versions.
- Compliance: obligations, licensing, risks, controls, audits, incidents, evidence.

## External Reference Frame

This taxonomy should use public standards as reference language, not as a rigid implementation template.

- APQC PCF frames a common process language for organization-wide business processes and benchmarking: https://www.apqc.org/pcf.
- O*NET provides role/task/worker-activity language for occupations and HR planning: https://www.dol.gov/agencies/eta/onet.
- BLS SOC provides a federal occupation classification reference: https://www.bls.gov/soc/.
- QuickBooks remains the first accounting anchor because small-business daily work clusters around invoices, expenses, bank reconciliation, tax, reports, payments, and accountant collaboration: https://quickbooks.intuit.com/accounting/.

Adopted pattern: separate process capability, employee role, product surface, integration anchor, and ownership posture. Rejected pattern: one giant "replace QuickBooks" epic with no role or portfolio context.

## Capability Taxonomy

The first taxonomy pass should use these top-level capability families:

| Capability family | Common employee jobs | DPF surfaces | Initial anchors |
| --- | --- | --- | --- |
| Business setup and operating model | Owner/operator, admin | setup, business context, storefront setup, finance settings | QuickBooks, Stripe, ADP, Microsoft 365 |
| Financial management | Owner/operator, bookkeeper/accountant | finance, platform tools integrations | QuickBooks, Stripe |
| Revenue and customer growth | Sales/BD, marketer, owner/operator | customer, storefront, customer marketing | HubSpot, Mailchimp, Google Marketing, Facebook Lead Ads |
| Customer operations and support | Customer support, service ops | customer, storefront inbox, workspace queue | Microsoft 365, WhatsApp Business, Facebook Pages |
| People, payroll, and admin | HR/payroll admin, owner/operator | employee, finance expenses, compliance | ADP, Microsoft 365 |
| Work coordination and communications | Owner/operator, service ops, admin assistant | workspace/my-queue, employee, platform tools integrations | Microsoft 365, WhatsApp Business, future Slack/Teams depth |
| Compliance and risk | Owner/operator, compliance/admin | compliance, finance tax, audit | Licensing/tax authority integrations, Microsoft identity later |
| Portfolio and product operations | Owner/operator, product/service lead | portfolio, backlog, build, knowledge | DPF-native first, external issue/code systems later |
| Inventory, assets, and procurement | Ops, admin, bookkeeper | finance assets, purchase orders, suppliers, inventory | QuickBooks, vendor systems later |

## Capability-To-Surface-To-Integration Matrix

| Employee work | Current DPF coverage | Current surface | Current or missing coworker | Integration anchors | Posture | Smallest buildable slice |
| --- | --- | --- | --- | --- | --- | --- |
| Owner/operator: daily command center | Strong command-center substrate; needs capability vocabulary | `/workspace`, `/workspace/my-queue`, `/platform/ai/authority` | `ops-coordinator`, `portfolio-advisor`, onboarding COO | Cross-domain signals from QuickBooks, Stripe, ADP, HubSpot, Microsoft 365 | Native DPF | Add capability context to readiness/audit findings after the backlog template is proven |
| Owner/operator: portfolio and product investment | Strong portfolio/product/backlog spine | `/portfolio`, product detail, backlog, Build Studio | `portfolio-advisor`, `inventory-specialist`, `ops-coordinator` | External issue/code systems later | Native DPF | Attach employee-work capability context to selected backlog and product records |
| Bookkeeper/accountant: AR, invoicing, collections | Partial finance coverage; QuickBooks read path in progress | `/finance/invoices`, `/finance/payments`, QuickBooks integration page | `finance-agent`, `finance-controller`; missing role-specific bookkeeper/accountant lane | QuickBooks, Stripe | Hybrid now; eventual replacement candidate | Expand read-only QuickBooks customer, invoice, payment, and report coverage |
| Bookkeeper/accountant: AP, vendors, expenses | Partial finance coverage; accounting parity gaps remain | `/finance/bills`, `/finance/suppliers`, `/finance/expense-claims`, `/finance/purchase-orders` | `finance-agent`, `finance-controller`; missing role-specific bookkeeper/accountant lane | QuickBooks; ADP for payroll expense context | Hybrid | Stage vendors, bills, expenses, and payments with source attribution |
| Bookkeeper/accountant: bank rec, tax, close | Finance routes exist; full accounting/close posture is not yet DPF-owned | `/finance/banking`, `/finance/banking/[id]/reconcile`, `/finance/reports`, `/finance/close`, tax settings | `finance-agent`, `finance-controller`; missing reconciliation lane | QuickBooks, Stripe, future bank-feed provider | Integration-led until dual-run evidence | Decide bank-feed source posture, then add reconciliation evidence model |
| Sales/BD: leads to quotes/orders | CRM and storefront coverage exists | `/customer`, opportunities, quotes, sales orders, `/storefront/inbox` | `customer-advisor`; missing sales/BD coworker | HubSpot, Facebook Lead Ads, Google Business Profile, Mailchimp | Hybrid | Normalize lead/source context across storefront inbox and CRM opportunities |
| Marketing: campaigns and local presence | Marketing/customer route and native anchors exist | `/customer/marketing`, Google/Facebook/Mailchimp integration pages | `marketing-specialist` | Mailchimp, Google Marketing, Google Business Profile, Facebook Pages, Instagram Business | Integration-led with DPF orchestration | Add marketing capability rows to the integration coverage matrix |
| Service delivery/operations: work intake and delivery | Strong DPF work/backlog/build foundation; service-delivery vocabulary needs alignment | `/workspace/my-queue`, `/ops`, `/build`, `/customer`, `/storefront/team` | `ops-coordinator`, Build specialist | Microsoft 365, communications fabric, future project/work tools | Native DPF for work; integration-led for channels | Map work queues and storefront team workflows to employee roles |
| Customer support: support and account follow-up | Partial customer/storefront inbox support coverage | `/customer`, `/storefront/inbox`, workspace queue | `customer-advisor`, `service-support-agent`; missing SMB support lane definition | HubSpot, Microsoft 365, WhatsApp Business, Facebook Pages | Hybrid | Define the support lane across intake, queue ownership, customer records, and communications |
| HR/payroll/admin: employees, payroll, access | Employee route and ADP anchor exist; payroll execution remains external | `/employee`, `/platform/tools/integrations/adp`, compliance/admin surfaces | `hr-specialist`; missing payroll specialist | ADP, Microsoft 365 | Integration-led for payroll; native DPF for roles/authority | Map ADP worker/payroll readiness into employee-work taxonomy |
| Inventory/assets/procurement: assets and purchasing | Finance assets, suppliers, POs exist; inventory/procurement depth varies by archetype | `/finance/assets`, `/finance/suppliers`, `/finance/purchase-orders`, inventory/product surfaces | `inventory-specialist`; missing procurement/assets coworker | QuickBooks, vendor systems later | Hybrid | Decide when inventory/procurement is native DPF vs provider-led per archetype |
| IT/security/compliance: evidence, identity, risk | Strong platform/compliance surfaces | `/compliance`, `/platform/tools`, `/platform/ai`, `/platform/edge-nodes`, `/ea` | `platform-engineer`, `licensing-specialist`, `ux-accessibility-agent`, `ea-architect` | Microsoft 365, identity, device, service-desk providers | Native DPF governance with integration-led evidence | Extend coverage matrix to identity, device, service-desk, and licensing anchors |

## Backlog Context Template

Every backlog item in this track should use this context block until first-class fields exist:

```text
Business capability:
Employee roles:
DPF surfaces:
AI coworker:
Portfolio context:
Taxonomy context:
Integration anchors:
Architecture posture: native-dpf | integration-led | hybrid | replacement-candidate
Maturity target: observe | read | stage | operate | write-back | dual-run | dpf-primary
Replacement gate: [leave blank unless posture=replacement-candidate; list gates that must all pass before DPF can claim primary ownership, e.g. "read complete, staged import proven, dual-run comparison clean, accountant evidence collected, export completeness verified, rollback criteria met"]
Smallest buildable slice:
Acceptance:
```

Naming convention:

```text
[Capability family]: [employee job] can [business outcome] via [DPF surface/integration] - [posture/maturity]
```

Examples:

- `Finance: bookkeeper can stage QuickBooks invoices in DPF - read/import-ready`
- `Sales: owner can see HubSpot and storefront leads in one customer pipeline - hybrid`
- `Employee: HR admin can verify ADP worker/payroll readiness - integration-led`
- `Setup: owner can declare books/payments/payroll/tax systems once - observe/read`

## First Backlog Batch Created And Current State

The duplicate check found adjacent taxonomy nodes, docs refresh work, and `BI-INT-A5B9E3`, but not these exact slices. The following minimal batch was created through live DPF MCP, then restored and build-triaged on 2026-05-17 so Scrum Master and Build Studio workflows can sequence them with other priorities.

| Item | Epic | Current status | Purpose |
| --- | --- | --- | --- |
| `BI-407125DA` Capability taxonomy: establish employee-work backlog capture foundation | `EP-BIZ-CAP` | Done | Standardize the context template and decide whether backlog needs schema or manifest fields later. |
| `BI-0E6D42B3` Capability taxonomy: audit employee roles against DPF surfaces, coworkers, and integrations | `EP-BIZ-CAP` | Done | Map employee jobs to DPF surfaces, coworkers, queues, and integrations. |
| `BI-4C166411` Capability taxonomy UX: expose commercial market and product enrichment from taxonomy nodes | `EP-BIZ-CAP` | Open | Render workbook-derived sample services, offering considerations, and commercial market/product guidance in taxonomy node UX instead of silently dropping it. |
| `BI-C61B5202` QuickBooks parity: expand read-only coverage to vendors, bills, expenses, payments, accounts, and reports | `EP-INT-2E7C1A` | Open | Move QuickBooks entity families from not-mapped to read, still with no writes. |
| `BI-07D76D6B` QuickBooks parity: define import staging and ownership posture for core accounting records | `EP-INT-2E7C1A` | Open | Stage source-attributed QuickBooks records in DPF without claiming ownership. |

Execution update on 2026-05-17: the batch above was restored and linked through live DPF MCP. The first three items are under `EP-BIZ-CAP`; the QuickBooks items remain under `EP-INT-2E7C1A`. `BI-407125DA` and `BI-0E6D42B3` are done. No DB fallback was used for backlog status updates.

## Second Backlog Batch Created From Role Audit

The role-to-work audit created these additional items through live DPF MCP under `EP-BIZ-CAP` on 2026-05-17:

| Item | Epic | Purpose |
| --- | --- | --- |
| `BI-80A71362` Capability taxonomy: define bookkeeper/accountant operating lane and finance coworker handoffs | `EP-BIZ-CAP` | Consolidate finance routes, QuickBooks/Stripe readiness, accounting ownership posture, and finance coworker handoffs. |
| `BI-9A86E2A7` Capability taxonomy: define customer support lane across storefront inbox, queues, and service coworker coverage | `EP-BIZ-CAP` | Separate support work from sales/marketing and map intake, queue, customer-record, and service-support coworker ownership. |
| `BI-E1CFC8FB` Capability taxonomy: define inventory and procurement admin lane across suppliers, purchases, assets, and storefront items | `EP-BIZ-CAP` | Decide the lane and native/provider posture for suppliers, POs, assets, inventory, and storefront items. |
| `BI-861433C0` Capability taxonomy: publish native integration coverage matrix for employee work roles | `EP-BIZ-CAP` | Turn native and benchmark integration coverage into a maintained role-provider-posture matrix. |
| `BI-F9E7B780` Capability coverage: expose all-coworker capability-needs report for taxonomy audits | `EP-BIZ-CAP` | Remove the need for direct SQL fallback when future audits need all-coworker capability-needs coverage. |

Remaining integration-provider follow-ons stay with `EP-INT-2E7C1A` unless a later epic split is approved:

| Proposed title | Preferred epic | Purpose |
| --- | --- | --- |
| Accounting entity link and ownership posture model | `EP-INT-2E7C1A` | Define external/local links and owner-side states for accounting and payment objects. |
| Stripe and QuickBooks payment reconciliation posture | `EP-INT-2E7C1A` | Define read-first reconciliation across DPF, Stripe, QuickBooks, fees, payouts, and deposits. |
| Bank feeds and reconciliation source-of-truth decision | `EP-INT-2E7C1A` | Decide whether DPF reads bank facts from QuickBooks, a bank-feed provider, CSV, or direct open-banking later. |
| Tax/VAT/sales tax mapping posture | `EP-INT-2E7C1A` | Map DPF tax profiles, jurisdictions, liabilities, and reports to QuickBooks tax codes without filing claims. |
| Reports and close workflow parity | `EP-INT-2E7C1A` | Expand from readiness into P&L, cash flow, aging, close packets, variance notes, and accountant view. |
| Accountant collaboration and evidence packet | `EP-INT-2E7C1A` plus taxonomy epic | Define accountant principal/access pattern and monthly review evidence. |
| SMB setup readiness for books, payments, payroll, tax, and bank feeds | Business Capability and Employee Work Taxonomy plus `EP-ARCH-8D4F2A` | Add setup routing from business context to finance/integration readiness. |
| Governed QuickBooks write-back gates | `EP-INT-2E7C1A` | Add proposal-mode writes only after read/stage/ownership gates are proven. |
| DPF system-of-record promotion criteria for accounting | Future finance/accounting epic | Define dual-run thresholds, rollback/export requirements, and entity-family ownership gates. |

## QuickBooks Long-Tail Sequence (canonical reference)

> **Single source of truth for Chunk 3.** The Chunk 3 tasks below implement steps 1–4 of this sequence. Steps 5–11 become backlog items only after the step 4 gate passes. Do not duplicate this sequence elsewhere.

The QuickBooks readiness snapshot is the approved starting point, but current `origin/main` does not yet contain the sibling branch's readiness files. Steps 1–4 can proceed immediately. Steps 5–11 unblock after the sibling branch (`DPF-small-business-os-parity`) merges or its equivalent is rebuilt on main.

1. Read-only company, customer, invoice staging: prove company info, customers, invoices, and invoice lines can be read and displayed with source timestamps.
2. Vendors, bills, expenses, payments, accounts, and reports: expand read scopes and readiness descriptors before any import or write path.
3. Import staging and entity ownership: stage company, customer, invoice, vendor, bill, and payment objects with external IDs, source provider, source timestamp, owner side, and proposed local link.
4. Payments and Stripe/QuickBooks reconciliation: compare invoices, payments, payment intents, fees, payouts, deposits, and DPF payment records with discrepancy reasons.
5. Bank feeds and reconciliation posture: decide whether bank facts come through QuickBooks, CSV, a bank-feed provider, or a later direct open-banking route; do not imply DPF owns bank rec until source-of-truth is explicit.
6. Tax, VAT, and sales tax: map DPF tax profiles, jurisdictions, liabilities, tax codes, and reports; preserve external filing boundaries.
7. Reports and close workflows: produce P&L, cash flow, AR/AP aging, close checklist, variance notes, and accountant packet from read/staged facts.
8. Accountant collaboration: add accountant principal/access posture, evidence packet, review workflow, and removable access model.
9. Setup and onboarding: ask once where books, payments, payroll, tax, bank feeds, invoicing, and accountant collaboration live; route the owner to integration readiness and DPF-native defaults.
10. Governed write-back gates: introduce proposal-mode create/update operations only with idempotency keys, preview, approval, audit receipt, and rollback/export expectations.
11. DPF system-of-record promotion: promote one entity family at a time only after read coverage, staged import, dual-run comparison, accountant evidence, export completeness, and rollback criteria are met.

## Architecture Posture

1. **Taxonomy is classification, not workflow.** `TaxonomyNode` should classify capabilities and products; workflows stay in finance, customer, storefront, employee, work queue, and integration surfaces.
2. **Backlog gets context before schema.** Use structured body fields first. Add schema only when repeated usage proves the fields and query needs.
3. **Integration epic owns provider parity.** QuickBooks, Stripe, ADP, HubSpot, Microsoft 365, Mailchimp, Google, Facebook, and WhatsApp work stays under `EP-INT-2E7C1A`; `EP-BIZ-CAP` owns capability taxonomy, role lanes, coworker coverage, and commercial-market taxonomy UX.
4. **Portfolios own investment context.** Items should link to portfolio/taxonomy when the owning product or employee-facing service is clear. Do not force every integration item into a fake product.
5. **Replacement is a maturity state.** QuickBooks replacement requires read, import, entity-link, dual-run, accountant evidence, and DPF-primary promotion gates. It is not achieved by cloning screens.
6. **Payroll and payment execution remain partner-led until proven otherwise.** DPF should own readiness, approvals, evidence, reconciliation, and operating context before it owns regulated execution.
7. **AI coworkers submit needs; they do not mutate strategy silently.** Existing `CoworkerCapabilityNeed` and capability inventory flows should feed taxonomy gaps into reviewed backlog, not direct hidden changes.
8. **Reserve refactoring budget.** Follow-on implementation slices should reserve roughly 20 percent of effort for refactoring route/catalog/coworker maps into reusable descriptors instead of duplicating labels across pages, prompts, and backlog bodies.
9. **Commercial market enrichment belongs in taxonomy UX.** The spreadsheet's market/product columns are decision support for buy/build/integrate posture. Surface them as curated fields, not raw JSON, and use progressive disclosure so dense vendor text does not overwhelm the node detail page.

## Decisions & Deferrals

### Decisions Made

| Decision | Rationale |
| --- | --- |
| Use `TaxonomyNode` + backlog body fields first; no new schema until template proves stable | Avoids premature field promotion; body context is queryable now |
| Keep QuickBooks/Stripe/ADP/HubSpot parity work under `EP-INT-2E7C1A` | That epic already owns connector family benchmarks across all integration families |
| Use `EP-BIZ-CAP` as the taxonomy epic | Taxonomy classification, employee-work mapping, and capability-to-surface work are architecturally distinct from provider parity |
| Replacement is a maturity state, not a project | Gates: read → staged import → entity-link → dual-run → accountant evidence → export completeness → DPF-primary promotion |
| Payroll and payment execution remain partner-led | DPF owns readiness, approvals, reconciliation, and operating context before claiming regulated execution |
| Use O*NET/SOC/APQC PCF as role and process language checks only | Not imported wholesale; used to avoid inventing non-standard role language |

### Deferrals

| Deferred item | Unblocked by |
| --- | --- |
| `create_epic` MCP tool does not exist — future non-build epics still cannot be created programmatically | `EP-BIZ-CAP` now exists for this track. `BI-BCCC9C7B` captures the governed MCP tool gap under `EP-ARCH-8D4F2A` so future planning workflows do not require manual admin setup. |
| AGENTS.md status table omits `triaging`, while current MCP tools and backlog transitions include it | Treat `apps/web/lib/mcp-tools.ts` and `apps/web/lib/backlog/transitions.ts` as current runtime truth for this plan; update AGENTS.md in a separate workflow-policy slice. |
| Sibling branch `DPF-small-business-os-parity` readiness files not yet on `origin/main` | Treat as approved branch input. Chunk 3 (QuickBooks long tail) can start on `BI-C61B5202` and `BI-07D76D6B` immediately. Full sequence unblocked when sibling branch merges. |
| Bank-feed source-of-truth decision | Requires QuickBooks read coverage proven first (step 2 of QuickBooks long-tail sequence) |
| Governed write-back gates | Requires read, staged import, and entity-link proven first |
| DPF system-of-record promotion | Requires dual-run + accountant evidence + export completeness per entity family |
| Xero, Gusto, Slack, Salesforce, service-desk, bank-feed integrations | Coverage gap audit (Chunk 2, Task 3) produces the prioritized list; create backlog items per gap found |
| First-class `BacklogCapabilityContext` schema fields | Deferred until 10+ items use the body template and query needs are confirmed |

## Plan Chunks

### Chunk Dependencies

```
Chunk 1 (research)  — COMPLETED during planning; do not re-run
Chunk 2 (backlog foundation)  — completed for the first batch; schema promotion remains deferred
Chunk 3 (QuickBooks long tail)  — can start BI-C61B5202 / BI-07D76D6B immediately; full sequence unblocks after sibling branch merge
Chunk 4 (employee work taxonomy)  — first audit item complete; remaining role-lane and UX slices can proceed
Chunk 5 (portfolio context)  — depends on Chunk 4 role-to-surface audit
```

## Chunk 1: Research Completed

> **Status: DONE.** The surface inventory, integration matrix, and capability-to-surface mapping were completed during planning and are recorded in the sections above. An implementing agent must not re-run this chunk.

The following artefacts were produced and are live above:

- Route family and capability family mapping (§ Current DPF Surface Inventory)
- Native integration matrix with employee roles (§ Native Integration Spine)
- Capability-to-surface-to-integration matrix (§ Capability-To-Surface-To-Integration Matrix)
- Live backlog and epic scan (§ Live Backlog And Source State)
- Five backlog items created via live DPF MCP (`BI-407125DA`, `BI-0E6D42B3`, `BI-4C166411`, `BI-C61B5202`, `BI-07D76D6B`), with the taxonomy items now linked to `EP-BIZ-CAP`

**Remaining gap identified by this research:** integration coverage for Xero, Gusto, Slack, Salesforce, project/work management, service desk, inventory, and bank-feed providers is shallow or absent. Addressed in Chunk 2, Task 3, Step 3.

## Chunk 2: Backlog Capture Foundation

**Files:**
- Modify: a future implementation may touch `apps/web/lib/backlog.ts`
- Modify: a future implementation may touch `apps/web/lib/mcp-tools.ts`
- Modify: a future implementation may add a docs template under `docs/superpowers/plans/`
- No schema migration in this planning slice.

### Task 3: Prove Body-Template Use

- [x] **Step 1: Apply the context template to 10 existing or new backlog items**

Completed for the first batch and adjacent integration-family rows. Keep using the context block for new items until query pressure justifies schema.

- [x] **Step 2: Review query needs**

Reviewed:

```text
Do operators need to filter by employee role, capability, posture, maturity, or integration anchor?
Can those filters be derived from body text for now?
Which fields need exact querying in Build Studio or backlog UI?
```

- [ ] **Step 3: Audit integration coverage gaps**

After applying the template, record which integration anchors appear in 3+ items but have no native DPF route or shallow read coverage. Minimum gap candidates: Xero, Gusto, Slack, Salesforce, project/work management tools, service desk providers, inventory systems, bank-feed providers. For each gap, create a backlog item under `EP-INT-2E7C1A`.

- [x] **Step 4: Decide schema vs manifest**

Preferred first implementation:

```ts
type BacklogCapabilityContext = {
  businessCapability: string;
  employeeRoles: string[];
  dpfSurfaces: string[];
  integrationAnchors: string[];
  architecturePosture: "native-dpf" | "integration-led" | "hybrid" | "replacement-candidate";
  maturityTarget: "observe" | "read" | "stage" | "operate" | "write-back" | "dual-run" | "dpf-primary";
  portfolioContext?: string;
  taxonomyContext?: string;
};
```

Store in a manifest JSON field only if such a field already exists or a separate schema plan is approved. Do not add columns prematurely. Schema promotion threshold: 10+ items queried by any field.

Execution result for `BI-407125DA` on 2026-05-17:

- Applied the `Backlog capability context` block to these 10 live backlog items through DPF MCP: `BI-407125DA`, `BI-0E6D42B3`, `BI-4C166411`, `BI-C61B5202`, `BI-07D76D6B`, `BI-INT-A5B9E3`, `BI-INT-F23BC6`, `BI-INT-E76A95`, `BI-INT-8D4F72`, and `BI-INT-1AB7D8`.
- Query need: operators will eventually need exact filters for employee role, business capability, posture, maturity target, integration anchor, and DPF surface. For the current planning and triage stage, body text is acceptable because the first use case is human-readable prioritization, not automated Build Studio routing.
- Schema decision: do not add `BacklogItem` columns or a JSON manifest in this slice. Current schema has `BusinessCapability` and `BusinessCapabilityTraceLink`, while `BacklogItem` has body text plus existing links to taxonomy, digital product, agent, accountable employee, and capability trace links. The next structural slice should expose governed MCP/UI support for capability trace links before adding another backlog context storage shape.
- Build Studio decision: exact routing should wait until at least 10-20 real items prove which fields are queried in practice. The first future automation should parse or normalize the body block into a read model, then graduate repeated fields into a schema or trace-link writer only if Build Studio and backlog UI need deterministic filtering.

## Chunk 3: QuickBooks Long Tail

**Canonical sequence:** see `§ QuickBooks Long-Tail Sequence` above. This chunk implements sequence steps 1–4 only. Steps 5–11 become backlog items after step 4 passes.

**Backlog items:** `BI-C61B5202` (sequence steps 1–2), `BI-07D76D6B` (sequence step 3), plus entity-link, reconciliation, tax, reports/close, accountant collaboration, write-back, and DPF-primary promotion items created after read/import proof.

**Dependency:** can start immediately; full sequence (steps 5–11) unblocks after `DPF-small-business-os-parity` branch merges.

### Task 4: Sequence Replacement Maturity (steps 1–4)

- [ ] **Step 1: Keep the next QuickBooks item read-only** (sequence step 1–2)

Implement `BI-C61B5202` before import/write work. The readiness descriptor should move entity families from `not-mapped` to `read` for vendors, bills, expenses, payments, accounts, and reports.

- [ ] **Step 2: Stage before ownership** (sequence step 3)

Implement `BI-07D76D6B` after read expansion. Imported data remains non-editable and source-attributed. Each staged record carries: `externalId`, `sourceProvider`, `sourceTimestamp`, `ownerSide`, `proposedLocalLink`.

- [ ] **Step 3: Add entity links after staging proves the fields** (sequence step 3 continued)

Create the proposed accounting entity-link backlog item only after staging shows the exact external/local link structure needed. Do not design the link model speculatively.

- [ ] **Step 4: Gate on read data before reconciliation** (sequence step 4)

Create the proposed Stripe/QuickBooks reconciliation item only after DPF has sufficient QuickBooks and Stripe read data to compare payment facts. Gate: both providers have `read` maturity for payment objects.

## Chunk 4: Employee Work Taxonomy

**Backlog items:** `BI-407125DA` and `BI-0E6D42B3` are done. Open follow-on slices are `BI-4C166411`, `BI-861433C0`, `BI-80A71362`, `BI-9A86E2A7`, `BI-E1CFC8FB`, and `BI-F9E7B780`.

**Principal Convergence constraint (AGENTS.md §11, effective 2026-05-09):** any new identity-bearing entity introduced by this work must be modeled as a `PrincipalAlias` linked to a single `Principal`, not as a parallel identity table. Employee role taxonomy items that define new identity-bearing entities must follow this pattern. Authorization decisions must resolve on the `Principal`; the alias kind tells the platform which surface authenticated the request.

### Task 5: Role-To-Work Audit

- [x] **Step 1: Use O*NET and SOC as role language checks**

Do not import their taxonomy wholesale. Use them to avoid inventing nonstandard role language for bookkeeping, sales, customer service, HR, and administrative work.

- [x] **Step 2: Map employee jobs to DPF surfaces**

Minimum rows:

```text
owner_operator
bookkeeper_accountant
sales_bd
marketer
service_ops
customer_support
hr_payroll_admin
it_security_compliance
inventory_procurement_admin
```

- [x] **Step 3: Map employee jobs to AI coworkers**

Use `packages/db/data/agent_registry.json` and live coworker capability-needs surfaces. Where no coworker exists or the coworker lacks grants/tools, create reviewed capability needs or backlog items.

- [x] **Step 4: Map employee jobs to integration anchors**

Use native integrations first. Only propose new external products after checking the integration catalog and current benchmark family items.

Execution result for `BI-0E6D42B3` on 2026-05-17:

- Evidence sources: shell route inventory under `apps/web/app/(shell)`, user-guide docs, `apps/web/lib/tools/native-integration-catalog.ts`, `packages/db/prisma/schema.prisma`, live MCP portfolio context search, live MCP backlog state, and official reference-language checks from O*NET, BLS SOC, and APQC PCF.
- The coverage matrix above now covers the nine required roles: `owner_operator`, `bookkeeper_accountant`, `sales_bd`, `marketer`, `service_ops`, `customer_support`, `hr_payroll_admin`, `it_security_compliance`, and `inventory_procurement_admin`.
- MCP limitation: `get_my_coworker_profile` and `list_my_capability_needs` were available but failed because this external Codex token has no current coworker `agentId`. Direct live PostgreSQL fallback was used only to confirm active seeded coworker rows and that `CoworkerCapabilityNeed` currently has no submitted rows.
- Live coworker status: the running database has active rows for `finance-agent`, `finance-controller`, `customer-advisor`, `marketing-specialist`, `hr-specialist`, `inventory-specialist`, `ops-coordinator`, `portfolio-advisor`, and `service-support-agent`.
- Gap pattern: DPF has many surfaces and coworkers, but several employee lanes are not yet explicit operating lanes. The audit therefore created `BI-80A71362`, `BI-9A86E2A7`, `BI-E1CFC8FB`, `BI-861433C0`, and `BI-F9E7B780` under `EP-BIZ-CAP`.
- Architecture decision: use these backlog lanes to deepen existing DPF finance, customer, storefront, employee, workspace, compliance, and integration surfaces. Do not create a chat-only "employee taxonomy" layer, and do not promote QuickBooks replacement claims before read, stage, reconciliation, evidence, accountant review, export, and rollback gates are proven.

### Task 6: Surface Commercial Market Enrichment

- [ ] **Step 1: Extend the typed enrichment view model**

Add explicit fields for:

```text
sampleServices
offeringConsiderations
commercialMarket
sectorCommercialMarkets
```

Keep unknown raw enrichment hidden from UI output.

- [ ] **Step 2: Render market/product guidance in taxonomy UX**

Expose the fields on taxonomy node detail using a compact full-width section with progressive disclosure. Do not use nested cards, raw JSON, or hardcoded colors.

- [ ] **Step 3: Connect to integrations and backlog capture**

Where commercial-market text names representative products already present as native anchors, the coverage matrix should call that out explicitly. Examples include QuickBooks, Stripe, ADP, Microsoft 365, HubSpot, Mailchimp, Google Business Profile, and Google/Facebook social channels.

## Chunk 5: Portfolio Context

**Depends on:** Chunk 4 role-to-surface audit complete.

### Task 7: Attach Portfolio And Taxonomy Context

- [ ] **Step 1: Match each capability row to existing taxonomy nodes**

For each capability family in the matrix, run `search_portfolio_context`. Relevant `for_employees` taxonomy nodes already confirmed live:
- `for_employees/develop_and_manage_business_capabilities`
- `for_employees/evaluate_and_plan_portfolio_investments/review_and_balance_4_portfolios/refine_employee_facing_portfolio_taxonomy`
- `for_employees/financial_management/manage_project_accounting`

Link backlog items to portfolio/taxonomy only when the owning `DigitalProduct` is unambiguous. If unclear, leave body context only and note the gap.

- [ ] **Step 2: Schema promotion decision**

After applying the body template to 10+ items (Chunk 2, Task 3), review: which fields are queried frequently enough to warrant first-class columns? Write a separate schema plan if any field meets the threshold. Do not add columns in this chunk.

## Verification

### Planning slice (this document)

- [x] `git diff --check` — plan file has no whitespace errors.
- [x] Plan path confirmed at `docs/superpowers/plans/2026-05-17-business-capability-employee-work-taxonomy.md`.
- [x] `BI-407125DA`, `BI-0E6D42B3`, `BI-4C166411` visible in live backlog and linked to `EP-BIZ-CAP`.
- [ ] `BI-C61B5202`, `BI-07D76D6B` visible and linked under `EP-INT-2E7C1A`.
- [x] Taxonomy epic exists as `EP-BIZ-CAP`; durable MCP `create_epic` gap remains captured as `BI-BCCC9C7B`.

### Implementation slices (Chunks 2–5)

- [ ] Focused unit tests for any parser, descriptor, or view model added.
- [ ] `pnpm --filter web typecheck` passes with zero new errors.
- [ ] `pnpm exec next build` from `apps/web` passes.
- [ ] UX verification against Docker-served DPF for any visible route change.
- [ ] Backlog item status updated to `in-progress` on start and `done` on completion via MCP.
- [ ] If `BacklogCapabilityContext` type is promoted to schema, a Prisma migration is added and `pnpm --filter @dpf/db exec prisma migrate dev` is run.

## Recommended Next Smallest Buildable Slice

**Step 0 (resolved):** The taxonomy epic exists as `EP-BIZ-CAP`, and the taxonomy items are linked there. `BI-BCCC9C7B` still tracks the MCP `create_epic` gap so future planning tracks do not depend on manual admin setup.

**Completed:** `BI-407125DA` and `BI-0E6D42B3` are done, so the body-template foundation and first employee-role/coworker audit no longer block the next slice.

**Next smallest UI slice:** build `BI-4C166411` - expose commercial market and product enrichment from `TaxonomyNode.enrichment` on the portfolio taxonomy UX. The data already exists, and the implementation scope is view-model plus presentation/tests.

**Next taxonomy/data slice:** build `BI-861433C0` - publish the native integration coverage matrix for employee work roles. This should consume the same backlog context model and avoid creating a parallel taxonomy system.

**QuickBooks can proceed in parallel:** `BI-C61B5202` and `BI-07D76D6B` remain under `EP-INT-2E7C1A` and do not depend on `EP-BIZ-CAP`.
