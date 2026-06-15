import {
  normalizeServerUrl,
  getServerUrl,
  isServerConfigured,
  loadServerUrl,
  setServerUrl,
  clearServerUrl,
  fetchInstanceDescriptor,
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
