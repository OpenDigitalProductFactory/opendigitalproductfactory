import { create } from "zustand";
import type {
  WorkItemSummary,
  WorkItemDetail,
  WorkItemStatus,
} from "@dpf/types";
import { api } from "@/src/lib/apiClient";

export interface JobsState {
  jobs: WorkItemSummary[];
  detail: WorkItemDetail | null;
  isLoading: boolean;
  isUpdating: boolean;
  error: string | null;
  fetchJobs: (status?: WorkItemStatus) => Promise<void>;
  fetchDetail: (itemId: string) => Promise<void>;
  updateStatus: (itemId: string, status: WorkItemStatus) => Promise<void>;
}

export const useJobsStore = create<JobsState>((set) => ({
  jobs: [],
  detail: null,
  isLoading: false,
  isUpdating: false,
  error: null,

  fetchJobs: async (status) => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.workItems.list({ status, limit: 100 });
      set({ jobs: res.data, isLoading: false });
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : "Failed to load jobs",
      });
    }
  },

  fetchDetail: async (itemId) => {
    set({ isLoading: true, error: null, detail: null });
    try {
      const detail = await api.workItems.get(itemId);
      set({ detail, isLoading: false });
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : "Failed to load job",
      });
    }
  },

  updateStatus: async (itemId, status) => {
    set({ isUpdating: true, error: null });
    try {
      const detail = await api.workItems.updateStatus(itemId, { status });
      set((state) => ({
        detail,
        isUpdating: false,
        jobs: state.jobs.map((j) =>
          j.itemId === itemId ? { ...j, status: detail.status } : j,
        ),
      }));
    } catch (err) {
      set({
        isUpdating: false,
        error: err instanceof Error ? err.message : "Failed to update job",
      });
    }
  },
}));
