"use client";

import { useRef, useEffect, useState, useCallback, useMemo, useTransition } from "react";
import { getImpactData, getDependencyAuditData, type GraphData } from "@/lib/actions/graph";
import type { GraphViewName, PositionedNode, LayoutResult } from "@/lib/graph/types";
import { VIEW_CONFIGS, resolveViewForTaxonomy } from "@/lib/graph/view-config";
import { useGraphLayout } from "@/lib/graph/use-graph-layout";
import { getDeviceVisual } from "@/lib/graph/device-icons";
import { isDockerOriginNode } from "@/lib/graph/docker-filter";
import { describeGraphScope } from "@/lib/graph/subnet-scope";
import { projectPhysicalTopology } from "@/lib/graph/physical-topology";
import { createScopeToken, isResetScopeKey, isSubnetSelectorKey, resolveDisplayedGraphData, resolveSubnetScopeState, shouldShowViewportReset } from "@/lib/graph/topology-graph-state";
import { usePhysicalTopologyViewport } from "@/lib/graph/use-physical-topology-viewport";
import { TopologyIntegritySummary } from "@/components/inventory/TopologyIntegritySummary";
import { TopologyLegend } from "@/components/inventory/TopologyLegend";
import { OSI_LAYER_NAMES, SHOW_DOCKER_STORAGE_KEY, TOPOLOGY_GRAPH_LIVE_REGION_PROPS } from "@/lib/graph/topology-constants";
import { resolveCanvasColor, useCanvasTheme, type CanvasTheme } from "./canvas-theme";

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
  const scopeSequenceRef = useRef(0);
  const [dimensions, setDimensions] = useState({ width: 800, height: 500 });
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [focusNodeId, setFocusNodeId] = useState<string | null>(initialFocusNodeId ?? null);
  const [maxHops, setMaxHops] = useState(0);
  const [liveMessage, setLiveMessage] = useState("");
  const palette = useCanvasTheme(canvasRef);

  // Pan and zoom state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [hasViewportInteraction, setHasViewportInteraction] = useState(false);
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  // View selection
  const autoView = defaultView ?? resolveViewForTaxonomy(taxonomyNodeId ?? null);
  const [selectedView, setSelectedView] = useState<GraphViewName>(autoView);
  const viewConfig = VIEW_CONFIGS[selectedView];
  const isForceLayout = viewConfig.layout === "force";
  const [isPending, startTransition] = useTransition();
  const [dynamicData, setDynamicData] = useState<GraphData | null>(null);
  const effectiveData = useMemo(() => dynamicData ?? data, [dynamicData, data]);

  const [showDocker, setShowDocker] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(SHOW_DOCKER_STORAGE_KEY) === "1";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SHOW_DOCKER_STORAGE_KEY, showDocker ? "1" : "0");
  }, [showDocker]);
  const hideDocker = !showDocker;

  // Subnet filter (for subnet-topology view)
  const [activeSubnetId, setActiveSubnetId] = useState<string | null>(null);
  const [scopeToken, setScopeToken] = useState(() =>
    createScopeToken(scopeSequenceRef.current, autoView, null),
  );
  const availableSubnets = useMemo(() => {
    if (selectedView !== "subnet-topology") return [];
    return effectiveData.nodes
      .filter((n) => {
        const ct = (n as Record<string, unknown>).ciType;
        if (ct !== "subnet" && ct !== "vlan") return false;
        if (hideDocker && isDockerOriginNode(n)) return false;
        return true;
      })
      .map((n) => ({ id: n.id, name: n.name }))
      .sort((a, b) => {
        const aDocker = a.name.startsWith("Docker:");
        const bDocker = b.name.startsWith("Docker:");
        if (aDocker !== bDocker) return aDocker ? 1 : -1;
        return a.name.localeCompare(b.name);
      });
  }, [effectiveData.nodes, hideDocker, selectedView]);

  const scopeState = useMemo(
    () => resolveSubnetScopeState(effectiveData, selectedView, activeSubnetId),
    [effectiveData, selectedView, activeSubnetId],
  );
  const filteredData = useMemo(
    () => resolveDisplayedGraphData(effectiveData, selectedView, activeSubnetId, focusNodeId, maxHops, hideDocker),
    [effectiveData, selectedView, activeSubnetId, focusNodeId, maxHops, hideDocker],
  );
  const physicalProjection = useMemo(() => projectPhysicalTopology(filteredData), [filteredData]);

  // Layout computation
  const layoutResult = useGraphLayout(filteredData, viewConfig, focusNodeId, dimensions, scopeToken);
  const isLayoutPending = !isForceLayout && layoutResult == null;
  const isSubnetScoped = selectedView === "subnet-topology" && activeSubnetId != null;
  const activeSubnet = useMemo(
    () => availableSubnets.find((subnet) => subnet.id === activeSubnetId) ?? null,
    [availableSubnets, activeSubnetId],
  );

  const fitPhysicalTopology = usePhysicalTopologyViewport(layoutResult, dimensions, selectedView, setZoom, setPan);

  useEffect(() => {
    setHasViewportInteraction(false);
  }, [scopeToken, selectedView]);

  // Force simulation state (only for exploration view)
  const nodesRef = useRef<SimNode[]>([]);
  const animRef = useRef<number>(0);
  const temperatureRef = useRef(1.0);

  const bumpScopeToken = useCallback(
    (nextSelectedView: GraphViewName, nextActiveSubnetId: string | null) => {
      setScopeToken(
        createScopeToken(++scopeSequenceRef.current, nextSelectedView, nextActiveSubnetId),
      );
    },
    [],
  );

  const applySubnetSelection = useCallback(
    (nextActiveSubnetId: string | null) => {
      setActiveSubnetId(nextActiveSubnetId);
      bumpScopeToken(selectedView, nextActiveSubnetId);
    },
    [bumpScopeToken, selectedView],
  );

  useEffect(() => {
    if (!scopeState.invalidScope) {
      return;
    }

    setActiveSubnetId(null);
    bumpScopeToken(selectedView, null);
    setHoveredNode(null);
    setFocusNodeId(null);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [bumpScopeToken, scopeState.invalidScope, selectedView]);

  useEffect(() => {
    if (focusNodeId && !filteredData.nodes.some((node) => node.id === focusNodeId)) {
      setFocusNodeId(null);
    }
  }, [filteredData.nodes, focusNodeId]);

  // If the Docker toggle hides the currently-selected subnet, drop the
  // selection so the dropdown falls back to "All subnets". We skip when
  // the subnet has gone missing from the underlying graph too — the
  // invalidScope effect above already resets in that case, and stacking
  // both bumps the scope-token sequence twice for the same event.
  useEffect(() => {
    if (!activeSubnetId) return;
    if (scopeState.invalidScope) return;
    if (!availableSubnets.some((s) => s.id === activeSubnetId)) {
      applySubnetSelection(null);
    }
  }, [activeSubnetId, applySubnetSelection, availableSubnets, scopeState.invalidScope]);

  useEffect(() => {
    if (selectedView !== "subnet-topology") {
      return;
    }

    setHoveredNode(null);
    setFocusNodeId(null);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [selectedView, activeSubnetId]);

  useEffect(() => {
    if (scopeState.invalidScope) {
      return;
    }
    setLiveMessage(
      describeGraphScope(
        filteredData,
        selectedView,
        activeSubnetId ?? "all",
        availableSubnets,
      ),
    );
  }, [activeSubnetId, availableSubnets, filteredData, scopeState.invalidScope, selectedView]);

  const handleSubnetSelectionKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLSelectElement>) => {
      if (!isSubnetSelectorKey(event.key)) {
        return;
      }

      const nextActiveSubnetId = event.currentTarget.value === "all"
        ? null
        : event.currentTarget.value;
      event.preventDefault?.();
      applySubnetSelection(nextActiveSubnetId);
    },
    [applySubnetSelection],
  );

  const handleResetSubnetScopeKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (!isResetScopeKey(event.key)) {
        return;
      }

      event.preventDefault?.();
      applySubnetSelection(null);
    },
    [applySubnetSelection],
  );

  useEffect(() => {
    if (selectedView === "impact-blast-radius" && focusNodeId) {
      startTransition(async () => {
        const result = await getImpactData(focusNodeId);
        setDynamicData(result);
      });
    } else if (selectedView === "dependency-audit" && focusNodeId) {
      startTransition(async () => {
        const result = await getDependencyAuditData(focusNodeId);
        setDynamicData(result);
      });
    } else {
      setDynamicData(null);
    }
  }, [selectedView, focusNodeId]);

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
    if (!isForceLayout && !isPositioned) {
      ctx.clearRect(0, 0, dimensions.width, dimensions.height);
      return;
    }
    const drawNodes: PositionedNode[] = isPositioned
      ? layoutResult.nodes
      : nodesRef.current;
    const drawLinks = isPositioned
      ? layoutResult.links
      : filteredData.links;
    const nodeMap = new Map(drawNodes.map((n) => [n.id, n]));

    ctx.clearRect(0, 0, dimensions.width, dimensions.height);

    // Apply zoom and pan transform
    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    // Draw swimlane bands if in swimlane mode
    if (viewConfig.layout === "swimlane" && isPositioned) {
      drawSwimlaneBands(ctx, layoutResult.nodes, dimensions, palette);
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

      const linkColor = link.type === "UPLINKS_TO" ? LINK_COLORS.DEPENDS_ON : LINK_COLORS[link.type];
      const resolvedLinkColor = resolveCanvasColor(canvas, linkColor, palette.border);
      ctx.strokeStyle = resolvedLinkColor;
      ctx.globalAlpha = isHighlighted ? 1 : palette.edgeAlpha;
      ctx.lineWidth = isHighlighted ? 2 : palette.isDark ? 0.7 : 1;
      ctx.beginPath();
      ctx.moveTo(source.x, source.y);
      ctx.lineTo(target.x, target.y);
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Edge label on hover
      if (isHighlighted) {
        const mx = (source.x + target.x) / 2;
        const my = (source.y + target.y) / 2;
        ctx.font = "9px -apple-system, sans-serif";
        ctx.fillStyle = resolvedLinkColor;
        ctx.textAlign = "center";
        ctx.fillText(link.type, mx, my - 4);
      }
    }

    // Draw nodes
    for (const node of drawNodes) {
      if (node.x == null || node.y == null) continue;
      const isHovered = hoveredNode === node.id;
      const isFocus = focusNodeId === node.id;
      const ciType = (node as { ciType?: string }).ciType;
      const dv = ciType ? getDeviceVisual(ciType) : null;
      const nodeColor = resolveCanvasColor(canvas, dv?.color ?? node.color, palette.accent);
      const radius = (dv?.size ?? node.size ?? 4) * (isHovered || isFocus ? 1.5 : 1);
      const topologyVisualScale = selectedView === "network-topology" ? Math.max(zoom, 0.65) : 1;
      const renderRadius = radius / topologyVisualScale;

      ctx.globalAlpha = hoveredNode && !isHovered && !isFocus ? 0.3 : 1;

      if (dv && node.label === "InfraCI") {
        // Draw device-type symbol instead of circle
        const fontSize = Math.max(12, radius * 2.5) / topologyVisualScale;
        ctx.font = `${fontSize}px -apple-system, sans-serif`;
        ctx.fillStyle = nodeColor;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(dv.symbol, node.x, node.y);
        ctx.textBaseline = "alphabetic";
      } else {
        // Default circle for non-InfraCI nodes
        ctx.beginPath();
        ctx.arc(node.x, node.y, renderRadius, 0, Math.PI * 2);
        ctx.fillStyle = nodeColor;
        ctx.fill();
      }

      if (isFocus) {
        ctx.strokeStyle = palette.text;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(node.x, node.y, renderRadius + 3 / topologyVisualScale, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.globalAlpha = 1;

      const showPhysicalLabel = selectedView === "network-topology" && zoom >= 0.55;
      if (isHovered || isFocus || showPhysicalLabel || (dv?.size ?? node.size) >= 6 || !isPositioned) {
        const labelSize = (isHovered || isFocus ? 11 : 9) / topologyVisualScale;
        const label = showPhysicalLabel && node.name.length > 18
          ? `${node.name.slice(0, 17)}\u2026`
          : node.name;
        ctx.font = `${labelSize}px -apple-system, sans-serif`;
        ctx.fillStyle = isHovered || isFocus ? palette.text : palette.muted;
        ctx.textAlign = "center";
        ctx.fillText(label, node.x, node.y - renderRadius - 6 / topologyVisualScale);
      }
    }
    ctx.restore();
  }, [dimensions, hoveredNode, focusNodeId, layoutResult, filteredData.links, isForceLayout, zoom, pan, palette, selectedView, viewConfig.layout]);

  // ─── Initialize force simulation nodes ────────────────────────────────
  useEffect(() => {
    if (!isForceLayout || layoutResult != null) return;
    nodesRef.current = filteredData.nodes.map((n) => ({
      ...n,
      x: dimensions.width / 2 + (Math.random() - 0.5) * 300,
      y: dimensions.height / 2 + (Math.random() - 0.5) * 200,
      vx: 0,
      vy: 0,
    }));
    temperatureRef.current = 1.0;
  }, [filteredData.nodes, layoutResult, dimensions, isForceLayout]);

  // ─── Resize observer ──────────────────────────────────────────────────
  useEffect(() => {
    const container = canvasRef.current?.parentElement;
    if (!container) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width } = entry.contentRect;
        setDimensions({ width, height: Math.max(500, Math.min(800, width * 0.65)) });
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
      if (isForceLayout && layoutResult == null) simulate();
      draw();
      animRef.current = requestAnimationFrame(tick);
    }
    tick();
    return () => { running = false; cancelAnimationFrame(animRef.current); };
  }, [simulate, draw, layoutResult, isForceLayout]);

  // Convert screen coordinates to graph coordinates (accounting for zoom/pan)
  function screenToGraph(screenX: number, screenY: number) {
    return {
      x: (screenX - pan.x) / zoom,
      y: (screenY - pan.y) / zoom,
    };
  }

  // ─── Click to focus ───────────────────────────────────────────────────
  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (isPanningRef.current) return; // Don't select after a drag
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const { x: mx, y: my } = screenToGraph(e.clientX - rect.left, e.clientY - rect.top);

    const drawNodes = layoutResult?.nodes ?? nodesRef.current;
    const hitRadius = 6 / zoom; // Adjust hit area for zoom level
    for (const node of drawNodes) {
      if (node.x == null || node.y == null) continue;
      const dx = mx - node.x;
      const dy = my - node.y;
      if (dx * dx + dy * dy < ((node.size ?? 4) + hitRadius) ** 2) {
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

    // Handle panning via middle-click or left-click drag
    if (isPanningRef.current) {
      setHasViewportInteraction(true);
      setPan({
        x: panStartRef.current.panX + (e.clientX - panStartRef.current.x),
        y: panStartRef.current.panY + (e.clientY - panStartRef.current.y),
      });
      return;
    }

    const { x: mx, y: my } = screenToGraph(e.clientX - rect.left, e.clientY - rect.top);
    const hitRadius = 4 / zoom;

    const drawNodes = layoutResult?.nodes ?? nodesRef.current;
    let found: string | null = null;
    for (const node of drawNodes) {
      if (node.x == null || node.y == null) continue;
      const dx = mx - node.x;
      const dy = my - node.y;
      if (dx * dx + dy * dy < ((node.size ?? 4) + hitRadius) ** 2) {
        found = node.id;
        break;
      }
    }
    setHoveredNode(found);
  }

  // ─── Scroll to zoom (native handler to prevent page scroll) ─────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      e.stopPropagation();
      const rect = canvas!.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
      setHasViewportInteraction(true);
      setZoom((prev) => {
        const next = Math.max(0.2, Math.min(5, prev * zoomFactor));
        setPan((p) => ({
          x: mouseX - (mouseX - p.x) * (next / prev),
          y: mouseY - (mouseY - p.y) * (next / prev),
        }));
        return next;
      });
    }
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

  // ─── Mouse down/up for panning ────────────────────────────────────────
  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    // Right-click or middle-click or shift+left-click to pan
    if (e.button === 1 || e.button === 2 || e.shiftKey) {
      e.preventDefault();
      isPanningRef.current = true;
      panStartRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    }
  }

  function handleMouseUp() {
    isPanningRef.current = false;
  }

  if (effectiveData.nodes.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-[var(--dpf-muted)]">
        No graph data available. Discovery runs automatically every 15 minutes.
      </div>
    );
  }

  const focusNode = filteredData.nodes.find((n) => n.id === focusNodeId) ?? null;
  const displayNodes = isLayoutPending
    ? filteredData.nodes
    : layoutResult?.nodes ?? nodesRef.current;
  const displayLinks = isLayoutPending
    ? filteredData.links
    : layoutResult?.links ?? filteredData.links;

  return (
    <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 -mx-6 lg:-mx-8">
      <p {...TOPOLOGY_GRAPH_LIVE_REGION_PROPS} className="sr-only">
        {liveMessage}
      </p>
      {/* ─── Toolbar ──────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 mb-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          {/* View selector */}
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] text-[var(--dpf-muted)]">View:</span>
            <select
              value={selectedView}
              onChange={(e) => setSelectedView(e.target.value as GraphViewName)}
              aria-label="Select graph view"
              className="text-[10px] bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded px-1.5 py-0.5 text-[var(--dpf-text)]"
            >
              {Object.values(VIEW_CONFIGS).map((vc) => (
                <option key={vc.name} value={vc.name}>
                  {vc.label}
                </option>
              ))}
            </select>
          </div>

          {/* Show-Docker toggle. Off by default — the topology view is
              normally used to look OUT from the platform at the real LAN,
              and Docker bridges add one noisy subnet per compose network.
              Operators debugging the platform itself can opt in here. */}
          <label className="flex items-center gap-1 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showDocker}
              onChange={(e) => setShowDocker(e.target.checked)}
              aria-label="Show Docker-internal subnets and containers"
              className="h-3 w-3 accent-[var(--dpf-accent)]"
            />
            <span className="text-[9px] text-[var(--dpf-muted)]">Show Docker</span>
          </label>

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
                  className="text-[9px] px-1.5 py-0.5 rounded border border-[var(--dpf-error)]/30 text-[var(--dpf-error)] hover:bg-[var(--dpf-error)]/10"
                >
                  Analyze Impact
                </button>
              )}
            </div>
          )}
        </div>

        {/* Subnet filter (only for subnet-topology view) */}
        {selectedView === "subnet-topology" && availableSubnets.length > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] text-[var(--dpf-muted)]">Subnet:</span>
            <select
              value={activeSubnetId ?? "all"}
              onChange={(e) => {
                const nextActiveSubnetId = e.target.value === "all" ? null : e.target.value;
                applySubnetSelection(nextActiveSubnetId);
              }}
              onKeyDown={handleSubnetSelectionKeyDown}
              aria-label="Filter graph by subnet"
              className="text-[10px] bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded px-1.5 py-0.5 text-[var(--dpf-text)]"
            >
              <option value="all">All subnets</option>
              {availableSubnets.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => applySubnetSelection(null)}
              onKeyDown={handleResetSubnetScopeKeyDown}
              disabled={!isSubnetScoped}
              aria-label="Reset subnet scope"
              className="text-[9px] rounded border border-[var(--dpf-border)] px-1.5 py-0.5 text-[var(--dpf-muted)] enabled:hover:text-[var(--dpf-text)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Reset
            </button>
            {isSubnetScoped && (
              <span className="text-[9px] text-[var(--dpf-text)]">
                Scoped to {activeSubnet?.name ?? activeSubnetId}
              </span>
            )}
          </div>
        )}

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

      {selectedView === "network-topology" && (
        <TopologyIntegritySummary integrity={physicalProjection.integrity} />
      )}

      {/* ─── Canvas ──────────────────────────────────────────────────── */}
      <div className="relative w-full h-full">
        <canvas
          ref={canvasRef}
          width={dimensions.width}
          height={dimensions.height}
          aria-label={liveMessage}
          onClick={handleClick}
          onMouseMove={handleMouseMove}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => { setHoveredNode(null); isPanningRef.current = false; }}
          onContextMenu={(e) => e.preventDefault()}
          style={{
            width: "100%",
            height: dimensions.height,
            cursor: isPanningRef.current ? "grabbing" : hoveredNode ? "pointer" : "grab",
          }}
        />
        {!isForceLayout && layoutResult == null && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-[var(--dpf-muted)]">
            Updating graph...
          </div>
        )}
        {selectedView === "network-topology" && filteredData.nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center px-8 text-center text-xs text-[var(--dpf-muted)]">
            No physical topology is available. Verify the UniFi connection and run discovery. Use Subnet Inventory for address membership.
          </div>
        )}
        {isPending && (
          <div className="absolute inset-0 flex items-center justify-center bg-[var(--dpf-bg)]/60">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--dpf-accent)] border-t-transparent" />
          </div>
        )}
        <TopologyLegend physical={selectedView === "network-topology"} />
        <div className="absolute bottom-2 right-2 text-[9px] text-[var(--dpf-muted)] flex items-center gap-2">
          <span>
            {displayNodes.length} nodes / {displayLinks.length} edges
            {isSubnetScoped ? " / scoped" : ""}
          </span>
          <span>{Math.round(zoom * 100)}%</span>
          {shouldShowViewportReset(selectedView, hasViewportInteraction, zoom, pan) && (
            <button
              type="button"
              onClick={() => {
                if (selectedView === "network-topology") fitPhysicalTopology();
                else {
                  setZoom(1);
                  setPan({ x: 0, y: 0 });
                }
                setHasViewportInteraction(false);
              }}
              className="text-[9px] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] underline"
            >
              reset
            </button>
          )}
        </div>
        {!focusNodeId && (
          <div className="absolute top-2 right-2 text-[9px] text-[var(--dpf-muted)]">
            Scroll to zoom / Shift-drag to pan / Click to focus
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

function drawSwimlaneBands(
  ctx: CanvasRenderingContext2D,
  nodes: PositionedNode[],
  dimensions: { width: number; height: number },
  palette: CanvasTheme,
) {
  // Check if nodes have partition (subnet view) or osiLayer (dependency view)
  const hasPartitions = nodes.some((n) => (n as { partition?: unknown }).partition != null);

  if (hasPartitions) {
    // Subnet-based bands
    const partitionRanges = new Map<string, { min: number; max: number; name: string }>();
    for (const node of nodes) {
      const p = (node as { partition?: string | number }).partition;
      if (p == null) continue;
      const key = String(p);
      const range = partitionRanges.get(key);
      if (range) {
        range.min = Math.min(range.min, node.y - 20);
        range.max = Math.max(range.max, node.y + 20);
      } else {
        // Use node name for subnet nodes as band label
        const label = node.name.length < 40 ? node.name : key;
        partitionRanges.set(key, { min: node.y - 20, max: node.y + 20, name: label });
      }
    }

    let idx = 0;
    for (const [, range] of partitionRanges) {
      const bandY = range.min - 10;
      const bandH = range.max - range.min + 20;
      const isDocker = range.name.startsWith("Docker:") || range.name.startsWith("172.");

      ctx.save();
      ctx.globalAlpha = idx % 2 === 0 ? 0.04 : 0.07;
      ctx.fillStyle = isDocker ? palette.success : palette.text;
      ctx.fillRect(0, bandY, dimensions.width, bandH);
      ctx.restore();

      ctx.font = "9px -apple-system, sans-serif";
      ctx.fillStyle = isDocker ? palette.success : palette.muted;
      ctx.textAlign = "left";
      ctx.fillText(range.name, 8, bandY + 12);
      idx++;
    }
  } else {
    // OSI layer bands (original behavior)
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

      ctx.save();
      ctx.globalAlpha = layer % 2 === 0 ? 0.04 : 0.07;
      ctx.fillStyle = palette.text;
      ctx.fillRect(0, bandY, dimensions.width, bandH);
      ctx.restore();

      ctx.font = "9px -apple-system, sans-serif";
      ctx.fillStyle = palette.muted;
      ctx.textAlign = "left";
      ctx.fillText(`L${layer} ${OSI_LAYER_NAMES[layer] ?? ""}`, 8, bandY + 12);
    }
  }
}
