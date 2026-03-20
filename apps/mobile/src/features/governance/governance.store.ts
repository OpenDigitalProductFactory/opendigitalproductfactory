import { create } from "zustand";
import type { AgentActionProposal } from "@dpf/types";
import { api } from "@/src/lib/apiClient";

export interface GovernanceState {
  approvals: AgentActionProposal[];
  isLoading: boolean;
  error: string | null;
  fetchApprovals: () => Promise<void>;
  decide: (
    id: string,
    decision: "approve" | "reject",
    rationale?: string,
  ) => Promise<void>;
}

export const useGovernanceStore = create<GovernanceState>((set) => ({
  approvals: [],
  isLoading: false,
  error: null,

  fetchApprovals: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.governance.listApprovals({ limit: 100 });
      set({ approvals: res.data, isLoading: false });
    } catch (err) {
      set({
        isLoading: false,
        error:
          err instanceof Error ? err.message : "Failed to load approvals",
      });
    }
  },

  decide: async (
    id: string,
    decision: "approve" | "reject",
    rationale?: string,
  ) => {
    // Optimistically remove from list
    set((state) => ({
      approvals: state.approvals.filter((a) => a.id !== id),
    }));

    try {
      await api.governance.decide(id, { decision, rationale });
    } catch (err) {
      // Re-fetch on failure to restore accurate state
      set({
        error:
          err instanceof Error
            ? err.message
            : "Failed to submit decision",
      });
      // Attempt to re-fetch the list
      try {
        const res = await api.governance.listApprovals({ limit: 100 });
        set({ approvals: res.data });
      } catch {
        // If re-fetch also fails, the error is already set
      }
    }
  },
}));
