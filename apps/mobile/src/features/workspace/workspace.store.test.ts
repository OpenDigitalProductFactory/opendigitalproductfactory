import { useWorkspaceStore } from "./workspace.store";

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

const mockDashboard = jest.fn();
const mockActivity = jest.fn();

jest.mock("@/src/lib/apiClient", () => ({
  api: {
    workspace: {
      dashboard: (...args: unknown[]) => mockDashboard(...args),
      activity: (...args: unknown[]) => mockActivity(...args),
    },
  },
}));

const mockCacheGet = jest.fn();
const mockCacheSet = jest.fn();

jest.mock("@/src/repositories/CacheRepository", () => ({
  CacheRepository: jest.fn().mockImplementation(() => ({
    get: (...args: unknown[]) => mockCacheGet(...args),
    set: (...args: unknown[]) => mockCacheSet(...args),
  })),
}));

/* ------------------------------------------------------------------ */
/*  Test data                                                          */
/* ------------------------------------------------------------------ */

const fakeTiles = [
  { area: "Ops", label: "Open Items", value: 12, trend: "up" as const },
  { area: "Portfolio", label: "Products", value: 5, trend: "stable" as const },
];

const fakeCalendar = [
  { id: "c1", title: "Review", date: "2026-03-20", type: "meeting" },
];

const fakeActivity = [
  {
    id: "a1",
    action: "created",
    target: "Epic: Onboarding",
    actor: "Alice",
    timestamp: "2026-03-19T10:00:00Z",
  },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function resetStore() {
  useWorkspaceStore.setState({
    tiles: [],
    calendarItems: [],
    activityFeed: [],
    isLoading: false,
    error: null,
    lastSynced: null,
  });
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

beforeEach(() => {
  jest.clearAllMocks();
  resetStore();
});

describe("workspace.store", () => {
  describe("fetchDashboard", () => {
    it("fetches tiles and calendar items from API", async () => {
      mockDashboard.mockResolvedValue({
        tiles: fakeTiles,
        calendarItems: fakeCalendar,
      });

      await useWorkspaceStore.getState().fetchDashboard();

      const state = useWorkspaceStore.getState();
      expect(state.tiles).toEqual(fakeTiles);
      expect(state.calendarItems).toEqual(fakeCalendar);
      expect(state.isLoading).toBe(false);
      expect(state.lastSynced).toBeTruthy();
      expect(state.error).toBeNull();
      expect(mockCacheSet).toHaveBeenCalled();
    });

    it("falls back to cache on API failure", async () => {
      mockDashboard.mockRejectedValue(new Error("Network error"));
      mockCacheGet.mockReturnValue({
        tiles: fakeTiles,
        calendarItems: fakeCalendar,
      });

      await useWorkspaceStore.getState().fetchDashboard();

      const state = useWorkspaceStore.getState();
      expect(state.tiles).toEqual(fakeTiles);
      expect(state.error).toContain("cached");
      expect(state.isLoading).toBe(false);
    });

    it("sets error when API fails and no cache available", async () => {
      mockDashboard.mockRejectedValue(new Error("Network error"));
      mockCacheGet.mockReturnValue(null);

      await useWorkspaceStore.getState().fetchDashboard();

      const state = useWorkspaceStore.getState();
      expect(state.tiles).toEqual([]);
      expect(state.error).toBe("Network error");
      expect(state.isLoading).toBe(false);
    });
  });

  describe("fetchActivity", () => {
    it("fetches activity feed from API", async () => {
      mockActivity.mockResolvedValue({ data: fakeActivity });

      await useWorkspaceStore.getState().fetchActivity();

      const state = useWorkspaceStore.getState();
      expect(state.activityFeed).toEqual(fakeActivity);
      expect(mockCacheSet).toHaveBeenCalled();
    });

    it("falls back to cache on API failure", async () => {
      mockActivity.mockRejectedValue(new Error("Network error"));
      mockCacheGet.mockReturnValue(fakeActivity);

      await useWorkspaceStore.getState().fetchActivity();

      const state = useWorkspaceStore.getState();
      expect(state.activityFeed).toEqual(fakeActivity);
    });
  });
});
