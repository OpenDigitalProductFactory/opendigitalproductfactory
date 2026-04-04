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

function makeDeps(overrides: Partial<UnifiDeps> = {}): UnifiDeps {
  const responses: Record<string, unknown> = {
    "stat/device": makeDevices(),
    "rest/networkconf": makeNetworkConf(),
    "stat/sta": makeClients(),
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
    ...overrides,
  };
}

// ─── Device Discovery ─────────────────────────────────────────────────────

describe("collectUnifiDiscovery", () => {
  it("discovers devices with correct item types", async () => {
    const result = await collectUnifiDiscovery(undefined, makeDeps());

    const router = result.items.find((i) => i.itemType === "router");
    expect(router).toBeDefined();
    expect(router!.name).toBe("UDM Pro");
    expect(router!.externalRef).toBe("unifi-device:aa:bb:cc:dd:ee:01");
    expect(router!.attributes?.model).toBe("UDM-Pro");
    expect(router!.attributes?.osiLayer).toBe(3);

    const sw = result.items.find((i) => i.itemType === "switch");
    expect(sw).toBeDefined();
    expect(sw!.name).toBe("Main Switch");
    expect(sw!.attributes?.osiLayer).toBe(2);

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
  });
});
