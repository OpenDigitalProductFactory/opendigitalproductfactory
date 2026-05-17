# Business Capability and Employee Work Taxonomy Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a business capability and employee-work taxonomy that connects DPF portfolios, current product surfaces, AI coworkers, and native/external integrations, while expanding QuickBooks parity into a long-tail backlog that can be worked alongside other priorities.

**Architecture:** Use the existing portfolio, taxonomy, backlog, employee, work queue, capability inventory, native integration, and coworker-need models before adding schema. Capture structured context in backlog bodies first; promote fields only after usage proves the shape. Keep provider parity under `EP-INT-2E7C1A` and use portfolio/taxonomy context as classification, not as a replacement for the integration epic.

**Tech Stack:** DPF MCP backlog tools, Next.js 16 app routes, Prisma models in `packages/db/prisma/schema.prisma`, native integration catalog in `apps/web/lib/tools/native-integration-catalog.ts`, docs under `docs/superpowers/plans`.

**Related Docs:** `docs/superpowers/specs/2026-05-16-small-business-os-parity-quickbooks-anchor-design.md`, `docs/superpowers/plans/2026-05-17-quickbooks-accounting-readiness-snapshot.md`.

---

## Live Backlog And Source State

The live DPF MCP backlog tools were used first. No DB fallback was used.

Open epic scan on 2026-05-17 found no dedicated business-capability or employee-work taxonomy epic. The closest active containers are:

- `EP-INT-2E7C1A` - Integration Harness: Benchmarking and Private Deployment Foundation.
- `EP-ARCH-8D4F2A` - Archetype Model V2: Unified Business Archetypes.
- `EP-TAK-3F9A21` - TAK/GAID Refresh: Auth, Agent Identity, and Governed Memory Alignment.

`EP-INT-2E7C1A` already owns connector family benchmarks for finance/payments, CRM/sales, communications, HR/payroll, identity, service desk, knowledge, project/work, and device management. That makes it the right main epic for the integration/provider parity long tail.

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
Architecture posture: native_dpf | integration_led | hybrid | replacement_candidate
Maturity target: observe | read | stage | operate | write_back | dual_run | dpf_primary
Replacement gate:
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

## First Backlog Batch Created

All items below were created through live DPF MCP and linked to `EP-INT-2E7C1A`.

| Item | Purpose |
| --- | --- |
| `BI-1A81A968` Capability taxonomy backlog capture foundation | Standardize the context template and decide whether backlog needs schema or manifest fields later. |
| `BI-03AD102F` Native integration capability and employee-role coverage matrix | Audit current native integrations against common SMB employee jobs and DPF surfaces. |
| `BI-937007D0` QuickBooks read expansion for vendors, bills, payments, accounts, and reports | Move QuickBooks entity families from not-mapped to read, still with no writes. |
| `BI-2A091DE5` QuickBooks import staging for company, customers, and invoices | Stage source-attributed QuickBooks records in DPF without claiming ownership. |
| `BI-B61A119C` Accounting entity link and ownership posture model | Define external/local entity links and ownership states for accounting/payment objects. |
| `BI-DEFE785B` SMB setup readiness for books, payments, payroll, tax, and bank feeds | Add setup routing from business context to finance/integration readiness. |
| `BI-77947024` Stripe and QuickBooks payment reconciliation posture | Define read-first reconciliation between DPF, Stripe, and QuickBooks. |
| `BI-1E0454C3` Employee role taxonomy and coworker coverage audit | Map employee jobs to DPF surfaces, coworkers, queues, and integrations. |

These are intentionally `triaging` with proposed build outcome. The Scrum Master can size and sequence them with other priorities instead of treating the replacement strategy as one giant project.

## Architecture Posture

1. **Taxonomy is classification, not workflow.** `TaxonomyNode` should classify capabilities and products; workflows stay in finance, customer, storefront, employee, work queue, and integration surfaces.
2. **Backlog gets context before schema.** Use structured body fields first. Add schema only when repeated usage proves the fields and query needs.
3. **Integration epic owns provider parity.** QuickBooks, Stripe, ADP, HubSpot, Microsoft 365, Mailchimp, Google, Facebook, and WhatsApp work stays under `EP-INT-2E7C1A` unless a new generic epic tool creates a dedicated business capability taxonomy epic.
4. **Portfolios own investment context.** Items should link to portfolio/taxonomy when the owning product or employee-facing service is clear. Do not force every integration item into a fake product.
5. **Replacement is a maturity state.** QuickBooks replacement requires read, import, entity-link, dual-run, accountant evidence, and DPF-primary promotion gates. It is not achieved by cloning screens.
6. **Payroll and payment execution remain partner-led until proven otherwise.** DPF should own readiness, approvals, evidence, reconciliation, and operating context before it owns regulated execution.
7. **AI coworkers submit needs; they do not mutate strategy silently.** Existing `CoworkerCapabilityNeed` and capability inventory flows should feed taxonomy gaps into reviewed backlog, not direct hidden changes.

## Plan Chunks

## Chunk 1: Current Surface And Integration Evaluation

**Files:**
- Read: `apps/web/app/(shell)/**`
- Read: `apps/web/lib/tools/native-integration-catalog.ts`
- Read: `packages/db/prisma/schema.prisma`
- Read: `packages/db/data/agent_registry.json`
- Read: `docs/user-guide/**`
- Read: `docs/superpowers/specs/**`
- Read: `docs/superpowers/plans/**`

### Task 1: Surface Inventory

- [ ] **Step 1: List visible route families**

Run:

```powershell
Get-ChildItem -Path 'apps/web/app/(shell)' -Directory | Select-Object -ExpandProperty Name
```

Expected: route families including finance, customer, employee, storefront, platform, portfolio, workspace, compliance.

- [ ] **Step 2: Map route families to capability families**

Create a table with columns:

```text
route family | capability family | current data model | likely employee roles | current integration anchors | known gaps
```

- [ ] **Step 3: Validate with docs**

Read user guide pages for finance, customers, storefront, platform tools/integrations, and portfolios. Mark docs as current, shallow, or stale relative to route/code inventory.

### Task 2: Native Integration Matrix

- [ ] **Step 1: Extract integration catalog rows**

Run:

```powershell
Get-Content -Path apps/web/lib/tools/native-integration-catalog.ts
```

- [ ] **Step 2: Build matrix**

For every integration, record:

```text
integrationId | provider | DPF route | category | enables | relevantAgentIds | requiredGrantKeys | employee roles | capability family | posture
```

- [ ] **Step 3: Identify coverage gaps**

At minimum, flag missing or shallow anchors for Xero, Gusto, Slack, Salesforce, project/work management, service desk, inventory, and bank-feed providers.

## Chunk 2: Backlog Capture Foundation

**Files:**
- Modify: a future implementation may touch `apps/web/lib/backlog.ts`
- Modify: a future implementation may touch `apps/web/lib/mcp-tools.ts`
- Modify: a future implementation may add a docs template under `docs/superpowers/plans/`
- No schema migration in this planning slice.

### Task 3: Prove Body-Template Use

- [ ] **Step 1: Apply the context template to 10 existing or new backlog items**

Start with the eight items created in this plan and the existing `BI-INT-A5B9E3` and `BI-INT-F23BC6`.

- [ ] **Step 2: Review query needs**

Ask:

```text
Do operators need to filter by employee role, capability, posture, maturity, or integration anchor?
Can those filters be derived from body text for now?
Which fields need exact querying in Build Studio or backlog UI?
```

- [ ] **Step 3: Decide schema vs manifest**

Preferred first implementation:

```ts
type BacklogCapabilityContext = {
  businessCapability: string;
  employeeRoles: string[];
  dpfSurfaces: string[];
  integrationAnchors: string[];
  architecturePosture: "native_dpf" | "integration_led" | "hybrid" | "replacement_candidate";
  maturityTarget: "observe" | "read" | "stage" | "operate" | "write_back" | "dual_run" | "dpf_primary";
  portfolioContext?: string;
  taxonomyContext?: string;
};
```

Store in a manifest JSON field only if such a field already exists or a separate schema plan is approved. Do not add columns prematurely.

## Chunk 3: QuickBooks Long Tail

**Backlog items:** `BI-937007D0`, `BI-2A091DE5`, `BI-B61A119C`, `BI-77947024`, plus future ledger and dual-run items after read/import proof.

### Task 4: Sequence Replacement Maturity

- [ ] **Step 1: Keep the next QuickBooks item read-only**

Implement `BI-937007D0` before import/write work. The readiness descriptor should move entity families from `not-mapped` to `read`.

- [ ] **Step 2: Stage before ownership**

Implement `BI-2A091DE5` after read expansion. Imported data remains non-editable and source-attributed.

- [ ] **Step 3: Add entity links after staging proves the fields**

Implement `BI-B61A119C` only after staging shows the exact external/local link needs.

- [ ] **Step 4: Reconcile payments**

Implement `BI-77947024` after DPF has enough QuickBooks and Stripe read data to compare payment facts.

## Chunk 4: Employee Work Taxonomy

**Backlog items:** `BI-1E0454C3`, `BI-03AD102F`, and future items derived from the coverage audit.

### Task 5: Role-To-Work Audit

- [ ] **Step 1: Use O*NET and SOC as role language checks**

Do not import their taxonomy wholesale. Use them to avoid inventing nonstandard role language for bookkeeping, sales, customer service, HR, and administrative work.

- [ ] **Step 2: Map employee jobs to DPF surfaces**

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

- [ ] **Step 3: Map employee jobs to AI coworkers**

Use `packages/db/data/agent_registry.json` and live coworker capability-needs surfaces. Where no coworker exists or the coworker lacks grants/tools, create reviewed capability needs or backlog items.

- [ ] **Step 4: Map employee jobs to integration anchors**

Use native integrations first. Only propose new external products after checking the integration catalog and current benchmark family items.

## Chunk 5: Portfolio Context

### Task 6: Attach Portfolio And Taxonomy Context

- [ ] **Step 1: Search portfolio context for each capability**

Use `search_portfolio_context` before assigning portfolio/taxonomy. Evidence from this plan showed relevant `for_employees` taxonomy nodes already exist.

- [ ] **Step 2: Avoid fake portfolio linkage**

Do not force items into a portfolio when the owning digital product is unclear. Use body context until a product or portfolio is clearly responsible.

- [ ] **Step 3: Propose first-class backlog context only after audit**

If the same fields are needed across 10 or more items, write a separate schema plan for backlog capability context fields or manifest support.

## Verification

For this planning slice:

- `git diff --check`
- Confirm plan path exists and is linked to live backlog IDs.
- Confirm live backlog items are visible under `EP-INT-2E7C1A`.

For future implementation slices:

- Focused unit tests for any parser, descriptor, or view model.
- `pnpm --filter web typecheck`.
- `pnpm exec next build` from `apps/web`.
- UX verification against Docker-served DPF for any visible route.
- MCP/backlog status updates after completion.

## Recommended Next Smallest Buildable Slice

Build `BI-1A81A968` first: a small backlog capability-context foundation that standardizes capture and validates whether backlog needs first-class context fields. This lets every later QuickBooks, Stripe, ADP, HubSpot, employee, and storefront parity item carry the same strategic context without blocking on schema.

Then build `BI-03AD102F`: the integration capability and employee-role coverage matrix. That gives the product team the actual map before adding more provider-specific depth.
