import {
  fetchAppConfig,
  applyAppConfig,
  loadAndApplyAppConfig,
  useAppConfigStore,
} from "./appConfig";
import { useThemeStore, defaultColors } from "./theme";
import type { AppConfigManifest } from "@dpf/types";

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

const mockGetAccessToken = jest.fn();
jest.mock("@/src/repositories/SecureStorage", () => ({
  SecureStorage: { getAccessToken: () => mockGetAccessToken() },
}));
jest.mock("@/src/lib/serverConfig", () => ({
  getServerUrl: () => "https://acme.test",
}));

const validManifest: AppConfigManifest = {
  schemaVersion: "1",
  org: { name: "Acme HVAC", archetype: "trades-maintenance/hvac-contractor" },
  persona: { kind: "employee", mode: "field" },
  designTokens: { palette: { accent: "#1e6f50" } },
  capabilities: ["work-items", "scheduling"],
  vocabulary: { customer: "homeowner" },
  navigation: { tabs: ["jobs", "more"], defaultTab: "jobs" },
};

beforeEach(() => {
  jest.clearAllMocks();
  useAppConfigStore.getState().reset();
  useThemeStore.getState().reset();
  mockGetAccessToken.mockResolvedValue("at-token");
});

afterEach(() => {
  // @ts-expect-error - clear injected fetch mock
  delete global.fetch;
});

/* ------------------------------------------------------------------ */
/*  fetchAppConfig                                                     */
/* ------------------------------------------------------------------ */

describe("fetchAppConfig", () => {
  it("GETs the manifest with a bearer token and returns it", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(validManifest),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await fetchAppConfig();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://acme.test/api/v1/app/config",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Authorization: "Bearer at-token" }),
      }),
    );
    expect(result?.org.name).toBe("Acme HVAC");
    expect(result?.capabilities).toEqual(["work-items", "scheduling"]);
  });

  it("returns null on a non-ok response", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 404 }) as unknown as typeof fetch;
    expect(await fetchAppConfig()).toBeNull();
  });

  it("returns null on a malformed manifest", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ org: { name: "x" } }),
    }) as unknown as typeof fetch;
    expect(await fetchAppConfig()).toBeNull();
  });

  it("returns null on a network error", async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error("offline")) as unknown as typeof fetch;
    expect(await fetchAppConfig()).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  applyAppConfig                                                     */
/* ------------------------------------------------------------------ */

describe("applyAppConfig", () => {
  it("stores capabilities/persona/vocabulary/navigation", () => {
    applyAppConfig(validManifest);
    const s = useAppConfigStore.getState();
    expect(s.capabilities).toEqual(["work-items", "scheduling"]);
    expect(s.persona).toEqual({ kind: "employee", mode: "field" });
    expect(s.hasCapability("scheduling")).toBe(true);
    expect(s.hasCapability("billing")).toBe(false);
    expect(s.term("customer")).toBe("homeowner");
    expect(s.navigation?.defaultTab).toBe("jobs");
  });

  it("re-themes the app from the manifest design tokens", () => {
    expect(useThemeStore.getState().colors.primary).toBe(defaultColors.primary);
    applyAppConfig(validManifest);
    expect(useThemeStore.getState().colors.primary).toBe("#1e6f50");
  });
});

/* ------------------------------------------------------------------ */
/*  loadAndApplyAppConfig                                              */
/* ------------------------------------------------------------------ */

describe("loadAndApplyAppConfig", () => {
  it("fetches then applies when the install responds", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(validManifest),
    }) as unknown as typeof fetch;

    await loadAndApplyAppConfig();

    expect(useAppConfigStore.getState().capabilities).toEqual([
      "work-items",
      "scheduling",
    ]);
    expect(useThemeStore.getState().colors.primary).toBe("#1e6f50");
  });

  it("is a no-op when the install has no manifest endpoint", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 404 }) as unknown as typeof fetch;

    await loadAndApplyAppConfig();

    expect(useAppConfigStore.getState().manifest).toBeNull();
    expect(useThemeStore.getState().colors).toEqual(defaultColors);
  });
});
