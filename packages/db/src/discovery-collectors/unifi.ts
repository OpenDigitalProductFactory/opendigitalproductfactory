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
  fetchFn: (url: string | URL, init?: RequestInit) => Promise<Response>;
  unifiUrl: string;
  apiKey: string;
  site: string;
  discoverClients: boolean;
  tlsInsecure: boolean;
};

function createUnifiFetch(tlsInsecure: boolean): UnifiDeps["fetchFn"] {
  // CodeQL #61 (js/disabling-certificate-validation): UniFi controllers
  // ship with self-signed certificates by default. To talk to them at
  // all we have to skip cert validation — but we make that explicit
  // and opt-in per connection (or via the legacy env var) rather than
  // silently disabling validation.
  //
  // Default: strict cert validation. Operators running standard closed-LAN
  // UniFi appliances can opt into the self-signed flow per DiscoveryConnection.
  const allowInsecure = tlsInsecure || process.env.UNIFI_ALLOW_INSECURE_TLS === "true";
  const agent = new https.Agent({ rejectUnauthorized: !allowInsecure });
  if (allowInsecure) {
    // eslint-disable-next-line no-console
    console.warn(
      "[unifi] TLS cert validation disabled for this connection. " +
        "Acceptable for self-signed UniFi controllers; rotate to a valid cert in production.",
    );
  }
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
