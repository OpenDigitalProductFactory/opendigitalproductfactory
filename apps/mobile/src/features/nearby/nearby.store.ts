import { create } from "zustand";
import type { NearbyInstance } from "@dpf/types";
import { api } from "@/src/lib/apiClient";

/**
 * Customer-side "Nearby businesses" store. Calls the public directory
 * endpoint on demand with a (lat, lng) pair; the install + the future
 * federation directory both return rows in the same shape. The store
 * keeps the last fetched list so the panel renders instantly on
 * re-entry while a background refresh runs.
 */
interface NearbyState {
  results: NearbyInstance[];
  isLoading: boolean;
  error: string | null;
  fetch: (input: {
    latitude: number;
    longitude: number;
    radiusKm?: number;
  }) => Promise<void>;
  reset: () => void;
}

export const useNearbyStore = create<NearbyState>((set) => ({
  results: [],
  isLoading: false,
  error: null,

  fetch: async ({ latitude, longitude, radiusKm }) => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.directory.nearby({ latitude, longitude, radiusKm });
      set({ results: res.results, isLoading: false });
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : "Nearby lookup failed",
      });
    }
  },

  reset: () => set({ results: [], isLoading: false, error: null }),
}));
