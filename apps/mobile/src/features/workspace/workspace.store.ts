import { create } from "zustand";
import type {
  DashboardTile,
  CalendarItem,
  ActivityItem,
} from "@dpf/types";
import { api } from "@/src/lib/apiClient";
import { CacheRepository } from "@/src/repositories/CacheRepository";

const CACHE_KEY_DASHBOARD = "workspace:dashboard";
const CACHE_KEY_ACTIVITY = "workspace:activity";
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export interface WorkspaceState {
  tiles: DashboardTile[];
  calendarItems: CalendarItem[];
  activityFeed: ActivityItem[];
  isLoading: boolean;
  error: string | null;
  lastSynced: number | null;
  fetchDashboard: () => Promise<void>;
  fetchActivity: () => Promise<void>;
}

let cache: CacheRepository | null = null;

function getCache(): CacheRepository {
  if (!cache) cache = new CacheRepository();
  return cache;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  tiles: [],
  calendarItems: [],
  activityFeed: [],
  isLoading: false,
  error: null,
  lastSynced: null,

  fetchDashboard: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.workspace.dashboard();
      set({
        tiles: res.tiles,
        calendarItems: res.calendarItems,
        isLoading: false,
        lastSynced: Date.now(),
      });
      getCache().set(CACHE_KEY_DASHBOARD, res, CACHE_TTL);
    } catch (err) {
      // Attempt to load from cache on failure
      const cached = getCache().get<{
        tiles: DashboardTile[];
        calendarItems: CalendarItem[];
      }>(CACHE_KEY_DASHBOARD);
      if (cached) {
        set({
          tiles: cached.tiles,
          calendarItems: cached.calendarItems,
          isLoading: false,
          error: "Using cached data — last fetch failed.",
        });
      } else {
        set({
          isLoading: false,
          error:
            err instanceof Error ? err.message : "Failed to load dashboard",
        });
      }
    }
  },

  fetchActivity: async () => {
    try {
      const res = await api.workspace.activity({ limit: 20 });
      set({ activityFeed: res.data });
      getCache().set(CACHE_KEY_ACTIVITY, res.data, CACHE_TTL);
    } catch {
      const cached = getCache().get<ActivityItem[]>(CACHE_KEY_ACTIVITY);
      if (cached) {
        set({ activityFeed: cached });
      }
    }
  },
}));
