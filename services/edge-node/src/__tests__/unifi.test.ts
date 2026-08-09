// Unit tests for the UniFi collector.
//
// After the BI-35de9ce8 consolidation, collectUnifi takes its configs
// as an argument instead of reading them from a bind-mounted file.
// These tests pass `[VALID_CONFIG_OBJ]` directly to exercise the
// collector's HTTP + parse + relationship-building paths.

import { describe, expect, it } from "vitest";
import {
  collectUnifi,
  type UnifiAdapter,
  type UnifiAdapterConfig,
} from "../collectors/unifi";

const VALID_CONFIG_OBJ: UnifiAdapterConfig = {
  controllerUrl: "https://192.168.1.1",
  apiKey: "test-key",
  site: "default",
  tlsInsecure: false,
};

type StubResp = {
  ok?: boolean;
  status?: number;
  body?: unknown;
  throwErr?: string;
};

/**
 * Per-endpoint stub. Test passes responses keyed by the endpoint
 * substring ("stat/device" or "stat/sta"). Endpoints not in the map
 * default to an empty `{ data: [] }` success response — so a test
 * that only cares about device behavior automatically gets a clean
 * empty-clients response from the parallel /stat/sta fetch the
 * collector now makes.
 */
function makeFetchStubByEndpoint(
  responses: { devices?: StubResp; clients?: StubResp },
): UnifiAdapter["fetch"] {
  return async (url) => {
	if (url.includes("/proxy/network/integration/v1/")) {
	  return {
		ok: false,
		status: 404,
		json: async () => ({}),
		text: async () => "not supported",
	  };
	}
    let r: StubResp;
    if (url.includes("/stat/device")) {
      r = responses.devices ?? {};
    } else if (url.includes("/stat/sta")) {
      r = responses.clients ?? {};
    } else {
      r = {};
    }
    if (r.throwErr) throw new Error(r.throwErr);
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      json: async () => r.body ?? { data: [] },
      text: async () =>
        typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? {}),
    };
  };
}

/**
 * Legacy stub kept for tests written before Slice B — responds only
 * to /stat/device with the user-supplied responder; /stat/sta defaults
 * to an empty success response.
 */
function makeFetchStub(
  responder: (url: string, init: { headers?: Record<string, string> }) => StubResp,
): UnifiAdapter["fetch"] {
  return async (url, init) => {
	if (url.includes("/proxy/network/integration/v1/")) {
	  return {
		ok: false,
		status: 404,
		json: async () => ({}),
		text: async () => "not supported",
	  };
	}
    if (!url.includes("/stat/device")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: [] }),
        text: async () => `{"data":[]}`,
      };
    }
    const r = responder(url, init);
    if (r.throwErr) throw new Error(r.throwErr);
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      json: async () => r.body ?? { data: [] },
      text: async () =>
        typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? {}),
    };
  };
}

const aDevice = (overrides: Record<string, unknown> = {}) => ({
  mac: "aa:bb:cc:dd:ee:ff",
  ip: "192.168.1.10",
  name: "Living Room AP",
  model: "U7PG2",
  model_name: "UniFi AP-AC-Pro",
  type: "uap",
  serial: "ABC123",
  state: 1,
  version: "6.6.78",
  ...overrides,
});

describe("collectUnifi — no configs", () => {
  it("is a no-op when the configs array is empty", async () => {
    const adapter: UnifiAdapter = { fetch: makeFetchStub(() => ({})) };
    const result = await collectUnifi([], adapter);
    expect(result.items).toEqual([]);
    expect(result.relationships).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});

describe("collectUnifi — official local API", () => {
  it("resolves the configured site UUID and emits the physical device hierarchy", async () => {
    const requests: string[] = [];
    const adapter: UnifiAdapter = {
      fetch: async (url) => {
        requests.push(url);
        const body = url.includes("/sites?")
          ? { offset: 0, limit: 100, count: 1, totalCount: 1, data: [{ id: "site-uuid", internalReference: "default", name: "Default" }] }
          : url.includes("/devices?")
            ? {
                offset: 0,
                limit: 100,
                count: 2,
                totalCount: 2,
                data: [
                  { id: "gw", macAddress: "aa:aa:aa:aa:aa:aa", ipAddress: "192.168.0.1", name: "Cloud Gateway Ultra", model: "UCG-Ultra", state: "ONLINE", features: ["routing"] },
                  { id: "sw", macAddress: "bb:bb:bb:bb:bb:bb", ipAddress: "192.168.0.2", name: "US 8 PoE 150W", model: "US-8-150W", state: "ONLINE", features: ["switching"] },
                ],
              }
            : url.endsWith("/devices/gw")
              ? { id: "gw", uplink: null, interfaces: { ports: [] } }
              : url.endsWith("/devices/sw")
                ? { id: "sw", uplink: { deviceId: "gw" }, interfaces: { ports: [] } }
                : { offset: 0, limit: 100, count: 0, totalCount: 0, data: [] };
        return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
      },
    };

    const result = await collectUnifi([VALID_CONFIG_OBJ], adapter);

    expect(requests[0]).toBe("https://192.168.1.1/proxy/network/integration/v1/sites?offset=0&limit=100");
    expect(result.items.map((item) => [item.observedKey, item.itemType])).toEqual([
      ["unifi:aa:aa:aa:aa:aa:aa", "gateway"],
      ["unifi:bb:bb:bb:bb:bb:bb", "switch"],
    ]);
    expect(result.relationships).toContainEqual(expect.objectContaining({
      fromObservedKey: "unifi:aa:aa:aa:aa:aa:aa",
      toObservedKey: "unifi:bb:bb:bb:bb:bb:bb",
      relationshipType: "HOSTS",
    }));
    expect(result.warnings).toEqual([]);
  });

  it("classifies an authenticated zero-device result as degraded", async () => {
    const adapter: UnifiAdapter = {
      fetch: async (url) => {
        const body = url.includes("/sites?")
          ? { offset: 0, limit: 100, count: 1, totalCount: 1, data: [{ id: "site-uuid", internalReference: "default", name: "Default" }] }
          : { offset: 0, limit: 100, count: 0, totalCount: 0, data: [] };
        return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
      },
    };

    const result = await collectUnifi([VALID_CONFIG_OBJ], adapter);
    expect(result.warnings).toContain("unifi_no_devices");
  });
});

describe("collectUnifi — controller success", () => {
  it("maps an AP device to an access_point ObservationItem and SAME_AS link", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> | undefined;
    const adapter: UnifiAdapter = {
      fetch: makeFetchStub((url, init) => {
        capturedUrl = url;
        capturedHeaders = init.headers;
        return { body: { data: [aDevice()] } };
      }),
    };

    const result = await collectUnifi([VALID_CONFIG_OBJ], adapter);

    expect(capturedUrl).toBe("https://192.168.1.1/proxy/network/api/s/default/stat/device");
    expect(capturedHeaders?.["X-API-KEY"]).toBe("test-key");

    expect(result.items).toEqual([
      {
        observedKey: "unifi:aa:bb:cc:dd:ee:ff",
        itemType: "access_point",
        name: "Living Room AP",
        confidence: 1.0,
        rawData: expect.objectContaining({
          mac: "aa:bb:cc:dd:ee:ff",
          ip: "192.168.1.10",
          type: "uap",
          osiLayer: 2,
          osiLayerName: "data_link",
          discoveredVia: "unifi_api",
        }),
      },
    ]);

    expect(result.relationships).toEqual([
      {
        fromObservedKey: "unifi:aa:bb:cc:dd:ee:ff",
        toObservedKey: "arp:192.168.1.10",
        relationshipType: "SAME_AS",
        rawData: { mechanism: "unifi_controller_arp_correlation" },
      },
    ]);

    expect(result.warnings).toEqual([]);
  });

  it("maps gateway types (ugw / udm / udmpro) to itemType=gateway with osiLayer=3", async () => {
    const adapter: UnifiAdapter = {
      fetch: makeFetchStub(() => ({
        body: {
          data: [
            aDevice({ mac: "11:11:11:11:11:11", type: "udmpro", name: "UDM Pro" }),
          ],
        },
      })),
    };
    const result = await collectUnifi([VALID_CONFIG_OBJ], adapter);
    expect(result.items[0]?.itemType).toBe("gateway");
    expect(result.items[0]?.rawData.osiLayer).toBe(3);
    expect(result.items[0]?.rawData.osiLayerName).toBe("network");
  });

  it("emits HOSTS edges from uplink_mac when the parent is also in the response", async () => {
    const adapter: UnifiAdapter = {
      fetch: makeFetchStub(() => ({
        body: {
          data: [
            aDevice({ mac: "aa:aa:aa:aa:aa:aa", type: "udm", name: "Gateway" }),
            aDevice({
              mac: "bb:bb:bb:bb:bb:bb",
              type: "usw",
              name: "Switch",
              uplink: { uplink_mac: "aa:aa:aa:aa:aa:aa", uplink_remote_port: 1 },
            }),
            aDevice({
              mac: "cc:cc:cc:cc:cc:cc",
              type: "uap",
              name: "AP",
              uplink: { uplink_mac: "bb:bb:bb:bb:bb:bb", uplink_remote_port: 5 },
            }),
          ],
        },
      })),
    };

    const result = await collectUnifi([VALID_CONFIG_OBJ], adapter);
    const hosts = result.relationships.filter((r) => r.relationshipType === "HOSTS");
    expect(hosts).toEqual([
      {
        fromObservedKey: "unifi:aa:aa:aa:aa:aa:aa",
        toObservedKey: "unifi:bb:bb:bb:bb:bb:bb",
        relationshipType: "HOSTS",
        rawData: { parentPortIdx: 1, uplinkType: null },
      },
      {
        fromObservedKey: "unifi:bb:bb:bb:bb:bb:bb",
        toObservedKey: "unifi:cc:cc:cc:cc:cc:cc",
        relationshipType: "HOSTS",
        rawData: { parentPortIdx: 5, uplinkType: null },
      },
    ]);
  });

  it("skips HOSTS edges when the parent isn't in the response", async () => {
    const adapter: UnifiAdapter = {
      fetch: makeFetchStub(() => ({
        body: {
          data: [
            aDevice({
              mac: "bb:bb:bb:bb:bb:bb",
              type: "usw",
              uplink: { uplink_mac: "99:99:99:99:99:99" }, // dangling parent
            }),
          ],
        },
      })),
    };
    const result = await collectUnifi([VALID_CONFIG_OBJ], adapter);
    expect(result.relationships.filter((r) => r.relationshipType === "HOSTS")).toEqual([]);
  });

  it("drops devices with invalid MACs but doesn't fail the whole run", async () => {
    const adapter: UnifiAdapter = {
      fetch: makeFetchStub(() => ({
        body: {
          data: [
            aDevice({ mac: "not-a-mac" }),
            aDevice({ mac: "11:22:33:44:55:66" }),
          ],
        },
      })),
    };
    const result = await collectUnifi([VALID_CONFIG_OBJ], adapter);
    expect(result.items.map((i) => i.observedKey)).toEqual(["unifi:11:22:33:44:55:66"]);
  });
});

// ─── Slice B — clients ────────────────────────────────────────────

const aWifiClient = (overrides: Record<string, unknown> = {}) => ({
  mac: "fc:a1:83:11:22:33", // Amazon OUI (in bundled IEEE registry)
  ip: "192.168.0.49",
  hostname: "echo-dot-bedroom",
  name: "Echo Dot — Bedroom",
  is_wired: false,
  is_guest: false,
  network: "LAN",
  ap_mac: "aa:aa:aa:aa:aa:aa",
  essid: "HomeNet",
  channel: 36,
  radio: "na",
  signal: -50,
  rssi: 45,
  noise: -95,
  first_seen: 1716240000,
  last_seen: 1716243600,
  ...overrides,
});

const aWiredClient = (overrides: Record<string, unknown> = {}) => ({
  mac: "00:1d:c0:de:fa:ce",
  ip: "192.168.0.99",
  hostname: "reolink-cam-driveway",
  is_wired: true,
  is_guest: false,
  network: "LAN",
  sw_mac: "bb:bb:bb:bb:bb:bb",
  sw_port: 4,
  first_seen: 1716200000,
  last_seen: 1716243600,
  ...overrides,
});

describe("collectUnifi — Slice B clients", () => {
  it("maps a WiFi client to a stable MAC-keyed ObservationItem with vendor enrichment", async () => {
    const adapter: UnifiAdapter = {
      fetch: makeFetchStubByEndpoint({
        clients: { body: { data: [aWifiClient()] } },
      }),
    };
    const result = await collectUnifi([VALID_CONFIG_OBJ], adapter);
    expect(result.items).toHaveLength(1);
    const item = result.items[0]!;
    expect(item.observedKey).toBe("unifi-client:fc:a1:83:11:22:33");
    expect(item.itemType).toBe("network_client");
    expect(item.confidence).toBe(0.9);
    // Operator-set name wins over hostname + vendor.
    expect(item.name).toBe("Echo Dot — Bedroom");
    // OUI enrichment fired (FC:A1:83 is Amazon).
    expect(item.rawData.vendor).toMatch(/^Amazon/);
    expect(item.rawData.vendorOui).toBe("FCA183");
    expect(item.rawData.vendorShort).toBe("Amazon");
    // WiFi-only fields populated.
    expect(item.rawData.isWired).toBe(false);
    expect(item.rawData.apMac).toBe("aa:aa:aa:aa:aa:aa");
    expect(item.rawData.essid).toBe("HomeNet");
    expect(item.rawData.signal).toBe(-50);
    // Wired-only fields absent (or null) on a WiFi client.
    expect(item.rawData.swMac).toBeUndefined();
    expect(item.rawData.swPort).toBeUndefined();
    // Discovery source records this came from the clients endpoint
    // specifically, not the local ARP cache.
    expect(item.rawData.discoveredVia).toBe("unifi_clients_api");
  });

  it("falls back to vendor-shaped name when no operator name + no hostname", async () => {
    const adapter: UnifiAdapter = {
      fetch: makeFetchStubByEndpoint({
        clients: {
          body: {
            data: [aWifiClient({ name: undefined, hostname: undefined })],
          },
        },
      }),
    };
    const result = await collectUnifi([VALID_CONFIG_OBJ], adapter);
    expect(result.items[0]?.name).toBe("Amazon 192.168.0.49");
  });

  it("falls back to LAN Host shape when no name, no hostname, no OUI match", async () => {
    const adapter: UnifiAdapter = {
      fetch: makeFetchStubByEndpoint({
        clients: {
          body: {
            data: [
              aWifiClient({
                mac: "de:ad:be:ef:00:01", // not in IEEE registry
                name: undefined,
                hostname: undefined,
                ip: "192.168.0.77",
              }),
            ],
          },
        },
      }),
    };
    const result = await collectUnifi([VALID_CONFIG_OBJ], adapter);
    expect(result.items[0]?.name).toBe("LAN Host 192.168.0.77");
    expect(result.items[0]?.rawData.vendor).toBeUndefined();
  });

  it("emits a physical CONNECTS_TO link from a WiFi client to its AP", async () => {
    const adapter: UnifiAdapter = {
      fetch: makeFetchStubByEndpoint({
        clients: { body: { data: [aWifiClient()] } },
      }),
    };
    const result = await collectUnifi([VALID_CONFIG_OBJ], adapter);
    const connectsTo = result.relationships.filter((r) => r.relationshipType === "CONNECTS_TO");
    expect(connectsTo).toEqual([
      {
        fromObservedKey: "unifi-client:fc:a1:83:11:22:33",
        toObservedKey: "unifi:aa:aa:aa:aa:aa:aa",
        relationshipType: "CONNECTS_TO",
        rawData: {
          mechanism: "unifi_wifi_assoc",
          port: null,
          essid: "HomeNet",
        },
      },
    ]);
  });

  it("emits wired-specific CONNECTS_TO link from a wired client to its switch+port", async () => {
    const adapter: UnifiAdapter = {
      fetch: makeFetchStubByEndpoint({
        clients: { body: { data: [aWiredClient()] } },
      }),
    };
    const result = await collectUnifi([VALID_CONFIG_OBJ], adapter);
    const connectsTo = result.relationships.filter((r) => r.relationshipType === "CONNECTS_TO");
    expect(connectsTo).toEqual([
      {
        fromObservedKey: "unifi-client:00:1d:c0:de:fa:ce",
        toObservedKey: "unifi:bb:bb:bb:bb:bb:bb",
        relationshipType: "CONNECTS_TO",
        rawData: {
          mechanism: "unifi_switch_port",
          port: 4,
          essid: null,
        },
      },
    ]);

    // Wired-only fields present on item rawData; WiFi-only absent.
    const item = result.items[0]!;
    expect(item.rawData.swMac).toBe("bb:bb:bb:bb:bb:bb");
    expect(item.rawData.swPort).toBe(4);
    expect(item.rawData.apMac).toBeUndefined();
    expect(item.rawData.essid).toBeUndefined();
  });

  it("skips CONNECTS_TO when ap_mac (wifi) or sw_mac (wired) is missing", async () => {
    const adapter: UnifiAdapter = {
      fetch: makeFetchStubByEndpoint({
        clients: {
          body: {
            data: [
              aWifiClient({ ap_mac: undefined }),
              aWiredClient({ sw_mac: undefined }),
            ],
          },
        },
      }),
    };
    const result = await collectUnifi([VALID_CONFIG_OBJ], adapter);
    expect(result.items).toHaveLength(2);
    expect(result.relationships.filter((r) => r.relationshipType === "CONNECTS_TO")).toEqual([]);
  });

  it("drops clients with missing or invalid IP / MAC", async () => {
    const adapter: UnifiAdapter = {
      fetch: makeFetchStubByEndpoint({
        clients: {
          body: {
            data: [
              aWifiClient({ mac: "not-a-mac" }),
              aWifiClient({ ip: undefined, mac: "aa:bb:cc:dd:ee:01" }),
              aWifiClient({ mac: "aa:bb:cc:dd:ee:02", ip: "10.0.0.42" }),
            ],
          },
        },
      }),
    };
    const result = await collectUnifi([VALID_CONFIG_OBJ], adapter);
    expect(result.items.map((i) => i.observedKey)).toEqual(["unifi-client:aa:bb:cc:dd:ee:02"]);
  });

  it("merges devices + clients into one envelope", async () => {
    const adapter: UnifiAdapter = {
      fetch: makeFetchStubByEndpoint({
        devices: { body: { data: [aDevice()] } },
        clients: { body: { data: [aWifiClient()] } },
      }),
    };
    const result = await collectUnifi([VALID_CONFIG_OBJ], adapter);
    const keys = result.items.map((i) => i.observedKey).sort();
    expect(keys).toEqual([
      "unifi-client:fc:a1:83:11:22:33", // the WiFi client
      "unifi:aa:bb:cc:dd:ee:ff",  // the AP device
    ]);
    // Relationships from BOTH endpoints present.
    const types = result.relationships.map((r) => r.relationshipType).sort();
    expect(types).toEqual(["CONNECTS_TO", "SAME_AS", "SAME_AS"]);
  });

  it("isolates errors per endpoint — clients failure doesn't kill devices payload", async () => {
    const adapter: UnifiAdapter = {
      fetch: makeFetchStubByEndpoint({
        devices: { body: { data: [aDevice()] } },
        clients: { ok: false, status: 503, body: "service unavailable" },
      }),
    };
    const result = await collectUnifi([VALID_CONFIG_OBJ], adapter);
    // Devices flowed through.
    expect(result.items.map((i) => i.observedKey)).toEqual(["unifi:aa:bb:cc:dd:ee:ff"]);
    // Clients failure surfaced as a warning, prefixed with the
    // controller URL so operators with multiple connections can tell
    // which one is misbehaving.
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/^unifi\[https:\/\/192\.168\.1\.1\]:/);
    expect(result.warnings[0]).toMatch(/HTTP 503/);
  });

  it("isolates errors the other way — devices failure doesn't kill clients payload", async () => {
    const adapter: UnifiAdapter = {
      fetch: makeFetchStubByEndpoint({
        devices: { ok: false, status: 500, body: "down" },
        clients: { body: { data: [aWifiClient()] } },
      }),
    };
    const result = await collectUnifi([VALID_CONFIG_OBJ], adapter);
    expect(result.items.map((i) => i.observedKey)).toEqual(["unifi-client:fc:a1:83:11:22:33"]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/HTTP 500/);
  });
});

describe("collectUnifi — controller failures", () => {
  it("returns a warning (not throw) on network failure", async () => {
    const adapter: UnifiAdapter = {
      fetch: makeFetchStub(() => ({ throwErr: "ECONNREFUSED" })),
    };
    const result = await collectUnifi([VALID_CONFIG_OBJ], adapter);
    expect(result.items).toEqual([]);
    expect(result.warnings[0]).toMatch(/network error/);
  });

  it("returns a warning on non-2xx response", async () => {
    const adapter: UnifiAdapter = {
      fetch: makeFetchStub(() => ({ ok: false, status: 401, body: "unauthorized" })),
    };
    const result = await collectUnifi([VALID_CONFIG_OBJ], adapter);
    expect(result.items).toEqual([]);
    expect(result.warnings[0]).toMatch(/HTTP 401/);
  });

  it("returns a warning on missing data[] in response", async () => {
    const adapter: UnifiAdapter = {
      fetch: makeFetchStub(() => ({ body: { meta: {} } })),
    };
    const result = await collectUnifi([VALID_CONFIG_OBJ], adapter);
    expect(result.items).toEqual([]);
    expect(result.warnings[0]).toMatch(/data\[\]/);
  });
});

describe("collectUnifi — multiple adapters", () => {
  it("runs each adapter config independently and merges results", async () => {
    // Each adapter's fetch sees only its own URL via the stub.
    // We pass two configs (different sites) and assert the collector
    // visited both.
    const visited: string[] = [];
    const adapter: UnifiAdapter = {
      fetch: async (url) => {
        visited.push(url);
		if (url.includes("/proxy/network/integration/v1/")) {
		  return { ok: false, status: 404, json: async () => ({}), text: async () => "not supported" };
		}
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: [] }),
          text: async () => `{"data":[]}`,
        };
      },
    };
    await collectUnifi(
      [
        { ...VALID_CONFIG_OBJ, controllerUrl: "https://10.0.0.1", site: "default" },
        { ...VALID_CONFIG_OBJ, controllerUrl: "https://10.0.0.2", site: "branch" },
      ],
      adapter,
    );
    // Both controllers + both endpoints (/stat/device + /stat/sta) hit.
    expect(visited).toContain("https://10.0.0.1/proxy/network/api/s/default/stat/device");
    expect(visited).toContain("https://10.0.0.1/proxy/network/api/s/default/stat/sta");
    expect(visited).toContain("https://10.0.0.2/proxy/network/api/s/branch/stat/device");
    expect(visited).toContain("https://10.0.0.2/proxy/network/api/s/branch/stat/sta");
  });

  it("one adapter failing doesn't stop the others", async () => {
    const adapter: UnifiAdapter = {
      fetch: async (url) => {
		if (url.includes("/proxy/network/integration/v1/")) {
		  return { ok: false, status: 404, json: async () => ({}), text: async () => "not supported" };
		}
        if (url.startsWith("https://broken")) {
          throw new Error("ECONNREFUSED");
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: [aDevice()] }),
          text: async () => JSON.stringify({ data: [aDevice()] }),
        };
      },
    };
    const result = await collectUnifi(
      [
        { ...VALID_CONFIG_OBJ, controllerUrl: "https://broken.local" },
        { ...VALID_CONFIG_OBJ, controllerUrl: "https://good.local" },
      ],
      adapter,
    );
    // The good adapter produced its item.
    expect(result.items.length).toBeGreaterThan(0);
    // The broken one surfaced a warning prefixed with its URL.
    const brokenWarn = result.warnings.find((w) => w.includes("broken.local"));
    expect(brokenWarn).toBeDefined();
  });
});
