import { describe, it, expect } from "vitest";

import { collectUnifiDiscovery, buildDepsFromConnection, type UnifiDeps } from "./unifi";

// ─── Fixtures ──────────────────────────────────────────────────────────────

function makeDevices() {
  return {
    meta: { rc: "ok" },
    data: [
      {
        mac: "aa:bb:cc:dd:ee:01",
        ip: "192.168.0.1",
        model: "UDM-Pro",
        name: "UDM Pro",
        type: "udm",
        version: "4.0.6",
        serial: "UDMPRO-SN-001",
        adopted: true,
        state: 1,
        num_sta: 15,
        uplink: undefined,
        lldp_table: [],
      },
      {
        mac: "aa:bb:cc:dd:ee:02",
        ip: "192.168.0.2",
        model: "USW-Pro-24-PoE",
        name: "Main Switch",
        type: "usw",
        version: "7.0.50",
        adopted: true,
        state: 1,
        num_sta: 10,
        uplink: { uplink_mac: "aa:bb:cc:dd:ee:01", uplink_remote_port: 1, type: "wire" },
        lldp_table: [{ chassis_id: "aa:bb:cc:dd:ee:01", port_id: "Port 1", local_port_idx: 25 }],
      },
      {
        mac: "aa:bb:cc:dd:ee:03",
        ip: "192.168.0.3",
        model: "U6-LR",
        name: "Living Room AP",
        type: "uap",
        version: "7.0.31",
        adopted: true,
        state: 1,
        num_sta: 8,
        uplink: { uplink_mac: "aa:bb:cc:dd:ee:02", uplink_remote_port: 5, type: "wire" },
        lldp_table: [{ chassis_id: "aa:bb:cc:dd:ee:02", port_id: "Port 5", local_port_idx: 0 }],
      },
    ],
  };
}

function makeNetworkConf() {
  return {
    meta: { rc: "ok" },
    data: [
      {
        _id: "abc123",
        name: "Default",
        purpose: "corporate",
        vlan_enabled: false,
        ip_subnet: "192.168.0.1/24",
        dhcpd_enabled: true,
      },
      {
        _id: "def456",
        name: "IoT",
        purpose: "vlan-only",
        vlan_enabled: true,
        vlan: 30,
        ip_subnet: "192.168.30.1/24",
        dhcpd_enabled: true,
      },
    ],
  };
}

function makeClients() {
  return {
    meta: { rc: "ok" },
    data: [
      {
        mac: "11:22:33:44:55:01",
        ip: "192.168.0.100",
        hostname: "desktop-pc",
        name: "Desktop PC",
        sw_mac: "aa:bb:cc:dd:ee:02",
        sw_port: 3,
        is_wired: true,
        network: "Default",
        vlan: undefined,
      },
      {
        mac: "11:22:33:44:55:02",
        ip: "192.168.0.101",
        hostname: "laptop",
        ap_mac: "aa:bb:cc:dd:ee:03",
        is_wired: false,
        network: "Default",
        vlan: undefined,
      },
      {
        mac: "11:22:33:44:55:03",
        ip: "192.168.30.50",
        hostname: "smart-thermostat",
        ap_mac: "aa:bb:cc:dd:ee:03",
        is_wired: false,
        network: "IoT",
        vlan: 30,
      },
    ],
  };
}

function makeHealth() {
  return {
    data: [
      {
        subsystem: "wan",
        status: "ok",
        wan_ip: "98.97.96.95",
        isp_name: "Starlink",
        isp_organization: "SpaceX Services, Inc.",
        latency: 42,
        uptime: 864000,
        gw_mac: "aa:bb:cc:dd:ee:01",
      },
      { subsystem: "wlan", status: "ok" },
    ],
  };
}

function makeDeps(overrides: Partial<UnifiDeps> = {}): UnifiDeps {
  const responses: Record<string, unknown> = {
    "stat/device": makeDevices(),
    "rest/networkconf": makeNetworkConf(),
    "stat/sta": makeClients(),
    "stat/health": makeHealth(),
  };

  return {
    fetchFn: async (url: string | URL) => {
      const urlStr = String(url);
      for (const [path, data] of Object.entries(responses)) {
        if (urlStr.includes(path)) {
          return new Response(JSON.stringify(data), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
      }
      return new Response("Not Found", { status: 404 });
    },
    unifiUrl: "https://192.168.0.1",
    apiKey: "test-api-key",
    site: "default",
    discoverClients: false,
    tlsInsecure: false,
    ...overrides,
  };
}

// ─── Device Discovery ─────────────────────────────────────────────────────

describe("collectUnifiDiscovery", () => {
  it("uses the official UniFi API to model the physical device chain", async () => {
    const seen: string[] = [];
    const deps = makeDeps({
      fetchFn: async (url: string | URL) => {
        const path = new URL(String(url)).pathname;
        seen.push(path);
        if (path.endsWith("/integration/v1/sites")) {
          return Response.json({ data: [{ id: "site-1", name: "Default" }] });
        }
        if (path.endsWith("/integration/v1/sites/site-1/devices")) {
          return Response.json({ data: [
            { id: "gw-1", macAddress: "aa:bb:cc:dd:ee:01", ipAddress: "192.168.0.1", name: "Cloud Gateway Ultra", model: "UCG-Ultra", firmwareVersion: "4.1.13", features: ["switching"] },
            { id: "sw-1", macAddress: "aa:bb:cc:dd:ee:02", ipAddress: "192.168.0.2", name: "US 8 PoE 150W", model: "US-8-150W", firmwareVersion: "7.1.26", features: ["switching"] },
            { id: "ap-1", macAddress: "aa:bb:cc:dd:ee:03", ipAddress: "192.168.0.3", name: "U7 Pro", model: "U7-Pro", firmwareVersion: "8.0.24", features: ["accessPoint"] },
          ] });
        }
        if (path.endsWith("/integration/v1/sites/site-1/devices/gw-1")) {
          return Response.json({ id: "gw-1" });
        }
        if (path.endsWith("/integration/v1/sites/site-1/devices/sw-1")) {
          return Response.json({ id: "sw-1", uplink: { deviceId: "gw-1", portNumber: 1 } });
        }
        if (path.endsWith("/integration/v1/sites/site-1/devices/ap-1")) {
          return Response.json({ id: "ap-1", uplink: { deviceId: "sw-1", portNumber: 5 } });
        }
        return new Response("Not Found", { status: 404 });
      },
    });

    const result = await collectUnifiDiscovery({ sourceKind: "unifi" }, deps);

    expect(result.items.map((item) => item.itemType)).toEqual(["router", "switch", "access_point"]);
    expect(result.relationships).toEqual(expect.arrayContaining([
      expect.objectContaining({ relationshipType: "CONNECTS_TO", fromExternalRef: "unifi-device:aa:bb:cc:dd:ee:02", toExternalRef: "unifi-device:aa:bb:cc:dd:ee:01" }),
      expect.objectContaining({ relationshipType: "CONNECTS_TO", fromExternalRef: "unifi-device:aa:bb:cc:dd:ee:03", toExternalRef: "unifi-device:aa:bb:cc:dd:ee:02" }),
    ]));
    expect(result.warnings).toEqual([]);
    expect(seen.filter((path) => path.includes("/proxy/network/api/s/"))).toEqual([
      "/proxy/network/api/s/default/stat/health",
    ]);
  });

  it("links official API clients to the UniFi device named by access evidence", async () => {
    const deps = makeDeps({
      discoverClients: true,
      fetchFn: async (url: string | URL) => {
        const path = new URL(String(url)).pathname;
        if (path.endsWith("/integration/v1/sites")) {
          return Response.json({ data: [{ id: "site-1", name: "Default" }] });
        }
        if (path.endsWith("/integration/v1/sites/site-1/devices")) {
          return Response.json({ data: [
            { id: "gw-1", macAddress: "aa:bb:cc:dd:ee:01", name: "Cloud Gateway Ultra", model: "UCG-Ultra", features: ["switching"] },
            { id: "ap-1", macAddress: "aa:bb:cc:dd:ee:03", name: "U7 Pro", model: "U7-Pro", features: ["accessPoint"] },
          ] });
        }
        if (path.endsWith("/integration/v1/sites/site-1/devices/gw-1")) {
          return Response.json({ id: "gw-1" });
        }
        if (path.endsWith("/integration/v1/sites/site-1/devices/ap-1")) {
          return Response.json({ id: "ap-1", uplink: { deviceId: "gw-1" } });
        }
        if (path.endsWith("/integration/v1/sites/site-1/clients")) {
          return Response.json({ data: [{
            id: "client-1",
            macAddress: "11:22:33:44:55:02",
            name: "Laptop",
            type: "WIRELESS",
            access: { deviceId: "ap-1", type: "DEFAULT" },
          }] });
        }
        return new Response("Not Found", { status: 404 });
      },
    });

    const result = await collectUnifiDiscovery({ sourceKind: "unifi" }, deps);

    expect(result.relationships).toContainEqual(expect.objectContaining({
      relationshipType: "CONNECTS_TO",
      fromExternalRef: "unifi-client:11:22:33:44:55:02",
      toExternalRef: "unifi-device:aa:bb:cc:dd:ee:03",
    }));
  });

  it("enriches an official API topology with the controller WAN subsystem", async () => {
    const deps = makeDeps({
      fetchFn: async (url: string | URL) => {
        const path = new URL(String(url)).pathname;
        if (path.endsWith("/integration/v1/sites")) {
          return Response.json({ data: [{ id: "site-1", name: "Default" }] });
        }
        if (path.endsWith("/integration/v1/sites/site-1/devices")) {
          return Response.json({ data: [{
            id: "gw-1",
            macAddress: "aa:bb:cc:dd:ee:01",
            name: "Cloud Gateway Ultra",
            model: "UCG-Ultra",
            features: ["switching"],
          }] });
        }
        if (path.endsWith("/integration/v1/sites/site-1/devices/gw-1")) {
          return Response.json({ id: "gw-1" });
        }
        if (path.endsWith("/proxy/network/api/s/default/stat/health")) {
          return Response.json(makeHealth());
        }
        return new Response("Not Found", { status: 404 });
      },
    });

    const result = await collectUnifiDiscovery({ sourceKind: "unifi" }, deps);

    expect(result.items).toContainEqual(expect.objectContaining({
      itemType: "wan_uplink",
      name: "Starlink (WAN)",
      externalRef: "unifi-wan:default:wan",
    }));
    expect(result.relationships).toContainEqual(expect.objectContaining({
      relationshipType: "UPLINKS_TO",
      fromExternalRef: "unifi-device:aa:bb:cc:dd:ee:01",
      toExternalRef: "unifi-wan:default:wan",
    }));
  });

  it("does not hide an official API authentication failure behind legacy fallback", async () => {
    const seen: string[] = [];
    const result = await collectUnifiDiscovery(undefined, makeDeps({
      fetchFn: async (url: string | URL) => {
        seen.push(String(url));
        return new Response("Unauthorized", { status: 401 });
      },
    }));

    expect(result.warnings).toContain("unifi_auth_failed");
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("/proxy/network/integration/v1/sites");
  });

  it("discovers devices with correct item types", async () => {
    const result = await collectUnifiDiscovery(undefined, makeDeps());

    const router = result.items.find((i) => i.itemType === "router");
    expect(router).toBeDefined();
    expect(router!.name).toBe("UDM Pro");
    expect(router!.externalRef).toBe("unifi-device:aa:bb:cc:dd:ee:01");
    expect(router!.attributes?.model).toBe("UDM-Pro");
    expect(router!.attributes?.osiLayer).toBe(3);
    // Serial captured under the canonical key the estate bridges read (BI-828998DC).
    expect(router!.attributes?.serialNumber).toBe("UDMPRO-SN-001");
    // The collector deliberately does NOT hardcode a vendor. It reports the MAC;
    // discovery-sync resolves the manufacturer from the IEEE OUI registry, which
    // generalises to every collector instead of one vendor's happy path
    // (BI-9632B15B). Pinned so a future "just set it here" does not creep back.
    expect(router!.attributes && "vendor" in router!.attributes).toBe(false);
    expect(router!.attributes?.mac).toBe("aa:bb:cc:dd:ee:01");

    const sw = result.items.find((i) => i.itemType === "switch");
    expect(sw).toBeDefined();
    expect(sw!.name).toBe("Main Switch");
    expect(sw!.attributes?.osiLayer).toBe(2);
    // A device with no serial in the API carries no serialNumber key (not an empty string).
    expect(sw!.attributes && "serialNumber" in sw!.attributes).toBe(false);
    // The MAC is what the collector owes; the vendor is derived downstream.
    expect(sw!.attributes?.mac).toBe("aa:bb:cc:dd:ee:02");

    const ap = result.items.find((i) => i.itemType === "access_point");
    expect(ap).toBeDefined();
    expect(ap!.name).toBe("Living Room AP");
    expect(ap!.attributes?.osiLayer).toBe(2);
  });

  it("emits firmware as software evidence", async () => {
    const result = await collectUnifiDiscovery(undefined, makeDeps());

    expect(result.software).toBeDefined();
    expect(result.software!.length).toBe(3);
    const routerFw = result.software!.find(
      (s) => s.entityExternalRef === "unifi-device:aa:bb:cc:dd:ee:01",
    );
    expect(routerFw).toBeDefined();
    expect(routerFw!.rawVendor).toBe("Ubiquiti");
    expect(routerFw!.rawProductName).toBe("UDM-Pro");
    expect(routerFw!.rawVersion).toBe("4.0.6");
  });

  // ─── Uplink Relationships ─────────────────────────────────────

  it("creates CONNECTS_TO relationships from device uplinks", async () => {
    const result = await collectUnifiDiscovery(undefined, makeDeps());

    const connectsTo = result.relationships.filter(
      (r) => r.relationshipType === "CONNECTS_TO",
    );
    // Switch → Router, AP → Switch
    expect(connectsTo.length).toBeGreaterThanOrEqual(2);

    const switchToRouter = connectsTo.find(
      (r) =>
        r.fromExternalRef === "unifi-device:aa:bb:cc:dd:ee:02" &&
        r.toExternalRef === "unifi-device:aa:bb:cc:dd:ee:01",
    );
    expect(switchToRouter).toBeDefined();
    expect(switchToRouter!.attributes?.connectionType).toBe("wire");
  });

  // ─── LLDP Relationships ───────────────────────────────────────

  it("creates PEER_OF relationships from LLDP data", async () => {
    const result = await collectUnifiDiscovery(undefined, makeDeps());

    const peerOf = result.relationships.filter(
      (r) => r.relationshipType === "PEER_OF",
    );
    expect(peerOf.length).toBeGreaterThanOrEqual(1);

    const switchPeerRouter = peerOf.find(
      (r) =>
        r.fromExternalRef === "unifi-device:aa:bb:cc:dd:ee:02" &&
        r.toExternalRef === "unifi-device:aa:bb:cc:dd:ee:01",
    );
    expect(switchPeerRouter).toBeDefined();
    expect(switchPeerRouter!.attributes?.protocol).toBe("lldp");
  });

  // ─── VLAN Discovery ───────────────────────────────────────────

  it("models the internet uplink and links the gateway to it (the WAN hop)", async () => {
    const result = await collectUnifiDiscovery({ sourceKind: "unifi" }, makeDeps());

    const wan = result.items.find((item) => item.itemType === "wan_uplink");
    expect(wan).toBeDefined();
    // Named after the ISP so the operator sees the dependency they actually have.
    expect(wan!.name).toBe("Starlink (WAN)");
    // Identity anchored on site + WAN designation, NEVER the public IP — a
    // Starlink CGNAT address rotates and would mint a new entity each time.
    expect(wan!.naturalKey).toBe("unifi-wan:default:wan");
    expect(wan!.externalRef).toBe("unifi-wan:default:wan");
    expect(wan!.attributes).toMatchObject({
      ispName: "Starlink",
      wanIp: "98.97.96.95",
      linkStatus: "ok",
      latencyMs: 42,
    });

    // The chain now reaches the internet: gateway -> WAN uplink.
    const uplink = result.relationships.find((r) => r.relationshipType === "UPLINKS_TO");
    expect(uplink).toBeDefined();
    expect(uplink!.fromExternalRef).toBe("unifi-device:aa:bb:cc:dd:ee:01");
    expect(uplink!.toExternalRef).toBe("unifi-wan:default:wan");
  });

  it("omits the uplink (without failing the sweep) when health has no wan subsystem", async () => {
    const deps = makeDeps({
      fetchFn: async (url: string | URL) => {
        const urlStr = String(url);
        if (urlStr.includes("/integration/v1/")) {
          return new Response("Not Found", { status: 404 });
        }
        if (urlStr.includes("stat/health")) {
          return new Response(JSON.stringify({ data: [{ subsystem: "wlan", status: "ok" }] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (urlStr.includes("stat/device")) {
          return new Response(JSON.stringify(makeDevices()), { status: 200 });
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      },
    });

    const result = await collectUnifiDiscovery({ sourceKind: "unifi" }, deps);

    expect(result.items.find((item) => item.itemType === "wan_uplink")).toBeUndefined();
    expect(result.relationships.find((r) => r.relationshipType === "UPLINKS_TO")).toBeUndefined();
    // Devices still collected — a missing WAN subsystem must not fail the sweep.
    expect(result.items.some((item) => item.itemType === "router")).toBe(true);
  });

  it("discovers VLANs from networkconf", async () => {
    const result = await collectUnifiDiscovery(undefined, makeDeps());

    const vlans = result.items.filter((i) => i.itemType === "vlan");
    expect(vlans).toHaveLength(2);

    const iotVlan = vlans.find((v) => v.name === "IoT");
    expect(iotVlan).toBeDefined();
    expect(iotVlan!.attributes?.vlanId).toBe(30);
    expect(iotVlan!.attributes?.osiLayer).toBe(2);
  });

  it("creates MEMBER_OF from VLAN to subnet", async () => {
    const result = await collectUnifiDiscovery(undefined, makeDeps());

    const vlanToSubnet = result.relationships.filter(
      (r) =>
        r.relationshipType === "MEMBER_OF" &&
        r.fromExternalRef?.startsWith("unifi-vlan:"),
    );
    expect(vlanToSubnet.length).toBeGreaterThanOrEqual(1);

    const iotToSubnet = vlanToSubnet.find(
      (r) => r.toExternalRef === "subnet:192.168.30.0/24",
    );
    expect(iotToSubnet).toBeDefined();
  });

  // ─── Client Discovery ─────────────────────────────────────────

  it("skips client discovery when disabled", async () => {
    const result = await collectUnifiDiscovery(
      undefined,
      makeDeps({ discoverClients: false }),
    );

    const clients = result.items.filter((i) => i.itemType === "network_client");
    expect(clients).toHaveLength(0);
  });

  it("discovers clients when enabled", async () => {
    const result = await collectUnifiDiscovery(
      undefined,
      makeDeps({ discoverClients: true }),
    );

    const clients = result.items.filter((i) => i.itemType === "network_client");
    expect(clients).toHaveLength(3);

    const desktop = clients.find((c) => c.name === "Desktop PC");
    expect(desktop).toBeDefined();
    expect(desktop!.attributes?.isWired).toBe(true);
    expect(desktop!.attributes?.osiLayer).toBe(3);
  });

  it("creates CONNECTS_TO from wired client to switch", async () => {
    const result = await collectUnifiDiscovery(
      undefined,
      makeDeps({ discoverClients: true }),
    );

    const clientToSwitch = result.relationships.find(
      (r) =>
        r.relationshipType === "CONNECTS_TO" &&
        r.fromExternalRef === "unifi-client:11:22:33:44:55:01" &&
        r.toExternalRef === "unifi-device:aa:bb:cc:dd:ee:02",
    );
    expect(clientToSwitch).toBeDefined();
    expect(clientToSwitch!.attributes?.connectionType).toBe("wired");
    expect(clientToSwitch!.attributes?.switchPort).toBe(3);
  });

  it("creates CONNECTS_TO from wireless client to AP", async () => {
    const result = await collectUnifiDiscovery(
      undefined,
      makeDeps({ discoverClients: true }),
    );

    const clientToAp = result.relationships.find(
      (r) =>
        r.relationshipType === "CONNECTS_TO" &&
        r.fromExternalRef === "unifi-client:11:22:33:44:55:02" &&
        r.toExternalRef === "unifi-device:aa:bb:cc:dd:ee:03",
    );
    expect(clientToAp).toBeDefined();
    expect(clientToAp!.attributes?.connectionType).toBe("wireless");
  });

  it("creates MEMBER_OF from client to VLAN", async () => {
    const result = await collectUnifiDiscovery(
      undefined,
      makeDeps({ discoverClients: true }),
    );

    const clientToVlan = result.relationships.find(
      (r) =>
        r.relationshipType === "MEMBER_OF" &&
        r.fromExternalRef === "unifi-client:11:22:33:44:55:03",
    );
    expect(clientToVlan).toBeDefined();
  });

  // ─── Silent Skip ──────────────────────────────────────────────

  it("returns empty output when deps is null (unconfigured)", async () => {
    const result = await collectUnifiDiscovery(undefined, null);

    expect(result.items).toHaveLength(0);
    expect(result.relationships).toHaveLength(0);
    expect(result.warnings).toBeUndefined();
  });

  // ─── Error Handling ───────────────────────────────────────────

  it("returns warning on network unreachable", async () => {
    const deps = makeDeps({
      fetchFn: async () => {
        throw new Error("connect ECONNREFUSED");
      },
    });

    const result = await collectUnifiDiscovery(undefined, deps);

    expect(result.items).toHaveLength(0);
    expect(result.warnings).toContain("unifi_unreachable");
  });

  it("returns warning on auth failure", async () => {
    const deps = makeDeps({
      fetchFn: async () =>
        new Response("Unauthorized", { status: 401 }),
    });

    const result = await collectUnifiDiscovery(undefined, deps);

    expect(result.items).toHaveLength(0);
    expect(result.warnings).toContain("unifi_auth_failed");
  });

  it("returns warning when no devices found", async () => {
    const deps = makeDeps({
      fetchFn: async (url: string | URL) => {
        const urlStr = String(url);
        if (urlStr.includes("/integration/v1/")) {
          return new Response("Not Found", { status: 404 });
        }
        if (urlStr.includes("stat/device")) {
          return new Response(JSON.stringify({ data: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("Not Found", { status: 404 });
      },
    });

    const result = await collectUnifiDiscovery(undefined, deps);

    expect(result.items).toHaveLength(0);
    expect(result.warnings).toContain("unifi_no_devices");
  });

  it("returns partial results when networkconf fails", async () => {
    const deviceData = makeDevices();
    const deps = makeDeps({
      fetchFn: async (url: string | URL) => {
        const urlStr = String(url);
        if (urlStr.includes("/integration/v1/")) {
          return new Response("Not Found", { status: 404 });
        }
        if (urlStr.includes("stat/device")) {
          return new Response(JSON.stringify(deviceData), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        // networkconf fails
        return new Response("Server Error", { status: 500 });
      },
    });

    const result = await collectUnifiDiscovery(undefined, deps);

    // Devices still discovered
    expect(result.items.filter((i) => i.itemType !== "vlan").length).toBe(3);
    expect(result.warnings).toContain("unifi_partial:networkconf");
  });

  it("returns warning on TLS error", async () => {
    const deps = makeDeps({
      fetchFn: async () => {
        throw new Error("unable to verify the first certificate (TLS)");
      },
    });

    const result = await collectUnifiDiscovery(undefined, deps);

    expect(result.items).toHaveLength(0);
    expect(result.warnings).toContain("unifi_tls_error");
  });

  it("returns empty output when deps is undefined (no connections)", async () => {
    const result = await collectUnifiDiscovery(undefined, undefined);

    expect(result.items).toHaveLength(0);
    expect(result.relationships).toHaveLength(0);
  });
});

// ─── buildDepsFromConnection ────────────────────────────────────────────────

describe("buildDepsFromConnection", () => {
  it("builds deps from a connection input", () => {
    const deps = buildDepsFromConnection({
      endpointUrl: "https://192.168.0.1/",
      apiKey: "test-key-123",
      configuration: { site: "mysite", discoverClients: true },
    });

    expect(deps.unifiUrl).toBe("https://192.168.0.1");
    expect(deps.apiKey).toBe("test-key-123");
    expect(deps.site).toBe("mysite");
    expect(deps.discoverClients).toBe(true);
    expect(typeof deps.fetchFn).toBe("function");
  });

  it("uses defaults for missing configuration", () => {
    const deps = buildDepsFromConnection({
      endpointUrl: "https://10.0.0.1",
      apiKey: "key",
    });

    expect(deps.site).toBe("default");
    expect(deps.discoverClients).toBe(false);
    expect(deps.tlsInsecure).toBe(false);
  });

  it("honors the per-connection TLS policy", () => {
    const deps = buildDepsFromConnection({
      endpointUrl: "https://192.168.0.1",
      apiKey: "key",
      configuration: { tlsInsecure: true },
    });

    expect(deps.tlsInsecure).toBe(true);
  });
});
