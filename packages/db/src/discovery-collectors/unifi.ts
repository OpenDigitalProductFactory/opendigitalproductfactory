import https from "node:https";

import type {
  CollectorContext,
  CollectorOutput,
  DiscoveredItemInput,
  DiscoveredRelationshipInput,
  DiscoveredSoftwareInput,
} from "../discovery-types";

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
  adopted?: boolean;
  state?: number; // 1 = connected
  port_table?: UnifiDevicePort[];
  uplink?: UnifiDeviceUplink;
  lldp_table?: UnifiLldpEntry[];
  num_sta?: number;
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
  };
};

// ─── Dependency Injection ─────────────────────────────────────────────────────

export type UnifiDeps = {
  fetchFn: (url: string | URL, init?: RequestInit) => Promise<Response>;
  unifiUrl: string;
  apiKey: string;
  site: string;
  discoverClients: boolean;
};

function createInsecureFetch(): UnifiDeps["fetchFn"] {
  const agent = new https.Agent({ rejectUnauthorized: false });
  return (url, init) =>
    new Promise((resolve, reject) => {
      const parsedUrl = new URL(String(url));
      const headers: Record<string, string> = {};
      if (init?.headers) {
        const h = init.headers as Record<string, string>;
        for (const [k, v] of Object.entries(h)) headers[k] = v;
      }
      const req = https.request(
        {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port || 443,
          path: parsedUrl.pathname + parsedUrl.search,
          method: init?.method ?? "GET",
          agent,
          headers,
        },
        (res) => {
          let body = "";
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () => {
            resolve(new Response(body, {
              status: res.statusCode ?? 500,
              headers: (res.headers ?? {}) as Record<string, string>,
            }));
          });
        },
      );
      if (init?.signal) {
        init.signal.addEventListener("abort", () => {
          req.destroy();
          reject(new Error("aborted"));
        });
      }
      req.on("error", reject);
      req.end();
    });
}

/** Build deps from a DiscoveryConnection loaded by the runner. */
export function buildDepsFromConnection(conn: UnifiConnectionInput): UnifiDeps {
  return {
    fetchFn: createInsecureFetch(),
    unifiUrl: conn.endpointUrl.replace(/\/+$/, ""),
    apiKey: conn.apiKey,
    site: conn.configuration?.site ?? "default",
    discoverClients: conn.configuration?.discoverClients ?? false,
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
