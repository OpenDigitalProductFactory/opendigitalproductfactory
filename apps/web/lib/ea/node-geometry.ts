// React Flow stores a child node's `position` RELATIVE to its parent container. The floating
// edge renderer needs ABSOLUTE canvas coordinates to anchor edges on node borders — otherwise
// edges to nested (containment-view) children detach and bunch near the canvas origin
// (BI-9E5EA3FF regression). This resolves each node's absolute position by summing the
// offsets of its parent chain. Flat nodes (no parentId) are returned unchanged.

export type GeomNode = { id: string; position: { x: number; y: number }; parentId?: string };

export function resolveAbsolutePositions(nodes: GeomNode[]): Map<string, { x: number; y: number }> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const cache = new Map<string, { x: number; y: number }>();
  const resolving = new Set<string>();

  function abs(node: GeomNode): { x: number; y: number } {
    const cached = cache.get(node.id);
    if (cached) return cached;
    let { x, y } = node.position;
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent && !resolving.has(node.id)) {
      resolving.add(node.id); // guard against pathological parent cycles
      const parentAbs = abs(parent);
      resolving.delete(node.id);
      x += parentAbs.x;
      y += parentAbs.y;
    }
    const result = { x, y };
    cache.set(node.id, result);
    return result;
  }

  const out = new Map<string, { x: number; y: number }>();
  for (const n of nodes) out.set(n.id, abs(n));
  return out;
}
