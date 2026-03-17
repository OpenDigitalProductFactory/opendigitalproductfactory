"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import type { GraphData } from "@/lib/actions/graph";

const LABEL_LEGEND = [
  { label: "Portfolio", color: "#7c8cf8" },
  { label: "Product", color: "#4ade80" },
  { label: "Taxonomy", color: "#fb923c" },
  { label: "Infrastructure", color: "#38bdf8" },
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
  const temperatureRef = useRef(1.0); // cooling: starts hot, settles to 0

  // Simple force simulation with cooling
  const simulate = useCallback(() => {
    const nodes = nodesRef.current;
    const links = linksRef.current;
    const cx = dimensions.width / 2;
    const cy = dimensions.height / 2;
    const temp = temperatureRef.current;

    // Cool down — simulation settles after ~200 frames
    if (temp > 0.01) {
      temperatureRef.current *= 0.98;
    } else {
      return; // stable — skip computation
    }

    // Apply forces
    for (const node of nodes) {
      if (node.x === undefined) { node.x = cx + (Math.random() - 0.5) * 300; node.y = cy + (Math.random() - 0.5) * 200; }
      node.vx = (node.vx ?? 0) * 0.6; // strong damping
      node.vy = (node.vy ?? 0) * 0.6;

      // Center gravity
      node.vx! += (cx - node.x!) * 0.002 * temp;
      node.vy! += (cy - node.y!) * 0.002 * temp;
    }

    // Repulsion between nodes (capped to prevent explosion)
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
        a.vx! += fx;
        a.vy! += fy;
        b.vx! -= fx;
        b.vy! -= fy;
      }
    }

    // Link attraction
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
      source.vx! += fx;
      source.vy! += fy;
      target.vx! -= fx;
      target.vy! -= fy;
    }

    // Apply velocity
    for (const node of nodes) {
      node.x! += node.vx!;
      node.y! += node.vy!;
      node.x = Math.max(20, Math.min(dimensions.width - 20, node.x!));
      node.y = Math.max(20, Math.min(dimensions.height - 20, node.y!));
    }
  }, [dimensions]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const nodes = nodesRef.current;
    const links = linksRef.current;
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    ctx.clearRect(0, 0, dimensions.width, dimensions.height);

    // Draw links
    ctx.lineWidth = 0.5;
    for (const link of links) {
      const source = typeof link.source === "string" ? nodeMap.get(link.source) : link.source;
      const target = typeof link.target === "string" ? nodeMap.get(link.target) : link.target;
      if (!source?.x || !target?.x) continue;

      const isHighlighted = hoveredNode === source.id || hoveredNode === target.id;
      ctx.strokeStyle = isHighlighted ? "rgba(124,140,248,0.6)" : "rgba(255,255,255,0.08)";
      ctx.lineWidth = isHighlighted ? 1.5 : 0.5;
      ctx.beginPath();
      ctx.moveTo(source.x, source.y!);
      ctx.lineTo(target.x, target.y!);
      ctx.stroke();
    }

    // Draw nodes
    for (const node of nodes) {
      if (node.x === undefined || node.y === undefined) continue;
      const isHovered = hoveredNode === node.id;
      const radius = (node.size ?? 4) * (isHovered ? 1.5 : 1);

      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = node.color;
      ctx.globalAlpha = hoveredNode && !isHovered ? 0.3 : 1;
      ctx.fill();
      ctx.globalAlpha = 1;

      // Label
      if (isHovered || node.size >= 6) {
        ctx.font = `${isHovered ? 11 : 9}px -apple-system, sans-serif`;
        ctx.fillStyle = isHovered ? "#fff" : "rgba(224,224,255,0.6)";
        ctx.textAlign = "center";
        ctx.fillText(node.name, node.x, node.y - radius - 4);
      }
    }
  }, [dimensions, hoveredNode]);

  // Initialize nodes and links — reset temperature to re-animate
  useEffect(() => {
    nodesRef.current = data.nodes.map((n) => ({ ...n }));
    linksRef.current = data.links.map((l) => ({ ...l }));
    temperatureRef.current = 1.0;
  }, [data]);

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

  return (
    <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-[var(--dpf-muted)]">
          Relationship Graph
        </h3>
        <div className="flex items-center gap-3">
          {LABEL_LEGEND.map((l) => (
            <div key={l.label} className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full" style={{ background: l.color }} />
              <span className="text-[9px] text-[var(--dpf-muted)]">{l.label}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ position: "relative" }}>
        <canvas
          ref={canvasRef}
          width={dimensions.width}
          height={dimensions.height}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoveredNode(null)}
          style={{ width: "100%", height: dimensions.height, cursor: hoveredNode ? "pointer" : "default" }}
        />
        <div className="absolute bottom-2 right-2 text-[9px] text-[var(--dpf-muted)]">
          {data.nodes.length} nodes · {data.links.length} links
        </div>
      </div>
    </div>
  );
}
