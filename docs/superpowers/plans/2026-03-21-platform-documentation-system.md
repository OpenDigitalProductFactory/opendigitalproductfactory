# Platform Documentation System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-app documentation system that lets users read about every platform area from within the shell.

**Architecture:** File-based markdown in `docs/user-guide/`, rendered under `/(shell)/docs/` with a catch-all route. Sidebar navigation from frontmatter metadata, client-side search via Fuse.js, contextual help links from route-context-map. Uses existing `react-markdown` (^10.1.0) already in the project.

**Tech Stack:** Next.js App Router (catch-all `[[...slug]]`), react-markdown, gray-matter (YAML frontmatter parsing), Fuse.js (client-side search), existing --dpf-* CSS variables.

**Spec:** `docs/superpowers/specs/2026-03-21-platform-documentation-system-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `apps/web/lib/docs.ts` | Load markdown files, parse frontmatter, build area index, search index. Pure functions, server-only. |
| `apps/web/lib/docs.test.ts` | Tests for docs utilities |
| `apps/web/app/(shell)/docs/[[...slug]]/page.tsx` | Catch-all docs route. Server component. Loads markdown, renders with layout. |
| `apps/web/components/docs/DocsLayout.tsx` | Client component. Sidebar nav + table of contents + content area. |
| `apps/web/components/docs/DocsSidebar.tsx` | Client component. Area tree navigation with active state. |
| `apps/web/components/docs/DocRenderer.tsx` | Server component. Renders markdown to HTML with react-markdown and heading IDs. |
| `apps/web/components/docs/DocsSearch.tsx` | Client component. Fuse.js search input with results dropdown. |
| `apps/web/components/docs/HelpLink.tsx` | Client component. Small icon-button linking to docs from page headers. |
| `docs/user-guide/getting-started/index.md` | Platform overview doc |
| `docs/user-guide/getting-started/roles-and-access.md` | Roles and permissions guide |
| `docs/user-guide/getting-started/ai-coworker.md` | AI coworker guide |
| `docs/user-guide/compliance/index.md` | Compliance area overview |
| `docs/user-guide/compliance/onboarding.md` | Regulation onboarding guide |
| `docs/user-guide/hr/index.md` | HR area overview |
| `docs/user-guide/customers/index.md` | CRM area overview |
| `docs/user-guide/storefront/index.md` | Storefront area overview |
| `docs/user-guide/finance/index.md` | Finance area overview |
| `docs/user-guide/operations/index.md` | Operations/backlog overview |
| `docs/user-guide/architecture/index.md` | EA area overview |
| `docs/user-guide/build-studio/index.md` | Build Studio overview |
| `docs/user-guide/workspace/index.md` | Workspace overview |
| `docs/user-guide/admin/index.md` | Admin overview |
| `docs/user-guide/ai-workforce/index.md` | AI providers overview |
| `docs/user-guide/portfolios/index.md` | Portfolio management overview |
| `docs/user-guide/products/index.md` | Product lifecycle overview |

### Modified Files

| File | Change |
|------|--------|
| `apps/web/components/shell/Header.tsx` | Add "Docs" to `NAV_ITEMS` array |
| `apps/web/lib/route-context-map.ts` | Add `/docs` route context with docsPath field pattern |
| `apps/web/package.json` | Add `gray-matter` and `fuse.js` dependencies |

---

## Task 1: Add dependencies

**Files:**
- Modify: `apps/web/package.json`

- [ ] **Step 1: Install gray-matter and fuse.js**

```bash
cd apps/web && pnpm add gray-matter fuse.js
```

gray-matter parses YAML frontmatter from markdown files. Fuse.js provides client-side fuzzy search. Both are lightweight, no heavy dependencies.

- [ ] **Step 2: Verify install**

```bash
pnpm --filter web exec node -e "require('gray-matter'); require('fuse.js'); console.log('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml
git commit -m "chore(docs): add gray-matter and fuse.js for documentation system"
```

---

## Task 2: Docs utility — load and parse markdown

**Files:**
- Create: `apps/web/lib/docs.ts`
- Create: `apps/web/lib/docs.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/lib/docs.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseDocFrontmatter, buildDocsIndex, extractHeadings } from "./docs";

describe("parseDocFrontmatter", () => {
  it("extracts title, area, order, and lastUpdated from frontmatter", () => {
    const raw = `---
title: "Getting Started"
area: getting-started
order: 1
lastUpdated: 2026-03-21
updatedBy: Claude (COO)
---

## Welcome

This is the getting started guide.`;

    const result = parseDocFrontmatter(raw);
    expect(result.title).toBe("Getting Started");
    expect(result.area).toBe("getting-started");
    expect(result.order).toBe(1);
    expect(result.lastUpdated).toBe("2026-03-21");
    expect(result.updatedBy).toBe("Claude (COO)");
    expect(result.content).toContain("## Welcome");
    expect(result.content).not.toContain("---");
  });

  it("returns defaults for missing optional fields", () => {
    const raw = `---
title: "Test"
area: test
order: 1
lastUpdated: 2026-03-21
updatedBy: System
---

Content here.`;

    const result = parseDocFrontmatter(raw);
    expect(result.relatedSpecs).toEqual([]);
    expect(result.roles).toEqual([]);
  });
});

describe("extractHeadings", () => {
  it("extracts h2 and h3 headings for table of contents", () => {
    const md = `## Overview\n\nSome text.\n\n### Sub Topic\n\nMore text.\n\n## Another Section`;
    const headings = extractHeadings(md);
    expect(headings).toEqual([
      { level: 2, text: "Overview", slug: "overview" },
      { level: 3, text: "Sub Topic", slug: "sub-topic" },
      { level: 2, text: "Another Section", slug: "another-section" },
    ]);
  });
});

describe("buildDocsIndex", () => {
  it("groups docs by area and sorts by order", () => {
    const docs = [
      { slug: "getting-started/roles", title: "Roles", area: "getting-started", order: 2, lastUpdated: "2026-03-21", updatedBy: "System", content: "", relatedSpecs: [], roles: [] },
      { slug: "getting-started/index", title: "Overview", area: "getting-started", order: 1, lastUpdated: "2026-03-21", updatedBy: "System", content: "", relatedSpecs: [], roles: [] },
      { slug: "compliance/index", title: "Compliance", area: "compliance", order: 1, lastUpdated: "2026-03-21", updatedBy: "System", content: "", relatedSpecs: [], roles: [] },
    ];
    const index = buildDocsIndex(docs);
    expect(Object.keys(index)).toContain("getting-started");
    expect(Object.keys(index)).toContain("compliance");
    expect(index["getting-started"]![0]!.title).toBe("Overview");
    expect(index["getting-started"]![1]!.title).toBe("Roles");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter web exec vitest run lib/docs.test.ts
```

Expected: FAIL — module `./docs` cannot resolve `parseDocFrontmatter`, `extractHeadings`, `buildDocsIndex`.

- [ ] **Step 3: Implement the docs utility**

Create `apps/web/lib/docs.ts`:

```ts
// apps/web/lib/docs.ts
// Utilities for loading and parsing user-guide markdown documentation.
// Server-only — uses Node fs for file reading.

import "server-only";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

// ── Types ────────────────────────────────────────────────────────────────────

export type DocPage = {
  slug: string;           // e.g. "getting-started/index"
  title: string;
  area: string;           // e.g. "getting-started"
  order: number;
  lastUpdated: string;    // ISO date string
  updatedBy: string;
  content: string;        // markdown body (no frontmatter)
  relatedSpecs: string[];
  roles: string[];
};

export type DocHeading = {
  level: number;
  text: string;
  slug: string;
};

export type DocsIndex = Record<string, DocPage[]>;

// ── Area metadata (display names + descriptions for the docs home) ──────────

export const AREA_META: Record<string, { label: string; description: string }> = {
  "getting-started": { label: "Getting Started", description: "Platform overview, roles, navigation, and AI coworker basics" },
  workspace:         { label: "Workspace", description: "Dashboard, calendar, activity feed, and notifications" },
  portfolios:        { label: "Portfolios", description: "Portfolio structure, health metrics, and investment tracking" },
  products:          { label: "Products", description: "Digital product registry, lifecycle stages, and taxonomy" },
  architecture:      { label: "Architecture", description: "EA canvas, viewpoints, reference models, and value streams" },
  hr:                { label: "HR & Workforce", description: "Employee directory, lifecycle, reviews, and org chart" },
  customers:         { label: "Customers", description: "CRM accounts, contacts, pipeline, quotes, and orders" },
  compliance:        { label: "Compliance", description: "Regulations, obligations, controls, evidence, and policies" },
  finance:           { label: "Finance", description: "Invoicing, accounts payable, purchase orders, and suppliers" },
  storefront:        { label: "Storefront", description: "Public-facing storefront setup, sections, items, and booking" },
  "build-studio":    { label: "Build Studio", description: "Product development: ideate, plan, build, review, ship" },
  operations:        { label: "Operations", description: "Backlog items, epics, and delivery management" },
  "ai-workforce":    { label: "AI Workforce", description: "AI providers, model routing, and agent capabilities" },
  admin:             { label: "Admin", description: "Users, roles, branding, reference data, and settings" },
};

// Ordered area keys for display (Getting Started first, Admin last)
export const AREA_ORDER = Object.keys(AREA_META);

// ── Frontmatter parsing ─────────────────────────────────────────────────────

export function parseDocFrontmatter(raw: string): DocPage {
  const { data, content } = matter(raw);
  return {
    slug: "",
    title: (data.title as string) ?? "Untitled",
    area: (data.area as string) ?? "unknown",
    order: (data.order as number) ?? 99,
    lastUpdated: (data.lastUpdated as string) ?? "",
    updatedBy: (data.updatedBy as string) ?? "",
    content: content.trim(),
    relatedSpecs: (data.relatedSpecs as string[]) ?? [],
    roles: (data.roles as string[]) ?? [],
  };
}

// ── Heading extraction (for table of contents) ──────────────────────────────

export function extractHeadings(markdown: string): DocHeading[] {
  const headings: DocHeading[] = [];
  const regex = /^(#{2,3})\s+(.+)$/gm;
  let match;
  while ((match = regex.exec(markdown)) !== null) {
    const level = match[1]!.length;
    const text = match[2]!.trim();
    const slug = text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-");
    headings.push({ level, text, slug });
  }
  return headings;
}

// ── Index building ──────────────────────────────────────────────────────────

export function buildDocsIndex(docs: DocPage[]): DocsIndex {
  const index: DocsIndex = {};
  for (const doc of docs) {
    if (!index[doc.area]) index[doc.area] = [];
    index[doc.area]!.push(doc);
  }
  for (const area of Object.keys(index)) {
    index[area]!.sort((a, b) => a.order - b.order);
  }
  return index;
}

// ── File system loading ─────────────────────────────────────────────────────

// Next.js runs from apps/web — go up two levels to repo root (same as codebase-tools.ts)
const PROJECT_ROOT = path.resolve(process.cwd(), "..", "..");
const USER_GUIDE_DIR = path.join(PROJECT_ROOT, "docs", "user-guide");

/** Load a single doc page by slug (e.g. "getting-started/index"). */
export function loadDocPage(slug: string): DocPage | null {
  const filePath = path.join(USER_GUIDE_DIR, `${slug}.md`);
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf-8");
  const doc = parseDocFrontmatter(raw);
  doc.slug = slug;
  return doc;
}

/** Load all doc pages from the user-guide directory. */
export function loadAllDocs(): DocPage[] {
  const docs: DocPage[] = [];
  if (!fs.existsSync(USER_GUIDE_DIR)) return docs;

  function walk(dir: string, prefix: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), `${prefix}${entry.name}/`);
      } else if (entry.name.endsWith(".md")) {
        const slug = `${prefix}${entry.name.replace(/\.md$/, "")}`;
        const raw = fs.readFileSync(path.join(dir, entry.name), "utf-8");
        const doc = parseDocFrontmatter(raw);
        doc.slug = slug;
        docs.push(doc);
      }
    }
  }

  walk(USER_GUIDE_DIR, "");
  return docs;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter web exec vitest run lib/docs.test.ts
```

Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/docs.ts apps/web/lib/docs.test.ts
git commit -m "feat(docs): add docs utility — frontmatter parsing, heading extraction, index building"
```

---

## Task 3: First content — Getting Started guide

**Files:**
- Create: `docs/user-guide/getting-started/index.md`
- Create: `docs/user-guide/getting-started/roles-and-access.md`
- Create: `docs/user-guide/getting-started/ai-coworker.md`

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p docs/user-guide/getting-started
```

- [ ] **Step 2: Create the Getting Started index page**

Create `docs/user-guide/getting-started/index.md`:

```markdown
---
title: "Getting Started"
area: getting-started
order: 1
lastUpdated: 2026-03-21
updatedBy: Claude (COO)
---

## Welcome to the Digital Product Factory

The Digital Product Factory (DPF) is an integrated platform for managing your organization's digital products, workforce, compliance, and operations — all in one place.

## What You Can Do

- **Portfolio Management** — Organize digital products into four portfolios with health metrics, investment tracking, and lifecycle management
- **HR & Workforce** — Manage employees, roles, reviews, timesheets, and organizational structure
- **Customer Relationship Management** — Track customer accounts, sales pipeline from lead to order, and engagement history
- **Compliance & Regulatory** — Onboard regulations and standards, map controls to obligations, collect evidence, and track compliance posture
- **Financial Management** — Create invoices, manage suppliers and bills, handle purchase orders
- **Enterprise Architecture** — Model your organization's application, technology, and business layers with ArchiMate notation
- **Storefront** — Set up a public-facing storefront for your products and services with booking, donations, and checkout
- **Build Studio** — Develop new features through a guided 5-phase pipeline with AI assistance
- **Operations** — Manage your delivery backlog with epics, priorities, and status tracking

## Navigation

The top navigation bar shows the areas you have access to based on your role:

| Nav Item | Area | What It's For |
|----------|------|---------------|
| My Workspace | Dashboard | Your daily view — calendar, activity feed, quick actions |
| Portfolio | Portfolio Management | View product portfolios, health metrics, investments |
| Backlog | Operations | Manage work items, epics, delivery priorities |
| Inventory | Product Inventory | Browse products, lifecycle stages, stage-gate readiness |
| EA Modeler | Enterprise Architecture | Architecture diagrams, reference models, value streams |
| AI Workforce | Platform & AI | Provider configuration, model routing, agent management |
| Build | Build Studio | Feature development pipeline |

Additional areas accessible via navigation within pages: Compliance, Finance, HR, Customers, Storefront, Admin.

## Your AI Coworker

Every page has an AI coworker available via the floating action button in the bottom-right corner. The coworker understands what page you're on and can help with page-specific tasks. See the [AI Coworker Guide](ai-coworker) for details.

## Next Steps

- [Roles & Access](roles-and-access) — Understand platform roles and what each one can do
- [AI Coworker](ai-coworker) — Learn how to work with the AI assistant
```

- [ ] **Step 3: Create the Roles & Access page**

Create `docs/user-guide/getting-started/roles-and-access.md`:

```markdown
---
title: "Roles & Access"
area: getting-started
order: 2
lastUpdated: 2026-03-21
updatedBy: Claude (COO)
---

## Platform Roles

Every user is assigned a platform role that determines what areas and actions they can access.

| Role | Access Level | Typical User |
|------|-------------|--------------|
| Admin | Full access to all areas including user management, branding, and settings | Platform administrator |
| Manager | Access to portfolios, operations, HR, customers, and compliance | Department heads, team leads |
| Member | Access to workspace, assigned products, and relevant operational areas | Team members, specialists |
| Viewer | Read-only access to assigned areas | Stakeholders, auditors |

## Superuser Status

Users with superuser status bypass all permission checks. This is intended for the initial platform setup and should be limited to one or two trusted administrators.

## Capabilities

Access is controlled by capabilities — specific permissions like `view_portfolio`, `manage_compliance`, or `manage_users`. Each role grants a set of capabilities. The admin can view the full capability matrix under Admin > Access.

## Customer Accounts

Customers who sign in through the storefront have a separate session type. They see the customer portal (not the internal shell) and can only access their own orders, bookings, and account information.
```

- [ ] **Step 4: Create the AI Coworker page**

Create `docs/user-guide/getting-started/ai-coworker.md`:

```markdown
---
title: "AI Coworker"
area: getting-started
order: 3
lastUpdated: 2026-03-21
updatedBy: Claude (COO)
---

## How It Works

The AI coworker is available on every page via the floating button in the bottom-right corner. It understands:

- **What page you're on** — it knows the domain context (compliance, HR, operations, etc.)
- **What data is visible** — it can read the current page's content
- **What actions are available** — it has tools specific to the current area

## Quick Actions

Each page has skill buttons that trigger common tasks. These appear at the top of the coworker panel when you open it. Examples:

- On the **Compliance** page: "Gap assessment", "Posture report", "Onboard a regulation"
- On the **Operations** page: "Create item", "Epic progress"
- On the **Portfolio** page: "Health summary", "Register a product"

## Universal Skills

Four skills appear on every page:

- **Analyze this page** — Get insights about what's on screen
- **Do this for me** — Perform the primary action for this page
- **Add a skill** — Extend the page with a new quick action
- **Evaluate this page** — Check the page for usability and accessibility issues

## Tips

- Be specific. "Show me overdue compliance actions" works better than "what's wrong?"
- The coworker can create backlog items, register products, assign roles, and more — it's not just a chatbot
- If the coworker proposes an action (like creating a record), you'll see an approval prompt before anything changes
- Each conversation is tied to the page context. If you switch pages, the coworker knows the new context
```

- [ ] **Step 5: Commit**

```bash
git add docs/user-guide/
git commit -m "docs(user-guide): add Getting Started guide — overview, roles, AI coworker"
```

---

## Task 4: Area index pages (one per platform area)

**Files:**
- Create: 11 index.md files under `docs/user-guide/`

- [ ] **Step 1: Create area directories**

```bash
mkdir -p docs/user-guide/{workspace,portfolios,products,architecture,hr,customers,compliance,finance,storefront,build-studio,operations,ai-workforce,admin}
```

- [ ] **Step 2: Create all area index pages**

Each area index follows the same pattern: title, description of what the area does, key concepts, and what you can do. Create these 11 files (getting-started already done in Task 3):

**`docs/user-guide/workspace/index.md`:**
```markdown
---
title: "Workspace"
area: workspace
order: 1
lastUpdated: 2026-03-21
updatedBy: Claude (COO)
---

## Overview

The workspace is your daily landing page. It shows a personalized view of what needs your attention across all platform areas.

## Key Features

- **Calendar** — View upcoming events, compliance deadlines, and scheduled activities
- **Activity Feed** — Recent actions across the platform, filtered by your role
- **Quick Actions** — One-click access to common tasks via the AI coworker

## Workspace Tiles

The workspace displays tiles for each area you have access to. Each tile shows a key metric — open items, health scores, or counts — giving you a quick pulse check without navigating away.
```

Create similar index pages for: `portfolios`, `products`, `architecture`, `hr`, `customers`, `compliance`, `finance`, `storefront`, `build-studio`, `operations`, `ai-workforce`, `admin`. Each should have 3-5 sections covering: Overview, Key Features/Concepts, and What You Can Do.

Content should be written from the perspective of a user who has never seen the platform. Describe what they see, what the terminology means, and what actions are available. Reference existing features only — don't describe planned/future functionality.

Consult the route-context-map.ts `domainContext` field for each area to understand what the area does. Consult the existing page components (e.g., `apps/web/app/(shell)/compliance/page.tsx`) for what metrics and features are actually displayed.

- [ ] **Step 3: Commit**

```bash
git add docs/user-guide/
git commit -m "docs(user-guide): add index pages for all 14 platform areas"
```

---

## Task 5: Docs page route and layout

**Files:**
- Create: `apps/web/app/(shell)/docs/[[...slug]]/page.tsx`
- Create: `apps/web/components/docs/DocsLayout.tsx`
- Create: `apps/web/components/docs/DocsSidebar.tsx`

- [ ] **Step 1: Create the docs page directory**

```bash
mkdir -p "apps/web/app/(shell)/docs/[[...slug]]"
```

- [ ] **Step 2: Create the catch-all docs page**

Create `apps/web/app/(shell)/docs/[[...slug]]/page.tsx`:

```tsx
// apps/web/app/(shell)/docs/[[...slug]]/page.tsx
import { notFound } from "next/navigation";
import { loadDocPage, loadAllDocs, buildDocsIndex, extractHeadings, AREA_META, AREA_ORDER, type DocsIndex } from "@/lib/docs";
import { DocsLayout } from "@/components/docs/DocsLayout";

type Props = {
  params: Promise<{ slug?: string[] }>;
};

export default async function DocsPage({ params }: Props) {
  const { slug } = await params;
  const allDocs = loadAllDocs();
  const index = buildDocsIndex(allDocs);

  // Strip content from sidebar data — only slug/title/area/order needed for navigation
  const sidebarIndex: DocsIndex = {};
  for (const [area, pages] of Object.entries(index)) {
    sidebarIndex[area] = pages.map((p) => ({ ...p, content: "" }));
  }

  // Search items — truncated content for Fuse.js
  const searchItems = allDocs.map((d) => ({
    slug: d.slug,
    title: d.title,
    area: d.area,
    content: d.content.slice(0, 500),
  }));

  // No slug = docs home page
  if (!slug || slug.length === 0) {
    return (
      <DocsLayout index={sidebarIndex} currentSlug="" searchItems={searchItems}>
        <DocsHome index={index} />
      </DocsLayout>
    );
  }

  const docSlug = slug.join("/");
  const doc = loadDocPage(docSlug);
  if (!doc) return notFound();

  // Extract headings server-side — pass structured data, not raw markdown
  const tocHeadings = extractHeadings(doc.content);

  return (
    <DocsLayout index={sidebarIndex} currentSlug={docSlug} searchItems={searchItems} headings={tocHeadings}>
      <DocContent doc={doc} />
    </DocsLayout>
  );
}

// ── Home page: area cards ───────────────────────────────────────────────────

function DocsHome({ index }: { index: Record<string, unknown[]> }) {
  return (
    <div>
      <h1 className="text-xl font-bold text-[var(--dpf-text)] mb-2">Documentation</h1>
      <p className="text-sm text-[var(--dpf-muted)] mb-6">
        Learn how to use every area of the platform.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {AREA_ORDER.map((areaKey) => {
          const meta = AREA_META[areaKey];
          if (!meta) return null;
          const pages = index[areaKey];
          const pageCount = pages?.length ?? 0;
          return (
            <a
              key={areaKey}
              href={`/docs/${areaKey}/index`}
              className="block p-4 rounded-lg border border-[var(--dpf-border)] hover:border-[var(--dpf-accent)] transition-colors"
            >
              <h2 className="text-sm font-semibold text-[var(--dpf-text)] mb-1">{meta.label}</h2>
              <p className="text-xs text-[var(--dpf-muted)]">{meta.description}</p>
              {pageCount > 0 && (
                <p className="text-[10px] text-[var(--dpf-muted)] mt-2">
                  {pageCount} page{pageCount !== 1 ? "s" : ""}
                </p>
              )}
            </a>
          );
        })}
      </div>
    </div>
  );
}

// ── Content renderer ────────────────────────────────────────────────────────

import { DocRenderer } from "@/components/docs/DocRenderer";

function DocContent({ doc }: { doc: { title: string; content: string; lastUpdated: string; updatedBy: string; area: string } }) {
  const areaLabel = AREA_META[doc.area]?.label ?? doc.area;
  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-2">
        <a href="/docs" className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]">Docs</a>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <a href={`/docs/${doc.area}/index`} className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]">{areaLabel}</a>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <span className="text-xs text-[var(--dpf-text)]">{doc.title}</span>
      </div>

      {/* Title */}
      <h1 className="text-xl font-bold text-[var(--dpf-text)] mb-1">{doc.title}</h1>
      <p className="text-[10px] text-[var(--dpf-muted)] mb-6">
        Updated {doc.lastUpdated} by {doc.updatedBy}
      </p>

      {/* Rendered markdown — currentArea resolves relative links */}
      <DocRenderer content={doc.content} currentArea={doc.area} />
    </div>
  );
}
```

- [ ] **Step 3: Create the DocRenderer component**

Create `apps/web/components/docs/DocRenderer.tsx`:

```tsx
// apps/web/components/docs/DocRenderer.tsx
// Server component — no "use client". Renders on server, zero client JS cost.

import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-");
}

/** Resolve relative markdown links against the current area. */
function resolveHref(href: string | undefined, currentArea: string): string {
  if (!href) return "#";
  if (href.startsWith("http")) return href;
  // Already absolute docs path
  if (href.startsWith("/")) return href;
  // Relative link (e.g. "ai-coworker") → resolve within current area
  return `/docs/${currentArea}/${href.replace(/\.md$/, "")}`;
}

function buildComponents(currentArea: string): Components {
  return {
    h2: ({ children }) => (
      <h2
        id={slugify(String(children))}
        className="text-base font-bold text-[var(--dpf-text)] mt-8 mb-3 pb-1 border-b border-[var(--dpf-border)]"
      >
        {children}
      </h2>
    ),
    h3: ({ children }) => (
      <h3
        id={slugify(String(children))}
        className="text-sm font-semibold text-[var(--dpf-text)] mt-6 mb-2"
      >
        {children}
      </h3>
    ),
    p: ({ children }) => (
      <p className="text-sm text-[var(--dpf-text)] leading-relaxed mb-3">{children}</p>
    ),
    ul: ({ children }) => (
      <ul className="text-sm text-[var(--dpf-text)] mb-3 ml-4 list-disc space-y-1">{children}</ul>
    ),
    ol: ({ children }) => (
      <ol className="text-sm text-[var(--dpf-text)] mb-3 ml-4 list-decimal space-y-1">{children}</ol>
    ),
    li: ({ children }) => <li className="leading-relaxed">{children}</li>,
    strong: ({ children }) => (
      <strong className="font-semibold text-[var(--dpf-text)]">{children}</strong>
    ),
    a: ({ href, children }) => (
      <a
        href={resolveHref(href, currentArea)}
        className="text-[var(--dpf-accent)] hover:underline"
        {...(href?.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      >
        {children}
      </a>
    ),
    code: ({ children, className }) => {
      const isBlock = className?.startsWith("language-");
      if (isBlock) {
        return (
          <pre className="text-xs bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded-md p-3 overflow-x-auto mb-3">
            <code>{children}</code>
          </pre>
        );
      }
      return (
        <code className="text-xs bg-[var(--dpf-surface-2)] px-1 py-0.5 rounded">{children}</code>
      );
    },
    table: ({ children }) => (
      <div className="overflow-x-auto mb-3">
        <table className="text-xs w-full border-collapse">{children}</table>
      </div>
    ),
    th: ({ children }) => (
      <th className="text-left px-2 py-1.5 border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] font-semibold text-[var(--dpf-text)]">
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className="px-2 py-1.5 border border-[var(--dpf-border)] text-[var(--dpf-muted)]">
        {children}
      </td>
    ),
    hr: () => <hr className="border-t border-[var(--dpf-border)] my-6" />,
  };
}

export function DocRenderer({ content, currentArea }: { content: string; currentArea: string }) {
  return (
    <div className="docs-content">
      <ReactMarkdown components={buildComponents(currentArea)}>{content}</ReactMarkdown>
    </div>
  );
}
```

- [ ] **Step 4: Create the DocsLayout component**

Create `apps/web/components/docs/DocsLayout.tsx`:

```tsx
// apps/web/components/docs/DocsLayout.tsx
"use client";

import { DocsSidebar } from "./DocsSidebar";
import { DocsSearch } from "./DocsSearch";
import type { DocHeading, DocsIndex } from "@/lib/docs";

type Props = {
  index: DocsIndex;
  currentSlug: string;
  searchItems: Array<{ slug: string; title: string; area: string; content: string }>;
  headings?: DocHeading[]; // pre-extracted server-side
  children: React.ReactNode;
};

export function DocsLayout({ index, currentSlug, searchItems, headings, children }: Props) {
  const tocHeadings = headings ?? [];

  return (
    <div className="flex gap-6 min-h-[calc(100vh-120px)]">
      {/* Left sidebar — search + area nav */}
      <div className="w-52 shrink-0 hidden lg:block">
        <DocsSearch items={searchItems} />
        <DocsSidebar index={index} currentSlug={currentSlug} />
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0 max-w-3xl">
        {children}
      </div>

      {/* Right sidebar — table of contents */}
      {tocHeadings.length > 0 && (
        <div className="w-44 shrink-0 hidden xl:block">
          <div className="sticky top-6">
            <p className="text-[10px] text-[var(--dpf-muted)] uppercase tracking-widest mb-2">On this page</p>
            <nav className="space-y-1">
              {tocHeadings.map((h) => (
                <a
                  key={h.slug}
                  href={`#${h.slug}`}
                  className={[
                    "block text-xs hover:text-[var(--dpf-text)] transition-colors",
                    h.level === 3 ? "pl-3 text-[var(--dpf-muted)]" : "text-[var(--dpf-muted)]",
                  ].join(" ")}
                >
                  {h.text}
                </a>
              ))}
            </nav>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Create the DocsSidebar component**

Create `apps/web/components/docs/DocsSidebar.tsx`:

```tsx
// apps/web/components/docs/DocsSidebar.tsx
"use client";

import Link from "next/link";
import { AREA_META, AREA_ORDER, type DocsIndex } from "@/lib/docs";

type Props = {
  index: DocsIndex;
  currentSlug: string;
};

export function DocsSidebar({ index, currentSlug }: Props) {
  const currentArea = currentSlug.split("/")[0] ?? "";

  return (
    <nav className="sticky top-6 space-y-4">
      <Link
        href="/docs"
        className="block text-xs font-semibold text-[var(--dpf-accent)] hover:underline mb-3"
      >
        All Docs
      </Link>

      {AREA_ORDER.map((areaKey) => {
        const meta = AREA_META[areaKey];
        if (!meta) return null;
        const pages = index[areaKey];
        if (!pages || pages.length === 0) return null;
        const isCurrentArea = currentArea === areaKey;

        return (
          <div key={areaKey}>
            <p
              className={[
                "text-[10px] uppercase tracking-widest mb-1",
                isCurrentArea ? "text-[var(--dpf-accent)]" : "text-[var(--dpf-muted)]",
              ].join(" ")}
            >
              {meta.label}
            </p>
            <ul className="space-y-0.5">
              {pages.map((page) => {
                const isActive = currentSlug === page.slug;
                return (
                  <li key={page.slug}>
                    <Link
                      href={`/docs/${page.slug}`}
                      className={[
                        "block text-xs py-0.5 px-2 rounded transition-colors",
                        isActive
                          ? "text-[var(--dpf-text)] bg-[var(--dpf-surface-2)]"
                          : "text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]",
                      ].join(" ")}
                    >
                      {page.title}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 6: Verify the page renders**

```bash
pnpm --filter web dev
```

Open `http://localhost:3000/docs` in a browser. Verify:
- Home page shows area cards with counts
- Clicking "Getting Started" shows the index page
- Sidebar navigation works
- Markdown renders correctly with headings, tables, lists, links
- Breadcrumb shows Docs / Getting Started / page title
- Table of contents shows on the right for pages with headings

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/\(shell\)/docs apps/web/components/docs/
git commit -m "feat(docs): add docs route, layout, sidebar, and markdown renderer"
```

---

## Task 6: Add "Docs" to shell navigation

**Files:**
- Modify: `apps/web/components/shell/Header.tsx`

- [ ] **Step 1: Add Docs nav item**

In `apps/web/components/shell/Header.tsx`, add to the `NAV_ITEMS` array after "Build":

```ts
{ label: "Docs",   href: "/docs",   capability: null },
```

The `capability: null` means all authenticated users can see Docs — no permission check needed.

- [ ] **Step 2: Verify navigation**

Open the app in a browser. Verify "Docs" appears in the top navigation bar and links to `/docs`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/shell/Header.tsx
git commit -m "feat(docs): add Docs link to shell navigation"
```

---

## Task 7: Search — client-side Fuse.js

**Files:**
- Create: `apps/web/components/docs/DocsSearch.tsx`

Note: `DocsLayout.tsx` already imports and renders `DocsSearch`, and `page.tsx` already passes `searchItems`. This task only creates the component.

- [ ] **Step 1: Create the DocsSearch component**

Create `apps/web/components/docs/DocsSearch.tsx`:

```tsx
// apps/web/components/docs/DocsSearch.tsx
"use client";

import { useState, useMemo } from "react";
import Fuse from "fuse.js";
import Link from "next/link";

type SearchItem = {
  slug: string;
  title: string;
  area: string;
  content: string;
};

type Props = {
  items: SearchItem[];
};

export function DocsSearch({ items }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const fuse = useMemo(
    () =>
      new Fuse(items, {
        keys: [
          { name: "title", weight: 2 },
          { name: "content", weight: 1 },
        ],
        threshold: 0.4,
        includeMatches: true,
      }),
    [items],
  );

  const results = query.length >= 2 ? fuse.search(query, { limit: 8 }) : [];

  return (
    <div className="relative mb-4">
      <input
        type="text"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        placeholder="Search docs..."
        className="w-full px-3 py-1.5 text-xs rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-[var(--dpf-text)] placeholder:text-[var(--dpf-muted)] focus:outline-none focus:border-[var(--dpf-accent)]"
      />
      {open && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] rounded-md shadow-lg z-50 max-h-64 overflow-y-auto">
          {results.map((r) => (
            <Link
              key={r.item.slug}
              href={`/docs/${r.item.slug}`}
              className="block px-3 py-2 text-xs hover:bg-[var(--dpf-surface-2)] transition-colors"
            >
              <span className="text-[var(--dpf-text)] font-medium">{r.item.title}</span>
              <span className="text-[var(--dpf-muted)] ml-2">{r.item.area}</span>
            </Link>
          ))}
        </div>
      )}
      {open && query.length >= 2 && results.length === 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] rounded-md shadow-lg z-50 p-3">
          <p className="text-xs text-[var(--dpf-muted)]">No results found.</p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify search works**

Open `/docs` in a browser. Type "compliance" in the search box. Verify matching doc pages appear in the dropdown.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/docs/DocsSearch.tsx
git commit -m "feat(docs): add Fuse.js search across documentation pages"
```

---

## Task 8: Contextual help links

**Files:**
- Create: `apps/web/components/docs/HelpLink.tsx`
- Modify: `apps/web/lib/route-context-map.ts`

- [ ] **Step 1: Create the HelpLink component**

Create `apps/web/components/docs/HelpLink.tsx`:

```tsx
// apps/web/components/docs/HelpLink.tsx
"use client";

import Link from "next/link";

type Props = {
  docsPath: string;
};

/** Small help icon that links to the relevant docs section. */
export function HelpLink({ docsPath }: Props) {
  return (
    <Link
      href={docsPath}
      title="View documentation"
      className="inline-flex items-center justify-center w-5 h-5 rounded-full border border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-accent)] hover:border-[var(--dpf-accent)] transition-colors text-[10px]"
    >
      ?
    </Link>
  );
}
```

- [ ] **Step 2: Add docsPath to route context map**

In `apps/web/lib/route-context-map.ts`, extend the `RouteContextDef` type:

```ts
export type RouteContextDef = {
  routePrefix: string;
  domain: string;
  sensitivity: SensitivityLevel;
  domainContext: string;
  domainTools: string[];
  docsPath?: string;  // ← add this
  skills: Array<{ ... }>;
};
```

Then add `docsPath` to each route entry. Examples:

```ts
"/portfolio": { ..., docsPath: "/docs/portfolios/index", ... },
"/inventory": { ..., docsPath: "/docs/products/index", ... },
"/ea":        { ..., docsPath: "/docs/architecture/index", ... },
"/employee":  { ..., docsPath: "/docs/hr/index", ... },
"/customer":  { ..., docsPath: "/docs/customers/index", ... },
"/ops":       { ..., docsPath: "/docs/operations/index", ... },
"/build":     { ..., docsPath: "/docs/build-studio/index", ... },
"/platform":  { ..., docsPath: "/docs/ai-workforce/index", ... },
"/admin":     { ..., docsPath: "/docs/admin/index", ... },
"/compliance":{ ..., docsPath: "/docs/compliance/index", ... },
"/workspace": { ..., docsPath: "/docs/workspace/index", ... },
```

- [ ] **Step 3: Add docs route context**

Add a new entry to `ROUTE_CONTEXT_MAP`:

```ts
"/docs": {
  routePrefix: "/docs",
  domain: "Documentation",
  sensitivity: "internal",
  docsPath: "/docs",
  domainContext:
    "This page displays the platform user documentation. Users can browse guides for all platform areas, search for topics, and read how-to content.",
  domainTools: [],
  skills: [
    {
      label: "Report an issue",
      description: "Report a bug or give feedback",
      capability: null,
      prompt: "I'd like to report an issue or give feedback about this page.",
    },
  ],
},
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/docs/HelpLink.tsx apps/web/lib/route-context-map.ts
git commit -m "feat(docs): add HelpLink component and docsPath to all route contexts"
```

---

## Task 9: Build verification

- [ ] **Step 1: Run all tests**

```bash
pnpm --filter web exec vitest run
```

Expected: All tests pass, including the new docs tests.

- [ ] **Step 2: Run the build**

```bash
pnpm --filter web build
```

Expected: Build succeeds. The docs catch-all route compiles. No TypeScript errors.

- [ ] **Step 3: Verify end-to-end**

Start dev server and verify:
1. "Docs" appears in top navigation
2. `/docs` shows area cards grid
3. Clicking an area loads the index page with sidebar
4. Markdown renders correctly (headings, tables, lists, bold, links)
5. Table of contents appears on right side for pages with headings
6. Search works — typing "compliance" shows relevant results
7. Internal links between doc pages work (e.g., Getting Started → AI Coworker)
8. Breadcrumbs show correct hierarchy

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat(docs): platform documentation system — EP-DOCS-001 complete"
```

---

## Deferred Items

These are spec requirements intentionally deferred to a follow-up task:

1. **`search_user_docs` MCP tool** — AI coworker integration to search docs and ground answers. Requires the docs content to exist first. Follow-up task after initial content is in place.
2. **Image/asset serving** — `docs/user-guide/assets/` for screenshots. Not needed until area content pages include visual guides.
3. **Index URL cleanup** — `/docs/compliance` instead of `/docs/compliance/index`. Requires adding fallback resolution in `loadDocPage`. Low priority.
