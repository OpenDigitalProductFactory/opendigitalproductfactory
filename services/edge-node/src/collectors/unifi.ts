// UniFi adapter (Slice A — discovery only).
//
// Pulls the list of UniFi-managed network devices (switches, access
// points, gateways) from a local UniFi Network controller and emits
// them as ObservationItem records. Each device gets a SAME_AS link to
// the `arp:<ip>` key the ARP collector already produces, so the
// Authority Core's normalization can collapse the two into a single
// canonical Configuration Item. Parent-child device topology
// (gateway → switch → AP) is emitted as HOSTS relationships using the
// controller's `uplink.uplink_mac` field.
//
// What's NOT in this slice (lands in Slice B):
//   - Per-port throughput telemetry (rx_bytes-r / tx_bytes-r). That
//     needs the metrics.network capability + /api/v1/edge/metrics
//     endpoint, neither of which exist yet.
//   - WebSocket event subscription for instant-on device joins.
//     5-minute sweep cadence is fine for v1.
//   - PoE wattage per port.
//
// Auth: API-key header (`X-API-KEY`). UniFi Network 9.x+ generates
// API keys in Settings → System → API. Cookie-session local auth is
// out of scope for Slice A; if it's needed later, gate on whether
// config.apiKey is empty and fall through to a /api/auth/login flow.
//
// TLS: many home UniFi installs use a self-signed cert. The
// `tlsInsecure` config flag opts into accepting any cert by swapping
// in an undici Agent. We never silently accept invalid certs.
//
// Spec: docs/superpowers/specs/2026-05-19-edge-node-network-telemetry-adapters-design.md
//   § 4.3 UniFi Adapter

import { Agent, fetch as undiciFetch } from "undici";

import {
  resolveAdaptersConfig,
  type AdaptersConfigAdapter,
  type UnifiAdapterConfig,
} from "./adapters-config";
import type { ObservationItem } from "./host-info";

export type UnifiRelationship = {
  fromObservedKey: string;
  toObservedKey: string;
  relationshipType: string;
  rawData?: Record<string, unknown>;
};

export type UnifiCollectResult = {
  items: ObservationItem[];
  relationships: UnifiRelationship[];
  warnings: string[];
};

/** Subset of the UniFi controller device shape we actually use. */
type UnifiDevice = {
  mac: string;
  ip?: string;
  name?: string;
  model?: string;
  model_name?: string;
  type?: string;
  serial?: string;
  state?: number;
  version?: string;
  uplink?: { uplink_mac?: string; uplink_remote_port?: number; type?: string };
  // Other fields (port_table, stat, last_seen, etc.) are ignored in
  // Slice A; they'll be consumed by Slice B's metrics path.
};

/** Adapter for tests — replaces fetch + the config resolver. */
export type UnifiAdapter = {
  /** HTTP fetch. Default uses undici with the tlsInsecure dispatcher. */
  fetch: (
    url: string,
    init: { method?: string; headers?: Record<string, string> },
  ) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown>; text: () => Promise<string> }>;
  /** Config source (defaults to file + env). */
  configAdapter?: AdaptersConfigAdapter;
};

const DEFAULT_TIMEOUT_MS = 10_000;

// itemType map — keeps the OSI-layer-aware shape the topology view
// already understands. The "ugw" / "udm" / "udmpro" types all collapse
// to "gateway"; UniFi distinguishes them by model_name which we keep
// in rawData for the icon lookup.
const TYPE_TO_ITEM_TYPE: Record<string, string> = {
  usw: "switch",
  uap: "access_point",
  ugw: "gateway",
  udm: "gateway",
  udmpro: "gateway",
  uxg: "gateway",
};

// UniFi `state` enum (from controller API):
//   0 = disconnected, 1 = connected (managed), 2 = pending,
//   4 = upgrading, 5 = provisioning, 6 = unreachable, etc.
// We expose this verbatim in rawData; the Authority side maps it to
// the canonical OperationalStatus.
function buildItemFromDevice(device: UnifiDevice): ObservationItem | null {
  const mac = device.mac?.toLowerCase();
  if (!mac || !/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(mac)) return null;

  const itemType = TYPE_TO_ITEM_TYPE[device.type ?? ""] ?? "network_device";

  return {
    observedKey: `unifi:${mac}`,
    itemType,
    name: device.name || device.model_name || device.model || `UniFi ${mac}`,
    confidence: 1.0,
    rawData: {
      mac,
      ip: device.ip ?? null,
      model: device.model ?? null,
      modelName: device.model_name ?? null,
      type: device.type ?? null,
      serial: device.serial ?? null,
      state: device.state ?? null,
      version: device.version ?? null,
      vendorIconModel: device.model ?? null,
      discoveredVia: "unifi_api",
      osiLayer: itemType === "access_point" ? 2 : itemType === "gateway" ? 3 : 2,
      osiLayerName: itemType === "gateway" ? "network" : "data_link",
    },
  };
}

function buildSameAsLink(device: UnifiDevice): UnifiRelationship | null {
  if (!device.ip || !device.mac) return null;
  const mac = device.mac.toLowerCase();
  return {
    fromObservedKey: `unifi:${mac}`,
    toObservedKey: `arp:${device.ip}`,
    relationshipType: "SAME_AS",
    rawData: { mechanism: "unifi_controller_arp_correlation" },
  };
}

function buildUplinkLinks(devices: UnifiDevice[]): UnifiRelationship[] {
  // Index by MAC for fast lookup. The uplink_mac field references
  // another UniFi device; if that device isn't in this sweep's
  // response (e.g. unreachable), we silently skip the relationship —
  // the next sweep will catch it.
  const byMac = new Map<string, UnifiDevice>();
  for (const d of devices) {
    if (d.mac) byMac.set(d.mac.toLowerCase(), d);
  }

  const links: UnifiRelationship[] = [];
  for (const d of devices) {
    const childMac = d.mac?.toLowerCase();
    const parentMac = d.uplink?.uplink_mac?.toLowerCase();
    if (!childMac || !parentMac) continue;
    if (!byMac.has(parentMac)) continue;
    links.push({
      fromObservedKey: `unifi:${parentMac}`,
      toObservedKey: `unifi:${childMac}`,
      relationshipType: "HOSTS",
      rawData: {
        parentPortIdx: d.uplink?.uplink_remote_port ?? null,
        uplinkType: d.uplink?.type ?? null,
      },
    });
  }
  return links;
}

async function fetchUnifiDevices(
  unifi: UnifiAdapterConfig,
  adapter: UnifiAdapter,
): Promise<{ devices: UnifiDevice[] } | { error: string }> {
  const url = `${unifi.controllerUrl}/proxy/network/api/s/${encodeURIComponent(unifi.site)}/stat/device`;
  let resp: Awaited<ReturnType<UnifiAdapter["fetch"]>>;
  try {
    resp = await adapter.fetch(url, {
      method: "GET",
      headers: {
        "X-API-KEY": unifi.apiKey,
        Accept: "application/json",
      },
    });
  } catch (err) {
    return { error: `network error reaching ${url}: ${(err as Error).message}` };
  }

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    return {
      error: `controller returned HTTP ${resp.status} for ${url}: ${body.slice(0, 200)}`,
    };
  }

  let parsed: unknown;
  try {
    parsed = await resp.json();
  } catch (err) {
    return { error: `controller response was not JSON: ${(err as Error).message}` };
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as { data?: unknown }).data)
  ) {
    return { error: `controller response missing data[] array` };
  }

  return {
    devices: (parsed as { data: UnifiDevice[] }).data,
  };
}

/**
 * Run the UniFi adapter once. If no config block is present, returns
 * an empty result with no warnings — the adapter is opt-in.
 *
 * Errors are converted to warnings (and zero items) rather than
 * thrown, matching the pattern of every other collector: a single
 * adapter failure must never bring down the sweep.
 */
export async function collectUnifi(
  adapter?: UnifiAdapter,
): Promise<UnifiCollectResult> {
  const configResolution = resolveAdaptersConfig(adapter?.configAdapter);
  const warnings = [...configResolution.warnings];
  const unifi = configResolution.config.unifi;
  if (!unifi) return { items: [], relationships: [], warnings };

  // Tests always pass a concrete adapter; production builds the
  // default once we know whether tlsInsecure should be honored. The
  // dispatcher selection has to happen here (not at module init)
  // because the flag lives in the JSON config we just read.
  const effectiveAdapter: UnifiAdapter = adapter ?? buildDefaultAdapter(unifi.tlsInsecure);

  const result = await fetchUnifiDevices(unifi, effectiveAdapter);
  if ("error" in result) {
    warnings.push(`unifi: ${result.error}`);
    return { items: [], relationships: [], warnings };
  }

  const items: ObservationItem[] = [];
  const sameAsLinks: UnifiRelationship[] = [];
  for (const device of result.devices) {
    const item = buildItemFromDevice(device);
    if (!item) continue;
    items.push(item);
    const link = buildSameAsLink(device);
    if (link) sameAsLinks.push(link);
  }
  const uplinkLinks = buildUplinkLinks(result.devices);

  return {
    items,
    relationships: [...sameAsLinks, ...uplinkLinks],
    warnings,
  };
}

function buildDefaultAdapter(tlsInsecure: boolean): UnifiAdapter {
  const dispatcher = new Agent({
    headersTimeout: DEFAULT_TIMEOUT_MS,
    bodyTimeout: DEFAULT_TIMEOUT_MS,
    connect: { rejectUnauthorized: !tlsInsecure },
  });
  return {
    fetch: async (url, init) => {
      const resp = await undiciFetch(url, { ...init, dispatcher });
      return {
        ok: resp.ok,
        status: resp.status,
        json: () => resp.json() as Promise<unknown>,
        text: () => resp.text(),
      };
    },
  };
}
