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
  discoverClients?: boolean;
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
    observedKey: `unifi-client:${mac}`,
    itemType: "network_client",
    name: displayName,
    // Higher confidence than the ARP collector's 0.7: UniFi has
    // authenticated this client (DHCP lease + auth handshake), not
    // just learned a kernel neighbor entry.
    confidence: 0.9,
    rawData,
  };
}

/**
 * Build a physical CONNECTS_TO relationship from each client to the UniFi-managed
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
    fromObservedKey: `unifi-client:${mac}`,
    toObservedKey: `unifi:${parentMac}`,
    relationshipType: "CONNECTS_TO",
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

type OfficialSite = { id: string; internalReference?: string; name?: string };
type OfficialDevice = {
  id: string;
  macAddress?: string;
  ipAddress?: string;
  name?: string;
  model?: string;
  state?: string;
  firmwareVersion?: string;
  features?: string[];
};
type OfficialDeviceDetail = {
  id: string;
  uplink?: { deviceId?: string } | null;
  interfaces?: { ports?: Array<{ idx?: number; state?: string; speedMbps?: number; maxSpeedMbps?: number }> };
};
type OfficialClient = {
  id: string;
  macAddress?: string;
  ipAddress?: string;
  name?: string;
  type?: string;
  access?: { deviceId?: string; type?: string; port?: number } | null;
};
type OfficialPage<T> = {
  offset: number;
  limit: number;
  count: number;
  totalCount: number;
  data: T[];
};
type OfficialOutcome =
  | { kind: "result"; result: UnifiCollectResult }
  | { kind: "unsupported" };

const OFFICIAL_PAGE_SIZE = 100;
const OFFICIAL_MAX_PAGES = 100;

async function collectOfficialUnifi(
  unifi: UnifiAdapterConfig,
  adapter: UnifiAdapter,
): Promise<OfficialOutcome> {
  const base = `${unifi.controllerUrl}/proxy/network/integration/v1`;
  const sitesResult = await fetchOfficialPages<OfficialSite>(`${base}/sites`, unifi, adapter);
  if (sitesResult.kind === "unsupported") return sitesResult;
  if (sitesResult.kind === "error") {
    return { kind: "result", result: emptyOfficialResult(sitesResult.warning) };
  }

  const configuredSite = unifi.site || "default";
  const site = sitesResult.data.find(
    (candidate) =>
      candidate.id === configuredSite ||
      candidate.internalReference?.toLowerCase() === configuredSite.toLowerCase() ||
      candidate.name?.toLowerCase() === configuredSite.toLowerCase(),
  ) ?? (configuredSite.toLowerCase() === "default" && sitesResult.data.length === 1
    ? sitesResult.data[0]
    : undefined);
  if (!site) {
    return { kind: "result", result: emptyOfficialResult("unifi_site_not_found") };
  }

  const siteBase = `${base}/sites/${encodeURIComponent(site.id)}`;
  const devicesResult = await fetchOfficialPages<OfficialDevice>(`${siteBase}/devices`, unifi, adapter);
  if (devicesResult.kind === "unsupported") return devicesResult;
  if (devicesResult.kind === "error") {
    return { kind: "result", result: emptyOfficialResult(devicesResult.warning) };
  }
  if (devicesResult.data.length === 0) {
    return { kind: "result", result: emptyOfficialResult("unifi_no_devices") };
  }

  const items: ObservationItem[] = [];
  const relationships: UnifiRelationship[] = [];
  const warnings: string[] = [];
  const keyById = new Map<string, string>();
  for (const device of devicesResult.data) {
    const mac = normalizeOfficialMac(device.macAddress);
    const observedKey = mac ? `unifi:${mac}` : `unifi-device:${device.id}`;
    keyById.set(device.id, observedKey);
    const itemType = officialDeviceType(device);
    items.push({
      observedKey,
      itemType,
      name: device.name || device.model || "UniFi device",
      confidence: 1,
      rawData: {
        mac: mac || null,
        ip: device.ipAddress ?? null,
        model: device.model ?? null,
        state: device.state ?? null,
        version: device.firmwareVersion ?? null,
        unifiDeviceId: device.id,
        unifiSiteId: site.id,
        apiGeneration: "integration_v1",
        discoveredVia: "unifi_api",
        osiLayer: itemType === "gateway" ? 3 : 2,
        osiLayerName: itemType === "gateway" ? "network" : "data_link",
      },
    });
    if (device.ipAddress && mac) {
      relationships.push({
        fromObservedKey: observedKey,
        toObservedKey: `arp:${device.ipAddress}`,
        relationshipType: "SAME_AS",
        rawData: { mechanism: "unifi_controller_arp_correlation" },
      });
    }
  }

  const details = await Promise.all(
    devicesResult.data.map(async (device) => ({
      device,
      detail: await fetchOfficialObject<OfficialDeviceDetail>(
        `${siteBase}/devices/${encodeURIComponent(device.id)}`,
        unifi,
        adapter,
      ),
    })),
  );
  for (const { device, detail } of details) {
    // "unsupported" (404/405/501 from fetchOfficialObject) has to be handled
    // alongside "error" here, not just for type-narrowing: an older controller
    // generation with no per-device detail endpoint would otherwise read as a
    // successful fetch. Matches how the clients call below folds the two.
    if (detail.kind === "error" || detail.kind === "unsupported") {
      warnings.push(`unifi_partial:device_detail:${device.id}`);
      continue;
    }
    const parentId = detail.data.uplink?.deviceId;
    const parentKey = parentId ? keyById.get(parentId) : undefined;
    const childKey = keyById.get(device.id);
    if (parentId && (!parentKey || !childKey)) {
      warnings.push(`unifi_partial:missing_uplink_parent:${device.id}`);
      continue;
    }
    if (parentKey && childKey && parentKey !== childKey) {
      relationships.push({
        fromObservedKey: parentKey,
        toObservedKey: childKey,
        relationshipType: "HOSTS",
        rawData: { evidenceKind: "unifi_uplink", parentDeviceId: parentId, childDeviceId: device.id },
      });
    }
  }

  if (unifi.discoverClients !== false) {
    const clientsResult = await fetchOfficialPages<OfficialClient>(`${siteBase}/clients`, unifi, adapter);
    if (clientsResult.kind === "error" || clientsResult.kind === "unsupported") {
      warnings.push("unifi_partial:clients");
    } else {
      for (const client of clientsResult.data) {
        const mac = normalizeOfficialMac(client.macAddress);
        if (!mac) continue;
        const observedKey = `unifi-client:${mac}`;
        items.push({
          observedKey,
          itemType: "network_client",
          name: client.name || `Client ${mac}`,
          confidence: 0.9,
          rawData: {
            mac,
            address: client.ipAddress ?? null,
            clientType: client.type ?? null,
            unifiClientId: client.id,
            unifiSiteId: site.id,
            apiGeneration: "integration_v1",
            discoveredVia: "unifi_clients_api",
            osiLayer: 3,
            osiLayerName: "network",
          },
        });
        if (client.ipAddress) {
          relationships.push({
            fromObservedKey: observedKey,
            toObservedKey: `arp:${client.ipAddress}`,
            relationshipType: "SAME_AS",
            rawData: { mechanism: "unifi_ip_mac_correlation" },
          });
        }
        const parentKey = client.access?.deviceId ? keyById.get(client.access.deviceId) : undefined;
        if (parentKey) {
          relationships.push({
            fromObservedKey: observedKey,
            toObservedKey: parentKey,
            relationshipType: "CONNECTS_TO",
            rawData: {
              evidenceKind: "unifi_client_access",
              connectionType: client.access?.type?.toLowerCase() ?? null,
              port: client.access?.port ?? null,
            },
          });
        }
      }
    }
  }

  return { kind: "result", result: { items, relationships, warnings } };
}

function emptyOfficialResult(warning: string): UnifiCollectResult {
  return { items: [], relationships: [], warnings: [warning] };
}

async function fetchOfficialPages<T>(
  endpoint: string,
  unifi: UnifiAdapterConfig,
  adapter: UnifiAdapter,
): Promise<{ kind: "success"; data: T[] } | { kind: "unsupported" } | { kind: "error"; warning: string }> {
  const items: T[] = [];
  let offset = 0;
  for (let pageNumber = 0; pageNumber < OFFICIAL_MAX_PAGES; pageNumber += 1) {
    const pageResult = await fetchOfficialObject<OfficialPage<T>>(
      `${endpoint}?offset=${offset}&limit=${OFFICIAL_PAGE_SIZE}`,
      unifi,
      adapter,
    );
    if (pageResult.kind !== "success") return pageResult;
    const page = pageResult.data;
    if (!Array.isArray(page.data)) return { kind: "error", warning: "unifi_invalid_json" };
    items.push(...page.data);
    if (items.length >= page.totalCount || page.data.length === 0) {
      return { kind: "success", data: items };
    }
    const nextOffset = page.offset + page.data.length;
    if (nextOffset <= offset) return { kind: "error", warning: "unifi_invalid_pagination" };
    offset = nextOffset;
  }
  return { kind: "error", warning: "unifi_pagination_limit" };
}

async function fetchOfficialObject<T>(
  endpoint: string,
  unifi: UnifiAdapterConfig,
  adapter: UnifiAdapter,
): Promise<{ kind: "success"; data: T } | { kind: "unsupported" } | { kind: "error"; warning: string }> {
  let response: Awaited<ReturnType<UnifiAdapter["fetch"]>>;
  try {
    response = await adapter.fetch(endpoint, {
      method: "GET",
      headers: { "X-API-Key": unifi.apiKey, Accept: "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    return { kind: "error", warning: message.includes("certificate") || message.includes("tls")
      ? "unifi_tls_error"
      : "unifi_unreachable" };
  }
  if ([404, 405, 501].includes(response.status)) return { kind: "unsupported" };
  if ([401, 403].includes(response.status)) return { kind: "error", warning: "unifi_auth_failed" };
  if (!response.ok) return { kind: "error", warning: `unifi_api_error:${response.status}` };
  try {
    return { kind: "success", data: await response.json() as T };
  } catch {
    return { kind: "error", warning: "unifi_invalid_json" };
  }
}

function normalizeOfficialMac(raw: string | undefined): string | null {
  const normalized = raw?.trim().toLowerCase().replaceAll("-", ":") ?? "";
  return /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(normalized) ? normalized : null;
}

function officialDeviceType(device: OfficialDevice): string {
  const features = new Set((device.features ?? []).map((feature) => feature.toLowerCase()));
  if (features.has("accesspoint") || features.has("access_point") || features.has("wifi")) return "access_point";
  if (features.has("switching") || features.has("switch")) return "switch";
  if (features.has("routing") || features.has("gateway")) return "gateway";
  const model = device.model?.toLowerCase() ?? "";
  if (/^(uap|u6|u7)/.test(model)) return "access_point";
  if (/^(us-|usw)/.test(model)) return "switch";
  if (/(ucg|udm|uxg|gateway)/.test(model)) return "gateway";
  return "network_device";
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

  const official = await collectOfficialUnifi(unifi, effectiveAdapter);
  if (official.kind === "result") return official.result;

  // Fan out both endpoint calls concurrently. Promise.all is fine
  // here because the two are independent and we already handle
  // per-call errors inside each fetch function (they return
  // {error: string} instead of throwing).
  const [devicesResult, clientsResult] = await Promise.all([
    fetchUnifiDevices(unifi, effectiveAdapter),
    unifi.discoverClients === false
      ? Promise.resolve({ clients: [] as UnifiClient[] })
      : fetchUnifiClients(unifi, effectiveAdapter),
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
      relationships.push({
        fromObservedKey: item.observedKey,
        toObservedKey: `arp:${client.ip}`,
        relationshipType: "SAME_AS",
        rawData: { mechanism: "unifi_ip_mac_correlation" },
      });
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
