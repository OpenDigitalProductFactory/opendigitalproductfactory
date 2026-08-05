import {
  normalizeServerUrl,
  getServerUrl,
  isServerConfigured,
  loadServerUrl,
  setServerUrl,
  clearServerUrl,
  fetchInstanceDescriptor,
  resolveInstall,
} from "./serverConfig";

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

const mockStore = new Map<string, string>();

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn((key: string) =>
    Promise.resolve(mockStore.get(key) ?? null),
  ),
  setItemAsync: jest.fn((key: string, value: string) => {
    mockStore.set(key, value);
    return Promise.resolve();
  }),
  deleteItemAsync: jest.fn((key: string) => {
    mockStore.delete(key);
    return Promise.resolve();
  }),
}));

const DEFAULT_URL = "http://localhost:3000";

beforeEach(async () => {
  jest.clearAllMocks();
  mockStore.clear();
  await clearServerUrl();
});

/* ------------------------------------------------------------------ */
/*  normalizeServerUrl                                                 */
/* ------------------------------------------------------------------ */

describe("normalizeServerUrl", () => {
  it("defaults a bare host to https", () => {
    expect(normalizeServerUrl("acme.dpf.example")).toBe(
      "https://acme.dpf.example",
    );
  });

  it("strips a trailing slash", () => {
    expect(normalizeServerUrl("https://acme.dpf.example/")).toBe(
      "https://acme.dpf.example",
    );
  });

  it("preserves an explicit http scheme (LAN / localhost)", () => {
    expect(normalizeServerUrl("http://localhost:3000")).toBe(
      "http://localhost:3000",
    );
  });

  it("trims whitespace and keeps a path", () => {
    expect(normalizeServerUrl("  https://x.io/dpf/  ")).toBe(
      "https://x.io/dpf",
    );
  });

  it("throws on empty input", () => {
    expect(() => normalizeServerUrl("   ")).toThrow(/required/i);
  });

  it("throws on an unsupported scheme", () => {
    expect(() => normalizeServerUrl("ftp://x.io")).toThrow(/scheme/i);
  });
});

/* ------------------------------------------------------------------ */
/*  get / set / clear / load                                          */
/* ------------------------------------------------------------------ */

describe("server URL persistence", () => {
  it("starts at the default and unconfigured", () => {
    expect(getServerUrl()).toBe(DEFAULT_URL);
    expect(isServerConfigured()).toBe(false);
  });

  it("setServerUrl normalizes, switches, persists, and marks configured", async () => {
    const result = await setServerUrl("acme.io");
    expect(result).toBe("https://acme.io");
    expect(getServerUrl()).toBe("https://acme.io");
    expect(isServerConfigured()).toBe(true);
    expect(mockStore.get("dpf_server_url")).toBe("https://acme.io");
  });

  it("loadServerUrl hydrates a previously persisted install", async () => {
    mockStore.set("dpf_server_url", "https://saved.example");
    const loaded = await loadServerUrl();
    expect(loaded).toBe("https://saved.example");
    expect(getServerUrl()).toBe("https://saved.example");
    expect(isServerConfigured()).toBe(true);
  });

  it("loadServerUrl falls back to the default when nothing is stored", async () => {
    const loaded = await loadServerUrl();
    expect(loaded).toBe(DEFAULT_URL);
    expect(isServerConfigured()).toBe(false);
  });

  it("clearServerUrl resets to the default and forgets persistence", async () => {
    await setServerUrl("acme.io");
    await clearServerUrl();
    expect(getServerUrl()).toBe(DEFAULT_URL);
    expect(isServerConfigured()).toBe(false);
    expect(mockStore.has("dpf_server_url")).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  fetchInstanceDescriptor                                           */
/* ------------------------------------------------------------------ */

describe("fetchInstanceDescriptor", () => {
  const validDescriptor = {
    instanceId: "inst_123",
    orgName: "Acme HVAC",
    archetype: "trades-maintenance/hvac-contractor",
    apiVersion: "v1",
    authModes: ["password"],
  };

  afterEach(() => {
    // @ts-expect-error - reset injected fetch mock
    delete global.fetch;
  });

  it("validates the URL and queries the well-known descriptor", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(validDescriptor),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await fetchInstanceDescriptor("acme.io");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://acme.io/.well-known/dpf-instance.json",
      expect.objectContaining({ method: "GET" }),
    );
    expect(result.instanceId).toBe("inst_123");
    expect(result.orgName).toBe("Acme HVAC");
    expect(result.authModes).toEqual(["password"]);
  });

  it("throws when the install is unreachable", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
    }) as unknown as typeof fetch;

    await expect(fetchInstanceDescriptor("acme.io")).rejects.toThrow(
      /not a reachable dpf install/i,
    );
  });

  it("throws when the descriptor is malformed", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ orgName: "No id here" }),
    }) as unknown as typeof fetch;

    await expect(fetchInstanceDescriptor("acme.io")).rejects.toThrow(
      /not a valid dpf instance descriptor/i,
    );
  });

  it("defaults authModes and orgName when absent", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ instanceId: "i", apiVersion: "v1" }),
    }) as unknown as typeof fetch;

    const result = await fetchInstanceDescriptor("acme.io");
    expect(result.orgName).toBe("DPF");
    expect(result.authModes).toEqual(["password"]);
  });
});

/* ------------------------------------------------------------------ */
/*  resolveInstall — resilient connect probe (BI graceful-degrade)     */
/* ------------------------------------------------------------------ */

describe("resolveInstall", () => {
  afterEach(() => {
    // @ts-expect-error test cleanup
    delete global.fetch;
  });

  it("uses a valid descriptor (degraded=false)", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            instanceId: "inst_1",
            orgName: "Acme HVAC",
            archetype: "trades-maintenance/hvac-contractor",
            apiVersion: "v1",
          }),
        ),
    }) as unknown as typeof fetch;

    const { descriptor, degraded } = await resolveInstall("acme.io");
    expect(degraded).toBe(false);
    expect(descriptor.orgName).toBe("Acme HVAC");
    expect(descriptor.archetype).toBe("trades-maintenance/hvac-contractor");
  });

  it("degrades when the descriptor endpoint returns HTML (login redirect landed on /welcome)", async () => {
    // 1st call: descriptor → 200 with HTML body (auth redirect). 2nd call:
    // origin probe → reachable. Must NOT throw a JSON parse error.
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve("<!DOCTYPE html><html>welcome</html>"),
      })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { descriptor, degraded } = await resolveInstall("192.168.0.200:3000");
    expect(degraded).toBe(true);
    expect(descriptor.instanceId).toBe("192.168.0.200:3000");
    expect(descriptor.orgName).toBe("192.168.0.200:3000");
    expect(descriptor.apiVersion).toBe("v1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("degrades when the descriptor endpoint 404s but the origin is reachable", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 404, text: () => Promise.resolve("") })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { degraded } = await resolveInstall("https://acme.io");
    expect(degraded).toBe(true);
  });

  it("throws only when the origin itself is unreachable (network error)", async () => {
    // descriptor fetch throws AND origin probe throws → fatal.
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error("Network request failed")) as unknown as typeof fetch;

    await expect(resolveInstall("http://192.168.0.99:3000")).rejects.toThrow(
      /could not reach/i,
    );
  });
});
