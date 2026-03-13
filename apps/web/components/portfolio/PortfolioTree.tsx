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
    const next = new Set(openIds);
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
    setOpenIds(next);
  }

  return (
    <nav className="py-2" aria-label="Portfolio navigation">
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
    </nav>
  );
}
