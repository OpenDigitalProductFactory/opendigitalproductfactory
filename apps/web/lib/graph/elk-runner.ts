// The one ELK entry point for every graph layout in the portal (plan 2026-09-08 S10).
//
// The EA canvas, the topology views (hierarchical, swimlane) and the People org chart all lay
// out through here. `dagre` was retired on 2026-09-26: ELK's `layered` algorithm is the same
// Sugiyama family, so one engine covers every hierarchical view.
//
// ELK in a Web Worker for large graphs (BI-7060F7C5): `elk.bundled.js` runs the GWT layout
// SYNCHRONOUSLY in the calling thread, so large views froze the UI during layout. Graphs at or
// above the threshold go through a Web Worker; SSR/Node, small graphs and any worker failure
// fall back to the in-thread bundled ELK, which runs in Node as well as the browser. The worker
// can only make layout smoother, never break it.

const ELK_WORKER_NODE_THRESHOLD = 100;
const ELK_WORKER_TIMEOUT_MS = 60_000;

export type ElkInput = {
  id: string;
  layoutOptions?: Record<string, string>;
  children?: unknown[];
  edges?: unknown[];
};
export type ElkLaidOutNode = {
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  children?: ElkLaidOutNode[];
};
export type ElkLaidOut = { children?: ElkLaidOutNode[] };

let elkWorker: Worker | null | undefined; // undefined = untried; null = unavailable (use in-thread)
let elkWorkerSeq = 0;
const elkWorkerPending = new Map<
  number,
  { resolve: (r: ElkLaidOut) => void; reject: (e: unknown) => void; timer: ReturnType<typeof setTimeout> }
>();

function getElkWorker(): Worker | null {
  if (elkWorker !== undefined) return elkWorker;
  if (typeof window === "undefined" || typeof Worker === "undefined") return (elkWorker = null);
  try {
    const w = new Worker(new URL("./elk.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent) => {
      const { id, result, error } = e.data as { id: number; result?: ElkLaidOut; error?: string };
      const pending = elkWorkerPending.get(id);
      if (!pending) return;
      clearTimeout(pending.timer);
      elkWorkerPending.delete(id);
      if (error) pending.reject(new Error(error));
      else pending.resolve(result ?? {});
    };
    w.onerror = () => {
      for (const p of elkWorkerPending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error("elk worker error"));
      }
      elkWorkerPending.clear();
      elkWorker = null; // disable → future layouts run in-thread
    };
    return (elkWorker = w);
  } catch {
    return (elkWorker = null);
  }
}

/** Run an ELK layout: off the main thread for large graphs, in-thread otherwise or on failure. */
export async function elkLayout(graph: ElkInput, nodeCount: number): Promise<ElkLaidOut> {
  if (nodeCount >= ELK_WORKER_NODE_THRESHOLD) {
    const w = getElkWorker();
    if (w) {
      try {
        return await new Promise<ElkLaidOut>((resolve, reject) => {
          const id = ++elkWorkerSeq;
          const timer = setTimeout(() => {
            elkWorkerPending.delete(id);
            reject(new Error("elk worker timeout"));
          }, ELK_WORKER_TIMEOUT_MS);
          elkWorkerPending.set(id, { resolve, reject, timer });
          w.postMessage({ id, graph });
        });
      } catch {
        // worker failed/timed out → fall through to the in-thread layout (no regression)
      }
    }
  }
  const ELK = (await import("elkjs/lib/elk.bundled.js")).default;
  return (await new ELK().layout(graph as Parameters<InstanceType<typeof ELK>["layout"]>[0])) as ElkLaidOut;
}

// ── Layered (Sugiyama) layout for rank-based views ──────────────────────────

export type LayeredDirection = "TB" | "LR";

export type LayeredNode = {
  id: string;
  width: number;
  height: number;
  /** Swimlane partition index. Lower indexes are placed first along the direction. */
  partition?: number;
};

export type LayeredEdge = { source: string; target: string };

export type LayeredOptions = {
  direction: LayeredDirection;
  /** Gap between ranks (layers), along the direction. */
  rankSep: number;
  /** Gap between nodes in the same rank. */
  nodeSep: number;
};

/**
 * Lay out nodes in ranks with ELK `layered` and return TOP-LEFT positions keyed by node id.
 *
 * Every node is laid out in one layering, so disconnected roots share the first rank, as they
 * did under dagre. ELK's default would lay out each connected component on its own and pack
 * them, which stacks separate trees on top of each other and breaks swimlane bands.
 *
 * Padding is zero, so the drawing's bounding box starts at the origin.
 */
export async function computeLayeredPositions(
  nodes: LayeredNode[],
  edges: LayeredEdge[],
  options: LayeredOptions,
): Promise<Map<string, { x: number; y: number }>> {
  const positions = new Map<string, { x: number; y: number }>();
  if (nodes.length === 0) return positions;

  const ids = new Set(nodes.map((n) => n.id));
  const partitioned = nodes.some((n) => n.partition != null);

  const children = nodes.map((n) => ({
    id: n.id,
    width: n.width,
    height: n.height,
    ...(n.partition != null
      ? { layoutOptions: { "elk.partitioning.partition": String(n.partition) } }
      : {}),
  }));
  const elkEdges = edges
    .filter((e) => ids.has(e.source) && ids.has(e.target))
    .map((e, i) => ({ id: `e${i}`, sources: [e.source], targets: [e.target] }));

  const laidOut = await elkLayout(
    {
      id: "root",
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": options.direction === "LR" ? "RIGHT" : "DOWN",
        "elk.padding": "[top=0,left=0,bottom=0,right=0]",
        "elk.separateConnectedComponents": "false",
        "elk.layered.spacing.nodeNodeBetweenLayers": String(options.rankSep),
        "elk.spacing.nodeNode": String(options.nodeSep),
        "elk.layered.cycleBreaking.strategy": "GREEDY",
        // Keep the caller's order for peers where it costs no crossings (dagre did), so a
        // manager's reports and a switch's hosts read in a stable order between renders.
        "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
        // Balanced Brandes-Koepf centres a parent over its children, as dagre did.
        "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
        "elk.layered.nodePlacement.bk.fixedAlignment": "BALANCED",
        ...(partitioned ? { "elk.partitioning.activate": "true" } : {}),
      },
      children,
      edges: elkEdges,
    },
    nodes.length,
  );

  for (const child of laidOut.children ?? []) {
    positions.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 });
  }
  return positions;
}
