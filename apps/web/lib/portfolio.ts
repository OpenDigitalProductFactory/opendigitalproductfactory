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
  children: PortfolioTreeNode[];
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

/** Build a tree from flat node rows + product count rows. */
export function buildPortfolioTree(
  nodes: RawNode[],
  counts: CountRow[]
): PortfolioTreeNode[] {
  // Build count lookup keyed by node.id (cuid PK)
  const countById = new Map<string, number>();
  for (const c of counts) {
    if (c.taxonomyNodeId) countById.set(c.taxonomyNodeId, c._count.id);
  }

  // Build a map of id → node (with empty children array)
  const nodeMap = new Map<string, PortfolioTreeNode>();
  for (const n of nodes) {
    nodeMap.set(n.id, {
      id: n.id,
      nodeId: n.nodeId,
      name: n.name,
      parentId: n.parentId,
      portfolioId: n.portfolioId ?? null,
      directCount: countById.get(n.id) ?? 0,
      totalCount: 0,
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

  // Compute totalCount bottom-up via DFS
  function sumSubtree(node: PortfolioTreeNode): number {
    const childSum = node.children.reduce((acc, c) => acc + sumSubtree(c), 0);
    node.totalCount = node.directCount + childSum;
    return node.totalCount;
  }
  for (const root of roots) sumSubtree(root);

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
