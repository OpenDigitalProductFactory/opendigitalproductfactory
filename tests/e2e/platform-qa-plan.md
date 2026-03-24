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

## Adding New Test Cases

When implementing a new feature or fixing a bug:
1. Add test cases to the relevant phase above
2. Use the next available ID in the sequence (e.g., EMP-08, FIN-09)
3. Include both UI and coworker paths where applicable
4. Run the affected phase to verify before marking the backlog item as done
