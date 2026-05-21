// UniFi adapter (Slice A + Slice B — discovery only).
//
// Slice A — managed devices (/stat/device):
//   Pulls the list of UniFi-managed network devices (switches, access
//   points, gateways) from a local UniFi Network controller and emits
//   them as ObservationItem records. Each device gets a SAME_AS link
//   to the `arp:<ip>` key the ARP collector already produces, so the
//   Authority Core's normalization can collapse the two into a single
//   canonical Configuration Item. Parent-child device topology
//   (gateway → switch → AP) is emitted as HOSTS relationships using
//   the controller's `uplink.uplink_mac` field.
//
// Slice B — clients (/stat/sta):
//   Pulls every device the UniFi controller has authenticated — WiFi
//   clients, wired clients, the works. This is what surfaces Amazon
//   Echos, Reolink cameras, phones, IoT, etc. when the edge node
//   itself can't ARP the LAN (the Docker-Desktop-on-Windows case).
//   Each client emits an ObservationItem keyed `arp:<client-ip>` so
//   it dedupes with the local ARP collector when both see the same
//   device, plus a MEMBER_OF relationship to the AP / switch it
//   connects through (matching the spec's "logical topology" intent).
//   OUI vendor enrichment is included inline.
//
// What's still NOT in this slice (lands in future slices):
//   - Per-port throughput telemetry (rx_bytes-r / tx_bytes-r). Needs
//     the metrics.network capability + /api/v1/edge/metrics endpoint.
//   - WebSocket event subscription for instant-on join events.
//     5-minute sweep cadence is fine for v1.
//   - PoE wattage per port.
//
// Auth: API-key header (`X-API-KEY`). UniFi Network 9.x+ generates
// API keys in Settings → System → API. Cookie-session local auth is
// out of scope; if it's needed later, gate on whether config.apiKey
// is empty and fall through to a /api/auth/login flow.
//
// TLS: many home UniFi installs use a self-signed cert. The
// `tlsInsecure` config flag opts into accepting any cert by swapping
// in an undici Agent. We never silently accept invalid certs.
//
// Spec: docs/superpowers/specs/2026-05-19-edge-node-network-telemetry-adapters-design.md
//   § 4.3 UniFi Adapter

import { Agent, fetch as undiciFetch } from "undici";

import { lookupOui, shortVendor } from "../lib/mac-oui";
import type { ObservationItem } from "./host-info";

/**
 * Per-adapter UniFi configuration, supplied by the sweep loop from the
 * Authority's GET /api/v1/edge/adapters response. The legacy file-based
 * loader (adapters-config.ts) was retired in the consolidation that
 * moved credential storage into the DiscoveryConnection table — see
 * BI-35de9ce8 for the full rationale.
 */
export type UnifiAdapterConfig = {
  controllerUrl: string;
  apiKey: string;
  site: string;
  tlsInsecure: boolean;
};

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
  // Other fields (port_table, stat, etc.) are ignored in Slice A;
  // they'll be consumed by the metrics path (future slice).
};

/**
 * Subset of the UniFi /stat/sta client shape we use. The full
 * response carries dozens of stat counters per client; we keep the
 * identity + topology subset and surface a few useful WiFi-only
 * details (signal strength, AP MAC) in rawData for the topology view.
 */
type UnifiClient = {
  mac: string;
  ip?: string;
  hostname?: string;
  /** Operator-set friendly name in the UniFi UI ("Mark's iPhone"). */
  name?: string;
  /** UniFi's own MAC manufacturer lookup. We trust ours over theirs. */
  oui?: string;
  /** Unix-second timestamps. */
  first_seen?: number;
  last_seen?: number;
  is_wired?: boolean;
  is_guest?: boolean;
  /** Network / VLAN name the controller has the client in. */
  network?: string;
  /** WiFi-only — MAC of the AP the client is associated with. */
  ap_mac?: string;
  essid?: string;
  channel?: number;
  radio?: string;
  radio_proto?: string;
  signal?: number;
  rssi?: number;
  noise?: number;
  /** Wired-only — MAC of the switch the client is connected through. */
  sw_mac?: string;
  sw_port?: number;
};

/** Adapter for tests — replaces fetch only. Config is supplied by the caller. */
export type UnifiAdapter = {
  /** HTTP fetch. Default uses undici with the tlsInsecure dispatcher. */
  fetch: (
    url: string,
    init: { method?: string; headers?: Record<string, string> },
  ) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown>; text: () => Promise<string> }>;
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
  const result = await fetchUnifiJsonArray<UnifiDevice>(url, unifi, adapter);
  if ("error" in result) return result;
  return { devices: result.data };
}

async function fetchUnifiClients(
  unifi: UnifiAdapterConfig,
  adapter: UnifiAdapter,
): Promise<{ clients: UnifiClient[] } | { error: string }> {
  const url = `${unifi.controllerUrl}/proxy/network/api/s/${encodeURIComponent(unifi.site)}/stat/sta`;
  const result = await fetchUnifiJsonArray<UnifiClient>(url, unifi, adapter);
  if ("error" in result) return result;
  return { clients: result.data };
}

/**
 * Common fetch + parse for the two `data: []` endpoints we use. The
 * wire contract is identical between /stat/device and /stat/sta —
 * both return `{ data: T[] }`. Each caller wraps with the field name
 * its API consumers expect.
 */
async function fetchUnifiJsonArray<T>(
  url: string,
  unifi: UnifiAdapterConfig,
  adapter: UnifiAdapter,
): Promise<{ data: T[] } | { error: string }> {
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

  return { data: (parsed as { data: T[] }).data };
}

/**
 * Map a UniFi client to an ObservationItem. Keyed `arp:<ip>` so it
 * dedupes with the local ARP collector when both see the same device.
 * OUI vendor enrichment is included inline so the topology view
 * shows "Amazon 192.168.0.49" without needing a downstream enricher,
 * matching the shape the ARP collector emits (per PR #846).
 *
 * Returns null for clients without a usable MAC + IP — the wire
 * contract requires an observedKey, and `arp:<empty>` is meaningless.
 */
function buildItemFromClient(client: UnifiClient): ObservationItem | null {
  const mac = client.mac?.toLowerCase();
  if (!mac || !/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(mac)) return null;
  if (!client.ip) return null;

  const oui = lookupOui(mac);
  const displayName =
    client.name ||
    client.hostname ||
    (oui ? `${shortVendor(oui.vendor)} ${client.ip}` : `LAN Host ${client.ip}`);

  const rawData: Record<string, unknown> = {
    address: client.ip,
    mac,
    osiLayer: 3,
    osiLayerName: "network",
    protocolFamily: "ipv4",
    discoveredVia: "unifi_clients_api",
    hostname: client.hostname ?? null,
    operatorName: client.name ?? null,
    isWired: client.is_wired ?? null,
    isGuest: client.is_guest ?? null,
    network: client.network ?? null,
    firstSeen: client.first_seen ? new Date(client.first_seen * 1000).toISOString() : null,
    lastSeen: client.last_seen ? new Date(client.last_seen * 1000).toISOString() : null,
    unifiOui: client.oui ?? null,
  };

  if (oui) {
    rawData.vendor = oui.vendor;
    rawData.vendorOui = oui.oui;
    rawData.vendorShort = shortVendor(oui.vendor);
  }

  if (client.is_wired) {
    rawData.swMac = client.sw_mac ?? null;
    rawData.swPort = client.sw_port ?? null;
  } else {
    rawData.apMac = client.ap_mac ?? null;
    rawData.essid = client.essid ?? null;
    rawData.channel = client.channel ?? null;
    rawData.radio = client.radio ?? null;
    rawData.radioProto = client.radio_proto ?? null;
    rawData.signal = client.signal ?? null;
    rawData.rssi = client.rssi ?? null;
    rawData.noise = client.noise ?? null;
  }

  return {
    observedKey: `arp:${client.ip}`,
    itemType: "host",
    name: displayName,
    // Higher confidence than the ARP collector's 0.7: UniFi has
    // authenticated this client (DHCP lease + auth handshake), not
    // just learned a kernel neighbor entry.
    confidence: 0.9,
    rawData,
  };
}

/**
 * Build a MEMBER_OF relationship from each client to the UniFi-managed
 * device it connects through (AP for wifi, switch for wired). Lets
 * the topology view draw the logical "this phone is hanging off this
 * AP" edges that operators care about.
 *
 * Returns null when the connection device MAC isn't known — that
 * happens for clients in transitional states the UniFi controller
 * exposes inconsistently.
 */
function buildClientMemberOfLink(client: UnifiClient): UnifiRelationship | null {
  const mac = client.mac?.toLowerCase();
  if (!mac || !client.ip) return null;

  const parentMac = client.is_wired
    ? client.sw_mac?.toLowerCase()
    : client.ap_mac?.toLowerCase();
  if (!parentMac) return null;

  return {
    fromObservedKey: `arp:${client.ip}`,
    toObservedKey: `unifi:${parentMac}`,
    relationshipType: "MEMBER_OF",
    rawData: {
      mechanism: client.is_wired ? "unifi_switch_port" : "unifi_wifi_assoc",
      port: client.is_wired ? (client.sw_port ?? null) : null,
      essid: !client.is_wired ? (client.essid ?? null) : null,
    },
  };
}

/**
 * Run the UniFi adapter once. Fetches BOTH endpoints in parallel:
 *   - /stat/device — UniFi-managed gateways/switches/APs (Slice A)
 *   - /stat/sta    — every authenticated WiFi + wired client (Slice B)
 *
 * If no config block is present, returns an empty result with no
 * warnings — the adapter is opt-in.
 *
 * Errors are converted to warnings (and zero items for the failing
 * endpoint) rather than thrown, matching the pattern of every other
 * collector. A clients fetch failure doesn't kill the devices
 * payload, and vice versa — each endpoint is independent.
 */
/**
 * Run the UniFi collector for every configured adapter and merge the
 * results. Caller (the sweep loop) supplies the array of active configs
 * from GET /api/v1/edge/adapters; an empty array is a no-op.
 *
 * Each adapter runs independently — one controller being down doesn't
 * stop the others from contributing. Per-adapter warnings are prefixed
 * with the connection name so operators can tell which controller is
 * misbehaving when there are multiple.
 */
export async function collectUnifi(
  configs: UnifiAdapterConfig[],
  adapter?: UnifiAdapter,
): Promise<UnifiCollectResult> {
  const items: ObservationItem[] = [];
  const relationships: UnifiRelationship[] = [];
  const warnings: string[] = [];

  for (const unifi of configs) {
    const single = await collectUnifiOne(unifi, adapter);
    items.push(...single.items);
    relationships.push(...single.relationships);
    warnings.push(...single.warnings);
  }

  return { items, relationships, warnings };
}

/** Single-adapter collection — split out so the multi-adapter wrapper stays small. */
async function collectUnifiOne(
  unifi: UnifiAdapterConfig,
  adapter?: UnifiAdapter,
): Promise<UnifiCollectResult> {
  // Tests pass a concrete adapter; production builds the default once
  // we know whether tlsInsecure should be honored. The dispatcher
  // selection has to happen per-adapter because the flag is per-config.
  const effectiveAdapter: UnifiAdapter = adapter ?? buildDefaultAdapter(unifi.tlsInsecure);

  // Fan out both endpoint calls concurrently. Promise.all is fine
  // here because the two are independent and we already handle
  // per-call errors inside each fetch function (they return
  // {error: string} instead of throwing).
  const [devicesResult, clientsResult] = await Promise.all([
    fetchUnifiDevices(unifi, effectiveAdapter),
    fetchUnifiClients(unifi, effectiveAdapter),
  ]);

  const items: ObservationItem[] = [];
  const relationships: UnifiRelationship[] = [];
  const warnings: string[] = [];

  if ("error" in devicesResult) {
    warnings.push(`unifi[${unifi.controllerUrl}]: ${devicesResult.error}`);
  } else {
    const sameAsLinks: UnifiRelationship[] = [];
    for (const device of devicesResult.devices) {
      const item = buildItemFromDevice(device);
      if (!item) continue;
      items.push(item);
      const link = buildSameAsLink(device);
      if (link) sameAsLinks.push(link);
    }
    relationships.push(...sameAsLinks);
    relationships.push(...buildUplinkLinks(devicesResult.devices));
  }

  if ("error" in clientsResult) {
    warnings.push(`unifi[${unifi.controllerUrl}]: ${clientsResult.error}`);
  } else {
    for (const client of clientsResult.clients) {
      const item = buildItemFromClient(client);
      if (!item) continue;
      items.push(item);
      const link = buildClientMemberOfLink(client);
      if (link) relationships.push(link);
    }
  }

  return { items, relationships, warnings };
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
