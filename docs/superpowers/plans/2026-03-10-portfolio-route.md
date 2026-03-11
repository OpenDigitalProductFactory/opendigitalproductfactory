# Portfolio Route Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the `/portfolio` route — a master/detail portfolio browser with a full 4-level taxonomy tree sidebar and server-rendered right panel, backed by PostgreSQL via Prisma.

**Architecture:** Catch-all optional route `[[...slug]]` under `app/(shell)/portfolio/`. A server-component layout loads the full taxonomy tree once per request (deduplicated via React `cache()`). A thin client component manages expand/collapse state, syncing to `?open=` via `window.history.replaceState`. The right panel is a server component that queries product detail for the selected node.

**Tech Stack:** Next.js 14 App Router, Prisma 5, TypeScript strict mode (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), Tailwind CSS, Auth.js v5, Vitest.

---

## Chunk 1: Data Layer

### Task 1: Schema Migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: migration via `pnpm db:migrate`

- [ ] **Step 1.1: Add `taxonomyNodeId` to `DigitalProduct` and the back-relation to `TaxonomyNode`**

Open `packages/db/prisma/schema.prisma`. Find the `DigitalProduct` model (around line 68) and add two lines. Find `TaxonomyNode` (around line 81) and add one line:

```prisma
model DigitalProduct {
  id             String        @id @default(cuid())
  productId      String        @unique
  name           String
  status         String        @default("active")
  portfolioId    String?
  portfolio      Portfolio?    @relation(fields: [portfolioId], references: [id])
  taxonomyNodeId String?                                                        // ADD
  taxonomyNode   TaxonomyNode? @relation(fields: [taxonomyNodeId], references: [id])  // ADD
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt
}

model TaxonomyNode {
  id          String         @id @default(cuid())
  nodeId      String         @unique
  name        String
  portfolioId String?
  parentId    String?
  parent      TaxonomyNode?  @relation("TaxonomyTree", fields: [parentId], references: [id])
  children    TaxonomyNode[] @relation("TaxonomyTree")
  products    DigitalProduct[]                                                  // ADD
  status      String         @default("active")
  governance  Json?
}
```

- [ ] **Step 1.2: Generate and run the migration**

```bash
pnpm db:migrate
```

When prompted for a migration name, enter: `add_taxonomy_node_to_digital_product`

Expected output:
```
Your database is now in sync with your schema.
```

- [ ] **Step 1.3: Regenerate the Prisma client**

```bash
pnpm db:generate
```

Expected: no errors, updated client in `node_modules/.prisma/client/`.

- [ ] **Step 1.4: Verify typecheck passes**

```bash
pnpm typecheck
```

Expected: `0 errors`.

- [ ] **Step 1.5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat: add taxonomyNodeId to DigitalProduct for taxonomy tree placement"
```

---

### Task 2: Portfolio Utility Library (TDD)

**Files:**
- Create: `apps/web/lib/portfolio.ts`
- Create: `apps/web/lib/portfolio.test.ts`

- [ ] **Step 2.1: Write the failing tests**

Create `apps/web/lib/portfolio.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildPortfolioTree, resolveNodeFromSlug } from "./portfolio";
import type { PortfolioTreeNode } from "./portfolio";

// Minimal fixture: 2 portfolio roots, one with a 2-level subtree
const NODES = [
  { id: "root1", nodeId: "foundational",          name: "Foundational",      parentId: null,    portfolioId: "port1" },
  { id: "l1a",   nodeId: "foundational/compute",   name: "Compute",           parentId: "root1", portfolioId: null },
  { id: "l2a",   nodeId: "foundational/compute/physical-compute", name: "Physical Compute", parentId: "l1a", portfolioId: null },
  { id: "l1b",   nodeId: "foundational/platform-services", name: "Platform Services", parentId: "root1", portfolioId: null },
  { id: "root2", nodeId: "for_employees",          name: "For Employees",     parentId: null,    portfolioId: "port2" },
];

const COUNTS = [
  { taxonomyNodeId: "l2a",  _count: { id: 3 } },
  { taxonomyNodeId: "l1b",  _count: { id: 2 } },
  { taxonomyNodeId: null,   _count: { id: 1 } }, // unclassified — must be ignored
];

describe("buildPortfolioTree()", () => {
  it("returns one root node per portfolio", () => {
    const tree = buildPortfolioTree(NODES, COUNTS);
    expect(tree).toHaveLength(2);
  });

  it("wires parent-child relationships correctly", () => {
    const tree = buildPortfolioTree(NODES, COUNTS);
    const foundational = tree.find((n) => n.nodeId === "foundational")!;
    expect(foundational.children).toHaveLength(2);
    const compute = foundational.children.find((n) => n.nodeId === "foundational/compute")!;
    expect(compute.children).toHaveLength(1);
    expect(compute.children[0]!.nodeId).toBe("foundational/compute/physical-compute");
  });

  it("assigns direct product counts to leaf nodes", () => {
    const tree = buildPortfolioTree(NODES, COUNTS);
    const foundational = tree.find((n) => n.nodeId === "foundational")!;
    const l1b = foundational.children.find((n) => n.nodeId === "foundational/platform-services")!;
    expect(l1b.directCount).toBe(2);
  });

  it("rolls product counts up to parent nodes", () => {
    const tree = buildPortfolioTree(NODES, COUNTS);
    const foundational = tree.find((n) => n.nodeId === "foundational")!;
    const compute = foundational.children.find((n) => n.nodeId === "foundational/compute")!;
    expect(compute.directCount).toBe(0);
    expect(compute.totalCount).toBe(3); // 0 direct + 3 from l2a
    expect(foundational.totalCount).toBe(5); // 3 (compute subtree) + 2 (l1b)
  });

  it("nodes with no products get totalCount 0", () => {
    const tree = buildPortfolioTree(NODES, []);
    const foundational = tree.find((n) => n.nodeId === "foundational")!;
    expect(foundational.totalCount).toBe(0);
    expect(tree.find((n) => n.nodeId === "for_employees")!.totalCount).toBe(0);
  });

  it("ignores count rows with null taxonomyNodeId", () => {
    // The fixture COUNTS includes a null-key row; total should still be 5
    const tree = buildPortfolioTree(NODES, COUNTS);
    const foundational = tree.find((n) => n.nodeId === "foundational")!;
    expect(foundational.totalCount).toBe(5);
  });
});

describe("resolveNodeFromSlug()", () => {
  it("resolves a portfolio root from a single-element slug array", () => {
    const tree = buildPortfolioTree(NODES, COUNTS);
    const node = resolveNodeFromSlug(tree, ["foundational"]);
    expect(node?.nodeId).toBe("foundational");
  });

  it("resolves a deep path across multiple slug segments", () => {
    const tree = buildPortfolioTree(NODES, COUNTS);
    const node = resolveNodeFromSlug(tree, ["foundational", "compute", "physical-compute"]);
    expect(node?.nodeId).toBe("foundational/compute/physical-compute");
  });

  it("returns null for an unknown portfolio slug", () => {
    const tree = buildPortfolioTree(NODES, COUNTS);
    expect(resolveNodeFromSlug(tree, ["unknown"])).toBeNull();
  });

  it("returns null for a valid root but unknown child slug", () => {
    const tree = buildPortfolioTree(NODES, COUNTS);
    expect(resolveNodeFromSlug(tree, ["foundational", "unknown-domain"])).toBeNull();
  });

  it("returns null for an empty slug array", () => {
    const tree = buildPortfolioTree(NODES, COUNTS);
    expect(resolveNodeFromSlug(tree, [])).toBeNull();
  });
});
```

- [ ] **Step 2.2: Run the tests to confirm they fail**

```bash
cd apps/web && pnpm test -- lib/portfolio.test.ts
```

Expected: FAIL — `Cannot find module './portfolio'`

- [ ] **Step 2.3: Implement `apps/web/lib/portfolio.ts`**

```ts
// apps/web/lib/portfolio.ts

export type PortfolioTreeNode = {
  id: string;
  nodeId: string;        // globally unique path slug: "foundational" | "foundational/compute" | …
  name: string;
  parentId: string | null;
  portfolioId: string | null;
  directCount: number;   // products directly placed at this node
  totalCount: number;    // products in this node + all descendants
  children: PortfolioTreeNode[];
};

// Static maps — avoid DB queries for stable metadata
export const PORTFOLIO_COLOURS: Record<string, string> = {
  foundational:              "#7c8cf8",
  manufacturing_and_delivery: "#fb923c",
  for_employees:             "#a78bfa",
  products_and_services_sold: "#f472b6",
};

export const PORTFOLIO_OWNER_ROLES: Record<string, string> = {
  foundational:              "HR-300",
  manufacturing_and_delivery: "HR-500",
  for_employees:             "HR-200",
  products_and_services_sold: "HR-100",
};

type RawNode = {
  id: string;
  nodeId: string;
  name: string;
  parentId: string | null;
  portfolioId: string | null;
};

type CountRow = {
  taxonomyNodeId: string | null;
  _count: { id: number };
};

export function buildPortfolioTree(
  nodes: RawNode[],
  counts: CountRow[]
): PortfolioTreeNode[] {
  // Build direct-count lookup: TaxonomyNode.id (cuid) → product count
  const countMap = new Map<string, number>();
  for (const c of counts) {
    if (c.taxonomyNodeId !== null) {
      countMap.set(c.taxonomyNodeId, c._count.id);
    }
  }

  // Initialise tree nodes
  const nodeMap = new Map<string, PortfolioTreeNode>();
  for (const n of nodes) {
    nodeMap.set(n.id, {
      id: n.id,
      nodeId: n.nodeId,
      name: n.name,
      parentId: n.parentId,
      portfolioId: n.portfolioId,
      directCount: countMap.get(n.id) ?? 0,
      totalCount: 0,
      children: [],
    });
  }

  // Wire parent → child and collect roots
  const roots: PortfolioTreeNode[] = [];
  for (const node of nodeMap.values()) {
    if (node.parentId === null) {
      roots.push(node);
    } else {
      const parent = nodeMap.get(node.parentId);
      if (parent) parent.children.push(node);
    }
  }

  // Roll counts upward (post-order DFS)
  function rollUp(node: PortfolioTreeNode): number {
    let total = node.directCount;
    for (const child of node.children) {
      total += rollUp(child);
    }
    node.totalCount = total;
    return total;
  }
  for (const root of roots) rollUp(root);

  return roots;
}

/**
 * Resolve a URL slug array to the matching tree node.
 * Slugs are URL segments: ["foundational", "compute", "physical-compute"]
 * nodeId is the slash-joined path: "foundational/compute/physical-compute"
 */
export function resolveNodeFromSlug(
  roots: PortfolioTreeNode[],
  slugs: string[]
): PortfolioTreeNode | null {
  if (slugs.length === 0) return null;

  let current: PortfolioTreeNode | undefined = roots.find(
    (r) => r.nodeId === slugs[0]
  );
  if (!current) return null;

  for (let i = 1; i < slugs.length; i++) {
    const targetNodeId = slugs.slice(0, i + 1).join("/");
    current = current.children.find((c) => c.nodeId === targetNodeId);
    if (!current) return null;
  }

  return current;
}

/** Collect the cuid IDs of a node and all its descendants (for product queries). */
export function getSubtreeIds(nodes: PortfolioTreeNode[]): string[] {
  return nodes.flatMap((n) => [n.id, ...getSubtreeIds(n.children)]);
}

/** Build breadcrumb array of ancestors (excludes the current/selected node). */
export function buildBreadcrumbs(
  roots: PortfolioTreeNode[],
  slugs: string[]
): Array<{ nodeId: string; name: string }> {
  const breadcrumbs: Array<{ nodeId: string; name: string }> = [];
  let current: PortfolioTreeNode | undefined;
  // Stop before the last slug — the current node is rendered as the <h1>, not in the trail
  for (let i = 0; i < slugs.length - 1; i++) {
    const targetNodeId = slugs.slice(0, i + 1).join("/");
    if (i === 0) {
      current = roots.find((r) => r.nodeId === slugs[0]);
    } else {
      current = current?.children.find((c) => c.nodeId === targetNodeId);
    }
    if (current) breadcrumbs.push({ nodeId: current.nodeId, name: current.name });
  }
  return breadcrumbs;
}
```

- [ ] **Step 2.4: Run the tests — all must pass**

```bash
cd apps/web && pnpm test -- lib/portfolio.test.ts
```

Expected:
```
✓ lib/portfolio.test.ts (11)
  ✓ buildPortfolioTree() (6)
  ✓ resolveNodeFromSlug() (5)
11 tests passed
```

- [ ] **Step 2.5: Run full typecheck**

```bash
pnpm typecheck
```

Expected: `0 errors`.

- [ ] **Step 2.6: Commit**

```bash
git add apps/web/lib/portfolio.ts apps/web/lib/portfolio.test.ts
git commit -m "feat: add portfolio tree builder and slug resolver utilities"
```

---

### Task 3: Taxonomy Data and Seeding

**Files:**
- Create: `packages/db/data/taxonomy_v2.json` (generated from old project CSV)
- Create: `packages/db/scripts/generate-taxonomy-json.ts` (one-time generator)
- Modify: `packages/db/src/seed.ts`

- [ ] **Step 3.1: Create the taxonomy data directory**

```bash
mkdir -p packages/db/data
mkdir -p packages/db/scripts
```

- [ ] **Step 3.2: Create the JSON generator script**

Create `packages/db/scripts/generate-taxonomy-json.ts`:

```ts
// One-time script: reads taxonomy_v2.csv from the old project and writes
// packages/db/data/taxonomy_v2.json for use by seed.ts.
// Run: npx tsx packages/db/scripts/generate-taxonomy-json.ts
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const CSV_PATH = "D:/digital-product-factory/PORTFOLIOS/taxonomy_v2.csv";

function parseQuotedCsv(content: string): Array<Record<string, string>> {
  const lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const nonEmpty = lines.filter((l) => l.trim().length > 0);
  if (nonEmpty.length === 0) return [];
  const [headerLine, ...dataLines] = nonEmpty as [string, ...string[]];
  const headers = parseCsvLine(headerLine);

  return dataLines.map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(
      headers.map((h, i) => [h.trim(), (values[i] ?? "").trim()])
    ) as Record<string, string>;
  });
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

const content = readFileSync(CSV_PATH, "utf-8");
const rows = parseQuotedCsv(content);

const out = rows.map((r) => ({
  portfolio_id: r["portfolio_id"] ?? "",
  level_1: r["level_1"] ?? "",
  level_2: r["level_2"] ?? "",
  level_3: r["level_3"] ?? "",
}));

const outPath = join(__dirname, "..", "data", "taxonomy_v2.json");
writeFileSync(outPath, JSON.stringify(out, null, 2), "utf-8");
console.log(`Wrote ${out.length} rows to ${outPath}`);
```

- [ ] **Step 3.3: Run the generator to produce the JSON**

```bash
npx tsx packages/db/scripts/generate-taxonomy-json.ts
```

Expected:
```
Wrote 378 rows to …/packages/db/data/taxonomy_v2.json
```

If the old project is not available at `D:/digital-product-factory/`, create an empty file instead and the seed will skip taxonomy seeding gracefully:

```bash
echo "[]" > packages/db/data/taxonomy_v2.json
```

- [ ] **Step 3.4: Add `seedTaxonomyNodes()` to `packages/db/src/seed.ts`**

Add the helper function `toSlug` and `seedTaxonomyNodes` before the `main()` function. Also add `seedTaxonomyNodes()` call inside `main()`.

Add `import { join } from "path"` if not already present (it is already in scope via existing `REPO_ROOT`).

Insert after line 135 (after `seedDigitalProducts`), before `seedDefaultAdminUser`:

```ts
function toSlug(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function seedTaxonomyNodes(): Promise<void> {
  const dataPath = join(__dirname, "..", "data", "taxonomy_v2.json");
  type TaxRow = { portfolio_id: string; level_1: string; level_2: string; level_3: string };
  let rows: TaxRow[];
  try {
    rows = JSON.parse(readFileSync(dataPath, "utf-8")) as TaxRow[];
  } catch {
    console.log("taxonomy_v2.json not found — skipping taxonomy seeding");
    return;
  }

  if (rows.length === 0) {
    console.log("taxonomy_v2.json is empty — skipping taxonomy seeding");
    return;
  }

  // Get all portfolios (must be seeded first)
  const portfolios = await prisma.portfolio.findMany({ select: { id: true, slug: true, name: true } });
  const portfolioMap = new Map(portfolios.map((p) => [p.slug, p]));

  // nodeId (slug path) → TaxonomyNode.id (cuid)
  const nodeIdMap = new Map<string, string>();

  // 1. Portfolio root nodes
  for (const p of portfolios) {
    const node = await prisma.taxonomyNode.upsert({
      where: { nodeId: p.slug },
      update: { name: p.name, portfolioId: p.id, parentId: null },
      create: { nodeId: p.slug, name: p.name, portfolioId: p.id, parentId: null, status: "active" },
    });
    nodeIdMap.set(p.slug, node.id);
  }

  // 2. L1 capability domains
  const l1Seen = new Set<string>();
  for (const row of rows) {
    if (!row.level_1) continue;
    const l1NodeId = `${row.portfolio_id}/${toSlug(row.level_1)}`;
    if (l1Seen.has(l1NodeId)) continue;
    l1Seen.add(l1NodeId);
    const parentId = nodeIdMap.get(row.portfolio_id);
    if (!parentId) continue;
    const node = await prisma.taxonomyNode.upsert({
      where: { nodeId: l1NodeId },
      update: { name: row.level_1, parentId },
      create: { nodeId: l1NodeId, name: row.level_1, parentId, portfolioId: null, status: "active" },
    });
    nodeIdMap.set(l1NodeId, node.id);
  }

  // 3. L2 functional groups
  const l2Seen = new Set<string>();
  for (const row of rows) {
    if (!row.level_1 || !row.level_2) continue;
    const l1NodeId = `${row.portfolio_id}/${toSlug(row.level_1)}`;
    const l2NodeId = `${l1NodeId}/${toSlug(row.level_2)}`;
    if (l2Seen.has(l2NodeId)) continue;
    l2Seen.add(l2NodeId);
    const parentId = nodeIdMap.get(l1NodeId);
    if (!parentId) continue;
    const node = await prisma.taxonomyNode.upsert({
      where: { nodeId: l2NodeId },
      update: { name: row.level_2, parentId },
      create: { nodeId: l2NodeId, name: row.level_2, parentId, portfolioId: null, status: "active" },
    });
    nodeIdMap.set(l2NodeId, node.id);
  }

  // 4. L3 specialisations (sparse)
  const l3Seen = new Set<string>();
  for (const row of rows) {
    if (!row.level_1 || !row.level_2 || !row.level_3) continue;
    const l2NodeId = `${row.portfolio_id}/${toSlug(row.level_1)}/${toSlug(row.level_2)}`;
    const l3NodeId = `${l2NodeId}/${toSlug(row.level_3)}`;
    if (l3Seen.has(l3NodeId)) continue;
    l3Seen.add(l3NodeId);
    const parentId = nodeIdMap.get(l2NodeId);
    if (!parentId) continue;
    await prisma.taxonomyNode.upsert({
      where: { nodeId: l3NodeId },
      update: { name: row.level_3, parentId },
      create: { nodeId: l3NodeId, name: row.level_3, parentId, portfolioId: null, status: "active" },
    });
  }

  console.log(`Seeded ${nodeIdMap.size} taxonomy nodes`);
}
```

Update `main()` to call `seedTaxonomyNodes()` after `seedPortfolios()` (portfolios must exist before taxonomy roots):

```ts
async function main(): Promise<void> {
  console.log("Starting seed...");
  await seedRoles();
  await seedAgents();
  await seedPortfolios();
  await seedTaxonomyNodes();   // ADD — must come after seedPortfolios
  await seedDigitalProducts();
  await seedDefaultAdminUser();
  console.log("Seed complete.");
}
```

- [ ] **Step 3.5: Run the seed**

```bash
pnpm db:seed
```

Expected (with taxonomy data):
```
Starting seed...
Seeded 6 platform roles
Seeded 40 agents
Seeded 4 portfolios
Seeded 383 taxonomy nodes
Seeded N digital products
...
Seed complete.
```

- [ ] **Step 3.6: Typecheck**

```bash
pnpm typecheck
```

Expected: `0 errors`.

- [ ] **Step 3.7: Commit**

```bash
git add packages/db/src/seed.ts packages/db/data/ packages/db/scripts/
git commit -m "feat: seed 4-level portfolio taxonomy tree from taxonomy_v2.json"
```

---

## Chunk 2: UI Layer

### Task 4: Cached Tree Data Helper

**Files:**
- Create: `apps/web/lib/portfolio-data.ts`

- [ ] **Step 4.1: Create the server-side cached tree loader**

Create `apps/web/lib/portfolio-data.ts`:

```ts
// apps/web/lib/portfolio-data.ts
// Server-only: uses React cache() to deduplicate Prisma calls within one request.
// Both layout.tsx and page.tsx call getPortfolioTree() — React deduplicates automatically.
import { cache } from "react";
import { prisma } from "@dpf/db";
import { buildPortfolioTree } from "./portfolio";

export const getPortfolioTree = cache(async () => {
  const [nodes, counts] = await Promise.all([
    prisma.taxonomyNode.findMany({
      where: { status: "active" },
      select: { id: true, nodeId: true, name: true, parentId: true, portfolioId: true },
    }),
    prisma.digitalProduct.groupBy({
      by: ["taxonomyNodeId"],
      _count: { id: true },
      where: { status: "active" },
    }),
  ]);
  return buildPortfolioTree(nodes, counts);
});
```

- [ ] **Step 4.2: Typecheck**

```bash
pnpm typecheck
```

Expected: `0 errors`.

---

### Task 5: Portfolio Layout

**Files:**
- Create: `apps/web/app/(shell)/portfolio/layout.tsx`

- [ ] **Step 5.1: Create the portfolio layout**

Create `apps/web/app/(shell)/portfolio/layout.tsx`:

```tsx
// apps/web/app/(shell)/portfolio/layout.tsx
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getPortfolioTree } from "@/lib/portfolio-data";
import { PortfolioTree } from "@/components/portfolio/PortfolioTree";

export default async function PortfolioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (
    !session?.user ||
    !can(
      { platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser },
      "view_portfolio"
    )
  ) {
    notFound();
  }

  const roots = await getPortfolioTree();

  // Layout cannot access searchParams — PortfolioTree reads ?open= from window.location
  // client-side on mount (brief collapse flash is acceptable).
  return (
    <div className="flex gap-0 -m-6 h-[calc(100vh-57px)] overflow-hidden">
      {/* Sidebar */}
      <div className="w-56 flex-shrink-0 border-r border-[var(--dpf-border)] overflow-y-auto bg-[var(--dpf-bg)]">
        <PortfolioTree roots={roots} />
      </div>
      {/* Content panel */}
      <div className="flex-1 overflow-y-auto p-6">{children}</div>
    </div>
  );
}
```

Note: `57px` is the header height (matches the `<Header>` component in the shell layout). Adjust if the header height differs.

- [ ] **Step 5.2: Typecheck**

```bash
pnpm typecheck
```

Expected: compile errors for missing `PortfolioTree` component — that's expected. Proceed to Task 6.

---

### Task 6: PortfolioTree and PortfolioTreeNode Components

**Files:**
- Create: `apps/web/components/portfolio/PortfolioTree.tsx`
- Create: `apps/web/components/portfolio/PortfolioTreeNode.tsx`

- [ ] **Step 6.1: Create `PortfolioTreeNode.tsx`**

Create `apps/web/components/portfolio/PortfolioTreeNode.tsx`:

```tsx
// apps/web/components/portfolio/PortfolioTreeNode.tsx
"use client";
import Link from "next/link";
import type { PortfolioTreeNode } from "@/lib/portfolio";
import { PORTFOLIO_COLOURS } from "@/lib/portfolio";

// Left-padding per depth level (px)
const DEPTH_PADDING = [12, 24, 36, 48] as const;

type Props = {
  node: PortfolioTreeNode;
  depth: number;
  openIds: Set<string>;
  activeNodeId: string | null;
  onToggle: (nodeId: string) => void;
};

export function PortfolioTreeNodeItem({
  node,
  depth,
  openIds,
  activeNodeId,
  onToggle,
}: Props) {
  const isOpen = openIds.has(node.nodeId);
  const isActive = activeNodeId === node.nodeId;
  const hasChildren = node.children.length > 0;
  const href = `/portfolio/${node.nodeId}`;

  // Portfolio roots use their accent colour; deeper nodes inherit muted styling
  const colour =
    depth === 0 ? (PORTFOLIO_COLOURS[node.nodeId] ?? "#7c8cf8") : undefined;

  const pl = `${DEPTH_PADDING[Math.min(depth, 3)] ?? 48}px`;

  return (
    <>
      <div
        className={`flex items-center pr-3 py-1 border-l-2 transition-colors ${
          isActive
            ? "bg-[var(--dpf-surface-1)]"
            : "border-l-transparent hover:bg-[var(--dpf-surface-2)]"
        }`}
        style={{
          paddingLeft: pl,
          borderLeftColor: isActive ? (colour ?? "var(--dpf-accent)") : "transparent",
        }}
      >
        {/* Expand/collapse chevron */}
        <button
          className="w-4 flex-shrink-0 text-[9px] text-[var(--dpf-muted)] hover:text-white mr-1"
          onClick={() => hasChildren && onToggle(node.nodeId)}
          aria-label={isOpen ? "Collapse" : "Expand"}
          tabIndex={hasChildren ? 0 : -1}
        >
          {hasChildren ? (isOpen ? "▼" : "▶") : ""}
        </button>

        {/* Node name — navigates */}
        <Link
          href={href}
          className="flex-1 min-w-0 flex items-center justify-between gap-1"
        >
          <span
            className={`truncate ${depth === 0 ? "text-sm font-semibold" : "text-xs"}`}
            style={{ color: isActive ? (colour ?? "#e2e2f0") : (colour ?? "#e2e2f0") }}
          >
            {node.name}
          </span>
          {node.totalCount > 0 && (
            <span
              className="text-[8px] px-1.5 py-0.5 rounded-full flex-shrink-0"
              style={{
                background: `${colour ?? "#7c8cf8"}20`,
                color: colour ?? "#7c8cf8",
              }}
            >
              {node.totalCount}
            </span>
          )}
        </Link>
      </div>

      {/* Children (rendered when open) */}
      {isOpen &&
        node.children.map((child) => (
          <PortfolioTreeNodeItem
            key={child.nodeId}
            node={child}
            depth={depth + 1}
            openIds={openIds}
            activeNodeId={activeNodeId}
            onToggle={onToggle}
          />
        ))}
    </>
  );
}
```

- [ ] **Step 6.2: Create `PortfolioTree.tsx`**

Create `apps/web/components/portfolio/PortfolioTree.tsx`:

```tsx
// apps/web/components/portfolio/PortfolioTree.tsx
"use client";
import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import type { PortfolioTreeNode } from "@/lib/portfolio";
import { PortfolioTreeNodeItem } from "./PortfolioTreeNode";

type Props = {
  roots: PortfolioTreeNode[];
};

export function PortfolioTree({ roots }: Props) {
  // Start collapsed; read ?open= from URL on mount to restore state
  const [openIds, setOpenIds] = useState<Set<string>>(new Set<string>());
  const pathname = usePathname();

  useEffect(() => {
    const open = new URLSearchParams(window.location.search).get("open");
    if (open) {
      setOpenIds(new Set(open.split(",")));
    }
  }, []);

  // Derive active nodeId from pathname: /portfolio/foundational/compute → "foundational/compute"
  const activeNodeId = pathname.startsWith("/portfolio/")
    ? pathname.slice("/portfolio/".length)
    : null;

  function toggle(nodeId: string) {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      // Sync to URL without triggering a server re-render
      const url = new URL(window.location.href);
      if (next.size > 0) {
        url.searchParams.set("open", [...next].join(","));
      } else {
        url.searchParams.delete("open");
      }
      window.history.replaceState(null, "", url.toString());
      return next;
    });
  }

  return (
    <nav className="py-2" aria-label="Portfolio navigation">
      {roots.map((root, i) => (
        <div key={root.nodeId}>
          {i > 0 && (
            <div className="border-t border-[var(--dpf-border)] my-1.5 mx-3" />
          )}
          <PortfolioTreeNodeItem
            node={root}
            depth={0}
            openIds={openIds}
            activeNodeId={activeNodeId}
            onToggle={toggle}
          />
        </div>
      ))}
    </nav>
  );
}
```

- [ ] **Step 6.3: Typecheck**

```bash
pnpm typecheck
```

Expected: errors for missing right-panel components — proceed.

---

### Task 7: Right Panel Components

**Files:**
- Create: `apps/web/components/portfolio/ProductList.tsx`
- Create: `apps/web/components/portfolio/PortfolioNodeDetail.tsx`
- Create: `apps/web/components/portfolio/PortfolioOverview.tsx`

- [ ] **Step 7.1: Create `ProductList.tsx`**

Create `apps/web/components/portfolio/ProductList.tsx`:

```tsx
// apps/web/components/portfolio/ProductList.tsx
type Product = {
  id: string;
  productId: string;
  name: string;
  status: string;
};

type Props = {
  products: Product[];
  colour: string;
  className?: string;
};

const STATUS_COLOURS: Record<string, string> = {
  active:  "#4ade80",
  review:  "#fb923c",
  retired: "#555566",
  idea:    "#a78bfa",
};

export function ProductList({ products, colour, className = "" }: Props) {
  return (
    <div className={className}>
      <p className="text-[10px] text-[var(--dpf-muted)] uppercase tracking-widest mb-2">
        Digital Products &amp; Services
      </p>
      <div className="flex flex-col gap-2">
        {products.map((product) => {
          const statusColour = STATUS_COLOURS[product.status] ?? "#555566";
          return (
            <div
              key={product.id}
              className="bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] rounded-lg px-3 py-2.5"
            >
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-sm font-medium text-white">{product.name}</span>
                <span
                  className="text-[9px] px-1.5 py-0.5 rounded-full"
                  style={{ background: `${statusColour}20`, color: statusColour }}
                >
                  {product.status}
                </span>
              </div>
              <p className="text-[10px] text-[var(--dpf-muted)]">{product.productId}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 7.2: Create `PortfolioNodeDetail.tsx`**

Create `apps/web/components/portfolio/PortfolioNodeDetail.tsx`:

```tsx
// apps/web/components/portfolio/PortfolioNodeDetail.tsx
import Link from "next/link";
import type { PortfolioTreeNode } from "@/lib/portfolio";
import { PORTFOLIO_COLOURS, PORTFOLIO_OWNER_ROLES } from "@/lib/portfolio";
import { ProductList } from "./ProductList";

type Product = { id: string; productId: string; name: string; status: string };

type Props = {
  node: PortfolioTreeNode;
  subNodes: PortfolioTreeNode[];
  products: Product[];
  breadcrumbs: Array<{ nodeId: string; name: string }>;
};

function getRootSlug(nodeId: string): string {
  return nodeId.split("/")[0] ?? nodeId;
}

export function PortfolioNodeDetail({
  node,
  subNodes,
  products,
  breadcrumbs,
}: Props) {
  const rootSlug = getRootSlug(node.nodeId);
  const colour = PORTFOLIO_COLOURS[rootSlug] ?? "#7c8cf8";
  const ownerRole = PORTFOLIO_OWNER_ROLES[rootSlug] ?? "—";
  const subLabel = node.parentId === null ? "Capability Domains" : "Functional Groups";

  return (
    <div>
      {/* Breadcrumb */}
      <nav className="flex flex-wrap items-center gap-1 text-xs text-[var(--dpf-muted)] mb-4">
        <Link href="/portfolio" className="hover:text-white transition-colors">
          Portfolio
        </Link>
        {breadcrumbs.map((bc) => (
          <span key={bc.nodeId} className="flex items-center gap-1">
            <span>›</span>
            <Link
              href={`/portfolio/${bc.nodeId}`}
              className="hover:text-white transition-colors"
            >
              {bc.name}
            </Link>
          </span>
        ))}
      </nav>

      {/* Title */}
      <div className="flex items-baseline gap-3 mb-5">
        <h1 className="text-xl font-bold text-white">{node.name}</h1>
        <span className="text-sm" style={{ color: colour }}>
          {node.totalCount} products
        </span>
      </div>

      {/* Stats strip */}
      <div className="flex flex-wrap gap-3 mb-6">
        <StatBox label="Products" value={String(node.totalCount)} colour="#e2e2f0" />
        <StatBox label="Owner" value={ownerRole} colour={colour} />
        <StatBox label="Agents" value="—" colour="#555566" dashed />
        <StatBox label="Health" value="—" colour="#555566" dashed />
        <StatBox label="Investment" value="—" colour="#555566" dashed />
      </div>

      {/* Sub-nodes */}
      {subNodes.length > 0 && (
        <div className="mb-6">
          <p className="text-[10px] text-[var(--dpf-muted)] uppercase tracking-widest mb-2">
            {subLabel}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {subNodes.map((child) => (
              <Link
                key={child.nodeId}
                href={`/portfolio/${child.nodeId}`}
                className="flex items-center justify-between p-3 bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] rounded-lg hover:bg-[var(--dpf-surface-2)] transition-colors"
              >
                <span className="text-sm text-[#e2e2f0]">{child.name}</span>
                {child.totalCount > 0 && (
                  <span
                    className="text-[9px] px-2 py-0.5 rounded-full"
                    style={{ background: `${colour}20`, color: colour }}
                  >
                    {child.totalCount}
                  </span>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Products */}
      {products.length > 0 && (
        <ProductList products={products} colour={colour} />
      )}

      {/* Empty state */}
      {subNodes.length === 0 && products.length === 0 && (
        <p className="text-sm text-[var(--dpf-muted)]">
          No products classified here yet.
        </p>
      )}

      {/* People + Agents placeholders */}
      <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <PlaceholderPanel label="People" description="Human role assignments — coming soon" />
        <PlaceholderPanel label="Agents" description="AI agent assignments — coming soon" />
      </div>
    </div>
  );
}

function StatBox({
  label,
  value,
  colour,
  dashed = false,
}: {
  label: string;
  value: string;
  colour: string;
  dashed?: boolean;
}) {
  return (
    <div
      className={`bg-[var(--dpf-surface-1)] rounded-lg px-4 py-2.5 text-center ${
        dashed ? "border border-dashed border-[var(--dpf-border)] opacity-40" : "border border-[var(--dpf-border)]"
      }`}
    >
      <p className="text-sm font-bold" style={{ color }}>
        {value}
      </p>
      <p className="text-[9px] text-[var(--dpf-muted)] uppercase tracking-widest">
        {label}
      </p>
    </div>
  );
}

function PlaceholderPanel({
  label,
  description,
}: {
  label: string;
  description: string;
}) {
  return (
    <div className="bg-[var(--dpf-surface-1)] border border-dashed border-[var(--dpf-border)] rounded-lg p-4 opacity-50">
      <p className="text-[9px] text-[var(--dpf-muted)] uppercase tracking-widest mb-1">
        {label}
      </p>
      <p className="text-xs text-[var(--dpf-muted)]">{description}</p>
    </div>
  );
}
```

- [ ] **Step 7.3: Create `PortfolioOverview.tsx`**

Create `apps/web/components/portfolio/PortfolioOverview.tsx`:

```tsx
// apps/web/components/portfolio/PortfolioOverview.tsx
import Link from "next/link";
import type { PortfolioTreeNode } from "@/lib/portfolio";
import { PORTFOLIO_COLOURS, PORTFOLIO_OWNER_ROLES } from "@/lib/portfolio";

type Props = { roots: PortfolioTreeNode[] };

export function PortfolioOverview({ roots }: Props) {
  const totalProducts = roots.reduce((sum, r) => sum + r.totalCount, 0);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Portfolio</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          {roots.length} portfolios · {totalProducts} products
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {roots.map((root) => {
          const colour = PORTFOLIO_COLOURS[root.nodeId] ?? "#7c8cf8";
          const ownerRole = PORTFOLIO_OWNER_ROLES[root.nodeId] ?? "—";
          return (
            <Link
              key={root.nodeId}
              href={`/portfolio/${root.nodeId}`}
              className="block p-5 rounded-lg bg-[var(--dpf-surface-1)] border-l-4 hover:bg-[var(--dpf-surface-2)] transition-colors"
              style={{ borderLeftColor: colour }}
            >
              <h2 className="text-base font-semibold text-white mb-3">
                {root.name}
              </h2>
              <div className="flex items-center gap-4">
                <div>
                  <p className="text-xl font-bold text-white">
                    {root.totalCount}
                  </p>
                  <p className="text-[9px] text-[var(--dpf-muted)] uppercase tracking-wider">
                    Products
                  </p>
                </div>
                <div>
                  <p
                    className="text-sm font-bold"
                    style={{ color: colour }}
                  >
                    {ownerRole}
                  </p>
                  <p className="text-[9px] text-[var(--dpf-muted)] uppercase tracking-wider">
                    Owner
                  </p>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 7.4: Typecheck**

```bash
pnpm typecheck
```

Expected: `0 errors` (or errors for missing page.tsx — proceed).

---

### Task 8: Catch-All Page

**Files:**
- Create: `apps/web/app/(shell)/portfolio/[[...slug]]/page.tsx`

- [ ] **Step 8.1: Create the portfolio page**

Create `apps/web/app/(shell)/portfolio/[[...slug]]/page.tsx`:

```tsx
// apps/web/app/(shell)/portfolio/[[...slug]]/page.tsx
import { notFound } from "next/navigation";
import { prisma } from "@dpf/db";
import { getPortfolioTree } from "@/lib/portfolio-data";
import { resolveNodeFromSlug, getSubtreeIds, buildBreadcrumbs } from "@/lib/portfolio";
import { PortfolioOverview } from "@/components/portfolio/PortfolioOverview";
import { PortfolioNodeDetail } from "@/components/portfolio/PortfolioNodeDetail";

type Props = {
  params: { slug?: string[] };
};

export default async function PortfolioPage({ params }: Props) {
  const slugs = params.slug ?? [];
  const roots = await getPortfolioTree(); // deduplicated by React cache()

  // Overview: /portfolio
  if (slugs.length === 0) {
    return <PortfolioOverview roots={roots} />;
  }

  // Node detail: /portfolio/[...slug]
  const node = resolveNodeFromSlug(roots, slugs);
  if (!node) notFound();

  // Fetch products in this node's subtree
  const subtreeIds = getSubtreeIds([node]);
  const products = await prisma.digitalProduct.findMany({
    where: {
      taxonomyNodeId: { in: subtreeIds },
      status: "active",
    },
    select: { id: true, productId: true, name: true, status: true },
    orderBy: { name: "asc" },
  });

  const breadcrumbs = buildBreadcrumbs(roots, slugs);

  return (
    <PortfolioNodeDetail
      node={node}
      subNodes={node.children}
      products={products}
      breadcrumbs={breadcrumbs}
    />
  );
}
```

- [ ] **Step 8.2: Typecheck**

```bash
pnpm typecheck
```

Expected: `0 errors`.

- [ ] **Step 8.3: Run all tests**

```bash
cd apps/web && pnpm test
```

Expected:
```
✓ lib/portfolio.test.ts (11)
✓ lib/permissions.test.ts (9)
✓ lib/auth.test.ts (...)
✓ app/(shell)/workspace/page.test.tsx (3)
All tests passed
```

- [ ] **Step 8.4: Start dev server and verify manually**

Ensure Docker databases are running (`docker compose up -d`), then:

```bash
pnpm dev
```

Navigate to `http://localhost:3000` and log in as `admin@dpf.local` / `changeme123`.

Verify:
1. Workspace tile "Portfolio" appears and is clickable
2. `/portfolio` shows 4 portfolio root cards with product counts
3. Clicking "Foundational" → `/portfolio/foundational` shows the node detail + capability domain grid
4. Clicking a capability domain → L2 groups appear in grid
5. Tree sidebar updates active highlight as you navigate
6. Click a chevron → branch expands, `?open=` updates in URL bar
7. HR-500 role cannot access `/portfolio` (direct URL returns 404)

- [ ] **Step 8.5: Final commit**

```bash
git add apps/web/app/(shell)/portfolio/ apps/web/components/portfolio/ apps/web/lib/portfolio-data.ts
git commit -m "feat: implement /portfolio route with 4-level taxonomy tree and master/detail layout"
```

---

## Summary

| Chunk | Tasks | What it produces |
|---|---|---|
| 1 — Data Layer | 1–3 | Schema migration, `portfolio.ts` utility (tested), taxonomy seeding |
| 2 — UI Layer | 4–8 | Cached data helper, layout + permission gate, tree sidebar, right panel, catch-all page |

**Run order for a fresh environment:**
1. `pnpm db:migrate` (task 1)
2. `pnpm db:generate` (task 1)
3. `npx tsx packages/db/scripts/generate-taxonomy-json.ts` (task 3 — requires old project)
4. `pnpm db:seed` (task 3)
5. `pnpm typecheck` (should be clean after task 8)
6. `pnpm test` (11+ tests passing after task 2)
