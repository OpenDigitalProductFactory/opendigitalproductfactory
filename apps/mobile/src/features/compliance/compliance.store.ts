import { create } from "zustand";
import { api } from "@/src/lib/apiClient";

export interface ComplianceState {
  alerts: Record<string, unknown>[];
  incidents: Record<string, unknown>[];
  isLoading: boolean;
  error: string | null;
  fetchAlerts: () => Promise<void>;
  fetchIncidents: () => Promise<void>;
}

export const useComplianceStore = create<ComplianceState>((set) => ({
  alerts: [],
  incidents: [],
  isLoading: false,
  error: null,

  fetchAlerts: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.compliance.listAlerts({ limit: 100 });
      set({ alerts: res.data, isLoading: false });
    } catch (err) {
      set({
        isLoading: false,
        error:
          err instanceof Error ? err.message : "Failed to load alerts",
      });
    }
  },

  fetchIncidents: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.compliance.listIncidents({ limit: 100 });
      set({ incidents: res.data, isLoading: false });
    } catch (err) {
      set({
        isLoading: false,
        error:
          err instanceof Error ? err.message : "Failed to load incidents",
      });
    }
  },
}));
