import { create } from "zustand";
import type { CustomerAccount, UpdateCustomerRequest } from "@dpf/types";
import { updateCustomerSchema } from "@dpf/validators";
import { api } from "@/src/lib/apiClient";

export interface CustomerState {
  customers: CustomerAccount[];
  selectedCustomer: CustomerAccount | null;
  isLoading: boolean;
  error: string | null;
  fetchCustomers: (search?: string) => Promise<void>;
  fetchDetail: (id: string) => Promise<void>;
  updateCustomer: (id: string, input: UpdateCustomerRequest) => Promise<void>;
}

export const useCustomerStore = create<CustomerState>((set, get) => ({
  customers: [],
  selectedCustomer: null,
  isLoading: false,
  error: null,

  fetchCustomers: async (search?: string) => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.customer.list({
        search,
        limit: 100,
      });
      set({ customers: res.data, isLoading: false });
    } catch (err) {
      set({
        isLoading: false,
        error:
          err instanceof Error ? err.message : "Failed to load customers",
      });
    }
  },

  fetchDetail: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      const customer = await api.customer.getById(id);
      set({ selectedCustomer: customer, isLoading: false });
    } catch (err) {
      set({
        isLoading: false,
        error:
          err instanceof Error
            ? err.message
            : "Failed to load customer detail",
      });
    }
  },

  updateCustomer: async (id: string, input: UpdateCustomerRequest) => {
    const parsed = updateCustomerSchema.safeParse(input);
    if (!parsed.success) {
      set({ error: parsed.error.issues[0]?.message ?? "Validation failed" });
      return;
    }

    set({ isLoading: true, error: null });
    try {
      const updated = await api.customer.update(id, parsed.data);
      set((state) => ({
        selectedCustomer:
          state.selectedCustomer?.id === id
            ? updated
            : state.selectedCustomer,
        customers: state.customers.map((c) => (c.id === id ? updated : c)),
        isLoading: false,
      }));
    } catch (err) {
      set({
        isLoading: false,
        error:
          err instanceof Error ? err.message : "Failed to update customer",
      });
    }
  },
}));
