# Small-Business Operating-System Parity: QuickBooks Anchor Design

| Field | Value |
| ----- | ----- |
| Status | Research/spec draft |
| Date | 2026-05-16 |
| Author | Codex for Mark Bodman |
| Scope | Finance, customers, storefront, setup/archetypes, native integrations, Business OS readiness |
| Primary anchor | QuickBooks Online as the accounting system-of-record benchmark |
| Related DPF specs | [Finance Hub Identity Architecture](2026-03-15-finance-hub-identity-architecture-design.md), [MCP Integrations Catalog](2026-03-19-mcp-integrations-catalog-design.md), [Unified Capability and Integration Lifecycle](2026-04-12-unified-capability-and-integration-lifecycle-design.md), [Business Setup Unification](2026-04-11-business-setup-unification-design.md), [AI Provider Finance Bridge](2026-04-23-ai-provider-finance-bridge-design.md), [Business OS Command Center](2026-05-15-business-os-command-center-design.md), [Business OS Readiness Audit](2026-05-15-business-os-readiness-audit-design.md) |
| Backlog alignment | `EP-INT-2E7C1A`, `BI-INT-A5B9E3`, `BI-INT-92C1F8`, `BI-INT-F23BC6`, `EP-ARCH-8D4F2A`, `BI-ARCH-4C1E90` |

## Purpose

DPF should become credible as a small-business operating system and, long term, should be able to replace QuickBooks-class day-to-day business software for the businesses it serves. The platform strategy is one place to run the company, with integrations used as bridges, migration paths, specialist rails, and validation sources rather than as the permanent center of gravity.

QuickBooks Online is the first anchor benchmark because it is where many small businesses actually run day-to-day bookkeeping: invoices, payments, expenses, bank feeds, reconciliation, payroll touchpoints, taxes, reports, customer/vendor records, and accountant collaboration. DPF should use that benchmark to decide what it must eventually own natively, what should be partner-led for a long time, and what must be proven through read/import/dual-run before DPF becomes the primary source of truth.

This spec answers four questions:

1. What does the current DPF repo and live install already have?
2. What do QuickBooks and adjacent SMB products make normal for day-to-day business operations?
3. Which gaps should DPF close natively, which should stay partner-led, and which should use integrations as migration scaffolding?
4. What is the smallest buildable slice that improves DPF without violating the current architecture?

## Target Business Profile

This spec scopes the SMB parity track to a specific operational envelope. Capabilities outside it are not necessarily wrong, but they should not drive architecture decisions in this track.

**Revenue:** up to approximately $10M ARR.

**Headcount:** 1 to 50 employees, including owner-operators, contractors, and part-time staff.

**Accounting method:** cash or accrual; the platform must support both, but the first anchor slices will not require an accrual-only journal entry model.

**Geography:** US-first for tax/payroll authority integrations; multi-currency and VAT/GST awareness required in the data model from the start because Xero and Zoho show that non-US SMB operators are a primary segment.

**Business types in scope:** service businesses (professional services, agencies, trades, consultants), subscription/SaaS, digital-product sellers, freelancers/solopreneurs, and small retailers with simple inventory. Complex manufacturing, regulated financial services, and non-profits are out of scope for this track.

**Accounting tool assumption:** most target businesses already use QuickBooks Online, Xero, FreshBooks, or Zoho Books. DPF must integrate before it can replace. Businesses that have no accounting tool are a secondary case handled by the DPF-primary mode in later slices.

## Deployment and Hosting Model

DPF is open-source with one organization per install. SMB parity is meaningless without a clear story for who runs the install, where credentials live, and how the platform stays a conduit rather than a broker. The hosting model is load-bearing for the security boundary and the integration-to-replace path.

**Three valid deployment topologies for SMB parity:**

1. **Self-hosted by the business.** The SMB or their IT partner runs DPF on their own infrastructure. QuickBooks OAuth credentials live in the customer's own `IntegrationCredential` table. DPF is software the customer operates. This is the OSS baseline.
2. **Managed by an implementation partner.** A consultancy, MSP, or bookkeeping firm runs DPF for the SMB on partner-controlled infrastructure. Each SMB still has a single-org install; the partner runs one install per client. Credentials remain customer-scoped; the partner is the operator principal.
3. **Hosted DPF offering.** Anthropic or a designated operator runs the install on behalf of the SMB. The SMB owns the data and the credentials; the host owns the infrastructure. This is a future commercial path and is not assumed for the first slices.

**Architectural invariants across all three topologies:**

- The customer (or their authorized partner) brings their own QuickBooks/Xero/Stripe/ADP account and authorizes DPF via OAuth. DPF never enrolls as a partner of these vendors.
- Credentials are owned by the install, not by the platform. There is no shared credential pool across installs.
- Cross-install learning happens through the hive mind, not through credential or data pooling (see Hive Mind Contribution Boundary below).
- The SMB parity track must work identically in self-hosted and managed topologies. Any feature that only works in a hosted-DPF topology requires a dedicated spec.

This deployment model also justifies ADR-2 (ownership lives in one system at a time) at the trust layer: the customer is the only principal who can authorize a promotion event, regardless of who operates the install.

## Evidence Method

### Live Backlog

The backlog and epic check used the live DPF MCP tools first. No backlog DB fallback was needed.

Live MCP findings:

- `EP-INT-2E7C1A` already owns the integration harness and anchor-native-integration track.
- `BI-INT-A5B9E3` is the direct finance/billing/payments benchmark item. Its current body already names QuickBooks, Xero, and Stripe, and says QuickBooks and Stripe should be earliest native-first targets with read-first plus approval-governed write operations.
- `BI-INT-92C1F8` covers phase 3 anchor native integrations across identity, communications, finance, and service desk.
- `BI-INT-F23BC6` covers the HR/payroll connector family.
- `EP-ARCH-8D4F2A` and `BI-ARCH-4C1E90` cover archetype/setup work that should absorb SMB operating-system setup choices.

### Live Runtime State

The runtime domain state was checked directly in Postgres because the backlog MCP surface exposes planning state, not installed finance/customer row counts.

Current install evidence:

- The active organization is `Open Digital Product Factory`, industry `software-platform`.
- The active business context is `Quote-based services`.
- The storefront archetype is `Software Platform` / `software-platform`.
- Finance transaction tables are effectively empty in the current install: 0 invoices, bills, payments, bank transactions, expense claims, suppliers, and bank accounts.
- Customer operating tables are also empty: 0 customer accounts, contacts, sites, opportunities, quotes, sales orders, and storefront orders.
- Storefront has 3 active quote/inquiry items: `Open Digital Product Factory`, `DPF Customer-Zero Workshop`, and `Governed Build Studio Enablement`.
- Native integration credentials are empty in the current install. QuickBooks, Stripe, and ADP are not connected.
- Tax/remittance is the exception: there is 1 organization tax profile, 1 tax registration, 2 tax obligation periods, and 1 tax remittance run.

This matters: current DPF parity is mostly schema, UI, routes, and integration substrate. It is not yet proven as a live small-business operating cockpit with active finance/customer/integration data.

## Current DPF Capability Map

### Finance

The user guide states the current boundary clearly: DPF Finance handles billing customers, supplier relationships, and purchase processing, but is not a full accounting system. That boundary is still right.

Existing native finance capabilities:

- Accounts receivable: invoices, invoice line items, send/PDF routes, inbound payments, allocations, dunning.
- Accounts payable: suppliers, bills, bill line items, purchase orders, approvals, payment runs.
- Expenses: employee expense claims and claim items.
- Banking: bank accounts, bank transactions, manual import, bank rules, reconciliation flow.
- Recurring schedules: recurring invoices or related lines.
- Assets and exchange rates.
- Reports: profit and loss, cash flow, VAT summary, revenue by customer, outstanding invoices, aged debtors, aged creditors.
- Tax/remittance: tax profiles, registrations, decision snapshots, liabilities, obligation periods, filing artifacts, issues, authority credentials, remittance runs.
- AI supplier finance bridge: AI provider finance profiles, supplier contracts, allowances, usage snapshots, finance work items.

Shallow or missing finance capabilities:

- No chart of accounts or general ledger model.
- No journal entry, trial balance, account register, or accountant close model.
- No bank-feed provider integration in the active runtime.
- No QuickBooks or Xero bidirectional sync.
- No payroll ledger, payroll tax, payslip, or benefits model.
- No native receipt capture or merchant-card settlement workflow.
- Reports are operational summaries over DPF transaction records, not full accounting statements.

### QuickBooks Native Integration

DPF already has a real QuickBooks connection path:

- `/platform/tools/integrations/quickbooks`
- `/api/integrations/quickbooks/connect`
- `apps/web/lib/integrate/quickbooks/connect-action.ts`
- `apps/web/lib/integrate/quickbooks/accounting-client.ts`
- `services/integration-test-harness/vendors/quickbooks/*`

Current QuickBooks scope:

- OAuth refresh-token exchange.
- Company info probe.
- Sample customer probe.
- Sample invoice probe.
- Encrypted credential persistence in `IntegrationCredential`.
- Native integration catalog descriptor for company, customer, invoice, and accounting previews.
- Harness scenarios for happy path, rate limit, auth failure, token expiry, empty list, malformed response, and prompt-injection-like content.

Current QuickBooks gaps:

- No vendor, bill, payment, item, account, transaction, report, tax, or bank-feed entity mapping.
- No readiness snapshot that tells an operator what the integration can and cannot currently do.
- No visible sync map between DPF entities and QuickBooks entities.
- No accountant workflow support.
- No approval-governed write proposal path for creating or updating QuickBooks entities.

### Customers

Existing native customer capabilities:

- Customer accounts and contacts.
- Customer sites and configuration items.
- Opportunities, quotes, sales orders, engagements, activities.
- Marketing/customer workspace guidance.

Current gaps:

- No live customer records in the current install.
- Customer and finance records are not yet visibly tied to external accounting contacts/customers.
- Vendor records are finance-owned suppliers, not part of a broader external party identity model.

### Storefront

Existing native storefront capabilities:

- Public inquiry, booking, checkout, donate, pay, approve, and expense-approve routes.
- Storefront items, provider services, bookings, inquiries, orders, archetypes, and setup/admin surfaces.
- Current DPF install is quote/inquiry led, not cart-led.

Current gaps:

- Storefront activity is not yet flowing through live customer, invoice, payment, accounting, or bank reconciliation rows in the current install.
- Storefront setup does not yet ask, in one coherent flow, "where do your books, payments, payroll, taxes, and bank feeds live?"

### Setup and Archetypes

Relevant current rule: `BusinessContext`, `BusinessModel`, `BusinessModelRole`, `StorefrontArchetype`, and `StorefrontConfig` are separate models. They must not be collapsed just to make setup feel simpler.

Existing capability:

- `BusinessContext` is the canonical business strategy/context record.
- `StorefrontArchetype` drives portal industry/operating model vocabulary.
- Finance setup profile is derived from storefront archetype category.
- Software-platform archetype exists for DPF itself.

Current gap:

- Finance/integration setup is derived after the archetype rather than becoming part of a conversational operating-system readiness journey.

## Research and Benchmarking

### What Small Businesses Use Day to Day

Across QuickBooks, Xero, FreshBooks, and Zoho Books, the day-to-day SMB operating loop is consistent:

1. Capture revenue intent: quotes, estimates, proposals, orders, projects, or bookings.
2. Convert work to cash: invoices, online payments, payment reminders, receipts, payment matching.
3. Control spend: bills, expenses, purchase orders, receipts, approvals, reimbursements.
4. Keep bank truth current: bank feeds, imported statements, categorization, rules, reconciliation.
5. Stay compliant: sales tax/VAT/GST, payroll tax, 1099/W-9 or equivalent, filings, audit trails.
6. Know the business: dashboards, P&L/cash flow/aging reports, customer/vendor ledgers, project profitability.
7. Collaborate with specialists: accountant/bookkeeper access, partner tools, workpapers, exports, evidence.
8. Set up quickly: guided onboarding, demo data, business profile, connected apps, accounting method, tax settings, payroll/payment options.

### QuickBooks Online

Official QuickBooks materials position QuickBooks Online as an accounting platform that connects accounts and tools into one business view, automatically syncs bank and credit card transactions, tracks receipts and mileage, supports payroll/time tracking add-ons, and lets accountants/bookkeepers access the company file.

Relevant official sources:

- [QuickBooks accounting software overview](https://quickbooks.intuit.com/accounting/)
- [QuickBooks Online Accounting API overview](https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api)
- [QuickBooks Payments support: receive and process payments](https://quickbooks.intuit.com/learn-support/en-us/help-article/invoicing/take-process-payments-quickbooks-online/L2vHwwVmh_US_en_US)
- [QuickBooks accountant access support](https://quickbooks.intuit.com/learn-support/en-ca/help-article/account-management/managing-accountant-users-quickbooks-online/L2AcdYvHw_CA_en_CA)
- [QuickBooks bank and credit card account connection support](https://quickbooks.intuit.com/learn-support/en-us/help-article/banking/connect-bank-credit-card-accounts-quickbooks/L4yDAHMNH_US_en_US)

Capabilities DPF should benchmark against:

| Area | QuickBooks baseline | DPF implication |
| ---- | ------------------- | --------------- |
| Accounting | Accounting API exposes customer-facing entities, query requests, batch operations, transactions, journal entries, and related resources. | Treat QuickBooks as accounting source of truth. Do not rebuild a full ledger first. |
| Invoicing | Create, send, pay, and reconcile invoices. | DPF can deepen operational invoice workflow, but should sync/account for invoices through QuickBooks or Xero. |
| Payments | QuickBooks Payments supports invoice, in-person, phone, PayPal, Venmo, card, and ACH flows. | Payment execution should stay integration-led; DPF should own payment readiness, approvals, and operational status. |
| Expenses | Receipt capture, mileage, expenses, bank-card sync. | DPF expense claims are a start; receipt capture, card import, and expense-to-bank matching are missing. |
| Payroll touchpoints | Payroll is an add-on integrated with books, tax, time tracking, and compliance. | Native payroll should stay out of scope. ADP/Gusto/QuickBooks Payroll should be integration-led. |
| Tax/VAT | Sales tax setup, rate changes, reports, tax-time organization. | DPF has strong tax/remittance workflow potential, but calculation/filing authority should remain specialist/integration-led unless explicitly scoped. |
| Bank feeds/reconciliation | Bank and credit card connections automatically download transactions; categorization/reconciliation are core routines. | DPF has manual banking/reconciliation primitives but needs provider-backed feeds and readiness visibility. |
| Reports | Business, accounting, aging, tax, and cash reports are expected. | DPF reports should remain operational unless/until a ledger exists. |
| Customer/vendor records | Customers, vendors, invoices, bills, payments, and accounts are connected accounting objects. | DPF needs external entity links and sync status, not duplicate master-data drift. |
| Accountant workflows | Accountant users can be invited and get accountant-specific tools. | DPF should prepare accountant packets/evidence and deep-link/sync to QuickBooks, not clone accountant workpapers immediately. |
| Setup/onboarding | Guided setup and add-ons for payroll/time/payments. | DPF setup should ask for accounting system, payment processor, payroll provider, tax profile, and bank-feed posture. |

### Xero

Xero's official feature list covers invoices, payment acceptance, bank connections, bank reconciliation, expenses, bills, purchase orders, reporting, contacts, sales tax through Avalara, fixed assets, app integrations, and accountant/bookkeeper practice tooling.

Source: [Xero all features](https://www.xero.com/us/accounting-software/all-features/).

DPF implication:

- Xero confirms the same accounting-system-of-record boundary as QuickBooks.
- Xero should remain close behind QuickBooks as a read-first finance anchor.
- DPF should not assume all SMB accounting anchors are US-centric; Xero and Zoho make multi-currency, VAT/GST, and advisor workflows more prominent. The entity-link model must carry currency and locale from the first import projection.

### FreshBooks

FreshBooks emphasizes invoices, billing/payments, expenses, payroll, accounting, mileage, reporting, clients, proposals, estimates, team management, bookkeeping, and 100+ app integrations. It is especially relevant for freelancers, solopreneurs, contractors, and service businesses.

Source: [FreshBooks features](https://www.freshbooks.com/).

DPF implication:

- For service businesses, project/time/proposal-to-invoice flow is as important as pure accounting.
- DPF's quote/inquiry storefront and customer pipeline can be a strong native complement if invoice/payment/accounting sync becomes trustworthy.
- DPF should keep "operational proposal/quote to governed delivery" native and integrate final books/payroll.

### Zoho Books

Zoho Books exposes a broad accounting operating suite: quotes, invoices, sales orders, online payments, sales approvals, vendor bills, purchase orders, expense capture, tax/1099 support, bank feeds, transaction categorization, reconciliation, inventory, projects, user roles, and audit trail.

Source: [Zoho Books accounting software features](https://www.zoho.com/us/books/accounting-software-features/).

DPF implication:

- Zoho shows that SMB operators expect role permissions and audit trail inside the operating flow, not as an afterthought.
- DPF already has a stronger governance posture than most SMB accounting tools. It should turn that into the differentiator around readiness, approval, evidence, and AI coworker containment.

## Key Architecture Decisions

These decisions are load-bearing. They constrain implementation across all slices. Revisiting any of them requires a spec amendment, not a backlog item.

### ADR-1: Integrate Before Replace

**Decision:** DPF will not build a native ledger until it can read, import, and reconcile against an external accounting system. Ledger construction follows proof, not feature checklist completion.

**Rationale:** A ledger is a trust surface. SMB operators and their accountants will not trust a new ledger unless the platform has demonstrated that it can match the existing system's output to within accepted variance over a defined period. Building the ledger first inverts this trust requirement and creates a shadow accounting system that cannot be audited against anything real.

**Implication:** Any code that writes journal entries, closes periods, locks accounts, or calculates retained earnings is out of scope until Slice 7 (dual-run close) passes acceptance.

### ADR-2: Ownership Lives in One System at a Time

**Decision:** For any entity family (invoices, customers, vendors, payments, accounts), exactly one system is designated the owner at any given time. DPF tracks external entities by reference, not by copy-first. Promotion of ownership to DPF happens per entity family, per install, and is an explicit operator or governance action.

**Rationale:** Duplicate master data without a clear ownership authority is the root cause of most accounting migration failures. The entity-link model (Slice 4) must carry the owner designation and enforce that only the owner's record is treated as truth for reporting and compliance purposes.

**Implication:** DPF must not silently become the de-facto owner of invoice or customer records just because it imported them. Import creates a read model, not an ownership claim.

### ADR-3: Write Operations Require Explicit Human Approval

**Decision:** No DPF code path, AI coworker, or background job may create or update an entity in an external accounting system without an explicit human approval step using TAK/authority approval semantics, a dry-run diff shown to the approver, and a recorded evidence trail.

**Rationale:** Write errors in accounting systems can create legal, tax, and audit liability. The DPF governance posture is already approval-oriented; accounting writes must be its strictest implementation.

**Implication:** Slice 1 is read-only. Slice 6 introduces write proposals only after read coverage and import projection are established. Any slice that proposes adding a write path must include the full approval/evidence/rollback design, not just the API call.

### ADR-4: Readiness Visibility Precedes Capability

**Decision:** Before any accounting capability is usable by an operator or coworker, DPF must expose a readiness descriptor for it: what is supported, what is not, what the current mode is (read / import-ready / dual-run-ready / DPF-primary-ready / partner-led), and what the next safe action is.

**Rationale:** Empty UI that looks complete causes operators to make decisions based on implied capability DPF does not have. The "false parity" risk is architectural, not cosmetic. The readiness descriptor is the enforcement mechanism.

**Implication:** The `IntegrationReadinessDescriptor` introduced in Slice 1 is a first-class architectural primitive, not a one-off UI card. All future finance and integration surfaces must implement it.

### ADR-5: Credentials Are Customer-Owned; DPF Is a Conduit

**Decision:** Integration credentials belong to the customer install. DPF orchestrates and audits but does not pool, broker, or proxy credentials across installs. No DPF-controlled credential serves multiple organizations.

**Rationale:** SMB financial integrations carry tax, audit, and fiduciary weight. Pooling credentials would make DPF a financial intermediary in regulatory terms, which is out of scope for the OSS platform and against the conduit posture established for all enterprise integrations.

**Implication:** Each install's QuickBooks/Stripe/ADP credentials live only in that install's `IntegrationCredential` table, encrypted at rest. Coworkers see credential metadata (status, expiry, environment, last probe outcome) but never the underlying secret. Decryption is scoped to the integration adapter at call time and is never exposed to coworker tool surfaces.

### ADR-6: Accountant Is a Principal, Not Just a Recipient

**Decision:** The platform must model accountants and bookkeepers as a distinct principal type with read access to evidence packets, approved export formats, and the ability to comment or flag items. They are not granted write access to DPF records, and DPF does not attempt to clone their QuickBooks/Xero tooling.

**Rationale:** Accountants are the trust anchor for small-business books. Ignoring them until an "accountant portal" is scoped means DPF cannot complete the governance loop for any real SMB. The evidence packet (Slice 8) serves this principal. Designing it requires knowing, from now, that the accountant has different permissions and different workflows than the operator.

**Implication:** Future user-role design must include an `accountant` role type with scoped read access. The evidence packet format must be designed for accountant consumption, not operator consumption.

## Gap Analysis

| Capability | DPF Today | Depth | Priority | Recommended Posture |
| ---------- | --------- | ----- | -------- | ------------------- |
| Accounting ledger | No chart of accounts, journal entries, trial balance, or account registers. | Missing | Post-proof | Strategic native target, but only after read/import mapping and dual-run proof. QuickBooks first, Xero close behind. |
| Invoicing | Native invoices, line items, PDF/send routes, status, payments. | Medium but unproven live | High | Deepen native operating workflow; sync/account externally. First priority for import projection. |
| Payments | Native payment records and Stripe catalog entry; no live credentials. | Shallow | High | Native operating workflow plus partner money movement until DPF has settlement-grade rails. |
| Expenses | Native expense claims/items. | Shallow-medium | Medium | Deepen approvals and evidence; integrate receipt/card/bank sources. |
| Payroll | ADP/payroll connector backlog exists; no native payroll model. | Missing | Low (partner-led) | Partner-led for the foreseeable future; DPF owns workforce/payroll readiness, evidence, approvals, and reconciliation. |
| Tax/VAT | Strong tax/remittance schema and live rows. | Medium-strong | Medium-high | Keep native evidence, registration, obligation, and remittance workflow; integrate calculation/filing authorities. |
| Bank feeds/reconciliation | Bank accounts, transactions, rules, manual import, reconcile UI. | Medium but isolated | High | Deepen natively through imported feeds, matching, and reconciliation; use Plaid/QuickBooks/Xero as feed and comparison sources. |
| Reports | Operational reports over DPF records. | Medium but not accounting-grade | Low-medium | Keep operational native reports; use external accounting reports for statutory truth until ledger exists. |
| Customer records | Customer account/contact/site/pipeline schema. | Medium but empty live | High | Add external accounting/contact sync visibility. First entity family for link model. |
| Vendor records | Supplier and AP schema. | Medium but empty live | Medium | Map suppliers to QuickBooks vendors/Xero contacts; avoid parallel drift. |
| Integrations substrate | IntegrationCredential, native catalog, QuickBooks probe, harness. | Strong substrate, narrow coverage | High (foundation) | Build readiness/import/sync maps before writes; treat integrations as replacement scaffolding, not only permanent dependencies. |
| Accountant workflows | No accountant packet or collaboration surface. | Missing | Medium | Native evidence packet plus accounting-system handoff, not full accountant suite. |
| Setup/onboarding | BusinessContext/archetype/storefront/finance setup split. | Medium | Medium | Add operating-system setup questions for books, payroll, payments, bank feeds, tax, accountant. |
| Integration health/observability | No proactive credential health or integration failure signaling. | Missing | High | Credential expiry alerts, probe health, and integration failure visibility must be first-class. |

## Recommended Architecture Posture

DPF should be the governed small-business operating system. That includes a long-term path to replace QuickBooks-class day-to-day business operations for target businesses, but not by pretending a ledger is only a feature checklist.

The corrected posture is **integrate to replace**:

- Read QuickBooks first to learn the customer's real operating truth.
- Import and map QuickBooks data so DPF can explain the business in its own model.
- Dual-run DPF records against QuickBooks until reconciliation, reports, tax posture, and accountant handoff are trustworthy.
- Promote DPF to system of record by capability and archetype, starting with operational finance and ending with ledger-grade accounting where the platform has enough proof.
- Keep specialist rails, such as payment settlement, bank connectivity, payroll filing, and jurisdictional tax filing, partner-led until DPF has a governed reason and verified capability to own them.

### Operating Modes and Promotion Gates

Every entity family and every install has an explicit operating mode. Mode transitions are not automatic; they require a promotion event with defined acceptance criteria.

| Mode | Meaning | Gate to promote |
| ---- | ------- | --------------- |
| `integration-led` | External system is owner and source of truth. DPF reads by probe or import. | Read coverage for the entity family established and readiness descriptor rendered. |
| `dual-run` | DPF tracks the same entities natively alongside the external system. Discrepancies are surfaced and must be resolved. | Import projection complete, DPF native records match external records within defined variance (configurable, default ≤ 1% by count and ≤ 0.1% by value) over at least one full business period. |
| `dpf-primary` | DPF is the owner and source of truth for this entity family in this install. External system may remain as an export target or audit comparison. | Dual-run acceptance passed, accountant review completed or explicitly waived, rollback plan documented, and promotion approved by an authorized operator principal. |
| `partner-led` | DPF does not own and does not intend to own this capability. It surfaces readiness, evidence, and approvals but delegates execution. | Not a promotion; a deliberate architectural designation. Payroll, jurisdictional tax filing, and payment settlement start here and should only leave with a dedicated spec. |

### Entity Ownership and Conflict Resolution

When DPF imports or reads an external entity, the ownership model must be explicit:

- **Read model:** DPF stores a cached read of the external entity, source-attributed, with a `lastObservedAt` timestamp and the external system's ID. DPF reports derived from a read model are clearly marked as sourced from the integration, not from DPF's authoritative records.
- **Imported entity:** DPF creates a native record with a link to the external entity via the entity-link model (Slice 4). The external system remains the owner. DPF's native record is updated from the external system on each sync, not from operator edits.
- **Promoted entity:** After DPF-primary promotion, DPF's native record is the owner. The external system's record is treated as an export target and may receive write proposals through the approval path.
- **Conflict resolution:** If DPF detects a value mismatch between a native record and an external record for the same entity during dual-run, it creates a reconciliation item visible to the operator. Reconciliation items must be resolved before a period can be closed or before a promotion gate can be evaluated. DPF never silently overwrites either side.

### Integration Health and Observability

Integration health is a first-class architectural concern, not a logging afterthought. The following signals must be visible to operators and available to AI coworkers:

- **Credential status:** connected, expired, revoked, missing. Includes time-until-expiry for token-based credentials.
- **Last successful probe:** timestamp, entity families probed, response shape.
- **Probe error history:** last N probe failures with error category (auth, rate-limit, network, malformed, empty).
- **Sync lag:** time since last import projection run for each entity family, where applicable.
- **Reconciliation item count:** open unresolved discrepancies by entity family.
- **Mode:** current operating mode per entity family.

These signals feed the Business OS Command Center and the readiness descriptor. They are not stored in logs; they are stored in addressable state so coworkers can query them without reading log files.

### Full Product Architecture

1. **Native operating workflow** for quotes, customer work, invoices-in-progress, spend approvals, expense claims, tax readiness, AI supplier finance work, command-center signals, and evidence.
2. **QuickBooks/Xero import and comparison** for chart of accounts, customers, vendors, invoices, bills, payments, bank transactions, reports, and accountant expectations. QuickBooks is the first anchor. Xero follows closely.
3. **Native DPF accounting-core trajectory** for entity links, subledgers, chart of accounts, journal entries, close periods, audit locks, retained earnings, accountant exports, and ledger-grade reports. This trajectory begins only after dual-run proof per ADR-1.
4. **Payment integration** for actual money movement and card/ACH settlement until DPF has settlement-grade rails. Stripe and QuickBooks Payments are anchors.
5. **Payroll integration** for payroll, payroll taxes, benefits, and employee payments. ADP is the current DPF-native benchmark anchor; Gusto should be tracked because Xero and FreshBooks use it heavily in the US.
6. **Tax authority and filing integration** where DPF owns registration, evidence, obligation, approval, and remittance control, but does not claim jurisdictional filing/calculation authority before verification.
7. **Read-first, approval-governed write-later** for all accounting/payments/payroll operations, followed by dual-run and then DPF-primary modes per the operating mode promotion gates above.

### AI Coworker Tool Surface

The readiness descriptor is a queryable substrate for AI coworkers, not just a UI element. The Finance coworker and the Business OS coworker must be able to inspect integration state and propose actions without seeing secrets.

**Read-only coworker tools (no approval required, no secret exposure):**

- `get_integration_readiness(provider)` — returns the full readiness descriptor including state machine values, health signals, and next safe actions for every entity family.
- `list_integrations(filter?)` — returns connected providers with current mode per entity family.
- `get_reconciliation_items(provider, entityFamily)` — returns unresolved discrepancies (count and category only when called read-only; values are gated to authorized principals).

**Proposal-mode coworker tools (require approval per ADR-3):**

- `propose_credential_action(provider, action)` — actions limited to `reconnect`, `refresh_probe`, `mark_partner_led`. Disconnect requires operator action in the UI, not a coworker tool.
- `propose_mode_promotion(provider, entityFamily, targetMode)` — requires the gate conditions to be satisfied and produces an evidence-bound approval request.
- `propose_reconciliation_resolution(itemId, resolution)` — surfaces a proposed resolution to a reconciliation item; the operator approves the actual write.

**What coworkers must never have:**

- Access to credential payloads, tokens, or secrets.
- The ability to bypass the approval path for any write operation against an external system.
- The ability to override the readiness state machine (e.g., mark something `dpf-primary-ready` without the gate being passed).

The Finance coworker's prompt and grants must be updated as part of Slice 1 to include the read-only tools. The proposal-mode tools are added in Slice 6.

### Credential Security Model

`IntegrationCredential` is the credential substrate, but ADR-5 imposes an explicit boundary that this spec records for downstream implementers:

- **At rest:** credential payloads are encrypted with the install's key. The key is not shared across installs.
- **In transit:** decryption occurs only inside the integration adapter (e.g., `apps/web/lib/integrate/quickbooks/accounting-client.ts`) at API call time. Decrypted material does not leave the adapter.
- **Coworker boundary:** coworker tools resolve a `providerId` to capability and metadata, never to a credential. Logs and traces must redact credential fields before they reach `IntegrationToolCallLog` or `[tool-trace]` output.
- **Rotation:** OAuth refresh is handled by the adapter on its normal cadence. Manual rotation flows through the UI, not through coworker tools.
- **Key rotation across installs:** out of scope for SMB parity but flagged as a future operational concern for the managed and hosted topologies.

### Hive Mind Contribution Boundary

DPF's recursive self-improvement contract is that every install contributes back to the hive mind. For finance integrations, the contribution boundary requires explicit definition because the data is sensitive.

**Contributable (anonymized, aggregate, no customer identification):**

- Capability coverage statistics: how many installs have QuickBooks `customers` in `read` vs. `import-ready` state, distribution across entity families.
- Probe error categories: rate-limit frequency, common malformed-response patterns, auth-failure root causes.
- Mode promotion adoption: how often installs reach `dual-run`, `dpf-primary`, in what archetype contexts.
- Reconciliation item taxonomy: which categories of discrepancy show up most often (e.g., "tax category mismatch", "missing line item").
- Setup completion patterns: which setup questions correlate with smoother integration paths.

**Never contributable:**

- Customer entity values: balances, invoice amounts, vendor names, customer names, transaction details.
- Credentials, tokens, or any decryptable form of authentication material.
- Tax obligation values or filing artifacts.
- Accountant identities or correspondence.
- Anything that would let another install reconstruct a customer's books.

The contribution boundary must be enforced in the contribution code path, not relied on as a hive-scout filter. Slice 2 onwards must include contribution-eligibility tagging on every new readiness field; the contributor refuses to send any field that lacks an explicit tag.

### Architectural Constraints

This posture respects existing DPF architecture:

- `IntegrationCredential` remains the credential substrate.
- `ToolExecution` and `IntegrationToolCallLog` remain audit evidence for tool/API operations.
- Backlog and MCP tools remain the governed planning surface.
- `BusinessContext` remains business strategy context.
- `StorefrontArchetype` remains operating vocabulary and storefront shape.
- Finance remains the transactional operating layer today and becomes the path into a native accounting core once import, reconciliation, close, and reporting proof exist.
- Business OS command center/readiness surfaces become the place where gaps, stale connections, and mode transitions are visible.

## Backlog and Spec Updates Needed

### Existing Backlog to Extend

Update `BI-INT-A5B9E3` with this spec as the benchmark artifact and refine acceptance toward a QuickBooks read-first readiness/sync slice.

Suggested added acceptance:

- QuickBooks is treated as the first accounting benchmark, import source, and migration bridge, not as the permanent center of gravity.
- The first implementation exposes which QuickBooks accounting entities DPF can read now and which are intentionally unmapped.
- The operator can see credential status, last probe time, environment, company/realm context, current read capabilities, missing entity families, and next safe action.
- The roadmap explicitly includes DPF-primary operating modes after read/import, sync-map, dual-run, and accounting-core proof.
- The design reserves room for Xero and Stripe without hardcoding QuickBooks-only UI assumptions.
- Every entity family has an explicit operating mode and a defined promotion gate.

Update `BI-INT-92C1F8` to reference this architecture posture for finance anchor native integrations, including the operating mode promotion gate model.

Update `BI-INT-F23BC6` to cross-reference the payroll boundary: payroll remains `partner-led` in the first SMB parity track, while DPF owns readiness, employee/workforce context, approvals, evidence, and payroll-to-finance reconciliation.

Update `BI-ARCH-4C1E90` or its successor setup item to add operating-system setup questions:

- Accounting system: QuickBooks, Xero, Zoho Books, FreshBooks, none/manual, other.
- Payment processor: Stripe, QuickBooks Payments, Square, PayPal/Venmo, other.
- Payroll provider: ADP, Gusto, QuickBooks Payroll, none, other.
- Bank feeds: connected through accounting system, Plaid/open banking, CSV/manual, not configured.
- Tax posture: sales tax/VAT/GST required, remittance calendar known, accountant/bookkeeper involved.
- Accountant/bookkeeper: invited to accounting system, needs DPF evidence packet, none.
- Accounting method: cash, accrual.

### New Backlog Item

Created under `EP-INT-2E7C1A`: `BI-AA303B6F`.

**Title:** QuickBooks Accounting Readiness Snapshot

**Type:** product

**Scope:** First buildable finance-anchor slice that turns the existing QuickBooks connection/probe into an operator-visible readiness, import, and future replacement map.

**Description:**

Build a read-only QuickBooks readiness snapshot on `/platform/tools/integrations/quickbooks` using the existing native integration catalog, `IntegrationCredential`, QuickBooks connect/probe code, and integration harness. The snapshot must show what DPF can read today, what is not yet mapped, when the credential was last verified, which realm/company/environment is connected, what would be needed for DPF-primary operation, what the current operating mode is per entity family, and what the next safe action is. It must not introduce QuickBooks writes.

**Acceptance:**

- Shows current connection state without exposing secrets.
- Shows read capability states for company, customers, invoices, vendors, bills, payments, accounts, bank transactions, reports, tax, and accountant workflow.
- Marks company/customer/invoice as currently supported by code.
- Marks vendors/bills/payments/accounts/bank transactions/reports/tax/accountant workflow as not yet mapped.
- Adds a migration-stage/operating-mode label for every capability row: `read`, `import-ready`, `dual-run-ready`, `dpf-primary-ready`, or `partner-led`.
- Includes integration health signals: credential status, time-until-expiry, last successful probe timestamp, last probe error category.
- Uses a shared `IntegrationReadinessDescriptor` type so Stripe/Xero/ADP readiness cards can reuse the same pattern without duplication.
- Uses DPF theme tokens and fixes hardcoded colors in touched QuickBooks UI.
- Adds harness/API test coverage for readiness derivation.
- Leaves write operations out of scope.

## Smallest Buildable Slice

### Slice Name

QuickBooks Accounting Readiness Snapshot

### Why This Slice

The benchmark does not justify building the ledger first. It does justify making the replacement path explicit. The existing QuickBooks code already proves a small read path, but the product does not expose its boundaries or migration value clearly. The smallest high-value move is to make the current integration honest, visible, extensible, and pointed toward DPF-primary operation.

That makes future work safer because operators, coworkers, and implementers will all see the same capability map before any import, write, sync, dual-run, or replacement automation is proposed. It also establishes `IntegrationReadinessDescriptor` as the architectural primitive that enforces ADR-4 across all future finance and integration surfaces.

### Descriptor as Reusable Primitive

Per the platform's reusability-by-design principle, `IntegrationReadinessDescriptor` is parameterized from inception so Stripe, Xero, ADP, Plaid, and future integrations can reuse it without modification:

- **Provider-agnostic shape:** entity families are a parameter, not an enum. QuickBooks contributes `customers, invoices, vendors, bills, payments, accounts, bank_transactions, reports, tax, accountant_workflow`. Stripe will contribute `customers, charges, payouts, disputes, balance_transactions, products, subscriptions`. The descriptor type does not name any of these.
- **Schema versioned from v1:** the descriptor carries `schemaVersion: "1.0"` in its serialized form. Hive-mind contributions and cross-install comparisons require this for forward compatibility.
- **Generic state machine:** the state set (`not-connected`, `credential-expired`, `not-mapped`, `read`, `import-ready`, `dual-run-ready`, `dpf-primary-ready`, `dpf-primary`, `partner-led`) is identical across providers. Providers that cannot reach certain states (e.g., a payment processor that never enters `dpf-primary` per ADR-1) declare unreachable states explicitly rather than altering the type.
- **Contribution-eligibility tagging:** each field on the descriptor is tagged `hive:public`, `hive:aggregate-only`, or `hive:private` per the contribution boundary section. The tags are mechanically enforced.

### Relationship to AI Provider Finance Bridge

The [AI Provider Finance Bridge](2026-04-23-ai-provider-finance-bridge-design.md) already governs AI provider supplier contracts, allowances, usage snapshots, and finance work items. SMB parity does not displace that bridge — they are complementary:

- The AI Provider Finance Bridge is the supplier-side finance pipeline for the platform's own AI provider spend, with its own integration anchor (provider billing portals, eventually their APIs).
- The QuickBooks anchor is the customer-side accounting pipeline for the business running DPF.
- Both produce `FinanceWorkItem` instances; the originating source (AI provider vs. accounting integration) is what differentiates them at routing time.
- The `IntegrationReadinessDescriptor` primitive defined here can and should be reused for AI provider billing connections in a future iteration of the AI Provider Finance Bridge surface.

### Readiness State Machine

The readiness descriptor for each capability row is a state machine, not a status string. Valid states and their semantics:

| State | Meaning | UI signal |
| ----- | ------- | --------- |
| `not-connected` | No credential in `IntegrationCredential` for this provider. | Red chip: "No credentials" |
| `credential-expired` | Credential exists but token is expired or probe returned auth failure. | Red chip: "Credential expired" |
| `not-mapped` | Credential valid; DPF has no code to read this entity family. | Grey chip: "Not mapped" |
| `read` | DPF can read this entity family via probe or query. | Blue chip: "Read only" |
| `import-ready` | Read coverage established; import projection code exists or is committed. | Teal chip: "Import ready" |
| `dual-run-ready` | Import complete; native records match external records within variance thresholds. | Amber chip: "Dual run" |
| `dpf-primary-ready` | Dual-run acceptance passed; promotion requires operator approval. | Green chip: "Ready to promote" |
| `dpf-primary` | DPF is owner. External system is export/audit target. | Green chip: "DPF primary" |
| `partner-led` | Intentionally not owned. Evidence/readiness surfaced but execution delegated. | Purple chip: "Partner led" |

Transitions are monotonically forward within a session. Regression (e.g., credential expiry) reverts to `credential-expired` regardless of prior progress, preserving the last-known state so the operator can see what was working before the regression.

### Implementation Shape

Files likely touched:

- `apps/web/lib/tools/native-integration-catalog.ts`
- `apps/web/app/(shell)/platform/tools/integrations/quickbooks/page.tsx`
- `apps/web/components/integrations/QuickBooksConnectPanel.tsx`
- New shared primitive: `apps/web/lib/integrate/readiness.ts` (exports `IntegrationReadinessDescriptor` type and derivation logic)
- Tests near the helper and existing QuickBooks route/client tests.

Build steps:

1. Add a typed `IntegrationReadinessDescriptor` with capability rows, state machine type, integration health fields, and next-safe-action derivation.
2. Add QuickBooks accounting capability rows with initial states:
   - `company`: `read` (supported now)
   - `customers`: `read` (supported now)
   - `invoices`: `read` (supported now)
   - `vendors`: `not-mapped`
   - `bills`: `not-mapped`
   - `payments`: `not-mapped`
   - `accounts`: `not-mapped`
   - `bank_transactions`: `not-mapped`
   - `reports`: `not-mapped`
   - `tax`: `not-mapped`
   - `accountant_workflow`: `partner-led`
3. Derive credential health from `IntegrationCredential`: connected status, token expiry (where available from the credential payload), environment, company/realm.
4. Render a compact, theme-aware readiness panel on the QuickBooks integration page using state machine chip colors and health signals.
5. Derive next-safe-action from the aggregate state: if `not-connected`, show "Connect QuickBooks"; if `credential-expired`, show "Reconnect"; if all mapped rows are `read`, show "Expand entity coverage"; etc.
6. Add a safe "Test connection" or "Refresh readiness" path only if it can reuse the existing probe without expanding permissions. If this cannot be done cleanly, show last-known state only and leave refresh as a follow-on.
7. Refactor touched UI to remove hardcoded colors and use DPF CSS variables. Reserve roughly 20% of the slice for this cleanup and the shared descriptor extraction.

### Out of Scope for This Slice

- QuickBooks writes.
- Invoice sync.
- Vendor/bill/payment/account/report API expansion.
- Xero implementation.
- Payroll implementation.
- Native general ledger implementation.
- Plaid/open-banking feeds.
- New Prisma models.
- Accountant portal/workpapers.
- Operating mode promotion logic (the descriptor exposes mode; promotion is Slice 4+).

### Verification

- Unit tests for readiness descriptor derivation including state machine transitions.
- Unit tests for credential health derivation from `IntegrationCredential` payload shapes.
- Existing QuickBooks connect route tests still pass.
- `pnpm --filter web typecheck`.
- `cd apps/web && pnpm exec next build`.
- UX verification against the Docker-served portal at the configured `APP_URL`/`AUTH_URL`.
- Confirm `/platform/tools/integrations/quickbooks` renders without hardcoded-color regressions in light/dark/brand modes.
- Confirm the `IntegrationReadinessDescriptor` type is exported from `readiness.ts` and that the QuickBooks panel imports it from there, not from a local definition.

## Follow-On Roadmap

Slices are ordered by dependency. A slice may not begin until its listed prerequisites have shipped to `main`.

### Slice 2: QuickBooks Read Expansion

**Prerequisites:** Slice 1 shipped; readiness descriptor renders for unmapped entity families.

Add read-only support for vendors, bills, payments, accounts, bank transactions where available, and reports through the QuickBooks Accounting API and harness. Update capability states from `not-mapped` to `read` as coverage is added. Still no writes. Update harness scenarios for each new entity family.

### Slice 3: QuickBooks Import Projection

**Prerequisites:** Slice 2 shipped; vendors, bills, payments, and accounts are in `read` state.

Bring selected QuickBooks records into DPF-owned read models so the platform can render operating-state truth without treating QuickBooks as the UI of record. Records are source-attributed, clearly labeled as imported from QuickBooks, and not editable by operators until ownership is promoted. Update capability states to `import-ready` per entity family as projection is confirmed.

### Slice 4: External Entity Links

**Prerequisites:** Slice 3 shipped; at least one entity family has an import projection.

Add a canonical integration entity-link pattern so DPF customers, suppliers, invoices, bills, payments, and tax obligations can point to external accounting objects while DPF is still migrating toward primary ownership.

Minimum model fields:

- `provider`
- `integrationId`
- `externalEntityType`
- `externalEntityId`
- `localEntityType`
- `localEntityId`
- `syncStatus`
- `ownerSide` (external / dpf)
- `currency`
- `locale`
- `lastObservedAt`
- `lastSyncedAt`
- `direction`
- `evidenceRef`

Do not add this model until Slice 3 proves the exact read/sync needs. The `currency` and `locale` fields are required from the start to support non-US installs.

### Slice 5: Native Accounting Core Foundation

**Prerequisites:** Slice 4 shipped; entity links are established for invoices and customers; at least one import projection cycle has completed and produced reconciliation items.

Design and implement the first ledger-grade foundation only after DPF can read and reconcile external accounting data. This slice requires its own dedicated spec before implementation begins. Minimum scope: chart of accounts, journal entry, accounting period, audit lock, trial balance, and retained-earnings handling. This is the first step toward true QuickBooks replacement, not a UI clone. The spec must define the accounting method handling (cash vs. accrual), multi-currency treatment, and the relationship between the DPF journal entry model and imported QuickBooks transactions.

### Slice 6: Invoice Sync Proposal Mode

**Prerequisites:** Slice 2 shipped for invoices (read state); Slice 4 shipped (entity links).

Allow a finance coworker to propose creating or updating a QuickBooks invoice from a DPF invoice, with human approval per ADR-3, dry-run diff shown to the approver, and a `ToolExecution` evidence trail. This must use TAK/authority approval semantics and must not be a background write. Write errors must surface as reconciliation items, not silent failures.

### Slice 7: Dual-Run Close and Reconciliation

**Prerequisites:** Slice 5 shipped (native accounting core); Slice 6 shipped (write proposals working).

Run DPF accounting outputs beside QuickBooks outputs for a defined period. Compare balances, aging, cash movement, tax posture, and close reports. Define and instrument the variance thresholds from the promotion gate table. Produce a dual-run report that an accountant principal can review. A pass on the dual-run acceptance criteria is the gate for DPF-primary promotion.

### Slice 8: Accounting Close Evidence Packet

**Prerequisites:** Slice 7 shipped; at least one dual-run period completed.

Create a native DPF packet for accountant/bookkeeper handoff: operating changes, invoices, payments, expenses, tax obligations, integration health, unresolved mapping issues, and evidence links. The packet must be readable by the `accountant` principal type per ADR-6. This complements QuickBooks/Xero accountant access instead of replacing it.

### Slice 9: Setup Readiness Unification

**Prerequisites:** Slice 1 shipped; `BI-ARCH-4C1E90` design agreed.

Add SMB operating-system questions to business setup and finance setup so a new install asks about books, payments, payroll, bank feeds, tax, and accountant collaboration once, then routes the operator to the right native setup and integration surfaces. The setup flow should derive the initial operating mode for each entity family from the answers.

### Slice 10: DPF-Primary Finance Mode

**Prerequisites:** Slices 7 and 8 passed acceptance for the target archetype and jurisdiction; operator promotion approval recorded.

Allow a target archetype and jurisdiction to run with DPF as the primary finance operating system once ledger, reconciliation, reporting, tax evidence, accountant export, and backup/export controls pass acceptance. QuickBooks remains available as an import/export connector, not the assumed system of record. Rollback plan and export-completeness requirements must be defined in the Slice 10 spec before implementation begins.

## UX Direction

The UX should be quiet, dense, and operational. This is not a marketing page.

For the QuickBooks readiness panel:

- **Row 1:** Connection state chip, environment badge, company name, realm/company ID, last verified timestamp, credential age or time-until-expiry.
- **Row 2:** Capability matrix with state machine chips (see state table above) for each entity family. Chips are color-coded by state, not by hand-assigned color.
- **Row 3:** Integration health signals: last successful probe, last probe error (if any), sync lag (if import projection exists), open reconciliation items (if dual-run exists).
- **Row 4:** Next safe action. Single primary action derived from aggregate state. Secondary link to "View all gaps" or "Open backlog item" where applicable.
- No long explanatory copy inside the panel.
- No hardcoded colors; use `var(--dpf-text)`, `var(--dpf-muted)`, `var(--dpf-surface-1)`, `var(--dpf-surface-2)`, `var(--dpf-border)`, and `var(--dpf-accent)`.
- State chips use semantic color variables (e.g., `var(--dpf-status-error)`, `var(--dpf-status-warning)`, `var(--dpf-status-ok)`, `var(--dpf-status-info)`) rather than raw color values so they respond correctly to light/dark/brand mode switches.

## Risks

| Risk | Likelihood | Severity | Mitigation |
| ---- | ---------- | -------- | ---------- |
| **Ledger drift:** DPF accidentally becomes a shadow accounting system before read/import mapping, reconciliation, period close, and audit locks are clear. | Medium | High | ADR-1 enforces the proof-first constraint. The readiness descriptor must show `not-mapped` or `read` state for all ledger entity families until Slice 5 is implemented. Any code attempting to write journal entries before Slice 5 is a spec violation. |
| **Integration overreach:** Write operations to QuickBooks before read coverage and evidence are stable create financial risk. | Medium | High | ADR-3 requires human approval for every write. Slice 1 is read-only by scope. No CI path exists for write operations until Slice 6. |
| **Setup confusion:** Asking archetype, business model, finance setup, and integration questions in separate places makes DPF feel fragmented. | High | Medium | Slice 9 unifies the setup journey. Until then, the readiness panel on each integration page is the connective tissue. Do not add new isolated setup surfaces between Slice 1 and Slice 9. |
| **False parity:** Empty runtime tables make the UI look complete while no real SMB workflow has been exercised. | High | High | ADR-4 requires a readiness descriptor before any capability is surfaced. The descriptor must show empty or `not-connected` state honestly. DPF must not show operational UI for entity families that have no live data unless the state is clearly labeled. |
| **Replacement credibility:** Claiming "replace QuickBooks" before dual-run proof damages trust. | Medium | High | The roadmap must state replacement as a strategy and proof as the gate. All public-facing framing, including any coworker language, must use "path to replace" not "already replaces." |
| **Tax liability:** DPF implies it calculates or files tax obligations without jurisdiction-specific verification. | Low | Critical | Tax remittance workflow stays native. Calculation and filing authority remain integration-led per the gap analysis. Any coworker that surfaces a tax number must cite the source (DPF obligation record, external system, or estimate) and must not present estimates as filed amounts. |
| **Credential expiry silent failure:** OAuth tokens expire; if DPF has no health monitoring, operators discover the break when a coworker fails, not before. | High | Medium | Integration health signals (Slice 1) include time-until-expiry and last probe error. The Business OS Command Center must surface `credential-expired` state as an actionable alert, not a buried error log. |
| **Rollback gap:** If DPF promotes to DPF-primary and something goes wrong, there is no defined rollback to the external system. | Low (today) | Critical | Slices 1–6 are all reversible because DPF is not the owner. Slice 10 spec must define rollback: what export completeness looks like, how to re-designate the external system as owner, and what data integrity checks are required before rollback completes. |
| **Multi-provider collision:** A business migrating from Xero to QuickBooks could have both providers configured simultaneously with conflicting entity states. | Low | Medium | The entity-link model (Slice 4) must carry `ownerSide` per entity family per provider. The readiness descriptor must show multi-provider state and flag conflicts. The promotion gate must require a single owner before DPF-primary can be set. |
| **Accountant principal gap:** Finance evidence is built without an `accountant` role type, making the evidence packet unusable in practice. | Medium | Medium | ADR-6 establishes the accountant as a principal from the start. Any work on Slice 8 must be blocked until the `accountant` role type exists in the access control model. |

## Deferred Decisions

The following questions are explicitly deferred. They are recorded here so they do not accidentally get resolved in implementation without a spec amendment.

1. **Plaid vs. accounting-system bank feeds:** Should DPF use Plaid for bank feeds, or should it proxy bank feeds through QuickBooks/Xero? Deferred to Slice 3. The choice affects data residency, cost model, and credential surface.

2. **Multi-currency default:** Should DPF default to USD and require explicit multi-currency enablement, or should it treat multi-currency as a first-class default? Deferred to Slice 4 entity-link design. The entity-link model must carry currency; the display and conversion logic is deferred.

3. **Accounting method enforcement:** Should DPF enforce a single accounting method per install, or allow per-entity-family configuration? Deferred to Slice 5 accounting core spec.

4. **QuickBooks sandbox vs. production credential routing:** Should the integration harness and production credential store share the same `IntegrationCredential` table with an environment field, or should sandbox credentials be stored separately? The current schema uses an environment field; this decision is deferred to Slice 2 when the first real entity read expansion requires a sandbox connection from a developer install.

5. **Accountant principal provisioning:** How does an accountant receive access to DPF evidence packets — email invite, OAuth, or manual token? Deferred to Slice 8. The `accountant` role type must be defined earlier (pre-Slice 8), but the provisioning flow is deferred.

6. **Dual-run variance thresholds:** The promotion gate table uses default values of ≤ 1% by count and ≤ 0.1% by value. These defaults are provisional. The actual thresholds should be validated against real SMB accounting data during Slice 7 and may require adjustment before acceptance criteria are finalized.

7. **Demo/sandbox data story:** A fresh install has no QuickBooks connection and no accounting data. How does an operator or evaluator experience the readiness surface meaningfully before connecting real credentials? Options: synthetic readiness fixtures for demo mode, QuickBooks sandbox auto-provision, or "preview" state on the descriptor. Deferred to Slice 1 implementation. The decision should not require a schema change.

8. **Managed-topology key custody:** In the managed and hosted deployment topologies, where do the install-specific encryption keys live? Customer-controlled KMS? DPF-operated KMS with customer-held escrow? Deferred until a hosted offering is scoped. The self-hosted topology has no ambiguity (the operator owns the key material).

9. **Integration cost tracking:** QuickBooks, Stripe, and Plaid have rate limits and (for some endpoints) cost surfaces. Should the readiness descriptor surface cost and rate-limit headroom? Deferred to Slice 2 when real read expansion begins to consume meaningful quota.

## Recommended Next Step

Do not build the DPF ledger first. Do not start with write sync. Do not propose multi-provider sync orchestration until at least one provider has stable read coverage.

**Immediate next step:** Create the `QuickBooks Accounting Readiness Snapshot` backlog item under `EP-INT-2E7C1A`, link this spec to `BI-INT-A5B9E3`, and implement the read-only readiness/import/replacement map as the first slice. That slice deepens existing DPF functionality, establishes `IntegrationReadinessDescriptor` as the architectural primitive that enforces ADR-4 across all future integration surfaces, improves operator truthfulness, preserves the architecture boundary, and starts the path toward DPF-primary company operations without pretending DPF already has accounting-system parity.

**Safe to parallelize with Slice 1 (non-blocking):**

- Update the Finance coworker grants and prompt to include the read-only tools defined in the AI Coworker Tool Surface section.
- Define the `accountant` principal type in the access control model (prerequisite for Slice 8, can be done now).
- Refresh `BI-INT-A5B9E3`, `BI-INT-92C1F8`, `BI-INT-F23BC6`, and `BI-ARCH-4C1E90` acceptance criteria with the operating mode and promotion gate language.

**Do not start in parallel:**

- Any work touching the `IntegrationReadinessDescriptor` type from a non-QuickBooks integration before Slice 1 ships. The type must stabilize once before it becomes shared.
- Any write-path work against QuickBooks, Stripe, Xero, or ADP. ADR-3 is non-negotiable until the approval substrate is in place.
- Any new Prisma model in the finance or integration domain. Slice 1 explicitly avoids schema migrations to keep the readiness foundation reversible.

**What proceeding signals:** the platform commits to integrate-to-replace as the SMB parity strategy, the architecture decisions in this spec become load-bearing for the next 6–10 slices, and the readiness descriptor becomes the enforced visibility layer for every accounting and payments integration that follows.
