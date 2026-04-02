// apps/web/components/portfolio/PortfolioTree.tsx
"use client";
import { useState, useEffect, useMemo } from "react";
import { usePathname } from "next/navigation";
import type { PortfolioTreeNode } from "@/lib/portfolio";
import { PortfolioTreeNodeItem } from "./PortfolioTreeNode";

type Props = {
  /** Pruned tree: only nodes with products attributed. */
  prunedRoots: PortfolioTreeNode[];
  /** Full taxonomy tree: all nodes regardless of product count. */
  fullRoots: PortfolioTreeNode[];
};

/** Collect all node names + nodeIds for search matching. */
function collectSearchable(
  nodes: PortfolioTreeNode[]
): Array<{ nodeId: string; name: string; path: string[] }> {
  const result: Array<{ nodeId: string; name: string; path: string[] }> = [];
  function walk(node: PortfolioTreeNode, path: string[]) {
    const currentPath = [...path, node.name];
    result.push({ nodeId: node.nodeId, name: node.name, path: currentPath });
    for (const child of node.children) walk(child, currentPath);
  }
  for (const root of nodes) walk(root, []);
  return result;
}

/** Find all ancestor nodeIds that need to be opened to reveal a target node. */
function ancestorsOf(nodeId: string): string[] {
  const parts = nodeId.split("/");
  const ancestors: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    ancestors.push(parts.slice(0, i).join("/"));
  }
  return ancestors;
}

export function PortfolioTree({ prunedRoots, fullRoots }: Props) {
  const [showAll, setShowAll] = useState(false);
  const [search, setSearch] = useState("");
  const [openIds, setOpenIds] = useState<Set<string>>(new Set<string>());
  const pathname = usePathname();

  const roots = showAll ? fullRoots : prunedRoots;

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

  // Search results
  const searchable = useMemo(() => collectSearchable(roots), [roots]);
  const searchResults = useMemo(() => {
    if (search.length < 2) return null;
    const q = search.toLowerCase();
    return searchable
      .filter((s) => s.name.toLowerCase().includes(q))
      .slice(0, 15);
  }, [search, searchable]);

  function toggle(nodeId: string) {
    const next = new Set(openIds);
    if (next.has(nodeId)) {
      next.delete(nodeId);
    } else {
      next.add(nodeId);
    }
    const url = new URL(window.location.href);
    if (next.size > 0) {
      url.searchParams.set("open", [...next].join(","));
    } else {
      url.searchParams.delete("open");
    }
    window.history.replaceState(null, "", url.toString());
    setOpenIds(next);
  }

  function navigateToNode(nodeId: string) {
    // Open all ancestors so the node is visible
    const ancestors = ancestorsOf(nodeId);
    const next = new Set(openIds);
    for (const a of ancestors) next.add(a);
    setOpenIds(next);
    setSearch("");
  }

  return (
    <nav className="py-2 flex flex-col h-full" aria-label="Portfolio navigation">
      {/* Search */}
      <div className="px-3 mb-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search products..."
          className="w-full text-[11px] px-2 py-1 rounded bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] text-[var(--dpf-text)] placeholder:text-[var(--dpf-muted)] outline-none focus:border-[var(--dpf-accent)]"
        />
      </div>

      {/* Search results overlay */}
      {searchResults && searchResults.length > 0 && (
        <div className="px-3 mb-2">
          <div className="bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] rounded max-h-48 overflow-y-auto">
            {searchResults.map((r) => (
              <a
                key={r.nodeId}
                href={`/portfolio/${r.nodeId}`}
                onClick={() => navigateToNode(r.nodeId)}
                className="block px-2 py-1.5 text-[11px] text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)] no-underline border-b border-[var(--dpf-border)] last:border-b-0"
              >
                <div className="font-medium">{r.name}</div>
                <div className="text-[9px] text-[var(--dpf-muted)] truncate">
                  {r.path.slice(0, -1).join(" > ")}
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

      {searchResults && searchResults.length === 0 && search.length >= 2 && (
        <div className="px-3 mb-2 text-[10px] text-[var(--dpf-muted)]">No matches</div>
      )}

      {/* Tree */}
      <div className="flex-1 overflow-y-auto">
        {roots.map((root, i) => (
          <div key={root.id}>
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
      </div>

      {/* Show all toggle */}
      <div className="px-3 py-2 border-t border-[var(--dpf-border)]">
        <button
          onClick={() => setShowAll(!showAll)}
          className="text-[10px] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] transition-colors"
        >
          {showAll ? "Show active nodes only" : "Show all taxonomy nodes"}
        </button>
      </div>
    </nav>
  );
}
