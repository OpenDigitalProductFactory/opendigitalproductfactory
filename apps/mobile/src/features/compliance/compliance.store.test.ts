import { useComplianceStore } from "./compliance.store";

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

const mockListAlerts = jest.fn();
const mockListIncidents = jest.fn();

jest.mock("@/src/lib/apiClient", () => ({
  api: {
    compliance: {
      listAlerts: (...args: unknown[]) => mockListAlerts(...args),
      listIncidents: (...args: unknown[]) => mockListIncidents(...args),
    },
  },
}));

/* ------------------------------------------------------------------ */
/*  Test data                                                          */
/* ------------------------------------------------------------------ */

const fakeAlert = {
  id: "alert-1",
  title: "Policy violation detected",
  severity: "high",
  status: "open",
  createdAt: "2026-03-19T00:00:00Z",
};

const fakeAlert2 = {
  id: "alert-2",
  title: "Access anomaly",
  severity: "medium",
  status: "open",
  createdAt: "2026-03-19T01:00:00Z",
};

const fakeIncident = {
  id: "inc-1",
  title: "Data breach attempt",
  severity: "critical",
  status: "investigating",
  createdAt: "2026-03-18T00:00:00Z",
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function resetStore() {
  useComplianceStore.setState({
    alerts: [],
    incidents: [],
    isLoading: false,
    error: null,
  });
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

beforeEach(() => {
  jest.clearAllMocks();
  resetStore();
});

describe("compliance.store", () => {
  describe("fetchAlerts", () => {
    it("loads alerts from API", async () => {
      mockListAlerts.mockResolvedValue({
        data: [fakeAlert, fakeAlert2],
        nextCursor: null,
      });

      await useComplianceStore.getState().fetchAlerts();

      const state = useComplianceStore.getState();
      expect(state.alerts).toHaveLength(2);
      expect(state.alerts[0]).toEqual(fakeAlert);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });

    it("sets error on API failure", async () => {
      mockListAlerts.mockRejectedValue(new Error("Server error"));

      await useComplianceStore.getState().fetchAlerts();

      const state = useComplianceStore.getState();
      expect(state.alerts).toEqual([]);
      expect(state.error).toBe("Server error");
      expect(state.isLoading).toBe(false);
    });
  });

  describe("fetchIncidents", () => {
    it("loads incidents from API", async () => {
      mockListIncidents.mockResolvedValue({
        data: [fakeIncident],
        nextCursor: null,
      });

      await useComplianceStore.getState().fetchIncidents();

      const state = useComplianceStore.getState();
      expect(state.incidents).toHaveLength(1);
      expect(state.incidents[0]).toEqual(fakeIncident);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });

    it("sets error on API failure", async () => {
      mockListIncidents.mockRejectedValue(new Error("Connection lost"));

      await useComplianceStore.getState().fetchIncidents();

      const state = useComplianceStore.getState();
      expect(state.incidents).toEqual([]);
      expect(state.error).toBe("Connection lost");
      expect(state.isLoading).toBe(false);
    });
  });
});
