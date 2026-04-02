// apps/web/lib/portfolio.ts
// Pure utility library — no server imports, safe to import in tests and client components.

export type PortfolioTreeNode = {
  id: string;
  nodeId: string;
  name: string;
  parentId: string | null;
  portfolioId: string | null;
  directCount: number;
  totalCount: number;
  activeCount: number;   // ← new: active products in subtree, rolled up
  children: PortfolioTreeNode[];
};

export type OwnerRoleInfo = {
  roleId: string;
  name: string;
  description: string | null;
  userCount: number;
};

/** Portfolio root accent colours (keyed by nodeId). */
export const PORTFOLIO_COLOURS: Record<string, string> = {
  foundational: "#7c8cf8",
  manufacturing_and_delivery: "#fb923c",
  for_employees: "#a78bfa",
  products_and_services_sold: "#f472b6",
};

/** Portfolio owner HR role codes (keyed by nodeId). */
export const PORTFOLIO_OWNER_ROLES: Record<string, string> = {
  foundational: "HR-300",
  manufacturing_and_delivery: "HR-500",
  for_employees: "HR-200",
  products_and_services_sold: "HR-100",
};

type RawNode = {
  id: string;
  nodeId: string;
  name: string;
  parentId: string | null;
  portfolioId: string | null | undefined;
};

type CountRow = {
  taxonomyNodeId: string | null;
  _count: { id: number };
};

type BuildOptions = {
  /** Remove branches that have zero products (direct + cumulative). Default: false. */
  pruneEmpty?: boolean;
  /** When total product count across all roots is below this threshold, flatten
   *  pass-through nodes (single child, zero direct products). Default: 20. */
  flattenThreshold?: number;
};

/** Build a tree from flat node rows + product count rows. */
export function buildPortfolioTree(
  nodes: RawNode[],
  totalCounts: CountRow[],        // all products regardless of status
  activeCounts: CountRow[] = [],  // active products only; defaults to [] so existing call sites compile
  options: BuildOptions = {}
): PortfolioTreeNode[] {
  // Deduplicate by nodeId — keeps first occurrence so duplicate DB rows don't produce
  // two roots with the same nodeId (which would generate duplicate React keys).
  const seenNodeIds = new Set<string>();
  const deduped = nodes.filter((n) => {
    if (seenNodeIds.has(n.nodeId)) return false;
    seenNodeIds.add(n.nodeId);
    return true;
  });

  // Build lookup keyed by node.id (cuid PK)
  const countById = new Map<string, number>();
  for (const c of totalCounts) {
    if (c.taxonomyNodeId) countById.set(c.taxonomyNodeId, c._count.id);
  }

  const activeCountById = new Map<string, number>();
  for (const c of activeCounts) {
    if (c.taxonomyNodeId) activeCountById.set(c.taxonomyNodeId, c._count.id);
  }

  // Build a map of id → node (with empty children array)
  const nodeMap = new Map<string, PortfolioTreeNode>();
  for (const n of deduped) {
    nodeMap.set(n.id, {
      id: n.id,
      nodeId: n.nodeId,
      name: n.name,
      parentId: n.parentId,
      portfolioId: n.portfolioId ?? null,
      directCount: countById.get(n.id) ?? 0,
      totalCount: 0,
      activeCount: 0,   // populated during DFS below
      children: [],
    });
  }

  // Wire up parent → children
  const roots: PortfolioTreeNode[] = [];
  for (const node of nodeMap.values()) {
    if (node.parentId === null) {
      roots.push(node);
    } else {
      const parent = nodeMap.get(node.parentId);
      if (parent) parent.children.push(node);
    }
  }

  // Compute totalCount and activeCount bottom-up via DFS
  function sumSubtree(node: PortfolioTreeNode): { total: number; active: number } {
    const childTotals = node.children.reduce(
      (acc, c) => {
        const sub = sumSubtree(c);
        return { total: acc.total + sub.total, active: acc.active + sub.active };
      },
      { total: 0, active: 0 }
    );
    node.totalCount  = node.directCount + childTotals.total;
    node.activeCount = (activeCountById.get(node.id) ?? 0) + childTotals.active;
    return { total: node.totalCount, active: node.activeCount };
  }
  for (const root of roots) sumSubtree(root);

  const { pruneEmpty = false, flattenThreshold = 20 } = options;

  // Prune empty branches: remove children (recursively) that have totalCount === 0.
  // Portfolio roots are always kept so the structure is recognizable.
  if (pruneEmpty) {
    function prune(children: PortfolioTreeNode[]): PortfolioTreeNode[] {
      return children
        .filter((n) => n.totalCount > 0)
        .map((n) => ({ ...n, children: prune(n.children) }));
    }
    for (const root of roots) {
      root.children = prune(root.children);
    }
  }

  // Flatten pass-through nodes when org is small: if total products across all
  // roots is below the threshold, collapse intermediate nodes that have a single
  // child and zero direct products (they just add depth without information).
  const totalProducts = roots.reduce((sum, r) => sum + r.totalCount, 0);
  if (totalProducts > 0 && totalProducts < flattenThreshold) {
    function flatten(node: PortfolioTreeNode): PortfolioTreeNode {
      // Recursively flatten children first
      node.children = node.children.map(flatten);
      // If this node is a pass-through (single child, no direct products), skip it
      while (
        node.children.length === 1 &&
        node.directCount === 0 &&
        node.children[0].children.length > 0
      ) {
        const child = node.children[0];
        node.children = child.children;
      }
      return node;
    }
    for (const root of roots) {
      flatten(root);
    }
  }

  return roots;
}

/** Walk the tree to find the node matching a slug path. */
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

/** Return all node .id (cuid PK) values in a subtree, including roots. */
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

/** Compute health percentage string from active vs total product counts.
 *  Returns "—" if no products exist in the subtree. */
export function computeHealth(active: number, total: number): string {
  if (total === 0) return "—";
  const clamped = Math.min(active, total);
  return Math.round((clamped / total) * 100) + "%";
}

/** Format a portfolio budget (thousands USD) as a display string.
 *  Returns "—" when null, zero, or negative. */
export function formatBudget(kUsd: number | null | undefined): string {
  if (kUsd == null || kUsd <= 0) return "\u2014";
  if (kUsd >= 1000) return `$${(kUsd / 1000).toFixed(1)}M`;
  return `$${kUsd}k`;
}
