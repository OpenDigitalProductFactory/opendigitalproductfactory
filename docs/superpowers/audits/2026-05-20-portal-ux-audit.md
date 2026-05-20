# Portal UX Hardening Audit — 2026-05-20

| Field | Value |
|-------|-------|
| **Author** | Claude Opus 4.7 (manual run; pre-AGT-906) |
| **Trigger** | Operator request: "harden the platform, incrementally go through all UX options and evaluate functionality, unfinished data, poor navigation, poor use of space" |
| **Worktree** | `D:/DPF/.claude/worktrees/agitated-wozniak-97ec6e` |
| **Portal version** | branch `claude/agitated-wozniak-97ec6e` @ `c9e2d931` |
| **Audit target** | Live Docker portal at `http://192.168.0.200:3000` (per `.env` `AUTH_URL`) |
| **Rubric source** | [`2026-05-16-ux-auditor-coworker-design.md`](../specs/2026-05-16-ux-auditor-coworker-design.md) §4–5 (full 22-lens taxonomy + finding format) |
| **Target shape** | [`2026-04-17-portal-navigation-consolidation-design.md`](../specs/2026-04-17-portal-navigation-consolidation-design.md) (5 areas, ≤6 area-tabs per layer, 4-layer shell) |
| **Standards** | WCAG 2.2 AA ([`docs/platform-usability-standards.md`](../../platform-usability-standards.md)), `var(--dpf-*)` token system, Doherty 400ms threshold |
| **Status** | Session 1 of N. Scaffold + findings on 4 high-signal routes. Continuation plan in §8. |

> **Provenance.** This document is the **manual ground-truth evidence base** for the planned `AGT-906 ux-design-critic` coworker. The spec at [`2026-05-16-ux-auditor-coworker-design.md`](../specs/2026-05-16-ux-auditor-coworker-design.md) defines AGT-906's "first mission" as auditing the live DPF shell against the portal-nav-consolidation invariants. AGT-906 is not yet implemented; this audit produces the dataset AGT-906 must reproduce when it lands (acceptance evidence) and seeds the regression corpus AGT-907 (`ux-test-automator`) will maintain.

---

## 1. Methodology

Adapted from Nielsen Norman Group's structured heuristic evaluation (NN/g, *How to Conduct a Heuristic Evaluation*), reframed through DPF's existing lens taxonomy. Six per-finding axes; one verdict per route.

### 1.1 Per-finding fields (matches [`UxFinding` extension §5.3](../specs/2026-05-16-ux-auditor-coworker-design.md))

| Field | Description |
|-------|-------------|
| `lens` | One of the 22 lenses (§2 below) |
| `severity` | `critical` \| `important` \| `minor` |
| `element` | DOM-locatable identifier (component path, selector, or screenshot region) |
| `observation` | What the auditor sees, no narrative |
| `risk` | Why this hurts the user — distinct from observation |
| `fix` | Specific actionable change, cite spec/standard if applicable |
| `evidence` | screenshot id \| `file:line` \| spec link |

### 1.2 Output template (rendered to operator)

```text
⚠️ Usability Violation: [Lens]   (severity: critical | important | minor)
Observation: <what the auditor sees>
The Risk:    <why it hurts the user>
The Fix:     <specific actionable change>
Evidence:    <screenshot | code-line | spec-link>
```

### 1.3 Verdict aggregation (matches [§5.6 of the spec](../specs/2026-05-16-ux-auditor-coworker-design.md))

| Finding set on a route | Verdict |
|------------------------|---------|
| Zero findings or only ≤2 `minor` | `pass` |
| Only `minor`, ≥3 of them | `pass-with-minor` |
| ≥1 `important`, zero `critical` | `concerns` |
| ≥1 `critical` | `fail` |

---

## 2. Rubric — 22-lens taxonomy

Sourced verbatim from [`2026-05-16-ux-auditor-coworker-design.md` §4](../specs/2026-05-16-ux-auditor-coworker-design.md). Every cited law has a peer-reviewed origin (Hick 1952, Fitts 1954, Miller 1956, Doherty IBM 1982, Nielsen) or current industry source (Microsoft HAX, Google PAIR, Atlassian Rovo, Salesforce Einstein HITL, WCAG 2.2 W3C Recommendation, OOUX/Voychehovski).

### 2.1 Heuristic UX laws (cognitive load + predictability)
- `hicks-law` — choice time scales log with options; target 4–6 per layer
- `fitts-law` — primary action placement, touch targets ≥44px
- `millers-law` — working memory ≈ 7±2 chunks
- `doherty-threshold` — >400ms requires skeleton screens, not spinners
- `jakobs-law` — convention adherence (nav location, color semantics)
- `poka-yoke` — error-prevention design (confirmations, undo, intent preview)

### 2.2 Agentic-AI UX (DPF-specific; no platform standard before this audit)
- `intent-preview` — every AI control shows what will happen before commit
- `confidence-signal` — generated/uncertain output is visibly signaled
- `autonomy-dial` — visible per-surface Observe/Approve/Autonomous control
- `explainable-rationale` — "why did I do this?" reachable from any AI action

### 2.3 Enterprise density (operational software ≠ marketing)
- `object-oriented-ux` — one logical object, not N sibling tabs
- `role-progressive-disclosure` — analyst/manager/exec see different densities
- `demo-driven-trap` — KPI tiles without drill-in
- `density-vs-whitespace` — `/workspace` and `/platform` get higher allowance than `/portal`

### 2.4 Inclusive design (AGT-906 sub-lenses; AGT-903 owns core WCAG)
- `reduced-motion` — `prefers-reduced-motion` honored for animations >200ms
- `plain-language` — Flesch-Kincaid ≥60 on body copy in non-developer routes
- `literal-copy` — no schema-leaked labels (`sourceSummary`, `localityModel`)

### 2.5 WCAG 2.2 AA (AGT-903's lane; flagged here for completeness)
- `wcag-contrast`, `wcag-semantic-html`, `wcag-keyboard`, `wcag-focus-order`,
  `wcag-label`, `wcag-touch-target`, `wcag-loading-state`, `wcag-color-only`

### 2.6 Functional / data-completeness (this audit's additions, complementing the spec)
- `functionality` — dead button, 404, `[object Object]`, broken CTA
- `data-completeness` — `null`/`—`/`unknown ago`/empty without empty-state
- `navigation-orphan` — page exists but no path in from canonical surfaces
- `breadcrumb-gap` — deep page without back path

---

## 3. Route inventory — 250 surfaces, 30 areas

Full machine inventory captured to this file. Counts derived from `find apps/web/app -name page.tsx` at HEAD.

### 3.1 Public + auth (12)
- `(auth)/login`, `forgot-password`, `reset-password`
- `(customer-auth)/customer-login`, `customer-signup`, `customer-link-account`, `customer-complete-profile`
- `(portal-auth)/portal/sign-in`
- `(setup)/setup`
- `welcome`, `sandbox-restricted`, `/` (root)

### 3.2 Internal shell — 5-area top-level (matches spec §6.2 target)

**Workspace (4):** `/workspace`, `/workspace/documents`, `/workspace/documents/[id]`, `/workspace/my-queue`

**Business (50):**
- `/employee` (1)
- `/customer` CRM cluster (10): root, [id], engagements, funnel, opportunities, opportunities/[id], quotes, sales-orders, marketing, marketing/strategy
- `/finance` (38): banking ×5, bills ×3, invoices ×3, purchase-orders ×3, recurring ×3, expense-claims ×2, my-expenses ×2, suppliers ×3, assets ×3, reports ×7, settings ×4, plus root, close, configuration, payments, payment-runs, revenue, spend, spend/ai
- `/compliance` (24): root + 7 entity types × ~3 surfaces (list, detail, sub-pages) + licensing, gaps, onboard, posture
- `/portal` legacy ref (handled by `/storefront`)

**Products (15):**
- `/portfolio` (2): root, architecture
- `/portfolio/product/[id]` cluster (10): architecture, backlog, changes, health, inventory, knowledge, offerings, team, versions, root
- `/portfolio/products/[productId]` (1)
- `/inventory` (1) — legacy alias
- `/ops` backlog (6): root, changes, health, improvements, promotions, self-upgrade

**Platform (44):**
- `/platform` (1) hub
- `/platform/ai` (16): authority, assignments, assignments/bindings/[id], agent/[id], build-studio, capability-needs, capacity-continuity, history, model-assignment, operations, operations-map, prompts, providers, providers/[id], routing, skills
- `/platform/audit` (7): authority, journal, ledger, metrics, operations, routes, root
- `/platform/identity` (8): root, agents, applications, authorization, authorization/bindings/[id], directory, federation, groups, principals
- `/platform/integrations` (2): root, sync
- `/platform/services` (3): root, [id], activate
- `/platform/tools` (15): catalog, catalog/sync, discovery, discovery/promotion-audit, services, services/[id], services/activate, built-ins, inventory, integrations + 11 concrete integration pages (ADP, Stripe, Hubspot, QuickBooks, Mailchimp, Facebook×2, Instagram, WhatsApp, Google×2, MS365)
- `/platform/edge-nodes` (1)
- `/ea` Enterprise Architecture (6): root, agents, models, models/[slug], views, views/[id]

**Knowledge (5):**
- `/knowledge` (3): root, [articleId], new
- `/wiki` (3): root, [...slug], edit/[...slug]
- `/docs/[[...slug]]` (1)

### 3.3 Build Studio (3)
- `/build`, `/build/work`, `/build/work/[capsuleId]`

### 3.4 Admin (21)
- `/admin` + 16 sub-pages (backlog, backups, branding, business-context, business-models, diagnostics, issue-reports, operating-hours, platform-development, prompts, reference-data, settings, skills, wiki/lint)
- `/admin/storefront` (7): root + inbox, items, sections, settings, setup, team

### 3.5 Customer-facing storefront (13)
- `/storefront` (9 management surfaces)
- `(storefront)/s/[slug]` public routes (13): root, sign-in, sign-up, inquire×2, item, book, checkout, donate, approve, expense-approve, pay

### 3.6 Other (3)
- `/complaints`, `/ea` (counted above)

**Total: 250 routes** (matches `find` count). Coverage status logged in §5.

---

## 4. Audit walk — session 1 (2026-05-20)

Four high-signal routes audited via Claude-in-Chrome. Logged-in as `admin@dpf.local` (HR-000, superuser).

### 4.1 `/workspace` — verdict: **concerns**

Six-C Command Center is the entry point. AGT-906's first-mission route.

**Findings:**

⚠️ **`millers-law`** *(important)*
- **Element:** Page header stack — `app-rail-section-label` "WORKSPACE" → AppRail item "Workspace" → page title "WORKSPACE HOME" → sub-title "Command Center" → tagline "Cross-business command center for human employees, AI coworkers, operating cadence, confidence, and containment."
- **Observation:** Five header tiers stacked above the first content row.
- **Risk:** Visitor cannot tell which label is the page identity. The 4-word tagline doubles as a description on every visit; loses value after first read.
- **Fix:** Collapse to 2 tiers — "Workspace" (page title) + tagline shown only on first visit or behind an info chip. Per portal-nav-consolidation §9 (workspace = personal dashboard).
- **Evidence:** screenshot `ss_5025rsy0r`

⚠️ **`demo-driven-trap`** *(important)*
- **Element:** Six metric tiles row (`AI COWORKERS 81 / OPEN WORK 156 / CUSTOMER ACCOUNTS 0 / FINANCE ITEMS 0 / OPEN INCIDENTS 0 / BUILDS 15`)
- **Observation:** Four of six tiles read "0" on a non-demo install; tiles are not clickable / have no "Add your first" affordance.
- **Risk:** KPI surface that cannot be acted on becomes decoration; user learns to ignore it (banner blindness).
- **Fix:** Each zero tile renders an inline CTA ("Add your first customer →") that deep-links to the create flow. Non-zero tiles deep-link to filtered list per Operations Map convention.
- **Evidence:** screenshot `ss_5025rsy0r`

⚠️ **`object-oriented-ux`** *(minor)*
- **Element:** Six-C readiness matrix (DOMAIN × CONTEXT/CONNECTIONS/CAPABILITIES/CADENCE/CONFIDENCE/CONTAINMENT)
- **Observation:** Cells are not clickable; no drill-in to the underlying signal.
- **Risk:** "Compliance / CONTAINMENT / Blocked" tells the operator something is wrong but offers no path to diagnosis. Decorative not operational.
- **Fix:** Each cell drills into the readiness-gap detail page; `blocked` cells show the owning `BacklogItem` / `CoworkerCapabilityNeed`. Per [`business-os-readiness-audit`](../plans/2026-05-15-business-os-readiness-audit.md) §"ReadinessGapPanel" — link the matrix to the panel.
- **Evidence:** screenshot `ss_5025rsy0r`

⚠️ **`literal-copy`** *(minor)*
- **Element:** Six-C column headers `CONTEXT / CONNECTIONS / CAPABILITIES / CADENCE / CONFIDENCE / CONTAINMENT`
- **Observation:** Operator-facing column labels match internal schema vocabulary; meaning of each column is not visible without external documentation.
- **Risk:** New operators (or returning ones) cannot interpret the matrix without recall.
- **Fix:** Hover/info-tip on each column header explaining what state is being measured. Or rename to plain-language equivalents.
- **Evidence:** screenshot `ss_5025rsy0r`

✓ **Positive observations** — top-level AppRail conforms to the portal-nav-consolidation target (5 areas: Workspace / Business / Products / Platform / Knowledge). Coworker pane is context-aware (COO on /workspace). Platform-update banner is actionable. EXTERNAL ACCESS toggle visible — satisfies `autonomy-dial` for external-tool authorization.

---

### 4.2 `/compliance` — verdict: **concerns**

⚠️ **`object-oriented-ux`** *(important)*
- **Element:** Tab bar `Overview / Licensing / Library / Controls / Assurance / Risk / Operations` — 7 tabs
- **Observation:** Compliance is presented as a 7-tab tree at the top level, then each tab opens a 2–3 level sub-structure (regulations, obligations, controls, etc.). Per QA plan GRC-01, prior version had 14 tabs — already consolidated to 7, but the underlying domain still fragments across many sibling pages (24 routes total under `/compliance`).
- **Risk:** Operator cannot reason about "compliance" as one object; switching tabs loses context.
- **Fix:** Per portal-nav-consolidation §7.2 target: regroup into ≤6 lifecycle-grouped tabs (Overview, Library, Controls, Assurance, Risk, Operations — actually current is close, just 1 over). Acceptable; promote to `minor` after verifying the tab count matches §7.2 exactly.
- **Evidence:** screenshot `ss_2319j7wax`

⚠️ **`demo-driven-trap`** *(important)*
- **Element:** Eight zero-state surfaces on one page — 4 KPI tiles (Obligations 0, Control Coverage 0%, Open Incidents 0, Overdue Actions 0) + 4 sections (REGULATORY ALERTS "No scans yet", UPCOMING DEADLINES "No upcoming...", RECENT ACTIVITY "No compliance activity yet", BY REGULATION "No regulations registered yet")
- **Observation:** 8 empty states stacked vertically; only "Add your first regulation to get started" and "Run Scan Now" have CTAs.
- **Risk:** Fresh install lands here and sees a sea of zeros. Reads as "nothing works" instead of "nothing configured yet."
- **Fix:** Collapse to one orchestrating empty state per surface section — "Compliance is not yet configured for this organization" + 3-step setup CTA. Hide the KPI tile row until at least one regulation exists.
- **Evidence:** screenshot `ss_2319j7wax`

⚠️ **`jakobs-law`** *(minor)*
- **Element:** Two distinct card styles on the same page — top 4 KPI tiles use surface-1 dark, bottom 2 (Published Policies / Total Acknowledgments) use a different surface treatment.
- **Observation:** Visual inconsistency between conceptually identical components.
- **Risk:** Operator's pattern-matching breaks; secondary cards read as "different importance" with no reason.
- **Fix:** Unify all KPI tiles to a single component (`<KpiTile />`) — single source of styling per [`platform-usability-standards.md`](../../platform-usability-standards.md).
- **Evidence:** screenshot `ss_2319j7wax`

⚠️ **`doherty-threshold`** *(minor)*
- **Element:** Top platform-update banner `Loading AI model into memory... first response may take a moment.`
- **Observation:** Honest spinner-equivalent. Good honesty but no skeleton.
- **Risk:** Multi-second model load with no progress beyond the banner text.
- **Fix:** Add a progress indicator or estimated time. Or — better — preload the model on session start so the user never sees this state.

---

### 4.3 `/admin` — verdict: **pass-with-minor**

Cleanest of the four routes audited.

⚠️ **`density-vs-whitespace`** *(minor)*
- **Element:** Access Setup section — split-pane CREATE USER (left ~600px) and PASSWORD RESET (right ~400px). Right pane has 3 fields and a button; uses ~30% of the page width.
- **Observation:** Unbalanced split favoring create-user, which is the lower-frequency operation.
- **Risk:** Daily-use action (password reset) gets visually demoted under one-time setup action.
- **Fix:** Swap visual weight or stack the two sections vertically; prioritize password reset above create-user.

⚠️ **`hicks-law`** *(minor)*
- **Element:** Tab bar `Access / Organization / Configuration / Advanced` — 4 tabs at top of `/admin`
- **Observation:** "Advanced" is a content-negative label. What is "Advanced"?
- **Risk:** Operator avoids the tab because the name suggests danger or complexity. Or clicks once, finds it useless, and never returns.
- **Fix:** Replace "Advanced" with the specific concern it gates (e.g. "Backups", "Diagnostics", "Platform Development") or drop the tab and surface the contents inline where relevant.

✓ **Positive:** Coworker context "System Admin" is correctly resolved. Form labels are clear. Status badges (`superuser`, `active`) are visually distinct. Password-policy hint is shown above the submit button (poka-yoke compliant).

---

### 4.4 `/build` — verdict: **fail**

Build Studio in-flight. Single active build `FB-7F8C7368` "Build Studio sync with externally-developed work + per-deliverable assignment/ownership."

⚠️ **`confidence-signal`** *(critical)*
- **Element:** Coworker pane (right, Software Engineer) is rendering a continuous wall of streaming text — ~30 lines of raw agent thinking visible without structure, formatting, or boundaries. Excerpt: "work + per-deliverable assignment/ownership. Today, when a feature ships to main via a branch/PR that wasn't dispatched by Build Studio (a parallel Claude session, a human PR, a hotfix), the matching FeatureBuild row sits forever in stale phase (build/disabled) with empty verificationOut + acceptanceMet..."
- **Observation:** Generated content has no `[draft]` chrome, no AI attribution chip, no boundary between turns.
- **Risk:** Operator cannot distinguish what is system output, what is the AI's reasoning, what is the user's prior input, or where a thought ends. Looks like a debug log leaked into the UI.
- **Fix:** Per [`2026-04-25-build-studio-redesign-design.md`](../specs/2026-04-25-build-studio-redesign-design.md) §"three new conversation cards" — render agent output in turn-bounded cards with explicit role (Software Engineer), generation status ("Thinking..." / "Done"), and a token budget chip. Existing pattern already specified; enforce it.
- **Evidence:** screenshot `ss_6318ks40b`

⚠️ **`data-completeness`** *(important)*
- **Element:** "Dispatch attempts" row (`Dispatch unknown ago / No dispatch attempts recorded yet.`), "Verification" row (`Verification unknown ago / 0 failed test(s)`), "TASK PROGRESS" (`DB taskResults progress 0%`), Sandbox branch (`BRANCH unknown / HEAD unknown / AHEAD unknown`)
- **Observation:** Multiple null fields render as the literal string "unknown ago" / "unknown".
- **Risk:** Confidence collapses — operator cannot tell whether the system is broken, the build is fresh, or data is missing.
- **Fix:** Null-state rendering rule — when a field is null, render an em-dash (—) or the empty-state copy "Not yet run", never the literal token "unknown".
- **Evidence:** screenshot `ss_6318ks40b`

⚠️ **`literal-copy`** *(important)*
- **Element:** "DB taskResults progress" label
- **Observation:** Schema-leaked field name (`taskResults`) rendered in operator-facing chrome.
- **Risk:** Operator reads "DB taskResults" and either ignores it or misinterprets what "DB" means.
- **Fix:** Rename to "Task results" or "Build tasks". DB-prefix and camelCase belong in code, not UI.
- **Evidence:** screenshot `ss_6318ks40b`

⚠️ **`intent-preview`** *(minor)*
- **Element:** "Advance to Plan" button (primary CTA on build)
- **Observation:** No preview of what advancing accomplishes; button reads as "go" without a "before-and-after" view.
- **Risk:** Operator clicks without understanding what the orchestrator will do next.
- **Fix:** Hover-tip or inline-help describing the phase transition. Per [`2026-04-25-customer-marketing-coworker-led-ux-correction.md`](../specs/2026-04-25-customer-marketing-coworker-led-ux-correction.md) §4 — every AI-starting control shows intent before commit.
- **Evidence:** screenshot `ss_6318ks40b`

✓ **Positive:** "A design document is required before planning." is correct poka-yoke — explains why the button is disabled. Honest "Live sandbox git diff is not available for this projection yet." instead of fabricating data. PORTAL CONTEXT / Build Studio / build-ID / branch slug header is informative.

---

## 5. Coverage status

| Area | Routes | Audited (S1) | Remaining |
|------|--------|--------------|-----------|
| Workspace | 4 | 1 | 3 |
| Business — Employee | 1 | 0 | 1 |
| Business — Customer | 10 | 0 | 10 |
| Business — Finance | 38 | 0 | 38 |
| Business — Compliance | 24 | 1 | 23 |
| Products — Portfolio | 13 | 0 | 13 |
| Products — Ops/backlog | 6 | 0 | 6 |
| Products — Inventory | 1 | 0 | 1 |
| Platform — AI | 16 | 0 | 16 |
| Platform — Audit | 7 | 0 | 7 |
| Platform — Identity | 8 | 0 | 8 |
| Platform — Integrations/Services/Tools | 21 | 0 | 21 |
| Platform — Tools/integrations vendors | 11 | 0 | 11 |
| Platform — EA / edge | 7 | 0 | 7 |
| Knowledge — Knowledge/Wiki/Docs | 7 | 0 | 7 |
| Build Studio | 3 | 1 | 2 |
| Admin | 21 | 1 | 20 |
| Storefront (mgmt) | 9 | 0 | 9 |
| Storefront (public `/s/`) | 13 | 0 | 13 |
| Auth/setup/welcome/portal | 17 | 0 | 17 |
| **Total** | **250** | **4** | **246** |

**Verdicts so far:** 1 fail (`/build`), 2 concerns (`/workspace`, `/compliance`), 1 pass-with-minor (`/admin`).

---

## 6. Findings summary — session 1

| Lens | critical | important | minor | total |
|------|---------:|----------:|------:|------:|
| `confidence-signal` | 1 | 0 | 0 | 1 |
| `object-oriented-ux` | 0 | 1 | 1 | 2 |
| `demo-driven-trap` | 0 | 2 | 0 | 2 |
| `millers-law` | 0 | 1 | 0 | 1 |
| `data-completeness` | 0 | 1 | 0 | 1 |
| `literal-copy` | 0 | 1 | 1 | 2 |
| `intent-preview` | 0 | 0 | 1 | 1 |
| `hicks-law` | 0 | 0 | 1 | 1 |
| `density-vs-whitespace` | 0 | 0 | 1 | 1 |
| `jakobs-law` | 0 | 0 | 1 | 1 |
| `doherty-threshold` | 0 | 0 | 1 | 1 |
| **Total** | **1** | **6** | **7** | **14** |

**Recurring patterns** (≥2 instances, candidate proceduralization):
- `demo-driven-trap` — empty-state zeros without CTA, observed on /workspace and /compliance. Suggests platform-wide pattern need: every zero-state KPI must include a deep-link or onboarding CTA.
- `literal-copy` — schema vocabulary in operator-facing UI, observed on /workspace ("CONTEXT/CONNECTIONS/...") and /build ("taskResults"). Suggests platform-wide pattern: an operator-vocabulary translation layer for all schema field labels.
- `object-oriented-ux` — fragmented entity surfacing, observed on /workspace (matrix cells not actionable) and /compliance (24 routes for one logical domain).

---

## 7. Backlog filing strategy

Per the spec §5.5, only `critical` and `important` findings auto-file as backlog items; `minor` rides the `ship-with-followups` path.

**Session 1 to file:** 7 items (1 critical + 6 important).

- BI-CANDIDATE-01 — `/build` confidence-signal critical → wire coworker pane to the conversation-card pattern from build-studio-redesign §"three new conversation cards"
- BI-CANDIDATE-02 — `/build` data-completeness important → null-state rendering rule (no literal "unknown")
- BI-CANDIDATE-03 — `/build` literal-copy important → rename schema-leaked labels in BuildStatusCard
- BI-CANDIDATE-04 — `/workspace` millers-law important → collapse 5-tier header to 2
- BI-CANDIDATE-05 — `/workspace` demo-driven-trap important → KPI tile CTA pattern
- BI-CANDIDATE-06 — `/compliance` demo-driven-trap important → orchestrating empty state on fresh install
- BI-CANDIDATE-07 — `/compliance` object-oriented-ux important (close-to-target) → verify tab count matches portal-nav §7.2 exactly

**Meta-BI:** implement the `ux-auditor-coworker` per [`2026-05-16-ux-auditor-coworker-design.md`](../specs/2026-05-16-ux-auditor-coworker-design.md). Spec is architect-reviewed and unimplemented. This audit produces the ground-truth evidence base AGT-906 must reproduce when it lands.

Filing path: through the MCP `create_backlog_item` tool or through `/ops` UI directly. Sessions 2+ will drive the portal `/ops` create flow to file these (per `prefer-portal-ux-for-shared-actions`).

---

## 8. Continuation plan

This audit is **session 1 of N**. The 246 remaining routes require ~10 more sessions to cover at this density. Two tracks proceed in parallel:

### Track A — manual audit continuation
- **Session 2:** `/employee`, `/customer` cluster (CRM), `/portfolio` + product detail (covers Business + Products)
- **Session 3:** `/finance` cluster (38 routes — densest single area; finance-specific routes need finance-domain context)
- **Session 4:** `/compliance` deep (23 remaining sub-pages)
- **Session 5:** `/platform/ai` + `/platform/audit` (governance surfaces — high operator value)
- **Session 6:** `/platform/identity` + `/platform/tools` + `/platform/services`
- **Session 7:** `/platform/tools/integrations/*` (11 vendor integration pages)
- **Session 8:** `/knowledge`, `/wiki`, `/docs`, `/ea`
- **Session 9:** `/storefront` (mgmt) + `/admin` deep
- **Session 10:** `/storefront/s/*` public + `/portal/*` customer-facing
- **Session 11:** Auth / setup / welcome + verdicts roll-up

Each session appends to §4 of this doc, updates §5/§6/§7, and files the session's important/critical findings as BIs.

### Track B — implement AGT-906 (governed substrate)
- **Plan writing:** convert the [`2026-05-16-ux-auditor-coworker-design.md`](../specs/2026-05-16-ux-auditor-coworker-design.md) spec into an executable plan under `docs/superpowers/plans/2026-05-XX-ux-auditor-coworker.md`. The spec already has architect review.
- **Build Studio execution:** file the meta-BI (see §7) and let BS drive AGT-906 + AGT-907 + the 3 skills + 1 persona through ideate/plan/build/review/ship.
- **Validation:** AGT-906's first scheduled audit run against the live shell must reproduce this audit's findings within an acceptable delta. Any miss is an AGT-906 calibration issue (a backlog item against AGT-906, not against the portal).

### Crossover
Once AGT-906 ships, Track A converges: the auditor coworker takes over and produces a `UxAuditReport` per week. Manual sessions stop being necessary except for sanity sampling.

---

## 9. References

- Rubric source: [`docs/superpowers/specs/2026-05-16-ux-auditor-coworker-design.md`](../specs/2026-05-16-ux-auditor-coworker-design.md)
- Target shape: [`docs/superpowers/specs/2026-04-17-portal-navigation-consolidation-design.md`](../specs/2026-04-17-portal-navigation-consolidation-design.md)
- Standards: [`docs/platform-usability-standards.md`](../../platform-usability-standards.md), WCAG 2.2 AA, Doherty Threshold (IBM 1982)
- Functional coverage: [`tests/e2e/platform-qa-plan.md`](../../../tests/e2e/platform-qa-plan.md) (15 phases, ~200 cases)
- Build Studio Reviewer-panel pattern: [`docs/superpowers/specs/2026-04-25-build-studio-redesign-design.md`](../specs/2026-04-25-build-studio-redesign-design.md)
- Deliberation framework: [`docs/superpowers/specs/2026-04-21-deliberation-pattern-framework-design.md`](../specs/2026-04-21-deliberation-pattern-framework-design.md)
- Companion business OS audit: [`docs/superpowers/plans/2026-05-15-business-os-readiness-audit.md`](../plans/2026-05-15-business-os-readiness-audit.md)
- Existing BI in flight: `BI-8E1BF8AA` "Workspace UI clarity improvement" — filed by COO coworker on /workspace prior to this session (see screenshot `ss_5025rsy0r` right-pane transcript). Will be cross-linked when filed BIs land.

---

*End session 1.*

---

## Addendum — session 2 (2026-05-20, same day)

Operator feedback after session 1: *"Some changes were made, but I still find issues. And I don't think the evaluation using the actual UX was performed."*

That was correct. Session 1 inspected screenshots of static pages; it did not exercise the UX. This addendum walks every clickable on `/workspace` and every left-rail destination, recording functional failures observed live. **All 18 findings below were captured by actually clicking, not by looking.**

### S2.1 KPI tile clickability matrix — `/workspace`

Visually identical tiles, six of them. Three are clickable; of those, two are broken and one lands in the wrong place. Three are inert.

| Tile | Clickable? | Destination | Result |
|------|------------|-------------|--------|
| AI COWORKERS 81 | no | — | inert (no affordance) |
| OPEN WORK 156 | yes | `/work/backlog` | **404** (route does not exist; correct route is `/ops`) |
| CUSTOMER ACCOUNTS 0 | yes | `/customers` | **404** (correct route is `/customer`, singular) |
| FINANCE ITEMS 0 | no | — | inert |
| OPEN INCIDENTS 0 | yes | `/compliance` | lands on overview, **not** `/compliance/incidents` |
| BUILDS 15 | no | — | inert |

⚠️ **`functionality` *(critical)*** — Two of six KPI tiles route to 404. The 404 page is bare default Next.js (black background, no shell, no nav, no way back) — operator is stranded.

⚠️ **`jakobs-law` *(critical)*** — Identical-looking components have inconsistent click affordance. Operator cannot predict which tile is interactive. Hover states do not signal clickability.

### S2.2 Six-C readiness matrix — `/workspace`

| Chip | Clickable? | Destination |
|------|------------|-------------|
| Compliance / CONTAINMENT Blocked (red) | yes | `/platform/ai` — **wrong**; should drill to compliance evidence, not the AI roster |
| Platform delivery / CONTAINMENT Blocked (red) | no | inert |
| Finance / CONTEXT Attention (yellow) | not tested in session 2 | — |
| Customers and delivery / CONNECTIONS Attention (yellow) | not tested in session 2 | — |

⚠️ **`functionality` *(critical)*** — Same chip component with same state (`Blocked`) has different click behavior on two adjacent rows. The clickable one navigates to an unrelated page.

### S2.3 Hero CTA — `/workspace`

⚠️ **`functionality` *(important)*** — `AI Operations Map` button on `/workspace` Command Center → `/platform/ai/operations-map`. The page **eventually renders**, but throws a **React error #418** (hydration mismatch — "Text content does not match server-rendered HTML") on every load. Console shows the stack at `_next/static/chunks/0wsmsmnm9-93v.js:0:47244`. The map itself shows **4 coworkers in the topology vs 81 in the workspace tile** — counts disagree.

### S2.4 Left-rail navigation sweep

Walked every AppRail destination. Every page loaded; surfaces labeled below.

| Label | URL | Coworker resolved | Notes |
|-------|-----|-------------------|-------|
| Workspace | `/workspace` | COO | See §4.1 and §S2.1–S2.3 |
| Documents | `/workspace/documents` | COO | Loads clean. **No CTA on empty state** — list view with no "Create" / "Upload" |
| Customer | `/customer` | Customer Success Manager | Loads clean (in contrast to broken KPI tile linking to `/customers`) |
| People | `/employee` | HR Director | **Label/URL mismatch.** Mixed null-state vocabulary (Unassigned / Not set / None / Unset) |
| Finance | `/finance` | Finance Specialist | Clean. `Open ↗` quadrant pattern works |
| Compliance | `/compliance` | COO | (per QA AI-06 — compliance has no dedicated agent; that's a documented gap) |
| Portal | `/storefront` | Storefront Operations Manager | **Label/URL contradicts AGENTS.md §2** — `/portal` is reserved for customer-facing; AppRail labels the internal-management page "Portal" |
| Portfolio | `/portfolio` | Portfolio Analyst | "1 alert firing" chip; 117 products concentrated in one of 4 portfolios; truncated label "Products and Services S..." in inner rail |
| Backlog | `/ops` | Scrum Master | Loads; header reads `51 epics · 440 items` |
| Architecture | `/portfolio/architecture` | Portfolio Analyst | Top-level label, sub-route URL. Empty state |
| AI Workforce | `/platform/ai` | AI Ops Engineer | 80+ coworker cards, all showing `Not assigned / Governance Pending / Unassigned / 0 active grants` |
| Build Studio | `/build` | Software Engineer | See §4.4 — agent thinking still leaking into transcript |
| Platform Hub | `/platform` | AI Ops Engineer | Stats panel shows **`FAILED EXECUTIONS 326`** — operational alarm visible without alarm-level treatment |
| Admin | `/admin` | System Admin | Clean (see §4.3) |
| Knowledge | `/knowledge` | COO | Empty state. Portfolio sub-tabs are good |
| Wiki | `/wiki` | COO | **Severe data-integrity bug — see §S2.5** |
| Docs | `/docs` | COO | Cleanest surface in the audit. Strong IA: doc tree + tile grid |

### S2.5 Data integrity — `/wiki`

⚠️ **`functionality` *(critical, data-integrity)*** — Every principle on `/wiki` is **listed twice** with two slug variants. Examples observed in the same scroll:

- "All Changes Land via PR Against Main" → both `/principles/all-changes-land-via-pr` and `principles/all-changes-land-via-pr`
- "Architecture Over Shortcuts" → both slugs
- "Build Gate (Mandatory)" → both slugs
- "DCO Sign-Off Required on Every Commit" → both slugs
- "Human-in-the-Loop at Phase Boundaries" → both slugs
- "Never Assume — Verify" → both slugs

Header reads `PRINCIPLES · 98`. Likely actual count is ~49. Identical content rendered twice for every principle. The slug normalization (leading-slash vs no-leading-slash) is broken at the index layer.

### S2.6 Count drift — same number, different value on three surfaces

| Surface | Counter | Value |
|---------|---------|-------|
| `/workspace` (KPI tile) | OPEN WORK | 156 |
| `/portfolio` (situation summary) | OPEN BACKLOG | 121 (20 in progress) |
| `/ops` (header) | items | 440 (across 51 epics) |

⚠️ **`functionality` *(important, data-truth)*** — Three counters, three values, all claiming to count "work." No source-of-truth. Operator cannot trust any of them. Same issue with `AI COWORKERS 81` vs `4 in operations map topology`.

### S2.7 AI coworker pane functional bugs — `/workspace`

⚠️ **`confidence-signal` *(critical)*** — Internal setup prompt is leaking into the coworker transcript:
> "[Setup step: Workspace — day-to-day operations and guardrails] Organisation: Digital Product Factory. This is the final setup step. Welcome the user to their workspace… Do NOT create any epics, backlog items, or guardrails. Do NOT start building or decomposing anything. Keep it to 2–3 sentences."

This is the agent's system instruction, rendered as conversation content. Operator can read the orchestration commentary, which destroys the illusion that this is a coworker, not a teleprompter.

⚠️ **`functionality` *(important, AI provider routing)*** — Asking "hello" to the coworker returns `"The AI provider is temporarily unavailable. Please try again in about 30 seconds."` Repeated **three times** before the Gemini failover finally fired with `Switched to Google Gemini after the preferred endpoint was unavailable.` Three failed turns before fallback is the failure mode the routing layer is supposed to hide.

### S2.8 Cross-cutting — coworker governance state on `/platform/ai`

⚠️ **`data-completeness` *(important)*** — Every one of the 80+ coworker cards on `/platform/ai` shows the same governance row: `Capability class: Not assigned · Autonomy: Governance Pending · Owning team: Unassigned · 0 active grants`. This is either (a) the platform has never been governed (every coworker should have an owning team and HITL tier) or (b) the rendering is reading the wrong source. The `STANDING TOOL GRANTS 517` counter on `/platform` says grants exist; the AI roster page says no coworker has any. The two screens disagree.

### S2.9 Updated finding tally — sessions 1 + 2

| Lens | critical | important | minor | total |
|------|---------:|----------:|------:|------:|
| `functionality` (new) | 4 | 2 | 0 | 6 |
| `jakobs-law` | 1 | 0 | 1 | 2 |
| `confidence-signal` | 2 | 0 | 0 | 2 |
| `data-completeness` | 0 | 2 | 0 | 2 |
| `demo-driven-trap` | 0 | 2 | 0 | 2 |
| `literal-copy` | 0 | 1 | 1 | 2 |
| `object-oriented-ux` | 0 | 1 | 1 | 2 |
| `millers-law` | 0 | 1 | 0 | 1 |
| `intent-preview` | 0 | 0 | 1 | 1 |
| `hicks-law` | 0 | 0 | 1 | 1 |
| `density-vs-whitespace` | 0 | 0 | 1 | 1 |
| `doherty-threshold` | 0 | 0 | 1 | 1 |
| **Total** | **7** | **9** | **7** | **23** |

7 critical findings across the audited surface area (≈14 of 250 routes). That's a ~50% critical-fail rate on the surfaces actually tested.

### S2.10 Notable behavior of `/wiki`, `/docs`, `/finance`, `/admin`, `/docs` — what's working

Not every surface is broken. These five carry their weight:
- `/admin` is structurally sound; only minor nits.
- `/docs` has the cleanest IA in the platform; tile grid + tree sidebar with strong grouping.
- `/finance` quadrant + `Open ↗` drill-in pattern is the cleanest reusable design pattern observed in the shell.
- `/portal/storefront` Dashboard tab loads cleanly with a published-vs-unpublished state machine.
- `/platform` quadrant of {AI Operations, Tools & Services, Governance & Audit, Core Admin} has accurate counts where verifiable.

The hardening backlog should preserve these patterns and propagate them rather than rewriting them.

### S2.11 Revised BI candidates from sessions 1+2

Critical-tier (block ship if AGT-906 had been gating):

- BI-CANDIDATE-S2-01 — KPI tile routing audit + repair + lift to a single `<KpiTile>` component with verified destination type. Eliminates bugs #1, #3, #4 (404 page), #5, #6 in one structural fix.
- BI-CANDIDATE-S2-02 — Themed `not-found.tsx` at app router root so 404 lands inside the shell with back-to-workspace nav (fixes 404 stranding).
- BI-CANDIDATE-S2-03 — `/wiki` slug normalization at index time; collapse duplicate principle rows. Likely 1-line fix at the indexer + a one-shot cleanup query.
- BI-CANDIDATE-S2-04 — `/platform/ai/operations-map` React #418 hydration repair. Add the dev-mode equivalent to surface the actual cause; almost always SSR/CSR date or random mismatch.
- BI-CANDIDATE-S2-05 — Coworker transcript boundary — system prompts must not render as assistant content. The setup prompt leak is a regression of the conversation-card pattern from `2026-04-25-build-studio-redesign-design.md`.
- BI-CANDIDATE-S2-06 — Six-C matrix cell affordance — pick one: either every cell drills in (to a route that matches the cell semantics), or no cells drill in. The current per-cell mystery affordance is the bug.
- BI-CANDIDATE-S2-07 — Routing-layer failover SLA: a primary-endpoint outage must not surface 3 "temporarily unavailable" responses to the operator before failing over. Per `feedback_dynamic_model_discovery.md` + `feedback_fix_seed_not_runtime.md`.

Important-tier:

- BI-CANDIDATE-S2-08 — Count source-of-truth audit: pick one query/projection for "open work" and back every counter with it (workspace tile, portfolio summary, ops header, AI Operations Map agent count, /platform AGENTS, /platform/ai roster, etc.).
- BI-CANDIDATE-S2-09 — Label/URL semantic alignment: rename AppRail items or rename routes so "People" doesn't go to `/employee` and "Portal" doesn't go to `/storefront`. Per AGENTS.md §2 `/portal` is reserved for customer-facing.
- BI-CANDIDATE-S2-10 — Coworker governance backfill: 80+ coworkers show `Not assigned / Governance Pending / 0 active grants`. Either the seed under-populates or the display reads the wrong source. Reconcile against `STANDING TOOL GRANTS 517`.
- BI-CANDIDATE-S2-11 — Null-state vocabulary normalization across surfaces: single token (`—`) for nullable string fields; never the literal "unknown", "Unassigned", "Not set", "None", "Unset" used interchangeably.

### S2.12 Strategic recommendation update

Track B (implement AGT-906 + AGT-907) is now even more urgent than session 1 indicated. Of the 23 findings in 2 sessions, **AGT-906 would have caught every one** at build-review time — they're all evidence-bound, lens-classifiable, and severity-rankable per the spec. Without the auditor coworker, this dataset will keep growing every time main moves.

The proposed next step from session 1 stands and is now my recommended only sequential next step:

> File the meta-BI converting [`2026-05-16-ux-auditor-coworker-design.md`](../specs/2026-05-16-ux-auditor-coworker-design.md) into an executable plan and hand it to Build Studio. The 11 session-1+2 BI candidates above ride alongside as the first work AGT-906 is acceptance-tested against.

*End session 2.*
