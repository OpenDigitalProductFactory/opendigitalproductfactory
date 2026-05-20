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

function makeFetchStub(
  responder: (url: string, init: { headers?: Record<string, string> }) => {
    ok?: boolean;
    status?: number;
    body?: unknown;
    throwErr?: string;
  },
): UnifiAdapter["fetch"] {
  return async (url, init) => {
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
