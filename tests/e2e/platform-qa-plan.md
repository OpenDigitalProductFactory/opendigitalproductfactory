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
| FIN-09 | Navigate to `/finance/settings/tax`, confirm the page shows operational tax setup state only, add a jurisdiction registration, mark it live verified, then open the AI coworker on the same page | Tax remittance workspace loads without error, registration verification state updates, the page keeps conversational guidance out of the main surface, and the coworker resolves to Finance Specialist instead of the generic workspace agent |
| FIN-10 | From `/finance/settings/tax`, generate obligation periods, prepare a filing packet, and add supporting evidence to a period | Periods appear with due dates and captured amounts, filing packet status changes to ready/prepared, and audit evidence is visible without using the coworker surface for dialog |
| FIN-11 | From `/finance/settings/tax`, set filing owner and handoff mode, leave external filing selected without an external system, then save | The page records the authority boundary, shows the operating boundary summary as facts, and raises a setup gap when external filing is selected without a recorded handoff system |
| FIN-12 | From `/finance/settings/tax`, review tax reminders and enable monitoring when due/overdue periods exist | The page shows due-soon and overdue counts as facts, creates deduped in-app reminders, and records an active finance monitoring task without adding coworker dialog to the page |
| FIN-13 | Configure an AI provider from `/platform/ai/providers/[providerId]` without entering plan details, then reload the provider detail page | Technical setup succeeds, Finance Bridge panel appears, and it shows seeded/draft finance ownership rather than blocking setup |
| FIN-14 | Navigate to `/finance/spend` and then `/finance/spend/ai` after at least one provider has been configured | Spend hub shows the AI Spend summary card, the dedicated AI Spend workspace loads, and the workspace shows committed spend, contracts needing setup, and open work-item counts |
| FIN-15 | Open `/finance/suppliers/[id]` for a supplier linked to an AI provider | Supplier detail shows the AI finance context panel with linked provider, contract posture, and latest utilization or “No data” state |

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

## Phase 8: Portfolio & Estate

| ID | Steps | Expected |
|----|-------|----------|
| PORT-01 | Navigate to `/portfolio` | 4 portfolios visible with metrics |
| PORT-02 | Expand a portfolio tree node | Child nodes shown |
| PORT-03 | Click into Manufacturing and Delivery | Portfolio detail with products |
| INV-01 | Navigate to `/platform/tools/discovery` | Estate Discovery loads with run summary, review queue, topology context, and attributed estate cards |
| INV-02 | Navigate to `/inventory` | Legacy alias loads, banner points to `/platform/tools/discovery` and `/portfolio` |
| INV-03 | Click a product card from estate discovery | Product Dependencies & Estate page loads |
| INV-04 | Navigate directly to `/portfolio/product/<known-id>/inventory` | Estate cards show manufacturer, version, support posture, and upstream/downstream counts |
| INV-05 | On `/portfolio/product/<known-id>/inventory`, inspect an estate card with discovery evidence only | Card shows identity label, identity confidence, support posture summary, advisory summary, and version source without inventing unsupported lifecycle certainty |
| INV-06 | Navigate to `/platform/tools/catalog` | Connection Catalog loads with separate sections for MCP Catalog, Native Integrations, and Built-in Tools |
| INV-07 | Navigate to `/platform/tools/built-ins` | Built-in Tools loads and Brave Search configuration appears only here, not under Admin settings |

**Triage workbench pre-conditions (INV-08 -> INV-15):** at least three `InventoryEntity` rows with `attributionStatus = "needs_review"`, seeded against the active org. The fixture set must include:

- **(a) Human-review row** - `candidateTaxonomy[0].score >= 0.6` and a most-recent `DiscoveryTriageDecision` row whose `outcome = "human-review"` and `decisionId` is non-null (drives the **Accept recommendation** path in INV-09).
- **(b) Untriaged-no-candidate row** - empty `candidateTaxonomy`, no `DiscoveryTriageDecision` rows referencing the entity (drives the **Mark taxonomy gap** path in INV-11; the **Use top match** button is suppressed here).
- **(c) Untriaged-with-candidate row** - `candidateTaxonomy[0]` populated, no `DiscoveryTriageDecision` rows yet (drives the **Use top match** path in INV-12).
- **(d) Auto-attributed row** - most-recent decision `outcome = "auto-attributed"` (populates the Auto Attributed section in INV-08).

Valid `outcome` values per `TRIAGE_OUTCOMES` in [packages/db/src/discovery-triage-enums.ts](D:/DPF-qa-plan-followup/packages/db/src/discovery-triage-enums.ts): `"auto-attributed"`, `"human-review"`, `"needs-more-evidence"`, `"taxonomy-gap"`, `"dismissed"`. Hyphens, never underscores.

**Setup options (in order of preference):**

1. **Manual seed via Prisma Studio** - `pnpm --filter @dpf/db exec prisma studio`, then create rows in `InventoryEntity` and `DiscoveryTriageDecision` matching shapes (a)-(d). Use this until the dedicated seed script lands.
2. **Dedicated fixture script** - `pnpm --filter @dpf/db exec tsx scripts/seed-discovery-triage-fixtures.ts` *(TODO: script not yet implemented; tracked as part of triage QA scaffolding)*.
3. **Synthesize from a real discovery run** - kick off a discovery scan against a test target whose entities don't fully resolve, then manually flip a row's `attributionStatus` to `"needs_review"` if needed.

| INV-08 | On `/platform/tools/discovery` with the pre-condition fixtures present, scroll to the Triage Workbench section | Section eyebrow "Triage Workbench" with `<h2>` "Discovery taxonomy review" renders. Workbench-level metric tiles "Active gaps" (= `queues.metrics.total`) and "With decisions" (= `queues.metrics.withDecision`) appear in the top-right header and match the seeded counts. All four queue sections (Human Review, Needs More Evidence, Taxonomy Gaps, Auto Attributed) appear in that exact order, each with an "N items" count chip and either rows or the section's empty-state copy. Each row shows four distinct score tiles labelled Identity, Taxonomy, Evidence, Reproducible (no collapsing into one number) and per-row badges for `entityType` and `entityKey`. |
| INV-09 | On a Human Review row whose latest decision has a `decisionId`, click "Accept recommendation" | Row disappears from the workbench after `router.refresh()`; the entity's `attributionStatus` is now `"attributed"` and `attributionMethod` is `"ai-proposed"` (verify on `/portfolio/product/.../inventory` or via Prisma). A new `DiscoveryTriageDecision` row is written with `actorType = "human"`, `outcome = "auto-attributed"`, `humanReviewedAt` set, and the original recommendation's `humanReviewedAt` is also stamped. |
| INV-10 | On a Human Review row, click "Request evidence" | Row stays in the workbench but moves from Human Review to Needs More Evidence after refresh (the underlying entity is still `attributionStatus = "needs_review"`). A new `DiscoveryTriageDecision` is written with `actorType = "human"`, `outcome = "needs-more-evidence"`, `requiresHumanReview = false`. |
| INV-11 | On a row that has **no** suggested taxonomy candidate (so the "Mark taxonomy gap" button is rendered), click "Mark taxonomy gap" | Row moves to the Taxonomy Gaps section after refresh; a new `DiscoveryTriageDecision` is written with `outcome = "taxonomy-gap"`, `requiresHumanReview = true`. The "Mark taxonomy gap" button does NOT appear on rows that have a suggested taxonomy. |
| INV-12 | On an untriaged row (no `latestDecision`) that has a suggested taxonomy candidate, click "Use top match" | Entity is reassigned to the suggested `taxonomyNodeId` with `attributionStatus = "attributed"`, `attributionMethod = "manual"`, `attributionConfidence = 1.0`; row leaves the workbench after refresh. No `DiscoveryTriageDecision` is written by this path (it is a direct manual override, not a triage decision). |
| INV-13 | On any row, click "Dismiss" | Entity's `attributionStatus` flips to `"dismissed"` and the row disappears from the workbench after refresh. No new `DiscoveryTriageDecision` row is written by this action. |
| INV-14 | Set `attributionStatus` for every entity to anything other than `"needs_review"`, then reload `/platform/tools/discovery` | The entire Triage Workbench section is omitted from the page (the component renders `null` when `totalVisible === 0`). Other discovery panels still render. |
| INV-15 | Sign in as a user **without** `manage_provider_connections` (e.g. HR-000 baseline employee), open `/platform/tools/discovery`, and invoke each triage action (`acceptTriageRecommendation`, `requestDiscoveryEvidence`, `markTaxonomyGapForReview`, `reassignTaxonomy`, `dismissEntity`). Drive via the workbench buttons if visible, or via a direct server-action call from a test harness - these are Next.js server actions, not REST endpoints, so a raw HTTP POST will not exercise the authorization path. | Each action returns `{ ok: false, error: "Unauthorized" }` (see [apps/web/lib/actions/inventory.ts](D:/DPF-qa-plan-followup/apps/web/lib/actions/inventory.ts#L43)). No `InventoryEntity` rows are mutated and no `DiscoveryTriageDecision` rows are written. |

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
| BUILD-05 | Complete ideate and plan, enter build phase | Orchestrator dispatches specialist tasks, progress events shown in UI |
| BUILD-06 | Wait for all specialists to complete in build phase | Task results saved to DB, verification evidence persisted on build record |
| BUILD-07 | QA specialist completes with "8 pass, 0 fail" output | Verification parsed (high confidence), auto-advance to review phase |
| BUILD-08 | QA specialist output is empty or unparseable | Phase does NOT auto-advance, warning shown to user |
| BUILD-09 | During build, a specialist returns BLOCKED (e.g. sandbox down) | Build completes with partial results, blocked task visible in UI |
| BUILD-10 | In review phase, attempt advance without verification evidence | Phase gate blocks with reason message |
| BUILD-11 | In review phase, approve the build | Phase advances to ship |
| BUILD-12 | Close coworker panel during active build, reopen | Build state preserved, updates resume via SSE fallback or DB poll |
| BUILD-13 | Build with all tasks DONE, verify auto-advance | Phase moves from build to review automatically |
| BUILD-14 | Trigger build when sandbox is not running | Specialist returns BLOCKED, user sees actionable error message |
| BUILD-15 | Open `/build` on desktop with the coworker pane closed, then open the coworker pane | Build Studio remains inside the shell, central workspace stays visible, content is not hidden under the docked coworker |
| BUILD-16 | Open `/platform/ai/build-studio`, confirm page language, then click "Open Build Studio" | Page reads as runtime/configuration, not the main working studio, and the CTA returns to `/build` |
| BUILD-17 | Navigate to an active build in build phase, open the Preview tab | Shows "Preview in your browser" card with "Open http://localhost:PORT ↗" button and a "Copy URL" button. No `<iframe>` is rendered. |
| BUILD-18 | Click "Open ↗" on the preview card | A new browser tab opens pointing to the sandbox host URL (`http://localhost:{sandboxPort}`). |
| BUILD-19 | Click "Copy URL" on the preview card | The sandbox host URL is written to the clipboard; the button briefly flips to "Copied" and back within ~2s. |
| BUILD-20 | Advance a build from plan → build → review with ≥ 2 acceptance criteria in the brief | Within 30s of entering review, `FeatureBuild.uxVerificationStatus` flips to `running`; ReviewPanel's UX section shows "Running UX verification…" spinner; coworker panel shows busy state. |
| BUILD-21 | Wait for verification to complete with all steps passing | `uxVerificationStatus = "complete"`; ReviewPanel UX section shows `N/N passed` with inline screenshots per step. Screenshots resolve through `/api/build/<buildId>/evidence/<file>.png` with 200 + `Content-Type: image/png`. |
| BUILD-22 | Set up a build with one deliberately impossible acceptance criterion, advance to review | `uxVerificationStatus = "failed"`; ReviewPanel highlights the failing step + screenshot; a "Ship anyway" button appears. |
| BUILD-23 | With UX verification failed and no override, attempt review → ship | Phase gate blocks with reason starting `UX verification failed: …` and names the failing step. |
| BUILD-24 | Click "Ship anyway", submit a 10+ character reason | Phase advances to ship; `BuildActivity` gains a `tool: ux-override` row with the submitted reason. |
| BUILD-25 | Advance to review with ZERO acceptance criteria in the brief | `uxVerificationStatus = "skipped"`; ReviewPanel shows "UX verification skipped — no acceptance criteria"; review → ship is allowed. |
| BUILD-26 | Stop the browser-use container mid-verification (`docker stop dpf-browser-use-1`) | Inngest handler records failure; `uxVerificationStatus = "failed"` with a diagnostic error in `uxTestResults[0].error`. Gate blocks ship advance. |
| BUILD-32 | Open a build in ideate or plan that has `FeatureBuild.deliberationSummary` populated, then switch to the Details tab | The panel renders a deliberation summary card showing pattern (`Peer Review` or `Debate`), evidence quality, diversity label, consensus state, rationale, and any unresolved risks. |
| BUILD-33 | Open a build in review/ship/complete with deliberation summaries for multiple phases, then switch to the Review tab | ReviewPanel renders one deliberation summary card per populated phase before the detailed evidence sections. |
| BUILD-34 | Open the Graph tab for a build with deliberation summaries | The affected phase nodes show a deliberation chip (`Peer Review` or `Debate`) plus the consensus state directly on the process graph. |
| BUILD-35 | Start a new build and complete the ideate phase with an ambiguous brief (e.g. "add analytics") without manually invoking a deliberation pattern | Framework auto-activates the default `review` pattern for the ideate phase. `DeliberationRun` row is created with `patternSlug = "review"` and `phase = "ideate"`; ideate deliberation summary card appears in the Details tab before plan starts. |
| BUILD-36 | Continue into the plan phase on the same build without explicitly requesting a pattern | Framework auto-activates the default `review` pattern for the plan phase. A second `DeliberationRun` row is created with `patternSlug = "review"` and `phase = "plan"`; a second summary card appears alongside the ideate one. |
| BUILD-37 | From the coworker panel, explicitly invoke `debate` on an in-progress build (e.g. "Have Codex and Claude debate this plan") | A `DeliberationRun` with `patternSlug = "debate"` is created for the current phase. Summary card labels the pattern as `Debate` and lists at least two distinct branch voices; consensus state reflects the debate outcome (`consensus`, `partial-consensus`, or `no-consensus`). |
| BUILD-38 | Run a deliberation on a claim with no retrievable source evidence (offline retrieval / empty context) | Run completes with `consensusState = "insufficient-evidence"`; summary card shows the insufficient-evidence state, lists unresolved risks, and does NOT auto-advance the phase. Phase gate blocks advancement with a reason referencing insufficient evidence. |
| BUILD-39 | Run a `debate` with only one provider available (all branches resolve to the same model family) | Summary card reports constrained diversity: the diversity label reads as reduced/constrained and a warning note explains that branches shared a provider family. Consensus state is still computed but flagged as lower-confidence. |
| BUILD-40 | Open a deliberation summary card and click into a cited source locator (code path+line, spec path+heading, or tool-output reference) | Drill-down opens `DeliberationDrilldown` showing the structured locator fields; code locators link to `file:line`, spec locators link to the doc path and heading, tool-output locators show tool name + parameter hash + result reference. Unattributed / vague-memory citations are not rendered as admissible sources. |
| BUILD-41 | Open a governed build with a long title and submission branch slug on `/build`, keep the coworker visible, and switch to the Workflow tab | The active-build header stays within the main pane with no overlap into the sidebar or coworker, metadata wraps when needed, and the submission branch chip truncates instead of forcing the layout wider. |
| BUILD-42 | Open a backlog-linked build in ideate or plan with no recorded `draftApprovedAt`, switch to the Workflow tab, and click the Ideate stage | The main studio surface shows a `Studio Control` card with `Record Approve Start`, the stage inspector repeats the same approval guidance, and the workflow UI does not claim that no approval is required. |
| BUILD-43 | Open a backlog-linked build in `plan` with start approval recorded and a passing plan review, then use the `Studio Control` action to move into implementation; once verification evidence is present, use the studio action again | The main studio surface shows `Start Implementation` while in plan, then shifts to `Run Verification Review` during build, allowing the human to drive coworker execution and review from `/build` without backend-only phase nudges. |

## Phase 11: Storefront

| ID | Steps | Expected |
|----|-------|----------|
| STORE-01 | Navigate to `/storefront` | Portal workspace loads with a single portal tab row for dashboard, sections, items, team, inbox, and settings |
| STORE-02 | Click "View Live" | Public storefront loads with catalog |
| STORE-03 | Click "Book Now" on a service | Calendar loads with available dates |
| STORE-04 | Select date and time slot | Slot selection shows provider and times |
| STORE-05 | Fill booking form and confirm | Booking confirmed with reference number |
| STORE-06 | Check timezone shown | Should match org timezone (America/Chicago default) |
| STORE-07 | Navigate to `/storefront/setup` after a `.de` branding URL was analyzed | Suggestion banner visible above archetype grid; detected archetype card has accent border and "Suggested for you" label |
| STORE-08 | Proceed to Step 3 (identity) after URL branding | Business name field pre-filled with detected company name; "Pre-filled from your branding URL" hint shown |
| STORE-09 | Proceed to Step 4 (financial setup) after `.de` branding URL | Currency selector pre-set to EUR; "Pre-selected based on your website location" note shown |
| STORE-10 | Change the currency in Step 4 away from the suggestion | Selection updates freely; no error; the changed value is saved |
| STORE-11 | Navigate to `/storefront/setup` without having used a branding URL | No suggestion banner shown; no pre-fills; archetype grid renders normally |
| STORE-12 | Navigate to `/admin/storefront` | Redirected to `/storefront`; the portal workspace loads without the extra Admin tab strip above it |
| STORE-13 | Open the coworker panel on `/storefront` | Marketing Specialist agent loads for the portal workspace and shows portal-specific skills |
| STORE-14 | Navigate to `/storefront/settings/business` | Settings sub-nav shows Portal, Your Business, and Operating Hours; Your Business is active and the business context form loads |
| STORE-15 | Navigate to `/storefront/settings/operations` | Settings sub-nav shows Portal, Your Business, and Operating Hours; Operating Hours is active and the schedule editor loads |
| STORE-16 | With the Docker-served portal running, open `http://localhost:3000` and `http://localhost:3001` | `3000` remains the production-served runtime and `3001` remains the isolated developer runtime; they do not collide |
| STORE-17 | On `/s/<slug>/inquire`, submit a DPF product inquiry with name, email, and a message about using DPF internally | Inquiry is captured successfully and returns a reference number without exposing internal-only workflow controls |
| STORE-18 | Navigate to `/storefront/inbox`, find the new inquiry, and click `Send to product backlog` | The inbox shows the inquiry as a customer-zero signal and creates or reuses a triaging backlog item tied to the configured digital product |
| STORE-19 | Navigate to `/ops` after sending the inquiry to backlog | A triaging backlog item exists with the inquiry reference in the title/body and notes that it came from the storefront customer-zero intake flow |

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
| AI-11 | Navigate to `/platform/tools/discovery` | Digital Product Estate Specialist shown |
| AI-12 | **(Coworker)** On `/platform/tools/discovery`, ask "What breaks if this fails?" about an attributed item | Response focuses on dependency impact and blast radius, not just raw scanner output |
| AI-13 | **(Incomplete info)** On `/platform/tools/discovery`, ask for version confidence without identifying an item | Agent asks for the missing item/context instead of inventing details |
| AI-14 | **(Coworker)** On `/platform/tools/discovery`, ask "Review the identity evidence for this item" about an attributed item | Response explains likely identity, vendor, evidence confidence, and what still needs review using shared estate context |
| AI-15 | **(Coworker)** On `/platform/tools/discovery`, ask "Why does this item need human review?" about a row currently in the Human Review queue | Response distinguishes Identity, Taxonomy, Evidence, and Reproducibility as separate signals (matching the four score tiles the workbench renders), names which signal was the blocking factor for this row, and cites the specific missing or conflicting evidence from the row's `DiscoveryTriageDecision`. It must not collapse identity and taxonomy into one number and must not invent a confidence value not present in the row. **Known prompt gap:** the Estate Specialist prompt at [apps/web/lib/tak/agent-routing.ts](D:/DPF-qa-plan-followup/apps/web/lib/tak/agent-routing.ts#L46) does not yet teach this four-signal framing by name; the test will fail until the prompt is updated to reference Identity / Taxonomy / Evidence / Reproducibility explicitly. Track that gap as a backlog item if AI-15 fails. |
| AI-16 | **(Incomplete info)** On `/platform/tools/discovery`, ask the coworker to "place this in the taxonomy" without naming the entity or pasting the evidence packet | Agent asks which entity (by `entityKey` or row name) and which evidence signals to inspect, rather than inventing a taxonomy node or score. Distinct from AI-13: AI-13 is a missing-item check on a version-confidence question; AI-16 is a missing-item check on a taxonomy-placement question. |

## Phase 13: Admin & Settings

| ID | Steps | Expected |
|----|-------|----------|
| ADMIN-01 | Navigate to `/admin` | User management page loads |
| ADMIN-02 | Navigate to `/admin/branding` | Brand settings with live preview (light + dark) |
| ADMIN-03 | Change accent color and save | Preview updates, platform reflects change |
| ADMIN-04 | Navigate to `/admin/settings` | Settings page loads |
| ADMIN-05 | Navigate to `/admin/reference-data` | Reference data editor loads |
| ADMIN-06 | Navigate to `/admin/business-context` | Redirected to `/storefront/settings/business` |
| ADMIN-07 | Navigate to `/admin/operating-hours` | Redirected to `/storefront/settings/operations` |
| ADMIN-08 | Navigate to `/admin/prompts` | Redirected to `/platform/ai/prompts` |
| ADMIN-09 | Navigate to `/admin/skills` | Redirected to `/platform/ai/skills` |
| ADMIN-10 | Navigate to `/platform/tools/catalog`, then `/platform/tools/services`, `/platform/tools/integrations`, and `/platform/tools/built-ins` | The Tools & Services family reads as Connection Catalog, MCP Services, Native Integrations, and Built-in Tools with no dead links or misleading labels |
| REF-LOCALITY-01 | On `/admin/reference-data`, expand Work Locations → Headquarters → Link address; pick Country=US, Region=Texas; in Locality search for `Thorndale`; choose `+ Add new locality: "Thorndale"`; complete address fields and save | Locality is created through the cascade picker (no direct DB insert / seed edit); the HQ address links to it; on refresh the address is still linked |
| REF-LOCALITY-02 | On the same Headquarters Link-address form, leave Region blank and try to save | Form blocks save and asks for the missing locality (cascade picker keeps Locality disabled until Region is selected); no address is created |

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
| AUTH-GOV-15 | Navigate to `/platform/identity/authorization?binding=AB-DEMO-FINANCE-CONTROLLER` | Shared binding editor renders inline above the human-first list, showing the selected binding summary, subjects, coworker application, and save controls |
| AUTH-GOV-16 | Navigate to `/platform/ai/assignments?binding=AB-DEMO-FINANCE-CONTROLLER` | The same binding record renders inline from the coworker-first surface with the same source-of-truth fields and no duplicated editor model |
| AUTH-GOV-17 | Navigate to `/platform/audit/authority`, select `HR-400` and `finance-controller`, then use the route-aware inspector link | Effective Permissions shows `/finance` route context, names binding `AB-DEMO-FINANCE-CONTROLLER`, and `Open binding` deep-links to `/platform/identity/authorization?binding=AB-DEMO-FINANCE-CONTROLLER` |
| AUTH-GOV-18 | In an environment with zero `AuthorityBinding` rows, open `/platform/identity/authorization` as a platform editor | The page auto-applies the initial bootstrap once, shows a `Bootstrap coverage` panel, and the human-first list populates without requiring a manual refresh first |
| AUTH-GOV-19 | Open `/platform/ai/assignments` after bootstrap when at least one route mapping was skipped as low-confidence | The coworker-first page shows the shared `Bootstrap coverage` panel, lists each skipped route with a human-readable reason, and still offers `Refresh inferred bindings` without hiding the existing model-assignment surface |
| AUTH-GOV-20 | From a low-confidence row such as `/setup` in either bootstrap coverage panel, click `Create draft binding` | A draft authority binding is created or reused idempotently, and the page opens the shared binding editor on that draft using the same admin surface the user started from |

---

## Adding New Test Cases

When implementing a new feature or fixing a bug:
1. Add test cases to the relevant phase above
2. Use the next available ID in the sequence (e.g., EMP-08, FIN-09)
3. Include both UI and coworker paths where applicable
4. Run the affected phase to verify before marking the backlog item as done
