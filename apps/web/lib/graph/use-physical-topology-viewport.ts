import { useCallback, useEffect, type Dispatch, type SetStateAction } from "react";

import type { GraphViewName, LayoutResult } from "./types";
import { fitNodesToViewport } from "./viewport-fit";

type Pan = { x: number; y: number };

export function usePhysicalTopologyViewport(
  layout: LayoutResult | null,
  dimensions: { width: number; height: number },
  selectedView: GraphViewName,
  setZoom: Dispatch<SetStateAction<number>>,
  setPan: Dispatch<SetStateAction<Pan>>,
) {
  const fit = useCallback(() => {
    if (!layout) return;
    const transform = fitNodesToViewport(layout.nodes, dimensions, { padding: 60 });
    setZoom(transform.zoom);
    setPan(transform.pan);
  }, [dimensions, layout, setPan, setZoom]);

  useEffect(() => {
    if (selectedView === "network-topology" && layout) fit();
  }, [fit, layout, selectedView]);

  return fit;
}
