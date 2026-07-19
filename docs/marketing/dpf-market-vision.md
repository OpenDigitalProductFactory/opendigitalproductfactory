# DPF Market Vision

**Status:** Draft - 2026-07-19  
**Scope:** Public positioning, competitor framing, and roadmap translation for the product DPF wants to create and sell.  
**Related:** [Documentation overview](../index.html), [Archetype Owner Positioning](../architecture/archetype-owner-positioning.md), [Connector Benchmark Coverage Matrix](../superpowers/plans/2026-07-16-connector-benchmark-coverage-matrix.md), [Connector Family Benchmark Scorecards](../superpowers/plans/2026-07-16-connector-family-benchmark-scorecards.md)

## 1. Thesis

DPF is not trying to become another integration dashboard. It is an open, AI-operated company platform that starts with the work a business owner is trying to run, connects to the systems they already have, and gradually absorbs broadly useful functionality into a simpler native whole.

The short form:

> Integrate at the edge. Simplify in the core. Generalize for the ecosystem.

External systems are useful bridges. They carry current accounting, payroll, payments, identity, CRM, support, collaboration, and compliance reality. But they should not define the long-term architecture. DPF should learn from those systems, normalize their records into company primitives, and build the common company-running workflows natively when doing so removes complexity for many installs.

## 2. The Market Problem

Small and mid-sized companies are asked to run like enterprises, but they do not have enterprise implementation teams. Their daily operating stack often sprawls across:

- accounting, payroll, banking, payments, tax, and spend tools
- CRM, marketing, quotes, orders, and customer support tools
- HR, scheduling, time, benefits, and performance tools
- identity, directory, access, device, and security tools
- chat, email, project management, docs, tickets, and knowledge tools
- vertical systems such as POS, ecommerce, field service, booking, EHR, core banking, ticketing, LMS, PSA, or RMM

Each tool solves a slice. The owner or employee becomes the integration layer: copying context, reconciling facts, chasing approvals, explaining what changed, and deciding which system is true.

AI changes the economics. The right product is not a pile of separate tools with an AI chat box on top. The right product is a governed operating layer where AI coworkers handle the complexity around the work, humans keep authority, and the platform keeps a coherent record.

## 3. Product Positioning

DPF should be positioned as:

> The open company operating platform for small teams that want AI coworkers, real business workflows, and control over their own data.

What that means in practice:

- **Company-first, not app-first.** People, work, money, assets, knowledge, and authority are native primitives.
- **Archetype-led.** The platform starts from the kind of business being run, then shapes vocabulary, intake, scheduling, finance, compliance, and daily work.
- **AI-operated, human-authorized.** Coworkers draft, interpret, route, reconcile, and prepare decisions; humans approve consequential actions.
- **Adapter-aware, not adapter-owned.** Workday, QuickBooks, WorkOS, Stripe, Plaid, HubSpot, Zendesk, Slack, Asana, ADP, Gusto, Xero, Shopify, and similar systems are bridges and benchmarks, not the architectural center.
- **Open and compounding.** Missing functionality can be built once, reviewed, merged, and made available to the ecosystem instead of remaining a private workaround.

## 4. Competitor And Ecosystem Map

This map is not a claim that DPF matches every product today. It names where the market is clustered and what DPF should absorb, connect to, or leave provider-led.

| Ecosystem | Examples | Market role | DPF posture |
| --- | --- | --- | --- |
| Enterprise HCM / finance suites | Workday, SAP, Oracle | System of record for enterprise people, payroll, finance, planning | Use as north-star benchmarks; absorb the simpler company-running workflows over time. |
| SMB accounting and payroll | QuickBooks, Xero, Gusto, ADP | Book of record, payroll compliance, accountant workflow | Bridge deeply first; make finance ops native only after reconciliation, controls, and trust are proven. |
| Identity and access | WorkOS, Okta, Entra, Google Workspace | SSO, directory, provisioning, audit, access policy | Build DPF-native authority; keep IdPs as edge identity/directory adapters. |
| Payments, banking, spend | Stripe, Plaid, Square, BILL, Ramp, Brex | Money movement, bank data, cards, AP/payment rails | Keep payment and banking rails provider-led; absorb reconciliation, approval, evidence, and operating workflow. |
| CRM, marketing, support | HubSpot, Salesforce, Zendesk, Freshdesk, Mailchimp | Customer record, pipeline, campaigns, support tickets | Absorb customer/work primitives; use adapters for migration, coexistence, and channel reach. |
| Collaboration and work management | Microsoft 365, Google Workspace, Slack, Teams, Asana, Jira, ClickUp, Notion, Confluence | Messages, tasks, docs, knowledge, team coordination | DPF owns the work/knowledge spine; external tools sync or provide evidence. |
| Commerce and vertical systems | Shopify, Square, POS, booking, field service, LMS, EHR, core banking, PSA/RMM | Industry-specific execution systems | Absorb common SMB workflows where safe; leave regulated or specialized systems provider-led until replacement evidence exists. |

## 5. Absorb, Combine, Refactor

The long-term product should be engineered around shared primitives, not vendor-shaped silos.

| Primitive | Absorbs concepts from | Native DPF direction |
| --- | --- | --- |
| Party | customers, contacts, workers, suppliers, requesters, members, patients, donors | One governed model for who is involved, with role-specific vocabulary and permissions. |
| Work | tasks, tickets, cases, approvals, projects, service requests, onboarding steps | One work spine with status, owner, evidence, SLA/priority, handoff, and AI coworker routing. |
| Money | invoices, bills, expenses, payments, payouts, taxes, journal entries, payroll packets | One finance spine with ledger integrity, reconciliation, approval, close, and provider bridges. |
| Asset | products, inventory, devices, software, fixed assets, rental assets, service equipment | One asset spine that supports commerce, operations, IT, finance, and compliance views. |
| Knowledge | documents, policies, contracts, help articles, filings, receipts, source evidence | One knowledge/evidence layer with provenance, classification, review state, and reuse. |
| Authority | identity, roles, approvals, consent, delegated access, audit logs | One authority plane for humans, AI coworkers, connectors, and external agents. |

This is the main refactor direction: each absorbed ecosystem capability should strengthen one of these primitives instead of adding another isolated module.

## 6. Prioritization

Recommended sequencing:

1. **Trustworthy finance plus QuickBooks/Xero/Stripe coexistence.** Invoices, bills, expenses, banking, reconciliation, close, reporting, accountant review, and book-of-record posture.
2. **People and workforce core.** Worker, position, org, time, absence, scheduling, staffing, and manager/employee self-service.
3. **Payroll bridge and compliance evidence.** Payroll packets, provider adapters, GL posting, payslips, and stop-rules before native payroll expansion.
4. **Customer, revenue, and support work spine.** Leads, customers, opportunities, quotes, orders, tickets, cases, and campaigns mapped into DPF work.
5. **Planning and analytics.** Budget, cash flow, workforce/finance scenarios, profitability, KPI dashboards, and AI explanations grounded in source records.
6. **Commerce, inventory, procurement, assets, and vertical loops.** Absorb the repeatable SMB workflows; keep regulated or highly specialized systems behind adapters until the evidence bar is met.

## 7. Current-State Guardrails

Marketing should be ambitious but honest.

- Do not say DPF replaces payroll tax filing, bank/payment rails, licensed clinical systems, legal advisors, core banking systems, public-safety systems, or mature enterprise suites today.
- Do say DPF is building toward a unified company operating platform where those systems can be bridged, simplified, and sometimes displaced by native capability.
- Do not sell integrations as the destination.
- Do sell integrations as the bridge into a cleaner operating model.
- Do not claim AI acts without control.
- Do claim AI coworkers reduce employee complexity while humans retain authority and the platform keeps receipts.

## 8. Message House

**Headline:** Run the company, not the software stack.

**Subhead:** DPF gives small teams a company operating platform with AI coworkers, business-specific workflows, and customer-brought integrations that can become native capability over time.

**Proof points:**

- 95 seeded archetypes across 21 categories shape the portal, vocabulary, coworker framing, finance defaults, and operating model.
- Native finance, HR, CRM, customer, inventory, knowledge, work, authority, audit, and integration substrate already exists.
- QuickBooks, Stripe, HubSpot, ADP, Microsoft 365, WhatsApp, Instagram, Google marketing, and related connectors are already represented in the connector benchmark and adapter work.
- WorkOS, Workday, QuickBooks, and the wider SaaS ecosystem now map to explicit DPF epics and backlog lanes.
- Build Studio and the Hive Mind turn missing functionality into shared product improvement instead of isolated custom work.

**Strategic line:** DPF uses adapters to meet the company where it is, then absorbs the workflows that should belong to the whole ecosystem.

## 9. Backlog Anchors

The product strategy is tracked in the backlog, not only in prose:

- `EP-COMPANY-OPS-PARITY` - Workday, QuickBooks, WorkOS, and company-operations parity map.
- `EP-ECOSYSTEM-ABSORPTION-ARCH` - adapter bridges into native company primitives.
- `EP-FINANCE-ACCOUNTING-CORE` - ledger, AR, AP, banking, reporting, and close.
- `EP-QUICKBOOKS-ACCOUNTING-BRIDGE` - import, sync, reconciliation, and book-of-record coexistence.
- `EP-PEOPLE-HCM-CORE` - worker, position, organization, and employee lifecycle.
- `EP-WORKFORCE-OPS` - time, absence, scheduling, staffing, and labor optimization.
- `EP-PAYROLL-COMP-BENEFITS` - controlled payroll readiness and provider bridge.
- `EP-PLANNING-ANALYTICS` - budgets, forecasts, profitability, and workforce-finance insight.
- `EP-SPEND-PROCUREMENT-ASSETS` - suppliers, purchasing, inventory, and fixed assets.
- `EP-TALENT-SKILLS-PERFORMANCE` - recruiting, reviews, learning, and growth.

## 10. Sources And Market Signals

This positioning is grounded in the current vendor/ecosystem review completed on 2026-07-19 and the DPF connector scorecards already in this repository. Public vendor sources checked include Workday, QuickBooks, WorkOS, Rippling, Gusto, BILL, Stripe, Plaid, Salesforce, Zendesk, Slack, and Asana product/marketplace pages. Treat their specific feature sets as time-sensitive; refresh the source pass before using this document for investor, partner, or procurement material.
