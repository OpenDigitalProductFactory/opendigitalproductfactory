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
    depth === 0 ? (PORTFOLIO_COLOURS[node.nodeId] ?? "var(--dpf-accent)") : undefined;

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
          className="w-4 flex-shrink-0 text-[9px] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] mr-1"
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
            style={{ color: isActive ? (colour ?? "var(--dpf-text)") : (colour ?? "var(--dpf-text)") }}
          >
            {node.name}
          </span>
          {node.totalCount > 0 && (
            <span
              className="text-[8px] px-1.5 py-0.5 rounded-full flex-shrink-0"
              style={{
                background: `color-mix(in srgb, ${colour ?? "var(--dpf-accent)"} 12%, transparent)`,
                color: colour ?? "var(--dpf-accent)",
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
            key={child.id}
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
