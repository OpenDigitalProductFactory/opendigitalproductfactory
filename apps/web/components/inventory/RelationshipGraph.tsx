"use client";

import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import type { GraphData } from "@/lib/actions/graph";

const LABEL_LEGEND = [
  { label: "Portfolio", color: "var(--dpf-accent)", key: "Portfolio" },
  { label: "Product", color: "#4ade80", key: "DigitalProduct" },
  { label: "Taxonomy", color: "#fb923c", key: "TaxonomyNode" },
  { label: "Infrastructure", color: "#38bdf8", key: "InfraCI" },
];

const LINK_TYPES = [
  { label: "Belongs To", key: "BELONGS_TO", color: "var(--dpf-accent)" },
  { label: "Classified As", key: "CLASSIFIED_AS", color: "#fb923c" },
  { label: "Parent Of", key: "PARENT_OF", color: "var(--dpf-muted)" },
  { label: "Depends On", key: "DEPENDS_ON", color: "#38bdf8" },
];

type Props = {
  data: GraphData;
};

type SimNode = GraphData["nodes"][0] & { x?: number; y?: number; vx?: number; vy?: number };
type SimLink = { source: SimNode | string; target: SimNode | string; type: string };

export function RelationshipGraph({ data }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 500 });
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const linksRef = useRef<SimLink[]>([]);
  const animRef = useRef<number>(0);
  const temperatureRef = useRef(1.0);

  // ─── Controls ──────────────────────────────────────────────────────────────
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const [maxHops, setMaxHops] = useState(0); // 0 = show all
  const [hiddenNodeTypes, setHiddenNodeTypes] = useState<Set<string>>(new Set());
  const [hiddenLinkTypes, setHiddenLinkTypes] = useState<Set<string>>(new Set());

  function toggleNodeType(key: string) {
    setHiddenNodeTypes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function toggleLinkType(key: string) {
    setHiddenLinkTypes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  // ─── Filter data by controls ───────────────────────────────────────────────
  const filteredData = useMemo(() => {
    let nodes = data.nodes.filter((n) => !hiddenNodeTypes.has(n.label));
    let links = data.links.filter((l) => !hiddenLinkTypes.has(l.type));

    // Focus node + hop filtering
    if (focusNodeId && maxHops > 0) {
      const nodeIds = new Set<string>();
      const queue: Array<{ id: string; depth: number }> = [{ id: focusNodeId, depth: 0 }];
      nodeIds.add(focusNodeId);

      while (queue.length > 0) {
        const current = queue.shift()!;
        if (current.depth >= maxHops) continue;
        for (const link of links) {
          const sourceId = typeof link.source === "string" ? link.source : (link.source as unknown as { id: string }).id;
          const targetId = typeof link.target === "string" ? link.target : (link.target as unknown as { id: string }).id;
          if (sourceId === current.id && !nodeIds.has(targetId)) {
            nodeIds.add(targetId);
            queue.push({ id: targetId, depth: current.depth + 1 });
          }
          if (targetId === current.id && !nodeIds.has(sourceId)) {
            nodeIds.add(sourceId);
            queue.push({ id: sourceId, depth: current.depth + 1 });
          }
        }
      }
      nodes = nodes.filter((n) => nodeIds.has(n.id));
      const nodeIdSet = new Set(nodes.map((n) => n.id));
      links = links.filter((l) => nodeIdSet.has(l.source as string) && nodeIdSet.has(l.target as string));
    }

    return { nodes, links };
  }, [data, focusNodeId, maxHops, hiddenNodeTypes, hiddenLinkTypes]);

  // ─── Force simulation with cooling ─────────────────────────────────────────
  const simulate = useCallback(() => {
    const nodes = nodesRef.current;
    const links = linksRef.current;
    const cx = dimensions.width / 2;
    const cy = dimensions.height / 2;
    const temp = temperatureRef.current;

    if (temp <= 0.01) return;
    temperatureRef.current *= 0.98;

    for (const node of nodes) {
      if (node.x === undefined) { node.x = cx + (Math.random() - 0.5) * 300; node.y = cy + (Math.random() - 0.5) * 200; }
      node.vx = (node.vx ?? 0) * 0.6;
      node.vy = (node.vy ?? 0) * 0.6;
      node.vx! += (cx - node.x!) * 0.002 * temp;
      node.vy! += (cy - node.y!) * 0.002 * temp;
    }

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]!;
        const b = nodes[j]!;
        const dx = (a.x ?? 0) - (b.x ?? 0);
        const dy = (a.y ?? 0) - (b.y ?? 0);
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
      const source = typeof link.source === "string" ? nodeMap.get(link.source) : link.source;
      const target = typeof link.target === "string" ? nodeMap.get(link.target) : link.target;
      if (!source || !target) continue;
      const dx = (target.x ?? 0) - (source.x ?? 0);
      const dy = (target.y ?? 0) - (source.y ?? 0);
      const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const force = (dist - 100) * 0.003 * temp;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      source.vx! += fx; source.vy! += fy;
      target.vx! -= fx; target.vy! -= fy;
    }

    for (const node of nodes) {
      node.x! += node.vx!;
      node.y! += node.vy!;
      node.x = Math.max(20, Math.min(dimensions.width - 20, node.x!));
      node.y = Math.max(20, Math.min(dimensions.height - 20, node.y!));
    }
  }, [dimensions]);

  // ─── Draw ──────────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const nodes = nodesRef.current;
    const links = linksRef.current;
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    ctx.clearRect(0, 0, dimensions.width, dimensions.height);

    ctx.lineWidth = 0.5;
    for (const link of links) {
      const source = typeof link.source === "string" ? nodeMap.get(link.source) : link.source;
      const target = typeof link.target === "string" ? nodeMap.get(link.target) : link.target;
      if (!source?.x || !target?.x) continue;

      const isHighlighted = hoveredNode === source.id || hoveredNode === target.id || focusNodeId === source.id || focusNodeId === target.id;
      ctx.strokeStyle = isHighlighted ? "rgba(124,140,248,0.6)" : "rgba(255,255,255,0.08)";
      ctx.lineWidth = isHighlighted ? 1.5 : 0.5;
      ctx.beginPath();
      ctx.moveTo(source.x, source.y!);
      ctx.lineTo(target.x, target.y!);
      ctx.stroke();
    }

    for (const node of nodes) {
      if (node.x === undefined || node.y === undefined) continue;
      const isHovered = hoveredNode === node.id;
      const isFocus = focusNodeId === node.id;
      const radius = (node.size ?? 4) * (isHovered || isFocus ? 1.5 : 1);

      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = node.color;
      ctx.globalAlpha = hoveredNode && !isHovered && !isFocus ? 0.3 : 1;
      ctx.fill();

      // Focus ring
      if (isFocus) {
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius + 3, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.globalAlpha = 1;

      if (isHovered || isFocus || node.size >= 6) {
        ctx.font = `${isHovered || isFocus ? 11 : 9}px -apple-system, sans-serif`;
        ctx.fillStyle = isHovered || isFocus ? "#fff" : "rgba(224,224,255,0.6)";
        ctx.textAlign = "center";
        ctx.fillText(node.name, node.x, node.y - radius - 4);
      }
    }
  }, [dimensions, hoveredNode, focusNodeId]);

  // Initialize — reset temperature on filter/data change
  useEffect(() => {
    nodesRef.current = filteredData.nodes.map((n) => ({ ...n }));
    linksRef.current = filteredData.links.map((l) => ({ ...l }));
    temperatureRef.current = 1.0;
  }, [filteredData]);

  // Resize observer
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

  // Animation loop
  useEffect(() => {
    let running = true;
    function tick() {
      if (!running) return;
      simulate();
      draw();
      animRef.current = requestAnimationFrame(tick);
    }
    tick();
    return () => { running = false; cancelAnimationFrame(animRef.current); };
  }, [simulate, draw]);

  // Click to focus
  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    for (const node of nodesRef.current) {
      if (node.x === undefined || node.y === undefined) continue;
      const dx = mx - node.x;
      const dy = my - node.y;
      if (dx * dx + dy * dy < ((node.size ?? 4) + 6) ** 2) {
        setFocusNodeId((prev) => prev === node.id ? null : node.id);
        return;
      }
    }
    setFocusNodeId(null);
  }

  // Mouse hover detection
  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    let found: string | null = null;
    for (const node of nodesRef.current) {
      if (node.x === undefined || node.y === undefined) continue;
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
        No graph data available. Add products and portfolios to see relationships.
      </div>
    );
  }

  const focusNode = data.nodes.find((n) => n.id === focusNodeId);

  return (
    <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
      {/* Controls toolbar */}
      <div className="flex items-start justify-between gap-4 mb-3 flex-wrap">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-widest text-[var(--dpf-muted)] mb-2">
            Relationship Graph
          </h3>

          {/* Focus node info */}
          {focusNode && (
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] text-[var(--dpf-muted)]">Focus:</span>
              <span className="text-xs text-[var(--dpf-text)] font-medium">{focusNode.name}</span>
              <span className="text-[9px] px-1 rounded" style={{ background: `${focusNode.color}20`, color: focusNode.color }}>
                {focusNode.label}
              </span>
              <button
                type="button"
                onClick={() => setFocusNodeId(null)}
                className="text-[9px] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
              >
                clear
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-4 flex-wrap">
          {/* Hop depth */}
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

          {/* Node type filters */}
          <div className="flex items-center gap-1">
            <span className="text-[9px] text-[var(--dpf-muted)] mr-1">Nodes:</span>
            {LABEL_LEGEND.map((l) => {
              const hidden = hiddenNodeTypes.has(l.key);
              return (
                <button
                  key={l.key}
                  type="button"
                  onClick={() => toggleNodeType(l.key)}
                  className="px-1.5 py-0.5 text-[9px] rounded-full border transition-colors"
                  style={{
                    borderColor: hidden ? "var(--dpf-border)" : l.color,
                    background: hidden ? "transparent" : `${l.color}20`,
                    color: hidden ? "var(--dpf-muted)" : l.color,
                    opacity: hidden ? 0.4 : 1,
                  }}
                >
                  {l.label}
                </button>
              );
            })}
          </div>

          {/* Link type filters */}
          <div className="flex items-center gap-1">
            <span className="text-[9px] text-[var(--dpf-muted)] mr-1">Links:</span>
            {LINK_TYPES.map((l) => {
              const hidden = hiddenLinkTypes.has(l.key);
              return (
                <button
                  key={l.key}
                  type="button"
                  onClick={() => toggleLinkType(l.key)}
                  className="px-1.5 py-0.5 text-[9px] rounded-full border transition-colors"
                  style={{
                    borderColor: hidden ? "var(--dpf-border)" : l.color,
                    background: hidden ? "transparent" : `${l.color}15`,
                    color: hidden ? "var(--dpf-muted)" : l.color,
                    opacity: hidden ? 0.4 : 1,
                  }}
                >
                  {l.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Canvas */}
      <div style={{ position: "relative" }}>
        <canvas
          ref={canvasRef}
          width={dimensions.width}
          height={dimensions.height}
          onClick={handleClick}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoveredNode(null)}
          style={{ width: "100%", height: dimensions.height, cursor: hoveredNode ? "pointer" : "default" }}
        />
        <div className="absolute bottom-2 right-2 text-[9px] text-[var(--dpf-muted)]">
          {filteredData.nodes.length} nodes · {filteredData.links.length} links
          {focusNodeId && maxHops > 0 ? ` · ${maxHops} hop${maxHops !== 1 ? "s" : ""} from focus` : ""}
        </div>
        {!focusNodeId && (
          <div className="absolute bottom-2 left-2 text-[9px] text-[var(--dpf-muted)]">
            Click a node to focus
          </div>
        )}
      </div>
    </div>
  );
}
