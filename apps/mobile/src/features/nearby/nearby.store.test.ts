import { useNearbyStore } from "./nearby.store";
import type { NearbyInstance } from "@dpf/types";

const mockNearby = jest.fn();
jest.mock("@/src/lib/apiClient", () => ({
  api: { directory: { nearby: (...a: unknown[]) => mockNearby(...a) } },
}));

const ROW: NearbyInstance = {
  instanceId: "ORG-ACME",
  orgName: "Acme HVAC",
  url: "https://acme.example",
  distanceKm: 1.2,
  archetype: "trades-maintenance/hvac-contractor",
  locality: "London, UK",
};

function resetStore() {
  useNearbyStore.getState().reset();
  mockNearby.mockReset();
}

beforeEach(resetStore);

describe("useNearbyStore.fetch", () => {
  it("populates results on success and clears prior error", async () => {
    useNearbyStore.setState({ error: "stale error" });
    mockNearby.mockResolvedValueOnce({ results: [ROW] });

    await useNearbyStore.getState().fetch({ latitude: 51.5, longitude: -0.1 });
    expect(useNearbyStore.getState().results).toEqual([ROW]);
    expect(useNearbyStore.getState().isLoading).toBe(false);
    expect(useNearbyStore.getState().error).toBeNull();
  });

  it("forwards optional radiusKm", async () => {
    mockNearby.mockResolvedValueOnce({ results: [] });
    await useNearbyStore.getState().fetch({
      latitude: 51.5,
      longitude: -0.1,
      radiusKm: 10,
    });
    expect(mockNearby.mock.calls[0][0]).toEqual({
      latitude: 51.5,
      longitude: -0.1,
      radiusKm: 10,
    });
  });

  it("surfaces server errors without dropping prior results", async () => {
    useNearbyStore.setState({ results: [ROW] });
    mockNearby.mockRejectedValueOnce(new Error("HTTP 503 service unavailable"));

    await useNearbyStore.getState().fetch({ latitude: 51.5, longitude: -0.1 });
    expect(useNearbyStore.getState().error).toContain("503");
    expect(useNearbyStore.getState().results).toEqual([ROW]);
    expect(useNearbyStore.getState().isLoading).toBe(false);
  });
});
