# Platform QA Test Plan

Executed via Playwright against a running DPF instance (production Docker or local `pnpm dev`).
Tests exercise both the UI and AI coworker paths for each functional area.

## Prerequisites

- Platform running at `http://localhost:3000` (Docker) or `http://localhost:3001` (local dev)
- Admin login: `admin@dpf.local` / password from `ADMIN_PASSWORD` env var (default: `changeme123`)
- At least one active AI provider configured (for coworker tests)

## Test Execution

Each test case has:
- **ID** — stable reference for backlog items
- **Area** — functional area being tested
- **Path** — UI or Coworker
- **Steps** — what to do
- **Expected** — what should happen
- **Status** — PASS / FAIL / SKIP (updated per run)

When a test fails, create a backlog item under the active QA epic referencing the test ID.

---

## Phase 1: Authentication & Onboarding

| ID | Steps | Expected |
|----|-------|----------|
| AUTH-01 | Navigate to `/welcome` | Welcome page with Customer Portal and Employee & Admin links |
| AUTH-02 | Click Employee & Admin, submit login form | Redirected to `/workspace`, HR-000 role shown |
| AUTH-03 | Fresh install (no Organization in DB) | Redirected to `/setup` onboarding wizard |
| AUTH-04 | Sign out and sign back in | Session restored, workspace loads |
| SETUP-01 | During branding step, enter a `.co.uk` URL and click Analyze | `importBrandFromUrl` writes `suggestedCurrency: "GBP"` and `suggestedCountryCode: "GB"` to setup context |
| SETUP-02 | During branding step, enter a `.de` URL and click Analyze | `suggestedCurrency: "EUR"`, `suggestedCountryCode: "DE"` written to context |
| SETUP-03 | During branding step, enter a dental clinic URL and click Analyze | `suggestedArchetypeId: "dental-practice"` written to context (verify in DB or via storefront setup banner) |
| SETUP-04 | During branding step, enter a generic `.com` corporate URL with no industry/location signals | No suggestion fields written to context; storefront wizard renders with no banner |
| SETUP-05 | **Incomplete information test (AI coworker path):** Ask COO to analyze branding without providing a URL | Agent asks for the URL rather than proceeding |

## Phase 2: Workspace Dashboard

| ID | Steps | Expected |
|----|-------|----------|
| DASH-01 | View workspace after login | All 13 tiles visible with metrics |
| DASH-02 | Check calendar renders | Month view with events, filter buttons (HR/Ops/Platform/Personal/External) |
| DASH-03 | Check activity feed | Awareness and Recent History sections with real backlog items |
| DASH-04 | Check attention strip | AI Workforce warnings shown when providers are degraded |
| DASH-05 | Click each workspace tile | Each navigates to correct area page |

## Phase 3: Employee Management

| ID | Steps | Expected |
|----|-------|----------|
| EMP-01 | Navigate to `/employee` | 6 roles displayed, employee directory visible |
| EMP-02 | Click "+ New Employee", fill required fields (first, last, display, email), submit | Employee created, appears in directory |
| EMP-03 | Create employee with manager assignment | Manager field resolves, no FK error |
| EMP-04 | **Coworker (incomplete):** "Hire someone named Alex" | Coworker asks for last name and email before proposing |
| EMP-05 | **Coworker (complete):** Provide all details | Coworker proposes creation with Approve/Reject card |
| EMP-06 | Approve coworker proposal | Employee created, confirmation message |
| EMP-07 | Reject coworker proposal | "Rejected" shown, coworker asks what to change |

## Phase 4: Customer Management

| ID | Steps | Expected |
|----|-------|----------|
| CRM-01 | Navigate to `/customer` | Page loads with summary cards and "+ New Account" button |
| CRM-02 | Click "+ New Account", fill name + industry, submit | Account created, appears in list |
| CRM-03 | Click into account detail | Account detail page loads with contacts, opportunities tabs |
| CRM-04 | Navigate to Pipeline tab | Opportunity list loads, values shown in $ (not GBP) |
| CRM-05 | **Coworker:** "Add a customer called Riverside Medical" | Coworker creates account or asks for missing details |

## Phase 5: Finance

| ID | Steps | Expected |
|----|-------|----------|
| FIN-01 | Navigate to `/finance` | Dashboard with all sections, setup banner if unconfigured |
| FIN-02 | Create bank account at `/finance/banking/new` | Account created with USD default currency |
| FIN-03 | Navigate to `/finance/suppliers/new` | Supplier form page loads (not 404) |
| FIN-04 | Create supplier with name and payment terms | Supplier created, appears in list |
| FIN-05 | Create invoice at `/finance/invoices/new` | Form loads, currency defaults to USD |
| FIN-06 | Create invoice with line items and save as draft | Invoice saved, appears in invoice list |
| FIN-07 | View invoice PDF | PDF renders with correct totals |
| FIN-08 | Navigate to reports (P&L, aged debtors, cash flow) | Each report page loads without error |

## Phase 6: Compliance

| ID | Steps | Expected |
|----|-------|----------|
| GRC-01 | Navigate to `/compliance` | Dashboard with all 14 tabs, zero-state metrics |
| GRC-02 | Click "Add Regulation", fill HIPAA details, submit | Regulation created, appears in list |
| GRC-03 | Navigate to Obligations tab | Page loads, "Add" button visible |
| GRC-04 | Navigate to Controls tab | Page loads, controls list or empty state |
| GRC-05 | Navigate to Policies tab | Page loads |
| GRC-06 | Navigate to Incidents tab | Page loads |
| GRC-07 | Navigate to Gaps analysis | Gap analysis loads (may be empty) |

## Phase 7: Operations & Backlog

| ID | Steps | Expected |
|----|-------|----------|
| OPS-01 | Navigate to `/ops` | Backlog list loads with epic grouping |
| OPS-02 | Click "+ Add epic" | Epic creation form appears |
| OPS-03 | Create epic with title and portfolio | Epic created, visible in list |
| OPS-04 | Click "+ Add item" under an epic | Backlog item form appears |
| OPS-05 | Create backlog item with title and priority | Item created under epic |
| OPS-06 | Navigate to Changes tab | Change management page loads |
| OPS-07 | Navigate to Improvements tab | Improvement proposals page loads |

## Phase 8: Portfolio & Inventory

| ID | Steps | Expected |
|----|-------|----------|
| PORT-01 | Navigate to `/portfolio` | 4 portfolios visible with metrics |
| PORT-02 | Expand a portfolio tree node | Child nodes shown |
| PORT-03 | Click into Manufacturing and Delivery | Portfolio detail with products |
| INV-01 | Navigate to `/inventory` | Product list with lifecycle stages |
| INV-02 | Click into a product | Product detail page loads |

## Phase 9: EA Modeler

| ID | Steps | Expected |
|----|-------|----------|
| EA-01 | Navigate to `/ea` | Overview with views list and reference models |
| EA-02 | Click into an existing view | React Flow canvas loads with elements and properties panel |
| EA-03 | Element palette visible | Business Actor, Capability, Object, Role, Value Stream types |

## Phase 10: Build Studio

| ID | Steps | Expected |
|----|-------|----------|
| BUILD-01 | Navigate to `/build` | Build Studio loads, existing builds listed |
| BUILD-02 | Type feature description and click "New" | New build created, ideate phase starts |
| BUILD-03 | Agent asks clarifying questions during ideate | Questions about scope, existing code, requirements |
| BUILD-04 | Provide answers, agent produces feature brief | Brief displayed with acceptance criteria |

## Phase 11: Storefront

| ID | Steps | Expected |
|----|-------|----------|
| STORE-01 | Navigate to `/storefront` | Admin dashboard with sections, items, settings |
| STORE-02 | Click "View Live" | Public storefront loads with catalog |
| STORE-03 | Click "Book Now" on a service | Calendar loads with available dates |
| STORE-04 | Select date and time slot | Slot selection shows provider and times |
| STORE-05 | Fill booking form and confirm | Booking confirmed with reference number |
| STORE-06 | Check timezone shown | Should match org timezone (America/Chicago default) |
| STORE-07 | Navigate to `/admin/storefront/setup` after a `.de` branding URL was analyzed | Suggestion banner visible above archetype grid; detected archetype card has accent border and "Suggested for you" label |
| STORE-08 | Proceed to Step 3 (identity) after URL branding | Business name field pre-filled with detected company name; "Pre-filled from your branding URL" hint shown |
| STORE-09 | Proceed to Step 4 (financial setup) after `.de` branding URL | Currency selector pre-set to EUR; "Pre-selected based on your website location" note shown |
| STORE-10 | Change the currency in Step 4 away from the suggestion | Selection updates freely; no error; the changed value is saved |
| STORE-11 | Navigate to `/admin/storefront/setup` without having used a branding URL | No suggestion banner shown; no pre-fills; archetype grid renders normally |

## Phase 12: AI Coworker Cross-Cutting

| ID | Steps | Expected |
|----|-------|----------|
| AI-01 | Coworker panel opens on workspace | COO agent, input active |
| AI-02 | Send a message, wait for response | Response within 60s, no "Sending..." stuck state |
| AI-03 | Navigate to `/employee` | HR Director agent shown |
| AI-04 | Navigate to `/customer` | Customer Success Manager shown |
| AI-05 | Navigate to `/finance` | COO agent shown (finance has no dedicated agent) |
| AI-06 | Navigate to `/compliance` | COO agent shown |
| AI-07 | Navigate to `/build` | Software Engineer shown |
| AI-08 | Close and reopen coworker panel | Panel resets, input active |
| AI-09 | Coworker error recovery | After error, panel shows error message and input recovers |
| AI-10 | **Incomplete request test:** Send vague creation request | Agent asks for required fields, not guesses |

## Phase 13: Admin & Settings

| ID | Steps | Expected |
|----|-------|----------|
| ADMIN-01 | Navigate to `/admin` | User management page loads |
| ADMIN-02 | Navigate to `/admin/branding` | Brand settings with live preview (light + dark) |
| ADMIN-03 | Change accent color and save | Preview updates, platform reflects change |
| ADMIN-04 | Navigate to `/admin/settings` | Settings page loads |
| ADMIN-05 | Navigate to `/admin/reference-data` | Reference data editor loads |

## Phase 14: Documentation

| ID | Steps | Expected |
|----|-------|----------|
| DOCS-01 | Navigate to `/docs` | All 14 sections listed with page counts |
| DOCS-02 | Click into "Getting Started" | Documentation page renders markdown |
| DOCS-03 | Search for a term | Search filters doc list |

---

## Phase 15: Authority & Governance

| ID | Steps | Expected |
|----|-------|----------|
| AUTH-GOV-01 | Navigate to `/platform/ai/authority` | Authority & Audit page loads with agent grid and execution log sections |
| AUTH-GOV-02 | Verify agent authority cards | Each agent card shows tool grant count, HITL tier, escalation path, value stream |
| AUTH-GOV-03 | Check Tool Execution Log section | Stat cards show Total, Successful, Failed, Agents, Tools counts |
| AUTH-GOV-04 | Filter execution log by agent | Table filters correctly, shows only selected agent's executions |
| AUTH-GOV-05 | Filter execution log by tool | Table filters correctly, shows only selected tool's executions |
| AUTH-GOV-06 | Filter execution log by success/failure | Table filters correctly by outcome |
| AUTH-GOV-07 | Expand an execution row | Parameters and result JSON displayed in expandable section |
| AUTH-GOV-08 | Navigate to `/platform/ai/history` | Action History page still works with proposals table |
| AUTH-GOV-09 | Check "Authority" tab in AI Workforce tab nav | Tab appears and links to `/platform/ai/authority` |
| AUTH-GOV-10 | **(Coworker)** On `/platform`, ask "Evaluate a tool" | Coworker invokes evaluate_tool skill, creates ToolEvaluation record |
| AUTH-GOV-11 | **(Coworker)** On `/ops`, ask agent to create a backlog item | Item created, ToolExecution record appears in audit log with correct agentId |
| AUTH-GOV-12 | **(RBAC)** Log in as HR-400 (ITFM Director), open `/ops` | Coworker tools filtered by both user role AND agent grants — tools outside agent grants not offered |
| AUTH-GOV-13 | **(RBAC)** Log in as HR-300 (Enterprise Architect), open `/platform` | Coworker offers "Evaluate tool" skill (requires manage_tool_evaluations capability) |
| AUTH-GOV-14 | **(Incomplete info)** Ask coworker to evaluate a tool without specifying type | Coworker asks for tool type before proceeding |

---

## Adding New Test Cases

When implementing a new feature or fixing a bug:
1. Add test cases to the relevant phase above
2. Use the next available ID in the sequence (e.g., EMP-08, FIN-09)
3. Include both UI and coworker paths where applicable
4. Run the affected phase to verify before marking the backlog item as done
