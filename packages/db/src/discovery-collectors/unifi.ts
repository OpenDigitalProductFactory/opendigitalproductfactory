import type {
  CollectorContext,
  CollectorOutput,
  DiscoveredItemInput,
  DiscoveredRelationshipInput,
  DiscoveredSoftwareInput,
} from "../discovery-types";
import { createUnifiFetch, type UnifiFetch } from "./unifi-fetch";

// ─── UniFi API Response Types ─────────────────────────────────────────────────

type UnifiDevicePort = {
  port_idx: number;
  name?: string;
  media?: string;
  speed?: number;
  up?: boolean;
  portconf_id?: string;
};

type UnifiDeviceUplink = {
  uplink_mac?: string;
  uplink_remote_port?: number;
  type?: string;
};

type UnifiLldpEntry = {
  chassis_id?: string;
  port_id?: string;
  port_description?: string;
  is_wired?: boolean;
  local_port_idx?: number;
};

type UnifiDevice = {
  mac: string;
  ip: string;
  model: string;
  model_in_lts?: boolean;
  name?: string;
  type: string; // ugw, udm, uxg, usw, uap
  version?: string;
  // Hardware serial the UniFi controller reports per device — the canonical asset match
  // key for the estate bridges (BI-828998DC / BI-1093AF1C). Optional; absent on some models.
  serial?: string;
  adopted?: boolean;
  state?: number; // 1 = connected
  port_table?: UnifiDevicePort[];
  uplink?: UnifiDeviceUplink;
  lldp_table?: UnifiLldpEntry[];
  num_sta?: number;
};

// `stat/health` returns one entry per subsystem (wan, wlan, lan, www, vpn).
// The `wan` entry is the only place the controller reports the INTERNET uplink:
// which ISP is upstream, the public address, and whether the link is healthy.
// Everything else the collector models stops at the LAN edge.
type UnifiHealthSubsystem = {
  subsystem: string;
  status?: string; // "ok" | "warning" | "error"
  wan_ip?: string;
  isp_name?: string;
  isp_organization?: string;
  latency?: number; // ms to the ISP
  uptime?: number; // seconds
  xput_down?: number;
  xput_up?: number;
  gw_mac?: string; // the gateway that owns this uplink
  gw_name?: string;
};

type UnifiNetworkConf = {
  _id: string;
  name: string;
  purpose?: string; // corporate, guest, vlan-only, remote-user-vpn
  vlan_enabled?: boolean;
  vlan?: string | number;
  ip_subnet?: string; // e.g. "192.168.1.1/24"
  dhcpd_enabled?: boolean;
  networkgroup?: string;
  site_id?: string;
};

type UnifiClient = {
  mac: string;
  ip?: string;
  hostname?: string;
  name?: string;
  ap_mac?: string;
  sw_mac?: string;
  sw_port?: number;
  is_wired?: boolean;
  network?: string;
  vlan?: number;
};

type UnifiApiResponse<T> = {
  meta?: { rc: string; msg?: string };
  data: T[];
};

type OfficialSite = { id: string; name?: string };
type OfficialDevice = {
  id: string;
  macAddress?: string;
  ipAddress?: string;
  name?: string;
  model?: string;
  firmwareVersion?: string;
  features?: string[];
};
type OfficialDeviceDetail = OfficialDevice & {
  uplink?: { deviceId?: string; portNumber?: number };
};
type OfficialClient = {
  id?: string;
  macAddress?: string;
  ipAddress?: string;
  name?: string;
  hostname?: string;
  connectedDeviceId?: string;
  connectedDevice?: { id?: string };
  type?: string;
};
type OfficialPage<T> = { data?: T[]; offset?: number; limit?: number; totalCount?: number };

// ─── Device Type Mapping ──────────────────────────────────────────────────────

const DEVICE_TYPE_MAP: Record<string, { itemType: string; osiLayer: number; osiLayerName: string }> = {
  ugw: { itemType: "router", osiLayer: 3, osiLayerName: "network" },
  udm: { itemType: "router", osiLayer: 3, osiLayerName: "network" },
  uxg: { itemType: "router", osiLayer: 3, osiLayerName: "network" },
  usw: { itemType: "switch", osiLayer: 2, osiLayerName: "data_link" },
  uap: { itemType: "access_point", osiLayer: 2, osiLayerName: "data_link" },
};

const DEFAULT_DEVICE_MAPPING = { itemType: "network_device", osiLayer: 3, osiLayerName: "network" };

function mapDeviceType(type: string) {
  return DEVICE_TYPE_MAP[type] ?? DEFAULT_DEVICE_MAPPING;
}

// ─── Discovery Connection Shape ───────────────────────────────────────────────
// Matches the DiscoveryConnection Prisma model. The runner loads these from the
// DB and passes them in — the collector never touches the database directly.

export type UnifiConnectionInput = {
  endpointUrl: string;
  apiKey: string;                       // already-decrypted plaintext
  configuration?: {
    site?: string;
    discoverClients?: boolean;
    tlsInsecure?: boolean;
  };
};

// ─── Dependency Injection ─────────────────────────────────────────────────────

export type UnifiDeps = {
  fetchFn: UnifiFetch;
  unifiUrl: string;
  apiKey: string;
  site: string;
  discoverClients: boolean;
  tlsInsecure: boolean;
};

/** Build deps from a DiscoveryConnection loaded by the runner. */
export function buildDepsFromConnection(conn: UnifiConnectionInput): UnifiDeps {
  const tlsInsecure = conn.configuration?.tlsInsecure ?? false;
  return {
    fetchFn: createUnifiFetch(tlsInsecure),
    // CodeQL #25 (js/polynomial-redos): bound the trailing-slash run.
    unifiUrl: conn.endpointUrl.replace(/\/{1,256}$/, ""),
    apiKey: conn.apiKey,
    site: conn.configuration?.site ?? "default",
    discoverClients: conn.configuration?.discoverClients ?? false,
    tlsInsecure,
  };
}

// ─── API Helpers ──────────────────────────────────────────────────────────────

async function unifiGet<T>(
  path: string,
  deps: UnifiDeps,
): Promise<{ data: T[] | null; error?: string }> {
  const url = `${deps.unifiUrl}/proxy/network/api/s/${deps.site}/${path}`;
  try {
    const response = await deps.fetchFn(url, {
      method: "GET",
      headers: {
        "X-API-Key": deps.apiKey,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (response.status === 401 || response.status === 403) {
      return { data: null, error: "unifi_auth_failed" };
    }
    if (!response.ok) {
      return { data: null, error: `unifi_api_error:${response.status}` };
    }

    const body = (await response.json()) as UnifiApiResponse<T>;
    return { data: body.data ?? [] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("TLS") || msg.includes("certificate") || msg.includes("self-signed") || msg.includes("CERT")) {
      return { data: null, error: "unifi_tls_error" };
    }
    return { data: null, error: "unifi_unreachable" };
  }
}

function unifiTransportError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("TLS") || msg.includes("certificate") || msg.includes("self-signed") || msg.includes("CERT")) {
    return "unifi_tls_error";
  }
  return "unifi_unreachable";
}

async function officialGet<T>(
  path: string,
  deps: UnifiDeps,
): Promise<{ data?: T; error?: string; unsupported?: boolean }> {
  try {
    const response = await deps.fetchFn(`${deps.unifiUrl}/proxy/network/integration/v1${path}`, {
      method: "GET",
      headers: { "X-API-Key": deps.apiKey, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 401 || response.status === 403) return { error: "unifi_auth_failed" };
    if ([404, 405, 501].includes(response.status)) return { unsupported: true };
    if (!response.ok) return { error: `unifi_api_error:${response.status}` };
    return { data: (await response.json()) as T };
  } catch (err) {
    return { error: unifiTransportError(err) };
  }
}

async function officialGetAll<T>(
  path: string,
  deps: UnifiDeps,
): Promise<{ data?: T[]; error?: string; unsupported?: boolean }> {
  const collected: T[] = [];
  let offset = 0;
  for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
    const separator = path.includes("?") ? "&" : "?";
    const result = await officialGet<OfficialPage<T>>(`${path}${separator}offset=${offset}&limit=200`, deps);
    if (result.error || result.unsupported) {
      return { error: result.error, unsupported: result.unsupported };
    }
    const page = result.data?.data ?? [];
    collected.push(...page);
    const total = result.data?.totalCount;
    const pageLimit = result.data?.limit ?? 200;
    if (page.length === 0 || total == null || collected.length >= total || page.length < pageLimit) break;
    offset = result.data?.offset != null ? result.data.offset + page.length : offset + page.length;
  }
  return { data: collected };
}

function officialDeviceMapping(device: OfficialDevice) {
  const features = (device.features ?? []).map((feature) => feature.toLowerCase());
  if (features.some((feature) => feature.includes("gateway"))) return DEVICE_TYPE_MAP.udm;
  if (features.some((feature) => feature.includes("switch"))) return DEVICE_TYPE_MAP.usw;
  if (features.some((feature) => feature.includes("accesspoint") || feature.includes("access_point"))) {
    return DEVICE_TYPE_MAP.uap;
  }
  return DEFAULT_DEVICE_MAPPING;
}

async function collectOfficialUnifiDiscovery(
  ctx: CollectorContext | undefined,
  deps: UnifiDeps,
): Promise<{ supported: boolean; output: CollectorOutput }> {
  const source = ctx?.sourceKind ?? "unifi";
  const sitesResult = await officialGetAll<OfficialSite>("/sites", deps);
  if (sitesResult.unsupported) return { supported: false, output: { items: [], relationships: [] } };
  if (sitesResult.error) {
    return { supported: true, output: { items: [], relationships: [], software: [], warnings: [sitesResult.error] } };
  }

  const sites = sitesResult.data ?? [];
  const selectedSite = sites.find((site) => site.id === deps.site || site.name === deps.site) ?? sites[0];
  if (!selectedSite) {
    return { supported: true, output: { items: [], relationships: [], software: [], warnings: ["unifi_no_sites"] } };
  }

  const devicesResult = await officialGetAll<OfficialDevice>(`/sites/${encodeURIComponent(selectedSite.id)}/devices`, deps);
  if (devicesResult.unsupported) return { supported: false, output: { items: [], relationships: [] } };
  if (devicesResult.error) {
    return { supported: true, output: { items: [], relationships: [], software: [], warnings: [devicesResult.error] } };
  }

  const devices = devicesResult.data ?? [];
  if (devices.length === 0) {
    return { supported: true, output: { items: [], relationships: [], software: [], warnings: ["unifi_no_devices"] } };
  }

  const items: DiscoveredItemInput[] = [];
  const relationships: DiscoveredRelationshipInput[] = [];
  const software: DiscoveredSoftwareInput[] = [];
  const warnings: string[] = [];
  const idToRef = new Map<string, string>();

  for (const device of devices) {
    const mac = device.macAddress?.toLowerCase();
    if (!mac) {
      warnings.push(`unifi_partial:device_missing_mac:${device.id}`);
      continue;
    }
    const ref = `unifi-device:${mac}`;
    const mapping = officialDeviceMapping(device);
    idToRef.set(device.id, ref);
    items.push({
      sourceKind: source,
      itemType: mapping.itemType,
      name: device.name ?? device.model ?? mac,
      externalRef: ref,
      naturalKey: `unifi:${mac}`,
      confidence: 0.95,
      attributes: {
        mac,
        address: device.ipAddress,
        networkAddress: device.ipAddress,
        protocolFamily: "ipv4",
        model: device.model,
        firmware: device.firmwareVersion,
        osiLayer: mapping.osiLayer,
        osiLayerName: mapping.osiLayerName,
        unifiDeviceId: device.id,
        unifiSiteId: selectedSite.id,
      },
    });
    if (device.firmwareVersion) {
      software.push({
        sourceKind: source,
        entityExternalRef: ref,
        evidenceSource: "unifi_firmware",
        rawVendor: "Ubiquiti",
        rawProductName: device.model,
        rawVersion: device.firmwareVersion,
      });
    }
  }

  for (const device of devices) {
    const deviceRef = idToRef.get(device.id);
    if (!deviceRef) continue;
    const detailResult = await officialGet<OfficialDeviceDetail>(
      `/sites/${encodeURIComponent(selectedSite.id)}/devices/${encodeURIComponent(device.id)}`,
      deps,
    );
    if (detailResult.error || detailResult.unsupported) {
      warnings.push(`unifi_partial:device_detail:${device.id}`);
      continue;
    }
    const upstreamRef = detailResult.data?.uplink?.deviceId
      ? idToRef.get(detailResult.data.uplink.deviceId)
      : undefined;
    if (upstreamRef) {
      relationships.push({
        sourceKind: source,
        relationshipType: "CONNECTS_TO",
        fromExternalRef: deviceRef,
        toExternalRef: upstreamRef,
        confidence: 0.95,
        attributes: { connectionType: "wired", remotePort: detailResult.data?.uplink?.portNumber },
      });
    }
  }

  if (deps.discoverClients) {
    const clientsResult = await officialGetAll<OfficialClient>(`/sites/${encodeURIComponent(selectedSite.id)}/clients`, deps);
    if (clientsResult.error || clientsResult.unsupported) {
      warnings.push("unifi_partial:clients");
    } else {
      for (const client of clientsResult.data ?? []) {
        const mac = client.macAddress?.toLowerCase();
        if (!mac) continue;
        const ref = `unifi-client:${mac}`;
        items.push({
          sourceKind: source,
          itemType: "network_client",
          name: client.name ?? client.hostname ?? `Client ${mac}`,
          externalRef: ref,
          naturalKey: ref,
          confidence: 0.8,
          attributes: {
            mac,
            address: client.ipAddress,
            networkAddress: client.ipAddress,
            protocolFamily: "ipv4",
            connectionType: client.type,
            osiLayer: 3,
            osiLayerName: "network",
          },
        });
        const parentId = client.connectedDeviceId ?? client.connectedDevice?.id;
        const parentRef = parentId ? idToRef.get(parentId) : undefined;
        if (parentRef) {
          relationships.push({
            sourceKind: source,
            relationshipType: "CONNECTS_TO",
            fromExternalRef: ref,
            toExternalRef: parentRef,
            confidence: 0.85,
            attributes: { connectionType: client.type ?? "unknown" },
          });
        }
      }
    }
  }

  return { supported: true, output: { items, relationships, software, warnings } };
}

// ─── Collector ────────────────────────────────────────────────────────────────
// Called with explicit deps (from connection data or tests).
// When deps is null/undefined, returns empty — no env var fallback.

export async function collectUnifiDiscovery(
  ctx?: CollectorContext,
  deps?: UnifiDeps | null,
): Promise<CollectorOutput> {
  if (!deps) {
    return { items: [], relationships: [] };
  }

  const official = await collectOfficialUnifiDiscovery(ctx, deps);
  if (official.supported) return official.output;

  const resolvedDeps = deps;

  const source = ctx?.sourceKind ?? "unifi";
  const items: DiscoveredItemInput[] = [];
  const relationships: DiscoveredRelationshipInput[] = [];
  const software: DiscoveredSoftwareInput[] = [];
  const warnings: string[] = [];

  // ── Fetch Devices ─────────────────────────────────────────────
  const deviceResult = await unifiGet<UnifiDevice>("stat/device", resolvedDeps);
  if (deviceResult.error) {
    warnings.push(deviceResult.error);
    return { items, relationships, software, warnings };
  }

  const devices = deviceResult.data ?? [];
  if (devices.length === 0) {
    warnings.push("unifi_no_devices");
    return { items, relationships, software, warnings };
  }

  // Build MAC→externalRef lookup for relationship building
  const macToRef = new Map<string, string>();

  for (const device of devices) {
    const mapping = mapDeviceType(device.type);
    const ref = `unifi-device:${device.mac}`;
    macToRef.set(device.mac, ref);

    items.push({
      sourceKind: source,
      itemType: mapping.itemType,
      name: device.name ?? `${device.model} (${device.ip})`,
      externalRef: ref,
      naturalKey: `unifi:${device.mac}`,
      confidence: 0.95,
      attributes: {
        mac: device.mac,
        address: device.ip,
        model: device.model,
        firmware: device.version,
        deviceType: device.type,
        adopted: device.adopted,
        connectedClients: device.num_sta,
        osiLayer: mapping.osiLayer,
        osiLayerName: mapping.osiLayerName,
        networkAddress: device.ip,
        protocolFamily: "ipv4",
        // Canonical serial key the estate bridges read off InventoryEntity.properties.
        ...(device.serial ? { serialNumber: device.serial } : {}),
      },
    });

    // Software evidence: firmware version
    if (device.version) {
      software.push({
        sourceKind: source,
        entityExternalRef: ref,
        evidenceSource: "unifi_firmware",
        rawVendor: "Ubiquiti",
        rawProductName: device.model,
        rawVersion: device.version,
      });
    }
  }

  // ── Device Uplink Relationships (CONNECTS_TO) ─────────────────
  for (const device of devices) {
    const deviceRef = macToRef.get(device.mac);
    const uplinkMac = device.uplink?.uplink_mac;
    if (deviceRef && uplinkMac) {
      const uplinkRef = macToRef.get(uplinkMac);
      if (uplinkRef) {
        relationships.push({
          sourceKind: source,
          relationshipType: "CONNECTS_TO",
          fromExternalRef: deviceRef,
          toExternalRef: uplinkRef,
          confidence: 0.95,
          attributes: {
            connectionType: device.uplink?.type ?? "wired",
            remotePort: device.uplink?.uplink_remote_port,
          },
        });
      }
    }
  }

  // ── LLDP Neighbor Relationships (PEER_OF) ─────────────────────
  for (const device of devices) {
    const deviceRef = macToRef.get(device.mac);
    if (!deviceRef || !device.lldp_table) continue;

    for (const lldp of device.lldp_table) {
      if (!lldp.chassis_id) continue;
      // chassis_id is typically the MAC of the neighbor
      const normalizedMac = lldp.chassis_id.toLowerCase();
      const neighborRef = macToRef.get(normalizedMac);
      if (neighborRef && neighborRef !== deviceRef) {
        relationships.push({
          sourceKind: source,
          relationshipType: "PEER_OF",
          fromExternalRef: deviceRef,
          toExternalRef: neighborRef,
          confidence: 0.90,
          attributes: {
            protocol: "lldp",
            localPort: lldp.local_port_idx,
            remotePortDescription: lldp.port_description,
          },
        });
      }
    }
  }

  // ── Internet Uplink (the WAN hop) ─────────────────────────────
  // Everything above stops at the LAN edge: AP -> switch -> gateway. The hop the
  // business actually depends on — gateway -> ISP (Starlink here) — was never
  // modelled, so "are we online, and which hop broke?" was unanswerable. The
  // `wan` health subsystem is the only place the controller reports it.
  //
  // Identity is anchored on the site + WAN designation, never on `wan_ip`: a
  // Starlink CGNAT address changes routinely, and keying on it would mint a new
  // uplink entity per address change (the churn pattern that produced thousands
  // of orphaned rows elsewhere in discovery).
  const healthResult = await unifiGet<UnifiHealthSubsystem>("stat/health", resolvedDeps);
  if (healthResult.error) {
    warnings.push("unifi_partial:health");
  }

  const wanHealth = (healthResult.data ?? []).find(
    (subsystem) => subsystem.subsystem === "wan",
  );

  if (wanHealth) {
    const ispName = wanHealth.isp_name ?? wanHealth.isp_organization ?? null;
    const wanRef = `unifi-wan:${resolvedDeps.site}:wan`;
    items.push({
      sourceKind: source,
      itemType: "wan_uplink",
      // Name the uplink after the ISP so the operator sees the dependency they
      // actually have ("Starlink (WAN)") rather than an opaque port label.
      name: ispName ? `${ispName} (WAN)` : "Internet Uplink (WAN)",
      externalRef: wanRef,
      naturalKey: wanRef,
      confidence: 0.95,
      attributes: {
        ispName,
        ispOrganization: wanHealth.isp_organization ?? null,
        wanIp: wanHealth.wan_ip ?? null,
        linkStatus: wanHealth.status ?? null,
        latencyMs: wanHealth.latency ?? null,
        uptimeSeconds: wanHealth.uptime ?? null,
        throughputDownBps: wanHealth.xput_down ?? null,
        throughputUpBps: wanHealth.xput_up ?? null,
        osiLayer: 3,
        osiLayerName: "network",
        protocolFamily: "ipv4",
      },
    });

    // Complete the chain: gateway -> internet uplink. Prefer the gateway the
    // controller itself attributes the uplink to (`gw_mac`); fall back to the
    // routing device when the controller omits it.
    const gatewayRef = (wanHealth.gw_mac && macToRef.get(wanHealth.gw_mac.toLowerCase()))
      ?? macToRef.get(
        devices.find((device) => mapDeviceType(device.type).itemType === "router")?.mac ?? "",
      );

    if (gatewayRef) {
      relationships.push({
        sourceKind: source,
        relationshipType: "UPLINKS_TO",
        fromExternalRef: gatewayRef,
        toExternalRef: wanRef,
        confidence: 0.95,
        attributes: {
          ispName,
          linkStatus: wanHealth.status ?? null,
        },
      });
    }
  }

  // ── Fetch VLANs ───────────────────────────────────────────────
  const vlanResult = await unifiGet<UnifiNetworkConf>("rest/networkconf", resolvedDeps);
  if (vlanResult.error) {
    warnings.push(`unifi_partial:networkconf`);
  }

  const vlans = vlanResult.data ?? [];
  const vlanIdToRef = new Map<string | number, string>();

  for (const vlan of vlans) {
    // Skip networks without VLAN tagging (the default untagged network)
    const vlanId = vlan.vlan ?? vlan._id;
    const vlanRef = `unifi-vlan:${resolvedDeps.site}:${vlanId}`;
    vlanIdToRef.set(String(vlanId), vlanRef);
    if (vlan.name) vlanIdToRef.set(vlan.name, vlanRef);

    items.push({
      sourceKind: source,
      itemType: "vlan",
      name: vlan.name || `VLAN ${vlanId}`,
      externalRef: vlanRef,
      naturalKey: `unifi-vlan:${resolvedDeps.site}:${vlanId}`,
      confidence: 0.90,
      attributes: {
        vlanId,
        purpose: vlan.purpose,
        subnet: vlan.ip_subnet,
        dhcpEnabled: vlan.dhcpd_enabled,
        osiLayer: 2,
        osiLayerName: "data_link",
        ...(vlan.ip_subnet ? { networkAddress: vlan.ip_subnet, protocolFamily: "ipv4" } : {}),
      },
    });

    // If VLAN has a subnet, link to the subnet (cross-collector correlation)
    if (vlan.ip_subnet) {
      // Parse "192.168.1.1/24" → "192.168.1.0/24" for subnet matching
      const parts = vlan.ip_subnet.split("/");
      if (parts.length === 2) {
        const cidr = Number(parts[1]);
        const addrParts = parts[0].split(".").map(Number);
        const mask = cidr === 0 ? 0 : ((0xffffffff << (32 - cidr)) >>> 0);
        const network = addrParts.map((a, i) => {
          const maskByte = (mask >>> (24 - i * 8)) & 0xff;
          return a & maskByte;
        }).join(".");
        const subnetKey = `${network}/${cidr}`;
        const subnetRef = `subnet:${subnetKey}`;

        relationships.push({
          sourceKind: source,
          relationshipType: "MEMBER_OF",
          fromExternalRef: vlanRef,
          toExternalRef: subnetRef,
          confidence: 0.85,
          attributes: { derivedSubnet: subnetKey },
        });
      }
    }
  }

  // ── Fetch Clients (opt-in) ────────────────────────────────────
  if (resolvedDeps.discoverClients) {
    const clientResult = await unifiGet<UnifiClient>("stat/sta", resolvedDeps);
    if (clientResult.error) {
      warnings.push(`unifi_partial:sta`);
    }

    const clients = clientResult.data ?? [];
    for (const client of clients) {
      const clientRef = `unifi-client:${client.mac}`;
      const displayName = client.name ?? client.hostname ?? `Client ${client.mac}`;

      items.push({
        sourceKind: source,
        itemType: "network_client",
        name: displayName,
        externalRef: clientRef,
        naturalKey: `unifi-client:${client.mac}`,
        confidence: 0.70,
        attributes: {
          mac: client.mac,
          address: client.ip,
          hostname: client.hostname,
          isWired: client.is_wired,
          network: client.network,
          vlan: client.vlan,
          osiLayer: 3,
          osiLayerName: "network",
          ...(client.ip ? { networkAddress: client.ip, protocolFamily: "ipv4" } : {}),
        },
      });

      // Client CONNECTS_TO switch port (wired) or AP (wireless)
      if (client.is_wired && client.sw_mac) {
        const switchRef = macToRef.get(client.sw_mac);
        if (switchRef) {
          relationships.push({
            sourceKind: source,
            relationshipType: "CONNECTS_TO",
            fromExternalRef: clientRef,
            toExternalRef: switchRef,
            confidence: 0.85,
            attributes: {
              connectionType: "wired",
              switchPort: client.sw_port,
            },
          });
        }
      } else if (client.ap_mac) {
        const apRef = macToRef.get(client.ap_mac);
        if (apRef) {
          relationships.push({
            sourceKind: source,
            relationshipType: "CONNECTS_TO",
            fromExternalRef: clientRef,
            toExternalRef: apRef,
            confidence: 0.80,
            attributes: { connectionType: "wireless" },
          });
        }
      }

      // Client MEMBER_OF VLAN
      if (client.vlan != null) {
        const vlanRef = vlanIdToRef.get(String(client.vlan));
        if (vlanRef) {
          relationships.push({
            sourceKind: source,
            relationshipType: "MEMBER_OF",
            fromExternalRef: clientRef,
            toExternalRef: vlanRef,
            confidence: 0.80,
          });
        }
      }
    }
  }

  console.log(
    `[discovery] UniFi: discovered ${devices.length} devices, ${vlans.length} VLANs` +
    (resolvedDeps.discoverClients ? `, ${items.filter((i) => i.itemType === "network_client").length} clients` : ""),
  );

  return { items, relationships, software, warnings };
}
