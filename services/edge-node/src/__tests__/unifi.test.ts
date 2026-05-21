import { describe, expect, it } from "vitest";
import { collectUnifi, type UnifiAdapter } from "../collectors/unifi";
import type { AdaptersConfigAdapter } from "../collectors/adapters-config";

const VALID_CONFIG = JSON.stringify({
  unifi: {
    controllerUrl: "https://192.168.1.1",
    apiKey: "test-key",
    site: "default",
  },
});

const NO_CONFIG_FILE_ENOENT = (p: string) => {
  throw new Error(`ENOENT: ${p}`);
};

function makeConfigAdapter(
  files: Record<string, { contents: string; mode: number }>,
): AdaptersConfigAdapter {
  return {
    env: {},
    readFile: (p) => {
      const f = files[p];
      if (!f) throw new Error(`ENOENT: ${p}`);
      return f.contents;
    },
    statMode: (p) => {
      const f = files[p];
      if (!f) throw new Error(`ENOENT: ${p}`);
      return f.mode;
    },
  };
}

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
 *
 * The legacy `makeFetchStub` (single responder, ignores URL) is
 * preserved as a thin wrapper for older tests that don't need
 * per-endpoint control.
 */
function makeFetchStubByEndpoint(
  responses: { devices?: StubResp; clients?: StubResp },
): UnifiAdapter["fetch"] {
  return async (url) => {
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

function makeFetchStub(
  responder: (url: string, init: { headers?: Record<string, string> }) => StubResp,
): UnifiAdapter["fetch"] {
  return async (url, init) => {
    // For backwards-compat: only respond to /stat/device URLs with
    // the user-supplied responder. /stat/sta defaults to an empty
    // success response so tests written before Slice B keep working
    // unchanged.
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

describe("collectUnifi — adapter not configured", () => {
  it("is a no-op when adapters.json is absent", async () => {
    const adapter: UnifiAdapter = {
      fetch: makeFetchStub(() => ({})),
      configAdapter: {
        env: {},
        readFile: NO_CONFIG_FILE_ENOENT,
        statMode: NO_CONFIG_FILE_ENOENT,
      },
    };
    const result = await collectUnifi(adapter);
    expect(result.items).toEqual([]);
    expect(result.relationships).toEqual([]);
    expect(result.warnings).toEqual([]);
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
      configAdapter: makeConfigAdapter({
        "/etc/dpf-edge/adapters.json": { contents: VALID_CONFIG, mode: 0o600 },
      }),
    };

    const result = await collectUnifi(adapter);

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
      configAdapter: makeConfigAdapter({
        "/etc/dpf-edge/adapters.json": { contents: VALID_CONFIG, mode: 0o600 },
      }),
    };
    const result = await collectUnifi(adapter);
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
      configAdapter: makeConfigAdapter({
        "/etc/dpf-edge/adapters.json": { contents: VALID_CONFIG, mode: 0o600 },
      }),
    };

    const result = await collectUnifi(adapter);
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
      configAdapter: makeConfigAdapter({
        "/etc/dpf-edge/adapters.json": { contents: VALID_CONFIG, mode: 0o600 },
      }),
    };
    const result = await collectUnifi(adapter);
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
      configAdapter: makeConfigAdapter({
        "/etc/dpf-edge/adapters.json": { contents: VALID_CONFIG, mode: 0o600 },
      }),
    };
    const result = await collectUnifi(adapter);
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
  it("maps a WiFi client to an arp:<ip> ObservationItem with vendor enrichment", async () => {
    const adapter: UnifiAdapter = {
      fetch: makeFetchStubByEndpoint({
        clients: { body: { data: [aWifiClient()] } },
      }),
      configAdapter: makeConfigAdapter({
        "/etc/dpf-edge/adapters.json": { contents: VALID_CONFIG, mode: 0o600 },
      }),
    };
    const result = await collectUnifi(adapter);
    expect(result.items).toHaveLength(1);
    const item = result.items[0]!;
    expect(item.observedKey).toBe("arp:192.168.0.49");
    expect(item.itemType).toBe("host");
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
      configAdapter: makeConfigAdapter({
        "/etc/dpf-edge/adapters.json": { contents: VALID_CONFIG, mode: 0o600 },
      }),
    };
    const result = await collectUnifi(adapter);
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
      configAdapter: makeConfigAdapter({
        "/etc/dpf-edge/adapters.json": { contents: VALID_CONFIG, mode: 0o600 },
      }),
    };
    const result = await collectUnifi(adapter);
    expect(result.items[0]?.name).toBe("LAN Host 192.168.0.77");
    expect(result.items[0]?.rawData.vendor).toBeUndefined();
  });

  it("emits a MEMBER_OF link from a WiFi client to its AP", async () => {
    const adapter: UnifiAdapter = {
      fetch: makeFetchStubByEndpoint({
        clients: { body: { data: [aWifiClient()] } },
      }),
      configAdapter: makeConfigAdapter({
        "/etc/dpf-edge/adapters.json": { contents: VALID_CONFIG, mode: 0o600 },
      }),
    };
    const result = await collectUnifi(adapter);
    const memberOf = result.relationships.filter((r) => r.relationshipType === "MEMBER_OF");
    expect(memberOf).toEqual([
      {
        fromObservedKey: "arp:192.168.0.49",
        toObservedKey: "unifi:aa:aa:aa:aa:aa:aa",
        relationshipType: "MEMBER_OF",
        rawData: {
          mechanism: "unifi_wifi_assoc",
          port: null,
          essid: "HomeNet",
        },
      },
    ]);
  });

  it("emits wired-specific MEMBER_OF link from a wired client to its switch+port", async () => {
    const adapter: UnifiAdapter = {
      fetch: makeFetchStubByEndpoint({
        clients: { body: { data: [aWiredClient()] } },
      }),
      configAdapter: makeConfigAdapter({
        "/etc/dpf-edge/adapters.json": { contents: VALID_CONFIG, mode: 0o600 },
      }),
    };
    const result = await collectUnifi(adapter);
    const memberOf = result.relationships.filter((r) => r.relationshipType === "MEMBER_OF");
    expect(memberOf).toEqual([
      {
        fromObservedKey: "arp:192.168.0.99",
        toObservedKey: "unifi:bb:bb:bb:bb:bb:bb",
        relationshipType: "MEMBER_OF",
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

  it("skips MEMBER_OF when ap_mac (wifi) or sw_mac (wired) is missing", async () => {
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
      configAdapter: makeConfigAdapter({
        "/etc/dpf-edge/adapters.json": { contents: VALID_CONFIG, mode: 0o600 },
      }),
    };
    const result = await collectUnifi(adapter);
    expect(result.items).toHaveLength(2);
    expect(result.relationships.filter((r) => r.relationshipType === "MEMBER_OF")).toEqual([]);
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
      configAdapter: makeConfigAdapter({
        "/etc/dpf-edge/adapters.json": { contents: VALID_CONFIG, mode: 0o600 },
      }),
    };
    const result = await collectUnifi(adapter);
    expect(result.items.map((i) => i.observedKey)).toEqual(["arp:10.0.0.42"]);
  });

  it("merges devices + clients into one envelope", async () => {
    const adapter: UnifiAdapter = {
      fetch: makeFetchStubByEndpoint({
        devices: { body: { data: [aDevice()] } },
        clients: { body: { data: [aWifiClient()] } },
      }),
      configAdapter: makeConfigAdapter({
        "/etc/dpf-edge/adapters.json": { contents: VALID_CONFIG, mode: 0o600 },
      }),
    };
    const result = await collectUnifi(adapter);
    const keys = result.items.map((i) => i.observedKey).sort();
    expect(keys).toEqual([
      "arp:192.168.0.49",         // the WiFi client
      "unifi:aa:bb:cc:dd:ee:ff",  // the AP device
    ]);
    // Relationships from BOTH endpoints present.
    const types = result.relationships.map((r) => r.relationshipType).sort();
    expect(types).toEqual(["MEMBER_OF", "SAME_AS"]);
  });

  it("isolates errors per endpoint — clients failure doesn't kill devices payload", async () => {
    const adapter: UnifiAdapter = {
      fetch: makeFetchStubByEndpoint({
        devices: { body: { data: [aDevice()] } },
        clients: { ok: false, status: 503, body: "service unavailable" },
      }),
      configAdapter: makeConfigAdapter({
        "/etc/dpf-edge/adapters.json": { contents: VALID_CONFIG, mode: 0o600 },
      }),
    };
    const result = await collectUnifi(adapter);
    // Devices flowed through.
    expect(result.items.map((i) => i.observedKey)).toEqual(["unifi:aa:bb:cc:dd:ee:ff"]);
    // Clients failure surfaced as a warning.
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/HTTP 503/);
  });

  it("isolates errors the other way — devices failure doesn't kill clients payload", async () => {
    const adapter: UnifiAdapter = {
      fetch: makeFetchStubByEndpoint({
        devices: { ok: false, status: 500, body: "down" },
        clients: { body: { data: [aWifiClient()] } },
      }),
      configAdapter: makeConfigAdapter({
        "/etc/dpf-edge/adapters.json": { contents: VALID_CONFIG, mode: 0o600 },
      }),
    };
    const result = await collectUnifi(adapter);
    expect(result.items.map((i) => i.observedKey)).toEqual(["arp:192.168.0.49"]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/HTTP 500/);
  });
});

describe("collectUnifi — controller failures", () => {
  it("returns a warning (not throw) on network failure", async () => {
    const adapter: UnifiAdapter = {
      fetch: makeFetchStub(() => ({ throwErr: "ECONNREFUSED" })),
      configAdapter: makeConfigAdapter({
        "/etc/dpf-edge/adapters.json": { contents: VALID_CONFIG, mode: 0o600 },
      }),
    };
    const result = await collectUnifi(adapter);
    expect(result.items).toEqual([]);
    expect(result.warnings[0]).toMatch(/unifi: network error/);
  });

  it("returns a warning on non-2xx response", async () => {
    const adapter: UnifiAdapter = {
      fetch: makeFetchStub(() => ({ ok: false, status: 401, body: "unauthorized" })),
      configAdapter: makeConfigAdapter({
        "/etc/dpf-edge/adapters.json": { contents: VALID_CONFIG, mode: 0o600 },
      }),
    };
    const result = await collectUnifi(adapter);
    expect(result.items).toEqual([]);
    expect(result.warnings[0]).toMatch(/HTTP 401/);
  });

  it("returns a warning on missing data[] in response", async () => {
    const adapter: UnifiAdapter = {
      fetch: makeFetchStub(() => ({ body: { meta: {} } })),
      configAdapter: makeConfigAdapter({
        "/etc/dpf-edge/adapters.json": { contents: VALID_CONFIG, mode: 0o600 },
      }),
    };
    const result = await collectUnifi(adapter);
    expect(result.items).toEqual([]);
    expect(result.warnings[0]).toMatch(/data\[\]/);
  });
});
