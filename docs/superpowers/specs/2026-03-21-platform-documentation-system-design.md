# EP-DOCS-001: Platform Documentation System

**Status:** Draft
**Date:** 2026-03-21
**Epic:** Platform Documentation System
**Scope:** In-app documentation that tells users what the platform does, how each area works, and how to accomplish tasks. Versioned, searchable, and maintained as features evolve.
**Dependencies:** None (can build on any current route structure)

---

## Problem Statement

The platform has 70+ API endpoints, 8 major functional areas (portfolios, HR, CRM, EA, compliance, storefront, Build Studio, operations), 30+ completed epics, and zero user-facing documentation. A new user who signs in sees a workspace dashboard with tiles, navigation, and AI coworker skills — but no way to learn what any of it does without asking the AI or clicking around.

**Current state:**
- `/portal/support` — stub page: "Coming soon"
- `/api/docs` — internal dev docs served as HTML (not user-facing, no navigation, no search)
- AI coworker skills — contextual but require knowing what to ask
- No help icons, no onboarding tour, no functional guides, no glossary

**Why this matters:**
1. **Regulated industries** — the platform's target market. Compliance officers, HR managers, and finance staff need to understand the tools they're using. "Ask the AI" is not auditable documentation.
2. **Multi-role platform** — different users see different views. An HR manager needs HR docs, not Build Studio docs.
3. **Rapid feature growth** — 100+ specs in 11 days. Without documentation, features are invisible to users.
4. **Specs are not docs** — specs describe design intent and implementation details. Users need "what does this do and how do I use it," not Prisma model diagrams.

## Goals

1. Users can find and read documentation for every functional area from within the portal
2. Documentation is organized by role and area, not by chronological spec order
3. Each doc page shows its last-updated date and links to related areas
4. Search works across all documentation
5. Contextual links from specific pages to their relevant documentation section
6. AI coworker can reference documentation when answering questions
7. Documentation stays current through a defined maintenance process

## Non-Goals

- API reference docs for external developers (separate concern, different audience)
- Video tutorials or interactive walkthroughs (future epic)
- Auto-generated docs from code/schema (useful but complementary, not primary)
- Replacing specs — specs remain the design source of record

---

## Design

### 1. Documentation Architecture

Documentation lives in `/docs` as markdown files, rendered in-app under the `/(shell)/docs/` route with the standard navigation shell.

**Content hierarchy:**

```
/docs                           → Documentation home (area cards, search)
/docs/[area]                    → Area overview (e.g., /docs/compliance)
/docs/[area]/[topic]            → Topic page (e.g., /docs/compliance/onboarding)
```

**Areas (matching platform navigation):**

| Area | Route | Description | Key Topics |
|------|-------|-------------|------------|
| Getting Started | `/docs/getting-started` | First-time user orientation | Platform overview, roles, navigation, AI coworker basics |
| Workspace | `/docs/workspace` | Dashboard and daily workflow | Calendar, activity feed, tiles, notifications |
| Portfolios | `/docs/portfolios` | Portfolio management | Portfolio structure, health metrics, investment tracking |
| Products | `/docs/products` | Digital product lifecycle | Product registry, lifecycle stages, taxonomy |
| Architecture | `/docs/architecture` | Enterprise architecture | EA canvas, viewpoints, reference models, value streams |
| HR & Workforce | `/docs/hr` | Employee management | Directory, lifecycle, reviews, timesheets, org chart |
| Customers | `/docs/customers` | CRM and sales | Accounts, contacts, opportunities, quotes, orders |
| Compliance | `/docs/compliance` | GRC suite | Regulations, obligations, controls, evidence, policies, onboarding |
| Finance | `/docs/finance` | Financial management | Invoicing, AP/bills, purchase orders, suppliers |
| Storefront | `/docs/storefront` | Public-facing storefront | Archetypes, sections, items, booking, setup |
| Build Studio | `/docs/build-studio` | Product development | Ideate, plan, build, review, ship pipeline |
| Operations | `/docs/operations` | Backlog and epics | Work items, epic management, portfolio ops |
| AI Workforce | `/docs/ai-workforce` | AI providers and agents | Provider registry, routing, agent capabilities |
| Platform Admin | `/docs/admin` | System administration | Users, roles, branding, reference data, settings |

### 2. Content Format

Each documentation page is a markdown file with YAML frontmatter:

```markdown
---
title: "Onboarding a Regulation or Standard"
area: compliance
order: 3
lastUpdated: 2026-03-21
updatedBy: Claude (COO)
relatedSpecs:
  - 2026-03-21-grc-onboarding-design.md
  - 2026-03-17-compliance-engine-core-design.md
roles: [admin, compliance_officer]
---

## Overview

The compliance module supports onboarding any regulation, standard, framework,
or internal standard through a structured 4-step wizard...
```

**Frontmatter fields:**
- `title` — page title (required)
- `area` — maps to navigation area (required)
- `order` — sort order within area (required)
- `lastUpdated` — ISO date of last content update (required)
- `updatedBy` — who updated it (required for audit trail)
- `relatedSpecs` — links to design specs that informed this doc (optional)
- `roles` — which user roles this doc is most relevant for (optional, for role-filtered views)

### 3. Documentation Storage

Documentation content lives in `docs/user-guide/` (separate from `docs/superpowers/specs/` which is internal design docs):

```
docs/
  user-guide/
    getting-started/
      index.md          → "Getting Started" overview
      platform-overview.md
      roles-and-access.md
      ai-coworker.md
    compliance/
      index.md          → "Compliance" overview
      onboarding.md
      regulations.md
      obligations.md
      controls.md
      evidence.md
      policies.md
    hr/
      index.md
      directory.md
      lifecycle.md
      ...
    ...
```

**Why file-based:**
- Version-controlled with the codebase (git history = change audit trail)
- Deployable with the app (no external CMS dependency)
- Editable by both humans and AI agents
- Diffable in PRs (documentation changes are reviewable)
- Works offline in Docker deployment

### 4. Rendering

**New route:** `apps/web/app/(shell)/docs/[[...slug]]/page.tsx`

- Catch-all route renders any documentation path
- Reads markdown from `docs/user-guide/` at build time (or on-demand in dev)
- Renders with the same markdown processor used by `/api/docs` but with proper navigation chrome
- Left sidebar: area navigation tree
- Right sidebar: page table of contents (generated from headings)
- Top bar: search, breadcrumbs, last-updated date

**Markdown rendering features:**
- Standard GFM (tables, code blocks, task lists)
- Internal links between doc pages
- Callout blocks for tips, warnings, important notes
- Screenshots/images (stored in `docs/user-guide/assets/`)

### 5. Search

Full-text search across all documentation pages.

**Implementation:** At build time (or server startup), index all markdown files into a search index. On the docs home page and in the sidebar, a search input filters and ranks results by relevance.

**Options (in order of preference):**
1. **Simple:** Server-side grep across markdown files with result highlighting — works for the current scale (~50–100 pages)
2. **Better:** Lunr.js or Fuse.js client-side index built at compile time — fast, no server cost
3. **Future:** Vector search via the platform's existing knowledge base search MCP tool — semantic matching

Start with option 1 or 2. Option 3 is a natural extension once the vector DB epic (EP-MEMORY-001) lands.

### 6. Contextual Help Links

Each platform page can link to its relevant documentation section via a help icon in the page header.

**Implementation:** Extend `route-context-map.ts` with a `docsPath` field per route:

```ts
"/compliance": {
  label: "Compliance",
  docsPath: "/docs/compliance",
  skills: [...]
}
```

A `HelpLink` component renders a small icon-button that links to the docs page. Placed in page headers alongside the existing title.

### 7. AI Coworker Integration

The AI coworker should be able to reference documentation when answering user questions.

**Implementation:** Add a new MCP tool `search_user_docs` that searches the documentation index and returns relevant content. When a user asks "how do I onboard a regulation?", the coworker can pull the relevant doc page and provide a grounded answer with a link to the full docs.

This leverages the existing `platformKnowledgeBaseSearch` tool pattern but targets user docs specifically.

### 8. Maintenance Process

Documentation must stay current. The maintenance model:

1. **Spec-driven updates:** When a spec is implemented, the corresponding user doc is created or updated. The `relatedSpecs` frontmatter links docs to their design origin.
2. **Supersession handling:** When a spec is superseded, the user doc is updated to reflect the new behavior (not the old spec). The doc's `lastUpdated` and `updatedBy` fields track when.
3. **Review trigger:** The epic review and reconciliation process (already established) should include a documentation review step — "is the user doc still accurate?"
4. **AI-assisted drafting:** The AI coworker can draft documentation from specs. The human reviews and approves. This is the same pattern as the GRC onboarding wizard — AI drafts, human confirms.

---

## Data Model

No new Prisma models. Documentation is file-based in `docs/user-guide/`.

The only schema touch is the optional `docsPath` field in the route context map (TypeScript constant, not database).

## Files Affected

**New files:**
- `apps/web/app/(shell)/docs/[[...slug]]/page.tsx` — documentation viewer page
- `apps/web/components/docs/DocsLayout.tsx` — sidebar navigation + TOC layout
- `apps/web/components/docs/DocsSearch.tsx` — search input and results
- `apps/web/components/docs/HelpLink.tsx` — contextual help icon component
- `apps/web/lib/docs.ts` — markdown loading, frontmatter parsing, search index
- `docs/user-guide/getting-started/index.md` — first doc page (platform overview)
- `docs/user-guide/` — all area subdirectories with index.md files

**Modified files:**
- `apps/web/lib/route-context-map.ts` — add `docsPath` field per route
- `apps/web/lib/mcp-tools.ts` — add `search_user_docs` tool
- Navigation component — add "Docs" entry to shell navigation

## Implementation Order

1. **Infrastructure** — docs route, markdown renderer, layout with sidebar/TOC
2. **First content** — Getting Started guide (platform overview, roles, navigation, AI coworker)
3. **Search** — client-side search index
4. **Contextual links** — HelpLink component + docsPath in route map
5. **Area content** — one area at a time, prioritized by user role frequency (compliance, HR, CRM, storefront)
6. **AI integration** — search_user_docs MCP tool
7. **Remaining areas** — fill in all area docs

## Demo Story

A new compliance officer joins the organization. She signs in and sees the workspace dashboard. She notices a small book icon in the top navigation and clicks it — the documentation home page opens with cards for each platform area.

She clicks "Compliance" and sees an overview of the GRC suite: what regulations are, how obligations work, what controls and evidence mean. She clicks "Onboarding a Regulation" and reads a step-by-step guide with screenshots showing the 4-step wizard.

Later, she's on the compliance page and sees a small help icon next to the page title. She clicks it and goes directly to the compliance docs section. She asks the AI coworker "how do I link a policy to multiple obligations?" — the coworker searches the docs, finds the relevant section, and provides the answer with a link to the full page.

Six weeks later, the platform ships a new feature that changes how evidence is collected. The documentation is updated as part of the feature PR — the `lastUpdated` date changes, and the `relatedSpecs` field points to the new spec. The compliance officer sees the updated content the next time she visits the docs.
