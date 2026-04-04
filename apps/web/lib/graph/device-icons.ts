// Device-type visual differentiation for network topology views.
// Used by both the graph canvas renderer and the inventory panel.

export type DeviceVisual = {
  symbol: string;
  color: string;
  size: number;
  label: string;
};

export const DEVICE_VISUALS: Record<string, DeviceVisual> = {
  router:          { symbol: "\u25B3", color: "#f472b6", size: 8, label: "Router" },
  gateway:         { symbol: "\u25B3", color: "#f472b6", size: 8, label: "Gateway" },
  switch:          { symbol: "\u25C7", color: "#a78bfa", size: 7, label: "Switch" },
  access_point:    { symbol: "\u25CE", color: "#38bdf8", size: 7, label: "Access Point" },
  network_client:  { symbol: "\u25CF", color: "#22d3ee", size: 4, label: "Client" },
  subnet:          { symbol: "\u25A2", color: "#fbbf24", size: 6, label: "Subnet" },
  vlan:            { symbol: "\u25AC", color: "#fb923c", size: 5, label: "VLAN" },
  network_interface: { symbol: "\u25C6", color: "#94a3b8", size: 4, label: "Interface" },
  docker_host:     { symbol: "\u2B21", color: "#34d399", size: 8, label: "Docker Host" },
  container:       { symbol: "\u2B22", color: "#34d399", size: 4, label: "Container" },
  monitoring_service: { symbol: "\u25C9", color: "#fbbf24", size: 5, label: "Monitor" },
  host:            { symbol: "\u25A0", color: "#64748b", size: 5, label: "Host" },
  service:         { symbol: "\u25C6", color: "#4ade80", size: 5, label: "Service" },
  application:     { symbol: "\u25C6", color: "#4ade80", size: 5, label: "Application" },
  database:        { symbol: "\u25A3", color: "#c084fc", size: 6, label: "Database" },
  ai_service:      { symbol: "\u2606", color: "#e879f9", size: 6, label: "AI Service" },
  network_device:  { symbol: "\u25CF", color: "#38bdf8", size: 5, label: "Network Device" },
};

const DEFAULT_VISUAL: DeviceVisual = { symbol: "\u25CF", color: "#38bdf8", size: 5, label: "Unknown" };

export function getDeviceVisual(ciType: string | undefined | null): DeviceVisual {
  if (!ciType) return DEFAULT_VISUAL;
  return DEVICE_VISUALS[ciType] ?? DEFAULT_VISUAL;
}

/** Key device types to show in the graph legend. */
export const LEGEND_ENTRIES: Array<{ ciType: string; visual: DeviceVisual }> = [
  { ciType: "router", visual: DEVICE_VISUALS.router! },
  { ciType: "switch", visual: DEVICE_VISUALS.switch! },
  { ciType: "access_point", visual: DEVICE_VISUALS.access_point! },
  { ciType: "network_client", visual: DEVICE_VISUALS.network_client! },
  { ciType: "subnet", visual: DEVICE_VISUALS.subnet! },
  { ciType: "container", visual: DEVICE_VISUALS.container! },
];
