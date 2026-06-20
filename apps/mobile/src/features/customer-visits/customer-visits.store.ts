import { create } from "zustand";
import type { CustomerVisit } from "@dpf/types";
import { api } from "@/src/lib/apiClient";

/**
 * Customer-side "My visits" store — backs the customer-mode home panel
 * with the signed-in customer's appointments / visits (scoped server-side
 * via /api/v1/customer/visits + requireCustomerAuth). Same pattern as
 * customer-invoices: keep the binary generic; the install + persona decide
 * whether this panel renders.
 */
interface CustomerVisitsState {
  visits: CustomerVisit[];
  isLoading: boolean;
  error: string | null;
  fetch: (opts?: { upcoming?: boolean; status?: string }) => Promise<void>;
  reset: () => void;
}

export const useCustomerVisitsStore = create<CustomerVisitsState>((set) => ({
  visits: [],
  isLoading: false,
  error: null,

  fetch: async (opts) => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.customer.myVisits({ limit: 25, ...opts });
      set({ visits: res.data, isLoading: false });
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : "Failed to load visits",
      });
    }
  },

  reset: () => set({ visits: [], isLoading: false, error: null }),
}));

/**
 * Split the list into upcoming + recent — the home panel renders both with
 * separate headers. "Now" is injected so the projection stays pure and the
 * test doesn't have to mock Date.
 */
export function partitionVisits(
  visits: CustomerVisit[],
  now: Date = new Date(),
): { upcoming: CustomerVisit[]; recent: CustomerVisit[] } {
  const nowMs = now.getTime();
  const upcoming: CustomerVisit[] = [];
  const recent: CustomerVisit[] = [];
  for (const v of visits) {
    const t = new Date(v.scheduledAt).getTime();
    if (Number.isNaN(t)) continue;
    if (t >= nowMs && v.status !== "cancelled" && v.status !== "no_show") {
      upcoming.push(v);
    } else {
      recent.push(v);
    }
  }
  // Upcoming: soonest first. Recent: most recent first.
  upcoming.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  recent.sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt));
  return { upcoming, recent };
}
