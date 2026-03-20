import { create } from "zustand";
import type {
  Epic,
  BacklogItem,
  CreateBacklogItemRequest,
  UpdateBacklogItemRequest,
} from "@dpf/types";
import {
  createBacklogItemSchema,
  updateBacklogItemSchema,
} from "@dpf/validators";
import { api } from "@/src/lib/apiClient";

export interface OpsState {
  epics: Epic[];
  selectedEpic: Epic | null;
  backlogItems: BacklogItem[];
  isLoading: boolean;
  error: string | null;
  fetchEpics: () => Promise<void>;
  fetchEpicDetail: (id: string) => Promise<void>;
  fetchBacklog: (filters?: {
    status?: string;
    epicId?: string;
  }) => Promise<void>;
  createItem: (input: CreateBacklogItemRequest) => Promise<void>;
  updateItem: (id: string, input: UpdateBacklogItemRequest) => Promise<void>;
  deleteItem: (id: string) => Promise<void>;
}

export const useOpsStore = create<OpsState>((set, get) => ({
  epics: [],
  selectedEpic: null,
  backlogItems: [],
  isLoading: false,
  error: null,

  fetchEpics: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.ops.listEpics({ limit: 100 });
      set({ epics: res.data, isLoading: false });
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : "Failed to load epics",
      });
    }
  },

  fetchEpicDetail: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      // Fetch epics list and filter to find the one we need,
      // then load its backlog items
      const epics = get().epics;
      const epic = epics.find((e) => e.id === id) ?? null;

      // Also fetch backlog items for this epic
      const backlogRes = await api.ops.listBacklog({ epicId: id, limit: 100 });
      set({
        selectedEpic: epic,
        backlogItems: backlogRes.data,
        isLoading: false,
      });
    } catch (err) {
      set({
        isLoading: false,
        error:
          err instanceof Error ? err.message : "Failed to load epic detail",
      });
    }
  },

  fetchBacklog: async (filters) => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.ops.listBacklog({
        status: filters?.status,
        epicId: filters?.epicId,
        limit: 100,
      });
      set({ backlogItems: res.data, isLoading: false });
    } catch (err) {
      set({
        isLoading: false,
        error:
          err instanceof Error ? err.message : "Failed to load backlog items",
      });
    }
  },

  createItem: async (input: CreateBacklogItemRequest) => {
    const parsed = createBacklogItemSchema.safeParse(input);
    if (!parsed.success) {
      set({ error: parsed.error.issues[0]?.message ?? "Validation failed" });
      return;
    }

    set({ isLoading: true, error: null });
    try {
      const item = await api.ops.createBacklogItem(parsed.data);
      set((state) => ({
        backlogItems: [...state.backlogItems, item],
        isLoading: false,
      }));
    } catch (err) {
      set({
        isLoading: false,
        error:
          err instanceof Error ? err.message : "Failed to create backlog item",
      });
    }
  },

  updateItem: async (id: string, input: UpdateBacklogItemRequest) => {
    const parsed = updateBacklogItemSchema.safeParse(input);
    if (!parsed.success) {
      set({ error: parsed.error.issues[0]?.message ?? "Validation failed" });
      return;
    }

    set({ isLoading: true, error: null });
    try {
      const updated = await api.ops.updateBacklogItem(id, parsed.data);
      set((state) => ({
        backlogItems: state.backlogItems.map((item) =>
          item.id === id ? updated : item,
        ),
        isLoading: false,
      }));
    } catch (err) {
      set({
        isLoading: false,
        error:
          err instanceof Error ? err.message : "Failed to update backlog item",
      });
    }
  },

  deleteItem: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      await api.ops.deleteBacklogItem(id);
      set((state) => ({
        backlogItems: state.backlogItems.filter((item) => item.id !== id),
        isLoading: false,
      }));
    } catch (err) {
      set({
        isLoading: false,
        error:
          err instanceof Error ? err.message : "Failed to delete backlog item",
      });
    }
  },
}));
