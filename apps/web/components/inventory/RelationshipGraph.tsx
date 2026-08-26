"use client";

import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import type { GraphData } from "@/lib/actions/graph";
import { resolveCanvasColor, useCanvasTheme } from "./canvas-theme";

export type GraphLegendEntry = { label: string; key: string; color: string };

// ── Layout tuning (BI-C2B6396B) ──────────────────────────────────────────────
//
// The forces are expressed relative to `k`, the ideal node separation, which is
// derived per frame from canvas area over node count (Fruchterman-Reingold).
// Fixed constants collapsed the graph into a knot once the canvas carried ~100
// nodes — well inside the 400-node cap the graph-explorer spec sanctions.

/** Below this temperature the layout is at rest and the loop stops. */
const COOLED_TEMPERATURE = 0.01;
/** Ideal separation is clamped: unbounded k scatters a 3-node graph to the edges. */
const MIN_IDEAL_SEPARATION = 34;
const MAX_IDEAL_SEPARATION = 130;
/** Repulsion at exactly the ideal separation. */
const REPULSION_GAIN = 0.6;
/** Ceiling for near-coincident nodes, which would otherwise be flung off-canvas. */
const REPULSION_CAP = 6;
const SPRING_GAIN = 0.0035;
/** Padding around a label's box when testing it against already-placed labels. */
const LABEL_PADDING = 2;

/**
 * Deterministic seed position for a node, derived from its id.
 *
 * Replaces `Math.random()` so a given graph always lays out identically. The
 * golden-angle step spreads consecutive hashes around the circle instead of
 * clustering them, and the radius varies so nodes do not land on one ring.
 */
function hashToUnitAngle(id: string): { angle: number; radius: number } {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const unit = ((h >>> 0) % 100000) / 100000;
  return {
    angle: unit * Math.PI * 2 * 1.618033988749895,
    radius: 30 + unit * 140,
  };
}

const DEFAULT_LABEL_LEGEND: GraphLegendEntry[] = [
  { label: "Portfolio", color: "var(--dpf-accent)", key: "Portfolio" },
  { label: "Product", color: "#4ade80", key: "DigitalProduct" },
  { label: "Taxonomy", color: "#fb923c", key: "TaxonomyNode" },
  { label: "Infrastructure", color: "#38bdf8", key: "InfraCI" },
];

const DEFAULT_LINK_LEGEND: GraphLegendEntry[] = [
  { label: "Belongs To", key: "BELONGS_TO", color: "var(--dpf-accent)" },
  { label: "Classification", key: "CLASSIFIED_AS", color: "#fb923c" },
  { label: "Parent Of", key: "PARENT_OF", color: "var(--dpf-muted)" },
  { label: "Depends On", key: "DEPENDS_ON", color: "#38bdf8" },
  { label: "Hosts", key: "HOSTS", color: "#22d3ee" },
  { label: "Member Of", key: "MEMBER_OF", color: "#a78bfa" },
  { label: "Routes Through", key: "ROUTES_THROUGH", color: "#f472b6" },
  { label: "Runs On", key: "RUNS_ON", color: "#34d399" },
  { label: "Monitors", key: "MONITORS", color: "#fbbf24" },
];

// The canvas force layout is shared by the inventory relationship view and the
// admin graph explorer (BI-89A149A9). Everything domain-specific — the legends,
// the heading, the empty/hint copy, and what a click means — arrives as props;
// omitting them reproduces the original inventory behaviour exactly.
type Props = {
  data: GraphData;
  title?: string;
  nodeLegend?: GraphLegendEntry[];
  linkLegend?: GraphLegendEntry[];
  emptyMessage?: string;
  hint?: string;
  /** Fires on every focus change, including clearing focus by clicking empty canvas. */
  onFocusChange?: (nodeId: string | null) => void;
};

type SimNode = GraphData["nodes"][0] & { x?: number; y?: number; vx?: number; vy?: number };
type SimLink = { source: SimNode | string; target: SimNode | string; type: string };

export function RelationshipGraph({
  data,
  title = "Relationships",
  nodeLegend = DEFAULT_LABEL_LEGEND,
  linkLegend = DEFAULT_LINK_LEGEND,
  emptyMessage = "No graph data. Add products or portfolios.",
  hint = "Select a node",
  onFocusChange,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 500 });
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const linksRef = useRef<SimLink[]>([]);
  const animRef = useRef<number>(0);
  const temperatureRef = useRef(1.0);
  const palette = useCanvasTheme(canvasRef);

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

    if (temp <= COOLED_TEMPERATURE) return;
    temperatureRef.current *= 0.98;

    // Ideal node separation, Fruchterman-Reingold style: k = sqrt(area / n).
    // The forces below are expressed relative to k so the layout self-scales with
    // how crowded the canvas is (BI-C2B6396B). The previous constants were fixed —
    // repulsion of 80/d² and a spring pulling every edge to a flat 100px — which
    // meant repulsion was already negligible at ~30px apart while the spring kept
    // pulling inward. Past roughly a hundred nodes (a two-hop expansion in the
    // graph explorer reaches that easily) the whole graph collapsed into an
    // unreadable knot in the middle of the canvas.
    const k = Math.max(
      MIN_IDEAL_SEPARATION,
      Math.min(
        MAX_IDEAL_SEPARATION,
        Math.sqrt((dimensions.width * dimensions.height) / Math.max(1, nodes.length)),
      ),
    );

    for (const node of nodes) {
      if (node.x === undefined) {
        // Seeded from the node id rather than Math.random (BI-C2B6396B). Two
        // benefits: the same graph lays out the same way every time, so the
        // picture is stable across reloads and reproducible in tests; and no two
        // nodes can start exactly coincident, where dx and dy are both zero, the
        // repulsion direction is undefined, and the pair stays fused forever.
        const seed = hashToUnitAngle(node.id);
        node.x = cx + Math.cos(seed.angle) * seed.radius;
        node.y = cy + Math.sin(seed.angle) * seed.radius * 0.7;
      }
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
        const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        // Coulomb term relative to the ideal separation: at dist == k this is
        // REPULSION_GAIN, and it falls off as 1/d². Capped so two nodes that spawn
        // almost on top of each other cannot fling themselves off the canvas.
        const force = Math.min(REPULSION_CAP, REPULSION_GAIN * ((k * k) / (dist * dist))) * temp;
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
      // Spring toward the same ideal separation the repulsion is scaled to, so
      // the two forces balance at k rather than fighting to a fixed 100px.
      const force = (dist - k) * SPRING_GAIN * temp;
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
      const linkDef = linkLegend.find((lt) => lt.key === link.type);
      const linkColor = resolveCanvasColor(canvas, linkDef?.color, palette.border);
      ctx.strokeStyle = linkColor;
      ctx.globalAlpha = isHighlighted ? 1 : palette.edgeAlpha;
      ctx.lineWidth = isHighlighted ? 2 : 0.7;
      ctx.beginPath();
      ctx.moveTo(source.x, source.y!);
      ctx.lineTo(target.x, target.y!);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    for (const node of nodes) {
      if (node.x === undefined || node.y === undefined) continue;
      const isHovered = hoveredNode === node.id;
      const isFocus = focusNodeId === node.id;
      const radius = (node.size ?? 4) * (isHovered || isFocus ? 1.5 : 1);

      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = resolveCanvasColor(canvas, node.color, palette.accent);
      ctx.globalAlpha = hoveredNode && !isHovered && !isFocus ? 0.3 : 1;
      ctx.fill();

      // Focus ring
      if (isFocus) {
        ctx.strokeStyle = palette.text;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius + 3, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.globalAlpha = 1;
    }

    // Labels last, as their own pass with greedy overlap rejection (BI-C2B6396B).
    // Drawing them inside the node loop meant every eligible label was painted
    // unconditionally and in arbitrary order, so a crowded centre became a pile of
    // overlapping text. Hovered and focused labels are drawn first and always win
    // their space; the rest take what is left and are skipped when they would
    // collide. A skipped label is not lost — hovering the node reveals it.
    const placed: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
    const labelled = nodes
      .filter((n) => n.x !== undefined && n.y !== undefined)
      .filter((n) => hoveredNode === n.id || focusNodeId === n.id || (n.size ?? 4) >= 6)
      .sort((a, b) => {
        const rank = (n: SimNode) =>
          (hoveredNode === n.id || focusNodeId === n.id ? 1000 : 0) + (n.size ?? 4);
        return rank(b) - rank(a);
      });

    ctx.textAlign = "center";
    for (const node of labelled) {
      const important = hoveredNode === node.id || focusNodeId === node.id;
      const fontSize = important ? 11 : 9;
      ctx.font = `${fontSize}px -apple-system, sans-serif`;
      const width = ctx.measureText(node.name).width;
      const radius = (node.size ?? 4) * (important ? 1.5 : 1);
      const x0 = node.x! - width / 2 - LABEL_PADDING;
      const x1 = node.x! + width / 2 + LABEL_PADDING;
      const y1 = node.y! - radius - 4;
      const y0 = y1 - fontSize - LABEL_PADDING;

      if (
        !important
        && placed.some((r) => !(x1 < r.x0 || x0 > r.x1 || y1 < r.y0 || y0 > r.y1))
      ) continue;

      placed.push({ x0, y0, x1, y1 });
      ctx.fillStyle = important ? palette.text : palette.muted;
      ctx.fillText(node.name, node.x!, y1);
    }
  }, [dimensions, hoveredNode, focusNodeId, linkLegend, palette]);

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

  // A resize moves the centre and changes the ideal separation, so let the layout
  // settle again rather than leaving nodes where the old geometry put them. Partial
  // re-heat: enough to rearrange, not so much that the graph jumps on every drag of
  // a window edge. Declared before the animation effect so the temperature is
  // already raised when that effect re-runs.
  useEffect(() => {
    temperatureRef.current = Math.max(temperatureRef.current, 0.4);
  }, [dimensions]);

  // Animation loop — runs only while the layout is still settling (BI-C2B6396B).
  //
  // This used to re-arm requestAnimationFrame unconditionally. Once cooled,
  // `simulate()` returned immediately but `draw()` kept repainting an unchanged
  // canvas at ~60fps for as long as the page was open — pinning a renderer thread
  // on both /inventory and /admin/graph-explorer, and timing out CDP screenshots
  // against the page, which is how it was noticed.
  //
  // Stopping is safe because every input that changes the picture re-runs this
  // effect: `filteredData` covers data and filter changes, and `draw`'s identity
  // changes with hover, focus, dimensions, and the link legend. The cooled branch
  // still paints one final frame, so a restart triggered purely by a repaint
  // concern (a hover, say) renders correctly without restarting the physics.
  useEffect(() => {
    let running = true;
    function tick() {
      if (!running) return;
      if (temperatureRef.current <= COOLED_TEMPERATURE) {
        draw();
        return;
      }
      simulate();
      draw();
      animRef.current = requestAnimationFrame(tick);
    }
    tick();
    return () => { running = false; cancelAnimationFrame(animRef.current); };
  }, [simulate, draw, filteredData]);

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
        setFocusNodeId((prev) => {
          const next = prev === node.id ? null : node.id;
          onFocusChange?.(next);
          return next;
        });
        return;
      }
    }
    setFocusNodeId(null);
    onFocusChange?.(null);
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
      <div className="text-center py-8 text-sm text-[var(--dpf-muted)]">{emptyMessage}</div>
    );
  }

  const focusNode = data.nodes.find((n) => n.id === focusNodeId);

  // `node.label` is the legend KEY — it is what the show/hide filters match on,
  // and for the graph explorer that key is the raw `graph_node.labels` value
  // ("PrismaModel", "ArchiMate__DataObject"). It must never reach the operator as
  // prose: the legend already carries the human name for exactly this key, so
  // resolve through it and fall back to the raw value only for a node whose type
  // has no legend entry (BI-AB7FE57B).
  const focusTypeName = focusNode
    ? (nodeLegend.find((entry) => entry.key === focusNode.label)?.label ?? focusNode.label)
    : "";

  return (
    <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
      {/* Controls toolbar */}
      <div className="flex items-start justify-between gap-4 mb-3 flex-wrap">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-widest text-[var(--dpf-muted)] mb-2">
            {title}
          </h3>

          {/* Focus node info */}
          {focusNode && (
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] text-[var(--dpf-muted)]">Focus:</span>
              <span className="text-xs text-[var(--dpf-text)] font-medium">{focusNode.name}</span>
              <span className="text-[9px] px-1 rounded" style={{ background: `${focusNode.color}20`, color: focusNode.color }}>
                {focusTypeName}
              </span>
              <button
                type="button"
                onClick={() => {
                  setFocusNodeId(null);
                  onFocusChange?.(null);
                }}
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
            {nodeLegend.map((l) => {
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
            {linkLegend.map((l) => {
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
          <div className="absolute bottom-2 left-2 text-[9px] text-[var(--dpf-muted)]">{hint}</div>
        )}
      </div>
    </div>
  );
}
