# Epic Review & Reconciliation — 2026-03-20

**Context:** Data loss and restore. Epics need reconciling against actual implementation state.

---

## Category A — CLOSE AS DONE (implemented, evidence in code)

### 1. CRM Core (`seed-crm-epic.sql`)
**Verdict: CLOSE — superseded by CRM Sales Pipeline epic**
- All 8 backlog items covered: CustomerAccount extended (lifecycle_state, contacts with name/phone/role), customer routes with filters, detail page, orders, subscriptions, taxonomy linking
- Prisma models: CustomerAccount, ContactAccountRole, Activity, Engagement, Opportunity, Quote, QuoteLineItem, SalesOrder (9 CRM models)
- Routes: `/customer`, `/customer/[id]`, `/customer/engagements`, `/customer/opportunities`, `/customer/quotes`, `/customer/sales-orders`
- APIs: 8 CRM API route groups under `/api/v1/customer/`
- **Superseded by:** CRM Sales Pipeline epic which is more comprehensive

### 2. CRM Sales Pipeline & Quote-to-Order (`seed-crm-sales-pipeline-epic.sql`)
**Verdict: CLOSE — substantially complete**
- 12 backlog items: Lead→Opportunity→Quote→SalesOrder pipeline fully modelled
- Prisma models: Opportunity, Quote, QuoteLineItem, SalesOrder, Activity, Engagement all exist
- Routes: `/customer/opportunities`, `/customer/quotes`, `/customer/sales-orders` all built
- APIs: Full CRUD endpoints for all entities
- Components: CustomerTabNav + supporting forms in `components/customer/`
- **Minor gap:** Dedicated `/customer/leads` route not visible (leads may flow through Opportunities). Not blocking closure.

### 3. HR Core (`seed-hr-epic.sql`)
**Verdict: CLOSE — fully implemented**
- All 8 items covered: EmployeeProfile model, lifecycle actions, role assignment, `/employee` route with filters, detail views, taxonomy linking, directory, seed profiles
- Prisma models: EmployeeProfile, Department, Position, EmploymentType, WorkLocation, EmploymentEvent, TerminationRecord, ReviewCycle, ReviewInstance, ReviewGoal, FeedbackNote, UserSkill (13 HR models — exceeds spec)
- Components: 16 employee components including directory, forms, lifecycle, reviews, timesheets, org chart, leave, onboarding
- Route: `/employee` hub with tab-driven sub-panels

### 4. EA Modeler (`seed-vision-epics.sql`)
**Verdict: CLOSE — fully implemented**
- All 9 items covered: `/ea` route, React Flow canvas (not JointJS — design evolved), ELK.js layout, viewpoints, drag-connect, element search, snapshots, lifecycle encoding
- Prisma models: 14+ EA models (EaElement, EaRelationship, EaView, EaViewElement, ViewpointDefinition, EaSnapshot, EaNotation, EaReferenceModel, etc.)
- Components: 26 EA components including canvas, palette, inspector, reference models, value streams, governance
- Routes: `/ea`, `/ea/agents`, `/ea/models/[slug]`, `/ea/views/[id]`

### 5. Calendaring Core (`seed-calendaring-epic.sql`)
**Verdict: CLOSE — superseded by EP-CAL-001**
- Core items implemented: CalendarEvent model, CalendarSync model, server actions, workspace calendar view
- Components: WorkspaceCalendar, CalendarEventPopover, CalendarSyncPanel
- API: `/api/calendar/feed/[userId]`, `/api/calendar/sync`
- **Superseded by:** EP-CAL-001 (Calendar Infrastructure) which is the canonical epic with 16 items

### 6. EP-UI-THEME-001 — Theme & Branding Modernization
**Verdict: CLOSE — implemented**
- BrandingConfig model in Prisma
- Components: BrandingPageClient, BrandingWizard, BrandingPreview, BrandingQuickEdit
- Route: `/admin/branding`
- All 5 backlog items (BI-PROD-004 through BI-PROD-008) covered

### 7. EP-LLM-LIVE-001 — Live LLM Conversations
**Verdict: CLOSE — implemented**
- AgentThread, AgentMessage, AgentAttachment models
- Streaming endpoint: `/api/v1/agent/stream`
- 12 agent components: AgentCoworkerPanel, AgentMessageBubble, AgentMessageInput, AgentFAB, AgentSkillsDropdown, etc.
- Provider registry with ModelProvider, DiscoveredModel, TokenUsage models
- Routing engine with ExecutionRecipe, RouteDecisionLog

### 8. EP-AGENT-EXEC-001 — Agent Task Execution with HITL Governance
**Verdict: CLOSE — implemented**
- AgentActionProposal model for proposed actions
- AuthorizationDecisionLog for audit trail
- AgentGovernanceProfile, AgentCapabilityClass, DelegationGrant, DirectivePolicyClass models
- GovernanceOverviewPanel, DelegationGrantPanel, ProposalHistoryClient components
- Agent governance card in EA module

### 9. EP-REST-API-001 — Platform REST API v1
**Verdict: CLOSE — substantially complete**
- 70+ API endpoints across all domains
- JWT auth via ApiToken model + NextAuth session auth
- Versioned under `/api/v1/`
- Covers: agent, auth, compliance, customer, dynamic, finance, governance, notifications, ops, portfolio, workspace, calendar, mcp, platform, storefront, quality, sandbox, upload
- 17 backlog items (BI-REST-001 through BI-REST-017) — vast majority covered

### 10. EP-STORE-001 — Storefront Foundation
**Verdict: CLOSE — implemented**
- 8 storefront models: StorefrontArchetype, StorefrontConfig, StorefrontSection, StorefrontItem, StorefrontBooking, StorefrontOrder, StorefrontInquiry, StorefrontDonation
- 19+ storefront components including 10 section types
- Multi-tenant routing: `/s/[slug]/` with booking, donation, inquiry, checkout, sign-in, sign-up
- Token-based approval and payment pages
- Storefront admin: `/storefront` with items, sections, settings, setup, inbox
- 6 admin components: StorefrontDashboard, ItemsManager, SectionsManager, SetupWizard, StorefrontInbox, StorefrontAdminTabNav

### 11. EP-REF-002 — Admin Reference Data Management
**Verdict: ALREADY DONE** — correctly marked, no change needed

---

## Category B — UPDATE TO IN-PROGRESS (partially implemented)

### 12. EP-FINMGMT-001 — Financial Management Suite (`seed-financial-management-epic.sql`)
**Verdict: UPDATE to in-progress**
- **Phase A (Invoicing) — DONE:** Invoice, InvoiceLineItem, Payment, PaymentAllocation models. Invoice list/detail/create pages. PDF generation, send, pay-now portal.
- **Phase B (Accounts Payable) — DONE:** Supplier, Bill, BillLineItem, PurchaseOrder, PurchaseOrderLineItem, ApprovalRule, BillApproval models. Supplier list/detail, bill create, PO list/detail/create pages.
- **Phase C (Banking & Reconciliation) — NOT STARTED:** No bank account or reconciliation models
- **Phase D (Recurring Billing) — NOT STARTED:** No recurring billing models
- **Phase E (Expense/Reporting) — NOT STARTED:** No expense or reporting models
- Mark items in Phase A and B as done, keep C-E open

### 13. Calendar Infrastructure EP-CAL-001 (`update-calendar-epic.sql`)
**Verdict: UPDATE to in-progress**
- Items 1-4 done (schema, helpers, fetchers, actions)
- Item 7 done (workspace widget via WorkspaceCalendar)
- Items 5-6, 8-16 still open (permissions migration, full calendar route, MCP tool, RFC 5545, notifications, etc.)

### 14. Infrastructure Registry (`seed-vision-epics.sql`)
**Verdict: UPDATE to in-progress**
- InventoryEntity, InventoryRelationship, DiscoveryRun, DiscoveredItem, DiscoveredRelationship, PortfolioQualityIssue models exist
- Components: DiscoveryRunSummary, InventoryEntityPanel, PortfolioQualityIssuesPanel, RelationshipGraph
- Route: `/inventory`
- **Gap:** No dedicated infrastructure CI detail view, no health status tracking, no provider/consumer UI

### 15. EP-DEPLOY-001 — Standalone Docker Deployment
**Verdict: UPDATE to in-progress**
- docker-compose.yml and docker-compose.dev.yml exist
- Ollama design spec exists (2026-03-13-docker-ollama-ootb-design.md)
- OllamaManagement and OllamaHardwareInfo components built
- **Gap:** Full managed Ollama sidecar (GPU auto-detect, zero-config model selection) may not be wired end-to-end

### 16. EP-MCP-ACT-001 — MCP Catalog Activation
**Verdict: KEEP at in-progress** (already correct)
- McpServer, McpServerTool, McpIntegration, McpCatalogSync models
- Platform services/integrations pages, sync button, health checks
- ServiceActivationForm, DetectedServicesBanner components

---

## Category C — KEEP OPEN (not yet started or minimal)

### 17. SBOM Management (`seed-sbom-epic.sql`)
**Status: open — CORRECT**
- No SbomComponent, ProductComponent, ComponentVulnerability, SbomDocument models in Prisma
- Genuinely not started

### 18. Neo4j + Digital Product Backbone (`seed-vision-epics.sql`)
**Status: open — CORRECT**
- No Neo4j integration visible. Vision-tier epic.

### 19. Unified Work Item Types Phase 6B (`seed-vision-epics.sql`)
**Status: open — CORRECT**
- BacklogItem does not have workItemType, originType, originId fields
- Not started

### 20. ITSM Module (`seed-vision-epics.sql`)
**Status: open — CORRECT**
- No /itsm routes, no ITSM models. Vision-tier epic.

### 21. GDPR Governance Entity (`seed-gdpr-epic.sql`)
**Status: open — CORRECT**
- GRC framework exists (Regulation, Obligation, Control models) but no GDPR-specific regulation data seeded
- This is a "starter pack" for the existing framework, not new code — just data seeding + potential DPIA/DSR workflows

### 22. Miro Board Collaboration (`seed-miro-collaboration-epic.sql`)
**Status: open — CORRECT**
- No Miro integration code. Future integration epic.

### 23. Security & Vulnerability Agent (`seed-security-agent-epic.sql`)
**Status: open — CORRECT**
- No security scanner, dependency monitoring, or security posture dashboard

### 24. UI/UX Usability Standards (`seed-usability-standards-epic.sql`)
**Status: open — CORRECT**
- No systematic audit of hardcoded colors, WCAG validation, or visual regression tests

### 25. EP-UI-A11Y-001 — Dark-Theme Usability & Accessibility
**Status: open — CORRECT**
- Standards may be informally followed but no systematic enforcement/audit

### 26. EP-MOBILE-FOUND-001 — Mobile Companion App Foundation
**Status: open — CORRECT**
- No Expo project, no mobile app code

### 27. EP-MOBILE-FEAT-001 — Mobile Companion App Features
**Status: open — CORRECT**

### 28. EP-MOBILE-DYN-001 — Mobile Dynamic Content Renderer
**Status: open — CORRECT**

### 29. Financial Management — Deferred Decision Review (`seed-finance-review-epic.sql`)
**Status: open (all items deferred) — CORRECT**
- Intentionally parked for future evaluation

### 30. EP-UX-001 — Light Mode UX Theme
**Status: in-progress — CORRECT** (already set)

---

## Category D — CLOSE AS SUPERSEDED

### 31. Financial Primitives and Budget Management (`update-finance-epic.sql`)
**Verdict: CLOSE as superseded by EP-FINMGMT-001**
- Original epic assumed ERPNext integration for AP/AR/Payroll/Tax
- EP-FINMGMT-001 replaced this with native financial management
- The `update-finance-epic.sql` script tried to add 6 new items to the old epic — these are now covered by EP-FINMGMT-001's phases
- Close with note: "Superseded by EP-FINMGMT-001 — Financial Management Suite"

---

## Summary

| Action | Count | Epics |
|--------|-------|-------|
| **Close as done** | 10 | CRM Core, CRM Sales Pipeline, HR Core, EA Modeler, Calendaring Core, Theme/Branding, LLM Live, Agent HITL, REST API, Storefront |
| **Close as superseded** | 1 | Financial Primitives (→ EP-FINMGMT-001) |
| **Update to in-progress** | 3 | Financial Mgmt Suite, Calendar Infra, Infrastructure Registry, Docker Deploy |
| **Keep as-is** | 14 | SBOM, Neo4j, Work Item Types, ITSM, GDPR, Miro, Security Agent, Usability, A11Y, Mobile x3, Finance Deferred, Light Mode, MCP Activation |
| **Already correct** | 2 | EP-REF-002 (done), EP-UX-001 (in-progress) |
