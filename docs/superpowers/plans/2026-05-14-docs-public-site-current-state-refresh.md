# Current-State Documentation, README, and Public Website Refresh Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the README, public docs website, in-app user guide, architecture overview, and contextual docs routing back into alignment with the current platform after the recent feature wave.

**Architecture:** Treat runtime code and live backlog as the evidence source, not old specs or seed assumptions. Keep public claims, user-guide operations, and architecture/current-state boundaries separate so future-state design does not leak into shipped-product messaging. Spend roughly 20 percent of the effort on docs IA and coverage refactoring so this does not become another one-off cleanup.

**Tech Stack:** Markdown, static GitHub Pages content under `docs/`, Next.js in-app docs rendering under `apps/web/app/(shell)/docs`, docs route mapping in `apps/web/lib/docs-route-map.ts`, Vitest for focused route-map coverage, Playwright or browser verification for the public page and in-app docs.

---

## Backlog Anchor

Epic: `EP-DOCS-6B9F2A` - Current-State Documentation, README, and Public Website Refresh.

Items:

- `BI-DOCS-AUDIT` - Audit recent product changes against README, public site, and user-guide coverage.
- `BI-B0668CDC` - Docs optimization: reconcile docs IA with canonical shell navigation. This is the refactoring lane and should consume about 20 percent of the epic effort.
- `BI-DOCS-README` - Refresh README to reflect the current platform capability set and install posture.
- `BI-DOCS-PUBLIC` - Refresh the public documentation website content and first-viewport design.
- `BI-DOCS-USER` - Update user-guide pages for newly shipped and moved product surfaces.
- `BI-DOCS-GUARD` - Add documentation freshness checks for route and public-claim drift.

Backlog note: The DPF MCP endpoint at `http://localhost:3000/api/mcp/v1` was unavailable when this plan was created, so the epic and items were created via explicit live Postgres fallback and read back from `dpf-postgres-1`.

## Current Evidence Snapshot

Recent first-parent history on `origin/main` shows shipped or merged work in these areas that the docs must re-check before publishing claims:

- Edge Node: enrollment, heartbeat, discovery-runs, admin UI, ARP collector, standalone compose, multi-host verification, installer bundling.
- Wiki and principles: founder-kernel markdown, `WikiPage`, principles as wiki kind, wiki query/lint MCP tools, global `/wiki` and admin lint surfaces.
- Documents: managed document foundation and `/workspace/documents`.
- AI operations: Operations Map saved views/reset/quick views, capacity continuity, capability needs, autonomous coworker runtime, scheduled runs.
- Build Studio: provider/runner split, evidence intake, branch/promotion visibility, code intelligence graph, task result hardening, MCP CLI adapter.
- Compliance and finance: licensing investigation workspace, tax/remittance setup and execution foundations.
- Platform tools and integrations: Google Business Profile, Google Marketing Intelligence, provider authority, connector surfaces, MCP onboarding.
- Install/runtime: macOS/Linux installer early-access posture, release gates, doctor diagnostics, Edge Node bundle.

The current docs surfaces already exist, but they are uneven:

- `README.md` is strong on installation and deployment architecture, but older capability counts and roadmap/current-state boundaries need a fresh pass.
- `docs/index.html` is the public pre-install website and has substantial content, but must be checked against current shipped surfaces and polished as a first-viewport product story.
- `docs/README.md` and `docs/user-guide/index.md` are navigation hubs and should stay concise.
- `docs/user-guide/**` is bundled into the portal's in-app help and must be operational, not copied from specs.
- `docs/architecture/platform-overview.md` owns current runtime architecture and deployment boundaries.
- `docs/superpowers/specs/**` and `docs/superpowers/plans/**` are historical or design artifacts. They can be evidence, but they must not become public onboarding truth.
- `apps/web/lib/docs-route-map.ts` maps route families to in-app docs and is the best place for a freshness guard.

## File Structure

Create:

- `docs/superpowers/audits/2026-05-14-current-docs-coverage.md` - current-state coverage matrix and stale-claim inventory.
- Optional: `docs/user-guide/platform/edge-nodes.md` if the audit confirms the Edge Node operator surface needs a dedicated guide.
- Optional: `docs/user-guide/workspace/documents.md` if managed documents need more than the workspace overview.
- Optional: `docs/user-guide/wiki/index.md` or equivalent if `/wiki` becomes a first-class user-guide section.
- Optional: `docs/user-guide/platform/docs-freshness.md` only if the guard needs operator-facing documentation.

Modify:

- `README.md` - project overview, install posture, current capability inventory, roadmap/current-state split.
- `docs/index.html` - public website content, visual hierarchy, current capability sections, links.
- `docs/README.md` - docs hub links and audience boundaries.
- `docs/user-guide/index.md` - domain guide list and lastUpdated.
- `docs/user-guide/platform/index.md` - platform route coverage.
- `docs/user-guide/platform/ai-operations.md` - Operations Map, capacity continuity, capability needs, autonomous runs.
- `docs/user-guide/platform/tools-and-integrations.md` - current integrations and MCP/tooling surfaces.
- `docs/user-guide/build-studio/index.md` - code intelligence, evidence, provider/runner, branch/promotion behavior where user-facing.
- `docs/user-guide/build-studio/sandbox.md` - sandbox/provider/runner and verification wording if stale.
- `docs/user-guide/compliance/index.md` and related compliance pages - licensing workspace entry point.
- `docs/user-guide/finance/controls-and-automation.md` - tax/remittance setup where user-facing.
- `docs/architecture/platform-overview.md` - only for runtime-current boundaries that are now stale.
- `apps/web/lib/docs-route-map.ts` - contextual help mapping for new visible route families.
- `apps/web/lib/docs-route-map.test.ts` - freshness guard tests.

Do not modify:

- `docs/superpowers/specs/**` except to reference this plan from a follow-up spec if a later design task requires it.
- `packages/db/src/seed.ts` for backlog or documentation truth.
- Existing dirty files in `D:\DPF`; this plan lives in the isolated worktree.

## Chunk 1: Evidence Audit (`BI-DOCS-AUDIT`)

### Task 1: Build The Coverage Matrix

**Files:**

- Create: `docs/superpowers/audits/2026-05-14-current-docs-coverage.md`

- [ ] **Step 1: Capture recent merged feature areas**

Run:

```powershell
git log --first-parent --oneline -n 180 origin/main
```

Expected: output includes recent Edge Node, wiki/principles, document management, Operations Map, MCP CLI adapter, code graph, licensing, capacity continuity, installer, and Build Studio work.

- [ ] **Step 2: Capture visible route families**

Run:

```powershell
Get-ChildItem -Path 'apps\web\app\(shell)' -Recurse -Filter page.tsx | ForEach-Object { $_.FullName.Substring((Resolve-Path '.').Path.Length + 1) } | Sort-Object
```

Expected: output includes visible route families such as `/workspace/documents`, `/wiki`, `/platform/edge-nodes`, `/platform/ai/operations-map`, `/platform/ai/capacity-continuity`, `/platform/ai/capability-needs`, `/compliance/licensing`, and finance tax/settings surfaces.

- [ ] **Step 3: Write the audit document**

Create a table with these columns:

```markdown
| Capability | Runtime evidence | README | Public site | User guide | Architecture docs | Status | Required change |
|------------|------------------|--------|-------------|------------|-------------------|--------|-----------------|
```

Use statuses: `current`, `stale`, `missing`, `future-state-risk`, `intentionally-internal`.

- [ ] **Step 4: Verify the audit has no unsupported claims**

Run:

```powershell
rg -n "probably|maybe|should be|I think|TODO" docs\superpowers\audits\2026-05-14-current-docs-coverage.md
```

Expected: no unsupported language remains, or every hit is in a clearly marked open-question section.

## Chunk 2: Docs IA Refactor Lane (`BI-B0668CDC`)

### Task 2: Align Docs Navigation With Product Navigation

**Files:**

- Modify: `docs/README.md`
- Modify: `docs/user-guide/index.md`
- Modify: `apps/web/lib/docs-route-map.ts`
- Modify: `apps/web/lib/docs-route-map.test.ts`

- [ ] **Step 1: Define the docs source-of-truth boundaries**

Update the docs hubs so they consistently state:

- README is the project overview and install posture.
- `docs/index.html` is the public pre-install website.
- `docs/user-guide/**` is operational product help.
- `docs/architecture/**` is current architecture and standards.
- `docs/superpowers/**` is design history and implementation planning, not onboarding copy.

- [ ] **Step 2: Add route-map entries for missing visible surfaces**

Add or intentionally exempt visible route families identified in the audit. Initial candidates:

```ts
{ routePrefix: "/workspace/documents", docsPath: "/docs/workspace/index" },
{ routePrefix: "/wiki", docsPath: "/docs/wiki/index" },
{ routePrefix: "/platform/edge-nodes", docsPath: "/docs/platform/edge-nodes" },
{ routePrefix: "/platform/ai/operations-map", docsPath: "/docs/platform/ai-operations" },
{ routePrefix: "/platform/ai/capacity-continuity", docsPath: "/docs/platform/ai-operations" },
{ routePrefix: "/platform/ai/capability-needs", docsPath: "/docs/platform/ai-operations" },
{ routePrefix: "/compliance/licensing", docsPath: "/docs/compliance/regulations-and-obligations" },
```

Adjust the exact docs paths based on the audit. If a new docs path is introduced, create the page in the same chunk.

- [ ] **Step 3: Strengthen route-map tests**

Add focused assertions for every newly mapped route family and for any explicit exemption.

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/docs-route-map.test.ts
```

Expected: route-map tests pass and fail locally if a mapped docs page is missing.

## Chunk 3: README Refresh (`BI-DOCS-README`)

### Task 3: Update The Project Overview

**Files:**

- Modify: `README.md`
- Read: `docs/architecture/platform-overview.md`
- Read: `docs/superpowers/audits/2026-05-14-current-docs-coverage.md`

- [ ] **Step 1: Rewrite the capability inventory from the audit**

Keep the README short enough to scan. Replace stale counts and missing capability lists with grouped current capabilities:

- Product, portfolio, architecture, and operations.
- AI workforce, MCP, TAK/GAID, Operations Map, and capacity continuity.
- Build Studio, code intelligence, sandbox verification, and promotion.
- Wiki/principles and managed documents.
- Compliance/licensing and finance/tax.
- Storefront, customer/marketing, and integrations.
- Edge Node and deployment/install posture.

- [ ] **Step 2: Tighten current vs roadmap language**

Use explicit labels:

- `Working now`
- `Early access`
- `In design`
- `Coming later`

Do not call cloud, TAPPaaS, or not-yet-verified install modes GA.

- [ ] **Step 3: Check links**

Run:

```powershell
rg -n "\(docs/[^)]*\)" README.md
```

Expected: every docs link points to a real file or rendered directory.

## Chunk 4: Public Website Refresh (`BI-DOCS-PUBLIC`)

### Task 4: Refresh `docs/index.html`

**Files:**

- Modify: `docs/index.html`
- Modify as needed: `docs/assets/css/site.css`
- Read: `docs/assets/logos/OpenDigitalProductFactory.png`

- [ ] **Step 1: Rework the first viewport**

The first viewport should make DPF itself the signal: name, real product category, install mode, AI-governed platform extension, and a hint of the next content section. Avoid stale generic enterprise-software copy.

- [ ] **Step 2: Update capability sections**

Add or revise sections for:

- Edge Node and local infrastructure truth.
- Wiki/principles and governed memory.
- Managed documents.
- AI Operations Map and capacity continuity.
- Build Studio with code intelligence and governed promotion.
- MCP as an external governed workflow surface.

- [ ] **Step 3: Verify responsive design**

Use Browser or Playwright against the local file or static site preview. Check desktop and mobile widths.

Expected:

- No text overlap.
- Primary CTAs are visible.
- Public claims are visually distinct from roadmap content.
- Layout does not read as a nested-card dashboard.

## Chunk 5: User-Guide Refresh (`BI-DOCS-USER`)

### Task 5: Update Operational Help Pages

**Files:**

- Modify or create files listed in the file structure section based on the audit.
- Modify: `apps/web/lib/docs-route-map.ts`
- Modify: `apps/web/lib/docs-route-map.test.ts`

- [ ] **Step 1: Write missing operational pages**

Pages should answer:

- What is this surface for?
- When should an operator use it?
- What state is authoritative?
- What can the AI coworker do here?
- What should not be treated as complete automation yet?

- [ ] **Step 2: Keep specs out of user-facing copy**

Specs can inform the page, but user guide copy must describe the product operators see today.

- [ ] **Step 3: Verify docs render inside the portal**

Run the app in the appropriate local runtime, then exercise:

```text
/docs
/docs/platform/ai-operations
/docs/build-studio
/docs/workspace
```

Expected: pages render, sidebar remains usable, and contextual docs links point to the updated content.

## Chunk 6: Freshness Guard (`BI-DOCS-GUARD`)

### Task 6: Add A Lightweight Drift Check

**Files:**

- Modify: `apps/web/lib/docs-route-map.ts`
- Modify: `apps/web/lib/docs-route-map.test.ts`
- Optional create: `docs/superpowers/audits/docs-refresh-checklist.md`

- [ ] **Step 1: Add a visible-route coverage fixture**

Introduce a small list of high-signal visible route examples that must resolve to docs:

```ts
const VISIBLE_ROUTE_DOCS_EXAMPLES = [
  "/workspace/documents",
  "/wiki",
  "/platform/edge-nodes",
  "/platform/ai/operations-map",
  "/platform/ai/capacity-continuity",
  "/platform/ai/capability-needs",
  "/compliance/licensing",
  "/finance/settings/tax",
];
```

Use the existing `resolveDocsPath` and `docsPathExists` helpers.

- [ ] **Step 2: Add a release checklist**

Capture a short checklist for future docs refreshes:

- scan recent first-parent history
- scan visible shell routes
- update README/public/user-guide/architecture boundaries
- run route-map tests
- run typecheck/build when app code changed
- run browser verification for public page and in-app docs

- [ ] **Step 3: Run focused tests**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/docs-route-map.test.ts
```

Expected: all route-map tests pass.

## Final Verification

Run these before claiming the epic implementation is complete:

```powershell
pnpm --filter web exec vitest run apps/web/lib/docs-route-map.test.ts
pnpm --filter web typecheck
pnpm --filter web build
```

For public-site and in-app-docs UI changes, also perform browser verification:

- Public static docs page: `docs/index.html` or the GitHub Pages preview path.
- In-app docs: `/docs`, `/docs/platform/ai-operations`, `/docs/build-studio`, and any newly created pages.

Record evidence on the backlog item when MCP is reachable again. If MCP remains unavailable, use live DB fallback only for status readback and clearly label it.
