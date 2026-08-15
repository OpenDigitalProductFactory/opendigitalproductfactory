export const SHOW_DOCKER_STORAGE_KEY = "dpf:topology:show-docker";

export const OSI_LAYER_NAMES: Record<number, string> = {
  7: "Application",
  6: "Presentation",
  5: "Session",
  4: "Transport",
  3: "Network",
  2: "Data Link",
  1: "Physical",
};

export const TOPOLOGY_GRAPH_LIVE_REGION_PROPS = {
  "aria-live": "polite",
  "aria-atomic": "true",
} as const;
