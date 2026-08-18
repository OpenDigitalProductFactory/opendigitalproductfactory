type Point = { x?: number; y?: number };

type Viewport = { width: number; height: number };

type FitOptions = {
  padding?: number;
  minZoom?: number;
  maxZoom?: number;
};

export type ViewportTransform = {
  zoom: number;
  pan: { x: number; y: number };
};

export function fitNodesToViewport(
  nodes: Point[],
  viewport: Viewport,
  options: FitOptions = {},
): ViewportTransform {
  const positioned = nodes.filter(
    (node): node is Required<Point> => Number.isFinite(node.x) && Number.isFinite(node.y),
  );
  if (positioned.length === 0) {
    return { zoom: 1, pan: { x: 0, y: 0 } };
  }

  const padding = options.padding ?? 50;
  const minZoom = options.minZoom ?? 0.1;
  const maxZoom = options.maxZoom ?? 1;
  const xs = positioned.map((node) => node.x);
  const ys = positioned.map((node) => node.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const graphWidth = Math.max(1, maxX - minX);
  const graphHeight = Math.max(1, maxY - minY);
  const availableWidth = Math.max(1, viewport.width - padding * 2);
  const availableHeight = Math.max(1, viewport.height - padding * 2);
  const zoom = Math.max(
    minZoom,
    Math.min(maxZoom, availableWidth / graphWidth, availableHeight / graphHeight),
  );

  return {
    zoom,
    pan: {
      x: viewport.width / 2 - ((minX + maxX) / 2) * zoom,
      y: viewport.height / 2 - ((minY + maxY) / 2) * zoom,
    },
  };
}
