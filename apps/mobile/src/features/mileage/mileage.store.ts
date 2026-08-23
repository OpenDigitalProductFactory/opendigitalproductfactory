import { create } from "zustand";
import type {
  MileageClassification,
  MileageConsentState,
  MileageTripSummary,
} from "@dpf/types";
import { api } from "@/src/lib/apiClient";

/** The disclosure version this build of the app shows the driver. */
export const MILEAGE_POLICY_VERSION = "2026-08-01";

export interface MileageState {
  trips: MileageTripSummary[];
  consent: MileageConsentState | null;
  isLoading: boolean;
  isClassifying: string | null;
  error: string | null;
  fetchTrips: () => Promise<void>;
  fetchConsent: () => Promise<void>;
  grantConsent: () => Promise<void>;
  classify: (tripId: string, classification: Exclude<MileageClassification, "unclassified">) => Promise<void>;
}

function message(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export const useMileageStore = create<MileageState>((set, get) => ({
  trips: [],
  consent: null,
  isLoading: false,
  isClassifying: null,
  error: null,

  fetchTrips: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.mileage.list({ limit: 100 });
      set({ trips: res.data, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: message(err, "Could not load your drives") });
    }
  },

  fetchConsent: async () => {
    try {
      set({ consent: await api.mileage.consent(), error: null });
    } catch (err) {
      set({ error: message(err, "Could not read your capture setting") });
    }
  },

  grantConsent: async () => {
    set({ error: null });
    try {
      const consent = await api.mileage.grantConsent({
        policyVersion: MILEAGE_POLICY_VERSION,
      });
      set({ consent });
    } catch (err) {
      set({ error: message(err, "Could not turn on capture") });
    }
  },

  classify: async (tripId, classification) => {
    set({ isClassifying: tripId, error: null });
    try {
      const updated = await api.mileage.classify(tripId, { classification });
      // Replace in place so the list does not jump under the driver's thumb
      // mid-pass. Losing your position after every tap makes a long list
      // genuinely hard to work through.
      set({
        trips: get().trips.map((t) => (t.tripId === tripId ? updated : t)),
        isClassifying: null,
      });
    } catch (err) {
      set({ isClassifying: null, error: message(err, "Could not save that") });
    }
  },
}));
