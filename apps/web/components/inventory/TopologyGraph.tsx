"use client";

import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import type { GraphData } from "@/lib/actions/graph";
import type { GraphViewName, PositionedNode, LayoutResult } from "@/lib/graph/types";
import { VIEW_CONFIGS, resolveViewForTaxonomy } from "@/lib/graph/view-config";
import { useGraphLayout } from "@/lib/graph/use-graph-layout";

// ─── Constants ──────────────────────────────────────────────────────────────

const LINK_COLORS: Record<string, string> = {
  BELONGS_TO: "#7c8cf8",
  CLASSIFIED_AS: "#fb923c",
  PARENT_OF: "#666677",
  DEPENDS_ON: "#38bdf8",
  HOSTS: "#22d3ee",
  MEMBER_OF: "#a78bfa",
  ROUTES_THROUGH: "#f472b6",
  RUNS_ON: "#34d399",
  MONITORS: "#fbbf24",
  PEER_OF: "#f59e0b",
  LISTENS_ON: "#6ee7b7",
  CARRIED_BY: "#c084fc",
  CONNECTS_TO: "#fb7185",
};

const OSI_LAYER_NAMES: Record<number, string> = {
  7: "Application",
  6: "Presentation",
  5: "Session",
  4: "Transport",
  3: "Network",
  2: "Data Link",
  1: "Physical",
};

// ─── Types ──────────────────────────────────────────────────────────────────

type Props = {
  data: GraphData;
  defaultView?: GraphViewName;
  taxonomyNodeId?: string | null;
  initialFocusNodeId?: string | null;
};

type SimNode = PositionedNode & { vx?: number; vy?: number };

// ─── Component ──────────────────────────────────────────────────────────────

export function TopologyGraph({ data, defaultView, taxonomyNodeId, initialFocusNodeId }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 500 });
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [focusNodeId, setFocusNodeId] = useState<string | null>(initialFocusNodeId ?? null);
  const [maxHops, setMaxHops] = useState(0);

  // View selection
  const autoView = defaultView ?? resolveViewForTaxonomy(taxonomyNodeId ?? null);
  const [selectedView, setSelectedView] = useState<GraphViewName>(autoView);
  const viewConfig = VIEW_CONFIGS[selectedView];

  // Layout computation
  const layoutResult = useGraphLayout(data, viewConfig, focusNodeId, dimensions);

  // Force simulation state (only for exploration view)
  const nodesRef = useRef<SimNode[]>([]);
  const animRef = useRef<number>(0);
  const temperatureRef = useRef(1.0);

  // ─── Filtered data for force layout ─────────────────────────────────────
  const filteredData = useMemo(() => {
    let nodes = data.nodes.filter((n) => viewConfig.nodeTypesShown.has(n.label));
    let links = data.links.filter((l) => viewConfig.edgesShown.has(l.type));

    // Hop filtering when a focus node is set
    if (focusNodeId && maxHops > 0) {
      const nodeIds = new Set<string>();
      const queue: Array<{ id: string; depth: number }> = [{ id: focusNodeId, depth: 0 }];
      nodeIds.add(focusNodeId);
      while (queue.length > 0) {
        const current = queue.shift()!;
        if (current.depth >= maxHops) continue;
        for (const link of links) {
          const src = link.source;
          const tgt = link.target;
          if (src === current.id && !nodeIds.has(tgt)) {
            nodeIds.add(tgt);
            queue.push({ id: tgt, depth: current.depth + 1 });
          }
          if (tgt === current.id && !nodeIds.has(src)) {
            nodeIds.add(src);
            queue.push({ id: src, depth: current.depth + 1 });
          }
        }
      }
      nodes = nodes.filter((n) => nodeIds.has(n.id));
      const nodeIdSet = new Set(nodes.map((n) => n.id));
      links = links.filter((l) => nodeIdSet.has(l.source) && nodeIdSet.has(l.target));
    }

    return { nodes, links };
  }, [data, viewConfig, focusNodeId, maxHops]);

  // ─── Force simulation (exploration view only) ──────────────────────────
  const simulate = useCallback(() => {
    const nodes = nodesRef.current;
    const links = filteredData.links;
    const cx = dimensions.width / 2;
    const cy = dimensions.height / 2;
    const temp = temperatureRef.current;
    if (temp <= 0.01) return;
    temperatureRef.current *= 0.98;

    for (const node of nodes) {
      if (node.x === undefined) {
        node.x = cx + (Math.random() - 0.5) * 300;
        node.y = cy + (Math.random() - 0.5) * 200;
      }
      node.vx = (node.vx ?? 0) * 0.6;
      node.vy = (node.vy ?? 0) * 0.6;
      node.vx! += (cx - node.x) * 0.002 * temp;
      node.vy! += (cy - node.y) * 0.002 * temp;
    }

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]!;
        const b = nodes[j]!;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.max(10, Math.sqrt(dx * dx + dy * dy));
        const force = Math.min(3, 80 / (dist * dist)) * temp;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx! += fx; a.vy! += fy;
        b.vx! -= fx; b.vy! -= fy;
      }
    }

    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    for (const link of links) {
      const source = nodeMap.get(link.source);
      const target = nodeMap.get(link.target);
      if (!source || !target) continue;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const force = (dist - 100) * 0.003 * temp;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      source.vx! += fx; source.vy! += fy;
      target.vx! -= fx; target.vy! -= fy;
    }

    for (const node of nodes) {
      node.x += node.vx!;
      node.y += node.vy!;
      node.x = Math.max(20, Math.min(dimensions.width - 20, node.x));
      node.y = Math.max(20, Math.min(dimensions.height - 20, node.y));
    }
  }, [dimensions, filteredData.links]);

  // ─── Draw ─────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Determine which nodes to draw
    const isPositioned = layoutResult != null;
    const drawNodes: PositionedNode[] = isPositioned
      ? layoutResult.nodes
      : nodesRef.current;
    const drawLinks = isPositioned
      ? layoutResult.links
      : filteredData.links;
    const nodeMap = new Map(drawNodes.map((n) => [n.id, n]));

    ctx.clearRect(0, 0, dimensions.width, dimensions.height);

    // Draw swimlane bands if in swimlane mode
    if (viewConfig.layout === "swimlane" && isPositioned) {
      drawSwimlaneBands(ctx, layoutResult.nodes, dimensions);
    }

    // Draw edges
    for (const link of drawLinks) {
      const source = nodeMap.get(link.source);
      const target = nodeMap.get(link.target);
      if (!source || !target || source.x == null || target.x == null) continue;

      const isHighlighted =
        hoveredNode === source.id ||
        hoveredNode === target.id ||
        focusNodeId === source.id ||
        focusNodeId === target.id;

      const linkColor = LINK_COLORS[link.type] ?? "#555566";
      ctx.strokeStyle = isHighlighted ? linkColor : hexWithAlpha(linkColor, 0.3);
      ctx.lineWidth = isHighlighted ? 2 : 0.7;
      ctx.beginPath();
      ctx.moveTo(source.x, source.y);
      ctx.lineTo(target.x, target.y);
      ctx.stroke();

      // Edge label on hover
      if (isHighlighted) {
        const mx = (source.x + target.x) / 2;
        const my = (source.y + target.y) / 2;
        ctx.font = "9px -apple-system, sans-serif";
        ctx.fillStyle = linkColor;
        ctx.textAlign = "center";
        ctx.fillText(link.type, mx, my - 4);
      }
    }

    // Draw nodes
    for (const node of drawNodes) {
      if (node.x == null || node.y == null) continue;
      const isHovered = hoveredNode === node.id;
      const isFocus = focusNodeId === node.id;
      const radius = (node.size ?? 4) * (isHovered || isFocus ? 1.5 : 1);

      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = node.color;
      ctx.globalAlpha = hoveredNode && !isHovered && !isFocus ? 0.3 : 1;
      ctx.fill();

      if (isFocus) {
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius + 3, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.globalAlpha = 1;

      if (isHovered || isFocus || node.size >= 6 || !isPositioned) {
        ctx.font = `${isHovered || isFocus ? 11 : 9}px -apple-system, sans-serif`;
        ctx.fillStyle = isHovered || isFocus ? "#fff" : "rgba(224,224,255,0.6)";
        ctx.textAlign = "center";
        ctx.fillText(node.name, node.x, node.y - radius - 4);
      }
    }
  }, [dimensions, hoveredNode, focusNodeId, layoutResult, filteredData.links, viewConfig.layout]);

  // ─── Initialize force simulation nodes ────────────────────────────────
  useEffect(() => {
    if (layoutResult != null) return; // Positioned layout, no simulation
    nodesRef.current = filteredData.nodes.map((n) => ({
      ...n,
      x: dimensions.width / 2 + (Math.random() - 0.5) * 300,
      y: dimensions.height / 2 + (Math.random() - 0.5) * 200,
      vx: 0,
      vy: 0,
    }));
    temperatureRef.current = 1.0;
  }, [filteredData.nodes, layoutResult, dimensions]);

  // ─── Resize observer ──────────────────────────────────────────────────
  useEffect(() => {
    const container = canvasRef.current?.parentElement;
    if (!container) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width } = entry.contentRect;
        setDimensions({ width, height: Math.max(400, Math.min(600, width * 0.6)) });
      }
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // ─── Animation loop ───────────────────────────────────────────────────
  useEffect(() => {
    let running = true;
    function tick() {
      if (!running) return;
      if (layoutResult == null) simulate(); // Only simulate for force layout
      draw();
      animRef.current = requestAnimationFrame(tick);
    }
    tick();
    return () => { running = false; cancelAnimationFrame(animRef.current); };
  }, [simulate, draw, layoutResult]);

  // ─── Click to focus ───────────────────────────────────────────────────
  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const drawNodes = layoutResult?.nodes ?? nodesRef.current;
    for (const node of drawNodes) {
      if (node.x == null || node.y == null) continue;
      const dx = mx - node.x;
      const dy = my - node.y;
      if (dx * dx + dy * dy < ((node.size ?? 4) + 6) ** 2) {
        setFocusNodeId((prev) => (prev === node.id ? null : node.id));
        return;
      }
    }
    setFocusNodeId(null);
  }

  // ─── Mouse hover ──────────────────────────────────────────────────────
  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const drawNodes = layoutResult?.nodes ?? nodesRef.current;
    let found: string | null = null;
    for (const node of drawNodes) {
      if (node.x == null || node.y == null) continue;
      const dx = mx - node.x;
      const dy = my - node.y;
      if (dx * dx + dy * dy < ((node.size ?? 4) + 4) ** 2) {
        found = node.id;
        break;
      }
    }
    setHoveredNode(found);
  }

  if (data.nodes.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-[var(--dpf-muted)]">
        No graph data available. Discovery runs automatically every 15 minutes.
      </div>
    );
  }

  const focusNode = data.nodes.find((n) => n.id === focusNodeId);
  const displayNodes = layoutResult?.nodes ?? nodesRef.current;
  const displayLinks = layoutResult?.links ?? filteredData.links;

  return (
    <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
      {/* ─── Toolbar ──────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 mb-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          {/* View selector */}
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] text-[var(--dpf-muted)]">View:</span>
            <select
              value={selectedView}
              onChange={(e) => setSelectedView(e.target.value as GraphViewName)}
              className="text-[10px] bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded px-1.5 py-0.5 text-[var(--dpf-text)]"
            >
              {Object.values(VIEW_CONFIGS).map((vc) => (
                <option key={vc.name} value={vc.name}>
                  {vc.label}
                </option>
              ))}
            </select>
          </div>

          {/* Focus node info */}
          {focusNode && (
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] text-[var(--dpf-muted)]">Focus:</span>
              <span className="text-[10px] text-[var(--dpf-text)] font-medium truncate max-w-[200px]">
                {focusNode.name}
              </span>
              <button
                type="button"
                onClick={() => setFocusNodeId(null)}
                className="text-[9px] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
              >
                clear
              </button>
              {focusNode.label === "InfraCI" && selectedView !== "impact-blast-radius" && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedView("impact-blast-radius");
                  }}
                  className="text-[9px] px-1.5 py-0.5 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10"
                >
                  Analyze Impact
                </button>
              )}
            </div>
          )}
        </div>

        {/* Hop depth (only for exploration and impact views) */}
        {(selectedView === "exploration" || selectedView === "impact-blast-radius") && (
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] text-[var(--dpf-muted)]">Hops:</span>
            {[0, 1, 2, 3].map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => setMaxHops(h)}
                className={`px-1.5 py-0.5 text-[9px] rounded border transition-colors ${
                  maxHops === h
                    ? "border-[var(--dpf-accent)] text-[var(--dpf-text)] bg-[var(--dpf-accent)]/20"
                    : "border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
                }`}
              >
                {h === 0 ? "All" : h}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* View description */}
      <p className="text-[9px] text-[var(--dpf-muted)] mb-2">{viewConfig.description}</p>

      {/* ─── Canvas ──────────────────────────────────────────────────── */}
      <div style={{ position: "relative" }}>
        <canvas
          ref={canvasRef}
          width={dimensions.width}
          height={dimensions.height}
          onClick={handleClick}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoveredNode(null)}
          style={{
            width: "100%",
            height: dimensions.height,
            cursor: hoveredNode ? "pointer" : "default",
          }}
        />
        <div className="absolute bottom-2 right-2 text-[9px] text-[var(--dpf-muted)]">
          {displayNodes.length} nodes / {displayLinks.length} edges
        </div>
        {!focusNodeId && (
          <div className="absolute bottom-2 left-2 text-[9px] text-[var(--dpf-muted)]">
            Click a node to focus
          </div>
        )}
      </div>

      {/* ─── Node Detail Panel ───────────────────────────────────────── */}
      {focusNode && (
        <div className="mt-2 p-2 rounded bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)]">
          <div className="flex items-center gap-2">
            <span
              className="w-3 h-3 rounded-full inline-block"
              style={{ backgroundColor: focusNode.color }}
            />
            <span className="text-xs font-medium text-[var(--dpf-text)]">{focusNode.name}</span>
            <span className="text-[9px] px-1 py-0.5 rounded bg-[var(--dpf-surface-1)] text-[var(--dpf-muted)]">
              {focusNode.label}
            </span>
            {focusNode.ciType && (
              <span className="text-[9px] text-[var(--dpf-muted)]">{focusNode.ciType}</span>
            )}
            {focusNode.status && (
              <span className="text-[9px] text-[var(--dpf-muted)]">
                {focusNode.status}
              </span>
            )}
            {focusNode.osiLayer != null && (
              <span className="text-[9px] text-[var(--dpf-muted)]">
                L{focusNode.osiLayer} {OSI_LAYER_NAMES[focusNode.osiLayer] ?? ""}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function hexWithAlpha(hex: string, alpha: number): string {
  if (hex.startsWith("var(")) return `rgba(100,100,120,${alpha})`; // CSS var fallback
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function drawSwimlaneBands(
  ctx: CanvasRenderingContext2D,
  nodes: PositionedNode[],
  dimensions: { width: number; height: number },
) {
  // Group nodes by osiLayer and find Y range for each
  const layerYRanges = new Map<number, { min: number; max: number }>();
  for (const node of nodes) {
    if (node.osiLayer == null) continue;
    const range = layerYRanges.get(node.osiLayer);
    if (range) {
      range.min = Math.min(range.min, node.y - 20);
      range.max = Math.max(range.max, node.y + 20);
    } else {
      layerYRanges.set(node.osiLayer, { min: node.y - 20, max: node.y + 20 });
    }
  }

  for (const [layer, range] of layerYRanges) {
    const bandY = range.min - 10;
    const bandH = range.max - range.min + 20;

    ctx.fillStyle = layer % 2 === 0 ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.04)";
    ctx.fillRect(0, bandY, dimensions.width, bandH);

    ctx.font = "9px -apple-system, sans-serif";
    ctx.fillStyle = "rgba(224,224,255,0.25)";
    ctx.textAlign = "left";
    ctx.fillText(`L${layer} ${OSI_LAYER_NAMES[layer] ?? ""}`, 8, bandY + 12);
  }
}
